/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  مدارس الإبداع والتميز الدولية – الموقع الرسمي
 *  Code.gs — النسخة الاحترافية المتكاملة (2026)
 *  ═══════════════════════════════════════════════════════════════════════════
 *  المسؤوليات:
 *    1. تقديم الصفحة الرئيسية (Index.html) عبر doGet
 *    2. تجميع بيانات الأخبار / الصور / الفيديوهات / الإحصائيات للموقع
 *    3. توفير endpoint مركزي لروابط جميع منصات المنظومة (DeploymentRegistry)
 *    4. كاش متعدد الطبقات لتقليل قراءة الشيت إلى الحد الأدنى
 *    5. معالجة موحّدة لروابط Google Drive و YouTube وغيرها
 *  ─────────────────────────────────────────────────────────────────────────
 *  معرّف الشيت: 1J7DY-Z2PZU5y5HH-LR3vhuEhPAkjWz22vMu1rYLcse0
 *  الأوراق المعتمدة: News, Images, Videos, Stats
 *  المصادقة: لا توجد (الموقع عام)
 *  ─────────────────────────────────────────────────────────────────────────
 *  قواعد البرمجة الصارمة:
 *    - var فقط (لا const، لا let)
 *    - function() {} (لا arrow functions)
 *    - لا template literals (تفصيل النصوص بـ +)
 *    - متوافق ES5 + Apps Script
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
//  ① الإعدادات العامة
// ═══════════════════════════════════════════════════════════════════════════

var CONFIG = {
  SPREADSHEET_ID: '1J7DY-Z2PZU5y5HH-LR3vhuEhPAkjWz22vMu1rYLcse0',
  CACHE_TTL_SECONDS: 300,            // 5 دقائق (افتراضي)
  DEFAULT_LIMITS: {
    news:   6,
    images: 6,
    videos: 8
  },
  CACHE_CONFIG: {
    NEWS       : 300,   // 5 دقائق
    IMAGES     : 300,
    VIDEOS     : 300,
    STATS      : 600,   // 10 دقائق
    HOME_BUNDLE: 300,
    DEPLOYMENT : 60     // دقيقة واحدة (الروابط نادراً تتغير)
  },
  SHEETS: {
    NEWS  : 'News',
    IMAGES: 'Images',
    VIDEOS: 'Videos',
    STATS : 'Stats'
  },
  TIMEZONE: 'Asia/Aden'
};

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

// ═══════════════════════════════════════════════════════════════════════════
//  ② سجل النشر المركزي (Deployment Registry)
//  يُغذِّي جميع ملفات HTML في المنظومة + تطبيق Android
// ═══════════════════════════════════════════════════════════════════════════

/**
 * الروابط الافتراضية — تُستخدم فقط إذا لم توجد قيمة في ScriptProperties
 * لتحديث رابط: استخدم updateDeploymentUrl(key, newUrl) من المحرر
 */
var DEFAULT_DEPLOYMENTS = {
  DEPLOY_HOME:     'https://script.google.com/macros/s/AKfycbzDfGEK6IpChVNl9k8xbt_iv5p6bLOktt-TvEzDp8yBpH3Ga3yNMen_0S2ZyuuvGtKFCA/exec',
  DEPLOY_CMS:      'https://script.google.com/macros/s/AKfycbz-iAj9L3ROOn4CAjmwkVBUqpWuxIx1LkgPLwKnHu7kHLWKCy3GVJNo1vZbnekop0VlMA/exec',
  DEPLOY_TEACHER:  'https://script.google.com/macros/s/AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND/exec',
  DEPLOY_STUDENT:  'https://script.google.com/macros/s/AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq/exec',
  DEPLOY_SCHEDULE: 'https://script.google.com/macros/s/AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag/exec',
  DEPLOY_MASTER:   'https://script.google.com/macros/s/AKfycbx5H6uYXb-6iVt_nT4YkdnYMhl6eZJSDxsULsKa2eyblZQcwzRo4CXR3Mh_ecRSZd4M/exec',
  DEPLOY_PRICING:  'https://script.google.com/macros/s/AKfycbz11yUbrix4F1lE_GbiAFqE3EClGpoRvAb19LoLoABQX_Xo3i2U25jlQpOFcN9S_yLC/exec'
};

