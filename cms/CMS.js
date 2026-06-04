/**
 * نظام إدارة المحتوى الاجتماعي المتكامل (CMS)
 * File: CMS.gs
 * الإصدار: 6.0.0 — مع CacheService + Validation + Rate Limiting
 * ES5 خالص — var فقط — لا arrow functions
 */

var MAIN_FOLDER_ID = '13A82NOATnZTuk5EtVfo2hplZih5NFSnT';
var SPREADSHEET_ID = '1J7DY-Z2PZU5y5HH-LR3vhuEhPAkjWz22vMu1rYLcse0';

var FOLDERS = {
  NEWS_IMAGES: 'أرشيف_المحتوى',
  IMAGE_LIBRARY: 'ملفات_التصميم',
  PUBLISHED: 'المحتوى_المنشور',
  DRAFTS: 'مسودات_المحتوى',
  REPORTS: 'تقارير_الامتثال',
  VIDEOS: 'مكتبة_الفيديوهات'
};

// ══════════════════════════════════════════════════════════════════
// ① CacheService — كاش ذكي لـ CMS
// ══════════════════════════════════════════════════════════════════
function _cmsCacheGet(key) {
  try {
    var raw = CacheService.getScriptCache().get('cms_' + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function _cmsCacheSet(key, data, ttl) {
  try {
    var ttlSec = ttl || 300;
    CacheService.getScriptCache().put('cms_' + key, JSON.stringify(data), ttlSec);
  } catch (e) {
    Logger.log('_cmsCacheSet error: ' + e.message);
  }
}

function _cmsCacheDel(key) {
  try {
    CacheService.getScriptCache().remove('cms_' + key);
  } catch (e) {
    Logger.log('_cmsCacheDel error: ' + e.message);
  }
}

function _cmsCacheDelMultiple(keys) {
  try {
    var prefixed = [];
    for (var i = 0; i < keys.length; i++) prefixed.push('cms_' + keys[i]);
    CacheService.getScriptCache().removeAll(prefixed);
  } catch (e) {
    Logger.log('_cmsCacheDelMultiple error: ' + e.message);
  }
}
/**
 * مسح كاش الموقع الرسمي (نفس Spreadsheet لكن مفاتيح مختلفة)
 * يُستدعى بعد كل عملية إضافة/تعديل/حذف
 */
function _clearPublicSiteCache() {
  try {
    var cache = CacheService.getScriptCache();
    var keysToRemove = ['school_stats', 'home_data_bundle',
      'sheet_records_News', 'sheet_records_Images', 'sheet_records_Videos'];
    for (var i = 1; i <= 50; i++) {
      keysToRemove.push('school_news_' + i);
      keysToRemove.push('school_images_' + i);
      keysToRemove.push('school_videos_' + i);
    }
    cache.removeAll(keysToRemove);
  } catch (e) {
    Logger.log('_clearPublicSiteCache error: ' + e.message);
  }
}
// ══════════════════════════════════════════════════════════════════
// ② Validation — التحقق من صحة الروابط وتنظيفها
// ══════════════════════════════════════════════════════════════════
function _validateUrl(url) {
  if (!url || url.toString().trim() === '') {
    return { valid: true, url: '' };
  }

  var cleaned = url.toString().trim();

  if (cleaned.indexOf('http://') !== 0 && cleaned.indexOf('https://') !== 0) {
    return { valid: false, url: '', error: 'الرابط يجب أن يبدأ بـ https:// أو http://' };
  }

  if (cleaned.length > 2048) {
    return { valid: false, url: '', error: 'الرابط طويل جداً' };
  }

  var lower = cleaned.toLowerCase();
  if (lower.indexOf('javascript:') !== -1 || lower.indexOf('data:text') !== -1) {
    return { valid: false, url: '', error: 'رابط غير مسموح به' };
  }

  cleaned = cleaned.replace(/[<>"']/g, '');

  return { valid: true, url: cleaned };
}

function _sanitizeText(text) {
  if (!text) return '';
  return text.toString()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .trim();
}

// ══════════════════════════════════════════════════════════════════
// ③ Rate Limiting — 10 عمليات / دقيقة / مستخدم
// ══════════════════════════════════════════════════════════════════
var CMS_RATE_LIMIT     = 10;
var CMS_RATE_WINDOW_S  = 60;

function _checkRateLimit(fingerprint) {
  var key    = 'rl_' + (fingerprint || 'anon');
  var cached = _cmsCacheGet(key);

  var now    = new Date().getTime();
  var window = CMS_RATE_WINDOW_S * 1000;

  if (!cached) {
    _cmsCacheSet(key, { count: 1, since: now }, CMS_RATE_WINDOW_S);
    return { allowed: true, remaining: CMS_RATE_LIMIT - 1 };
  }

  if ((now - cached.since) > window) {
    _cmsCacheSet(key, { count: 1, since: now }, CMS_RATE_WINDOW_S);
    return { allowed: true, remaining: CMS_RATE_LIMIT - 1 };
  }

  if (cached.count >= CMS_RATE_LIMIT) {
    var waitSec = Math.ceil((window - (now - cached.since)) / 1000);
    return {
      allowed: false,
      remaining: 0,
      error: 'تجاوزت الحد المسموح (' + CMS_RATE_LIMIT + ' عمليات/دقيقة). انتظر ' + waitSec + ' ثانية.'
    };
  }

  var newCount = cached.count + 1;
  var remaining = CMS_RATE_WINDOW_S - Math.floor((now - cached.since) / 1000);
  _cmsCacheSet(key, { count: newCount, since: cached.since }, Math.max(remaining, 5));
  return { allowed: true, remaining: CMS_RATE_LIMIT - newCount };
}

// ==================== دوال مساعدة ====================
function getSpreadsheet() {
  try { return SpreadsheetApp.openById(_activeFileId()); } catch(e) { return null; }
}
function getSheet(sheetName) {
  var ss = getSpreadsheet();
  return ss ? ss.getSheetByName(sheetName) : null;
}
function getAppUrl() { return ScriptApp.getService().getUrl(); }
function getPageUrl(page) {
  var base = getAppUrl();
  if (!base) return page ? '?page=' + encodeURIComponent(page) : './';
  if (!page) return base;
  return base + '?page=' + encodeURIComponent(page);
}

// ==================== doGet ====================
function doGet(e) {
  // ★ تفعيل وضع المستأجر المتعدد (Multi-Tenant) إذا تم تمرير school في الرابط
  var schoolId = (e.parameter.school || '').trim();
  if (schoolId) _setActiveTenant(schoolId);

  var page = e.parameter.page;
  if (page === 'add') return HtmlService.createHtmlOutputFromFile('AddForm').setTitle('إضافة محتوى').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  if (page === 'view') return HtmlService.createHtmlOutputFromFile('ViewContent').setTitle('عرض المحتوى والتقارير').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  if (page === 'audit') return HtmlService.createHtmlOutputFromFile('AuditLog').setTitle('سجل التدقيق').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  if (page === 'reports') return HtmlService.createHtmlOutputFromFile('Reports').setTitle('التقارير').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  if (page === 'debug') return generateDebugPage();
  return HtmlService.createHtmlOutputFromFile('Dashboard').setTitle('الرئيسية').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ══════════════════════════════════════════════════════════════════
// دوال جلب البيانات مع CacheService
// ══════════════════════════════════════════════════════════════════

function getNewsData() {
  var cached = _cmsCacheGet('newsData');
  if (cached) return cached;

  var sheet = getSheet('News');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var rows = data.slice(1);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || r.length === 0) continue;
    result.push({
      timestamp: r[0] ? String(r[0]) : '',
      title: r[1] ? String(r[1]) : '',
      content: r[2] ? String(r[2]) : '',
      mediaType: r[3] ? String(r[3]) : '',
      mediaURL: r[4] ? String(r[4]) : '',
      userEmail: r[5] ? String(r[5]) : '',
      userName: r[6] ? String(r[6]) : '',
      action: r[7] ? String(r[7]) : ''
    });
  }
  _cmsCacheSet('newsData', result, 300);
  return result;
}

function getVideosData() {
  var cached = _cmsCacheGet('videosData');
  if (cached) return cached;

  var sheet = getSheet('Videos');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var rows = data.slice(1);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || r.length === 0) continue;
    result.push({
      timestamp: r[0] ? String(r[0]) : '',
      title: r[1] ? String(r[1]) : '',
      description: r[2] ? String(r[2]) : '',
      videoURL: r[3] ? String(r[3]) : '',
      userEmail: r[4] ? String(r[4]) : '',
      userName: r[5] ? String(r[5]) : '',
      action: r[6] ? String(r[6]) : ''
    });
  }
  _cmsCacheSet('videosData', result, 300);
  return result;
}

function getImagesData() {
  var cached = _cmsCacheGet('imagesData');
  if (cached) return cached;

  var sheet = getSheet('Images');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var rows = data.slice(1);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || r.length === 0) continue;
    result.push({
      timestamp: r[0] ? String(r[0]) : '',
      name: r[1] ? String(r[1]) : '',
      description: r[2] ? String(r[2]) : '',
      imageURL: r[3] ? String(r[3]) : '',
      userEmail: r[4] ? String(r[4]) : '',
      userName: r[5] ? String(r[5]) : '',
      action: r[6] ? String(r[6]) : ''
    });
  }
  _cmsCacheSet('imagesData', result, 300);
  return result;
}

