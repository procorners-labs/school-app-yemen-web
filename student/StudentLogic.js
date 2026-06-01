// ============================================================
// منصة الطلاب - مدارس الإبداع والتميز الدولية
// StudentLogic.gs - النسخة النهائية الشاملة (مُصحَّحة من التكرار)
// ============================================================

// ✅ التوحيد: ملف المعلمين أصبح الملف الوحيد للمنظومة بأكملها
var SPREADSHEET_ID = '1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM';
var MASTER_ID      = '1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM';
var CACHE_TTL = 180;

// ══════════════════════════════════════════════════════
// طبقة كاش ذكية مع TTL مختلفة حسب نوع البيانات
// ══════════════════════════════════════════════════════
var CACHE_CONFIG = {
  GRADES     : 300,   // 5 دقائق — تتغير بالمزامنة اليومية
  FEES       : 120,   // دقيقتان — بيانات مالية شبه ثابتة
  NEWS       : 180,   // 3 دقائق — الأخبار تتجدد نادراً
  HOMEWORK   : 180,   // 3 دقائق
  SCHEDULE   : 600,   // 10 دقائق — الجدول ثابت طوال الأسبوع
  VIOLATIONS : 60,    // دقيقة — تحديث فوري بعد المزامنة
  LISTS      : 600,   // 10 دقائق — ثابتة
  STUDENTS   : 300    // 5 دقائق
};

// ══════════════════════════════════════════════════════
// نظام Rate Limiting لتسجيل دخول الطلاب (جديد)
// ══════════════════════════════════════════════════════
var STU_MAX_LOGIN_ATTEMPTS = 5;
var STU_RATE_LIMIT_TTL = 900; // 15 دقيقة

function _stu_rateLimitKey(clientId) {
  return 'stu_ratelimit_' + clientId;
}

function _stu_isRateLimited(clientId) {
  try {
    var attempts = parseInt(
      CacheService.getScriptCache().get(_stu_rateLimitKey(clientId)) || '0'
    );
    return attempts >= STU_MAX_LOGIN_ATTEMPTS;
  } catch (e) { return false; }
}

function _stu_recordFailedAttempt(clientId) {
  try {
    var cache = CacheService.getScriptCache();
    var key = _stu_rateLimitKey(clientId);
    var attempts = parseInt(cache.get(key) || '0') + 1;
    cache.put(key, String(attempts), STU_RATE_LIMIT_TTL);
  } catch (e) {}
}

function _stu_clearFailedAttempts(clientId) {
  try { CacheService.getScriptCache().remove(_stu_rateLimitKey(clientId)); } catch (e) {}
}

// ══════════════════════════════════════════════════════
// نظام هاش كلمات المرور — SHA-256 مع Salt (جديد)
// ══════════════════════════════════════════════════════
var PASSWORD_HASH_PREFIX = 'h1$';

function _generateSalt() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 16);
}

function _hashPassword(password, salt) {
  try {
    if (!salt) salt = _generateSalt();
    var input = salt + '::' + password + '::SchoolAppYemen2026';
    var rawHash = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8
    );
    var hex = '';
    for (var i = 0; i < rawHash.length; i++) {
      var b = rawHash[i];
      if (b < 0) b += 256;
      var h = b.toString(16);
      hex += (h.length === 1 ? '0' : '') + h;
    }
    return PASSWORD_HASH_PREFIX + salt + '$' + hex;
  } catch (e) {
    Logger.log('_hashPassword error: ' + e.message);
    return '';
  }
}

function _verifyPassword(plainPassword, storedPassword) {
  if (!storedPassword) return false;
  if (String(storedPassword).indexOf(PASSWORD_HASH_PREFIX) === 0) {
    var parts = String(storedPassword).substring(PASSWORD_HASH_PREFIX.length).split('$');
    if (parts.length !== 2) return false;
    var salt = parts[0];
    var freshHash = _hashPassword(plainPassword, salt);
    return freshHash === storedPassword;
  }
  return String(storedPassword).trim() === String(plainPassword).trim();
}

function _migratePasswordIfNeeded(sheet, rowIndex, colIndex, plainPassword) {
  try {
    var cellValue = sheet.getRange(rowIndex, colIndex).getValue();
    if (String(cellValue).indexOf(PASSWORD_HASH_PREFIX) === 0) return;
    var salt = _generateSalt();
    var hashed = _hashPassword(plainPassword, salt);
    sheet.getRange(rowIndex, colIndex).setValue(hashed);
    Logger.log('تمت ترقية كلمة مرور الصف: ' + rowIndex);
  } catch (e) {
    Logger.log('_migratePasswordIfNeeded error: ' + e.message);
  }
}

// فتح SS مرة واحدة وتخزينه في متغير محلي خلال نطاق الطلب
var _ssInstance = null;
function _getSS() {
  if (!_ssInstance) {
    try {
      _ssInstance = _getSSById(_activeFileId());
    } catch (e) {
      throw new Error('لا يمكن الوصول إلى ملف البيانات: ' + e.message);
    }
  }
  return _ssInstance;
}

function _getSheet(name) {
  try {
    var sheet = _getSS().getSheetByName(name);
    if (!sheet) console.warn('الشيت "' + name + '" غير موجود');
    return sheet;
  } catch (e) {
    console.error('_getSheet error:', e.message);
    return null;
  }
}

// ============================================================
// نقطة الدخول
// ============================================================
function doGet(e) {
  var schoolId = (e && e.parameter && e.parameter.school)
                 ? e.parameter.school.toString().trim() : '';
  var t = HtmlService.createTemplateFromFile('Student Portal');
  t.schoolId = schoolId;
  return t.evaluate()
    .setTitle('Student Dashboard — مدارس الإبداع والتميز الدولية')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// أدوات مساعدة
// ============================================================
function _nowString() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function _safe(v) {
  return (v === null || v === undefined) ? '' : v.toString().trim();
}
function _safeStr(val) {
  if (val === null || val === undefined) return '';
  return val.toString().trim();
}

function _resolveTenant(arg) {
  var sid = '';
  if (arg && typeof arg === 'object') {
    sid = _safe(arg.schoolId || arg.school || '');
  } else {
    sid = _safe(arg);
  }
  _setActiveTenant(sid);
  return sid;
}

function _ck(name, suffix) {
  return name + '_' + _activeFileId() + '_' + _safe(suffix);
}
// ══════════════════════════════════════════════════════════════
// دوال مساعدة أساسية – Spreadsheet Cache (P-OPT-03)
// ══════════════════════════════════════════════════════════════

/**
 * فتح Spreadsheet بواسطة المعرف مع كاش داخلي لكل تنفيذ
 * يمنع فتح نفس الملف مرات متعددة في نفس الاستدعاء
 * @param {string} id  معرف ملف Google Sheets
 * @return {Spreadsheet}
 */
var __SS_CACHE = {};
function _getSSById(id) {
  if (!id) throw new Error('_getSSById: معرف الملف فارغ');
  var key = String(id);
  if (__SS_CACHE[key]) return __SS_CACHE[key];
  try {
    var ss = SpreadsheetApp.openById(key);
    __SS_CACHE[key] = ss;
    return ss;
  } catch (e) {
    throw new Error('_getSSById: تعذّر فتح الملف "' + key + '" — ' + e.message);
  }
}

/**
 * إفراغ الكاش (للاستخدام في نهاية المهام الطويلة إن لزم)
 */
function _clearSSCache() {
  __SS_CACHE = {};
}
// ════════════════════════════════════════════════════════════════
// 🔧 DriveUrlUtils — منسوخة من DriveUrlUtils.gs
// مطلوبة في _processAttachmentUrl ودوال أخرى
// ════════════════════════════════════════════════════════════════
function extractDriveFileId(url) {
  if (!url) return null;
  url = String(url);
  var match = url.match(/\/file\/d\/([a-zA-Z0-9_\-]+)/);
  if (match && match[1]) return match[1];
  match = url.match(/\/d\/([a-zA-Z0-9_\-]+)/);
  if (match && match[1]) return match[1];
  match = url.match(/[?&]id=([a-zA-Z0-9_\-]+)/);
  if (match && match[1]) return match[1];
  match = url.match(/open\?id=([a-zA-Z0-9_\-]+)/);
  if (match && match[1]) return match[1];
  match = url.match(/thumbnail\?id=([a-zA-Z0-9_\-]+)/);
  if (match && match[1]) return match[1];
  return null;
}

function normalizeGoogleDriveUrl(url, size) {
  if (!url) return '';
  size = size || 1000;
  var fileId = extractDriveFileId(url);
  if (!fileId) return url;
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w' + size;
}

function extractYouTubeId(url) {
  if (!url) return null;
  url = String(url);
  var patterns = [
    /youtu\.be\/([a-zA-Z0-9_\-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_\-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_\-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_\-]{11})/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = url.match(patterns[i]);
    if (m && m[1]) return m[1];
  }
  return null;
}

function classifyVideoUrl(url) {
  if (!url) return { type: 'unknown', embedUrl: '' };
  var lower = String(url).toLowerCase();
  if (lower.indexOf('youtube.com') !== -1 || lower.indexOf('youtu.be') !== -1) {
    var ytId = extractYouTubeId(url);
    return {
      type: 'youtube',
      embedUrl: ytId ? ('https://www.youtube-nocookie.com/embed/' + ytId) : url
    };
  }
  if (lower.indexOf('facebook.com') !== -1 || lower.indexOf('fb.watch') !== -1) {
    return { type: 'facebook', embedUrl: url };
  }
  if (lower.indexOf('instagram.com') !== -1) {
    return { type: 'instagram', embedUrl: url };
  }
  if (/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i.test(lower)) {
    return { type: 'direct', embedUrl: url };
  }
  return { type: 'link', embedUrl: url };
}

function _safeFloat(v, def) {
  var n = parseFloat(v);
  return isNaN(n) ? (def || 0) : n;
}

// ============================================================
// كاش
// ============================================================
function _cacheGet(key) {
  try {
    var r = CacheService.getScriptCache().get(key);
    return r ? JSON.parse(r) : null;
  } catch (e) { return null; }
}

function _cacheSet(key, data, ttl) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(data), ttl || CACHE_TTL);
  } catch (e) { console.warn('cache set error:', e.message); }
}

function _cacheDel(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) {}
}

function clearStudentCache(studentId) {
  var keys = ['grades_' + studentId, 'fin_' + studentId, 'viol_' + studentId];
  for (var i = 0; i < keys.length; i++) _cacheDel(keys[i]);
  Logger.log('مُسح كاش الطالب: ' + studentId);
}

