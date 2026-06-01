/**
 * ApiEndpoint.js — نقطة دخول JSON/fetch للواجهة الثابتة (Cloudflare/GitHub Pages).
 * تطبيق: STUDENT — مدارس الإبداع والتميز الدولية
 *
 * يستقبل { fn, args } عبر doPost وينفّذ الدالة العامّة المطلوبة ويُعيد JSON.
 * الأمان (مطابق للأصل): يُسمح بأي دالة عامّة عدا دوال الإطار والدوال الداخلية
 * (المسبوقة بـ _)؛ ودوال *Protected تتحقق من التوكن بنفسها.
 *
 * CORS: رابط /exec يُرجِع ACAO تلقائياً؛ والواجهة ترسل text/plain (طلب بسيط).
 * صياغة ES5 فقط (var، دوال عادية، بلا قوالب نصية).
 */

var API_BLOCKED_FUNCTIONS = ['doGet', 'doPost', 'doOptions', 'onOpen', 'onEdit', 'onInstall', 'onFormSubmit', 'onSelectionChange'];

function _apiJsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _apiIsBlocked(name) {
  if (!name || typeof name !== 'string') return true;
  if (name.charAt(0) === '_') return true;            // دوال داخلية
  for (var i = 0; i < API_BLOCKED_FUNCTIONS.length; i++) {
    if (API_BLOCKED_FUNCTIONS[i] === name) return true; // دوال الإطار
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
    if (_apiIsBlocked(fn)) {
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