function getScheduleData() {
  var cached = _cmsCacheGet('scheduleData');
  if (cached) return cached;

  var sheet = getSheet('Schedule');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var rows = data.slice(1);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || r.length === 0) continue;
    result.push({
      timestamp: r[0] ? String(r[0]) : '',
      platform: r[1] ? String(r[1]) : '',
      postType: r[2] ? String(r[2]) : '',
      content: r[3] ? String(r[3]) : '',
      mediaURL: r[4] ? String(r[4]) : '',
      scheduledDate: r[5] ? String(r[5]) : '',
      status: r[6] ? String(r[6]) : '',
      userEmail: r[7] ? String(r[7]) : '',
      userName: r[8] ? String(r[8]) : '',
      action: r[9] ? String(r[9]) : ''
    });
  }
  _cmsCacheSet('scheduleData', result, 180);
  return result;
}

function getAuditLog(limit) {
  var sheet = getSheet('AuditLog');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var rows = data.slice(1);
  var reversed = rows.reverse();
  var limited = reversed.slice(0, limit || 500);
  var result = [];
  for (var i = 0; i < limited.length; i++) {
    var r = limited[i];
    if (!r || r.length < 5) continue;
    result.push({
      logId: r[0] ? String(r[0]) : '',
      timestamp: r[1] ? String(r[1]) : '',
      userEmail: r[2] ? String(r[2]) : '',
      userName: r[3] ? String(r[3]) : '',
      action: r[4] ? String(r[4]) : '',
      details: r[5] ? String(r[5]) : '',
      ipAddress: r[6] ? String(r[6]) : '',
      userAgent: r[7] ? String(r[7]) : '',
      sheetName: r[8] ? String(r[8]) : '',
      recordId: r[9] ? String(r[9]) : ''
    });
  }
  return result;
}