// ============================================================
// تسجيل الدخول (نسخة آمنة: Rate Limiting + هاش تدريجي)
// ============================================================
function loginStudent(username, password, clientId, schoolId) {
  try {
    clientId = _safe(clientId || 'unknown');
    schoolId = _safe(schoolId || '');
    _setActiveTenant(schoolId);

    if (_stu_isRateLimited(clientId)) {
      Logger.log('STU RATE LIMITED: clientId=' + clientId);
      return { ok: false, error: 'تم تجاوز عدد المحاولات. يرجى الانتظار 15 دقيقة.', rateLimited: true };
    }

    username = _safe(username).toLowerCase();
    password = _safe(password);
    if (!username || !password) {
      _stu_recordFailedAttempt(clientId);
      return { ok: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' };
    }

    // ---- دخول المدير ----
    if (username === 'admin' || username === 'المدير') {
      var ts = _getSheet('المدرسين');
      if (!ts) { _stu_recordFailedAttempt(clientId); return { ok: false, error: 'شيت "المدرسين" غير موجود' }; }
      var tdata = ts.getDataRange().getDisplayValues();
      var tCols = _resolveStudentColumns(tdata[0], 'teacher');
      for (var ti = 1; ti < tdata.length; ti++) {
        if (_safe(tdata[ti][0]) === 'المدير') {
          if (_verifyPassword(password, _safe(tdata[ti][tCols.pass]))) {
            _stu_clearFailedAttempts(clientId);
            _migratePasswordIfNeeded(ts, ti + 1, tCols.pass + 1, password);
                        return {
              ok: true, role: 'admin',
              name: 'مدير النظام', firstName: 'المدير',
              studentId: 'ADMIN',
              schoolId: schoolId           // ← أضف هذا
            };
          }
          _stu_recordFailedAttempt(clientId);
          return { ok: false, error: 'كلمة المرور غير صحيحة' };
        }
      }
      _stu_recordFailedAttempt(clientId);
      return { ok: false, error: 'بيانات المدير غير موجودة' };
    }

    // ---- دخول الطلاب ----
    var sheet = _getSheet('الطلاب');
    if (!sheet) { _stu_recordFailedAttempt(clientId); return { ok: false, error: 'شيت "الطلاب" غير موجود' }; }

    var data = sheet.getDataRange().getDisplayValues();
    var cols = _resolveStudentColumns(data[0], 'student');
    if (cols.pass === -1) {
      return { ok: false, error: 'عمود "كلمة المرور" غير موجود في ورقة الطلاب — شغّل migrateStudentPasswordsToMaster' };
    }

    var uNorm = username.replace(/\s+/g, '');

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var fullName = _safe(row[cols.name]);
      if (!fullName || fullName === 'الاسم') continue;

      var storedPass = _safe(row[cols.pass]);
      var sid        = _safe(row[cols.code]);
      var firstWord  = fullName.split(/\s+/)[0].toLowerCase().replace(/\s+/g, '');
      var byCode = sid.toLowerCase() === uNorm;
      var byName = firstWord === uNorm;

      if ((byCode || byName) && _verifyPassword(password, storedPass)) {
        _migratePasswordIfNeeded(sheet, i + 1, cols.pass + 1, password);

        var blk = getStudentBlockStatus(sid);
        if (blk.isBlocked) {
          _stu_clearFailedAttempts(clientId);
          return { ok: false, blocked: true, error: blk.message, blockPercentage: blk.percentage };
        }

        _stu_clearFailedAttempts(clientId);
                return {
          ok: true, role: 'student',
          name: fullName, firstName: fullName.split(/\s+/)[0],
          studentId: sid, rowIndex: i + 1,
          class: _safe(row[cols.grade]), section: _safe(row[cols.section]),
          schoolId: schoolId           // ← أضف هذا
        };
      }
    }

    _stu_recordFailedAttempt(clientId);
    return { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
  } catch (e) {
    console.error('loginStudent error:', e);
    return { ok: false, error: 'خطأ داخلي: ' + e.message };
  }
}

// ── دالة مساعدة جديدة: تحديد مواضع الأعمدة بالاسم (ديناميكي وآمن) ──
function _resolveStudentColumns(headerRow, mode) {
  var cols = { code: 0, name: 1, grade: 2, section: 3, pass: -1 };
  for (var c = 0; c < headerRow.length; c++) {
    var h = _safe(headerRow[c]);
    if (h === 'الكود' || h === 'كود الطالب') cols.code = c;
    else if (h === 'الاسم') cols.name = c;
    else if (h === 'الفصل') cols.grade = c;
    else if (h === 'الشعبة') cols.section = c;
    else if (h === 'كلمة المرور' || h === 'كلمة السر') cols.pass = c;
  }
  return cols;
}
// ============================================================
// فحص الحجب المالي
// ============================================================
function getStudentBlockStatus(studentId) {
  try {
    var settingsSheet = _getSheet('الاعدادات');
    var blockPercentage = 0;
    var exceptions = [];

    if (settingsSheet) {
      var settingsData = settingsSheet.getDataRange().getValues();
      if (settingsData.length > 1) {
        blockPercentage = _safeFloat(settingsData[1][0], 0);
        for (var i = 1; i < settingsData.length; i++) {
          var exceptionCode = _safeStr(settingsData[i][1]);
          if (exceptionCode) exceptions.push(exceptionCode);
        }
      }
    }

    if (blockPercentage <= 0) {
      console.warn('الحجب المالي معطل. لتفعيله، املأ الخلية A2 في ورقة "الاعدادات" بنسبة مئوية (مثلاً 20).');
    }

    if (exceptions.indexOf(studentId) !== -1) {
      return { isBlocked: false, reason: 'مستثنى' };
    }

    if (blockPercentage <= 0) {
      return { isBlocked: false };
    }

    // ✅ استدعاء الدالة المالية مع تمرير schoolId الحالي
    var financialData = getStudentFinancialData({ studentId: studentId, schoolId: _activeFileId() });
    if (!financialData || !financialData.ok || financialData.totalFees <= 0) {
      return { isBlocked: false };
    }

    var paymentRatio = (financialData.totalPaid / financialData.totalFees) * 100;

    if (paymentRatio <= blockPercentage) {
      return {
        isBlocked         : true,
        percentage        : paymentRatio.toFixed(1),
        requiredPercentage: blockPercentage,
        message           : 'تم تعليق حسابك بسبب انخفاض نسبة التسديد (' +
                            paymentRatio.toFixed(1) + '%). الحد الأدنى المطلوب هو ' +
                            blockPercentage + '%. يرجى مراجعة الإدارة المالية.'
      };
    }

    return { isBlocked: false };
  } catch (e) {
    console.error('getStudentBlockStatus error:', e);
    return { isBlocked: false };
  }
}
function syncFeesFromMaster() {
  return { ok: true, merged: true, note: 'موحّد — لا حاجة للمزامنة' };
}

// ============================================================
// تغيير كلمة المرور (مُحدَّثة: هاش + تحقق من القوة)
// ============================================================
function _validatePasswordStrength(password) {
  var p = _safe(password);
  if (p.length < 6) return { ok: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' };
  if (p.length > 30) return { ok: false, error: 'كلمة المرور طويلة جداً (30 حرفاً كحد أقصى)' };
  var hasLetter = /[a-zA-Z\u0621-\u064A]/.test(p);
  var hasNumber = /\d/.test(p);
  if (!hasLetter || !hasNumber) {
    return { ok: false, error: 'يجب أن تحتوي كلمة المرور على حروف وأرقام' };
  }
  var weak = ['123456', '12345678', '111111', '000000', 'password', 'admin', 'student',
              '123456789', '111222', '654321', 'iloveyou', '123123', 'school', 'qwerty', 'abc123'];
  for (var i = 0; i < weak.length; i++) {
    if (p.toLowerCase() === weak[i]) return { ok: false, error: 'كلمة المرور ضعيفة جداً' };
  }
  return { ok: true };
}
function changePassword(studentId, currentPassword, newPassword) {
  try {
    currentPassword = _safe(currentPassword);
    newPassword = _safe(newPassword);
    if (!currentPassword || !newPassword) return { ok: false, error: 'جميع الحقول مطلوبة' };

    var pwdCheck = _validatePasswordStrength(newPassword);
    if (!pwdCheck.ok) return pwdCheck;

    if (currentPassword === newPassword) return { ok: false, error: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' };

    var sheet = _getSheet('الطلاب');
    if (!sheet) return { ok: false, error: 'شيت "الطلاب" غير موجود' };
    
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { ok: false, error: 'لا يوجد طلاب في الشيت' };

    var headers = data[0];
    var passCol = -1;
    for (var h = 0; h < headers.length; h++) {
      var hdr = _safe(headers[h]);
      if (hdr === 'كلمة المرور' || hdr === 'كلمة السر') {
        passCol = h;
        break;
      }
    }
    
    if (passCol === -1) {
      passCol = 4;
      Logger.log('تحذير: عمود كلمة المرور غير موجود في ورقة الطلاب، تم استخدام العمود 5 افتراضياً');
    }

    var sidStr = studentId.toString().trim();

    for (var i = 1; i < data.length; i++) {
      if (_safe(data[i][0]) === sidStr) {
        var stored = _safe(data[i][passCol]);
        if (!_verifyPassword(currentPassword, stored)) {
          return { ok: false, error: 'كلمة المرور الحالية غير صحيحة' };
        }
        var salt = _generateSalt();
        var hashed = _hashPassword(newPassword, salt);
        sheet.getRange(i + 1, passCol + 1).setValue(hashed);

        // ✅ كاش معزول
        _cacheDel(_ck('grades', sidStr));
        console.log('تم تغيير كلمة مرور الطالب: ' + sidStr + ' في ' + _nowString());
        return { ok: true, message: 'تم تغيير كلمة المرور بنجاح' };
      }
    }
    return { ok: false, error: 'لم يتم العثور على الطالب' };
  } catch (e) {
    console.error('changePassword error:', e);
    return { ok: false, error: 'خطأ أثناء تغيير كلمة المرور: ' + e.message };
  }
}
function getGrades_OLD(studentId, schoolId) {
  try {
    _setActiveTenant(_safe(schoolId || ''));   // ✅ عزل المدرسة
    var sid = _safe(studentId);
    if (!sid) return { ok: false, error: 'كود الطالب مفقود' };

    var cKey   = _ck('grades', sid);           // ✅ كاش معزول لكل مدرسة
    var cached = _cacheGet(cKey);
    if (cached) return cached;

    // ★ المصدر: ورقة "النصفي" في ملف المدرسة النشط
    var activeId = _activeFileId();
    var sheet = _getSSById(activeId).getSheetByName('النصفي');
    if (!sheet) return { ok: false, error: 'ورقة "النصفي" غير موجودة في ملف المعلمين' };

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 4 || lastCol < 4) {
      return { ok: false, error: 'بيانات الدرجات غير مكتملة' };
    }

    var headers = sheet.getRange(1, 1, 3, lastCol).getValues();

    var sidStr = sid;
    var codeCol = sheet.getRange(4, 1, lastRow - 3, 1).getValues();
    var studentRowNum = -1;
    for (var r = 0; r < codeCol.length; r++) {
      if (_safe(codeCol[r][0]) === sidStr) {
        studentRowNum = r + 4;
        break;
      }
    }
    if (studentRowNum === -1) {
      return { ok: false, error: 'لم يتم العثور على درجات للطالب بالكود: ' + sid };
    }

    var studentRow = sheet.getRange(studentRowNum, 1, 1, lastCol).getValues()[0];

    var studentInfo = {
      id      : sidStr,
      name    : _safe(studentRow[1]),
      class   : _safe(studentRow[2]),
      section : _safe(studentRow[3])
    };

    if (!studentInfo.name) {
      return { ok: false, error: 'بيانات الطالب غير مكتملة في ورقة الدرجات' };
    }

    var h1 = headers[0];
    var h2 = headers[1];
    var h3 = headers[2];
    var months = _analyzeMonths(h1, lastCol);
    if (months.length === 0) {
      return { ok: false, error: 'لم يتم العثور على أشهر دراسية في الشيت' };
    }

    var subjects   = getSubjectsByClass(studentInfo.class);
    var monthsData = [];
    for (var mi = 0; mi < months.length; mi++) {
      var mData = _processMonthWithH1(months[mi], h1, h2, h3, studentRow, subjects);
      if (mData && mData.subjects.length > 0) monthsData.push(mData);
    }

    if (monthsData.length === 0) {
      return { ok: false, error: 'لا توجد درجات مسجلة بعد لهذا الطالب' };
    }

    var result = {
      ok               : true,
      student          : studentInfo,
      months           : monthsData,
      requiredSubjects : subjects,
      generatedAt      : _nowString()
    };

    // ⭐ v3 + v3.1: تزيين البيانات + إثراء معلومات القفل
    if (typeof GS_V3_FLAG !== 'undefined' && GS_V3_FLAG && result && result.months) {
      var decoratedMonths = [];
      for (var dmi = 0; dmi < result.months.length; dmi++) {
        decoratedMonths.push(GS_decorateMonth(result.months[dmi]));
      }
      result.months = decoratedMonths;
      result.v3Applied = true;

      for (var lmi = 0; lmi < result.months.length; lmi++) {
        var monthObj = result.months[lmi];
        if (typeof GS_getLockedFields === 'function') {
          monthObj.lockedFields = GS_getLockedFields(monthObj.name);
        }
        if (monthObj.subjects) {
          for (var lsi = 0; lsi < monthObj.subjects.length; lsi++) {
            var grades = monthObj.subjects[lsi].grades || [];
            for (var lgi = 0; lgi < grades.length; lgi++) {
              if (typeof GS_isFieldLocked === 'function') {
                grades[lgi].locked = GS_isFieldLocked(monthObj.name, grades[lgi].key) || grades[lgi].locked;
              }
            }
          }
        }
      }
    }

    _cacheSet(cKey, result, 180);
    return result;

  } catch (e) {
    console.error('getGrades error:', e);
    return { ok: false, error: 'خطأ أثناء جلب الدرجات: ' + e.message };
  }
}
// ══════════════════════════════════════════════════════════════
// _analyzeMonths — نسخة مُصلحة تدعم هيكل "عمود واحد + فراغات"
// استبدل الدالة الموجودة في StudentLogic.gs
// ══════════════════════════════════════════════════════════════
function _analyzeMonths(h1, totalCols) {
  var VALID_MONTHS = [
    'محرم', 'صفر', 'ربيع اول', 'ربيع ثاني',
    'جماد اول', 'جماد ثاني', 'رجب', 'شعبان',
    'نصف العام', 'نهاية العام'
  ];

  // ── الخطوة 1: forward-fill — ملء الفراغات بآخر قيمة شهر مرئية ──
  var filled = [];
  var lastMonth = '';
  for (var c = 0; c < totalCols; c++) {
    var cell = _safe(h1[c] || '');
    if (VALID_MONTHS.indexOf(cell) !== -1) {
      lastMonth = cell;
      filled.push(cell);
    } else if (cell === '' && lastMonth) {
      // فارغ — احتفظ بآخر شهر (forward-fill)
      filled.push(lastMonth);
    } else {
      // قيمة لا تنتمي لأشهر (مثل "المادة" في الأعمدة الأولى)
      filled.push('');
      lastMonth = ''; // إعادة تعيين عند عبور منطقة الرأس
    }
  }

  // ── الخطوة 2: استخراج نطاقات الأشهر من المصفوفة المملوءة ──
  var months = [];
  var cur = '';
  var start = -1;
  for (var i = 4; i < filled.length; i++) { // ابدأ من العمود 5 (index 4) تخطياً A:D
    var val = filled[i];
    if (!val) continue; // تجاهل ما قبل منطقة الدرجات
    if (val !== cur) {
      if (cur && start !== -1) {
        months.push({ name: cur, startCol: start, endCol: i - 1 });
      }
      cur = val;
      start = i;
    }
  }
  if (cur && start !== -1) {
    months.push({ name: cur, startCol: start, endCol: filled.length - 1 });
  }

  // ── الخطوة 3: ترتيب حسب الترتيب الدراسي ──
  months.sort(function(a, b) {
    var ai = VALID_MONTHS.indexOf(a.name);
    var bi = VALID_MONTHS.indexOf(b.name);
    if (ai === -1) ai = 999;
    if (bi === -1) bi = 999;
    return ai - bi;
  });

  return months;
}

// ══════════════════════════════════════════════════════════════
// _processMonth — النسخة الكاملة المُصلحة
// تدعم: شهور عادية + نصف/نهاية العام بهيكل 3 أعمدة + هيكل عمود واحد
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// _processMonth — النسخة النهائية مع قاعدة الحساب الصحيحة
// قاعدة المحصلة:
//   نصف العام  = round(اجمالي محرم/10) + round(اجمالي صفر/10) + اختبار النصفي (30)
//   نهاية العام = round(اجمالي جماد أول/10) + round(اجمالي جماد ثاني/10) + اختبار النهائي (30)
//   المحصلة من 50، الأعمدة الأولى مُقفلة (محسوبة آلياً) واختبار النصفي/النهائي قابل للإدخال
// ══════════════════════════════════════════════════════════════
function _processMonth(month, h2, h3, studentRow, requiredSubjects) {
  var periodType = GS_getPeriodType(month.name);
  var schema     = GS_SCHEMA[periodType];
  var isTermMonth = (periodType === 'term');

  var mData = {
    name        : month.name,
    isFinal     : isTermMonth,
    isTermMonth : isTermMonth,
    subjects    : []
  };

  var subjectMap = {};
  var c = month.startCol;

  while (c <= month.endCol) {
    var sName = _safe(h2[c] || '');
    if (!sName) { c++; continue; }
    if (!subjectMap[sName]) subjectMap[sName] = {};

    /* ⭐ استخدام Schema الموحّد لتحديد عدد الأعمدة المتوقع */
    var blockSize = schema.columnCount + schema.reservedColumns;

    if (isTermMonth) {
      /* فحص: هل العمود الأول في النطاق يحوي label معروف؟ */
      var hasLabels = false;
      for (var lk = 0; lk < blockSize && (c + lk) <= month.endCol; lk++) {
        var lbl = _safe((h3 && h3[c + lk]) ? h3[c + lk] : '');
        if (GS_resolveFieldKey(lbl) !== null) { hasLabels = true; break; }
      }

      /* فحص بديل: المادة لا تتكرر في الأعمدة التالية (implicit block) */
      var implicitBlock = true;
      for (var ck = 1; ck < schema.columnCount && (c + ck) <= month.endCol; ck++) {
        var ns = _safe(h2[c + ck] || '');
        if (ns !== '' && ns !== sName) { implicitBlock = false; break; }
      }

      if (hasLabels || implicitBlock) {
        /* قراءة قيمة درجة الاختبار من العمود رقم 1 (position) */
        var examCol = c + 1;
        var v1 = (examCol <= month.endCol) ? studentRow[examCol] : null;
        var examVal = '';
        if (v1 !== null && v1 !== undefined && v1 !== '') {
          examVal = v1.toString().trim();
          subjectMap[sName]['exam_score'] = examVal;
        }

        /* قراءة قيمة الأعمال المستمرة من العمود رقم 0 — مخزنة فعلياً */
        var monthlyCol = c;
        var v0 = (monthlyCol <= month.endCol) ? studentRow[monthlyCol] : null;
        if (v0 !== null && v0 !== undefined && v0 !== '') {
          subjectMap[sName]['monthly_score'] = String(v0).trim();
        } else {
          /* لو لم تُكتب فعلياً، نحسبها من الشهور المصدر */
          var autoMonthly = _computeTermMonthly(month.name, sName, studentRow, h1ForTerm(), h2);
          if (autoMonthly !== null) {
            subjectMap[sName]['monthly_score'] = String(autoMonthly);
          }
        }

        /* المحصلة عبر الطبقة الموحدة */
        var totalCalc = GS_computeTermTotal(
          subjectMap[sName]['monthly_score'],
          subjectMap[sName]['exam_score']
        );
        if (totalCalc !== null) {
          subjectMap[sName]['total_score'] = String(totalCalc);
        }

        c += blockSize;  /* نقفز 5 أعمدة (3 + 2 احتياطي) */
      } else {
        /* fallback: عمود واحد للمحصلة فقط */
        var rawVal = studentRow[c];
        if (rawVal !== null && rawVal !== undefined && rawVal !== '') {
          subjectMap[sName]['total_score'] = rawVal.toString().trim();
        }
        c++;
      }

    } else {
      /* شهر عادي */
      var sameSubjectSpan = true;
      var spanEnd = Math.min(c + 3, month.endCol);
      for (var k = c + 1; k <= spanEnd; k++) {
        var nextS = _safe(h2[k] || '');
        if (nextS !== '' && nextS !== sName) {
          sameSubjectSpan = false;
          spanEnd = k - 1;
          break;
        }
      }
      var actualSpan = spanEnd - c + 1;

      if (sameSubjectSpan && actualSpan >= 4) {
        /* استخدم schema.fields بالترتيب */
        for (var t = 0; t < 4 && (c + t) <= month.endCol; t++) {
          var fieldKey = schema.fields[t].key;  /* behavior, homework, oral, written */
          var rawV    = studentRow[c + t];
          if (rawV !== null && rawV !== undefined && rawV !== '') {
            subjectMap[sName][fieldKey] = rawV.toString().trim();
          }
        }
        c += actualSpan;
      } else {
        var rv = studentRow[c];
        if (rv !== null && rv !== undefined && rv !== '') {
          subjectMap[sName]['total'] = rv.toString().trim();
        }
        c++;
      }
    }
  }

  /* بناء مصفوفة العرض من Schema (موحد) */
  for (var si = 0; si < requiredSubjects.length; si++) {
    var subj    = requiredSubjects[si];
    var sGrades = subjectMap[subj] || {};
    var gradesArr = [];
    var hasGrades = false;

    for (var fi = 0; fi < schema.fields.length; fi++) {
      var field = schema.fields[fi];
      var val = sGrades[field.key] || '';

      gradesArr.push({
        type    : field.label,          /* الاسم المعروض للطالب */
        key     : field.key,            /* الـ key التقني */
        value   : val,
        isEmpty : (val === ''),
        max     : field.max,
        locked  : field.locked,
        auto    : field.auto,
        isTotal : field.isTotal || false
      });

      if (val !== '') hasGrades = true;
    }

    if (hasGrades) {
      mData.subjects.push({ name: subj, grades: gradesArr });
    }
  }

  return mData;
}
// غلاف يمرر h1 لـ _processMonth الجديدة
function _processMonthWithH1(month, h1, h2, h3, studentRow, requiredSubjects) {
  // حقن h1 عبر متغير عام للوحدة (closure بسيط)
  _CURRENT_H1 = h1;
  var result = _processMonth(month, h2, h3, studentRow, requiredSubjects);
  return result;
}
var _CURRENT_H1 = null;
// ══════════════════════════════════════════════════════════════
// _computeTermMonthly — حساب "الأعمال المستمرة" حسب القاعدة:
//   نصف العام:   round(اجمالي محرم/10) + round(اجمالي صفر/10)        → من 20
//   نهاية العام: round(اجمالي جماد أول/10) + round(اجمالي جماد ثاني/10) → من 20
// ══════════════════════════════════════════════════════════════
function _computeTermMonthly(termMonthName, subjectName, studentRow, h1, h2) {
  if (!studentRow || !h1 || !h2) return null;

  var previousMonths = (termMonthName === 'نصف العام')
    ? ['محرم', 'صفر']
    : (termMonthName === 'نهاية العام' ? ['جماد اول', 'جماد ثاني'] : []);

  if (previousMonths.length === 0) return null;

  var total = 0;
  var foundAny = false;

  // forward-fill على صف الشهور
  var VALID_MONTHS = ['محرم', 'صفر', 'ربيع اول', 'ربيع ثاني', 'جماد اول', 'جماد ثاني',
                       'رجب', 'شعبان', 'نصف العام', 'نهاية العام'];
  var filled = [];
  var lastMonth = '';
  for (var ci = 0; ci < h1.length; ci++) {
    var cell = _safe(h1[ci] || '');
    if (VALID_MONTHS.indexOf(cell) !== -1) { lastMonth = cell; filled.push(cell); }
    else if (cell === '' && lastMonth) { filled.push(lastMonth); }
    else { filled.push(''); lastMonth = ''; }
  }

  for (var pm = 0; pm < previousMonths.length; pm++) {
    var targetMonth = previousMonths[pm];
    var subjectTotal = 0;
    var subjectHasAny = false;

    for (var col = 4; col < filled.length; col++) {
      if (filled[col] !== targetMonth) continue;
      if (_safe(h2[col] || '') !== subjectName) continue;

      // اجمع 4 أعمدة متتالية (السلوك+الواجبات+الشفوي+التحريري)
      for (var off = 0; off < 4 && (col + off) < studentRow.length; off++) {
        var v = _safeFloat(studentRow[col + off], null);
        if (v !== null) { subjectTotal += v; subjectHasAny = true; }
      }
      break; // وجدنا المادة في هذا الشهر، انتقل للشهر التالي
    }

    if (subjectHasAny) {
      total += Math.round(subjectTotal / 10);  // ✅ ÷10 + تقريب لأقرب عدد صحيح
      foundAny = true;
    }
  }

  return foundAny ? total : null;
}
// دالة مساعدة دلالية لتوحيد التوقيع
// تُرجع صف الشهور (h1) المُخزَّن بواسطة _processMonthWithH1
function h1ForTerm() { return _CURRENT_H1; }
function _calcTotal(sGrades) {
  // جرّب جميع أسماء عمود المجموع الممكنة
  var totalKeys = ['الاجمالي', 'المجموع', 'الكلي', 'النهائي', 'total', 'Total'];
  for (var ki = 0; ki < totalKeys.length; ki++) {
    if (sGrades[totalKeys[ki]] !== undefined && sGrades[totalKeys[ki]] !== '') {
      return _safe(sGrades[totalKeys[ki]]);
    }
  }

  // إذا لم يوجد عمود مجموع، احسبه
  var sum = 0, cnt = 0;
  var excludeKeys = ['الاجمالي', 'المجموع', 'الكلي', 'النهائي', 'total', 'Total'];
  for (var t in sGrades) {
    if (excludeKeys.indexOf(t) === -1) {
      var v = _safeFloat(sGrades[t], null);
      if (v !== null && !isNaN(v)) { sum += v; cnt++; }
    }
  }
  return cnt > 0 ? String(Math.round(sum * 10) / 10) : '';
}

// ══════════════════════════════════════════════════════════════
// getSubjectsByClass — نسخة مُصلحة: توحيد أسماء المواد مع الشيت
// استبدل الدالة الموجودة في StudentLogic.gs
// ══════════════════════════════════════════════════════════════
function getSubjectsByClass(cls) {
  var c = _safe(cls);

  // ⚠️ تنبيه: الأسماء هنا يجب أن تطابق تماماً ما هو في صف 2 من ورقة الدرجات
  // "تربية اسلامية" (بدون "ال") كما هو في الشيت الفعلي
  var kg   = ['قران كريم', 'تربية اسلامية', 'اللغة العربية', 'الرياضيات', 'العلوم'];
  var th3  = ['قران كريم', 'تربية اسلامية', 'اللغة العربية', 'الرياضيات', 'العلوم', 'الاجتماعيات'];
  var prim = ['قران كريم', 'تربية اسلامية', 'اللغة العربية', 'اللغة الانجليزية', 'الرياضيات', 'العلوم', 'الاجتماعيات'];
  var sec  = ['قران كريم', 'تربية اسلامية', 'اللغة العربية', 'اللغة الانجليزية', 'الرياضيات', 'الفيزياء', 'الكيمياء', 'الاحياء', 'الجغرافيا', 'التاريخ', 'المجتمع'];
  var secSh = ['قران كريم', 'تربية اسلامية', 'اللغة العربية', 'اللغة الانجليزية', 'الرياضيات', 'الفيزياء', 'الكيمياء', 'الاحياء'];

  switch (c) {
    case 'KG1': case 'KG2': case 'الأول': case 'الثاني': return kg;
    case 'الثالث': return th3;
    case 'الرابع': case 'الخامس': case 'السادس':
    case 'السابع': case 'الثامن': case 'التاسع': return prim;
    case 'الأول ثانوي': return sec;
    case 'الثاني ثانوي': case 'الثالث ثانوي': return secSh;
    default: return prim;
  }
}

// ============================================================
// البيانات المالية
// ============================================================
// ══════════════════════════════════════════════════════
// getStudentFinancialData — نسخة محسّنة
// استبدل الدالة الحالية في StudentLogic.gs
// ══════════════════════════════════════════════════════
function getStudentFinancialData(studentIdOrParams) {
  try {
    _resolveTenant(studentIdOrParams);   // ✅ عزل المدرسة

    var studentId;
    if (typeof studentIdOrParams === 'object' && studentIdOrParams !== null) {
      studentId = _safe(studentIdOrParams.studentId || studentIdOrParams.code || studentIdOrParams.id || '');
    } else {
      studentId = _safe(studentIdOrParams);
    }

    var cKey = _ck('fin', studentId);   // ✅ كاش معزول
    var cached = _cacheGet(cKey);
    if (cached) return cached;

    var sidStr = studentId.toString().trim();

    var feesSheet = _getSheet('الرسوم');
    var totalFees = 0, feesPaid = 0, studentName = '';
    if (feesSheet) {
      var lastFeeRow = feesSheet.getLastRow();
      if (lastFeeRow > 1) {
        var feesData = feesSheet.getRange(2, 1, lastFeeRow - 1, 4).getValues();
        for (var i = 0; i < feesData.length; i++) {
          if (_safe(feesData[i][0]) === sidStr) {
            studentName = _safe(feesData[i][1]);
            totalFees   = _safeFloat(feesData[i][2], 0);
            feesPaid    = _safeFloat(feesData[i][3], 0);
            break;
          }
        }
      }
    }

    var payments = [], payTotal = 0;
    var pSheet = _getSheet('التسديد');
    if (pSheet) {
      var lastPayRow = pSheet.getLastRow();
      if (lastPayRow > 1) {
        var pData = pSheet.getRange(2, 1, lastPayRow - 1, 5).getValues();
        for (var pi = 0; pi < pData.length; pi++) {
          if (_safe(pData[pi][0]) !== sidStr) continue;
          var amt  = _safeFloat(pData[pi][2], 0);
          var pdt  = _safe(pData[pi][3]);
          var pmth = _safe(pData[pi][4]);
          payments.push({ amount: amt, date: pdt, method: pmth, formattedAmount: _fmtNum(amt) });
          payTotal += amt;
        }
        payments.sort(function(a, b) { return b.date > a.date ? 1 : -1; });
      }
    }

    var totalPaid    = payTotal > 0 ? payTotal : feesPaid;
    var remaining    = Math.max(0, totalFees - totalPaid);
    var result = {
      ok: true, studentName: studentName,
      totalFees: totalFees, totalPaid: totalPaid,
      remainingAmount: remaining, paymentsCount: payments.length, payments: payments,
      formattedTotalFees: _fmtNum(totalFees),
      formattedTotalPaid: _fmtNum(totalPaid),
      formattedRemaining: _fmtNum(remaining)
    };
    _cacheSet(cKey, result, CACHE_CONFIG.FEES);
    return result;
  } catch (e) {
    console.error('getStudentFinancialData error:', e);
    return { ok: false, error: 'خطأ أثناء جلب البيانات المالية: ' + e.message };
  }
}
// ============================================================
// إصلاح getViolations — فهرسة الأعمدة الصحيحة
// [0]=الكود | [1]=الاسم | [2]=الفصل | [3]=الشعبة | [4]=المخالفة | [5]=المدرس | [6]=التاريخ | [7]=الرد
// ============================================================
function getViolations(studentIdOrParams) {
  try {
    _resolveTenant(studentIdOrParams);   // ✅ عزل المدرسة

    var studentId;
    if (typeof studentIdOrParams === 'object' && studentIdOrParams !== null) {
      studentId = _safe(studentIdOrParams.studentId || studentIdOrParams.code || studentIdOrParams.id || '');
    } else {
      studentId = _safe(studentIdOrParams);
    }

    var cKey = _ck('viol', studentId);   // ✅ كاش معزول
    var cached = _cacheGet(cKey);
    if (cached) return cached;

    var sheet = _getSheet('المخالفات');
    if (!sheet) return [];

    var data   = sheet.getDataRange().getDisplayValues();
    var out    = [];
    var sidStr = studentId.toString().trim();

    for (var i = 1; i < data.length; i++) {
      if (_safe(data[i][0]) !== sidStr) continue;
      out.push({
        type   : _safe(data[i][4]),
        details: _safe(data[i][4]),
        grade  : _safe(data[i][2]),
        section: _safe(data[i][3]),
        date   : _safe(data[i][6]),
        teacher: _safe(data[i][5]),
        reply  : _safe(data[i][7] || '')
      });
    }

    _cacheSet(cKey, out, CACHE_CONFIG.VIOLATIONS);
    return out;
  } catch (e) {
    console.error('getViolations error:', e);
    return [];
  }
}

// ============================================================
// إصلاح _processAttachmentUrl — thumbnail دائماً لـ Drive
// ============================================================
/**
 * معالجة رابط المرفق وتحديد نوعه ورابط العرض المناسب
 * — نسخة محصّنة: لا ترمي أخطاء، دائماً تُرجع كائناً صالحاً
 * — تتعامل مع روابط CMS الجديدة (thumbnail بـ &sz=)
 */
function _processAttachmentUrl(url) {
  var result = {
    displayUrl: '',
    hasAttach : false,
    isImage   : false,
    isPdf     : false,
    isVideo   : false,
    fileType  : 'unknown'
  };

  try {
    if (!url || url === '') return result;
    var cleanUrl = url.toString().trim();
    if (cleanUrl.indexOf('http') !== 0) return result;

    result.hasAttach = true;
    var lower = cleanUrl.toLowerCase();

    // ① YouTube / Vimeo — اكتشاف مباشر
    if (lower.indexOf('youtube.com') !== -1 ||
        lower.indexOf('youtu.be') !== -1 ||
        lower.indexOf('vimeo.com') !== -1) {
      result.isVideo    = true;
      result.fileType   = 'video';
      result.displayUrl = cleanUrl;
      return result;
    }

    // ② Facebook / Instagram videos
    if (lower.indexOf('facebook.com/share/r/') !== -1 ||
        lower.indexOf('facebook.com/reel/') !== -1 ||
        lower.indexOf('fb.watch') !== -1 ||
        lower.indexOf('instagram.com/reel/') !== -1 ||
        lower.indexOf('instagram.com/p/') !== -1) {
      result.isVideo    = true;
      result.fileType   = 'video';
      result.displayUrl = cleanUrl;
      return result;
    }

    // ③ ملفات فيديو مباشرة
    if (/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/.test(lower)) {
      result.isVideo    = true;
      result.fileType   = 'video';
      result.displayUrl = cleanUrl;
      return result;
    }

    // ④ PDF — يجب الفحص قبل Drive (لأن PDFs قد تكون في Drive)
    if (lower.indexOf('.pdf') !== -1 ||
        (lower.indexOf('drive.google.com') !== -1 && lower.indexOf('pdf') !== -1)) {
      result.isPdf    = true;
      result.fileType = 'pdf';
      var pdfId = extractDriveFileId(cleanUrl);
      result.displayUrl = pdfId
        ? ('https://drive.google.com/file/d/' + pdfId + '/preview')
        : cleanUrl;
      return result;
    }

    // ⑤ Google Drive (الحالة الأهم — كل ما يأتي من CMS)
    if (lower.indexOf('drive.google.com') !== -1 ||
        lower.indexOf('googleusercontent.com') !== -1) {
      var fileId = extractDriveFileId(cleanUrl);
      if (fileId) {
        // ✅ تحويل دائم إلى thumbnail لضمان العرض في WebView
        result.displayUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000';
        result.isImage    = true;
        result.fileType   = 'image';
        return result;
      }
      // رابط Drive لكن بدون ID مستخرج — اعتبره صورة وحاول عرضه كما هو
      result.isImage    = true;
      result.fileType   = 'image';
      result.displayUrl = cleanUrl;
      return result;
    }

    // ⑥ صورة بامتداد مباشر
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/.test(lower)) {
      result.isImage    = true;
      result.fileType   = 'image';
      result.displayUrl = cleanUrl;
      return result;
    }

    // ⑦ روابط أخرى — اعتبرها صورة افتراضياً (أفضل من إخفائها)
    result.fileType   = 'other';
    result.displayUrl = cleanUrl;
    return result;

  } catch (e) {
    console.error('_processAttachmentUrl error: ' + e.message + ' | url: ' + url);
    // ✅ المهم: لا نرمي خطأ — نُرجع كائناً سليماً بأقل ضرر
    return {
      displayUrl: url || '',
      hasAttach : !!url,
      isImage   : false,
      isPdf     : false,
      isVideo   : false,
      fileType  : 'unknown'
    };
  }
}
// ============================================================
// إضافة مزامنة المخالفات من ملف المعلم إلى ملف الطالب
// تُستدعى من TeacherCore عند إضافة مخالفة
// ============================================================
function syncViolationFromTeacher(studentCode, studentName, grade, section,
                                  violation, teacherName, dateStr, reply) {
  // ★ بعد التوحيد: المعلم يكتب مباشرة على ورقة المخالفات في نفس الملف
  return true;
}

function _sampleNews() {
  return [{
    id: '0',
    teacher: 'الإدارة',
    class: 'الجميع',
    section: 'الجميع',
    content: 'مرحباً بك في منصة الطالب. ستظهر هنا أخبار المدرسة والإشعارات.',
    attachments: '',
    hasAttach: false,
    isImage: false,
    isPdf: false,
    isVideo: false,
    fileType: 'none',
    date: _nowString()
  }];
}

// ============================================================
// الواجبات
// ============================================================
function getAssignmentsForStudent(klassOrParams, section) {
  try {
    // ═══════════════════════════════════════════════
    //  v2.1 — قبول الشكلين: كائن params أو معاملين منفصلين
    // ═══════════════════════════════════════════════
    var klass, sectionName;
    if (typeof klassOrParams === 'object' && klassOrParams !== null) {
      klass       = _safe(klassOrParams.klass || klassOrParams.class || klassOrParams.grade || '');
      sectionName = _safe(klassOrParams.section || '');
    } else {
      klass       = _safe(klassOrParams);
      sectionName = _safe(section);
    }

    var cKey = 'hw_' + klass + '_' + sectionName;
    var cached = _cacheGet(cKey);
    if (cached) return cached;

    // ★ المصدر: ورقة "الواجبات" في ملف الطالب (مُزامَنة من ملف المعلم)
    var sheet = _getSheet('الواجبات');
    if (!sheet) return _sampleAssignments(klass, sectionName);

    var data = sheet.getDataRange().getDisplayValues();
    if (data.length <= 1) return _sampleAssignments(klass, sectionName);

    var out = [];
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      var hw = _safe(r[5]);
      if (!hw) continue;

      var rowClass   = _safe(r[3]);
      var rowSection = _safe(r[4]);

      var classMatch   = !rowClass   || rowClass   === 'جميع الفصول' || rowClass   === klass;
      var sectionMatch = !rowSection || rowSection === 'جميع الشعب'  || rowSection === sectionName;
      if (!classMatch || !sectionMatch) continue;

      out.push({
        id:      _safe(r[0]),
        teacher: _safe(r[1]),
        subject: _safe(r[2]),
        class:   rowClass  || 'الجميع',
        section: rowSection || 'الجميع',
        details: hw,
        date:    _safe(r[6])
      });
    }

    out.sort(function(a, b) {
      return parseInt(b.id || 0) - parseInt(a.id || 0);
    });

    var result = out.length > 0 ? out : _sampleAssignments(klass, sectionName);
    _cacheSet(cKey, result, CACHE_TTL);
    return result;
  } catch (e) {
    console.error('getAssignmentsForStudent error:', e);
    return _sampleAssignments(klass, sectionName);
  }
}

