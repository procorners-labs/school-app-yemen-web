/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DeploymentRegistry.gs — السجل المركزي لروابط جميع المنصات
 *  ─────────────────────────────────────────────────────────────────────────
 *  هذا الملف يُنسخ كما هو في كل المشاريع الستة. لا يُعدَّل في كل مشروع.
 *  يقرأ الروابط من ScriptProperties، فإن لم توجد يستخدم الروابط الافتراضية.
 *  
 *  لتحديث رابط بعد إعادة النشر:
 *    1. افتح أي مشروع → File → Project Properties → Script Properties
 *    2. أضف/حدّث المفتاح المطلوب (DEPLOY_TEACHER, DEPLOY_STUDENT, ...)
 *    3. أو نفّذ updateDeploymentUrl(key, newUrl) من المحرر
 *  
 *  المفاتيح المعتمدة:
 *    DEPLOY_HOME      → الموقع الرسمي
 *    DEPLOY_CMS       → نظام إدارة المحتوى
 *    DEPLOY_TEACHER   → منصة المعلمين
 *    DEPLOY_STUDENT   → منصة الطلاب
 *    DEPLOY_SCHEDULE  → أداة توزيع الحصص
 *    DEPLOY_MASTER    → لوحة التحكم المركزية
 * ═══════════════════════════════════════════════════════════════════════════
 */

// الروابط الافتراضية — تُستخدم فقط إذا لم توجد قيمة في ScriptProperties
var DEFAULT_DEPLOYMENTS = {
  DEPLOY_HOME:     'https://script.google.com/macros/s/AKfycbzDfGEK6IpChVNl9k8xbt_iv5p6bLOktt-TvEzDp8yBpH3Ga3yNMen_0S2ZyuuvGtKFCA/exec',
  DEPLOY_CMS:      'https://script.google.com/macros/s/AKfycbz-iAj9L3ROOn4CAjmwkVBUqpWuxIx1LkgPLwKnHu7kHLWKCy3GVJNo1vZbnekop0VlMA/exec',
  DEPLOY_TEACHER:  'https://script.google.com/macros/s/AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND/exec',
  DEPLOY_STUDENT:  'https://script.google.com/macros/s/AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq/exec',
  DEPLOY_SCHEDULE: 'https://script.google.com/macros/s/AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag/exec',
  DEPLOY_MASTER:   'https://script.google.com/macros/s/AKfycbx5H6uYXb-6iVt_nT4YkdnYMhl6eZJSDxsULsKa2eyblZQcwzRo4CXR3Mh_ecRSZd4M/exec'
};

// مدة الكاش (دقيقة واحدة) — الروابط نادراً ما تتغيّر
var DEPLOY_CACHE_TTL = 60;

/**
 * الدالة الرئيسية — تُرجع جميع روابط المنظومة
 * تُستدعى من جميع ملفات HTML عبر google.script.run
 * @returns {Object} كائن يحتوي جميع الروابط + معلومات إضافية
 */
function getDeploymentUrls() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('deployment_urls_v2');
    if (cached) {
      try { return JSON.parse(cached); } catch(e) { /* تجاهل */ }
    }

    var props = PropertiesService.getScriptProperties();
    var stored = props.getProperties() || {};

    var result = {
      home:     _getDeployUrl(stored, 'DEPLOY_HOME'),
      cms:      _getDeployUrl(stored, 'DEPLOY_CMS'),
      teacher:  _getDeployUrl(stored, 'DEPLOY_TEACHER'),
      student:  _getDeployUrl(stored, 'DEPLOY_STUDENT'),
      schedule: _getDeployUrl(stored, 'DEPLOY_SCHEDULE'),
      master:   _getDeployUrl(stored, 'DEPLOY_MASTER'),
      // الرابط الحالي (الذي يُنفَّذ منه هذا الكود)
      current:  _getCurrentScriptUrl(),
      // ختم زمني للتحقق
      ts:       new Date().getTime(),
      version:  'v2'
    };

    // كاش لمدة دقيقة
    try { cache.put('deployment_urls_v2', JSON.stringify(result), DEPLOY_CACHE_TTL); } catch(e) {}

    return result;
  } catch (err) {
    // في أسوأ الأحوال — أرجع الافتراضيات
    return {
      home:     DEFAULT_DEPLOYMENTS.DEPLOY_HOME,
      cms:      DEFAULT_DEPLOYMENTS.DEPLOY_CMS,
      teacher:  DEFAULT_DEPLOYMENTS.DEPLOY_TEACHER,
      student:  DEFAULT_DEPLOYMENTS.DEPLOY_STUDENT,
      schedule: DEFAULT_DEPLOYMENTS.DEPLOY_SCHEDULE,
      master:   DEFAULT_DEPLOYMENTS.DEPLOY_MASTER,
      current:  '',
      ts:       new Date().getTime(),
      version:  'v2',
      error:    String(err && err.message ? err.message : err)
    };
  }
}