function getPostTypesForPlatform(platform) {
  var sheet = getSheet('PostTypes');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var types = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i] && data[i][0] === platform) {
      types.push({ type: data[i][1] ? String(data[i][1]) : '', description: data[i][2] ? String(data[i][2]) : '' });
    }
  }
  return types;
}

// ══════════════════════════════════════════════════════════════════
// إحصاءات النظام مع كاش
// ══════════════════════════════════════════════════════════════════
function getSystemStats() {
  var cached = _cmsCacheGet('systemStats');
  if (cached) return cached;

  var ss = getSpreadsheet();
  if (!ss) return { News: 0, Videos: 0, Images: 0, Schedule: 0, AuditLog: 0, Users: 0 };
  var stats = {};
  var sheetNames = ['News', 'Videos', 'Images', 'Schedule', 'AuditLog', 'Users'];
  for (var i = 0; i < sheetNames.length; i++) {
    var sName = sheetNames[i];
    var s = ss.getSheetByName(sName);
    stats[sName] = s ? Math.max(0, s.getLastRow() - 1) : 0;
  }
  stats.newsWithImages = countNewsWithImages();
  stats.videosByPlatform = getVideosByPlatformStats();
  stats.scheduleByStatus = getScheduleByStatus();
  stats.actionsByUser = getActionsByUser();
  try {
    var mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
    stats.driveFolder = { id: MAIN_FOLDER_ID, name: mainFolder.getName(), url: mainFolder.getUrl() };
  } catch(e) { stats.driveFolder = { error: 'تعذر الوصول' }; }
  _cmsCacheSet('systemStats', stats, 120);
  return stats;
}

function countNewsWithImages() {
  var sheet = getSheet('News');
  if (!sheet) return 0;
  var data = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i] && data[i][3] === 'Image' && data[i][4]) count++;
  }
  return count;
}
function getVideosByPlatformStats() {
  var sheet = getSheet('Schedule');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var stats = {};
  for (var i = 1; i < data.length; i++) {
    if (!data[i]) continue;
    var platform = data[i][1];
    var postType = data[i][2];
    if (postType && (postType.indexOf('فيديو') !== -1 || postType.indexOf('ريلز') !== -1)) {
      stats[platform] = (stats[platform] || 0) + 1;
    }
  }
  return stats;
}
function getScheduleByStatus() {
  var sheet = getSheet('Schedule');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var stats = {};
  for (var i = 1; i < data.length; i++) {
    if (!data[i]) continue;
    var status = data[i][6];
    if (status) stats[status] = (stats[status] || 0) + 1;
  }
  return stats;
}
function getActionsByUser() {
  var sheet = getSheet('AuditLog');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var stats = {};
  for (var i = 1; i < data.length; i++) {
    if (!data[i]) continue;
    var user = data[i][3] || data[i][2];
    if (user) stats[user] = (stats[user] || 0) + 1;
  }
  return stats;
}

// ==================== دوال التتبع ====================
function getUserInfo(clientFingerprint) {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail(); } catch(e) {}
  if (!email) email = clientFingerprint ? 'زائر_' + clientFingerprint : 'زائر_مجهول';
  return { email: email, timestamp: new Date(), fingerprint: clientFingerprint || '' };
}
function logAudit(userEmail, userName, action, details, sheetName, recordId) {
  var sheet = getSheet('AuditLog');
  if (!sheet) return;
  sheet.appendRow([Utilities.getUuid(), new Date(), userEmail, userName || userEmail.split('@')[0], action, details, 'غير متوفر', 'Web App', sheetName, recordId || '']);
  updateUserStats(userEmail, userName);
}
function updateUserStats(email, displayName) {
  var sheet = getSheet('Users');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < data.length; i++) {
    if (data[i] && data[i][1] === email) {
      var row = i + 1;
      var total = data[i][5] ? data[i][5] + 1 : 1;
      sheet.getRange(row, 5).setValue(new Date());
      sheet.getRange(row, 6).setValue(total);
      if (displayName && !data[i][2]) sheet.getRange(row, 3).setValue(displayName);
      found = true;
      break;
    }
  }
  if (!found) {
    var userName = displayName || (email ? email.split('@')[0] : 'زائر');
    sheet.appendRow([new Date(), email, userName, 'Editor', new Date(), 1]);
  }
}

// ══════════════════════════════════════════════════════════════════
// دوال الإضافة — مع Validation + Rate Limiting + مسح الكاش
// ══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
//  أتمتة: تحويل كل خبر/صورة/فيديو يُضاف إلى مسودة منشور في «خطة_المحتوى»
//  يعتمد على smmAddPlanItem (نفس المشروع/الشيت). آمن: يُستدعى داخل try/catch
//  من الدوال فلا يكسر الإضافة أبداً. النص من المحتوى الفعلي + الهاشتاق الموحّد.
// ═══════════════════════════════════════════════════════════════════
function _cmsAutoDraft(kind, title, body, mediaUrl, userName) {
  if (typeof smmAddPlanItem !== 'function') return { success: false, error: 'SMM غير متاح' };
  var category = 'خبر', postType = 'بوست';
  if (kind === 'video') { category = 'نشاط'; postType = 'ريلز'; }
  else if (kind === 'image') { category = 'نشاط'; postType = 'صورة'; }
  var t = (title == null) ? '' : String(title);
  var b = (body == null) ? '' : String(body);
  var content = t + (b ? ('\n' + b) : '');
  return smmAddPlanItem({
    platform: 'فيسبوك',
    post_type: postType,
    category: category,
    title: t,
    content: content,
    hashtags: '#مدارس_الإبداع_والتميز',
    media_url: (mediaUrl == null) ? '' : String(mediaUrl),
    responsible: (userName == null) ? '' : String(userName),
    notes: 'مسودة تلقائية من CMS (' + kind + ')'
  });
}