// ============================================================
// ملاحظات ولي الأمر
// ============================================================
function getTeachersForClass(classNameOrParams) {
  try {
    // ═══════════════════════════════════════════════
    //  v2.1 — قبول الشكلين: كائن params أو معامل منفرد
    // ═══════════════════════════════════════════════
    var className;
    if (typeof classNameOrParams === 'object' && classNameOrParams !== null) {
      className = _safe(classNameOrParams.className || classNameOrParams.class || classNameOrParams.grade || '');
    } else {
      className = _safe(classNameOrParams);
    }

    var sheet = _getSheet('المدرسين');
    if (!sheet) return [];
    var data = sheet.getDataRange().getDisplayValues();
    var teachers = {};
    for (var i = 1; i < data.length; i++) {
      var tName  = _safe(data[i][0]);
      var tClass = _safe(data[i][2]);
      if (!tName) continue;
      if (tClass === 'جميع الفصول' || tClass === className) teachers[tName] = true;
    }
    return Object.keys(teachers).sort();
  } catch (e) {
    console.error('getTeachersForClass error:', e);
    return [];
  }
}
function submitNote(noteData) {
  try {
    if (!noteData || !noteData.message || !noteData.teacher) {
      return { ok: false, error: 'يرجى تعبئة جميع الحقول' };
    }
    if (_safe(noteData.message).length < 5) {
      return { ok: false, error: 'الرسالة قصيرة جداً' };
    }

    // ✅ استخدام الملف النشط ديناميكيًا
    var teacherFile = _getSSById(_activeFileId());
    var sheet = teacherFile.getSheetByName('الملاحظات');
    
    if (!sheet) {
      sheet = teacherFile.insertSheet('الملاحظات');
      sheet.getRange('A1:G1').setValues([[
        'الاسم', 'الفصل', 'الشعبة', 'اسم المدرس', 'الرسالة', 'التاريخ', 'الرد'
      ]]);
    }

    sheet.appendRow([
      _safe(noteData.studentName),
      _safe(noteData.studentClass),
      _safe(noteData.studentSection),
      _safe(noteData.teacher),
      _safe(noteData.message),
      _nowString(),
      ''
    ]);

    // ✅ كاش معزول
    var cacheKey = _ck('notes', _safe(noteData.studentName).replace(/\s+/g, '_'));
    _cacheDel(cacheKey);

    return { ok: true, message: 'تم إرسال ملاحظتك بنجاح. سيتم الرد عليها قريباً.' };
  } catch (e) {
    console.error('submitNote error:', e);
    return { ok: false, error: 'خطأ أثناء إرسال الملاحظة: ' + e.message };
  }
}

