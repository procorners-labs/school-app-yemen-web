/**
 * FbOAuth.js — اتصال «تسجيل الدخول بفيسبوك» (OAuth) لكل مدرسة.
 * مدارس الإبداع والتميز الدولية — مشروع CMS (نفس الشيت 1J7DY-...).
 *
 * التدفّق:
 *   1) المستخدم يضغط «🔗 اتصل بفيسبوك» → getFbConnectUrl(schoolId) يبني رابط تفويض Meta
 *      مع state=schoolId ويفتحه في نافذة.
 *   2) بعد الموافقة يعيد Meta التوجيه إلى:  <Worker>/oauth?code=...&state=schoolId
 *      الـ Worker يمرّرها إلى doGet هنا (action=fb_oauth) → fbOAuthCallback(e).
 *   3) نبادل code بتوكن مستخدم قصير → طويل الأمد → نجلب صفحة المستخدم + توكنها
 *      + معرّف إنستغرام التجاري → نحفظها في «اعدادات_السوشل» لتلك المدرسة.
 *
 * ⚠️ أمان: لا تُكتب الأسرار في الكود (الريبو عام). تُحفظ في ScriptProperties:
 *   FB_APP_ID , FB_APP_SECRET , FB_REDIRECT_URI
 * شغّل setupFbOAuth() مرّة واحدة بعد وضع قيمك فيها (في محرّر Apps Script فقط).
 *
 * ES5 فقط: var، دوال عادية، بلا let/const/arrow/template literals.
 */

var FB_API_VER = 'v18.0';
var FB_DEFAULT_REDIRECT = 'https://school-teacher-proxy.procorners-shop.workers.dev/oauth';
var FB_RETURN_URL = 'https://school-teacher-proxy.procorners-shop.workers.dev/cms/index.html';

// الصلاحيات المطلوبة للنشر على الصفحة وإنستغرام (تتطلب App Review قبل العموم)
var FB_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management';

/**
 * إعداد لمرّة واحدة — ضع قيمك ثم شغّلها من محرّر Apps Script.
 * (لا تترك الأسرار الحقيقية محفوظة في هذا الملف داخل الريبو العام.)
 */
function setupFbOAuth() {
  var APP_ID     = 'ضع_APP_ID_هنا';      // مثال: 1578121117650323
  var APP_SECRET = 'ضع_APP_SECRET_هنا';  // من Settings → Basic → App Secret
  var REDIRECT   = FB_DEFAULT_REDIRECT;   // يجب أن يطابق «Valid OAuth Redirect URIs» في Meta

  PropertiesService.getScriptProperties().setProperties({
    'FB_APP_ID'      : APP_ID,
    'FB_APP_SECRET'  : APP_SECRET,
    'FB_REDIRECT_URI': REDIRECT
  });
  Logger.log('✅ حُفظت إعدادات OAuth. تذكّر تدوير المفتاح السري في Meta إن سبق نشره.');
  return { success: true };
}

function _fbCfg() {
  var p = PropertiesService.getScriptProperties();
  return {
    appId:    p.getProperty('FB_APP_ID') || '',
    secret:   p.getProperty('FB_APP_SECRET') || '',
    redirect: p.getProperty('FB_REDIRECT_URI') || FB_DEFAULT_REDIRECT
  };
}

/**
 * عام — تبنيه الواجهة لزر «اتصل بفيسبوك».
 * @param {string} schoolId معرّف المدرسة (يُحفظ التوكن لها).
 * @return {{success:boolean, url?:string, error?:string}}
 */
function getFbConnectUrl(schoolId) {
  var cfg = _fbCfg();
  if (!cfg.appId) {
    return { success: false, error: 'لم يُضبط FB_APP_ID بعد. شغّل setupFbOAuth() أولاً.' };
  }
  var state = _smmSafeStr ? _smmSafeStr(schoolId) : String(schoolId || '');
  if (!state) state = 'default';

  var url = 'https://www.facebook.com/' + FB_API_VER + '/dialog/oauth' +
    '?client_id=' + encodeURIComponent(cfg.appId) +
    '&redirect_uri=' + encodeURIComponent(cfg.redirect) +
    '&state=' + encodeURIComponent(state) +
    '&response_type=code' +
    '&scope=' + encodeURIComponent(FB_SCOPES);
  return { success: true, url: url };
}

function _fbGetJson(url) {
  var resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
  var txt = resp.getContentText();
  try { return JSON.parse(txt); } catch (e) { return { error: { message: txt } }; }
}

/**
 * معالج عودة OAuth (يُستدعى من doGet عبر action=fb_oauth).
 * يُعيد صفحة HTML (تُعرض عبر الـ Worker).
 */
