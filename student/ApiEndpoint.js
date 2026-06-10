/**
 * ApiEndpoint.js — نقطة دخول JSON/fetch للواجهة الثابتة (Cloudflare/GitHub Pages).
 * تطبيق: STUDENT — مدارس الإبداع والتميز الدولية
 *
 * يستقبل { fn, args } عبر doPost وينفّذ الدالة العامّة المطلوبة ويُعيد JSON.
 *
 * الأمان (المرحلة 1 — قائمة سماح Whitelist):
 *   لا يُسمح بتنفيذ أي دالة إلا إذا كان اسمها مُدرجاً صراحةً في API_ALLOWED_FUNCTIONS.
 *   المصدر الموثوق للقائمة: _build/whitelist.json › "student" (تُولَّد آلياً في المرحلة 3).
 *   هذا يُلغي الخطر السابق (blocklist) الذي كان يسمح باستدعاء أي دالة عامة.
 *   طبقة ثانية: دوال *Protected تتحقق من التوكن بنفسها.
 *
 * ملاحظة: يبقى eval في _apiResolve محلِّلاً احتياطياً فقط، وأصبح آمناً لأن الاسم
 *   مقيَّد مسبقاً بقائمة السماح (يُستبدَل بخريطة دوال مولَّدة عبر _build/ في المرحلة 3).
 *
 * CORS: رابط /exec يُرجِع ACAO تلقائياً؛ والواجهة ترسل text/plain (طلب بسيط).
 * صياغة ES5 فقط (var، دوال عادية، بلا قوالب نصية).
 */

// قائمة السماح — مطابقة لـ _build/whitelist.json › "student"
var API_ALLOWED_FUNCTIONS = [
  'changePassword',
  'getGrades',
  'getStudentNotificationBadge',
  'getStudentReports',
  'getTeachersForClass',
  'loginStudent',
  'recordStudentNewsView',
  'submitNote',
  'toggleStudentNewsLike'
];

function _apiJsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _apiIsAllowed(name) {
  if (!name || typeof name !== 'string') return false;
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
    var f = eval(name); // آمن: name مقيَّد مسبقاً بقائمة السماح في doPost
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