function getStudentNotes(studentIdOrParams, studentName) {
  try {
    // ═══════════════════════════════════════════════
    //  v2.1 — قبول الشكلين: كائن params أو معاملين منفصلين
    // ═══════════════════════════════════════════════
    var studentId, name;
    if (typeof studentIdOrParams === 'object' && studentIdOrParams !== null) {
      studentId = _safe(studentIdOrParams.studentId || studentIdOrParams.code || studentIdOrParams.id || '');
      name      = _safe(studentIdOrParams.studentName || '');
    } else {
      studentId = _safe(studentIdOrParams);
      name      = _safe(studentName);
    }

    var cacheKey = 'notes_' + name.replace(/\s+/g, '_');
    var cached = _cacheGet(cacheKey);
    if (cached) return cached;

    var teacherFile = _getSSById('1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM');
    var sheet = teacherFile.getSheetByName('الملاحظات');

    if (!sheet) {
      return { ok: true, notes: [] };
    }

    var data = sheet.getDataRange().getDisplayValues();
    if (data.length <= 1) {
      return { ok: true, notes: [] };
    }

    var out = [];
    var targetName = name.trim();

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rowName = _safe(row[0]).trim();
      if (rowName !== targetName) continue;

      var note = {
        rowIndex: i + 1,
        name: rowName,
        class: _safe(row[1]),
        section: _safe(row[2]),
        teacher: _safe(row[3]),
        message: _safe(row[4]),
        date: _safe(row[5]),
        reply: _safe(row[6] || '')
      };
      if (!note.message) continue;
      out.push(note);
    }

    out.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });

    var result = { ok: true, notes: out };
    _cacheSet(cacheKey, result, CACHE_TTL);
    return result;

  } catch (e) {
    console.error('getStudentNotes error:', e);
    return { ok: false, error: 'خطأ أثناء جلب الملاحظات: ' + e.message };
  }
}

