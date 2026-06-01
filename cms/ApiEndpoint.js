/**
 * ApiEndpoint.js — نقطة دخول JSON/fetch للواجهة الثابتة (GitHub Pages).
 * تطبيق: CMS
 * مدارس الإبداع والتميز الدولية
 *
 * أُضيف ليُمكِّن قيادة تطبيق الويب عبر gas-bridge.js (fetch) بدل عميل
 * google.script.run الخاص بـ HtmlService، وبذلك تُستضاف الواجهة على
 * GitHub Pages دون رسالة تحذير Google.
 *
 * CORS: لا يضبط GAS ترويسة ACAO يدوياً، لكن رابط /exec يُرجِعها تلقائياً.
 * الواجهة ترسل Content-Type: text/plain (طلب بسيط) فلا preflight (OPTIONS).
 *
 * الأمان: يُسمح فقط باستدعاء الدوال المدرجة في API_ALLOWED_FUNCTIONS.
 * صياغة ES5 فقط (var، دوال عادية، بلا قوالب نصية).
 */

var API_ALLOWED_FUNCTIONS = ['addImage', 'addNews', 'addSchedule', 'addVideo', 'getAuditLog', 'getPageUrl', 'getPostTypesForPlatform', 'getSystemStats', 'logClientError', 'uploadFileToDrive'];

function _apiJsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _apiIsAllowed(name) {
  for (var i = 0; i < API_ALLOWED_FUNCTIONS.length; i++) {
    if (API_ALLOWED_FUNCTIONS[i] === name) return true;
  }
  return false;
}

function _apiResolve(name) {
  try {
    if (typeof globalThis !== 'undefined' && typeof globalThis[name] === 'function') {
      return globalThis[name];
    }
  } catch (e) {}
  try {
    var f = eval(name);
    if (typeof f === 'function') return f;
  } catch (e2) {}
  return null;
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    var req = JSON.parse(raw);
    var fn = req && req.fn;
    var args = (req && req.args) ? req.args : [];
    if (!fn || typeof fn !== 'string') {
      return _apiJsonOut({ ok: false, error: "اسم الدالة مفقود" });
    }
    if (!_apiIsAllowed(fn)) {
      return _apiJsonOut({ ok: false, error: "دالة غير مسموح بها: " + fn });
    }
    var target = _apiResolve(fn);
    if (!target) {
      return _apiJsonOut({ ok: false, error: "الدالة غير موجودة: " + fn });
    }
    var result = target.apply(null, args);
    return _apiJsonOut({ ok: true, result: result });
  } catch (err) {
    return _apiJsonOut({ ok: false, error: String((err && err.message) || err) });
  }
}