function fbOAuthCallback(e) {
  var P = (e && e.parameter) ? e.parameter : {};
  if (P.error) {
    return _fbPage(false, 'أُلغي الاتصال أو رُفض: ' + _fbEsc(P.error_description || P.error));
  }
  var code = P.code || '';
  var schoolId = P.state || 'default';
  if (!code) return _fbPage(false, 'لم يصل رمز التفويض (code).');

  var cfg = _fbCfg();
  if (!cfg.appId || !cfg.secret) {
    return _fbPage(false, 'الخادم غير مُهيّأ (FB_APP_ID / FB_APP_SECRET). شغّل setupFbOAuth().');
  }

  try {
    // 1) code → توكن مستخدم قصير الأمد
    var t1 = _fbGetJson('https://graph.facebook.com/' + FB_API_VER + '/oauth/access_token' +
      '?client_id=' + encodeURIComponent(cfg.appId) +
      '&redirect_uri=' + encodeURIComponent(cfg.redirect) +
      '&client_secret=' + encodeURIComponent(cfg.secret) +
      '&code=' + encodeURIComponent(code));
    if (!t1.access_token) return _fbPage(false, 'فشل تبادل الرمز: ' + _fbEsc(JSON.stringify(t1)));

    // 2) قصير → طويل الأمد
    var t2 = _fbGetJson('https://graph.facebook.com/' + FB_API_VER + '/oauth/access_token' +
      '?grant_type=fb_exchange_token' +
      '&client_id=' + encodeURIComponent(cfg.appId) +
      '&client_secret=' + encodeURIComponent(cfg.secret) +
      '&fb_exchange_token=' + encodeURIComponent(t1.access_token));
    var userToken = t2.access_token || t1.access_token;

    // 3) صفحات المستخدم (توكن الصفحة المشتق من توكن طويل = دائم عملياً)
    var pages = _fbGetJson('https://graph.facebook.com/' + FB_API_VER +
      '/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=' + encodeURIComponent(userToken));
    if (!pages.data || !pages.data.length) {
      return _fbPage(false, 'لا توجد صفحة مرتبطة بهذا الحساب، أو لم تُمنح صلاحية الصفحات.');
    }
    var pg = pages.data[0];
    var igId = (pg.instagram_business_account && pg.instagram_business_account.id) ? pg.instagram_business_account.id : '';

    // 4) حفظ في «اعدادات_السوشل» لهذه المدرسة
    var saved = { success: false };
    if (typeof smmSaveSocialSettings === 'function') {
      saved = smmSaveSocialSettings(schoolId, {
        fb_page_id: pg.id,
        fb_page_token: pg.access_token,
        ig_business_id: igId
      });
    }
    if (!saved || !saved.success) {
      return _fbPage(false, 'تعذّر حفظ التوكن: ' + _fbEsc((saved && saved.error) || 'خطأ غير معروف'));
    }

    var msg = 'تم ربط صفحة «' + _fbEsc(pg.name || pg.id) + '» بمدرسة «' + _fbEsc(schoolId) + '» بنجاح.' +
      (igId ? ' (وحساب إنستغرام مرتبط ✓)' : ' (لا يوجد إنستغرام تجاري مرتبط بالصفحة)');
    return _fbPage(true, msg);
  } catch (err) {
    return _fbPage(false, 'خطأ أثناء الاتصال: ' + _fbEsc(String((err && err.message) || err)));
  }
}

function _fbEsc(s) {
  s = String(s == null ? '' : s);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _fbPage(ok, message) {
  var color = ok ? '#1e8e3e' : '#c5221f';
  var icon = ok ? '✅' : '⚠️';
  var title = ok ? 'تم الاتصال بنجاح' : 'تعذّر الاتصال';
  var html = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<style>body{font-family:Tahoma,Arial,sans-serif;background:#f1f5f9;margin:0;' +
    'display:flex;min-height:100vh;align-items:center;justify-content:center}' +
    '.card{background:#fff;max-width:460px;padding:32px;border-radius:16px;text-align:center;' +
    'box-shadow:0 10px 30px rgba(0,0,0,.12)}.ic{font-size:54px}h2{color:' + color + ';margin:12px 0}' +
    'p{color:#334155;line-height:1.7}a{display:inline-block;margin-top:18px;background:#0f3b5c;color:#fff;' +
    'text-decoration:none;padding:11px 22px;border-radius:10px;font-weight:bold}</style></head>' +
    '<body><div class="card"><div class="ic">' + icon + '</div><h2>' + title + '</h2>' +
    '<p>' + message + '</p>' +
    '<a href="' + FB_RETURN_URL + '">العودة إلى لوحة المحتوى</a></div>' +
    '<script>setTimeout(function(){location.href="' + FB_RETURN_URL + '";},6000);<\/script>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