// ═══════════════════════════════════════════════════════════════════
//  عارض الأوراق الديناميكي — يسرد أوراق ملف الشيت ويعرض بياناتها للويب
//  أمان: يُستثنى «اعدادات_السوشل» (يحوي توكنات) من السرد والعرض.
// ═══════════════════════════════════════════════════════════════════
var _CMS_BLOCKED_SHEETS = ['اعدادات_السوشل'];

function _cmsSheetBlocked(name) {
  for (var i = 0; i < _CMS_BLOCKED_SHEETS.length; i++) {
    if (_CMS_BLOCKED_SHEETS[i] === name) return true;
  }
  return false;
}

function cmsListSheets() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheets = ss.getSheets();
    var out = [];
    for (var i = 0; i < sheets.length; i++) {
      var sh = sheets[i];
      var nm = sh.getName();
      if (_cmsSheetBlocked(nm)) continue;
      out.push({ name: nm, rows: Math.max(sh.getLastRow() - 1, 0), cols: sh.getLastColumn() });
    }
    return { success: true, sheets: out };
  } catch (e) { return { success: false, error: String((e && e.message) || e) }; }
}

function cmsGetSheetData(sheetName, maxRows) {
  try {
    sheetName = (sheetName == null) ? '' : String(sheetName);
    if (_cmsSheetBlocked(sheetName)) return { success: false, error: 'هذه الورقة محميّة ولا تُعرض' };
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName(sheetName);
    if (!sh) return { success: false, error: 'الورقة غير موجودة: ' + sheetName };
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return { success: true, sheetName: sheetName, headers: [], rows: [], total: 0, shown: 0 };
    maxRows = parseInt(maxRows, 10); if (isNaN(maxRows) || maxRows < 1) maxRows = 200;
    var n = Math.min(lastRow, maxRows + 1);
    var data = sh.getRange(1, 1, n, lastCol).getValues();
    var headers = [];
    for (var c = 0; c < lastCol; c++) headers.push(String(data[0][c]));
    var rows = [];
    for (var r = 1; r < data.length; r++) {
      var row = [];
      for (var k = 0; k < lastCol; k++) { var v = data[r][k]; row.push(v == null ? '' : String(v)); }
      rows.push(row);
    }
    return { success: true, sheetName: sheetName, headers: headers, rows: rows, total: lastRow - 1, shown: rows.length };
  } catch (e) { return { success: false, error: String((e && e.message) || e) }; }
}

// غلاف عام يُستدعى من ViewContent (زر «حوّل لمنشور») — لأن الجسر يحجب الدوال المسبوقة بـ _
function addManualDraft(kind, title, body, mediaUrl, userName, fingerprint, schoolId) {
  _setActiveTenant(schoolId || '');
  try {
    var r = _cmsAutoDraft(kind || 'news', title, body, mediaUrl, userName);
    if (r && r.success) return '✅ تم إنشاء مسودة منشور في «خطة المحتوى»';
    return '⚠️ تعذّر إنشاء المسودة: ' + ((r && r.error) || 'خطأ');
  } catch (e) {
    return '❌ ' + e.message;
  }
}

// رفع فيديو من صفحات الويب مباشرةً → Drive → ورقة Videos (+ مسودة تلقائية)
// videoBase64: data URI (video/mp4 أو video/webm، حتى 25MB). ES5.
function addVideoWithUpload(title, description, videoBase64, fileName, mimeType, userName, fingerprint, schoolId) {
  _setActiveTenant(schoolId || '');
  var rl = _checkRateLimit(fingerprint);
  if (!rl.allowed) return '❌ ' + rl.error;
  if (!title || title.toString().trim() === '') return '❌ عنوان الفيديو مطلوب';

  var safeTitle = _sanitizeText(title);
  var info = getUserInfo(fingerprint);
  var videoURL = '';

  if (videoBase64 && fileName && videoBase64.length > 100) {
    try {
      var up = uploadFileToDrive(videoBase64, fileName, 'VIDEOS');
      if (up && up.success) { videoURL = up.url; }
      else { return '❌ فشل رفع الفيديو: ' + ((up && up.error) || 'خطأ'); }
    } catch (e) {
      return '❌ تعذّر رفع الفيديو: ' + e.message;
    }
  }
  if (!videoURL) return '❌ لم يتم استلام ملف الفيديو';

  var urlCheck = _validateUrl(videoURL);
  if (!urlCheck.valid) return '❌ ' + urlCheck.error;
  videoURL = urlCheck.url;

  var sheet = getSheet('Videos');
  if (!sheet) return '❌ ورقة Videos غير موجودة';
  sheet.appendRow([new Date(), safeTitle, description || '', videoURL, info.email, userName || info.email.split('@')[0], 'إضافة (رفع)']);
  logAudit(info.email, userName, 'رفع_فيديو', 'رفع فيديو: ' + safeTitle, 'Videos', sheet.getLastRow());
  _cmsCacheDelMultiple(['videosData', 'systemStats']);

  try { _cmsAutoDraft('video', safeTitle, description, videoURL, userName); } catch (e2) {}

  return '✅ تم رفع الفيديو وحفظه في Drive وإضافته للمكتبة';
}

