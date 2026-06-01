/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  School App Yemen — منصة المعلمين / المدرسين
 *  File: TeacherAuth.gs  (Google Apps Script — Authentication Module)
 *
 *  ══ الأدوار المدعومة ══
 *  - admin      : المدير (المادة=المدير + الفصل=المدير + الشعبة=المدير)
 *  - deputy     : الوكيل (المادة=الوكيل + الفصل=الوكيل + الشعبة=الوكيل)
 *  - supervisor : المشرف (المادة=مشرف + الفصل=مشرف + الشعبة=مشرف) [صلاحيات مدير باستثناء الحجب المالي]
 *  - teacher    : معلم عادي (صلاحياته حسب صفوفه في الشيت)
 *
 *  ══ تحسينات هذا الإصدار ══
 *  - تسجيل الدخول يدعم المطابقة الجزئية للأسماء (أول كلمة من الاسم، أو الاسم الكامل)
 *  - حماية من هجمات القوة الغاشمة (حد أقصى 5 محاولات فاشلة لكل clientId).
 *  - جلسات آمنة باستخدام CacheService مع صلاحية 8 ساعات.
 *  - دوال withAuth لحماية الـ endpoints.
 *  - معالجة ديناميكية لـ "جميع الشعب" من ورقة الطلاب.
 *  - 🆕 هاش كلمات المرور SHA-256 مع ترقية تلقائية (إصدار 2026)
 *  - 🆕 تتبع الجلسات النشطة عبر ScriptProperties
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ══════════════════════════════════════════════════════
//  الإعدادات
// ══════════════════════════════════════════════════════

var AUTH_SPREADSHEET_ID = '1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM';
var SESSION_TTL         = 28800;      // 8 ساعات بالثواني
var SESSION_KEY_PREFIX  = 'session_';
var MAX_LOGIN_ATTEMPTS  = 5;
var RATE_LIMIT_TTL      = 900;        // 15 دقيقة

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
var AUTH_CACHE_TTL = {
  SESSION   : 28800,  // الجلسات (8 ساعات)
  RATE      : 900,    // Rate Limiting (15 دقيقة)
  SECTIONS  : 300,    // الشعب (5 دقائق)
  TEACHERS  : 600     // قائمة المدرسين (10 دقائق)
};