/**
 * إصدار JSONP — يُستخدم من تطبيق Android عبر web_fetch مباشرة بدون CORS
 * فائدته: يمكن لـ AppConfig.kt جلب الروابط بنداء HTTP بسيط
 * 
 * الاستدعاء: GET <SCRIPT_URL>?action=deployments
 */
function _handleDeploymentsRequest() {
  var data = getDeploymentUrls();
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * مساعد داخلي — يجلب رابط محدد بالأولوية:
 * 1. ScriptProperties (الأحدث)
 * 2. DEFAULT_DEPLOYMENTS (احتياطي)
 */
function _getDeployUrl(stored, key) {
  if (stored && stored[key] && _isValidUrl(stored[key])) {
    return String(stored[key]);
  }
  return DEFAULT_DEPLOYMENTS[key] || '';
}

/**
 * مساعد داخلي — تحقق من صلاحية الرابط
 */
function _isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.indexOf('https://script.google.com/macros/') === 0 &&
         url.indexOf('/exec') > 0;
}

/**
 * يُرجع رابط السكربت الحالي (الذي يُنفَّذ منه الكود)
 */
function _getCurrentScriptUrl() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

/**
 * تحديث رابط منصة محددة — يُنفَّذ يدوياً من محرر Apps Script
 * مثال: updateDeploymentUrl('DEPLOY_TEACHER', 'https://script.google.com/macros/s/.../exec')
 * 
 * @param {string} key - مفتاح المنصة (DEPLOY_TEACHER, DEPLOY_STUDENT, ...)
 * @param {string} url - الرابط الجديد
 * @returns {Object} نتيجة العملية
 */
function updateDeploymentUrl(key, url) {
  try {
    if (!key || !url) return { success: false, error: 'المفتاح والرابط مطلوبان' };
    if (!DEFAULT_DEPLOYMENTS.hasOwnProperty(key)) {
      return { success: false, error: 'مفتاح غير معروف: ' + key };
    }
    if (!_isValidUrl(url)) {
      return { success: false, error: 'رابط غير صالح. يجب أن يبدأ بـ https://script.google.com/macros/' };
    }

    PropertiesService.getScriptProperties().setProperty(key, url);
    // مسح الكاش لإجبار التحديث
    try { CacheService.getScriptCache().remove('deployment_urls_v2'); } catch(e) {}

    return { success: true, key: key, url: url, ts: new Date().getTime() };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

/**
 * تحديث جماعي لجميع الروابط دفعة واحدة
 * @param {Object} urlsObject - كائن { DEPLOY_HOME: '...', DEPLOY_TEACHER: '...' }
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
      if (!_isValidUrl(urlsObject[key])) {
        skipped.push(key + ' (رابط غير صالح)');
        continue;
      }
      props.setProperty(key, urlsObject[key]);
      updated.push(key);
    }

    try { CacheService.getScriptCache().remove('deployment_urls_v2'); } catch(e) {}

    return {
      success: true,
      updated: updated,
      skipped: skipped,
      ts: new Date().getTime()
    };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

/**
 * إعادة تعيين الروابط للقيم الافتراضية
 */
function resetDeploymentUrls() {
  try {
    var props = PropertiesService.getScriptProperties();
    var keys = ['DEPLOY_HOME', 'DEPLOY_CMS', 'DEPLOY_TEACHER',
                'DEPLOY_STUDENT', 'DEPLOY_SCHEDULE', 'DEPLOY_MASTER'];
    for (var i = 0; i < keys.length; i++) {
      props.deleteProperty(keys[i]);
    }
    try { CacheService.getScriptCache().remove('deployment_urls_v2'); } catch(e) {}
    return { success: true, message: 'تمت إعادة التعيين بنجاح' };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

/**
 * عرض الروابط الحالية (للتشخيص) — تُستدعى يدوياً من المحرر
 */
function showDeploymentUrls() {
  var urls = getDeploymentUrls();
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('  روابط المنظومة الحالية');
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('🏠 الموقع الرسمي : ' + urls.home);
  Logger.log('📰 CMS           : ' + urls.cms);
  Logger.log('👨‍🏫 المعلمين       : ' + urls.teacher);
  Logger.log('🎓 الطلاب        : ' + urls.student);
  Logger.log('📅 الحصص         : ' + urls.schedule);
  Logger.log('👑 Master Admin  : ' + urls.master);
  Logger.log('📍 الحالي        : ' + urls.current);
  Logger.log('═══════════════════════════════════════════════');
  return urls;
}