function addNews(title, content, mediaType, mediaURL, userName, fingerprint, schoolId) {
  _setActiveTenant(schoolId || '');   // ✅ عزل المدرسة

  var rl = _checkRateLimit(fingerprint);
  if (!rl.allowed) return '❌ ' + rl.error;

  if (!title || title.toString().trim() === '') return '❌ عنوان الخبر مطلوب';
  if (!content || content.toString().trim() === '') return '❌ محتوى الخبر مطلوب';

  var urlCheck = _validateUrl(mediaURL);
  if (!urlCheck.valid) return '❌ ' + urlCheck.error;
  var safeMediaURL = urlCheck.url;
  var safeTitle    = _sanitizeText(title);
  var safeContent  = _sanitizeText(content);

  var info = getUserInfo(fingerprint);
  var sheet = getSheet('News');
  if (!sheet) return '❌ ورقة News غير موجودة';

  sheet.appendRow([new Date(), safeTitle, safeContent, mediaType || 'Text', safeMediaURL, info.email, userName || info.email.split('@')[0], 'إضافة']);
  logAudit(info.email, userName, 'إضافة_خبر', 'تم إضافة خبر: ' + safeTitle, 'News', sheet.getLastRow());

  _cmsCacheDelMultiple(['newsData', 'systemStats']);
  _clearPublicSiteCache();

  try {
    _syncNewsToTeacherFile(safeTitle, safeContent, safeMediaURL, userName, info.email);
  } catch (e) {
    Logger.log('تحذير: تعذرت مزامنة الخبر: ' + e.message);
  }

  // أتمتة: مسودة منشور سوشل ميديا تلقائية
  try {
    _cmsAutoDraft('news', safeTitle, safeContent, safeMediaURL, userName);
  } catch (e2) {
    Logger.log('تحذير: تعذّر إنشاء مسودة المنشور: ' + e2.message);
  }

  return '✅ تمت الإضافة بواسطة: ' + (userName || info.email);
}
function addVideo(title, description, videoURL, userName, fingerprint, schoolId) {
  _setActiveTenant(schoolId || '');   // ✅ عزل المدرسة

  var rl = _checkRateLimit(fingerprint);
  if (!rl.allowed) return '❌ ' + rl.error;

  if (!title || title.toString().trim() === '') return '❌ عنوان الفيديو مطلوب';

  var urlCheck = _validateUrl(videoURL);
  if (!urlCheck.valid) return '❌ ' + urlCheck.error;
  var safeUrl   = urlCheck.url;
  var safeTitle = _sanitizeText(title);

  var info = getUserInfo(fingerprint);
  var sheet = getSheet('Videos');
  if (!sheet) return '❌ ورقة Videos غير موجودة';

  sheet.appendRow([new Date(), safeTitle, description || '', safeUrl, info.email, userName || info.email.split('@')[0], 'إضافة']);
  logAudit(info.email, userName, 'إضافة_فيديو', 'تم إضافة فيديو: ' + safeTitle, 'Videos', sheet.getLastRow());

  _cmsCacheDelMultiple(['videosData', 'systemStats']);

  try {
    _cmsAutoDraft('video', safeTitle, description, safeUrl, userName);
  } catch (e2) {
    Logger.log('تحذير: تعذّر إنشاء مسودة الفيديو: ' + e2.message);
  }

  return '✅ تمت الإضافة بواسطة: ' + (userName || info.email);
}
function addImage(name, description, imageURL, userName, fingerprint, schoolId) {
  _setActiveTenant(schoolId || '');   // ✅ عزل المدرسة

  var rl = _checkRateLimit(fingerprint);
  if (!rl.allowed) return '❌ ' + rl.error;

  if (!name || name.toString().trim() === '') return '❌ اسم الصورة مطلوب';

  var urlCheck = _validateUrl(imageURL);
  if (!urlCheck.valid) return '❌ ' + urlCheck.error;
  var safeUrl  = urlCheck.url;
  var safeName = _sanitizeText(name);

  var info = getUserInfo(fingerprint);
  var sheet = getSheet('Images');
  if (!sheet) return '❌ ورقة Images غير موجودة';

  sheet.appendRow([new Date(), safeName, description || '', safeUrl, info.email, userName || info.email.split('@')[0], 'إضافة']);
  logAudit(info.email, userName, 'إضافة_صورة', 'تم إضافة صورة: ' + safeName, 'Images', sheet.getLastRow());

  _cmsCacheDelMultiple(['imagesData', 'systemStats']);

  try {
    _cmsAutoDraft('image', safeName, description, safeUrl, userName);
  } catch (e2) {
    Logger.log('تحذير: تعذّر إنشاء مسودة الصورة: ' + e2.message);
  }

  return '✅ تمت الإضافة بواسطة: ' + (userName || info.email);
}
// جدولة على عدّة منصات دفعةً واحدة (تُنشئ صف جدولة لكل منصة مختارة)
function addScheduleMulti(platforms, postType, content, mediaURL, scheduledDate, status, userName, fingerprint, schoolId) {
  if (!platforms || !platforms.length) return '❌ اختر منصة واحدة على الأقل';
  var done = [], failed = [];
  for (var i = 0; i < platforms.length; i++) {
    try {
      var r = '' + addSchedule(platforms[i], postType, content, mediaURL, scheduledDate, status, userName, fingerprint, schoolId);
      if (r.indexOf('❌') === 0 || r.indexOf('⚠') === 0) failed.push(platforms[i]); else done.push(platforms[i]);
    } catch (e) { failed.push(platforms[i]); }
  }
  var msg = '';
  if (done.length) msg += '✅ تمت الجدولة على: ' + done.join('، ');
  if (failed.length) msg += (msg ? ' | ' : '') + '❌ تعذّر: ' + failed.join('، ');
  return msg || '⚠️ لم تتم الجدولة';
}