// ============================================================
// الجدول الدراسي
// ============================================================
function getSchedule(klassOrParams, section) {
  try {
    _resolveTenant(klassOrParams);       // ✅ عزل المدرسة

    var klass, sectionName;
    if (typeof klassOrParams === 'object' && klassOrParams !== null) {
      klass       = _safe(klassOrParams.klass || klassOrParams.class || klassOrParams.grade || '');
      sectionName = _safe(klassOrParams.section || '');
    } else {
      klass       = _safe(klassOrParams);
      sectionName = _safe(section);
    }

    var cKey = _ck('sched', klass + '_' + sectionName);  // ✅ كاش معزول
    var cached = _cacheGet(cKey);
    if (cached) return cached;

    var sheet = _getSheet('الجدول');
    if (!sheet) return { ok: false, error: 'لم يتم إضافة الجدول الدراسي بعد. يرجى مراجعة الإدارة.' };

    var data = sheet.getDataRange().getDisplayValues();
    if (data.length < 2) return { ok: false, error: 'الجدول الدراسي فارغ' };

    var gradeToNumber = {
      'الثالث ثانوي': '12', 'الثاني ثانوي': '11', 'الأول ثانوي': '10',
      'التاسع': '9', 'الثامن': '8', 'السابع': '7', 'السادس': '6',
      'الخامس': '5', 'الرابع': '4', 'الثالث': '3', 'الثاني': '2', 'الأول': '1',
      'KG2': 'KG2', 'KG1': 'KG1'
    };
    var baseNumber = gradeToNumber[klass] || klass;

    var result = [];
    for (var i = 1; i < data.length; i++) {
      var rc = _safe(data[i][0]);
      var rs = _safe(data[i][1]);
      var day = _safe(data[i][2]);
      var period = _safe(data[i][3]);
      var subject = _safe(data[i][4]);
      var teacher = _safe(data[i][5]);
      var room = _safe(data[i][6] || '');

      var matchByName = (rc === klass);
      var matchByCode = (baseNumber.length <= 2 && rc.indexOf(baseNumber) === 0);

      if (!matchByName && !matchByCode) continue;

      if (rs && rs !== 'الجميع' && rs !== 'جميع الشعب' && rs !== sectionName) continue;

      result.push({
        day: day,
        period: period,
        subject: subject,
        teacher: teacher,
        room: room
      });
    }

    var res = result.length > 0
      ? { ok: true, schedule: result }
      : { ok: false, error: 'لم يتم إضافة جدول للصف ' + klass + ' بعد.' };
    _cacheSet(cKey, res, 60);
    return res;
  } catch (e) {
    console.error('getSchedule error:', e);
    return { ok: false, error: 'خطأ أثناء جلب الجدول: ' + e.message };
  }
}
// ============================================================
// تنسيق الأرقام
// ============================================================
function _fmtNum(n) {
  var num = parseFloat(n);
  if (isNaN(num)) return '0';
  return num.toLocaleString('ar-YE');
}

