// ══════════════════════════════════════════════════════════════
//  Master Admin System — مدارس الإبداع والتميز الدولية
//  File: Master_Admin.gs
//  Version: 1.0.0 — النسخة النهائية المتكاملة
//  تاريخ: 2026-04-28
// ══════════════════════════════════════════════════════════════

// ── معرفات الملفات الأربعة ──────────────────────────────────
var MASTER_SS_ID   = SpreadsheetApp.getActiveSpreadsheet().getId();
var TEACHER_SS_ID  = '1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM';
var STUDENT_SS_ID  = TEACHER_SS_ID;  // ✅ بعد التوحيد: الطالب يقرأ من ملف المعلم
var CMS_SS_ID      = '1J7DY-Z2PZU5y5HH-LR3vhuEhPAkjWz22vMu1rYLcse0';
var SCHOOLS_DRIVE_FOLDER = '';
var SCHEDULE_SS_ID = '14VflEuGRCXIOz22_cYp2HmUTZYYsMJ1fNtvDMxbYSZA';

// ── إعدادات المصادقة ────────────────────────────────────────
var MASTER_SESSION_TTL   = 28800;   // 8 ساعات
var MASTER_SESSION_PREFIX = 'master_session_';
var MASTER_RATE_LIMIT_TTL = 900;    // 15 دقيقة
var MASTER_MAX_ATTEMPTS   = 5;

// ── TTL الكاش ────────────────────────────────────────────────
var CACHE_STATS_TTL   = 3600;  // ساعة
var CACHE_FIN_TTL     = 1800;  // 30 دقيقة

// ══════════════════════════════════════════════════════
// Singleton لتجنّب فتح الملف مرات متعددة (P-OPT-03)
// ══════════════════════════════════════════════════════
var _ss_cache = {};

function _getSSById(id) {
  if (!_ss_cache[id]) {
    _ss_cache[id] = SpreadsheetApp.openById(id);
  }
  return _ss_cache[id];
}

// ══════════════════════════════════════════════════════
// TTL مخصص للكاش حسب نوع البيانات (P-OPT-05)
// ══════════════════════════════════════════════════════
var MASTER_CACHE_TTL = {
  STATS      : 3600,  // الإحصاءات (ساعة)
  FINANCIAL  : 1800,  // الملخص المالي (30 دقيقة)
  SCHOOLS    : 600,   // قائمة المدارس (10 دقائق)
  SETTINGS   : 1800,  // الإعدادات (30 دقيقة)
  AUDIT      : 120,   // سجل التدقيق (دقيقتان)
  SYNC_LOG   : 120    // سجل المزامنة (دقيقتان)
};

// ══════════════════════════════════════════════════════════════
//  دوال مساعدة أساسية
// ══════════════════════════════════════════════════════════════

function _safeStr(val) {
  if (val === null || val === undefined) return '';
  return val.toString().trim();
}

function _safeNum(val) {
  if (val === '' || val === null || val === undefined) return null;
  var n = Number(val);
  return isNaN(n) ? null : n;
}

function _safeFloat(v, def) {
  var n = parseFloat(v);
  return isNaN(n) ? (def || 0) : n;
}

function _nowString() {
  return Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'
  );
}

function _todayString() {
  return Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'
  );
}

function _generateUUID() {
  return Utilities.getUuid();
}

// ── CacheService ─────────────────────────────────────────────

function _cacheGet(key) {
  try {
    var r = CacheService.getScriptCache().get(key);
    return r ? JSON.parse(r) : null;
  } catch (e) { return null; }
}

function _cacheSet(key, data, ttl) {
  try {
    var str = JSON.stringify(data);
    if (str.length > 100000) return; // حد الكاش 100KB
    CacheService.getScriptCache().put(key, str, ttl || 3600);
  } catch (e) { Logger.log('_cacheSet error: ' + e.message); }
}

function _cacheDel(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) {}
}

// ── فتح الملفات ──────────────────────────────────────────────

function _getMasterSS() {
  try {
    return _getSSById(MASTER_SS_ID);
  } catch (e) {
    throw new Error('لا يمكن فتح Master_Admin_School: ' + e.message);
  }
}
function _getTeacherSS() {
  var id = (_ACTIVE_SCHOOL && _ACTIVE_SCHOOL.teacher) ? _ACTIVE_SCHOOL.teacher : TEACHER_SS_ID;
  try { return _getSSById(id); }
  catch (e) { throw new Error('لا يمكن فتح ملف المعلمين: ' + e.message); }
}

function _getStudentSS() {
  var id = (_ACTIVE_SCHOOL && _ACTIVE_SCHOOL.student) ? _ACTIVE_SCHOOL.student : STUDENT_SS_ID;
  try { return _getSSById(id); }
  catch (e) { throw new Error('لا يمكن فتح ملف الطالب: ' + e.message); }
}

function _getCmsSS() {
  var id = (_ACTIVE_SCHOOL && _ACTIVE_SCHOOL.cms) ? _ACTIVE_SCHOOL.cms : CMS_SS_ID;
  try { return _getSSById(id); }
  catch (e) { throw new Error('لا يمكن فتح ملف CMS: ' + e.message); }
}

function _getScheduleSS() {
  var id = (_ACTIVE_SCHOOL && _ACTIVE_SCHOOL.schedule) ? _ACTIVE_SCHOOL.schedule : SCHEDULE_SS_ID;
  try { return _getSSById(id); }
  catch (e) { throw new Error('لا يمكن فتح ملف الحصص: ' + e.message); }
}
function _getMasterSheet(name) {
  var ss = _getMasterSS();
  return ss.getSheetByName(name);
}

function _getOrCreateMasterSheet(name, headers) {
  var ss    = _getMasterSS();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
           .setBackground('#1a237e')
           .setFontColor('#ffffff')
           .setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}
function getDeployUrlForClient() {
  return ScriptApp.getService().getUrl();
}
// ══════════════════════════════════════════════════════════════
//  نقطة الدخول
// ══════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════
//  تهيئة الأوراق (أول تشغيل)
// ══════════════════════════════════════════════════════════════

function initializeMasterSheets() {
  Logger.log('══ بدء تهيئة Master_Admin_School ══');

  // Dashboard
  _getOrCreateMasterSheet('Dashboard', [
    'المؤشر', 'القيمة', 'التغيير', 'آخر تحديث', 'المصدر'
  ]);

  // Schools
  _getOrCreateMasterSheet('Schools', [
    'school_id', 'school_name', 'admin_email', 'admin_password',
    'teacher_file_id', 'student_file_id', 'cms_file_id', 'schedule_file_id',
    'subscription_start', 'subscription_end', 'is_active', 'plan_type',
    'phone', 'address', 'logo_url', 'created_at', 'notes'
  ]);

  // Users_Master
  _getOrCreateMasterSheet('Users_Master', [
    'user_id', 'school_id', 'role', 'name', 'email', 'password',
    'last_login', 'is_active', 'created_at', 'permissions'
  ]);

  // Audit_Master
  _getOrCreateMasterSheet('Audit_Master', [
    'log_id', 'timestamp', 'school_id', 'user_name', 'action',
    'affected_module', 'details', 'ip_info'
  ]);

  // Financial_Summary
  _getOrCreateMasterSheet('Financial_Summary', [
    'student_code', 'student_name', 'grade', 'section',
    'total_fees', 'paid', 'remaining', 'payment_pct',
    'is_blocked', 'last_payment_date'
  ]);

  // Sync_Log
  _getOrCreateMasterSheet('Sync_Log', [
    'sync_id', 'timestamp', 'sync_type', 'source_file',
    'target_file', 'records_synced', 'status', 'error_msg'
  ]);

  // Settings_Master
  var settingsSheet = _getOrCreateMasterSheet('Settings_Master', [
    'setting_key', 'setting_value', 'description', 'last_modified', 'modified_by'
  ]);

  // إضافة الإعدادات الافتراضية
  var defaultSettings = [
    ['block_percentage',    '10',  'نسبة الحجب المالي (%)',           _nowString(), 'System'],
    ['school_name',         'مدارس الإبداع والتميز الدولية', 'اسم المدرسة', _nowString(), 'System'],
    ['school_phone',        '775189922', 'هاتف المدرسة',              _nowString(), 'System'],
    ['trial_days',          '30',  'أيام الفترة التجريبية',           _nowString(), 'System'],
    ['sync_interval_hours', '24',  'فترة المزامنة التلقائية (ساعة)',  _nowString(), 'System']
  ];

  if (settingsSheet.getLastRow() < 2) {
    settingsSheet.getRange(2, 1, defaultSettings.length, 5).setValues(defaultSettings);
  }

  // تسجيل مدرسة الإبداع كأول مدرسة
  _registerDefaultSchool();

  Logger.log('✅ تمت تهيئة Master_Admin_School بنجاح');
  return { ok: true, message: 'تمت التهيئة بنجاح' };
}

function _registerDefaultSchool() {
  var sheet = _getMasterSheet('Schools');
  if (!sheet || sheet.getLastRow() > 1) return; // موجودة بالفعل

  var schoolId = _generateUUID();
  sheet.appendRow([
    schoolId,
    'مدارس الإبداع والتميز الدولية',
    'info@ebdaa-tamayuz.edu',
    'admin2026',
    TEACHER_SS_ID,
    STUDENT_SS_ID,
    CMS_SS_ID,
    SCHEDULE_SS_ID,
    _todayString(),
    '2027-08-31',
    'TRUE',
    'premium',
    '775189922',
    'اليمن – صنعاء – السنينة – حي الطيران',
    '',
    _nowString(),
    'المدرسة الافتراضية'
  ]);

  // إضافة المدير في Users_Master
  var usersSheet = _getMasterSheet('Users_Master');
  if (usersSheet && usersSheet.getLastRow() < 2) {
        usersSheet.appendRow([
      _generateUUID(),
      schoolId,
      'owner',
      'مدير النظام',
      'info@ebdaa-tamayuz.edu',
      'admin2026',
      '',
      'TRUE',
      _nowString(),
      'all'
    ]);
  }

  Logger.log('تم تسجيل مدرسة الإبداع والتميز كمدرسة افتراضية');
}

// ══════════════════════════════════════════════════════════════
//  المصادقة المركزية
// ══════════════════════════════════════════════════════════════

function masterLogin(params) {
  try {
    var email    = _safeStr(params.email).toLowerCase();
    var password = _safeStr(params.password);
    var clientId = _safeStr(params.clientId || 'unknown');

    if (!email || !password) {
      return { success: false, error: 'البريد الإلكتروني وكلمة المرور مطلوبان' };
    }

    // Rate Limiting
    var ratKey   = 'master_rate_' + clientId;
    var attempts = parseInt(CacheService.getScriptCache().get(ratKey) || '0');
    if (attempts >= MASTER_MAX_ATTEMPTS) {
      return {
        success     : false,
        rateLimited : true,
        error       : 'تم تجاوز عدد المحاولات. يرجى الانتظار 15 دقيقة.'
      };
    }

    // البحث في Users_Master
    var usersSheet = _getMasterSheet('Users_Master');
    if (!usersSheet) {
      return { success: false, error: 'قاعدة المستخدمين غير موجودة. شغّل initializeMasterSheets() أولاً.' };
    }

    var data = usersSheet.getDataRange().getValues();
    var user = null;

    for (var i = 1; i < data.length; i++) {
      var rowEmail = _safeStr(data[i][4]).toLowerCase();
      var rowPass  = _safeStr(data[i][5]);
      var isActive = _safeStr(data[i][7]).toLowerCase();

      if (rowEmail === email && rowPass === password) {
        if (isActive !== 'true' && isActive !== 'TRUE' && isActive !== '1') {
          return { success: false, error: 'الحساب غير مفعّل. تواصل مع الإدارة.' };
        }

        // التحقق من صلاحية المدرسة
        var schoolId = _safeStr(data[i][1]);
        var schoolOk = _checkSchoolActive(schoolId);
        if (!schoolOk.active) {
          return { success: false, error: schoolOk.message };
        }

        user = {
          userId   : _safeStr(data[i][0]),
          schoolId : schoolId,
          role     : _safeStr(data[i][2]),
          name     : _safeStr(data[i][3]),
          email    : _safeStr(data[i][4]),
          rowIndex : i + 1
        };
        break;
      }
    }

    if (!user) {
      // تسجيل محاولة فاشلة
      var newAttempts = attempts + 1;
      CacheService.getScriptCache().put(ratKey, String(newAttempts), MASTER_RATE_LIMIT_TTL);
      return { success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' };
    }

    // توليد Token
    var token = _generateUUID().replace(/-/g, '') + _generateUUID().replace(/-/g, '');
    token = token.substring(0, 40);

    var session = {
      userId  : user.userId,
      schoolId: user.schoolId,
      role    : user.role,
      name    : user.name,
      email   : user.email,
      expires : Date.now() + (MASTER_SESSION_TTL * 1000)
    };

    CacheService.getScriptCache().put(
      MASTER_SESSION_PREFIX + token,
      JSON.stringify(session),
      MASTER_SESSION_TTL
    );

    // تحديث آخر دخول
    usersSheet.getRange(user.rowIndex, 7).setValue(_nowString());

    // مسح محاولات الفشل
    _cacheDel(ratKey);

    // تسجيل في Audit_Master
    _logAudit(user.schoolId, user.name, 'LOGIN', 'Auth', 'تسجيل دخول ناجح', clientId);

    Logger.log('masterLogin SUCCESS: ' + user.email + ' | role=' + user.role);

    return {
      success  : true,
      token    : token,
      name     : user.name,
      role     : user.role,
      isOwner  : (user.role === 'owner'),
      schoolId : user.schoolId,
      schoolName: _getSchoolNameById(user.schoolId),
      expiresIn: MASTER_SESSION_TTL
    };
  } catch (e) {
    Logger.log('masterLogin error: ' + e.toString());
    return { success: false, error: 'خطأ داخلي: ' + e.message };
  }
}

function _checkSchoolActive(schoolId) {
  try {
    var sheet = _getMasterSheet('Schools');
    if (!sheet) return { active: true }; // لو لم توجد الورقة نتجاوز

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][0]) === schoolId) {
        var isActive = _safeStr(data[i][10]).toLowerCase();
        var endDate  = _safeStr(data[i][9]);

        if (isActive !== 'true' && isActive !== 'TRUE' && isActive !== '1') {
          return { active: false, message: 'المدرسة غير مفعّلة. تواصل مع الإدارة.' };
        }

        if (endDate && endDate < _todayString()) {
          return { active: false, message: 'انتهى اشتراك المدرسة. يرجى التجديد.' };
        }

        return { active: true };
      }
    }
    return { active: true }; // المدرسة غير موجودة في القائمة = نتجاوز
  } catch (e) {
    return { active: true }; // خطأ = نتجاوز ولا نوقف الدخول
  }
}

// يُرجع اسم المدرسة من سجل Schools حسب معرّفها (للعرض في لوحة الماستر)
function _getSchoolNameById(schoolId) {
  try {
    if (!schoolId) return '';
    var sheet = _getMasterSheet('Schools');
    if (!sheet) return '';
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][0]) === _safeStr(schoolId)) {
        return _safeStr(data[i][1]); // العمود school_name
      }
    }
    return '';
  } catch (e) { return ''; }
}