function addSchedule(platform, postType, content, mediaURL, scheduledDate, status, userName, fingerprint, schoolId) {
  _setActiveTenant(schoolId || '');   // ✅ عزل المدرسة

  var rl = _checkRateLimit(fingerprint);
  if (!rl.allowed) return '❌ ' + rl.error;

  var urlCheck = _validateUrl(mediaURL);
  if (!urlCheck.valid) return '❌ ' + urlCheck.error;
  var safeUrl = urlCheck.url;

  var info = getUserInfo(fingerprint);
  var sheet = getSheet('Schedule');
  if (!sheet) return '❌ ورقة Schedule غير موجودة';

  sheet.appendRow([new Date(), platform || '', postType || '', content || '', safeUrl, scheduledDate || '', status || 'مسودة', info.email, userName || info.email.split('@')[0], 'إضافة']);
  logAudit(info.email, userName, 'جدولة_منشور', 'تمت جدولة ' + postType + ' على ' + platform, 'Schedule', sheet.getLastRow());

  _cmsCacheDelMultiple(['scheduleData', 'systemStats']);

  return '✅ تمت الجدولة بواسطة: ' + (userName || info.email);
}

// ==================== مزامنة الأخبار إلى ملف المعلمين ====================
function _syncNewsToTeacherFile(title, content, mediaURL, userName, email) {
  var teacherFile = SpreadsheetApp.openById(_activeFileId());   // ✅ صحيح – يستخدم الملف النشط الحالي
  var sheet = teacherFile.getSheetByName('الاخبار');
  if (!sheet) {
    sheet = teacherFile.insertSheet('الاخبار');
    sheet.getRange(1, 1, 1, 7).setValues([[
      'رقم الخبر', 'اسم المدرس', 'الفصل', 'الشعبة', 'الخبر', 'الملحقات', 'التاريخ'
    ]]);
  }
  var lastRow = sheet.getLastRow();
  var nextNum = lastRow;

  var safeMediaURL = '';
  if (mediaURL && mediaURL.indexOf('http') === 0) {
    var driveMatch = mediaURL.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                     mediaURL.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch && driveMatch[1]) {
      safeMediaURL = 'https://drive.google.com/thumbnail?id=' + driveMatch[1] + '&sz=w1000';
    } else {
      safeMediaURL = mediaURL;
    }
  }

  sheet.appendRow([
    nextNum,
    userName || 'الإدارة',
    'جميع الفصول',
    'جميع الشعب',
    title + (content ? '\n' + content : ''),
    safeMediaURL,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  ]);
}
// ==================== رفع الملفات ====================
function getOrCreateSubFolder(folderName) {
  var main = DriveApp.getFolderById(MAIN_FOLDER_ID);
  var folders = main.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : main.createFolder(folderName);
}
/**
 * رفع ملف إلى Google Drive — نسخة محصّنة
 * @param {string} fileBase64  - الملف بصيغة data URI كاملة (data:image/png;base64,...)
 * @param {string} fileName    - اسم الملف
 * @param {string} folderType  - مفتاح من FOLDERS (NEWS_IMAGES, IMAGE_LIBRARY, ...)
 * @returns {Object} { success, url, fileId, folder } أو { success: false, error }
 */