// ============================================================
// فحص صحة النظام
// ============================================================
function healthCheck() {
  return {
    ok: true,
    spreadsheetId: SPREADSHEET_ID,
    sheets: {
      students:    !!_getSheet('الطلاب'),
      grades:      !!_getSheet('الدرجات'),
      fees:        !!_getSheet('الرسوم'),
      payments:    !!_getSheet('التسديد'),
      news:        !!_getSheet('الاخبار'),
      schedule:    !!_getSheet('الجدول'),
      settings:    !!_getSheet('الاعدادات'),
      teachers:    !!_getSheet('المدرسين'),
      notes:       !!_getSheet('الملاحظات'),
      violations:  !!_getSheet('سلبيات ومميزات الطالب')
    },
    time: _nowString()
  };
}

// ══════════════════════════════════════════════════════════════
// syncGradesFromMaster — مزامنة آمنة للدرجات من ملف المعلمين
// تُستدعى يومياً أو عند الطلب بدلاً من الاعتماد على IMPORTRANGE
// أضف هذه الدالة في StudentLogic.gs
// ══════════════════════════════════════════════════════════════
// في StudentLogic.gs
function syncRecentGradesFromMaster() {
  // ★ مُعطّلة: منصة الطالب تقرأ الدرجات مباشرةً من ورقة "النصفي" بملف المعلمين.
  //   لا حاجة لنسخ محلي — هذا يضمن مصدراً وحيداً وتطابقاً 100%.
  return { ok: true, skipped: true, message: 'القراءة المباشرة مُفعّلة — لا مزامنة' };
}
function checkScheduleSheet() {
  var sheet = _getSheet('الجدول');
  if (!sheet) { Logger.log('❌ الورقة غير موجودة'); return; }
  var data = sheet.getDataRange().getDisplayValues();
  Logger.log('عدد الصفوف: ' + (data.length - 1));
  for (var i = 1; i < Math.min(data.length, 6); i++) {
    Logger.log('   صف ' + (i+1) + ': الفصل=' + data[i][0] + ' | اليوم=' + data[i][2] + ' | المادة=' + data[i][4] + ' | المعلم=' + data[i][5]);
  }
  // عد أول 3 فصول مختلفة
  var classes = {};
  for (var i = 1; i < data.length; i++) {
    var c = _safe(data[i][0]);
    if (c) classes[c] = true;
  }
  Logger.log('\nالفصول الموجودة فعلاً في الورقة:');
  for (var k in classes) Logger.log('   ' + k);
}
function clearScheduleCache() {
  var sheet = _getSheet('الجدول');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  var cacheKeys = [];
  for (var i = 1; i < data.length; i++) {
    var cls = _safe(data[i][0]);
    var sec = _safe(data[i][1]);
    cacheKeys.push('sched_' + cls + '_' + sec);
  }
  cacheKeys.forEach(function(key) { _cacheDel(key); });
  Logger.log('تم مسح ' + cacheKeys.length + ' مفتاح كاش.');
}

// ============================================================
// syncAllFromMaster — مزامنة شاملة من ملف المعلمين إلى ملف الطالب
// يُشغَّل يومياً عبر Trigger أو يدوياً من لوحة المدير
// ============================================================
function syncAllFromMaster() {
  return { ok: true, merged: true, note: 'موحّد — لا حاجة للمزامنة' };
}
// ============================================================
// دالة مساعدة: مزامنة ورقة كاملة من ملف المعلمين
// ============================================================
function _syncSheetFromMaster(masterFile, studentFile, sheetName, numCols) {
  var src = masterFile.getSheetByName(sheetName);
  if (!src) return 'الورقة "' + sheetName + '" غير موجودة في ملف المعلمين';
  
  var dst = studentFile.getSheetByName(sheetName);
  if (!dst) dst = studentFile.insertSheet(sheetName);
  
  var lastRow = src.getLastRow();
  if (lastRow < 1) return 'الورقة فارغة';
  
  var cols = numCols || src.getLastColumn();
  var data = src.getRange(1, 1, lastRow, cols).getValues();
  
  dst.clearContents();
  dst.getRange(1, 1, data.length, cols).setValues(data);
  
  return 'تمت مزامنة ' + (data.length - 1) + ' سجل';
}