/**
 * الدالة العمومية الرئيسية — تُرجع روابط جميع منصات المنظومة
 * تُستدعى من Index.html عبر google.script.run.getDeploymentUrls()
 * @returns {Object} كائن يحتوي { home, cms, teacher, student, schedule, master, current, ts, version }
 */
function getDeploymentUrls() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('deployment_urls_v2');
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* تجاهل واستمر */ }
    }

    var props = PropertiesService.getScriptProperties();
    var stored = {};
    try { stored = props.getProperties() || {}; } catch (e) { stored = {}; }

    var result = {
      home    : _getDeployUrl(stored, 'DEPLOY_HOME'),
      cms     : _getDeployUrl(stored, 'DEPLOY_CMS'),
      teacher : _getDeployUrl(stored, 'DEPLOY_TEACHER'),
      student : _getDeployUrl(stored, 'DEPLOY_STUDENT'),
      schedule: _getDeployUrl(stored, 'DEPLOY_SCHEDULE'),
      master  : _getDeployUrl(stored, 'DEPLOY_MASTER'),
      pricing : _getDeployUrl(stored, 'DEPLOY_PRICING'),
      current : _getCurrentScriptUrl(),
      ts      : new Date().getTime(),
      version : 'v2'
    };

    try { cache.put('deployment_urls_v2', JSON.stringify(result), CONFIG.CACHE_CONFIG.DEPLOYMENT); } catch (e) {}
    return result;
  } catch (err) {
    return {
      home    : DEFAULT_DEPLOYMENTS.DEPLOY_HOME,
      cms     : DEFAULT_DEPLOYMENTS.DEPLOY_CMS,
      teacher : DEFAULT_DEPLOYMENTS.DEPLOY_TEACHER,
      student : DEFAULT_DEPLOYMENTS.DEPLOY_STUDENT,
      schedule: DEFAULT_DEPLOYMENTS.DEPLOY_SCHEDULE,
      master  : DEFAULT_DEPLOYMENTS.DEPLOY_MASTER,
      pricing : DEFAULT_DEPLOYMENTS.DEPLOY_PRICING,
      current : '',
      ts      : new Date().getTime(),
      version : 'v2',
      error   : String(err && err.message ? err.message : err)
    };
  }
}

/**
 * مساعد داخلي — يجلب رابطاً محدداً بالأولوية:
 *   1. ScriptProperties (الأحدث)
 *   2. DEFAULT_DEPLOYMENTS (احتياطي)
 */
function _getDeployUrl(stored, key) {
  if (stored && stored[key] && _isValidDeploymentUrl(stored[key])) {
    return String(stored[key]);
  }
  return DEFAULT_DEPLOYMENTS[key] || '';
}

/**
 * تحقق من صلاحية شكل الرابط
 */
function _isValidDeploymentUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.indexOf('https://script.google.com/macros/') === 0 &&
         url.indexOf('/exec') > 0;
}

/**
 * يُرجع رابط السكربت الحالي (مفيد للتشخيص)
 */
function _getCurrentScriptUrl() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/**
 * تحديث رابط منصة محددة — يُنفَّذ يدوياً من محرر Apps Script
 * مثال: updateDeploymentUrl('DEPLOY_TEACHER', 'https://script.google.com/macros/s/.../exec')
 */