function masterLogout(params) {
  var token = _safeStr(params.token);
  if (token) _cacheDel(MASTER_SESSION_PREFIX + token);
  return { success: true, message: 'تم تسجيل الخروج' };
}

function validateMasterToken(token) {
  if (!token || token.length < 10) return null;
  try {
    var raw = CacheService.getScriptCache().get(MASTER_SESSION_PREFIX + token);
    if (!raw) return null;
    var session = JSON.parse(raw);
    if (session.expires && Date.now() > session.expires) {
      _cacheDel(MASTER_SESSION_PREFIX + token);
      return null;
    }
    // تجديد الجلسة
    CacheService.getScriptCache().put(
      MASTER_SESSION_PREFIX + token, raw, MASTER_SESSION_TTL
    );
    return session;
  } catch (e) { return null; }
}

function checkMasterSession(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { valid: false, error: 'الجلسة منتهية. يرجى تسجيل الدخول.' };
  return {
    valid   : true,
    name    : session.name,
    role    : session.role,
    isOwner : _isOwnerSession(session),
    schoolId: session.schoolId,
    schoolName: _getSchoolNameById(session.schoolId)
  };
}

// ══════════════════════════════════════════════════════════════
//  سجل التدقيق المركزي
// ══════════════════════════════════════════════════════════════

function _logAudit(schoolId, userName, action, module, details, extra) {
  try {
    var sheet = _getOrCreateMasterSheet('Audit_Master', [
      'log_id', 'timestamp', 'school_id', 'user_name', 'action',
      'affected_module', 'details', 'ip_info'
    ]);
    sheet.appendRow([
      _generateUUID(),
      _nowString(),
      _safeStr(schoolId),
      _safeStr(userName),
      _safeStr(action),
      _safeStr(module),
      _safeStr(details),
      _safeStr(extra || '')
    ]);
  } catch (e) {
    Logger.log('_logAudit error: ' + e.message);
  }
}

function _logSync(syncType, sourceFile, targetFile, recordsSynced, status, errorMsg) {
  try {
    var sheet = _getOrCreateMasterSheet('Sync_Log', [
      'sync_id', 'timestamp', 'sync_type', 'source_file',
      'target_file', 'records_synced', 'status', 'error_msg'
    ]);
    sheet.appendRow([
      _generateUUID(),
      _nowString(),
      _safeStr(syncType),
      _safeStr(sourceFile),
      _safeStr(targetFile),
      recordsSynced || 0,
      _safeStr(status || 'success'),
      _safeStr(errorMsg || '')
    ]);
  } catch (e) {
    Logger.log('_logSync error: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  الإعدادات المركزية
// ══════════════════════════════════════════════════════════════

function getMasterSetting(key) {
  try {
    var sheet = _getMasterSheet('Settings_Master');
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][0]) === key) return _safeStr(data[i][1]);
    }
    return null;
  } catch (e) { return null; }
}
function saveMasterSettingProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };
  if (!_isOwnerSession(session)) return { success: false, error: 'لمالك النظام فقط' };  // ✅ تم التغيير

  try {
    var key   = _safeStr(params.key);
    var value = _safeStr(params.value);
    if (!key) return { success: false, error: 'المفتاح مطلوب' };

    var sheet = _getOrCreateMasterSheet('Settings_Master', [
      'setting_key', 'setting_value', 'description', 'last_modified', 'modified_by'
    ]);
    var data = sheet.getDataRange().getValues();
    var found = false;

    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][0]) === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        sheet.getRange(i + 1, 4).setValue(_nowString());
        sheet.getRange(i + 1, 5).setValue(session.name);
        found = true;
        break;
      }
    }

    if (!found) {
      sheet.appendRow([key, value, '', _nowString(), session.name]);
    }

    if (key === 'block_percentage') {
      try {
        var targetSchoolId = _safeStr(params.schoolId || session.schoolId || '');
        var fileId = '';
        if (targetSchoolId) {
          var schoolsSheet = _getMasterSheet('Schools');
          if (schoolsSheet) {
            var sData = schoolsSheet.getDataRange().getValues();
            for (var si = 1; si < sData.length; si++) {
              if (_safeStr(sData[si][0]) === targetSchoolId) {
                fileId = _safeStr(sData[si][4]);
                break;
              }
            }
          }
        }
        if (!fileId) fileId = STUDENT_SS_ID;

        var targetSS   = _getSSById(fileId);
        var settSheet   = targetSS.getSheetByName('الاعدادات');
        if (settSheet) {
          settSheet.getRange('A2').setValue(parseFloat(value) || 0);
          SpreadsheetApp.flush();
          Logger.log('تم تحديث نسبة الحجب في ملف المدرسة ' + targetSchoolId + ': ' + value + '%');
        }
      } catch (se) {
        Logger.log('تحذير: تعذر تحديث نسبة الحجب: ' + se.message);
      }
    }

    _logAudit(session.schoolId, session.name, 'SETTING_CHANGE',
              'Settings', 'تم تعديل: ' + key + ' = ' + value, '');

    SpreadsheetApp.flush();
    return { success: true, message: 'تم حفظ الإعداد بنجاح' };
  } catch (e) {
    Logger.log('saveMasterSettingProtected error: ' + e.toString());
    return { success: false, error: e.message };
  }
}
function getAllSettingsProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };

  try {
    var sheet = _getMasterSheet('Settings_Master');
    if (!sheet) return { success: true, settings: [] };
    var data = sheet.getDataRange().getValues();
    var out  = [];
    for (var i = 1; i < data.length; i++) {
      out.push({
        key         : _safeStr(data[i][0]),
        value       : _safeStr(data[i][1]),
        description : _safeStr(data[i][2]),
        lastModified: _safeStr(data[i][3]),
        modifiedBy  : _safeStr(data[i][4])
      });
    }
    return { success: true, settings: out };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
// ══════════════════════════════════════════════════════════════
//  دوال المزامنة المركزية
// ══════════════════════════════════════════════════════════════

/**
 * المزامنة الشاملة — تشغّل كل العمليات بالترتيب
 */
function masterSyncAll() {
  Logger.log('══ بدء masterSyncAll ══ ' + _nowString());
  var results = {
    notes      : { ok: false, count: 0 },
    financial  : { ok: false, count: 0 },
    stats      : { ok: false }
  };

  // 1. مزامنة الملاحظات (ما زالت مفيدة)
  try {
    var nRes = syncNotesFromStudent();
    results.notes = { ok: true, count: nRes.synced || 0 };
    Logger.log('✅ الملاحظات: ' + nRes.synced + ' سجل');
  } catch (e) {
    results.notes.error = e.message;
    Logger.log('❌ الملاحظات: ' + e.message);
  }

  // 2. الملخص المالي
  try {
    var finRes = buildFinancialSummary();
    results.financial = { ok: true, count: finRes.count || 0 };
    Logger.log('✅ الملخص المالي: ' + finRes.count + ' طالب');
  } catch (e) {
    results.financial.error = e.message;
    Logger.log('❌ الملخص المالي: ' + e.message);
  }

  // 3. تحديث Dashboard
  try {
    collectAllStats();
    results.stats = { ok: true };
    Logger.log('✅ Dashboard محدّث');
  } catch (e) {
    results.stats.error = e.message;
    Logger.log('❌ Dashboard: ' + e.message);
  }

  // تسجيل في Sync_Log
  _logSync('masterSyncAll', 'all_files', 'all_files',
    (results.notes.count || 0) + (results.financial.count || 0),
    'success', '');

  Logger.log('══ انتهى masterSyncAll ══ ' + _nowString());
  return { ok: true, results: results, timestamp: _nowString() };
}
/**
 * مزامنة المخالفات: ملف المعلمين → ملف الطالب
 */
function syncViolationsToStudent() {
  try {
    var teacherSS = _getTeacherSS();
    var studentSS = _getStudentSS();

    var srcSheet = teacherSS.getSheetByName('المخالفات');
    if (!srcSheet) throw new Error('ورقة المخالفات غير موجودة في ملف المعلمين');

    var srcData = srcSheet.getDataRange().getValues();
    if (srcData.length < 2) return { ok: true, synced: 0 };

    // الهدف: "سلبيات ومميزات الطالب" في ملف الطالب
    var dstSheet = studentSS.getSheetByName('سلبيات ومميزات الطالب');
    if (!dstSheet) {
      dstSheet = studentSS.insertSheet('سلبيات ومميزات الطالب');
      dstSheet.getRange(1, 1, 1, 8).setValues([[
        'الكود', 'الاسم', 'الفصل', 'الشعبة',
        'المخالفة', 'المدرس', 'التاريخ', 'الرد'
      ]]);
    }

    // مسح وإعادة الكتابة الكاملة (أسرع وأضمن)
    dstSheet.clearContents();
    dstSheet.getRange(1, 1, srcData.length, srcData[0].length)
            .setValues(srcData);

    SpreadsheetApp.flush();
    var synced = srcData.length - 1;
    _logSync('sync_violations', TEACHER_SS_ID, STUDENT_SS_ID, synced, 'success', '');
    Logger.log('syncViolationsToStudent: ' + synced + ' سجل');
    return { ok: true, synced: synced };
  } catch (e) {
    Logger.log('syncViolationsToStudent error: ' + e.toString());
    _logSync('sync_violations', TEACHER_SS_ID, STUDENT_SS_ID, 0, 'error', e.message);
    throw e;
  }
}

/**
 * مزامنة الملاحظات: ملف الطالب → ملف المعلمين
 */
function syncNotesFromStudent() {
  try {
    var studentSS = _getStudentSS();
    var teacherSS = _getTeacherSS();

    var srcSheet = studentSS.getSheetByName('الملاحظات');
    if (!srcSheet) return { ok: true, synced: 0 };

    var srcData = srcSheet.getDataRange().getValues();
    if (srcData.length < 2) return { ok: true, synced: 0 };

    var dstSheet = teacherSS.getSheetByName('الملاحظات');
    if (!dstSheet) {
      dstSheet = teacherSS.insertSheet('الملاحظات');
    }

    dstSheet.clearContents();
    dstSheet.getRange(1, 1, srcData.length, srcData[0].length)
            .setValues(srcData);

    SpreadsheetApp.flush();
    var synced = srcData.length - 1;
    _logSync('sync_notes', STUDENT_SS_ID, TEACHER_SS_ID, synced, 'success', '');
    return { ok: true, synced: synced };
  } catch (e) {
    Logger.log('syncNotesFromStudent error: ' + e.toString());
    _logSync('sync_notes', STUDENT_SS_ID, TEACHER_SS_ID, 0, 'error', e.message);
    throw e;
  }
}

/**
 * مزامنة الدرجات: ملف المعلمين → ملف الطالب
 * يحافظ على هيكل الرأس (3 صفوف)
 */
function syncGradesToStudent() {
  try {
    var teacherSS = _getTeacherSS();
    var studentSS = _getStudentSS();

    var srcSheet = teacherSS.getSheetByName('الدرجات');
    if (!srcSheet) throw new Error('ورقة الدرجات غير موجودة في ملف المعلمين');

    var lastRow = srcSheet.getLastRow();
    var lastCol = srcSheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return { ok: true, synced: 0 };

    var srcData = srcSheet.getRange(1, 1, lastRow, lastCol).getValues();

    var dstSheet = studentSS.getSheetByName('الدرجات');
    if (!dstSheet) {
      dstSheet = studentSS.insertSheet('الدرجات');
    }

    // مسح وإعادة الكتابة
    dstSheet.clearContents();
    // الكتابة دفعات (تفادي timeout لـ 368 عمود × 1001 صف)
    var BATCH = 50;
    for (var startRow = 0; startRow < srcData.length; startRow += BATCH) {
      var endRow  = Math.min(startRow + BATCH, srcData.length);
      var chunk   = srcData.slice(startRow, endRow);
      dstSheet.getRange(startRow + 1, 1, chunk.length, lastCol).setValues(chunk);
    }

    SpreadsheetApp.flush();
    var synced = Math.max(0, lastRow - 3); // 3 صفوف رأس
    _logSync('sync_grades', TEACHER_SS_ID, STUDENT_SS_ID, synced, 'success', '');
    Logger.log('syncGradesToStudent: ' + synced + ' طالب');
    return { ok: true, synced: synced };
  } catch (e) {
    Logger.log('syncGradesToStudent error: ' + e.toString());
    _logSync('sync_grades', TEACHER_SS_ID, STUDENT_SS_ID, 0, 'error', e.message);
    throw e;
  }
}

/**
 * مزامنة الرسوم: ملف المعلمين (الطلاب) → ملف الطالب (الرسوم)
 * الهيكل المصدر: الكود|الاسم|الفصل|الشعبة|اجمالي الرسوم|المبالغ المسددة
 * الهيكل الهدف: الكود|اسم الطالب|اجمالي الرسوم|المسدد
 */
function syncFeesToStudent() {
  try {
    var teacherSS = _getTeacherSS();
    var studentSS = _getStudentSS();

    var srcSheet = teacherSS.getSheetByName('الطلاب');
    if (!srcSheet) throw new Error('ورقة الطلاب غير موجودة في ملف المعلمين');

    var srcData = srcSheet.getDataRange().getValues();
    if (srcData.length < 2) return { ok: true, synced: 0 };

    var dstSheet = studentSS.getSheetByName('الرسوم');
    if (!dstSheet) {
      dstSheet = studentSS.insertSheet('الرسوم');
    }

    // بناء بيانات الرسوم
    var feesRows = [['الكود', 'اسم الطالب', 'اجمالي الرسوم', 'المسدد']];
    for (var i = 1; i < srcData.length; i++) {
      var code  = _safeStr(srcData[i][0]);
      var name  = _safeStr(srcData[i][1]);
      var fees  = _safeFloat(srcData[i][4]);
      var paid  = _safeFloat(srcData[i][5]);
      if (!code && !name) continue;
      feesRows.push([code, name, fees, paid]);
    }

    dstSheet.clearContents();
    dstSheet.getRange(1, 1, feesRows.length, 4).setValues(feesRows);
    SpreadsheetApp.flush();

    var synced = feesRows.length - 1;
    _logSync('sync_fees', TEACHER_SS_ID, STUDENT_SS_ID, synced, 'success', '');
    Logger.log('syncFeesToStudent: ' + synced + ' طالب');
    return { ok: true, synced: synced };
  } catch (e) {
    Logger.log('syncFeesToStudent error: ' + e.toString());
    _logSync('sync_fees', TEACHER_SS_ID, STUDENT_SS_ID, 0, 'error', e.message);
    throw e;
  }
}

/**
 * بناء الملخص المالي في Master_Admin_School
 */
function buildFinancialSummary() {
  try {
    var teacherSS = _getTeacherSS();
    var studentSS = _getStudentSS();

    // قراءة الطلاب والرسوم من ملف المعلمين
    var studSheet = teacherSS.getSheetByName('الطلاب');
    if (!studSheet) throw new Error('ورقة الطلاب غير موجودة');
    var studData = studSheet.getDataRange().getValues();

    // قراءة نسبة الحجب من ملف الطالب
    var blockPct = 0;
    var exceptions = [];
    try {
      var settSheet = studentSS.getSheetByName('الاعدادات');
      if (settSheet) {
        var settData = settSheet.getDataRange().getValues();
        if (settData.length > 1) {
          blockPct = _safeFloat(settData[1][0], 0);
          for (var si = 1; si < settData.length; si++) {
            var ex = _safeStr(settData[si][1]);
            if (ex) exceptions.push(ex);
          }
        }
      }
    } catch (se) {
      Logger.log('تحذير: تعذر قراءة إعدادات الحجب: ' + se.message);
    }

    // قراءة آخر تسديد من ملف الطالب
    var lastPaymentMap = {};
    try {
      var paySheet = studentSS.getSheetByName('التسديد');
      if (paySheet) {
        var payData = paySheet.getDataRange().getValues();
        for (var pi = 1; pi < payData.length; pi++) {
          var pCode = _safeStr(payData[pi][0]);
          var pDate = _safeStr(payData[pi][3]);
          if (pCode && pDate) lastPaymentMap[pCode] = pDate;
        }
      }
    } catch (pe) {}

    // بناء الملخص
    var summary = [['student_code','student_name','grade','section',
                    'total_fees','paid','remaining','payment_pct',
                    'is_blocked','last_payment_date']];

    for (var i = 1; i < studData.length; i++) {
      var code  = _safeStr(studData[i][0]);
      var name  = _safeStr(studData[i][1]);
      var grade = _safeStr(studData[i][2]);
      var sec   = _safeStr(studData[i][3]);
      var fees  = _safeFloat(studData[i][4]);
      var paid  = _safeFloat(studData[i][5]);

      if (!code && !name) continue;

      var remaining  = fees - paid;
      var pct        = fees > 0 ? Math.round((paid / fees) * 100) : 100;
      var isBlocked  = false;

      if (blockPct > 0 && pct <= blockPct && exceptions.indexOf(code) === -1) {
        isBlocked = true;
      }

      summary.push([
        code, name, grade, sec,
        fees, paid, remaining, pct,
        isBlocked ? 'نعم' : 'لا',
        lastPaymentMap[code] || ''
      ]);
    }

    var finSheet = _getOrCreateMasterSheet('Financial_Summary', [
      'student_code','student_name','grade','section',
      'total_fees','paid','remaining','payment_pct',
      'is_blocked','last_payment_date'
    ]);

    finSheet.clearContents();
    finSheet.getRange(1, 1, summary.length, 10).setValues(summary);
    SpreadsheetApp.flush();

    _logSync('build_financial', TEACHER_SS_ID, MASTER_SS_ID,
             summary.length - 1, 'success', '');

    Logger.log('buildFinancialSummary: ' + (summary.length - 1) + ' طالب');
    return { ok: true, count: summary.length - 1, blockPct: blockPct };
  } catch (e) {
    Logger.log('buildFinancialSummary error: ' + e.toString());
    _logSync('build_financial', TEACHER_SS_ID, MASTER_SS_ID, 0, 'error', e.message);
    throw e;
  }
}

// ══════════════════════════════════════════════════════════════
//  recomputeBlocks — إعادة احتساب is_blocked لكل الطلاب فوراً
//  واجهة عامّة صريحة تُغلِّف buildFinancialSummary (نفس منطق الحجب:
//  نسبة من «الاعدادات» صف 2 + الاستثناءات). استدعها يدوياً/بزر بعد
//  تحديث الرسوم لتحديث is_blocked دون انتظار مزامنة الـ24 ساعة.
//  ملاحظة: رسوم الدراسة تُحرَّر يدوياً في الشيت (لا مسار كتابة برمجي)
//  لذا لا يوجد ربط تلقائي بعد التحرير — هذا هو المُحفِّز اليدوي المقصود.
// ══════════════════════════════════════════════════════════════
function recomputeBlocks() {
  var res = buildFinancialSummary();
  return {
    ok        : !!(res && res.ok),
    recomputed: (res && res.count) || 0,
    blockPct  : (res && res.blockPct) || 0,
    message   : 'أُعيد احتساب is_blocked لـ ' + ((res && res.count) || 0) +
                ' طالب (نسبة الحجب ' + ((res && res.blockPct) || 0) + '%).'
  };
}

// ══════════════════════════════════════════════════════════════
//  لوحة الإحصاءات
// ══════════════════════════════════════════════════════════════

function collectAllStats() {
  Logger.log('collectAllStats: بدء جمع الإحصاءات');
  var stats = {};

  // ── من ملف المعلمين ──────────────────────────────────────
  try {
    var tSS = _getTeacherSS();
    var today = _todayString();

    var studSheet = tSS.getSheetByName('الطلاب');
    stats.totalStudents = studSheet ? Math.max(0, studSheet.getLastRow() - 1) : 0;

    var tchSheet = tSS.getSheetByName('المدرسين');
    // عدد المعلمين الفريدين
    if (tchSheet) {
      var tchData = tchSheet.getDataRange().getValues();
      var uniqueTeachers = {};
      for (var ti = 1; ti < tchData.length; ti++) {
        var tn = _safeStr(tchData[ti][0]);
        if (tn) uniqueTeachers[tn] = true;
      }
      stats.totalTeachers = Object.keys(uniqueTeachers).length;
    } else { stats.totalTeachers = 0; }

    var vioSheet = tSS.getSheetByName('المخالفات');
    stats.totalViolations = vioSheet ? Math.max(0, vioSheet.getLastRow() - 1) : 0;

    var hwSheet = tSS.getSheetByName('الواجبات');
    stats.totalHomework = hwSheet ? Math.max(0, hwSheet.getLastRow() - 1) : 0;

    var newsSheet = tSS.getSheetByName('الاخبار');
    stats.totalNews = newsSheet ? Math.max(0, newsSheet.getLastRow() - 1) : 0;

    // إحصاءات الغياب اليوم
    var attSheet = tSS.getSheetByName('الغياب');
    if (attSheet) {
      var attData = attSheet.getDataRange().getValues();
      var todayAbsent = 0;
      var todayLate   = 0;
      var todayPresent = 0;
      for (var ai = 1; ai < attData.length; ai++) {
        if (_safeStr(attData[ai][4]) === today) {
          var st = _safeStr(attData[ai][5]);
          if (st === 'غائب')    todayAbsent++;
          else if (st === 'متأخر') todayLate++;
          else if (st === 'حاضر')  todayPresent++;
        }
      }
      stats.todayAbsent  = todayAbsent;
      stats.todayLate    = todayLate;
      stats.todayPresent = todayPresent;
      var todayTotal = todayAbsent + todayLate + todayPresent;
      stats.attendanceRate = todayTotal > 0
        ? Math.round((todayPresent / todayTotal) * 100) : 0;
    } else {
      stats.todayAbsent = 0; stats.todayLate = 0;
      stats.todayPresent = 0; stats.attendanceRate = 0;
    }

    stats.teacherFileOk = true;
  } catch (e) {
    Logger.log('collectAllStats teacher error: ' + e.message);
    stats.teacherFileOk = false;
  }

  // ── من ملف الطالب ─────────────────────────────────────────
  try {
    var sSS = _getStudentSS();

    var settSheet = sSS.getSheetByName('الاعدادات');
    stats.blockPercentage = 0;
    if (settSheet) {
      var settData = settSheet.getDataRange().getValues();
      if (settData.length > 1) stats.blockPercentage = _safeFloat(settData[1][0]);
    }

    // إجمالي الرسوم والمسدد من Financial_Summary
    var finSheet = _getMasterSheet('Financial_Summary');
    if (finSheet && finSheet.getLastRow() > 1) {
      var finData = finSheet.getDataRange().getValues();
      var totalFees  = 0;
      var totalPaid  = 0;
      var blockedCount = 0;
      for (var fi = 1; fi < finData.length; fi++) {
        totalFees  += _safeFloat(finData[fi][4]);
        totalPaid  += _safeFloat(finData[fi][5]);
        if (_safeStr(finData[fi][8]) === 'نعم') blockedCount++;
      }
      stats.totalFees    = totalFees;
      stats.totalPaid    = totalPaid;
      stats.totalRemaining = totalFees - totalPaid;
      stats.blockedCount = blockedCount;
    } else {
      stats.totalFees = 0; stats.totalPaid = 0;
      stats.totalRemaining = 0; stats.blockedCount = 0;
    }

    stats.studentFileOk = true;
  } catch (e) {
    Logger.log('collectAllStats student error: ' + e.message);
    stats.studentFileOk = false;
  }

  // ── من ملف CMS ────────────────────────────────────────────
  try {
    var cSS = _getCmsSS();
    var cmsNewsSheet  = cSS.getSheetByName('News');
    var cmsVidSheet   = cSS.getSheetByName('Videos');
    var cmsImgSheet   = cSS.getSheetByName('Images');
    var cmsSchedSheet = cSS.getSheetByName('Schedule');
    stats.cmsNews      = cmsNewsSheet  ? Math.max(0, cmsNewsSheet.getLastRow()  - 1) : 0;
    stats.cmsVideos    = cmsVidSheet   ? Math.max(0, cmsVidSheet.getLastRow()   - 1) : 0;
    stats.cmsImages    = cmsImgSheet   ? Math.max(0, cmsImgSheet.getLastRow()   - 1) : 0;
    stats.cmsScheduled = cmsSchedSheet ? Math.max(0, cmsSchedSheet.getLastRow() - 1) : 0;
    stats.cmsFileOk    = true;
  } catch (e) {
    Logger.log('collectAllStats cms error: ' + e.message);
    stats.cmsFileOk = false;
  }

  // ── من ملف الحصص ──────────────────────────────────────────
  try {
    var schSS = _getScheduleSS();
    var schSheet = schSS.getSheetByName('الجدول');
    stats.totalPeriods = schSheet ? Math.max(0, schSheet.getLastRow() - 1) : 0;
    stats.scheduleFileOk = true;
  } catch (e) {
    Logger.log('collectAllStats schedule error: ' + e.message);
    stats.scheduleFileOk = false;
  }

  stats.lastUpdated = _nowString();

  // كتابة في Dashboard
  _writeDashboard(stats);

  // حفظ في الكاش
  _cacheSet('master_stats', stats, CACHE_STATS_TTL);

  Logger.log('collectAllStats: اكتمل — ' + JSON.stringify({
    students: stats.totalStudents,
    teachers: stats.totalTeachers,
    absent  : stats.todayAbsent,
    blocked : stats.blockedCount
  }));

  return stats;
}

function _writeDashboard(stats) {
  try {
    var sheet = _getOrCreateMasterSheet('Dashboard', [
      'المؤشر', 'القيمة', 'الوحدة', 'آخر تحديث', 'المصدر'
    ]);

    var rows = [
      ['إجمالي الطلاب',       stats.totalStudents   || 0, 'طالب',   stats.lastUpdated, 'ملف المعلمين'],
      ['إجمالي المعلمين',     stats.totalTeachers   || 0, 'معلم',   stats.lastUpdated, 'ملف المعلمين'],
      ['الغائبون اليوم',      stats.todayAbsent     || 0, 'طالب',   stats.lastUpdated, 'ورقة الغياب'],
      ['المتأخرون اليوم',     stats.todayLate       || 0, 'طالب',   stats.lastUpdated, 'ورقة الغياب'],
      ['نسبة الحضور اليوم',   stats.attendanceRate  || 0, '%',      stats.lastUpdated, 'ورقة الغياب'],
      ['إجمالي المخالفات',    stats.totalViolations || 0, 'مخالفة', stats.lastUpdated, 'ملف المعلمين'],
      ['إجمالي الواجبات',     stats.totalHomework   || 0, 'واجب',   stats.lastUpdated, 'ملف المعلمين'],
      ['إجمالي الأخبار',      stats.totalNews       || 0, 'خبر',    stats.lastUpdated, 'ملف المعلمين'],
      ['الطلاب المحجوبون',    stats.blockedCount    || 0, 'طالب',   stats.lastUpdated, 'Financial_Summary'],
      ['نسبة الحجب المالي',   stats.blockPercentage || 0, '%',      stats.lastUpdated, 'ملف الطالب'],
      ['إجمالي الرسوم',       stats.totalFees       || 0, 'ريال',   stats.lastUpdated, 'Financial_Summary'],
      ['المبلغ المسدد',       stats.totalPaid       || 0, 'ريال',   stats.lastUpdated, 'Financial_Summary'],
      ['المتبقي',             stats.totalRemaining  || 0, 'ريال',   stats.lastUpdated, 'Financial_Summary'],
      ['أخبار CMS',           stats.cmsNews         || 0, 'خبر',    stats.lastUpdated, 'ملف CMS'],
      ['فيديوهات CMS',        stats.cmsVideos       || 0, 'فيديو',  stats.lastUpdated, 'ملف CMS'],
      ['حصص الجدول',          stats.totalPeriods    || 0, 'حصة',    stats.lastUpdated, 'ملف الحصص']
    ];

    // مسح البيانات القديمة وإعادة الكتابة
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 5).clearContent();
    sheet.getRange(2, 1, rows.length, 5).setValues(rows);

    // تنسيق العمود B (القيم) بخط عريض وتوسيط
    sheet.getRange(2, 2, rows.length, 1)
         .setFontWeight('bold')
         .setHorizontalAlignment('center');

    SpreadsheetApp.flush();
  } catch (e) {
    Logger.log('_writeDashboard error: ' + e.message);
  }
}

function getDashboardStatsProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };

  var scope    = _resolveScope(session, params);
  var cacheKey = 'master_stats_' + (scope.isOwner ? (scope.all ? 'ALL' : scope.schoolId) : scope.schoolId);

  var cached = _cacheGet(cacheKey);
  if (cached) return { success: true, stats: cached, scope: _scopeMeta(scope), fromCache: true };

  try {
    var stats;
    if (scope.isOwner && scope.all) {
      stats = _aggregateAllSchoolsStats();
    } else {
      _useSchool(scope.schoolId || session.schoolId);
      stats = _computeStatsActive();
      _clearActiveSchool();
    }
    _cacheSet(cacheKey, stats, CACHE_STATS_TTL);
    return { success: true, stats: stats, scope: _scopeMeta(scope), fromCache: false };
  } catch (e) {
    _clearActiveSchool();
    return { success: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════
//  التقارير
// ══════════════════════════════════════════════════════════════
function generateAttendanceReportProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };
  _applyScope(session, params);   // ✅ أضيف هنا

  try {
    var startDate = _safeStr(params.startDate || '');
    var endDate   = _safeStr(params.endDate   || _todayString());
    var grade     = _safeStr(params.grade     || '');
    var section   = _safeStr(params.section   || '');

    var tSS      = _getTeacherSS();
    var attSheet = tSS.getSheetByName('الغياب');
    if (!attSheet) return { success: true, data: [], total: 0 };

    var data    = attSheet.getDataRange().getValues();
    var map     = {};

    for (var i = 1; i < data.length; i++) {
      var code   = _safeStr(data[i][0]);
      var name   = _safeStr(data[i][1]);
      var rGrade = _safeStr(data[i][2]);
      var rSec   = _safeStr(data[i][3]);
      var date   = _safeStr(data[i][4]);
      var status = _safeStr(data[i][5]);

      if (!code) continue;
      if (grade   && rGrade !== grade)   continue;
      if (section && rSec   !== section) continue;
      if (startDate && date < startDate) continue;
      if (endDate   && date > endDate)   continue;

      if (!map[code]) {
        map[code] = {
          code: code, name: name, grade: rGrade, section: rSec,
          absent: 0, late: 0, present: 0, dates: []
        };
      }

      if (status === 'غائب')    map[code].absent++;
      else if (status === 'متأخر') map[code].late++;
      else if (status === 'حاضر')  map[code].present++;

      if (status !== 'حاضر') map[code].dates.push(date + '(' + status + ')');
    }

    var totalDays = 0;
    if (startDate && endDate) {
      var s = new Date(startDate);
      var en = new Date(endDate);
      totalDays = Math.max(1, Math.round((en - s) / (1000*60*60*24)) + 1);
    }

    var out = [];
    for (var k in map) {
      var r = map[k];
      var total = r.absent + r.late + r.present;
      var attRate = total > 0 ? Math.round((r.present / total) * 100) : 100;
      out.push({
        code       : r.code,
        name       : r.name,
        grade      : r.grade,
        section    : r.section,
        absent     : r.absent,
        late       : r.late,
        present    : r.present,
        totalDays  : total,
        attRate    : attRate,
        absentDates: r.dates.join(' | ')
      });
    }

    out.sort(function(a, b) { return b.absent - a.absent; });

    _logAudit(session.schoolId, session.name, 'REPORT_ATTENDANCE',
              'Reports', 'من ' + startDate + ' إلى ' + endDate, '');

    return { success: true, data: out, total: out.length,
             period: { start: startDate, end: endDate } };
  } catch (e) {
    Logger.log('generateAttendanceReportProtected error: ' + e.toString());
    return { success: false, error: e.message };
  }
}
function generateFinancialReportProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };
  _applyScope(session, params);   // ✅ أضيف هنا

  try {
    var threshold = _safeFloat(params.threshold, 0);

    var finSheet = _getMasterSheet('Financial_Summary');
    if (!finSheet) {
      buildFinancialSummary();
      finSheet = _getMasterSheet('Financial_Summary');
    }

    var data = finSheet.getDataRange().getValues();
    var out  = [];

    for (var i = 1; i < data.length; i++) {
      var pct  = _safeFloat(data[i][7]);
      var code = _safeStr(data[i][0]);
      var name = _safeStr(data[i][1]);
      if (!code && !name) continue;
      if (threshold > 0 && pct > threshold) continue;

      var phone = _getStudentPhone(code);
      var waLink = '';
      if (phone) {
        var ph = phone.replace(/[^0-9]/g, '');
        if (ph.charAt(0) === '0') ph = '967' + ph.substring(1);
        else if (ph.indexOf('967') !== 0) ph = '967' + ph;
        var msg = 'السيد/ة ولي أمر الطالب ' + name + '، ' +
                  'نود إعلامكم بأن نسبة تسديد الرسوم الدراسية بلغت ' +
                  pct + '%. ' +
                  'يرجى مراجعة الإدارة المالية. مدارس الإبداع والتميز الدولية.';
        waLink = 'https://wa.me/' + ph + '?text=' + encodeURIComponent(msg);
      }

      out.push({
        code      : code,
        name      : name,
        grade     : _safeStr(data[i][2]),
        section   : _safeStr(data[i][3]),
        totalFees : _safeFloat(data[i][4]),
        paid      : _safeFloat(data[i][5]),
        remaining : _safeFloat(data[i][6]),
        pct       : pct,
        isBlocked : _safeStr(data[i][8]),
        phone     : phone,
        waLink    : waLink
      });
    }

    out.sort(function(a, b) { return a.pct - b.pct; });

    return { success: true, data: out, total: out.length, threshold: threshold };
  } catch (e) {
    Logger.log('generateFinancialReportProtected error: ' + e.toString());
    return { success: false, error: e.message };
  }
}