// ============================================================
// إنشاء Trigger تلقائي — شغّله مرة واحدة من محرر Apps Script
// ============================================================
function createDailySync() {
  // احذف أي Triggers قديمة لنفس الدالة أولاً
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncAllFromMaster') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // أنشئ Trigger جديد كل يوم في الساعة 2 صباحاً
  ScriptApp.newTrigger('syncAllFromMaster')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
  Logger.log('✅ تم إنشاء Trigger اليومي لـ syncAllFromMaster');
  return { ok: true, message: 'تم ضبط المزامنة اليومية في الساعة 2 صباحاً' };
}
// ══════════════════════════════════════════════════════
// getViolationsPaged — مخالفات مع pagination
// أضفها في StudentLogic.gs
// ══════════════════════════════════════════════════════
function getViolationsPaged(studentId, page, pageSize) {
  try {
    page     = parseInt(page, 10) || 1;
    pageSize = parseInt(pageSize, 10) || 10;

    // ✅ استدعاء الدالة المعزولة التي تضبط الملف تلقائياً
    var all = getViolations(studentId);
    var total = all.length;
    var start = (page - 1) * pageSize;
    var items = all.slice(start, start + pageSize);

    return {
      ok         : true,
      items      : items,
      total      : total,
      page       : page,
      pageSize   : pageSize,
      totalPages : Math.ceil(total / pageSize),
      hasMore    : (start + pageSize) < total
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
// ══════════════════════════════════════════════════════
// getStudentNewsPaged — أخبار مع pagination
// ══════════════════════════════════════════════════════
function getStudentNews(klassOrParams, section) {
  try {
    _resolveTenant(klassOrParams);       // ✅ عزل المدرسة

    var klass, sectionName;
    if (typeof klassOrParams === 'object' && klassOrParams !== null) {
      klass       = _safe(klassOrParams.klass || klassOrParams.class || klassOrParams.grade || '');
      sectionName = _safe(klassOrParams.section || '');
    } else {
      klass       = _safe(klassOrParams);
      sectionName = _safe(section);
    }

    var cKey = _ck('news', klass + '_' + sectionName);  // ✅ كاش معزول
    var cached = _cacheGet(cKey);
    if (cached) return cached;

    var teacherFile = _getSSById(_activeFileId());     // ✅ ديناميكي
    var sheet = teacherFile.getSheetByName('الاخبار');
    if (!sheet) {
      console.warn('getStudentNews: ورقة الاخبار غير موجودة');
      return _sampleNews();
    }

    var data = sheet.getDataRange().getDisplayValues();
    if (data.length <= 1) {
      console.warn('getStudentNews: الورقة فارغة');
      return _sampleNews();
    }

    var out = [];
    var skippedCount = 0;

    for (var i = 1; i < data.length; i++) {
      try {
        var r = data[i];
        if (!r || r.length === 0) { skippedCount++; continue; }

        var newsText = _safe(r[4]);
        if (!newsText) { skippedCount++; continue; }

        var rowClass   = _safe(r[2]);
        var rowSection = _safe(r[3]);

        var classMatch = !rowClass ||
                         rowClass === 'جميع الفصول' ||
                         rowClass === 'الجميع' ||
                         rowClass === klass;
        var sectionMatch = !rowSection ||
                           rowSection === 'جميع الشعب' ||
                           rowSection === 'الجميع' ||
                           rowSection === sectionName;

        if (!classMatch || !sectionMatch) { skippedCount++; continue; }

        var attachUrl = _safe(r[5]);
        var attachmentInfo = _processAttachmentUrl(attachUrl);

        out.push({
          id:          _safe(r[0]),
          teacher:     _safe(r[1]),
          class:       rowClass   || 'الجميع',
          section:     rowSection || 'الجميع',
          content:     newsText,
          attachments: attachmentInfo.displayUrl,
          hasAttach:   attachmentInfo.hasAttach,
          isImage:     attachmentInfo.isImage,
          isPdf:       attachmentInfo.isPdf,
          isVideo:     attachmentInfo.isVideo,
          fileType:    attachmentInfo.fileType,
          date:        _safe(r[6])
        });

      } catch (eRow) {
        console.error('getStudentNews: فشل معالجة الصف ' + i + ': ' + eRow.message);
        skippedCount++;
        continue;
      }
    }

    out.sort(function(a, b) {
      var idA = parseInt(a.id || 0, 10);
      var idB = parseInt(b.id || 0, 10);
      return idB - idA;
    });

    console.log('getStudentNews: تمت قراءة ' + out.length + ' خبر، تم تخطي ' + skippedCount + ' صف');

    var result = (out.length > 0) ? out : _sampleNews();
    _cacheSet(cKey, result, CACHE_TTL);
    return result;

  } catch (e) {
    console.error('getStudentNews fatal error: ' + e.message + '\n' + (e.stack || ''));
    return _sampleNews();
  }
}
// ══════════════════════════════════════════════════════
// createHourlyGradesSync — Trigger كل ساعة للدرجات
// شغّله مرة واحدة من محرر Apps Script في مشروع StudentLogic
// ══════════════════════════════════════════════════════
function createHourlyGradesSync() {
  // حذف Triggers القديمة
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'syncGradesFromMaster' || fn === 'hourlySyncGrades') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // مزامنة الدرجات كل ساعة
  ScriptApp.newTrigger('hourlySyncGrades')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('✅ Trigger ساعي للدرجات تم إنشاؤه');
  return { ok: true, message: 'تم ضبط مزامنة الدرجات كل ساعة' };
}

// الدالة التي ينفذها Trigger
function hourlySyncGrades() {
  try {
    syncGradesFromMaster();
    // مسح كاش الدرجات لجميع الطلاب (سيُعاد تحميلها عند الطلب)
    Logger.log('✅ hourlySyncGrades: تمت مزامنة الدرجات في ' + _nowString());
  } catch (e) {
    console.error('hourlySyncGrades error:', e.message);
  }
}
// ══════════════════════════════════════════════════════
// getStudentNotificationBadge — إحصاء التحديثات الجديدة
// تُستدعى من Student Portal لإظهار Badge على الأقسام
// ══════════════════════════════════════════════════════
function getStudentNotificationBadge(studentId, studentName, klass, section, lastLoginDate) {
  try {
    var result = {
      news        : 0,
      violations  : 0,
      notes       : 0,
      homework    : 0,
      total       : 0
    };

    // تاريخ آخر دخول — نقارن منه
    var lastLogin = lastLoginDate ? new Date(lastLoginDate) : new Date(0);

    // ── 1. أخبار جديدة ──
    try {
      var allNews  = getStudentNews(klass, section);
      var newNews  = 0;
      for (var ni = 0; ni < allNews.length; ni++) {
        var nd = allNews[ni].date ? new Date(allNews[ni].date) : new Date(0);
        if (nd > lastLogin) newNews++;
      }
      result.news = newNews;
    } catch (e) {}

    // ── 2. مخالفات جديدة ──
    try {
      var allViol  = getViolations(studentId);
      var newViol  = 0;
      for (var vi = 0; vi < allViol.length; vi++) {
        var vd = allViol[vi].date ? new Date(allViol[vi].date) : new Date(0);
        if (vd > lastLogin) newViol++;
      }
      result.violations = newViol;
    } catch (e) {}

    // ── 3. ردود جديدة على الملاحظات ──
    try {
      var notesRes = getStudentNotes(studentId, studentName);
      var newReplies = 0;
      if (notesRes.ok && notesRes.notes) {
        for (var rni = 0; rni < notesRes.notes.length; rni++) {
          if (notesRes.notes[rni].reply && notesRes.notes[rni].reply.trim()) newReplies++;
        }
      }
      result.notes = newReplies;
    } catch (e) {}

    // ── 4. واجبات جديدة ──
    try {
      var allHw  = getAssignmentsForStudent(klass, section);
      var newHw  = 0;
      for (var hi = 0; hi < allHw.length; hi++) {
        var hd = allHw[hi].date ? new Date(allHw[hi].date) : new Date(0);
        if (hd > lastLogin) newHw++;
      }
      result.homework = newHw;
    } catch (e) {}

    result.total = result.news + result.violations + result.notes + result.homework;
    return { ok: true, badge: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
// ══════════════════════════════════════════════════════
// _logStudentAction — سجل العمليات الحساسة
// أضفها في StudentLogic.gs
// ══════════════════════════════════════════════════════
function _logStudentAction(studentId, action, details) {
  try {
    var ss    = _getSS();
    var sheet = ss.getSheetByName('سجل_العمليات');
    if (!sheet) {
      sheet = ss.insertSheet('سجل_العمليات');
      sheet.getRange(1, 1, 1, 5).setValues([[
        'التاريخ', 'كود الطالب', 'العملية', 'التفاصيل', 'حالة النظام'
      ]]);
    }
    sheet.appendRow([
      _nowString(),
      studentId,
      action,
      details || '',
      'طبيعي'
    ]);
  } catch (e) {
    // لا نُوقف التنفيذ بسبب خطأ في السجل
    console.warn('_logStudentAction error:', e.message);
  }
}
// مثال استدعاء: بعد changePassword الناجحة:
// _logStudentAction(studentId, 'تغيير_كلمة_مرور', 'ناجح');
// ══════════════════════════════════════════════════════
// runDataIntegrityCheck — فحص سلامة البيانات
// شغّله يدوياً أو أضفه كـ Trigger أسبوعي
// ══════════════════════════════════════════════════════
function runDataIntegrityCheck() {
  var report = [];
  var studentFile = _getSS();

  // 1. فحص الطلاب الذين لا توجد لهم رسوم
  try {
    var studSheet = studentFile.getSheetByName('الطلاب');
    var feesSheet = studentFile.getSheetByName('الرسوم');
    if (studSheet && feesSheet) {
      var studData = studSheet.getRange(2, 1, studSheet.getLastRow() - 1, 1).getValues();
      var feesData = feesSheet.getDataRange().getValues();
      var feesCodes = {};
      for (var fi = 1; fi < feesData.length; fi++) feesCodes[_safeStr(feesData[fi][0])] = true;
      var missingFees = 0;
      for (var si = 0; si < studData.length; si++) {
        var code = _safeStr(studData[si][0]);
        if (code && !feesCodes[code]) missingFees++;
      }
      if (missingFees > 0) report.push('⚠️ ' + missingFees + ' طالب ليس لديهم سجل رسوم');
      else report.push('✅ جميع الطلاب لديهم سجل رسوم');
    }
  } catch (e) { report.push('❌ خطأ في فحص الرسوم: ' + e.message); }

  // 2. فحص الجدول
  try {
    var schedSheet = studentFile.getSheetByName('الجدول');
    var schedRows  = schedSheet ? Math.max(0, schedSheet.getLastRow() - 1) : 0;
    report.push(schedRows > 0 ? ('✅ الجدول يحتوي ' + schedRows + ' حصة') : '⚠️ الجدول فارغ');
  } catch (e) {}

  // 3. فحص إعدادات الحجب
  try {
    var setSheet = studentFile.getSheetByName('الاعدادات');
    var blockPct = setSheet ? _safeFloat(setSheet.getRange('A2').getValue()) : 0;
    report.push(blockPct > 0 ? ('✅ الحجب مُفعَّل: ' + blockPct + '%') : '⚠️ الحجب المالي معطل (A2 = 0)');
  } catch (e) {}

  var fullReport = report.join('\n');
  Logger.log('══ تقرير سلامة البيانات ══\n' + fullReport);
  return { ok: true, report: report, time: _nowString() };
}
// ============================================================
// مزامنة المخالفات من ملف المعلمين إلى ملف الطالب
// يُشغَّل يومياً عبر Trigger، ويُستدعى بعد كل تسجيل مخالفة
// ============================================================
function syncViolationsFromMaster() {
  // ★ بعد التوحيد: المصدر والهدف نفس الملف — لا حاجة للنسخ
  return { ok: true, synced: 0, note: 'موحّد — لا حاجة للمزامنة' };
}
// ============================================================
// مزامنة الملاحظات من ملف الطالب إلى ملف المعلمين
// ============================================================
function syncNotesToMaster() {
  return { ok: true, merged: true, note: 'موحّد — لا حاجة للمزامنة' };
}

// ============================================================
// مهاجرة روابط Drive القديمة إلى thumbnail
// شغّل هذه الدالة مرة واحدة من المحرر
// ============================================================
function migrateExistingDriveUrls() {
  try {
    var ss = _getSS();
    var sheetsToCheck = ['الاخبار'];
    var count = 0;

    for (var si = 0; si < sheetsToCheck.length; si++) {
      var sheet = ss.getSheetByName(sheetsToCheck[si]);
      if (!sheet) continue;

      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        // العمود 6 (الفهرس 5) هو الملحقات/الصورة
        var url = _safe(data[i][5]);
        if (!url) continue;

        var newUrl = _migrateDriveUrl(url);
        if (newUrl !== url) {
          sheet.getRange(i + 1, 6).setValue(newUrl);
          count++;
        }
      }
    }

    SpreadsheetApp.flush();
    console.log('تمت مهاجرة ' + count + ' رابط Drive');
    return { ok: true, migrated: count };
  } catch (e) {
    console.error('migrateExistingDriveUrls error:', e);
    return { ok: false, error: e.message };
  }
}

function _migrateDriveUrl(url) {
  if (!url || url.indexOf('drive.google.com') === -1) return url;
  // إذا كان بصيغة thumbnail صحيحة بالفعل
  if (url.indexOf('thumbnail?id=') !== -1) return url;

  // استخراج الـ ID
  var id = '';
  var patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/
  ];
  for (var p = 0; p < patterns.length; p++) {
    var m = url.match(patterns[p]);
    if (m && m[1]) { id = m[1]; break; }
  }

  return id
    ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w800'
    : url;
}

// ============================================================
// الغياب اليومي — StudentLogic.gs
// يقرأ من ملف المعلمين (الغياب) مباشرة
// ============================================================

/**
 * جلب سجل غياب الطالب من منصة المعلمين
 * @param {string} studentId - كود الطالب
 */
function getAttendanceForStudent(studentIdOrParams) {
  try {
    // ═══════════════════════════════════════════════
    //  v2.1 — قبول الشكلين: كائن params أو معامل منفرد
    // ═══════════════════════════════════════════════
    var studentId;
    if (typeof studentIdOrParams === 'object' && studentIdOrParams !== null) {
      studentId = _safe(studentIdOrParams.studentId || studentIdOrParams.code || studentIdOrParams.id || '');
    } else {
      studentId = _safe(studentIdOrParams);
    }

    if (!studentId) return { ok: false, error: 'كود الطالب مطلوب' };

    var cKey   = 'att_' + studentId;
    var cached = _cacheGet(cKey);
    if (cached) return cached;

    var master = _getSSById('1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM');
    var sheet  = master.getSheetByName('الغياب');
    if (!sheet) return { ok: true, records: [], total: 0 };

    var data = sheet.getDataRange().getDisplayValues();
    var out  = [];

    for (var i = 1; i < data.length; i++) {
      var code   = _safe(data[i][0]);
      var status = _safe(data[i][5]);
      if (code !== studentId) continue;
      if (status === 'حاضر') continue;
      out.push({
        date    : _safe(data[i][4]),
        status  : status,
        recorder: _safe(data[i][7])
      });
    }

    out.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });

    var result = { ok: true, records: out, total: out.length };
    _cacheSet(cKey, result, 120); // كاش دقيقتان
    return result;
  } catch (e) {
    console.error('getAttendanceForStudent error:', e);
    return { ok: false, error: e.message };
  }
}


/**
 * تحديث رقم جوال الطالب (من منصة الطالب)
 * يكتب مباشرة في ملف المعلمين لأنه المصدر الرئيسي
 * @param {string} studentId - كود الطالب
 * @param {string} phone     - رقم الجوال الجديد
 */
function updateMyPhoneNumber(studentId, phone) {
  try {
    studentId = _safe(studentId);
    phone     = _safe(phone).replace(/[^0-9+]/g, '');

    if (!studentId) return { ok: false, error: 'كود الطالب مطلوب' };
    if (phone.length < 9) return { ok: false, error: 'رقم الجوال يجب أن يكون 9 أرقام على الأقل' };

    // الكتابة في ملف المعلمين (المصدر الرئيسي)
    var master    = _getSSById('1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM');
    var sheet     = master.getSheetByName('الطلاب');
    if (!sheet) return { ok: false, error: 'ورقة الطلاب غير موجودة' };

    // قراءة الرأس لإيجاد عمود الجوال
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var phoneCol = -1;
    for (var h = 0; h < headers.length; h++) {
      var hv = _safe(headers[h]).trim();
      if (hv === 'رقم الجوال' || hv === 'الجوال' || hv === 'رقم الهاتف') {
        phoneCol = h + 1; // 1-indexed
        break;
      }
    }
    if (phoneCol < 0) return { ok: false, error: 'عمود رقم الجوال غير موجود. أضف عنوان "رقم الجوال" في الشيت.' };

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safe(data[i][0]) === studentId) {
        sheet.getRange(i + 1, phoneCol).setValue(phone);
        SpreadsheetApp.flush();
        // مسح الكاش
        _cacheDel('att_' + studentId);
        return { ok: true, message: 'تم تحديث رقم الجوال بنجاح' };
      }
    }
    return { ok: false, error: 'الطالب غير موجود' };
  } catch (e) {
    console.error('updateMyPhoneNumber error:', e);
    return { ok: false, error: e.message };
  }
}
// ╔══════════════════════════════════════════════════════════════════╗
// ║  نظام الأخبار المتكامل — StudentLogic.gs                        ║
// ║  أضف هذه الدوال في نهاية StudentLogic.gs                        ║
// ║  المعيار: ES5 خالص — var فقط — لا arrow functions               ║
// ╚══════════════════════════════════════════════════════════════════╝

