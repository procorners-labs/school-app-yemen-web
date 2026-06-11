/**
 * ApiEndpoint.js — نقطة دخول JSON/fetch للواجهة الثابتة (Cloudflare/GitHub Pages).
 * تطبيق: MASTER-ADMIN — مدارس الإبداع والتميز الدولية
 *
 * يستقبل { fn, args } عبر doPost وينفّذ الدالة العامّة المطلوبة ويُعيد JSON.
 * الأمان (denylist مُحسّنة — المرحلة 1): يُسمح بأي دالة عامّة عدا: دوال الإطار،
 * الدوال الداخلية (المسبوقة بـ _)، والدوال الخطرة (إدارية/صيانة/هجرة) في
 * API_DANGEROUS_FUNCTIONS. دوال *Protected تتحقق من التوكن بنفسها (طبقة ثانية).
 * مصدر قائمة الخطرة: _build/denylist.generated.json (دوال موجودة وغير مستدعاة من الواجهة).
 *
 * CORS: رابط /exec يُرجِع ACAO تلقائياً؛ والواجهة ترسل text/plain (طلب بسيط).
 * صياغة ES5 فقط (var، دوال عادية، بلا قوالب نصية).
 */

var API_FRAMEWORK_FUNCTIONS = ['doGet', 'doPost', 'doOptions', 'onOpen', 'onEdit', 'onInstall', 'onFormSubmit', 'onSelectionChange'];

// 🚫 دوال خطرة تُمنع صراحةً من الاستدعاء عبر الويب — مصدرها _build/denylist.generated.json
var API_DANGEROUS_FUNCTIONS = [
  'deleteSchoolProtected', 'registerSchoolProtected', 'repairAllSchools',
  'setInviteKeyProtected', 'upgradeDefaultAdminToOwner',
  'resetDeploymentUrls', 'showDeploymentUrls', 'updateAllDeploymentUrls', 'updateDeploymentUrl',
  // ── المرحلة 2 (أمان): دوال غير مستدعاة من الواجهة تُحجب عن مسار الويب ──
  // (الحجب يمنع doPost فقط؛ الاستدعاءات الداخلية ومشغّلات المزامنة تبقى تعمل)
  'getMasterSetting',          // حرج: كان يسمح بقراءة invite_key وتجاوز بوابة الإنشاء
  'validateMasterToken',       // مساعد داخلي — لا يُستدعى من الواجهة
  'buildSchoolPortalLinks',    // كشف روابط بوابات مدرسة بمعرّفها
  'syncGradesToStudent', 'syncFeesToStudent',
  'syncViolationsToStudent', 'syncNotesFromStudent',
  'collectAllStats', 'checkSubscriptions', 'getSchoolProvisioningStatus'
];

var API_BLOCKED_FUNCTIONS = API_FRAMEWORK_FUNCTIONS.concat(API_DANGEROUS_FUNCTIONS);

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