function updateDeploymentUrl(key, url) {
  try {
    if (!key || !url) return { success: false, error: 'المفتاح والرابط مطلوبان' };
    if (!DEFAULT_DEPLOYMENTS.hasOwnProperty(key)) {
      return { success: false, error: 'مفتاح غير معروف: ' + key };
    }
    if (!_isValidDeploymentUrl(url)) {
      return { success: false, error: 'رابط غير صالح. يجب أن يبدأ بـ https://script.google.com/macros/' };
    }
    PropertiesService.getScriptProperties().setProperty(key, url);
    try { CacheService.getScriptCache().remove('deployment_urls_v2'); } catch (e) {}
    return { success: true, key: key, url: url, ts: new Date().getTime() };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

/**
 * تحديث جماعي لجميع الروابط دفعة واحدة
 * مثال: updateAllDeploymentUrls({ DEPLOY_TEACHER: '...', DEPLOY_STUDENT: '...' })
 */
function updateAllDeploymentUrls(urlsObject) {
  try {
    if (!urlsObject || typeof urlsObject !== 'object') {
      return { success: false, error: 'كائن الروابط مطلوب' };
    }
    var props = PropertiesService.getScriptProperties();
    var updated = [];
    var skipped = [];
    for (var key in urlsObject) {
      if (!urlsObject.hasOwnProperty(key)) continue;
      if (!DEFAULT_DEPLOYMENTS.hasOwnProperty(key)) {
        skipped.push(key + ' (مفتاح غير معروف)');
        continue;
      }
      if (!_isValidDeploymentUrl(urlsObject[key])) {
        skipped.push(key + ' (رابط غير صالح)');
        continue;
      }
      props.setProperty(key, urlsObject[key]);
      updated.push(key);
    }
    try { CacheService.getScriptCache().remove('deployment_urls_v2'); } catch (e) {}
    return { success: true, updated: updated, skipped: skipped, ts: new Date().getTime() };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

/**
 * إعادة جميع الروابط للقيم الافتراضية
 */
function resetDeploymentUrls() {
  try {
    var props = PropertiesService.getScriptProperties();
    var keys = ['DEPLOY_HOME','DEPLOY_CMS','DEPLOY_TEACHER','DEPLOY_STUDENT','DEPLOY_SCHEDULE','DEPLOY_MASTER','DEPLOY_PRICING'];
    for (var i = 0; i < keys.length; i++) props.deleteProperty(keys[i]);
    try { CacheService.getScriptCache().remove('deployment_urls_v2'); } catch (e) {}
    return { success: true, message: 'تمت إعادة التعيين بنجاح' };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

/**
 * عرض الروابط الحالية في سجل التنفيذ (للتشخيص)
 */
function showDeploymentUrls() {
  var urls = getDeploymentUrls();
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('  روابط منظومة مدارس الإبداع والتميز');
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('🏠 الموقع الرسمي  : ' + urls.home);
  Logger.log('📰 CMS            : ' + urls.cms);
  Logger.log('👨‍🏫 المعلمين       : ' + urls.teacher);
  Logger.log('🎓 الطلاب         : ' + urls.student);
  Logger.log('📅 الحصص          : ' + urls.schedule);
  Logger.log('👑 Master Admin   : ' + urls.master);
  Logger.log('📍 الحالي         : ' + urls.current);
  Logger.log('═══════════════════════════════════════════════');
  return urls;
}

/**
 * endpoint عبر HTTP لتطبيق Android (يُستدعى عبر AppConfig.kt)
 * الاستخدام: GET <SCRIPT_URL>?action=deployments
 * يعيد JSON قابلاً للقراءة المباشرة من الـ APK
 */
function _handleDeploymentsRequest() {
  var data = getDeploymentUrls();
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ③ نقطة الدخول الرئيسية (Web App)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * نقطة الدخول الموحّدة:
 *   - GET ?action=deployments  →  JSON برو ابط جميع المنصات
 *   - GET ?action=health       →  حالة النظام
 *   - GET (افتراضي)            →  الصفحة الرئيسية Index.html
 */
function doGet(e) {
  // ─── معالجة معاملات الصفحة والإجراء ───
  if (e && e.parameter) {
    var action = (e.parameter.action || '').toString().toLowerCase();
    var page   = (e.parameter.page   || '').toString().toLowerCase();

    if (action === 'deployments') {
      return _handleDeploymentsRequest();
    }
    if (action === 'health') {
      return _handleHealthRequest();
    }
    if (page === 'privacy') {
      return HtmlService.createHtmlOutputFromFile('Privacy')
        .setTitle('سياسة الخصوصية - مدارس الإبداع والتميز الدولية')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }
    if (page === 'terms') {
      // اختياري: يمكنك إضافة صفحة شروط الخدمة بنفس الطريقة
      return HtmlService.createHtmlOutputFromFile('Terms')
        .setTitle('شروط الخدمة - مدارس الإبداع والتميز الدولية')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }
  }

  // ─── الصفحة الرئيسية الافتراضية ───
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('مدارس الإبداع والتميز الدولية')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
/**
 * تضمين ملفات HTML المساندة (CSS/JS جزئي) — يُستدعى من Index.html بصيغة:
 *   <?!= include('FileName'); ?>
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * endpoint للصحة (للمراقبة الخارجية)
 */
function _handleHealthRequest() {
  return ContentService
    .createTextOutput(JSON.stringify(healthCheck()))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ④ دوال مساعدة عامة (نصوص، أرقام، تواريخ)
// ═══════════════════════════════════════════════════════════════════════════

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toPositiveInt(value, fallback) {
  var n = parseInt(value, 10);
  return isNaN(n) || n <= 0 ? (fallback || 0) : n;
}

function toSafeFloat(value, def) {
  var n = parseFloat(value);
  return isNaN(n) ? (def || 0) : n;
}

function nowISOString() {
  return new Date().toISOString();
}

function formatDateSafe(dateValue, format) {
  if (!dateValue) return '';
  format = format || 'yyyy-MM-dd';
  try {
    var d = (Object.prototype.toString.call(dateValue) === '[object Date]') ? dateValue : new Date(dateValue);
    if (isNaN(d.getTime())) throw new Error('Invalid date');
    return Utilities.formatDate(d, CONFIG.TIMEZONE, format);
  } catch (e) {
    return safeText(dateValue);
  }
}

function toMillis(value) {
  if (!value) return 0;
  try {
    var d = (Object.prototype.toString.call(value) === '[object Date]') ? value : new Date(value);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  } catch (e) {
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ⑤ نظام الكاش (CacheService)
// ═══════════════════════════════════════════════════════════════════════════

function getCacheObject(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('getCacheObject error for "' + key + '":', e);
    return null;
  }
}

function setCacheObject(key, data, ttlSeconds) {
  try {
    var ttl = ttlSeconds || CONFIG.CACHE_TTL_SECONDS;
    CacheService.getScriptCache().put(key, JSON.stringify(data), ttl);
  } catch (e) {
    console.error('setCacheObject error for "' + key + '":', e);
  }
}

function removeCacheObject(key) {
  try {
    CacheService.getScriptCache().remove(key);
  } catch (e) {
    console.error('removeCacheObject error for "' + key + '":', e);
  }
}

/**
 * مسح جميع مفاتيح كاش الموقع — استخدمها بعد تحديث الشيت يدوياً
 */
function clearSchoolCache() {
  removeCacheObject('school_stats');
  removeCacheObject('home_data_bundle');
  for (var i = 1; i <= 50; i++) {
    removeCacheObject('school_news_' + i);
    removeCacheObject('school_images_' + i);
    removeCacheObject('school_videos_' + i);
  }
  removeCacheObject('sheet_records_News');
  removeCacheObject('sheet_records_Images');
  removeCacheObject('sheet_records_Videos');
  console.log('تم مسح كاش الموقع العام بنجاح');
  return { success: true, message: 'تم مسح جميع مفاتيح الكاش' };
}

/** اسم بديل للتوافق الخلفي */
function fullClearCache() { return clearSchoolCache(); }

// ═══════════════════════════════════════════════════════════════════════════
//  ⑥ معالجة روابط Google Drive و YouTube
// ═══════════════════════════════════════════════════════════════════════════

function extractDriveFileId(url) {
  if (!url) return null;
  url = String(url);
  var patterns = [
    /\/d\/([a-zA-Z0-9_-]+)/,
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /open\?id=([a-zA-Z0-9_-]+)/,
    /thumbnail\?id=([a-zA-Z0-9_-]+)/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = url.match(patterns[i]);
    if (match && match[1]) return match[1];
  }
  return null;
}

function normalizeDriveImageUrl(url, size) {
  var raw = safeText(url);
  if (!raw) return '';
  var fileId = extractDriveFileId(raw);
  if (fileId) {
    var sz = (size && size > 0) ? size : 1400;
    return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w' + sz;
  }
  return raw;
}

/** اسم بديل للتوافق الخلفي */
function normalizeGoogleDriveUrl(url) {
  return normalizeDriveImageUrl(url, 1400);
}

function extractYouTubeId(url) {
  if (!url) return null;
  url = String(url);
  var patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = url.match(patterns[i]);
    if (match && match[1]) return match[1];
  }
  return null;
}

function normalizeYouTubeEmbedUrl(url) {
  var videoId = extractYouTubeId(url);
  if (!videoId) return '';
  return 'https://www.youtube-nocookie.com/embed/' + videoId + '?rel=0&modestbranding=1&playsinline=1';
}

function detectVideoPlatform(url) {
  var u = safeText(url).toLowerCase();
  if (u.indexOf('youtube.com') !== -1 || u.indexOf('youtu.be') !== -1) return 'youtube';
  if (u.indexOf('facebook.com') !== -1 || u.indexOf('fb.com') !== -1) return 'facebook';
  if (u.indexOf('instagram.com') !== -1) return 'instagram';
  if (/\.(mp4|webm|ogg|mov|avi|mkv)(\?|$)/i.test(u)) return 'direct';
  return 'link';
}

function classifyVideoUrl(url) {
  return detectVideoPlatform(url);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ⑦ قراءة الأوراق والبيانات الخام
// ═══════════════════════════════════════════════════════════════════════════

var _ssInstance = null;

function _getSS() {
  if (!_ssInstance) {
    try {
      _ssInstance = _getSSById(CONFIG.SPREADSHEET_ID);
    } catch (e) {
      console.error('لا يمكن فتح Spreadsheet:', e.message);
      return null;
    }
  }
  return _ssInstance;
}

function getSheet(sheetName) {
  var ss = _getSS();
  if (!ss) return null;
  try {
    return ss.getSheetByName(sheetName);
  } catch (e) {
    console.error('getSheet error for "' + sheetName + '":', e);
    return null;
  }
}

function readSheetValues(sheetName) {
  var sheet = getSheet(sheetName);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  return sheet.getRange(1, 1, lastRow, lastCol).getValues();
}

function buildRecordsFromSheet(sheetName, options) {
  options = options || {};
  var useCache = (options.useCache !== false);
  var cacheKey = options.cacheKey || ('sheet_records_' + sheetName);
  var ttl = options.ttl || CONFIG.CACHE_TTL_SECONDS;
  if (useCache) {
    var cached = getCacheObject(cacheKey);
    if (cached) return cached;
  }
  var values = readSheetValues(sheetName);
  if (!values || values.length < 2) {
    if (useCache) setCacheObject(cacheKey, [], ttl);
    return [];
  }
  var headers = values[0].map(function(h) { return safeText(h).toLowerCase(); });
  var records = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c] || ('col_' + (c + 1))] = row[c];
    }
    obj.__rowIndex = i + 1;
    records.push(obj);
  }
  if (useCache) setCacheObject(cacheKey, records, ttl);
  return records;
}

function getField(rowObj, names, fallbackIndex, rawRow) {
  rawRow = rawRow || [];
  names = (Object.prototype.toString.call(names) === '[object Array]') ? names : [names];
  for (var i = 0; i < names.length; i++) {
    var key = safeText(names[i]).toLowerCase();
    if (rowObj && rowObj.hasOwnProperty(key) && rowObj[key] !== '' && rowObj[key] !== null && rowObj[key] !== undefined) {
      return rowObj[key];
    }
  }
  if (typeof fallbackIndex === 'number' && rawRow[fallbackIndex] !== undefined) {
    return rawRow[fallbackIndex];
  }
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════
//  ⑧ الأخبار
// ═══════════════════════════════════════════════════════════════════════════
function getNewsForSchool(limit) {
  limit = limit || 6;
  var cacheKey = 'school_news_' + limit;
  var cached = getCacheObject(cacheKey);
  if (cached) return cached;

  try {
    var sheet = getSheet(CONFIG.SHEETS.NEWS);
    if (!sheet) {
      Logger.log('getNewsForSchool: ورقة الأخبار غير موجودة');
      return [];
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    var result = [];

    for (var i = data.length - 1; i >= 0; i--) {
      var row = data[i];

      // ✅ الإصلاح: قبول كل القيم ما عدا الحالات السلبية الصريحة
      var action = safeText(row[7] || '').toLowerCase();
      if (action === 'محذوف' || action === 'deleted' || action === 'مسودة' || action === 'draft') continue;

      var title = safeText(row[1]);
      if (!title) continue;

      var imgRaw = safeText(row[4] || '');
      var mediaType = safeText(row[3] || '');

      result.push({
        id        : safeText(row[0]),
        title     : title,
        content   : safeText(row[2]),
        mediaType : mediaType,
        image     : imgRaw ? normalizeGoogleDriveUrl(imgRaw) : '',
        date      : formatDateSafe(row[0], 'yyyy-MM-dd'),
        author    : safeText(row[6] || row[5] || '')
      });

      if (result.length >= limit) break;
    }

    setCacheObject(cacheKey, result, CONFIG.CACHE_CONFIG.NEWS || 300);
    return result;
  } catch (e) {
    Logger.log('getNewsForSchool error: ' + e.message);
    return [];
  }
}

function getNewsPaged(page, pageSize) {
  page = toPositiveInt(page, 1);
  pageSize = toPositiveInt(pageSize, 10);
  var allNews = getNewsForSchool(9999);
  var total = allNews.length;
  var start = (page - 1) * pageSize;
  var items = allNews.slice(start, start + pageSize);
  return {
    items: items,
    total: total,
    page: page,
    pageSize: pageSize,
    totalPages: Math.ceil(total / pageSize),
    hasMore: (start + pageSize) < total
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ⑨ الصور
// ═══════════════════════════════════════════════════════════════════════════

function getImagesForSchool(limit) {
  limit = toPositiveInt(limit, CONFIG.DEFAULT_LIMITS.images);
  var cacheKey = 'school_images_' + limit;
  var cached = getCacheObject(cacheKey);
  if (cached) return cached;

  var sheet = getSheet(CONFIG.SHEETS.IMAGES);
  if (!sheet) return [];
  var values = readSheetValues(CONFIG.SHEETS.IMAGES);
  if (!values || values.length < 2) {
    setCacheObject(cacheKey, [], CONFIG.CACHE_CONFIG.IMAGES);
    return [];
  }

  var headers = values[0].map(function(h) { return safeText(h).toLowerCase(); });
  var rows = values.slice(1);
  var items = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || r.length < 4 || !r[1]) continue;

    var rowObj = {};
    for (var hi = 0; hi < headers.length; hi++) {
      rowObj[headers[hi] || ('col_' + (hi + 1))] = r[hi];
    }

    // ✅ الإصلاح: قبول كل القيم ما عدا الحالات السلبية الصريحة
    var action = safeText(getField(rowObj, ['action', 'status'], 6, r)).toLowerCase();
    if (action === 'محذوف' || action === 'deleted' || action === 'مسودة' || action === 'draft') continue;

    var rawUrl = safeText(getField(rowObj, ['imageurl', 'image_url', 'url', 'photo', 'photourl', 'link'], 3, r));
    if (!rawUrl) continue;
    var displayUrl = normalizeDriveImageUrl(rawUrl, 1600);

    items.push({
      timestamp  : safeText(getField(rowObj, ['timestamp', 'date', 'datetime', 'time'], 0, r)),
      timestampMs: toMillis(getField(rowObj, ['timestamp', 'date', 'datetime', 'time'], 0, r)),
      name       : safeText(getField(rowObj, ['name', 'title', 'image name', 'imagename'], 1, r)),
      description: safeText(getField(rowObj, ['description', 'details', 'caption'], 2, r)),
      imageURL   : displayUrl,
      originalURL: rawUrl,
      userEmail  : safeText(getField(rowObj, ['useremail', 'email'], 4, r)),
      userName   : safeText(getField(rowObj, ['username', 'name', 'user'], 5, r)),
      action     : action
    });
  }

  items.sort(function(a, b) { return (b.timestampMs || 0) - (a.timestampMs || 0); });
  items = items.slice(0, limit);
  setCacheObject(cacheKey, items, CONFIG.CACHE_CONFIG.IMAGES);
  return items;
}

function getImagesPaged(page, pageSize) {
  page = toPositiveInt(page, 1);
  pageSize = toPositiveInt(pageSize, 12);
  var all = getImagesForSchool(9999);
  var total = all.length;
  var start = (page - 1) * pageSize;
  var items = all.slice(start, start + pageSize);
  return {
    items: items,
    total: total,
    page: page,
    pageSize: pageSize,
    totalPages: Math.ceil(total / pageSize),
    hasMore: (start + pageSize) < total
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ⑩ الفيديوهات
// ═══════════════════════════════════════════════════════════════════════════

function getVideosForSchool(limit) {
  limit = toPositiveInt(limit, CONFIG.DEFAULT_LIMITS.videos);
  var cacheKey = 'school_videos_' + limit;
  var cached = getCacheObject(cacheKey);
  if (cached) return cached;

  var sheet = getSheet(CONFIG.SHEETS.VIDEOS);
  if (!sheet) return [];
  var values = readSheetValues(CONFIG.SHEETS.VIDEOS);
  if (!values || values.length < 2) {
    setCacheObject(cacheKey, [], CONFIG.CACHE_CONFIG.VIDEOS);
    return [];
  }

  var headers = values[0].map(function(h) { return safeText(h).toLowerCase(); });
  var rows = values.slice(1);
  var items = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || r.length < 4 || !r[1] || !r[3]) continue;

    var rowObj = {};
    for (var hi = 0; hi < headers.length; hi++) {
      rowObj[headers[hi] || ('col_' + (hi + 1))] = r[hi];
    }

    // ✅ الإصلاح: قبول كل القيم ما عدا الحالات السلبية الصريحة
    var action = safeText(getField(rowObj, ['action', 'status'], 6, r)).toLowerCase();
    if (action === 'محذوف' || action === 'deleted' || action === 'مسودة' || action === 'draft') continue;

    var rawUrl = safeText(getField(rowObj, ['videourl', 'video_url', 'url', 'link'], 3, r));
    var platform = detectVideoPlatform(rawUrl);
    var embedUrl = (platform === 'youtube') ? normalizeYouTubeEmbedUrl(rawUrl) : '';

    items.push({
      timestamp  : safeText(getField(rowObj, ['timestamp', 'date', 'datetime', 'time'], 0, r)),
      timestampMs: toMillis(getField(rowObj, ['timestamp', 'date', 'datetime', 'time'], 0, r)),
      title      : safeText(getField(rowObj, ['title', 'video title', 'name', 'subject'], 1, r)),
      description: safeText(getField(rowObj, ['description', 'details', 'caption'], 2, r)),
      videoURL   : rawUrl,
      embedURL   : embedUrl,
      platform   : platform,
      userEmail  : safeText(getField(rowObj, ['useremail', 'email'], 4, r)),
      userName   : safeText(getField(rowObj, ['username', 'name', 'user'], 5, r)),
      action     : action
    });
  }

  items.sort(function(a, b) { return (b.timestampMs || 0) - (a.timestampMs || 0); });
  items = items.slice(0, limit);
  setCacheObject(cacheKey, items, CONFIG.CACHE_CONFIG.VIDEOS);
  return items;
}

function getVideosPaged(page, pageSize) {
  page = toPositiveInt(page, 1);
  pageSize = toPositiveInt(pageSize, 12);
  var all = getVideosForSchool(9999);
  var total = all.length;
  var start = (page - 1) * pageSize;
  var items = all.slice(start, start + pageSize);
  return {
    items: items,
    total: total,
    page: page,
    pageSize: pageSize,
    totalPages: Math.ceil(total / pageSize),
    hasMore: (start + pageSize) < total
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ⑪ الإحصائيات العامة
// ═══════════════════════════════════════════════════════════════════════════

function getSchoolStats() {
  var cacheKey = 'school_stats';
  var cached = getCacheObject(cacheKey);
  if (cached) return cached;

  var sheet = getSheet(CONFIG.SHEETS.STATS);
  var result = { students: 1000, teachers: 80, years: 20, awards: 10 };

  if (sheet) {
    try {
      var data = sheet.getDataRange().getValues();
      if (data && data.length >= 2) {
        for (var i = 1; i < data.length; i++) {
          var key = safeText(data[i][0]).toLowerCase();
          var value = parseInt(data[i][1], 10);
          if (!isNaN(value)) {
            if (key === 'students' || key === 'studentscount' || key === 'students_count') result.students = value;
            if (key === 'teachers' || key === 'teacherscount' || key === 'teachers_count') result.teachers = value;
            if (key === 'years' || key === 'years_count') result.years = value;
            if (key === 'awards' || key === 'awardscount' || key === 'awards_count') result.awards = value;
          }
        }
      }
    } catch (e) {
      console.error('getSchoolStats error:', e);
    }
  }

  setCacheObject(cacheKey, result, CONFIG.CACHE_CONFIG.STATS);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ⑫ الحزمة الموحّدة للصفحة الرئيسية
// ═══════════════════════════════════════════════════════════════════════════

/**
 * يجلب جميع بيانات الصفحة الرئيسية في طلب واحد + روابط المنصات
 * تُستدعى من Index.html عند بدء التحميل
 */
function getHomeData() {
  var cacheKey = 'home_data_bundle';
  var cached = getCacheObject(cacheKey);
  if (cached) return cached;

  var payload = {
    stats      : getSchoolStats(),
    news       : getNewsForSchool(CONFIG.DEFAULT_LIMITS.news),
    images     : getImagesForSchool(CONFIG.DEFAULT_LIMITS.images),
    videos     : getVideosForSchool(CONFIG.DEFAULT_LIMITS.videos),
    deployments: getDeploymentUrls(),       // ⭐ جديد: روابط المنصات في نفس الطلب
    generatedAt: nowISOString()
  };

  setCacheObject(cacheKey, payload, CONFIG.CACHE_CONFIG.HOME_BUNDLE);
  return payload;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ⑬ أدوات التشخيص والصحة
// ═══════════════════════════════════════════════════════════════════════════

function healthCheck() {
  return {
    ok           : true,
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    sheets       : {
      news  : !!getSheet(CONFIG.SHEETS.NEWS),
      images: !!getSheet(CONFIG.SHEETS.IMAGES),
      videos: !!getSheet(CONFIG.SHEETS.VIDEOS),
      stats : !!getSheet(CONFIG.SHEETS.STATS)
    },
    deployments: {
      registered: Object.keys(DEFAULT_DEPLOYMENTS).length,
      current   : _getCurrentScriptUrl()
    },
    time: nowISOString()
  };
}
function clearAllCaches() {
  var cache = CacheService.getScriptCache();
  cache.removeAll([
    'home_data_bundle',
    'school_news_6',
    'school_news_9999',
    'school_images_6',
    'school_videos_8',
    'school_stats',
    'deployment_urls_v2'
  ]);
  Logger.log('تم مسح جميع الكاشات');
}