// ══════════════════════════════════════════════════════════════════
// ① getStudentNewsFiltered — أخبار مع فلاتر (للطالب)
//    يُستدعى من Student Portal بدلاً من getStudentNews المباشرة
// ══════════════════════════════════════════════════════════════════
function getStudentNewsFiltered(params) {
  try {
    _resolveTenant(params);   // ✅ عزل المدرسة

    var klass      = _safe(params.klass   || '');
    var section    = _safe(params.section || '');
    var sortOrder  = _safe(params.sortOrder || 'newest');
    var dateFrom   = _safe(params.dateFrom  || '');
    var dateTo     = _safe(params.dateTo    || '');
    var pageNum    = parseInt(params.page     || 1, 10);
    var pageSize   = parseInt(params.pageSize || 15, 10);
    var studentId  = _safe(params.studentId  || '');

    var cKey    = _ck('newsf', klass + '_' + section);  // ✅ كاش معزول
    var baseRaw = _cacheGet(cKey);

    if (!baseRaw) {
      var teacherFile = _getSSById(_activeFileId());   // ✅ ديناميكي
      var newsSheet   = teacherFile.getSheetByName('الاخبار');
      if (!newsSheet) return { success: true, news: [], total: 0 };

      var data = newsSheet.getDataRange().getDisplayValues();
      baseRaw  = [];

      for (var i = 1; i < data.length; i++) {
        var r        = data[i];
        var newsText = _safe(r[4]);
        if (!newsText) continue;

        var rowClass   = _safe(r[2]);
        var rowSection = _safe(r[3]);

        var classMatch   = !rowClass   || rowClass   === 'جميع الفصول' || rowClass   === klass;
        var sectionMatch = !rowSection || rowSection === 'جميع الشعب'  || rowSection === section;
        if (!classMatch || !sectionMatch) continue;

        var attachUrl      = _safe(r[5]);
        var attachmentInfo = _processAttachmentUrl(attachUrl);

        baseRaw.push({
          id          : _safe(r[0]),
          teacher     : _safe(r[1]),
          grade       : rowClass   || 'الجميع',
          section     : rowSection || 'الجميع',
          content     : newsText,
          attachments : attachmentInfo.displayUrl,
          hasAttach   : attachmentInfo.hasAttach,
          isImage     : attachmentInfo.isImage,
          isPdf       : attachmentInfo.isPdf,
          isVideo     : attachmentInfo.isVideo,
          fileType    : attachmentInfo.fileType,
          date        : _safe(r[6])
        });
      }

      _cacheSet(cKey, baseRaw, CACHE_CONFIG.NEWS || 180);
    }

    // ── باقي الدالة كما هو بدون تغيير (فلاتر، إعجابات، ترتيب، pagination) ──
    var filtered = [];
    for (var fi = 0; fi < baseRaw.length; fi++) {
      var item = baseRaw[fi];
      if (dateFrom && item.date < dateFrom) continue;
      if (dateTo   && item.date > dateTo)   continue;
      filtered.push(item);
    }

    var viewsMap = _getStudentViewsMap();
    var likesMap = _getStudentLikesMap();

    for (var vi = 0; vi < filtered.length; vi++) {
      var nItem    = filtered[vi];
      var nId      = nItem.id;
      nItem.views  = (viewsMap[nId] || []).length;
      nItem.likes  = (likesMap[nId] || []).length;

      nItem.myLike = false;
      if (studentId && likesMap[nId]) {
        for (var li = 0; li < likesMap[nId].length; li++) {
          if (likesMap[nId][li].userId === studentId) {
            nItem.myLike = true; break;
          }
        }
      }

      var firstLikers = [];
      var likersArr   = likesMap[nId] || [];
      for (var fli = 0; fli < likersArr.length && fli < 3; fli++) {
        firstLikers.push(likersArr[fli].userName);
      }
      nItem.firstLikers = firstLikers;
    }

    if (sortOrder === 'oldest') {
      filtered.sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
    } else if (sortOrder === 'mostLiked') {
      filtered.sort(function(a, b) { return b.likes - a.likes; });
    } else {
      filtered.sort(function(a, b) { return parseInt(b.id || 0, 10) - parseInt(a.id || 0, 10); });
    }

    var total     = filtered.length;
    var startIdx  = (pageNum - 1) * pageSize;
    var pageItems = filtered.slice(startIdx, startIdx + pageSize);

    return {
      success  : true,
      news     : pageItems,
      total    : total,
      page     : pageNum,
      pageSize : pageSize,
      hasMore  : (startIdx + pageSize) < total
    };

  } catch (e) {
    console.error('getStudentNewsFiltered error:', e);
    return { success: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// ② recordStudentNewsView — تسجيل مشاهدة الطالب (مرة واحدة)
// ══════════════════════════════════════════════════════════════════
function recordStudentNewsView(params) {
  try {
    var newsId    = _safe(params.newsId);
    var studentId = _safe(params.studentId);
    var userName  = _safe(params.userName || studentId);

    if (!newsId || !studentId) return { success: false, error: 'newsId وstudentId مطلوبان' };

    var sheet = _getOrCreateSheet('اخبار_مشاهدات', [
      'newsId', 'userId', 'userName', 'userType', 'timestamp'
    ]);

    // التحقق من عدم التكرار
    var data    = sheet.getDataRange().getValues();
    var already = false;
    for (var i = 1; i < data.length; i++) {
      if (_safe(data[i][0]) === newsId && _safe(data[i][1]) === studentId) {
        already = true; break;
      }
    }

    if (!already) {
      sheet.appendRow([newsId, studentId, userName, 'student', _nowString()]);
      SpreadsheetApp.flush();
      // مسح كاش العدد
      _cacheDel('nvcount_' + newsId);
    }

    return { success: true, alreadyViewed: already };
  } catch (e) {
    console.error('recordStudentNewsView error:', e);
    return { success: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// ③ toggleStudentNewsLike — إعجاب / إلغاء إعجاب (من الطالب)
// ══════════════════════════════════════════════════════════════════
function toggleStudentNewsLike(params) {
  try {
    var newsId    = _safe(params.newsId);
    var studentId = _safe(params.studentId);
    var userName  = _safe(params.userName || studentId);

    if (!newsId || !studentId) return { success: false, error: 'newsId وstudentId مطلوبان' };

    var sheet = _getOrCreateSheet('اخبار_اعجابات', [
      'newsId', 'userId', 'userName', 'userType', 'timestamp'
    ]);

    var data     = sheet.getDataRange().getValues();
    var foundRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (_safe(data[i][0]) === newsId && _safe(data[i][1]) === studentId) {
        foundRow = i + 1; break;
      }
    }

    var liked;
    if (foundRow > 0) {
      sheet.deleteRow(foundRow);
      liked = false;
    } else {
      sheet.appendRow([newsId, studentId, userName, 'student', _nowString()]);
      liked = true;
    }
    SpreadsheetApp.flush();

    // إعادة الإحصاء
    data = sheet.getDataRange().getValues();
    var count      = 0;
    var firstNames = [];
    for (var ci = 1; ci < data.length; ci++) {
      if (_safe(data[ci][0]) === newsId) {
        count++;
        if (firstNames.length < 3) firstNames.push(_safe(data[ci][2]));
      }
    }

    _cacheDel('nlcount_' + newsId);
    return {
      success     : true,
      liked       : liked,
      likesCount  : count,
      firstLikers : firstNames
    };
  } catch (e) {
    console.error('toggleStudentNewsLike error:', e);
    return { success: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// ④ دوال مساعدة داخلية للطالب
// ══════════════════════════════════════════════════════════════════


function _getStudentViewsMap() {
  var map   = {};
  var sheet = _getSS().getSheetByName('اخبار_مشاهدات');
  if (!sheet) return map;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var nid = _safe(data[i][0]);
    if (!nid) continue;
    if (!map[nid]) map[nid] = [];
    map[nid].push({ userId: _safe(data[i][1]), ts: _safe(data[i][4]) });
  }
  return map;
}

function _getStudentLikesMap() {
  var map   = {};
  var sheet = _getSS().getSheetByName('اخبار_اعجابات');
  if (!sheet) return map;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var nid = _safe(data[i][0]);
    if (!nid) continue;
    if (!map[nid]) map[nid] = [];
    map[nid].push({
      userId   : _safe(data[i][1]),
      userName : _safe(data[i][2])
    });
  }
  return map;
}
/**
 * دالة تشخيص — تكشف بالضبط أين تكمن المشكلة في عرض الأخبار
 * شغّلها يدوياً من محرر Apps Script وافحص Logger
 */
function diagnoseStudentNews() {
  Logger.log('═══════ تشخيص أخبار الطلاب ═══════');

  // ① تحقق من توفر الدوال المطلوبة
  Logger.log('1️⃣ فحص الدوال:');
  try {
    var testId = extractDriveFileId('https://drive.google.com/thumbnail?id=TEST123&sz=w1400');
    Logger.log('   ✅ extractDriveFileId يعمل — استخرج: ' + testId);
  } catch (e) {
    Logger.log('   ❌ extractDriveFileId مفقودة! يجب نسخها من DriveUrlUtils.gs');
    return;
  }

  // ② فحص الوصول لملف المعلم
  Logger.log('\n2️⃣ فحص الوصول لملف المعلم:');
  var teacherFile;
  try {
    teacherFile = _getSSById('1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM');
    Logger.log('   ✅ تم فتح ملف المعلم: ' + teacherFile.getName());
  } catch (e) {
    Logger.log('   ❌ فشل فتح ملف المعلم: ' + e.message);
    return;
  }

  // ③ فحص ورقة الأخبار
  Logger.log('\n3️⃣ فحص ورقة الأخبار:');
  var sheet = teacherFile.getSheetByName('الاخبار');
  if (!sheet) {
    Logger.log('   ❌ ورقة "الاخبار" غير موجودة في ملف المعلم');
    return;
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  Logger.log('   ✅ الورقة موجودة — ' + lastRow + ' صف × ' + lastCol + ' عمود');

  if (lastRow < 2) {
    Logger.log('   ⚠️ الورقة لا تحتوي على بيانات');
    return;
  }

  // ④ فحص آخر 3 صفوف
  Logger.log('\n4️⃣ فحص آخر 3 صفوف:');
  var startRow = Math.max(2, lastRow - 2);
  var data = sheet.getRange(startRow, 1, lastRow - startRow + 1, lastCol).getDisplayValues();

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    Logger.log('   ─── صف ' + (startRow + i) + ' ───');
    Logger.log('   [0] رقم: "' + r[0] + '"');
    Logger.log('   [1] المعلم: "' + r[1] + '"');
    Logger.log('   [2] الفصل: "' + r[2] + '"');
    Logger.log('   [3] الشعبة: "' + r[3] + '"');
    Logger.log('   [4] الخبر: "' + (r[4] ? r[4].substring(0, 50) + '...' : '(فارغ)') + '"');
    Logger.log('   [5] الملحقات: "' + r[5] + '"');
    Logger.log('   [6] التاريخ: "' + r[6] + '"');

    // فحص المرفق
    if (r[5]) {
      var attach = _processAttachmentUrl(r[5]);
      Logger.log('   ▶ نوع المرفق: ' + attach.fileType +
                 ' | isImage=' + attach.isImage +
                 ' | displayUrl=' + attach.displayUrl);
    }
  }

  // ⑤ اختبار الدالة الكاملة
  Logger.log('\n5️⃣ اختبار getStudentNews لفصل "السادس" شعبة "أ":');
  // امسح الكاش أولاً
  try { _cacheDel('news_السادس_أ'); } catch (e) {}
  var news = getStudentNews('السادس', 'أ');
  Logger.log('   📊 عدد الأخبار المُرجعة: ' + news.length);
  if (news.length > 0) {
    Logger.log('   📰 أول خبر:');
    Logger.log('   ' + JSON.stringify(news[0], null, 2));
  }

  Logger.log('\n═══════ انتهى التشخيص ═══════');
}

/**
 * تثبيت Triggers تلقائية للمزامنة
 * نفّذ هذه الدالة مرة واحدة من المحرر
 */
function installDailySyncTriggers() {
  // حذف Triggers قديمة بنفس الاسم
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'syncRecentGradesFromMaster' || fn === 'autoSyncAllStudentData') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // مزامنة شاملة كل يوم 2 صباحاً
  ScriptApp.newTrigger('autoSyncAllStudentData')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();

  // مزامنة الدرجات كل 4 ساعات أثناء النهار
  ScriptApp.newTrigger('syncRecentGradesFromMaster')
    .timeBased()
    .everyHours(4)
    .create();

  Logger.log('✅ تم تثبيت Triggers المزامنة بنجاح');
  return { ok: true };
}

/**
 * المزامنة الشاملة اليومية
 */
function autoSyncAllStudentData() {
  var results = { grades: null, fees: null, errors: [] };
  
  try { results.grades = syncRecentGradesFromMaster(); }
  catch (e) { results.errors.push('grades: ' + e.message); }
  
  try { results.fees = syncFeesFromMaster(); }
  catch (e) { results.errors.push('fees: ' + e.message); }
  
  // تنظيف الكاش بعد المزامنة
  try {
    var cache = CacheService.getScriptCache();
    cache.removeAll(['grades_all', 'students_list']);
  } catch (e3) { /* تجاهل */ }
  
  Logger.log('autoSyncAllStudentData: ' + JSON.stringify(results));
  return results;
}