function uploadFileToDrive(fileBase64, fileName, folderType) {
  try {
    // ① التحقق من المدخلات
    if (!fileBase64 || typeof fileBase64 !== 'string') {
      return { success: false, error: 'لم يتم استلام بيانات الملف' };
    }
    if (fileBase64.indexOf('data:') !== 0 || fileBase64.indexOf(',') === -1) {
      return { success: false, error: 'صيغة الملف غير صحيحة (يجب أن تكون data URI)' };
    }

    // ② استخراج نوع الملف وحجمه
    var commaIndex = fileBase64.indexOf(',');
    var header = fileBase64.substring(5, fileBase64.indexOf(';'));
    var base64Data = fileBase64.substring(commaIndex + 1);

    // ③ تحقق من الحجم (Apps Script يحدّ بـ ~50 MB)
    var approxSizeBytes = Math.floor(base64Data.length * 0.75);
    var MAX_SIZE = 25 * 1024 * 1024; // 25 MB حد آمن
    if (approxSizeBytes > MAX_SIZE) {
      return {
        success: false,
        error: 'حجم الملف كبير جداً (' + Math.round(approxSizeBytes / 1024 / 1024) + ' MB). الحد الأقصى 25 MB.'
      };
    }

    // ④ تحقق من نوع الملف المسموح
    var allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm',
      'application/pdf'
    ];
    var isAllowed = false;
    for (var i = 0; i < allowedTypes.length; i++) {
      if (header.toLowerCase() === allowedTypes[i]) { isAllowed = true; break; }
    }
    if (!isAllowed) {
      return { success: false, error: 'نوع الملف غير مدعوم: ' + header };
    }

    // ⑤ الوصول إلى مجلد Drive الرئيسي مع تشخيص واضح للخطأ
    var mainFolder;
    try {
      mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
    } catch (eFolder) {
      return {
        success: false,
        error: 'لا يمكن الوصول إلى مجلد Drive. تحقق من: ' +
               '(1) صلاحية الحساب على المجلد ' + MAIN_FOLDER_ID + '، ' +
               '(2) أن السكربت منشور بـ "Execute as: Me"، ' +
               '(3) أن appsscript.json يحتوي على scope drive. ' +
               'التفاصيل: ' + eFolder.toString()
      };
    }

    // ⑥ الحصول على/إنشاء المجلد الفرعي
    var subName = FOLDERS[folderType] || FOLDERS.NEWS_IMAGES;
    var folder;
    try {
      var existing = mainFolder.getFoldersByName(subName);
      folder = existing.hasNext() ? existing.next() : mainFolder.createFolder(subName);
    } catch (eSub) {
      return { success: false, error: 'فشل إنشاء/الوصول للمجلد الفرعي: ' + eSub.toString() };
    }

    // ⑦ تنظيف اسم الملف من الأحرف الخطرة + إضافة timestamp لتجنب التكرار
    var safeName = (fileName || 'file')
      .replace(/[\/\\:*?"<>|]/g, '_')
      .substring(0, 100);
    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    var finalName = timestamp + '_' + safeName;

    // ⑧ بناء الـ Blob ورفعه
    var blob;
    try {
      blob = Utilities.newBlob(Utilities.base64Decode(base64Data), header, finalName);
    } catch (eBlob) {
      return { success: false, error: 'فشل فك ترميز الملف: ' + eBlob.toString() };
    }

    var file;
    try {
      file = folder.createFile(blob);
    } catch (eCreate) {
      return {
        success: false,
        error: 'تم رفض الكتابة على Drive. تأكد من إعادة منح الصلاحيات: ' +
               'افتح محرر السكربت → شغّل أي دالة يدوياً → اقبل الصلاحيات. ' +
               'التفاصيل: ' + eCreate.toString()
      };
    }

    // ⑨ مشاركة الملف للعرض العام
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (eShare) {
      // غير قاتل — الملف رُفع لكن المشاركة فشلت
      Logger.log('تحذير: فشلت مشاركة الملف ' + file.getId() + ': ' + eShare.toString());
    }

    // ⑩ بناء الرابط النهائي (thumbnail للصور، view للباقي)
    var fileId = file.getId();
    var finalUrl;
    if (header.indexOf('image/') === 0) {
      finalUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1400';
    } else if (header.indexOf('video/') === 0) {
      finalUrl = 'https://drive.google.com/file/d/' + fileId + '/preview';
    } else {
      finalUrl = 'https://drive.google.com/file/d/' + fileId + '/view';
    }

    // ⑪ سجل التدقيق
    try {
      var info = getUserInfo('');
      logAudit(info.email, info.email.split('@')[0], 'رفع_ملف',
        'تم رفع ' + finalName + ' إلى ' + subName,
        'Drive', fileId);
    } catch (eLog) { /* غير قاتل */ }

    return {
      success : true,
      url     : finalUrl,
      fileId  : fileId,
      folder  : subName,
      mimeType: header,
      size    : approxSizeBytes
    };

  } catch (e) {
    Logger.log('uploadFileToDrive fatal error: ' + e.toString() + '\n' + e.stack);
    return {
      success: false,
      error  : 'خطأ غير متوقع: ' + e.toString()
    };
  }
}

// ==================== تشخيص وتهيئة ====================
function logClientError(page, msg, stack, ua) {
  var sheet = getSheet('AuditLog');
  if (sheet) sheet.appendRow([Utilities.getUuid(), new Date(), 'client', 'Client', 'خطأ_في_الواجهة', page + ': ' + msg, '', ua || '', 'Client', '']);
}
function generateDebugPage() {
  var html = '<h1>تشخيص CMS</h1><p>الرابط: ' + getAppUrl() + '</p>';
  try {
    var stats = getSystemStats();
    html += '<ul><li>أخبار: ' + stats.News + '</li><li>فيديوهات: ' + stats.Videos + '</li></ul>';
  } catch(e) {}
  return HtmlService.createHtmlOutput(html).setTitle('تشخيص CMS');
}
function initializeSheets() {
  var ss = getSpreadsheet(); if (!ss) return;
  var sheetDefs = [
    { name: 'News',     headers: ['Timestamp','Title','Content','MediaType','MediaURL','UserEmail','UserName','Action'] },
    { name: 'Videos',   headers: ['Timestamp','Title','Description','VideoURL','UserEmail','UserName','Action'] },
    { name: 'Images',   headers: ['Timestamp','Name','Description','ImageURL','UserEmail','UserName','Action'] },
    { name: 'Schedule', headers: ['Timestamp','Platform','PostType','Content','MediaURL','ScheduledDate','Status','UserEmail','UserName','Action'] },
    { name: 'AuditLog', headers: ['LogID','Timestamp','UserEmail','UserName','Action','Details','IP','UserAgent','Sheet','RecordID'] },
    { name: 'Users',    headers: ['Created','Email','Name','Role','LastSeen','TotalActions'] },
    { name: 'PostTypes',headers: ['Platform','PostType','Description'] }
  ];
  for (var i = 0; i < sheetDefs.length; i++) {
    var def = sheetDefs[i];
    if (!ss.getSheetByName(def.name)) {
      var s = ss.insertSheet(def.name);
      s.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
      if (def.name === 'PostTypes') {
        s.appendRow(['فيسبوك', 'منشور', 'نصي/صورة']);
      }
    }
  }
}
function checkDriveFolders() {
  var main = DriveApp.getFolderById(MAIN_FOLDER_ID);
  var names = ['أرشيف_المحتوى', 'ملفات_التصميم', 'المحتوى_المنشور', 'مسودات_المحتوى', 'تقارير_الامتثال'];
  for (var i = 0; i < names.length; i++) {
    var folders = main.getFoldersByName(names[i]);
    if (folders.hasNext()) {
      Logger.log('✅ موجود: ' + names[i]);
    } else {
      Logger.log('❌ مفقود: ' + names[i] + ' — سيتم إنشاؤه');
      main.createFolder(names[i]);
    }
  }
}
function clearCmsCache() {
  _cmsCacheDelMultiple(['newsData', 'videosData', 'imagesData', 'scheduleData', 'systemStats']);
  Logger.log('✅ تم مسح كاش CMS');
}
/**
 * إضافة خبر مع إمكانية رفع صورة مرفقة
 * تقبل بيانات الخبر وصورة (base64) اختيارية
 */
function addNewsWithImage(title, content, imageBase64, imageFileName, imageMimeType, userName, fingerprint) {
  var rl = _checkRateLimit(fingerprint);
  if (!rl.allowed) return '❌ ' + rl.error;

  if (!title || title.toString().trim() === '') return '❌ عنوان الخبر مطلوب';
  if (!content || content.toString().trim() === '') return '❌ محتوى الخبر مطلوب';

  var safeTitle   = _sanitizeText(title);
  var safeContent = _sanitizeText(content);
  var info        = getUserInfo(fingerprint);
  var mediaURL    = '';
  var mediaType   = 'Text';

  // ── رفع الصورة إن وُجدت ────────────────────────────────
  if (imageBase64 && imageFileName && imageBase64.length > 100) {
    try {
      var uploadResult = uploadFileToDrive(imageBase64, imageFileName, 'NEWS_IMAGES');
      if (uploadResult.success) {
        mediaURL  = uploadResult.url;
        mediaType = 'Image';
        Logger.log('addNewsWithImage: تم رفع الصورة بنجاح → ' + mediaURL);
      } else {
        Logger.log('addNewsWithImage: فشل رفع الصورة → ' + uploadResult.error);
        // نكمل بدون صورة
      }
    } catch (e) {
      Logger.log('addNewsWithImage: استثناء أثناء رفع الصورة → ' + e.message);
    }
  }

  // ── تحقق من الرابط (إن وُجد) ────────────────────────────
  if (mediaURL) {
    var urlCheck = _validateUrl(mediaURL);
    if (!urlCheck.valid) return '❌ ' + urlCheck.error;
    mediaURL = urlCheck.url;
  }

  // ── كتابة الخبر في الشيت ─────────────────────────────────
  var sheet = getSheet('News');
  if (!sheet) return '❌ ورقة News غير موجودة';

  sheet.appendRow([
    new Date(),
    safeTitle,
    safeContent,
    mediaType,
    mediaURL,
    info.email,
    userName || (info.email ? info.email.split('@')[0] : 'مجهول'),
    'إضافة'
  ]);

  logAudit(info.email, userName, 'إضافة_خبر', 'تم إضافة خبر: ' + safeTitle, 'News', sheet.getLastRow());

  // مسح الكاش
  _cmsCacheDelMultiple(['newsData', 'systemStats']);

  // مزامنة إلى منصة المعلم
  try {
    _syncNewsToTeacherFile(safeTitle, safeContent, mediaURL, userName, info.email);
  } catch (e) {
    Logger.log('تحذير: تعذرت مزامنة الخبر: ' + e.message);
  }

  return '✅ تمت الإضافة بنجاح بواسطة: ' + (userName || info.email);
}
// في نهاية كل دالة addNews/addImage/addVideo — أضف هذا:
function _clearWebsiteCache() {
  try {
    var cache = CacheService.getScriptCache();
    cache.removeAll([
      'home_data_bundle',
      'school_news_6',
      'school_news_9999',
      'school_images_6',
      'school_videos_8',
      'school_stats'
    ]);
  } catch(e) {
    Logger.log('_clearWebsiteCache error: ' + e.message);
  }
}
/**
 * اختبار شامل لصلاحيات Drive
 * شغّله من محرر Apps Script وافحص Logger
 */
function testDriveAccess() {
  Logger.log('═══ بدء اختبار صلاحيات Drive ═══');

  // ① اختبار الوصول للمجلد الرئيسي
  try {
    var main = DriveApp.getFolderById(MAIN_FOLDER_ID);
    Logger.log('✅ الوصول للمجلد الرئيسي ناجح: ' + main.getName());
  } catch (e) {
    Logger.log('❌ فشل الوصول للمجلد: ' + e.toString());
    return;
  }

  // ② اختبار رفع ملف وهمي صغير
  var tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  var result = uploadFileToDrive(tinyPng, 'test_' + new Date().getTime() + '.png', 'NEWS_IMAGES');

  if (result.success) {
    Logger.log('✅ الرفع التجريبي ناجح');
    Logger.log('   📁 المجلد: ' + result.folder);
    Logger.log('   🔗 الرابط: ' + result.url);
    Logger.log('   🆔 File ID: ' + result.fileId);

    // احذف الملف التجريبي مباشرة
    try {
      DriveApp.getFileById(result.fileId).setTrashed(true);
      Logger.log('   🗑️ تم حذف الملف التجريبي');
    } catch (e) { /* تجاهل */ }
  } else {
    Logger.log('❌ فشل الرفع التجريبي: ' + result.error);
  }

  Logger.log('═══ انتهى الاختبار ═══');
}