function _getStudentPhone(studentCode) {
  try {
    var tSS   = _getTeacherSS();
    var sheet = tSS.getSheetByName('الطلاب');
    if (!sheet) return '';
    // البحث عن عمود الجوال ديناميكياً
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var phoneCol = -1;
    for (var h = 0; h < headers.length; h++) {
      var hv = _safeStr(headers[h]).trim();
      if (hv === 'رقم الجوال' || hv === 'الجوال' || hv === 'رقم الهاتف') {
        phoneCol = h;
        break;
      }
    }
    if (phoneCol < 0) return '';

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][0]) === studentCode) {
        return _safeStr(data[i][phoneCol]);
      }
    }
    return '';
  } catch (e) { return ''; }
}

function generateTeacherPerformanceReportProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };
  _applyScope(session, params);   // ✅ أضيف هنا

  try {
    var tSS    = _getTeacherSS();
    var map    = {};

    var hwSheet = tSS.getSheetByName('الواجبات');
    if (hwSheet) {
      var hwData = hwSheet.getDataRange().getValues();
      for (var i = 1; i < hwData.length; i++) {
        var teacher = _safeStr(hwData[i][1]);
        if (!teacher) continue;
        if (!map[teacher]) map[teacher] = { name:teacher, homework:0, news:0, violations:0 };
        map[teacher].homework++;
      }
    }

    var newsSheet = tSS.getSheetByName('الاخبار');
    if (newsSheet) {
      var newsData = newsSheet.getDataRange().getValues();
      for (var j = 1; j < newsData.length; j++) {
        var nt = _safeStr(newsData[j][1]);
        if (!nt) continue;
        if (!map[nt]) map[nt] = { name:nt, homework:0, news:0, violations:0 };
        map[nt].news++;
      }
    }

    var vioSheet = tSS.getSheetByName('المخالفات');
    if (vioSheet) {
      var vioData = vioSheet.getDataRange().getValues();
      for (var k = 1; k < vioData.length; k++) {
        var vt = _safeStr(vioData[k][5]);
        if (!vt) continue;
        if (!map[vt]) map[vt] = { name:vt, homework:0, news:0, violations:0 };
        map[vt].violations++;
      }
    }

    var out = [];
    for (var nm in map) {
      var r = map[nm];
      r.total = r.homework + r.news + r.violations;
      out.push(r);
    }
    out.sort(function(a, b) { return b.total - a.total; });

    return { success: true, data: out, total: out.length };
  } catch (e) {
    Logger.log('generateTeacherPerformanceReportProtected error: ' + e.toString());
    return { success: false, error: e.message };
  }
}
function getAbsentStudentsWithPhone(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };
  _applyScope(session, params);   // ✅ أضيف هنا

  try {
    var date    = _safeStr(params.date || _todayString());
    var tSS     = _getTeacherSS();
    var attSheet = tSS.getSheetByName('الغياب');
    if (!attSheet) return { success: true, data: [], total: 0 };

    var data = attSheet.getDataRange().getValues();
    var out  = [];

    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][4]) !== date) continue;
      var status = _safeStr(data[i][5]);
      if (status !== 'غائب' && status !== 'متأخر') continue;

      var code  = _safeStr(data[i][0]);
      var name  = _safeStr(data[i][1]);
      var phone = _safeStr(data[i][6]) || _getStudentPhone(code);

      var waLink = '';
      if (phone) {
        var ph = phone.replace(/[^0-9]/g, '');
        if (ph.charAt(0) === '0') ph = '967' + ph.substring(1);
        else if (ph.indexOf('967') !== 0) ph = '967' + ph;
        var msg = 'السيد/ة ولي أمر الطالب ' + name + '،\n' +
                  'نود إعلامكم بأن الطالب/ة ' + status + ' اليوم ' + date + '.\n' +
                  'للاستفسار يرجى التواصل: 775189922\n' +
                  'مدارس الإبداع والتميز الدولية';
        waLink = 'https://wa.me/' + ph + '?text=' + encodeURIComponent(msg);
      }

      out.push({
        code   : code,
        name   : name,
        grade  : _safeStr(data[i][2]),
        section: _safeStr(data[i][3]),
        status : status,
        phone  : phone,
        waLink : waLink
      });
    }

    return { success: true, data: out, total: out.length, date: date };
  } catch (e) {
    Logger.log('getAbsentStudentsWithPhone error: ' + e.toString());
    return { success: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════
//  إدارة المدارس (Multi-Tenant)
// ══════════════════════════════════════════════════════════════
function registerSchoolProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };
  if (!_isOwnerSession(session)) return { success: false, error: 'لمالك النظام فقط' };  // ✅ تم التغيير

  try {
    var d = params.schoolData;
    if (!d || !d.name || !d.adminEmail) {
      return { success: false, error: 'اسم المدرسة والبريد الإلكتروني مطلوبان' };
    }

    var schoolId = _generateUUID();
    var today    = _todayString();
    var trialDays = parseInt(getMasterSetting('trial_days') || '30');

    var endDate = new Date();
    endDate.setDate(endDate.getDate() + trialDays);
    var endDateStr = Utilities.formatDate(endDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    var sheet = _getOrCreateMasterSheet('Schools', [
      'school_id','school_name','admin_email','admin_password',
      'teacher_file_id','student_file_id','cms_file_id','schedule_file_id',
      'subscription_start','subscription_end','is_active','plan_type',
      'phone','address','logoUrl','created_at','notes'
    ]);

    sheet.appendRow([
      schoolId,
      _safeStr(d.name),
      _safeStr(d.adminEmail),
      _safeStr(d.adminPassword || '123456'),
      _safeStr(d.teacherFileId || ''),
      _safeStr(d.studentFileId || ''),
      _safeStr(d.cmsFileId     || ''),
      _safeStr(d.scheduleFileId|| ''),
      today,
      endDateStr,
      'TRUE',
      'trial',
      _safeStr(d.phone   || ''),
      _safeStr(d.address || ''),
      _safeStr(d.logoUrl || ''),
      _nowString(),
      _safeStr(d.notes   || '')
    ]);

    var usersSheet = _getOrCreateMasterSheet('Users_Master', [
      'user_id','school_id','role','name','email','password',
      'last_login','is_active','created_at','permissions'
    ]);
    usersSheet.appendRow([
      _generateUUID(), schoolId, 'admin',
      _safeStr(d.adminName || 'مدير المدرسة'),
      _safeStr(d.adminEmail),
      _safeStr(d.adminPassword || '123456'),
      '', 'TRUE', _nowString(), 'all'
    ]);

    SpreadsheetApp.flush();
    _logAudit(session.schoolId, session.name, 'REGISTER_SCHOOL',
              'Schools', 'تم تسجيل مدرسة: ' + d.name, schoolId);

    return {
      success      : true,
      schoolId     : schoolId,
      trialEnd     : endDateStr,
      message      : 'تم تسجيل مدرسة "' + d.name + '" بنجاح. الفترة التجريبية: ' + trialDays + ' يوم'
    };
  } catch (e) {
    Logger.log('registerSchoolProtected error: ' + e.toString());
    return { success: false, error: e.message };
  }
}
function getAllSchoolsProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };
  var ownerView = _isOwnerSession(session);
  var ownSchool = _safeStr(session.schoolId);

  try {
    var sheet = _getMasterSheet('Schools');
    if (!sheet) return { success: true, schools: [] };
    var data  = sheet.getDataRange().getValues();
    var out   = [];
    var today = _todayString();

    for (var i = 1; i < data.length; i++) {
      // مدير المدرسة يرى مدرسته فقط
      if (!ownerView && _safeStr(data[i][0]) !== ownSchool) continue;

      var endDate  = _safeStr(data[i][9]);
      var isActive = _safeStr(data[i][10]).toLowerCase() === 'true';
      var isExpired = endDate && endDate < today;

      out.push({
        schoolId       : _safeStr(data[i][0]),
        name           : _safeStr(data[i][1]),
        adminEmail     : _safeStr(data[i][2]),
        subscriptionEnd: endDate,
        isActive       : isActive,
        isExpired      : isExpired,
        planType       : _safeStr(data[i][11]),
        phone          : _safeStr(data[i][12]),
        address        : _safeStr(data[i][13]),
        createdAt      : _safeStr(data[i][15]),
        rowIndex       : i + 1
      });
    }
    return { success: true, schools: out, total: out.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
function setSchoolActiveProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };
  if (!_isOwnerSession(session)) return { success: false, error: 'لمالك النظام فقط' };  // ✅ تم التغيير

  try {
    var schoolId = _safeStr(params.schoolId);
    var isActive = params.isActive ? 'TRUE' : 'FALSE';

    var sheet = _getMasterSheet('Schools');
    if (!sheet) return { success: false, error: 'ورقة المدارس غير موجودة' };

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][0]) === schoolId) {
        sheet.getRange(i + 1, 11).setValue(isActive);
        SpreadsheetApp.flush();
        _logAudit(session.schoolId, session.name, 'SET_SCHOOL_ACTIVE',
                  'Schools', schoolId + ' → ' + isActive, '');
        return { success: true, message: 'تم تحديث حالة المدرسة' };
      }
    }
    return { success: false, error: 'المدرسة غير موجودة' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function renewSubscriptionProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };
  if (!_isOwnerSession(session)) return { success: false, error: 'لمالك النظام فقط' };  // ✅ تم التغيير

  try {
    var schoolId = _safeStr(params.schoolId);
    var days     = parseInt(params.days || 365);

    var sheet = _getMasterSheet('Schools');
    if (!sheet) return { success: false, error: 'ورقة المدارس غير موجودة' };

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][0]) === schoolId) {
        var newEnd = new Date();
        newEnd.setDate(newEnd.getDate() + days);
        var newEndStr = Utilities.formatDate(newEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd');

        sheet.getRange(i + 1, 10).setValue(newEndStr);
        sheet.getRange(i + 1, 11).setValue('TRUE');
        sheet.getRange(i + 1, 12).setValue('premium');

        SpreadsheetApp.flush();
        _logAudit(session.schoolId, session.name, 'RENEW_SUBSCRIPTION',
                  'Schools', schoolId + ' → ' + days + ' يوم حتى ' + newEndStr, '');

        return { success: true, newEnd: newEndStr, message: 'تم تجديد الاشتراك حتى ' + newEndStr };
      }
    }
    return { success: false, error: 'المدرسة غير موجودة' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
function checkSubscriptions() {
  Logger.log('checkSubscriptions: فحص الاشتراكات');
  var today = _todayString();
  var sheet = _getMasterSheet('Schools');
  if (!sheet) return;

  var data     = sheet.getDataRange().getValues();
  var expired  = 0;

  for (var i = 1; i < data.length; i++) {
    var endDate  = _safeStr(data[i][9]);
    var isActive = _safeStr(data[i][10]).toLowerCase();
    var name     = _safeStr(data[i][1]);

    if (isActive === 'true' && endDate && endDate < today) {
      sheet.getRange(i + 1, 11).setValue('FALSE');
      expired++;
      Logger.log('❌ انتهى اشتراك: ' + name + ' (كان ينتهي: ' + endDate + ')');
      _logAudit('system', 'System', 'SUBSCRIPTION_EXPIRED',
                'Schools', 'انتهى اشتراك: ' + name, endDate);
    }
  }

  if (expired > 0) SpreadsheetApp.flush();
  Logger.log('checkSubscriptions: ' + expired + ' مدرسة انتهى اشتراكها');
  return { ok: true, expired: expired };
}

function getAuditLogProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };

  try {
    var sheet = _getMasterSheet('Audit_Master');
    if (!sheet) return { success: true, logs: [] };
    var data  = sheet.getDataRange().getValues();
    var out   = [];
    var limit = parseInt(params.limit || 200);

    for (var i = data.length - 1; i >= 1 && out.length < limit; i--) {
      out.push({
        logId   : _safeStr(data[i][0]),
        timestamp: _safeStr(data[i][1]),
        schoolId : _safeStr(data[i][2]),
        userName : _safeStr(data[i][3]),
        action   : _safeStr(data[i][4]),
        module   : _safeStr(data[i][5]),
        details  : _safeStr(data[i][6]),
        ipInfo   : _safeStr(data[i][7])
      });
    }
    return { success: true, logs: out, total: out.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getSyncLogProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success: false, error: 'غير مصرح' };

  try {
    var sheet = _getMasterSheet('Sync_Log');
    if (!sheet) return { success: true, logs: [] };
    var data  = sheet.getDataRange().getValues();
    var out   = [];
    var limit = parseInt(params.limit || 50);

    for (var i = data.length - 1; i >= 1 && out.length < limit; i--) {
      out.push({
        syncId       : _safeStr(data[i][0]),
        timestamp    : _safeStr(data[i][1]),
        syncType     : _safeStr(data[i][2]),
        sourceFile   : _safeStr(data[i][3]),
        targetFile   : _safeStr(data[i][4]),
        recordsSynced: _safeStr(data[i][5]),
        status       : _safeStr(data[i][6]),
        errorMsg     : _safeStr(data[i][7])
      });
    }
    return { success: true, logs: out };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════
//  Triggers التلقائية
// ══════════════════════════════════════════════════════════════

function provisionNewSchool(params) {
  try {
    var d = params.schoolData || params;

    var schoolName  = _safeStr(d.schoolName  || d.name  || '');
    var adminName   = _safeStr(d.adminName   || '');
    var adminEmail  = _safeStr(d.adminEmail  || d.email || '');
    var adminPhone  = _safeStr(d.adminPhone  || d.phone || '');
    var adminPass   = _safeStr(d.adminPass   || d.password || '');
    var address     = _safeStr(d.address     || '');
    var planType    = _safeStr(d.planType    || 'trial');
    var inviteKey   = _safeStr(d.inviteKey   || '');
    var logoBase64  = _safeStr(d.logoBase64  || '');
    var logoMime    = _safeStr(d.logoMime    || 'image/png');
    var logoFName   = _safeStr(d.logoFileName|| 'logo.png');

    // ── التحقق ──
    if (!schoolName) return { success:false, error:'اسم المدرسة مطلوب' };
    if (!adminEmail) return { success:false, error:'البريد الإلكتروني مطلوب' };
    if (!adminPass || adminPass.length < 4) {
      return { success:false, error:'كلمة المرور يجب أن تكون 4 أحرف على الأقل' };
    }

    // ── بوابة الإنشاء (المرحلة 1 — أمان) ──
    // الإصلاح: يُفرَض مفتاح الدعوة إجبارياً متى كان مُعَدّاً (سدّ تجاوز حذف المفتاح من الطلب).
    // استثناء: جلسة مالك مُصادقة بتوكن صالح تتجاوز اشتراط المفتاح (إنشاء من لوحة المالك).
    var _provSession = validateMasterToken(_safeStr(d.token || (params && params.token) || ''));
    var validKey = getMasterSetting('invite_key') || '';
    if (!_isOwnerSession(_provSession)) {
      if (validKey) {
        if (!inviteKey || inviteKey !== validKey) {
          return { success:false, error:'مفتاح الدعوة مطلوب أو غير صحيح' };
        }
      }
    }

    // ── التحقق من عدم تكرار البريد ──
    var usersSheet = _getMasterSheet('Users_Master');
    if (usersSheet) {
      var uData = usersSheet.getDataRange().getValues();
      for (var ui = 1; ui < uData.length; ui++) {
        if (_safeStr(uData[ui][4]).toLowerCase() === adminEmail.toLowerCase()) {
          return { success:false, error:'هذا البريد الإلكتروني مسجل مسبقاً' };
        }
      }
    }

    Logger.log('provisionNewSchool: بدء إنشاء "' + schoolName + '"');
    var schoolId = _generateUUID();

    // ── الخطوة 1: إنشاء مجلد Drive للمدرسة ──
    var schoolFolder   = null;
    var schoolFolderId = '';
    var schoolFolderUrl = '';
    try {
      var parentFolder = SCHOOLS_DRIVE_FOLDER
        ? DriveApp.getFolderById(SCHOOLS_DRIVE_FOLDER)
        : DriveApp.getRootFolder();
      schoolFolder    = parentFolder.createFolder(schoolName + '_' + schoolId.substring(0,8));
      schoolFolderId  = schoolFolder.getId();
      schoolFolderUrl = schoolFolder.getUrl();
      Logger.log('✅ مجلد Drive: ' + schoolFolderId);
    } catch (fe) {
      Logger.log('⚠️ مجلد Drive: ' + fe.message);
    }

    // ── الخطوة 2: رفع الشعار ──
    var logoUrl = '';
    if (logoBase64 && logoBase64.length > 100 && schoolFolder) {
      try {
        logoUrl = _uploadLogoToDrive(logoBase64, logoFName, logoMime, schoolFolder);
        Logger.log('✅ شعار: ' + logoUrl);
      } catch (le) {
        Logger.log('⚠️ شعار: ' + le.message);
      }
    }

    // ── الخطوة 3: إنشاء ملفات الشيت (بدون ملف طالب منفصل) ──
    // ★ بعد التوحيد: لم نعد ننشئ ملف طالب منفصل.
    //   الطالب سيقرأ من ملف المعلمين مباشرة.
    var teacherFileId  = _createSchoolSheet('teacher',  schoolName, schoolFolder);
    var studentFileId  = '';  // لا شيء
    var cmsFileId      = _createSchoolSheet('cms',      schoolName, schoolFolder);
    var scheduleFileId = _createSchoolSheet('schedule', schoolName, schoolFolder);

    Logger.log('الملفات: T=' + teacherFileId + ' C=' + cmsFileId + ' Sch=' + scheduleFileId);

    // ── الخطوة 4: تهيئة بيانات كل ملف ──
    if (teacherFileId) {
      _setupTeacherFile(teacherFileId, schoolName, adminName, adminEmail, adminPass, logoUrl);
      // ضمان اكتمال كل أوراق النظام (الرسوم/التسديد/الجدول/المشاهدات/الإعجابات/سجل العمليات…)
      try { _repairSchoolFileStructure(teacherFileId); } catch (re) { Logger.log('repair بعد الإنشاء: ' + re.message); }
    }
    if (cmsFileId) {
      _setupCmsFile(cmsFileId, schoolName);
    }
    if (scheduleFileId) {
      _setupScheduleFile(scheduleFileId, schoolName);
    }

    // ★ بعد التوحيد: لا نحقن كود Apps Script في الملفات المنشأة.
    //   بدلاً من ذلك، نستخدم نموذج "الكود الواحد متعدد المستأجرين" (P1).
    //   المدرسة الجديدة ستستخدم نفس تطبيق الويب المنشور.
    Logger.log('تم تخطي حقن السكريبت — النظام يستخدم الكود الموحّد.');

    // ── الخطوة 6: التسجيل في Master ──
    var today      = _todayString();
    var trialDays  = parseInt(getMasterSetting('trial_days') || '30');
    var endDate    = new Date();
    endDate.setDate(endDate.getDate() + trialDays);
    var endDateStr = Utilities.formatDate(endDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    var schoolsSheet = _getOrCreateMasterSheet('Schools', [
      'school_id','school_name','admin_email','admin_password',
      'teacher_file_id','student_file_id','cms_file_id','schedule_file_id',
      'subscription_start','subscription_end','is_active','plan_type',
      'phone','address','logo_url','created_at','notes'
    ]);
    schoolsSheet.appendRow([
      schoolId, schoolName, adminEmail, adminPass,
      teacherFileId || '', studentFileId || '',
      cmsFileId     || '', scheduleFileId || '',
      today, endDateStr, 'TRUE', planType,
      adminPhone, address, logoUrl,
      _nowString(), 'تم الإنشاء تلقائياً'
    ]);

    // ── الخطوة 7: إضافة المستخدم في Users_Master ──
    var uSheet = _getOrCreateMasterSheet('Users_Master', [
      'user_id','school_id','role','name','email','password',
      'last_login','is_active','created_at','permissions'
    ]);
    uSheet.appendRow([
      _generateUUID(), schoolId, 'admin',
      adminName || 'مدير المدرسة',
      adminEmail, adminPass, '', 'TRUE', _nowString(), 'all'
    ]);

    SpreadsheetApp.flush();
    _logAudit('master', 'System', 'PROVISION_SCHOOL', 'Provisioning',
              'تم إنشاء: ' + schoolName, adminEmail);

    Logger.log('✅ اكتمل إنشاء: ' + schoolName);

    // ── روابط المنصات المُنشأة ──
    // ★ الروابط الثابتة (تستخدم كقيم افتراضية)
    var TEACHER_APP_URL  = 'https://script.google.com/macros/s/AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND/exec';
    var STUDENT_APP_URL  = 'https://script.google.com/macros/s/AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq/exec';
    var CMS_APP_URL      = 'https://script.google.com/macros/s/AKfycbz-iAj9L3ROOn4CAjmwkVBUqpWuxIx1LkgPLwKnHu7kHLWKCy3GVJNo1vZbnekop0VlMA/exec';
    var SCHEDULE_APP_URL = 'https://script.google.com/macros/s/AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag/exec';

    // ★ بناء روابط المنصات بصيغة ?school=<id> (من الإعدادات المخزنة)
    var portals = buildSchoolPortalLinks(schoolId);

    return {
      success       : true,
      schoolId      : schoolId,
      schoolName    : schoolName,
      adminEmail    : adminEmail,
      trialEnd      : endDateStr,
      folderId      : schoolFolderId,
      folderUrl     : schoolFolderUrl,
      logoUrl       : logoUrl,
      teacherFileId : teacherFileId  || '',
      studentFileId : studentFileId  || '',
      cmsFileId     : cmsFileId      || '',
      scheduleFileId: scheduleFileId || '',
      // روابط المنصات بصيغة ?school=<id> (من الإعدادات المخزنة — الأولوية)
      portalTeacher  : portals.teacher,
      portalStudent  : portals.student,
      portalCms      : portals.cms,
      portalSchedule : portals.schedule,
      // روابط افتراضية ثابتة (للتوافق الرجعي)
      teacherUrl    : teacherFileId  ? (TEACHER_APP_URL  + '?school=' + schoolId) : '',
      studentUrl    : teacherFileId  ? (STUDENT_APP_URL  + '?school=' + schoolId) : '',
      cmsUrl        : cmsFileId      ? (CMS_APP_URL      + '?school=' + schoolId) : '',
      scheduleUrl   : scheduleFileId ? (SCHEDULE_APP_URL + '?school=' + schoolId) : '',
      message       : 'تم إنشاء منظومة "' + schoolName + '" بنجاح'
    };
  } catch (e) {
    Logger.log('provisionNewSchool FATAL: ' + e.toString());
    _logAudit('master','System','PROVISION_ERROR','Provisioning',e.message,'');
    return { success:false, error:'خطأ في الإنشاء: ' + e.message };
  }
}
// ══════════════════════════════════════════════════════════════
//  إنشاء ملف شيت جديد فارغ (بدون نسخ)
// ══════════════════════════════════════════════════════════════
function _createSchoolSheet(type, schoolName, folder) {
  try {
    // ★ بعد التوحيد: لا ننشئ ملف طالب منفصل (الطالب يقرأ من ملف المعلم)
    if (type === 'student') {
      Logger.log('⚠️ إنشاء ملف طالب منفصل غير مدعوم بعد التوحيد — تم تجاهله');
      return '';
    }

    var names = {
      teacher : 'منصة_المعلمين — ' + schoolName,
      cms     : 'إدارة_المحتوى — ' + schoolName,
      schedule: 'إدارة_الحصص — '   + schoolName
    };
    var title = names[type] || (type + ' — ' + schoolName);

    // ✅ الإنشاء عبر الخدمة القياسية (لا تتطلب تفعيل Advanced Sheets Service)
    var newSS  = SpreadsheetApp.create(title);
    var fileId = newSS.getId();

    // نقل الملف إلى مجلد المدرسة ومشاركته للقراءة بالرابط
    if (fileId) {
      try {
        var file = DriveApp.getFileById(fileId);
        if (folder) {
          folder.addFile(file);
          DriveApp.getRootFolder().removeFile(file);
        }
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (me) {
        Logger.log('نقل/مشاركة الملف: ' + me.message);
      }
    }

    Logger.log('✅ شيت جديد (' + type + '): ' + fileId);
    return fileId;
  } catch (e) {
    Logger.log('_createSchoolSheet error (' + type + '): ' + e.toString());
    return '';
  }
}

// ══════════════════════════════════════════════════════════════
//  تهيئة ملف المعلمين — هيكل كامل
// ══════════════════════════════════════════════════════════════
function _setupTeacherFile(fileId, schoolName, adminName, adminEmail, adminPass, logoUrl) {
  try {
    var ss = _getSSById(fileId);
    var defaultSheet = ss.getSheets()[0];

    // ── ورقة المدرسين ──
    var tSheet = ss.insertSheet('المدرسين');
    tSheet.getRange(1, 1, 1, 5).setValues([[
      'اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'كلمة المرور'
    ]]);
    _styleHeader(tSheet, 5);
    tSheet.appendRow([adminName || 'المدير', 'المدير', 'المدير', 'المدير', adminPass]);

    // ── ورقة الطلاب ──
    // ✅ تمت إضافة عمود "كلمة المرور"
    var sSheet = ss.insertSheet('الطلاب');
    sSheet.getRange(1, 1, 1, 8).setValues([[
      'الكود', 'الاسم', 'الفصل', 'الشعبة',
      'اجمالي الرسوم', 'المبالغ المسدده', 'رقم الجوال', 'كلمة المرور'
    ]]);
    _styleHeader(sSheet, 8);

    // ── ورقة الدرجات ──
    var gSheet = ss.insertSheet('الدرجات');
    gSheet.getRange(1, 1).setValue('الشهر');
    gSheet.getRange(2, 1).setValue('المادة');
    gSheet.getRange(3, 1, 1, 4).setValues([['الكود', 'الاسم', 'الفصل', 'الشعبة']]);
    _styleHeader(gSheet, 4, 3);

    // ── ورقة الواجبات ──
    var hwSheet = ss.insertSheet('الواجبات');
    hwSheet.getRange(1, 1, 1, 7).setValues([[
      'رقم الحركة', 'اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'الواجب', 'التاريخ'
    ]]);
    _styleHeader(hwSheet, 7);

    // ── ورقة الاخبار ──
    var nSheet = ss.insertSheet('الاخبار');
    nSheet.getRange(1, 1, 1, 7).setValues([[
      'رقم الخبر', 'اسم المدرس', 'الفصل', 'الشعبة', 'الخبر', 'الملحقات', 'التاريخ'
    ]]);
    _styleHeader(nSheet, 7);

    // ── ورقة المخالفات ──
    var vSheet = ss.insertSheet('المخالفات');
    vSheet.getRange(1, 1, 1, 8).setValues([[
      'الكود', 'الاسم', 'الفصل', 'الشعبة', 'المخالفة', 'المدرس', 'التاريخ', 'الرد'
    ]]);
    _styleHeader(vSheet, 8);

    // ── ورقة الملاحظات ──
    var noteSheet = ss.insertSheet('الملاحظات');
    noteSheet.getRange(1, 1, 1, 7).setValues([[
      'الاسم', 'الفصل', 'الشعبة', 'اسم المدرس', 'الرسالة', 'التاريخ', 'الرد'
    ]]);
    _styleHeader(noteSheet, 7);

    // ── ورقة الغياب ──
    var attSheet = ss.insertSheet('الغياب');
    attSheet.getRange(1, 1, 1, 9).setValues([[
      'الكود', 'اسم الطالب', 'الفصل', 'الشعبة',
      'التاريخ', 'الحالة', 'رقم الجوال', 'المسجّل', 'وقت التسجيل'
    ]]);
    _styleHeader(attSheet, 9);

    // ── ورقة القوائم ──
    var listSheet = ss.insertSheet('القوائم');
    listSheet.getRange(1, 1, 1, 6).setValues([[
      'الفصول', '', 'المواد', 'الشعب', '', 'المخالفات'
    ]]);
    _styleHeader(listSheet, 6);

    var defaultData = [
      ['KG1', '', 'قران كريم', 'أ', '', 'غياب بدون عذر'],
      ['KG2', '', 'تربية اسلامية', 'ب', '', 'تأخر عن الدوام'],
      ['الأول', '', 'اللغة العربية', 'ج', '', 'إهمال الواجبات'],
      ['الثاني', '', 'اللغة الانجليزية', 'د', '', 'عدم الالتزام بالزي'],
      ['الثالث', '', 'الرياضيات', '', '', 'سلوك غير لائق'],
      ['الرابع', '', 'العلوم', '', '', 'استخدام الجوال'],
      ['الخامس', '', 'الاجتماعيات', '', '', 'إزعاج الفصل'],
      ['السادس', '', 'الفيزياء', '', '', ''],
      ['السابع', '', 'الكيمياء', '', '', ''],
      ['الثامن', '', 'الاحياء', '', '', ''],
      ['التاسع', '', 'الجغرافيا', '', '', ''],
      ['الأول ثانوي', '', 'التاريخ', '', '', ''],
      ['الثاني ثانوي', '', 'المجتمع', '', '', ''],
      ['الثالث ثانوي', '', '', '', '', '']
    ];
    listSheet.getRange(2, 1, defaultData.length, 6).setValues(defaultData);

    // ── ورقة الاعدادات ──
    var settSheet = ss.insertSheet('الاعدادات');
    settSheet.getRange(1, 1, 1, 2).setValues([['نسبة الحجب (%)', 'الاستثناءات']]);
    settSheet.getRange(2, 1).setValue(0);
    _styleHeader(settSheet, 2);

    // ── ورقة تقرير التدقيق ──
    var auditSheet = ss.insertSheet('تقرير التدقيق');
    auditSheet.getRange(1, 1, 1, 2).setValues([['بند', 'التفاصيل']]);
    auditSheet.appendRow(['اسم المدرسة', schoolName]);
    auditSheet.appendRow(['تاريخ الإنشاء', _nowString()]);
    auditSheet.appendRow(['البريد الإلكتروني', adminEmail]);
    if (logoUrl) auditSheet.appendRow(['رابط الشعار', logoUrl]);

    // ── ورقة النصفي ──
    var termSheet = ss.insertSheet('النصفي');
    termSheet.getRange(1, 1).setValue('الشهر');
    termSheet.getRange(2, 1).setValue('المادة');
    termSheet.getRange(3, 1, 1, 4).setValues([['الكود', 'الاسم', 'الفصل', 'الشعبة']]);
    _styleHeader(termSheet, 4, 3);

    // حذف الورقة الافتراضية
    try { ss.deleteSheet(defaultSheet); } catch (de) {}

    SpreadsheetApp.flush();
    Logger.log('✅ تم تهيئة ملف المعلمين: ' + fileId);
  } catch (e) {
    Logger.log('_setupTeacherFile error: ' + e.toString());
  }
}


// =====================================================
//  دوال إصلاح المدارس القديمة
// =====================================================

function repairAllSchools() {
  try {
    var fileIds = _discoverSchoolFileIdsFromMaster_();
    var repaired = 0;

    fileIds.forEach(function(fileId) {
      try {
        _repairSchoolFileStructure(fileId);
        repaired++;
      } catch (e) {
        Logger.log('repairAllSchools: failed for ' + fileId + ' => ' + e.toString());
      }
    });

    Logger.log('✅ repairAllSchools finished. Repaired = ' + repaired);
  } catch (e) {
    Logger.log('repairAllSchools error: ' + e.toString());
  }
}


function _repairSchoolFileStructure(fileId) {
  var ss = _getSSById(fileId);

  // ── المدرسون ──
  _ensureSheet_(ss, 'المدرسين', [
    'اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'كلمة المرور'
  ], 5);

  // ── الطلاب ──
  // إصلاح حرج: إضافة "كلمة المرور" إن كانت المدرسة القديمة بدونها
  _ensureSheet_(ss, 'الطلاب', [
    'الكود', 'الاسم', 'الفصل', 'الشعبة',
    'اجمالي الرسوم', 'المبالغ المسدده', 'رقم الجوال', 'كلمة المرور'
  ], 8);

  // ── الدرجات ──
  _ensureTwoRowTitleSheet_(ss, 'الدرجات', 'الشهر', 'المادة', [
    'الكود', 'الاسم', 'الفصل', 'الشعبة'
  ], 4);

  // ── الواجبات ──
  _ensureSheet_(ss, 'الواجبات', [
    'رقم الحركة', 'اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'الواجب', 'التاريخ'
  ], 7);

  // ── الاخبار ──
  _ensureSheet_(ss, 'الاخبار', [
    'رقم الخبر', 'اسم المدرس', 'الفصل', 'الشعبة', 'الخبر', 'الملحقات', 'التاريخ'
  ], 7);

  // ── المخالفات ──
  _ensureSheet_(ss, 'المخالفات', [
    'الكود', 'الاسم', 'الفصل', 'الشعبة', 'المخالفة', 'المدرس', 'التاريخ', 'الرد'
  ], 8);

  // ── الملاحظات ──
  _ensureSheet_(ss, 'الملاحظات', [
    'الاسم', 'الفصل', 'الشعبة', 'اسم المدرس', 'الرسالة', 'التاريخ', 'الرد'
  ], 7);

  // ── الغياب ──
  _ensureSheet_(ss, 'الغياب', [
    'الكود', 'اسم الطالب', 'الفصل', 'الشعبة',
    'التاريخ', 'الحالة', 'رقم الجوال', 'المسجّل', 'وقت التسجيل'
  ], 9);

  // ── القوائم ──
  var listSheet = _ensureSheet_(ss, 'القوائم', [
    'الفصول', '', 'المواد', 'الشعب', '', 'المخالفات'
  ], 6);

  if (listSheet.getLastRow() < 2) {
    var defaultData = [
      ['KG1', '', 'قران كريم', 'أ', '', 'غياب بدون عذر'],
      ['KG2', '', 'تربية اسلامية', 'ب', '', 'تأخر عن الدوام'],
      ['الأول', '', 'اللغة العربية', 'ج', '', 'إهمال الواجبات'],
      ['الثاني', '', 'اللغة الانجليزية', 'د', '', 'عدم الالتزام بالزي'],
      ['الثالث', '', 'الرياضيات', '', '', 'سلوك غير لائق'],
      ['الرابع', '', 'العلوم', '', '', 'استخدام الجوال'],
      ['الخامس', '', 'الاجتماعيات', '', '', 'إزعاج الفصل'],
      ['السادس', '', 'الفيزياء', '', '', ''],
      ['السابع', '', 'الكيمياء', '', '', ''],
      ['الثامن', '', 'الاحياء', '', '', ''],
      ['التاسع', '', 'الجغرافيا', '', '', ''],
      ['الأول ثانوي', '', 'التاريخ', '', '', ''],
      ['الثاني ثانوي', '', 'المجتمع', '', '', ''],
      ['الثالث ثانوي', '', '', '', '', '']
    ];
    listSheet.getRange(2, 1, defaultData.length, 6).setValues(defaultData);
  }

  // ── الاعدادات ──
  _ensureSheet_(ss, 'الاعدادات', [
    'نسبة الحجب (%)', 'الاستثناءات'
  ], 2);
  var settSheet = ss.getSheetByName('الاعدادات');
  if (settSheet.getRange(2, 1).isBlank()) settSheet.getRange(2, 1).setValue(0);

  // ── تقرير التدقيق ──
  _ensureSheet_(ss, 'تقرير التدقيق', ['بند', 'التفاصيل'], 2);

  // ── النصفي ──
  _ensureTwoRowTitleSheet_(ss, 'النصفي', 'الشهر', 'المادة', [
    'الكود', 'الاسم', 'الفصل', 'الشعبة'
  ], 4);

  // ── الرسوم ──
  _ensureSheet_(ss, 'الرسوم', [
    'الكود', 'اسم الطالب', 'اجمالي الرسوم', 'المسدد'
  ], 4);

  // ── التسديد ──
  _ensureSheet_(ss, 'التسديد', [
    'الكود', 'اسم الطالب', 'المبلغ', 'التاريخ', 'الوسيط', 'رقم الحوالة'
  ], 6);

  // ── الجدول ──
  _ensureSheet_(ss, 'الجدول', [
    'الفصل', 'الشعبة', 'اليوم', 'الحصة', 'المادة', 'المعلم', 'القاعة'
  ], 7);

  // ── سلبيات ومميزات الطالب ──
  _ensureSheet_(ss, 'سلبيات ومميزات الطالب', [
    'الكود', 'الاسم', 'الفصل', 'الشعبة', 'المخالفة', 'المدرس', 'التاريخ', 'الرد'
  ], 8);

  // ── مشاهدات الأخبار ──
  _ensureSheet_(ss, 'اخبار_مشاهدات', [
    'newsId', 'userId', 'userType', 'timestamp'
  ], 4);

  // ── إعجابات الأخبار ──
  _ensureSheet_(ss, 'اخبار_اعجابات', [
    'newsId', 'userId', 'userName', 'userType', 'timestamp'
  ], 5);

  // ── سجل العمليات ──
  _ensureSheet_(ss, 'سجل_العمليات', [
    'التاريخ', 'كود الطالب', 'العملية', 'التفاصيل', 'حالة النظام'
  ], 5);

  // ── غياب المعلمين ──
  _ensureSheet_(ss, 'غياب_المعلمين', [
    'اسم المدرس', 'الفصل', 'الشعبة', 'المادة', 'اليوم', 'الحصة',
    'النوع', 'نوع الغياب', 'المسجّل', 'التاريخ', 'ملاحظات'
  ], 11);

  SpreadsheetApp.flush();
  Logger.log('✅ تم إصلاح بنية المدرسة: ' + fileId);
}


function _ensureSheet_(ss, sheetName, headers, styleCols, headerRow) {
  headerRow = headerRow || 1;
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  var requiredCols = headers.length;
  var maxCols = sheet.getMaxColumns();
  if (maxCols < requiredCols) {
    sheet.insertColumnsAfter(maxCols, requiredCols - maxCols);
  }

  sheet.getRange(headerRow, 1, 1, requiredCols).setValues([headers]);
  if (typeof _styleHeader === 'function') {
    _styleHeader(sheet, styleCols || requiredCols, headerRow);
  }

  return sheet;
}


function _ensureTwoRowTitleSheet_(ss, sheetName, title1, title2, headers, styleCols) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  var requiredCols = headers.length;
  var maxCols = sheet.getMaxColumns();
  if (maxCols < requiredCols) {
    sheet.insertColumnsAfter(maxCols, requiredCols - maxCols);
  }

  sheet.getRange(1, 1).setValue(title1);
  sheet.getRange(2, 1).setValue(title2);
  sheet.getRange(3, 1, 1, requiredCols).setValues([headers]);

  if (typeof _styleHeader === 'function') {
    _styleHeader(sheet, styleCols || requiredCols, 3);
  }

  return sheet;
}

function _discoverSchoolFileIdsFromMaster_() {
  var ids = [];

  try {
    // ✅ استخدام ورقة Schools مباشرة بدلاً من مسح جميع الخلايا
    var sheet = _getMasterSheet('Schools');
    if (!sheet) return ids;

    var data = sheet.getDataRange().getValues();
    
    // ✅ استخدام حلقة for عادية (متوافقة مع ES5) بدلاً من forEach
    for (var i = 1; i < data.length; i++) {
      var fid = _safeStr(data[i][4]); // العمود 4 = teacher_file_id
      if (fid && ids.indexOf(fid) === -1) {
        ids.push(fid);
      }
    }
  } catch (e) {
    Logger.log('_discoverSchoolFileIdsFromMaster_ error: ' + e.toString());
  }

  return ids;
}
// ══════════════════════════════════════════════════════════════
//  تهيئة ملف الطالب
// ══════════════════════════════════════════════════════════════
function _setupStudentFile(fileId, adminName) {
  try {
    var ss = _getSSById(fileId);
    var defaultSheet = ss.getSheets()[0];

    // الطلاب
    var sSheet = ss.insertSheet('الطلاب');
    sSheet.getRange(1,1,1,5).setValues([[
      'الكود','الاسم','الفصل','الشعبة','كلمة المرور'
    ]]);
    _styleHeader(sSheet, 5);

    // الدرجات
    var gSheet = ss.insertSheet('الدرجات');
    gSheet.getRange(1,1).setValue('الشهر');
    gSheet.getRange(2,1).setValue('المادة');
    gSheet.getRange(3,1,1,4).setValues([['الكود','الاسم','الفصل','الشعبة']]);
    _styleHeader(gSheet, 4, 3);

    // الرسوم
    var fSheet = ss.insertSheet('الرسوم');
    fSheet.getRange(1,1,1,4).setValues([['الكود','اسم الطالب','اجمالي الرسوم','المسدد']]);
    _styleHeader(fSheet, 4);

    // التسديد
    var pSheet = ss.insertSheet('التسديد');
    pSheet.getRange(1,1,1,6).setValues([[
      'الكود','اسم الطالب','المبلغ','التاريخ','الوسيط','رقم الحوالة'
    ]]);
    _styleHeader(pSheet, 6);

    // الجدول
    var jSheet = ss.insertSheet('الجدول');
    jSheet.getRange(1,1,1,7).setValues([[
      'الفصل','الشعبة','اليوم','الحصة','المادة','المعلم','القاعة'
    ]]);
    _styleHeader(jSheet, 7);

    // الاخبار
    var nSheet = ss.insertSheet('الاخبار');
    nSheet.getRange(1,1,1,7).setValues([[
      'رقم الخبر','اسم المدرس','الفصل','الشعبة','الخبر','الملحقات','التاريخ'
    ]]);
    _styleHeader(nSheet, 7);

    // الواجبات
    var hwSheet = ss.insertSheet('الواجبات');
    hwSheet.getRange(1,1,1,7).setValues([[
      'رقم الحركة','اسم المدرس','المادة','الفصل','الشعبة','الواجب','التاريخ'
    ]]);
    _styleHeader(hwSheet, 7);

    // الملاحظات
    var noteSheet = ss.insertSheet('الملاحظات');
    noteSheet.getRange(1,1,1,7).setValues([[
      'الاسم','الفصل','الشعبة','اسم المدرس','الرسالة','التاريخ','الرد'
    ]]);
    _styleHeader(noteSheet, 7);

    // سلبيات ومميزات الطالب
    var vSheet = ss.insertSheet('سلبيات ومميزات الطالب');
    vSheet.getRange(1,1,1,8).setValues([[
      'الكود','الاسم','الفصل','الشعبة','المخالفة','المدرس','التاريخ','الرد'
    ]]);
    _styleHeader(vSheet, 8);

    // الاعدادات
    var settSheet = ss.insertSheet('الاعدادات');
    settSheet.getRange(1,1,1,2).setValues([['نسبة الحجب (%)','الاستثناءات']]);
    settSheet.getRange(2,1).setValue(0);
    _styleHeader(settSheet, 2);

    // المدرسين (مرجع للتكامل)
    var tchSheet = ss.insertSheet('المدرسين');
    tchSheet.getRange(1,1,1,5).setValues([[
      'اسم المدرس','المادة','الفصل','الشعبة','كلمة المرور'
    ]]);
    _styleHeader(tchSheet, 5);

    try { ss.deleteSheet(defaultSheet); } catch(de) {}
    SpreadsheetApp.flush();
    Logger.log('✅ تم تهيئة ملف الطالب: ' + fileId);
  } catch (e) {
    Logger.log('_setupStudentFile error: ' + e.toString());
  }
}

// ══════════════════════════════════════════════════════════════
//  تهيئة ملف CMS
// ══════════════════════════════════════════════════════════════
function _setupCmsFile(fileId, schoolName) {
  try {
    var ss = _getSSById(fileId);
    var defaultSheet = ss.getSheets()[0];

    // News
    var nSheet = ss.insertSheet('News');
    nSheet.getRange(1,1,1,8).setValues([[
      'Timestamp','Title','Content','MediaType','MediaURL','UserEmail','UserName','Action'
    ]]);
    _styleHeader(nSheet, 8, 1, '#1a237e');

    // Videos
    var vSheet = ss.insertSheet('Videos');
    vSheet.getRange(1,1,1,7).setValues([[
      'Timestamp','Title','Description','VideoURL','UserEmail','UserName','Action'
    ]]);
    _styleHeader(vSheet, 7, 1, '#1a237e');

    // Images
    var iSheet = ss.insertSheet('Images');
    iSheet.getRange(1,1,1,7).setValues([[
      'Timestamp','Name','Description','ImageURL','UserEmail','UserName','Action'
    ]]);
    _styleHeader(iSheet, 7, 1, '#1a237e');

    // Schedule
    var schSheet = ss.insertSheet('Schedule');
    schSheet.getRange(1,1,1,10).setValues([[
      'Timestamp','Platform','PostType','Content','MediaURL',
      'ScheduledDate','Status','UserEmail','UserName','Action'
    ]]);
    _styleHeader(schSheet, 10, 1, '#1a237e');

    // AuditLog
    var aSheet = ss.insertSheet('AuditLog');
    aSheet.getRange(1,1,1,10).setValues([[
      'LogID','Timestamp','UserEmail','UserName','Action',
      'Details','IPAddress','UserAgent','SheetName','RecordID'
    ]]);
    _styleHeader(aSheet, 10, 1, '#1a237e');

    // Users
    var uSheet = ss.insertSheet('Users');
    uSheet.getRange(1,1,1,6).setValues([[
      'FirstSeen','Email','DisplayName','Role','LastActive','TotalActions'
    ]]);
    _styleHeader(uSheet, 6, 1, '#1a237e');

    // PostTypes
    var ptSheet = ss.insertSheet('PostTypes');
    ptSheet.getRange(1,1,1,3).setValues([['Platform','PostType','Description']]);
    _styleHeader(ptSheet, 3, 1, '#1a237e');
    var postTypesData = [
      ['فيسبوك','منشور','منشور نصي أو مع صورة'],
      ['فيسبوك','فيديو','فيديو'],
      ['فيسبوك','ريلز','ريلز قصير'],
      ['انستغرام','منشور','صورة أو كاروسيل'],
      ['انستغرام','ريلز','فيديو قصير'],
      ['انستغرام','ستوري','قصة'],
      ['يوتيوب','فيديو','فيديو كامل'],
      ['يوتيوب','شورت','فيديو قصير'],
      ['تيك توك','فيديو','فيديو قصير']
    ];
    ptSheet.getRange(2,1,postTypesData.length,3).setValues(postTypesData);

    // إضافة ورقة بيانات المدرسة
    var infoSheet = ss.insertSheet('SchoolInfo');
    infoSheet.getRange(1,1,1,2).setValues([['المفتاح','القيمة']]);
    _styleHeader(infoSheet, 2, 1, '#1a237e');
    infoSheet.getRange(2,1,3,2).setValues([
      ['school_name', schoolName],
      ['created_at', _nowString()],
      ['drive_folder', SCHOOLS_DRIVE_FOLDER]
    ]);

    try { ss.deleteSheet(defaultSheet); } catch(de) {}
    SpreadsheetApp.flush();
    Logger.log('✅ تم تهيئة ملف CMS: ' + fileId);
  } catch (e) {
    Logger.log('_setupCmsFile error: ' + e.toString());
  }
}

// ══════════════════════════════════════════════════════════════
//  تهيئة ملف الحصص
// ══════════════════════════════════════════════════════════════
function _setupScheduleFile(fileId, schoolName) {
  try {
    var ss = _getSSById(fileId);
    var defaultSheet = ss.getSheets()[0];

    // الجدول (شبكة 5 أيام × 7 حصص)
    var days    = ['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء'];
    var periods = [1,2,3,4,5,6,7];

    // رأس الجدول
    var headerRow = ['اسماء المدرسين'];
    for (var di = 0; di < days.length; di++) {
      for (var pi = 0; pi < periods.length; pi++) {
        headerRow.push(days[di] + ' - حصة ' + periods[pi]);
      }
    }

    var schedSheet = ss.insertSheet('الجدول');
    schedSheet.getRange(1,1,1,headerRow.length).setValues([headerRow]);
    _styleHeader(schedSheet, headerRow.length);

    // ورقة الفصول
    var classSheet = ss.insertSheet('الفصول');
    var classHeader = ['اسماء الفصول'];
    for (var di2 = 0; di2 < days.length; di2++) {
      for (var pi2 = 0; pi2 < periods.length; pi2++) {
        classHeader.push(days[di2] + ' - حصة ' + periods[pi2]);
      }
    }
    classSheet.getRange(1,1,1,classHeader.length).setValues([classHeader]);
    _styleHeader(classSheet, classHeader.length);

    // ورقة المدرسين (للحصص)
    var tchSheet = ss.insertSheet('المدرسين');
    tchSheet.getRange(1,1,1,8).setValues([[
      'اسم المدرس','المادة','الفصل','عدد الحصص في الاسبوع','','','المادة','الفصل'
    ]]);
    _styleHeader(tchSheet, 8);

    try { ss.deleteSheet(defaultSheet); } catch(de) {}
    SpreadsheetApp.flush();
    Logger.log('✅ تم تهيئة ملف الحصص: ' + fileId);
  } catch (e) {
    Logger.log('_setupScheduleFile error: ' + e.toString());
  }
}

// ══════════════════════════════════════════════════════════════
//  حقن كود Apps Script في الملف (عبر Drive API)
// ══════════════════════════════════════════════════════════════
function _injectScript(fileId, type, schoolName) {
  try {
    // الكود الأساسي لكل منصة
    var scriptContent = _getScriptTemplate(type, schoolName);

    // استخدام Drive API v3 لإنشاء Script Project مرتبط بالشيت
    var metadata = {
      name: schoolName + ' — ' + type,
      mimeType: 'application/vnd.google-apps.script+json'
    };

    // بناء محتوى الـ Script Project
    var projectContent = {
      files: [
        {
          name: 'Code',
          type: 'SERVER_JS',
          source: scriptContent
        },
        {
          name: 'appsscript',
          type: 'JSON',
          source: JSON.stringify({
            timeZone: 'Asia/Aden',
            dependencies: {},
            exceptionLogging: 'STACKDRIVER',
            runtimeVersion: 'V8',
            webapp: {
              executeAs: 'USER_DEPLOYING',
              access: 'ANYONE_ANONYMOUS'
            }
          })
        }
      ]
    };

    // إنشاء Script Project مرتبط بالشيت
    var url = 'https://script.googleapis.com/v1/projects';
    var options = {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        title: schoolName + ' — Script',
        parentId: fileId
      }),
      muteHttpExceptions: true
    };

    var response  = UrlFetchApp.fetch(url, options);
    var respCode  = response.getResponseCode();
    var respBody  = response.getContentText();

    if (respCode !== 200) {
      Logger.log('_injectScript (' + type + ') HTTP ' + respCode + ': ' + respBody);
      // Fallback: حفظ الكود في ورقة خاصة
      _saveScriptInSheet(fileId, type, scriptContent);
      return;
    }

    var project = JSON.parse(respBody);
    var scriptId = project.scriptId;

    // رفع محتوى الكود
    var uploadUrl = 'https://script.googleapis.com/v1/projects/' + scriptId + '/content';
    var uploadOpts = {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(projectContent),
      muteHttpExceptions: true
    };

    var upResp = UrlFetchApp.fetch(uploadUrl, uploadOpts);
    Logger.log('_injectScript (' + type + '): ' + upResp.getResponseCode());

  } catch (e) {
    Logger.log('_injectScript error (' + type + '): ' + e.message);
    // Fallback: حفظ الكود في ورقة داخل الشيت
    try { _saveScriptInSheet(fileId, type, _getScriptTemplate(type, schoolName)); } catch(fe) {}
  }
}

// Fallback: حفظ الكود كنص في ورقة داخل الشيت (للمراجعة اليدوية)
function _saveScriptInSheet(fileId, type, code) {
  try {
    var ss     = _getSSById(fileId);
    var shName = 'كود_Apps_Script';
    var sh     = ss.getSheetByName(shName);
    if (!sh) sh = ss.insertSheet(shName);
    sh.clearContents();
    sh.getRange(1,1).setValue('// انسخ هذا الكود إلى Apps Script للتفعيل');
    sh.getRange(2,1).setValue(code);
    sh.getRange(2,1).setWrap(true);
    Logger.log('تم حفظ كود ' + type + ' في ورقة: ' + fileId);
  } catch (e) {
    Logger.log('_saveScriptInSheet error: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  قوالب الكود لكل منصة
// ══════════════════════════════════════════════════════════════
function _getScriptTemplate(type, schoolName) {
  var teacherFileId  = ''; // سيُحدَّث لاحقاً
  var studentFileId  = '';

  if (type === 'teacher') {
    return '// منصة المعلمين — ' + schoolName + '\n' +
           '// تاريخ الإنشاء: ' + _nowString() + '\n' +
           '// ═══════════════════════════════════════════\n' +
           '// انسخ TeacherCore.gs و TeacherAuth.gs هنا\n' +
           '// ثم أضف Teacher_Dashboard.html\n' +
           '// ═══════════════════════════════════════════\n\n' +
           'var SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();\n' +
           'var DRIVE_FOLDER_ID = "";\n\n' +
           'function doGet(e) {\n' +
           '  return HtmlService.createHtmlOutputFromFile("Teacher_Dashboard")\n' +
           '    .setTitle("منصة المعلمين — ' + schoolName + '")\n' +
           '    .addMetaTag("viewport","width=device-width,initial-scale=1");\n' +
           '}\n\n' +
           'function ping() { return {ok:true,school:"' + schoolName + '"}; }\n';
  }

  if (type === 'student') {
    return '// منصة الطلاب — ' + schoolName + '\n' +
           '// تاريخ الإنشاء: ' + _nowString() + '\n' +
           '// ═══════════════════════════════════════════\n' +
           '// انسخ StudentLogic.gs هنا\n' +
           '// ثم أضف Student_Portal.html\n' +
           '// ═══════════════════════════════════════════\n\n' +
           'var SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();\n\n' +
           'function doGet(e) {\n' +
           '  return HtmlService.createHtmlOutputFromFile("Student_Portal")\n' +
           '    .setTitle("منصة الطلاب — ' + schoolName + '")\n' +
           '    .addMetaTag("viewport","width=device-width,initial-scale=1");\n' +
           '}\n\n' +
           'function ping() { return {ok:true,school:"' + schoolName + '"}; }\n';
  }

  if (type === 'cms') {
    return '// نظام إدارة المحتوى — ' + schoolName + '\n' +
           '// تاريخ الإنشاء: ' + _nowString() + '\n' +
           '// ═══════════════════════════════════════════\n' +
           '// انسخ CMS.gs هنا\n' +
           '// ثم أضف Dashboard.html, AddForm.html, ViewContent.html\n' +
           '// ═══════════════════════════════════════════\n\n' +
           'var SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();\n' +
           'var MAIN_FOLDER_ID = "";\n\n' +
           'function doGet(e) {\n' +
           '  var page = e.parameter.page;\n' +
           '  if (page === "add") return HtmlService.createHtmlOutputFromFile("AddForm");\n' +
           '  if (page === "view") return HtmlService.createHtmlOutputFromFile("ViewContent");\n' +
           '  if (page === "audit") return HtmlService.createHtmlOutputFromFile("AuditLog");\n' +
           '  return HtmlService.createHtmlOutputFromFile("Dashboard")\n' +
           '    .setTitle("CMS — ' + schoolName + '")\n' +
           '    .addMetaTag("viewport","width=device-width,initial-scale=1");\n' +
           '}\n\n' +
           'function ping() { return {ok:true,school:"' + schoolName + '"}; }\n';
  }

  if (type === 'schedule') {
    return '// إدارة الحصص — ' + schoolName + '\n' +
           '// تاريخ الإنشاء: ' + _nowString() + '\n' +
           '// ═══════════════════════════════════════════\n' +
           '// انسخ TeacherSchedule.gs و Schedule.gs هنا\n' +
           '// ثم أضف TeacherScheduleManager.html\n' +
           '// ═══════════════════════════════════════════\n\n' +
           'var SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();\n\n' +
           'function doGet(e) {\n' +
           '  return HtmlService.createHtmlOutputFromFile("TeacherScheduleManager")\n' +
           '    .setTitle("إدارة الحصص — ' + schoolName + '")\n' +
           '    .addMetaTag("viewport","width=device-width,initial-scale=1");\n' +
           '}\n\n' +
           'function ping() { return {ok:true,school:"' + schoolName + '"}; }\n';
  }

  return '// ' + type + ' — ' + schoolName;
}

// ══════════════════════════════════════════════════════════════
//  تنسيق صف الرأس
// ══════════════════════════════════════════════════════════════
function _styleHeader(sheet, colCount, rowNum, bgColor) {
  try {
    var r   = rowNum  || 1;
    var bg  = bgColor || '#1a237e';
    var rng = sheet.getRange(r, 1, 1, colCount);
    rng.setBackground(bg)
       .setFontColor('#ffffff')
       .setFontWeight('bold')
       .setHorizontalAlignment('center');
    sheet.setFrozenRows(r);
  } catch (e) {}
}

// ══════════════════════════════════════════════════════════════
//  رفع الشعار
// ══════════════════════════════════════════════════════════════
function _uploadLogoToDrive(base64Data, fileName, mimeType, folder) {
  try {
    if (!base64Data || base64Data.length < 100) return '';
    if (!mimeType)  mimeType  = 'image/png';
    if (!fileName)  fileName  = 'logo_' + new Date().getTime() + '.png';

    var cleanB64 = base64Data.indexOf('base64,') !== -1
      ? base64Data.split('base64,')[1]
      : base64Data;

    var decoded = Utilities.base64Decode(cleanB64);
    var blob    = Utilities.newBlob(decoded, mimeType, fileName);
    var target  = folder || DriveApp.getRootFolder();
    var file    = target.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();
    return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';
  } catch (e) {
    Logger.log('_uploadLogoToDrive error: ' + e.message);
    return '';
  }
}

// ══════════════════════════════════════════════════════════════
//  دوال مساعدة للإنشاء
// ══════════════════════════════════════════════════════════════

/**
 * نسخ ملف شيت قالب وحفظه في مجلد المدرسة
 */
function _copyTemplateFile(templateId, newName, folder) {
  try {
    var file    = DriveApp.getFileById(templateId);
    var newFile = file.makeCopy(newName, folder || DriveApp.getRootFolder());
    // جعل الملف قابلاً للقراءة لمن لديه الرابط
    newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    Logger.log('نسخ: ' + newName + ' → ' + newFile.getId());
    return newFile.getId();
  } catch (e) {
    Logger.log('_copyTemplateFile error (' + newName + '): ' + e.message);
    return '';
  }
}

/**
 * تنظيف ملف المعلمين: مسح بيانات القالب وإضافة بيانات المدرسة الجديدة
 */
function _cleanSchoolFile(fileId, schoolName, adminName, adminEmail, adminPass) {
  try {
    var ss = _getSSById(fileId);

    // ── ورقة المدرسين: مسح الكل وإضافة مدير جديد ──
    var teacherSheet = ss.getSheetByName('المدرسين');
    if (teacherSheet) {
      teacherSheet.clearContents();
      teacherSheet.getRange(1, 1, 1, 5).setValues([[
        'اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'كلمة المرور'
      ]]);
      teacherSheet.appendRow([adminName, 'المدير', 'المدير', 'المدير', adminPass]);
    }

    // ── ورقة الطلاب: مسح البيانات والاحتفاظ بالرأس ──
    var studSheet = ss.getSheetByName('الطلاب');
    if (studSheet) {
      var lastRow = studSheet.getLastRow();
      if (lastRow > 1) studSheet.deleteRows(2, lastRow - 1);
    }

    // ── ورقة الدرجات: مسح البيانات (الاحتفاظ بالرأس 3 صفوف) ──
    var gradesSheet = ss.getSheetByName('الدرجات');
    if (gradesSheet) {
      var glr = gradesSheet.getLastRow();
      if (glr > 3) gradesSheet.deleteRows(4, glr - 3);
    }

    // ── ورقة الواجبات: مسح ──
    var hwSheet = ss.getSheetByName('الواجبات');
    if (hwSheet) {
      var hlr = hwSheet.getLastRow();
      if (hlr > 1) hwSheet.deleteRows(2, hlr - 1);
    }

    // ── ورقة الاخبار: مسح ──
    var newsSheet = ss.getSheetByName('الاخبار');
    if (newsSheet) {
      var nlr = newsSheet.getLastRow();
      if (nlr > 1) newsSheet.deleteRows(2, nlr - 1);
    }

    // ── ورقة المخالفات: مسح ──
    var vioSheet = ss.getSheetByName('المخالفات');
    if (vioSheet) {
      var vlr = vioSheet.getLastRow();
      if (vlr > 1) vioSheet.deleteRows(2, vlr - 1);
    }

    // ── ورقة الملاحظات: مسح ──
    var noteSheet = ss.getSheetByName('الملاحظات');
    if (noteSheet) {
      var nolr = noteSheet.getLastRow();
      if (nolr > 1) noteSheet.deleteRows(2, nolr - 1);
    }

    // ── ورقة الغياب: إنشاء إذا لم تكن موجودة ──
    var attSheet = ss.getSheetByName('الغياب');
    if (!attSheet) {
      attSheet = ss.insertSheet('الغياب');
      attSheet.getRange(1, 1, 1, 9).setValues([[
        'الكود','اسم الطالب','الفصل','الشعبة',
        'التاريخ','الحالة','رقم الجوال','المسجّل','وقت التسجيل'
      ]]);
    } else {
      var alr = attSheet.getLastRow();
      if (alr > 1) attSheet.deleteRows(2, alr - 1);
    }

    // ── ورقة القوائم: إبقاء الرأس فقط ──
    var listsSheet = ss.getSheetByName('القوائم');
    if (listsSheet) {
      var llr = listsSheet.getLastRow();
      if (llr > 1) listsSheet.deleteRows(2, llr - 1);
      // إضافة مخالفات افتراضية
      listsSheet.appendRow(['', '', '', '', '', 'تأخر عن الدوام']);
      listsSheet.appendRow(['', '', '', '', '', 'غياب بدون عذر']);
      listsSheet.appendRow(['', '', '', '', '', 'إهمال الواجبات']);
      listsSheet.appendRow(['', '', '', '', '', 'عدم الالتزام بالزي']);
    }

    SpreadsheetApp.flush();
    Logger.log('✅ تم تنظيف ملف المعلمين: ' + fileId);
  } catch (e) {
    Logger.log('_cleanSchoolFile error: ' + e.message);
  }
}

/**
 * تنظيف ملف الطالب
 */
function _cleanStudentFile(fileId, adminPass) {
  try {
    var ss = _getSSById(fileId);

    // مسح بيانات الطلاب مع الاحتفاظ بالرأس
    var sheetsToClean = [
      'الطلاب', 'الرسوم', 'التسديد', 'الجدول',
      'الاخبار', 'الواجبات', 'الملاحظات', 'سلبيات ومميزات الطالب'
    ];

    for (var i = 0; i < sheetsToClean.length; i++) {
      var sheet = ss.getSheetByName(sheetsToClean[i]);
      if (sheet) {
        var lr = sheet.getLastRow();
        if (lr > 1) sheet.deleteRows(2, lr - 1);
      }
    }

    // ورقة الدرجات: الاحتفاظ بـ 3 صفوف رأس
    var gradesSheet = ss.getSheetByName('الدرجات');
    if (gradesSheet) {
      var glr = gradesSheet.getLastRow();
      if (glr > 3) gradesSheet.deleteRows(4, glr - 3);
    }

    // ورقة الاعدادات: إعادة تعيين نسبة الحجب إلى 0
    var settSheet = ss.getSheetByName('الاعدادات');
    if (settSheet) {
      settSheet.clearContents();
      settSheet.getRange(1, 1, 1, 2).setValues([['نسبة الحجب (%)', 'الاستثناءات']]);
      settSheet.getRange(2, 1).setValue(0);
    }

    // ورقة المدرسين: مسح (لا تحتاج بيانات في ملف الطالب)
    var tchSheet = ss.getSheetByName('المدرسين');
    if (tchSheet) {
      var tlr = tchSheet.getLastRow();
      if (tlr > 1) tchSheet.deleteRows(2, tlr - 1);
    }

    SpreadsheetApp.flush();
    Logger.log('✅ تم تنظيف ملف الطالب: ' + fileId);
  } catch (e) {
    Logger.log('_cleanStudentFile error: ' + e.message);
  }
}

/**
 * تنظيف ملف CMS
 */
function _cleanCmsFile(fileId, schoolName) {
  try {
    var ss = _getSSById(fileId);
    var sheetsToClean = ['News', 'Videos', 'Images', 'Schedule', 'AuditLog', 'Users'];

    for (var i = 0; i < sheetsToClean.length; i++) {
      var sheet = ss.getSheetByName(sheetsToClean[i]);
      if (sheet) {
        var lr = sheet.getLastRow();
        if (lr > 1) sheet.deleteRows(2, lr - 1);
      }
    }

    SpreadsheetApp.flush();
    Logger.log('✅ تم تنظيف ملف CMS: ' + fileId);
  } catch (e) {
    Logger.log('_cleanCmsFile error: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  معلومات المدرسة المُنشأة (لعرضها بعد التسجيل)
// ══════════════════════════════════════════════════════════════

function getSchoolProvisioningStatus(params) {
  var schoolId = _safeStr(params.schoolId);
  if (!schoolId) return { success: false, error: 'معرّف المدرسة مطلوب' };

  try {
    var sheet = _getMasterSheet('Schools');
    if (!sheet) return { success: false, error: 'ورقة المدارس غير موجودة' };

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][0]) === schoolId) {
        var tId = _safeStr(data[i][4]);
        var sId = _safeStr(data[i][5]);
        var cId = _safeStr(data[i][6]);
        var schId = _safeStr(data[i][7]);
        return {
          success       : true,
          schoolId      : schoolId,
          schoolName    : _safeStr(data[i][1]),
          adminEmail    : _safeStr(data[i][2]),
          subscriptionEnd: _safeStr(data[i][9]),
          isActive      : _safeStr(data[i][10]),
          teacherFileId : tId,
          studentFileId : sId,
          cmsFileId     : cId,
          scheduleFileId: schId,
          teacherUrl    : tId   ? 'https://docs.google.com/spreadsheets/d/' + tId   : '',
          studentUrl    : sId   ? 'https://docs.google.com/spreadsheets/d/' + sId   : '',
          cmsUrl        : cId   ? 'https://docs.google.com/spreadsheets/d/' + cId   : '',
          scheduleUrl   : schId ? 'https://docs.google.com/spreadsheets/d/' + schId : ''
        };
      }
    }
    return { success: false, error: 'المدرسة غير موجودة' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * صفحة التسجيل العامة (doGet بمعامل ?page=register)
 */
function doGet(e) {
  try {
    var page = (e && e.parameter && e.parameter.page)
               ? e.parameter.page.toString().trim()
               : '';
    if (page === 'register') {
      return HtmlService.createHtmlOutputFromFile('SchoolRegister')
        .setTitle('تسجيل مدرسة جديدة — مدارس الإبداع والتميز')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }
    return HtmlService.createHtmlOutputFromFile('MasterAdmin')
      .setTitle('Master Admin — مدارس الإبداع والتميز الدولية')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<h2 style="color:red;font-family:Arial;direction:rtl;">خطأ: ' +
      err.message + '</h2>'
    );
  }
}
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
/**
 * تُرجع رابط النشر الحالي لتطبيق Master Admin
 * يستخدمها التنقل من الصفحات المختلفة
 */
function getMasterAppUrl() {
  return ScriptApp.getService().getUrl();
}
// ══════════════════════════════════════════════════════════════
//  دوال مساعدة إضافية للـ Master Admin
// ══════════════════════════════════════════════════════════════

/**
 * إضافة مفتاح دعوة للتسجيل المقيّد
 */
function setInviteKeyProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!_isOwnerSession(session)) return { success: false, error: 'لمالك النظام فقط' };  // ✅ تم التغيير

  return saveMasterSettingProtected({
    token: params.token,
    key  : 'invite_key',
    value: _safeStr(params.key)
  });
}

/**
 * حذف مدرسة مع ملفاتها (تحذير: لا يُعاد)
 */
function deleteSchoolProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!_isOwnerSession(session)) return { success: false, error: 'لمالك النظام فقط' };  // ✅ تم التغيير بالكامل

  if (!params.confirm || params.confirm !== 'DELETE') {
    return { success: false, error: 'أرسل confirm:"DELETE" للتأكيد' };
  }

  var schoolId = _safeStr(params.schoolId);
  try {
    var sheet = _getMasterSheet('Schools');
    if (!sheet) return { success: false, error: 'ورقة المدارس غير موجودة' };

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][0]) === schoolId) {
        sheet.getRange(i + 1, 11).setValue('FALSE');
        SpreadsheetApp.flush();
        _logAudit(session.schoolId, session.name, 'DELETE_SCHOOL',
                  'Schools', 'تم تعطيل: ' + _safeStr(data[i][1]), schoolId);
        return { success: true, message: 'تم تعطيل المدرسة. الملفات محفوظة في Drive.' };
      }
    }
    return { success: false, error: 'المدرسة غير موجودة' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
/**
 * تبني روابط المنصات بصيغة ?school=<id>
 * تقرأ روابط النشر من ورقة Settings_Master (تُضبط مرة واحدة)
 */
function buildSchoolPortalLinks(schoolId) {
  var teacherBase  = getMasterSetting('url_teacher')  || '';
  var studentBase  = getMasterSetting('url_student')  || '';
  var cmsBase      = getMasterSetting('url_cms')       || '';
  var scheduleBase = getMasterSetting('url_schedule')  || '';
  var sep = '?school=' + encodeURIComponent(schoolId);
  return {
    teacher  : teacherBase  ? teacherBase  + sep : '',
    student  : studentBase  ? studentBase  + sep : '',
    cms      : cmsBase      ? cmsBase      + sep : '',
    schedule : scheduleBase ? scheduleBase + sep : ''
  };
}

/**
 * setupMasterTriggers — إنشاء/تجديد التريغرات المجدولة لمشروع المالك.
 * يُستدعى من لوحة النظام (الزر system_setupTriggers في MasterAdmin.html).
 * يحذف التريغرات القديمة لهذه الدوال (منع التكرار) ثم يُنشئ تريغرات يومية:
 *   - checkSubscriptions (~2 ص): تعطيل المدارس منتهية الاشتراك
 *   - masterSyncAll      (~3 ص): مزامنة البيانات بين المالك والطلاب
 *   - collectAllStats    (~4 ص): تجميع إحصاءات كل المدارس
 * يُعيد { ok, message } كما تتوقّع الواجهة.
 */
function setupMasterTriggers() {
  try {
    var WANTED = ['checkSubscriptions', 'masterSyncAll', 'collectAllStats'];
    var existing = ScriptApp.getProjectTriggers();
    var removed = 0;
    for (var i = 0; i < existing.length; i++) {
      var fn = existing[i].getHandlerFunction();
      for (var j = 0; j < WANTED.length; j++) {
        if (fn === WANTED[j]) { ScriptApp.deleteTrigger(existing[i]); removed++; break; }
      }
    }
    ScriptApp.newTrigger('checkSubscriptions').timeBased().everyDays(1).atHour(2).create();
    ScriptApp.newTrigger('masterSyncAll').timeBased().everyDays(1).atHour(3).create();
    ScriptApp.newTrigger('collectAllStats').timeBased().everyDays(1).atHour(4).create();
    return { ok: true, message: 'تم إنشاء 3 تريغرات يومية (الاشتراكات + المزامنة + الإحصاءات). حُذف ' + removed + ' تريغر قديم.' };
  } catch (err) {
    return { ok: false, message: 'فشل إنشاء التريغرات: ' + ((err && err.message) || err) };
  }
}