// ══════════════════════════════════════════════════════
// 🆕 نظام هاش كلمات المرور SHA-256 مع Salt
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
    Logger.log('تمت ترقية كلمة مرور المعلم صف: ' + rowIndex);
  } catch (e) {
    Logger.log('_migratePasswordIfNeeded error: ' + e.message);
  }
}
// ══════════════════════════════════════════════════════
//  تسجيل الدخول (النسخة المحسنة: اسم المستخدم + كلمة المرور)
// ══════════════════════════════════════════════════════
function handleTeacherLogin(params) {
  var username = (params.username || '').toString().trim();
  var password = (params.password || '').toString().trim();
  var clientId = (params.clientId || 'unknown').toString().trim();
  var schoolId = (params.schoolId || '').toString().trim();  // ← أضف هذا

  // ★ فعّل ملف المستأجر الصحيح قبل أي عملية بحث أو تحقق
  _setActiveTenant(schoolId);

  // التحقق من المدخلات
  if (!username || !password) {
    return { success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' };
  }

  // التحقق من معدل المحاولات
  if (_auth_isRateLimited(clientId)) {
    Logger.log('RATE LIMITED: clientId=' + clientId);
    return {
      success    : false,
      error      : 'تم تجاوز عدد محاولات الدخول. يرجى الانتظار 15 دقيقة.',
      rateLimited: true
    };
  }

  // البحث عن المعلم بالاسم وكلمة المرور (يدعم المطابقة الجزئية والهاش التلقائي)
  var teacher = _auth_findTeacherByUsernameAndPasswordFuzzy(username, password);

  if (!teacher) {
    _auth_recordFailedAttempt(clientId);
    Logger.log('LOGIN FAILED: username=' + username + ', clientId=' + clientId);
    return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
  }

  // إنشاء جلسة جديدة
  var token = _auth_generateToken();
  var session = {
    teacherName : teacher.name,
    schoolId    : schoolId,        // ← أضف هذا السطر
    subjects    : teacher.subjects,
    classes     : teacher.classes,
    sections    : teacher.sections,
    isAdmin     : teacher.isAdmin,
    role        : teacher.role,
    createdAt   : new Date().toISOString(),
    expires     : Date.now() + (SESSION_TTL * 1000)
  };
  _auth_storeSession(token, session);
  _auth_clearFailedAttempts(clientId);

  Logger.log('LOGIN SUCCESS: ' + teacher.name + ' | role=' + teacher.role +
             ' | isAdmin=' + teacher.isAdmin + ' | schoolId=' + schoolId);

  return {
    success    : true,
    token      : token,
    teacherName: teacher.name,
    subjects   : teacher.subjects,
    classes    : teacher.classes,
    sections   : teacher.sections,
    subject    : teacher.subjects[0]  || '',
    grade      : teacher.classes[0]   || '',
    section    : teacher.sections[0]  || '',
    isAdmin    : teacher.isAdmin,
    role       : teacher.role,
    expiresIn  : SESSION_TTL
  };
}
// ══════════════════════════════════════════════════════
//  تسجيل الخروج
// ══════════════════════════════════════════════════════

function handleTeacherLogout(params) {
  var token = (params.token || '').toString().trim();
  if (token) {
    _auth_deleteSession(token);
    Logger.log('LOGOUT: token=' + token.substring(0, 8) + '...');
  }
  return { success: true, message: 'تم تسجيل الخروج بنجاح' };
}

// ══════════════════════════════════════════════════════
//  التحقق من الجلسة
// ══════════════════════════════════════════════════════

function validateSession(token) {
  if (!token || typeof token !== 'string' || token.length < 10) return null;
  var session = _auth_getSession(token);
  if (!session) return null;
  if (session.expires && Date.now() > session.expires) {
    _auth_deleteSession(token);
    Logger.log('EXPIRED TOKEN: ' + token.substring(0, 8) + '...');
    return null;
  }
  return session;
}
/**
 * checkSession — إرجاع نفس هيكل handleTeacherLogin لضمان التوافق مع الواجهة
 */
function checkSession(token) {
  var session = validateSession(token);
  if (!session) return { valid: false, error: 'الجلسة منتهية أو غير صالحة' };
  _setActiveTenant(session.schoolId || ''); 

  // معالجة "جميع الشعب" إذا كانت موجودة
  var sections     = session.sections || [];
  var hasAllSec    = (sections.indexOf('جميع الشعب') !== -1);

  if (hasAllSec || sections.length === 0) {
    var clean = [];
    for (var fi = 0; fi < sections.length; fi++) {
      if (sections[fi] !== 'جميع الشعب') clean.push(sections[fi]);
    }
    var real = _getAllRealSections(session.classes || []);
    for (var ri = 0; ri < real.length; ri++) {
      if (clean.indexOf(real[ri]) === -1) clean.push(real[ri]);
    }
    if (clean.length === 0) clean = ['أ', 'ب', 'ج'];
    sections         = clean;
    session.sections = clean;
    _auth_storeSession(token, session);
  }

  return {
    valid       : true,
    token       : token,
    teacherName : session.teacherName,
    schoolId    : session.schoolId || '',   // ← أضف هذا السطر
    subjects    : session.subjects  || [],
    classes     : session.classes   || [],
    sections    : sections,
    isAdmin     : session.isAdmin   || false,
    role        : session.role      || 'teacher',
    subject     : (session.subjects  || [''])[0],
    grade       : (session.classes   || [''])[0],
    section     : sections[0]       || '',
    expiresIn   : SESSION_TTL
  };
}
// ══════════════════════════════════════════════════════
//  دوال الحماية (withAuth)
// ══════════════════════════════════════════════════════

function withAuth(params, callback) {
  var token   = ((params && params.token) || '').toString().trim();
  var session = validateSession(token);
  if (!session) {
    return {
      success      : false,
      error        : 'انتهت صلاحية جلستك. يرجى تسجيل الدخول مجدداً.',
      requiresLogin: true
    };
  }
  _setActiveTenant(session.schoolId);
  _auth_refreshSession(token);
  try {
    return callback(session);
  } catch (e) {
    Logger.log('withAuth callback error: ' + e.toString());
    return { success: false, error: 'حدث خطأ في الخادم: ' + e.message };
  }
}

function withAuthAndClass(params, grade, section, callback) {
  return withAuth(params, function(session) {
    if (session.isAdmin) return callback(session);

    // التحقق من الفصل
    if (grade && session.classes &&
        session.classes.indexOf('جميع الفصول') === -1 &&
        session.classes.indexOf(grade) === -1) {
      return { success: false, error: 'ليس لديك صلاحية الوصول إلى الفصل "' + grade + '"' };
    }

    // التحقق من الشعبة
    if (section && session.sections && session.sections.length > 0 &&
        session.sections.indexOf('جميع الشعب') === -1 &&
        session.sections.indexOf(section) === -1 &&
        section !== 'جميع الشعب') {
      return { success: false, error: 'ليس لديك صلاحية الوصول إلى الشعبة "' + section + '"' };
    }

    return callback(session);
  });
}

function withAuthAndSubject(params, subject, callback) {
  return withAuth(params, function(session) {
    if (session.isAdmin) return callback(session);
    if (subject && session.subjects &&
        session.subjects.indexOf('جميع المواد') === -1 &&
        session.subjects.indexOf(subject) === -1) {
      return { success: false, error: 'ليس لديك صلاحية مادة "' + subject + '"' };
    }
    return callback(session);
  });
}

// ══════════════════════════════════════════════════════
//  البحث عن المعلم بالاسم وكلمة المرور مع دعم المطابقة الجزئية
// ══════════════════════════════════════════════════════
function _auth_findTeacherByUsernameAndPasswordFuzzy(username, password) {
  try {
    // ★ استخدم الملف النشط ديناميكيًا بدلاً من المعرف الثابت
    var ss = _getSSById(_activeFileId());
    var sheet = ss.getSheetByName('المدرسين');
    if (!sheet) return null;

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return null;

    // البحث عن تطابق تام للاسم الكامل (مع دعم الهاش)
    var exactMatch = null;
    for (var i = 1; i < data.length; i++) {
      var rowName = _safeStr(data[i][0]);
      var rowPassword = _safeStr(data[i][4]);
      if (rowName === username && _verifyPassword(password, rowPassword)) {
        exactMatch = rowName;
        // ترقية كلمة المرور تلقائياً إن كانت قديمة
        if (String(rowPassword).indexOf(PASSWORD_HASH_PREFIX) !== 0) {
          _migratePasswordIfNeeded(sheet, i + 1, 5, password);
        }
        break;
      }
    }
    if (exactMatch) {
      return _auth_buildTeacherFromName(exactMatch, data);
    }

    // البحث عن تطابق باستخدام أول كلمة من الاسم
    var firstWord = username.split(/\s+/)[0];
    if (firstWord.length < 2) return null;

    var potentialMatches = [];
    for (var j = 1; j < data.length; j++) {
      var fullName = _safeStr(data[j][0]);
      var pwd = _safeStr(data[j][4]);
      if (!_verifyPassword(password, pwd)) continue;

      var nameWords = fullName.split(/\s+/);
      if (nameWords.length > 0 && nameWords[0] === firstWord) {
        potentialMatches.push({ name: fullName, row: j + 1, password: password });
      }
    }

    if (potentialMatches.length === 1) {
      var match = potentialMatches[0];
      var storedRowPassword = _safeStr(data[match.row - 1][4]);
      if (String(storedRowPassword).indexOf(PASSWORD_HASH_PREFIX) !== 0) {
        _migratePasswordIfNeeded(sheet, match.row, 5, match.password);
      }
      Logger.log('Fuzzy match: username="' + username + '" matched "' + match.name + '"');
      return _auth_buildTeacherFromName(match.name, data);
    }

    if (potentialMatches.length > 1) {
      Logger.log('Ambiguous username: "' + username + '" matches multiple teachers');
      return null;
    }

    return null;
  } catch (e) {
    Logger.log('_auth_findTeacherByUsernameAndPasswordFuzzy error: ' + e.toString());
    return null;
  }
}
/**
 * بناء كائن المعلم من اسمه (بعد جمع جميع صفوفه في الشيت)
 * @param {string} teacherName - الاسم الكامل للمعلم
 * @param {Array} data - بيانات ورقة المدرسين (getValues)
 */
function _auth_buildTeacherFromName(teacherName, data) {
  var subjects = [];
  var classes = [];
  var sections = [];

  for (var j = 1; j < data.length; j++) {
    var rName = _safeStr(data[j][0]);
    if (rName !== teacherName) continue;

    var rSubject = _safeStr(data[j][1]);
    var rGrade   = _safeStr(data[j][2]);
    var rSection = _safeStr(data[j][3]);

    if (rSubject && subjects.indexOf(rSubject) === -1) subjects.push(rSubject);
    if (rGrade   && classes.indexOf(rGrade)    === -1) classes.push(rGrade);
    if (rSection && sections.indexOf(rSection) === -1) sections.push(rSection);
  }

  // تحديد الدور (مدير، وكيل، مشرف، معلم)
  var isFullAdmin = (
    subjects.indexOf('المدير') !== -1 &&
    classes.indexOf('المدير')  !== -1 &&
    sections.indexOf('المدير') !== -1
  );

  var isDeputy = (
    subjects.indexOf('الوكيل') !== -1 &&
    classes.indexOf('الوكيل') !== -1 &&
    sections.indexOf('الوكيل') !== -1
  );

  var isSupervisor = (
    subjects.indexOf('مشرف') !== -1 &&
    classes.indexOf('مشرف') !== -1 &&
    sections.indexOf('مشرف') !== -1
  );

  var role;
  var isAdmin;

  if (isFullAdmin) {
    role    = 'admin';
    isAdmin = true;
    subjects = ['جميع المواد'];
    classes  = ['جميع الفصول'];
    sections = ['جميع الشعب'];
  } else if (isDeputy) {
    role    = 'deputy';
    isAdmin = true;
    subjects = ['جميع المواد'];
    classes  = ['جميع الفصول'];
    sections = ['جميع الشعب'];
  } else if (isSupervisor) {
    role    = 'supervisor';
    isAdmin = true;
    subjects = subjects.filter(function(s) { return s !== 'مشرف'; });
    classes  = classes.filter(function(c)  { return c !== 'مشرف'; });
    sections = sections.filter(function(s) { return s !== 'مشرف'; });
    if (subjects.length === 0) subjects = ['جميع المواد'];
    if (classes.length === 0)  classes  = ['جميع الفصول'];
  } else {
    role    = 'teacher';
    isAdmin = false;
  }

  // معالجة الشعب للمعلمين العاديين والمشرفين (غير المدير والوكيل)
  if (!isFullAdmin && !isDeputy) {
    var hasAllSections = (sections.indexOf('جميع الشعب') !== -1);
    if (hasAllSections) {
      var cleanSec = sections.filter(function(s) { return s !== 'جميع الشعب'; });
      var realSec  = _getAllRealSections(classes);
      for (var ri = 0; ri < realSec.length; ri++) {
        if (cleanSec.indexOf(realSec[ri]) === -1) cleanSec.push(realSec[ri]);
      }
      sections = cleanSec.length > 0 ? cleanSec : ['أ', 'ب', 'ج'];
    }
    if (sections.length === 0) sections = ['أ', 'ب', 'ج'];
  }

  return {
    name     : teacherName,
    subjects : subjects,
    classes  : classes,
    sections : sections,
    isAdmin  : isAdmin,
    role     : role
  };
}

// دالة مساعدة لتنظيف النصوص
function _safeStr(s) {
  if (s === null || s === undefined) return '';
  return s.toString().trim();
}

// (اختياري: الاحتفاظ بالدالة القديمة للتوافق مع الكود القديم)
function _auth_findTeacherByPassword(password) {
  Logger.log('تحذير: تم استدعاء _auth_findTeacherByPassword (مهجورة)');
  return null;
}

// ══════════════════════════════════════════════════════
//  جلب الشعب الحقيقية من ورقة الطلاب
// ══════════════════════════════════════════════════════

function _getAllRealSections(forGrades) {
  try {
    var ss    = _getSSById(_activeFileId());
    var sheet = ss.getSheetByName('الطلاب');
    if (!sheet) return ['أ', 'ب', 'ج'];

    var data = sheet.getDataRange().getValues();
    var sections  = [];
    var hasAllGrades = (!forGrades || forGrades.length === 0 ||
                        forGrades.indexOf('جميع الفصول') !== -1);

    for (var i = 1; i < data.length; i++) {
      var rowGrade   = (data[i][2] || '').toString().trim();
      var rowSection = (data[i][3] || '').toString().trim();
      if (!rowSection) continue;
      var gradeMatch = hasAllGrades || (forGrades && forGrades.indexOf(rowGrade) !== -1);
      if (gradeMatch && sections.indexOf(rowSection) === -1) sections.push(rowSection);
    }

    return sections.length > 0 ? sections : ['أ', 'ب', 'ج'];
  } catch (e) {
    Logger.log('_getAllRealSections error: ' + e.toString());
    return ['أ', 'ب', 'ج'];
  }
}

// ══════════════════════════════════════════════════════
//  إدارة الجلسات (CacheService)
// ══════════════════════════════════════════════════════

function _auth_sessionKey(token) { return SESSION_KEY_PREFIX + token; }

function _auth_storeSession(token, sessionData) {
  try {
    CacheService.getScriptCache().put(
      _auth_sessionKey(token),
      JSON.stringify(sessionData),
      SESSION_TTL
    );
    // ═══ تتبع الجلسات النشطة (جديد) ═══
    var props = PropertiesService.getScriptProperties();
    var active = props.getProperty('active_sessions');
    var map = {};
    try { map = active ? JSON.parse(active) : {}; } catch (e) { map = {}; }
    map[token] = sessionData.teacherName;
    // إذا تجاوزت 500 جلسة، احذف الأقدم
    var keys = Object.keys(map);
    if (keys.length > 500) {
      delete map[keys[0]];
    }
    props.setProperty('active_sessions', JSON.stringify(map));
  } catch (e) {
    Logger.log('_auth_storeSession error: ' + e.toString());
  }
}
function _auth_getSession(token) {
  try {
    var raw = CacheService.getScriptCache().get(_auth_sessionKey(token));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function _auth_deleteSession(token) {
  try { CacheService.getScriptCache().remove(_auth_sessionKey(token)); } catch (e) {}
}

function _auth_refreshSession(token) {
  try {
    var session = _auth_getSession(token);
    if (session) _auth_storeSession(token, session);
  } catch (e) {}
}

function _auth_generateToken() {
  var u1 = Utilities.getUuid().replace(/-/g, '');
  var u2 = Utilities.getUuid().replace(/-/g, '');
  return (u1 + u2).substring(0, 40);
}

// ══════════════════════════════════════════════════════
//  حماية من هجمات القوة الغاشمة (Rate Limiting)
// ══════════════════════════════════════════════════════

function _auth_rateLimitKey(clientId) { return 'ratelimit_' + clientId; }

function _auth_isRateLimited(clientId) {
  try {
    var attempts = parseInt(CacheService.getScriptCache().get(_auth_rateLimitKey(clientId)) || '0');
    return attempts >= MAX_LOGIN_ATTEMPTS;
  } catch (e) { return false; }
}

function _auth_recordFailedAttempt(clientId) {
  try {
    var cache    = CacheService.getScriptCache();
    var key      = _auth_rateLimitKey(clientId);
    var attempts = parseInt(cache.get(key) || '0') + 1;
    cache.put(key, String(attempts), RATE_LIMIT_TTL);
  } catch (e) {}
}

function _auth_clearFailedAttempts(clientId) {
  try { CacheService.getScriptCache().remove(_auth_rateLimitKey(clientId)); } catch (e) {}
}

function getRemainingAttempts(clientId) {
  try {
    var attempts  = parseInt(CacheService.getScriptCache().get(_auth_rateLimitKey(clientId)) || '0');
    var remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - attempts);
    return { success: true, remaining: remaining, isLimited: remaining === 0 };
  } catch (e) {
    return { success: true, remaining: MAX_LOGIN_ATTEMPTS, isLimited: false };
  }
}

// ══════════════════════════════════════════════════════
//  دوال مساعدة إضافية للواجهة
// ══════════════════════════════════════════════════════

function getTeacherFromToken(token) {
  var session = validateSession(token);
  if (!session) return { success: false, error: 'الجلسة غير صالحة أو منتهية' };
  return {
    success     : true,
    teacherName : session.teacherName,
    subjects    : session.subjects,
    classes     : session.classes,
    sections    : session.sections,
    isAdmin     : session.isAdmin,
    role        : session.role || 'teacher'
  };
}

function adminRevokeSession(params, targetTeacherName) {
  return withAuth(params, function(session) {
    if (!session.isAdmin) return { success: false, error: 'للمدير فقط' };
    
    var props = PropertiesService.getScriptProperties();
    var activeSessions = props.getProperty('active_sessions');
    if (!activeSessions) return { success: true, message: 'لا توجد جلسات نشطة' };
    
    var sessionsMap = JSON.parse(activeSessions);
    var revokedCount = 0;
    
    for (var token in sessionsMap) {
      if (sessionsMap[token] === targetTeacherName) {
        _auth_deleteSession(token);
        delete sessionsMap[token];
        revokedCount++;
      }
    }
    
    props.setProperty('active_sessions', JSON.stringify(sessionsMap));
    return { success: true, message: 'تم إلغاء ' + revokedCount + ' جلسة' };
  });
}

// ══════════════════════════════════════════════════════
//  اختبار سريع للنظام (للاستخدام في المحرر فقط)
// ══════════════════════════════════════════════════════

function testAuthSystem() {
  Logger.log('══ بدء اختبار نظام المصادقة ══');
  var token1 = _auth_generateToken();
  Logger.log('Token: ' + token1 + ' | length=' + token1.length);
  var testSession = {
    teacherName: 'تجريبي', subjects: ['الرياضيات'],
    classes: ['الأول'], sections: ['أ'],
    isAdmin: false, role: 'teacher',
    expires: Date.now() + (SESSION_TTL * 1000)
  };
  _auth_storeSession(token1, testSession);
  var retrieved = _auth_getSession(token1);
  Logger.log('Session OK: ' + (retrieved !== null));
  _auth_deleteSession(token1);
  Logger.log('══ انتهى اختبار نظام المصادقة ══');
  return { tokenOk: token1.length === 40, sessionOk: retrieved !== null };
}
