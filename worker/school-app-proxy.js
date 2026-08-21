/**
 * school-app-proxy — Cloudflare Worker
 * يمن سكولز | Yemen Schoolz — نظام إدارة المدارس
 *
 * الغرض: تشغيل الموقع بدون VPN في المناطق التي يُحجب فيها github.io.
 *  - يخدم صفحات الواجهة الثابتة بجلبها من GitHub Pages نيابةً عن المتصفّح
 *    (Cloudflare تصل إلى github.io حتى لو كان محجوباً لدى المستخدم).
 *  - يمرّر نداءات الـ API على المسار /gas/<app> إلى روابط Google Apps Script.
 *
 * النتيجة: المتصفّح يتكلّم فقط مع نطاق Cloudflare (workers.dev) — لا github.io
 * ولا google مباشرةً — فلا حجب ولا مشاكل CORS.
 *
 * كيفية النشر:
 *  1) Cloudflare Dashboard → Workers & Pages → Create → Worker.
 *  2) الصق هذا الملف بالكامل في المحرّر ثم Deploy.
 *  3) افتح رابط الـ Worker الناتج (مثل https://school-app.<حسابك>.workers.dev/).
 */

var GITHUB_BASE = 'https://procorners-labs.github.io/school-app-yemen-web';

var GAS = {
  home:     'https://script.google.com/macros/s/AKfycbzDfGEK6IpChVNl9k8xbt_iv5p6bLOktt-TvEzDp8yBpH3Ga3yNMen_0S2ZyuuvGtKFCA/exec',
  'home-all-school': 'https://script.google.com/macros/s/AKfycbx21N0YQAqby2TV0q3lrxPHjGHo19y6_6ez0xeB4rvsncmSbRlyLh4iiNvrbtP6-ng2/exec',
  cms:      'https://script.google.com/macros/s/AKfycbz-iAj9L3ROOn4CAjmwkVBUqpWuxIx1LkgPLwKnHu7kHLWKCy3GVJNo1vZbnekop0VlMA/exec',
  teacher:  'https://script.google.com/macros/s/AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND/exec',
  // ⚠️ هذه القيمة **لم تعد وجهةَ `/gas/student`** منذ ص6 — انظر التحويل أسفل الجدول
  //    مباشرةً. تبقى مكتوبةً هنا لأنها **مسار التراجع الفوري**، ولأن حذفها يقطع العقد.
  student:  'https://script.google.com/macros/s/AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq/exec',
  schedule: 'https://script.google.com/macros/s/AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag/exec',
  'master-admin': 'https://script.google.com/macros/s/AKfycbx5H6uYXb-6iVt_nT4YkdnYMhl6eZJSDxsULsKa2eyblZQcwzRo4CXR3Mh_ecRSZd4M/exec',
  pricing:  'https://script.google.com/macros/s/AKfycbz11yUbrix4F1lE_GbiAFqE3EClGpoRvAb19LoLoABQX_Xo3i2U25jlQpOFcN9S_yLC/exec'
};

// ═══════════════════════════════════════════════════════════════════════════
//  ص6 — `/gas/student` يُخدَم من نشرة `teacher` (2026-08-19)
// ═══════════════════════════════════════════════════════════════════════════
//  منطق مشروع `student` كلُّه صار داخل مشروع `teacher` (ص4/ص5). وأُثبِت حيّاً قبل
//  هذا السطر أنّ `/gas/teacher?app=student` يخدم **413,620 بايتاً من قالبنا مطابقةً
//  حرفياً** لما يخدمه `/gas/student`، وأنّ `?app=student&action=health` يردّ
//  `app=student · ok=true`. ⇒ النقل هنا تبديلُ وجهةٍ لا تغييرُ محتوى.
//
//  🔴 **ولماذا لا يُغيَّر المدخل في الجدول أعلاه:**
//   (١) قيمته الأصلية هي **مسار التراجع الفوري** — إن أخفق النقل تُعاد هذه الحارسة
//       الواحدة إلى `GAS.student` ويُدفَع الوركر: ثوانٍ، **بلا أيّ نشر GAS**، ومشروع
//       `student` باقٍ منشوراً حيّاً وكاملاً. ومعرّف نشره **لا يُحذف أبداً**
//       (‏`clasp undeploy` ممنوع) — المعرّف لا يعود إن حُذف.
//   (٢) `student: GAS.teacher` **داخل** الحرفيّة نفسها لا يعمل أصلاً: `GAS` لم يُسنَد
//       بعد وقت تقييم الحرفيّة ⇒ `undefined` ⇒ «تطبيق غير معروف» على كل نداء.
//
//  ⚠️ ولا يكفي تبديلُ الوجهة وحده: معالج `/gas/<app>` يبني الهدف بـ`target + url.search`،
//     فنداءٌ عارٍ يصل `doGet` المعلّم **بلا مُميِّز** فيخدم لوحة المعلّم بدل صفحة الطالب.
//     المُميِّزُ `app=student` يُلحَق في المعالج **للمدخل `student` وحده** — انظر
//     `fullTarget` أدناه، وقارئه `teacher/TeacherCore.js::doGet`.
GAS.student = GAS.teacher;

// ═══════════════════════════════════════════════════════════════════════════
//  منظّم التزاحم (bulkhead) — المرحلة أ: حَكْم داخل العامل الواحد
// ═══════════════════════════════════════════════════════════════════════════
//  المشكلة: حصة Google = 30 تنفيذاً متزامناً **لكل حساب**، مشتركة بين التطبيقات
//  الثمانية كلها (كلها Execute-as-Me بنفس procorners.shop@gmail.com). الوسيط كان
//  يُطلق نحو GAS بلا أي وعي بعدد ما أطلقه هو نفسه للتوّ، فيُساهم في إغراق الحصة
//  ذاتياً — الطبقة الثالثة من حادثة 2026-07-28 (راجع التعليق داخل حلقة إعادة
//  المحاولة أدناه؛ الطبقتان الأوليان: استنفاد الحصة نفسه، وتضخيم إعادة المحاولة).
//
//  مضخّمات حمل مؤكَّدة في الواجهة تُبرّر **الطابور** لا مجرّد الرفض:
//    • assets/offline-sync.js — Promise.all بلا حدّ على كل القراءات المتتبَّعة عند
//      عودة الاتصال ⇒ انفجار متزامن من عميل واحد.
//    • teacher — setInterval(_visitsPollOnline, 18000): نبض دائم لكل تبويب مفتوح.
//    • assets/gas-bridge.js — كل رفض *قراءة* يعود كموجة ثانية بعد 900ms.
//
//  ⚠️ حدود هذه الطبقة (مُصرَّح بها عمداً، لا تُنسَ عند قراءة السجلّات):
//   1) الحالة على مستوى الوحدة ⇒ عمرها عمر الـisolate. لا ترى isolates أخرى،
//      فالسقف الفعلي = (عدد الـisolates النشطة × BH_ISO_GLOBAL). تكبح أسوأ تضخيم
//      بصفر تكلفة وصفر زمن مضاف، لكنها **لا تفرض** حدّاً عالمياً صلباً. فرضُه
//      يتطلّب حالة مشتركة (Durable Object) — المرحلة ب، مشروطة بالقياس أدناه.
//   2) لا تتسرّب أبداً: موت الـisolate يمحو العدّاد معه (بخلاف عدّاد مركزي الذي
//      يحتاج إيجاراً بمهلة + كنساً).
//   3) نداءات GAS→GAS (جسر teacher→schedule في activateSchoolPlatformProtected،
//      وجسر teacher→master-admin في createSchoolBranchProtected) تخرج من GAS
//      مباشرةً إلى /exec ولا تمرّ بهذا الوسيط إطلاقاً ⇒ غير مرئية لهذا المنظّم،
//      وكل واحد منها يحجز مقعدين (المُستدعي محجوز منتظِراً + المُستدعَى يعمل).
//      محسوبة ضمن الهامش المتروك من الثلاثين، لا ضمن السقوف أدناه.
//
//  القياس الذي يقرّر المرحلة ب — قانون Little من سجلّات ev:'bulkhead':
//      N ≈ λ × W   (λ = نداءات/ثانية، W = متوسط زمن النداء بالثواني)
//  إن بقي p99(N) عبر أسبوع (شامل ذروة الإقلاع الصباحي) دون ~12 فالمرحلة أ كافية.
var BH_ISO_GLOBAL  = 8;      // أقصى تزامن نحو GAS داخل عامل واحد (كل التطبيقات)
var BH_ISO_APP     = 5;      // سقف فرعي لكل تطبيق داخل عامل واحد (منع الاحتكار)
var BH_MAX_WAIT_MS = 8000;   // أقصى انتظار في الطابور قبل رفض نظيف بـ503

// ── جِتَر على مهلة الانتظار (‏2026-08-21) ──────────────────────────────────────
// 🔴 تصادفٌ مقيس: `BH_MAX_WAIT_MS = 8000` كان **يساوي بالضبط** مؤقّت إفراجٍ عميليّ
// (`BOOT_SCHEMA_RELEASE_MS = 8000` في منصّة المعلم) ⇒ لحظةُ رفض الطابور بـ503 هي نفس
// لحظة إطلاق نداءٍ إضافي، فيلتقي بخانقٍ امتلأ للتوّ. عولج الجذرُ عميلياً (بند 169:
// العضو ينضمّ للحزمة الطائرة)، ويبقى الجِتَر لأيّ مؤقّتٍ ثابتٍ آخر — عميلٍ قديم في
// كاش، أو تطبيق أندرويد لا يُحدَّث، أو مؤقّتٍ يُضاف لاحقاً بلا انتباه.
// ±1 ثانية حول 8,000 يفكّ الرنين بصفر كلفة وبلا تغيير في أسوأ زمن.
function _bhWaitMs() { return 7000 + Math.floor(Math.random() * 2000); }

// ── نافذةٌ أوسع لنداءات الدخول وحدها ─────────────────────────────────────────
// 🔴 الدخول هو **النداء الوحيد** الذي فشلُه يُفشِل تجربة المستخدم كلَّها: مُصنَّف
// `ONLINE_ONLY` في `assets/gas-bridge.js` ⇒ محاولة واحدة · صفر كاش · صفر طيّ. فرفضُ
// خانقٍ واحد = «تعذّر تسجيل الدخول» فوراً، بينما كلّ نداءات الإقلاع الثمانية
// مُتحمَّلة الفشل (تتراجع لكاش أو تُؤجَّل).
//
// ⚠️ **والمبدأ الحاكم — وهو ما يجعله نقيضَ إعادة المحاولة لا نوعاً منها (بند 128):**
// الانتظار في طابور القبول **لا يحجز مقعد GAS**. طلبٌ واحد ينتظر دوره، لا طلبان
// يتزاحمان. وإعادةُ المحاولة تضاعف الحمل وقت الإشباع؛ هذا يُنقصه.
//
// 🔴 ولا يُطيل أسوأ زمن: `TOTAL_BUDGET_MS = 24000 - _bhWaited` أدناه **يخصم** الانتظار
// من ميزانية المحاولات، فالسقف الكلّي يبقى ~24ث. الثمنُ أن طلبَ دخولٍ انتظر طويلاً
// يحصل على محاولةٍ واحدة بدل اثنتين — وهو السلوك الصحيح تحت الإشباع لا تدهور.
//
// **أسوأ زمن — مقيسٌ من الكود لا مُقدَّر:** ‏12,000 (انتظار) + 11,500 (محاولة واحدة)
// = **23.5ث**، تحت `_LOGIN_TIMEOUT = 28000` العميلي (‏#1201) بهامش 4.5ث.
// ⚠️ وكان **24.2ث** حتى رصدَت المراجعةُ أنّ `delays[0] = 700ms` يُنفَّذ بلا قصٍّ على
// الميزانية المتبقّية؛ صار مقصوصاً أدناه فعاد الرقم مطابقاً لما يقوله هذا التعليق.
// 🔴 والهامش يبقى ضيّقاً نسبياً، **ولا يُحرَس برقمين منفصلين في مستودعين**: يقارنهما
// `worker/test-routes.js` حسابياً بقراءة `_LOGIN_TIMEOUT` من مصدر GAS (بند 113).
//
// ⚠️ **وأثرٌ مُفصَحٌ عنه على الطابور:** إطالةُ مهلة صنفٍ من الطلبات ترفع متوسّط إشغال
// `_bhQ` للجميع (قانون Little)، ومدخلُ دخولٍ محجوبٌ بالسقف **العالمي** في رأس الطابور
// يُوقف `_bhPump` لمن خلفه مدّةً أطول. مقبولٌ لأن الدخول قليل الحجم نسبياً وفشلُه
// وحده غير متحمَّل — **ويُقاس بعد النشر** من حقل `q` في `ev:'bulkhead'` (‏p99 لانتظار
// بقيّة التطبيقات قبل/بعد) لا يُفترَض.
//
// ⚠️ **والترتيب إلزاميّ:** هذا يتطلّب مهلة العميل الجديدة 28ث — قبلها (20ث) كان كلُّ
// دخولٍ ينتظر 12ث يُعلَن فاشلاً قبل أن يفشل الطلب فعلاً.
var BH_LOGIN_WAIT_MS = 12000;
// 🔴 الأسماء **مقيسةٌ من مصدر GAS** (`grep 'function .*[Ll]ogin'` في `SchoolApp-gas`)
// لا مُخمَّنة: أوّل قائمةٍ كتبتُها حملت `handleStudentLogin` و`teacherLoginProtected`
// **ولا وجود لهما** — مدخلٌ باسمٍ خاطئ ميّتٌ صامتاً: لا يحمرّ شيء، والدخول يبقى على
// النافذة الضيّقة بينما التعليق يقول إنّه عولج.
// و`hasOwnProperty` لا فحص الحقيقة: `fn = 'toString'` كان سيرث قيمةً صادقة من
// `Object.prototype` فيمنح كلَّ نداءٍ بذلك الاسم نافذةَ الدخول.
var BH_LOGIN_FNS = {
  handleTeacherLogin        : 1,   // teacher — كلمة المرور
  handleTeacherLoginByDevice: 1,   // teacher — البصمة/الجهاز
  loginStudent              : 1,   // student — كلمة المرور
  loginStudentByDeviceProtected: 1 // student — البصمة/الجهاز
};

// 🔴 **القرار يُبنى على ما يُنفّذه GAS فعلاً لا على أوّل مطابقةٍ نصّية** — رصدَته
// المراجعة 2026-08-21: `_bhFn` يُستخرَج برجيكس من أوّل 200 حرف (وهذا **يكفي للسجلّ**)،
// لكنّه صار قرارَ موارد. و`JSON.parse` يأخذ **آخر** قيمةٍ لمفتاحٍ مكرَّر بينما الرجيكس
// يأخذ **أوّلها** ⇒ جسمٌ مصنوع `{"fn":"handleTeacherLogin", … ,"fn":"دالّةٌ ثقيلة"}`
// كان يمنح نفسه النافذة الموسَّعة ويُنفّذ غيرها — عكسُ مبرِّر الميزة حرفياً.
//
// العلاج: تحليلٌ حقيقيّ **مقيَّدٌ بحجمٍ صغير**. أجسام الدخول مئاتُ بايتات، والحدُّ يمنع
// `JSON.parse` على حمولةٍ ضخمة في المسار الحارّ (رفعُ ملفّ مثلاً). وأيّ شكٍّ ⇒ النافذة
// **العادية** لا الموسَّعة (fail-closed على الامتياز).
var BH_LOGIN_BODY_MAX = 4096;
function _bhIsLoginBody(body) {
  try {
    if (typeof body !== 'string' || body.length > BH_LOGIN_BODY_MAX) return false;
    var o = JSON.parse(body);
    return !!(o && typeof o.fn === 'string' && BH_LOGIN_FNS.hasOwnProperty(o.fn));
  } catch (e) { return false; }
}
var _bhN   = 0;              // المُستخدَم حالياً (عالمي داخل هذا الـisolate)
var _bhApp = {};             // app -> المُستخدَم حالياً
var _bhQ   = [];             // طابور FIFO: [{ app, resolve, deadline, timer }]

function _bhCan(app) {
  return _bhN < BH_ISO_GLOBAL && (_bhApp[app] || 0) < BH_ISO_APP;
}
function _bhTake(app) {
  _bhN++;
  _bhApp[app] = (_bhApp[app] || 0) + 1;
}

// مسح الطابور بترتيب الوصول (FIFO) مع **تجاوز مقيَّد** لرأس الطابور:
//  • رأس محجوز بسقفه الفرعي فقط ⇒ نتجاوزه لمن خلفه (تفادي حجب رأس الطابور:
//    تطبيق بلغ سقفه الفرعي كان سيُجمّد الطابور كله خلفه).
//  • رأس محجوز بالسقف العالمي ⇒ نتوقّف فوراً (لا أحد خلفه يستطيع المرور أصلاً).
// الترتيب داخل كل تطبيق يبقى صارماً، فلا تجويع.
function _bhPump() {
  var now = Date.now(), i = 0;
  while (i < _bhQ.length) {
    var w = _bhQ[i];
    if (w.deadline <= now) {                       // انتهت مهلته أثناء الانتظار
      _bhQ.splice(i, 1); clearTimeout(w.timer); w.resolve(false); continue;
    }
    if (!_bhCan(w.app)) {
      if (_bhN >= BH_ISO_GLOBAL) break;             // السقف العالمي ⇒ لا فائدة من المتابعة
      i++; continue;                                // سقف فرعي ⇒ تجاوز إلى من خلفه
    }
    _bhQ.splice(i, 1); clearTimeout(w.timer); _bhTake(w.app); w.resolve(true);
  }
}

// يُرجِع Promise<boolean>. maxWaitMs = 0 ⇒ وضع «افتحْ الآن أو تخطَّ» بلا انتظار.
function _bhAcquire(app, maxWaitMs) {
  if (_bhCan(app)) { _bhTake(app); return Promise.resolve(true); }
  if (!(maxWaitMs > 0)) return Promise.resolve(false);
  return new Promise(function (resolve) {
    var entry = { app: app, resolve: resolve, deadline: Date.now() + maxWaitMs, timer: 0 };
    entry.timer = setTimeout(function () {
      var ix = _bhQ.indexOf(entry);
      if (ix !== -1) { _bhQ.splice(ix, 1); resolve(false); }
    }, maxWaitMs);
    _bhQ.push(entry);
  });
}

function _bhRelease(app) {
  if (_bhN > 0) _bhN--;
  if (_bhApp[app] > 0) _bhApp[app]--;
  _bhPump();
}

// سطر JSON منظّم واحد — قابل للترشيح في Cloudflare Workers Observability.
function _bhLog(o) {
  try { console.log(JSON.stringify(o)); } catch (e) { /* لا نُفشِل طلباً بسبب سجلّ */ }
}

function withCors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'content-type, x-requested-with');
  return resp;
}

function jsonResponse(obj, status) {
  return withCors(new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  }));
}

// معالج HTMLRewriter: يضبط قيمة سمة على عنصر (لحقن وسوم OG لكل خبر)
function _AttrSet(attr, val) { this.attr = attr; this.val = val; }
_AttrSet.prototype.element = function (el) { if (this.val) el.setAttribute(this.attr, this.val); };

/** تهريب قيمة سمة عند بناء HTML خام للإلحاق. */
function _attrEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * يضبط أوّل صورة معاينة على الوسم القائم، **ويُلحِق** البقية وسوماً جديدة بعده.
 *
 * 🔴 **لماذا الإلحاق لا حجزُ خانات فارغة** — جُرِّب الحجز أوّلاً فأخفق: الصفحة كانت تحمل
 * أربع خانات `content=""` ليملأها الوسيط، لكنه **لا يحقن إلّا حين تنجح `getNewsOg`**؛
 * وفي كلّ حالة أخرى — زيارة بلا `?news=`، رابط بلا توكن، أو أي فشل — كانت الخانات الثلاث
 * تُشحَن **فارغة** إلى الزاحف. و`og:image` فارغاً أسوأ من غيابه: يُقدَّم صورةً معلَنة ثم
 * يفشل جلبها فقد تسقط البطاقة كلُّها. أي أن الحجز كان يُنتج بالضبط ما وُضع ليتفاداه، في
 * الحالة **الأشيع** لا النادرة.
 *
 * الإلحاق يجعل الحالة الافتراضية صحيحة بذاتها: صفحةٌ بلا حقن = وسمُ صورةٍ واحد سليم،
 * تماماً كما لو كُتبت يدوياً — بلا اعتماد على تنظيفٍ لاحق قد لا يقع أصلاً.
 */
function _OgImages(list) { this.list = list || []; }
_OgImages.prototype.element = function (el) {
  if (!this.list.length) return;            // بلا صور ⇒ اترك الوسم الافتراضي كما هو
  el.setAttribute('content', this.list[0]);
  var extra = '';
  for (var i = 1; i < this.list.length; i++) {
    extra += '\n<meta property="og:image" content="' + _attrEsc(this.list[i]) + '"/>';
  }
  if (extra) el.after(extra, { html: true });
};

/* مسارات المنصّتين العميقة: `/teacher/<page>[/<slug>]` و`/student/<page>[/<slug>]`
 * (‏2026-08-13). تُعاد كتابتها **داخلياً** إلى `index.html` الخاص بالقسم، فتبقى في شريط
 * المتصفّح كما طلبها الزائر ويقرؤها المُوجِّه الأمامي من `location.pathname`.
 *
 * 🔴 لماذا هذا الشكل تحديداً — مقيسٌ من كود الأندرويد **المنشور** (‏vc31، 663 تثبيتاً):
 * `AppConfig.kt::extractWorkerSegment` يستخرج `/teacher/` بـregex ثم `url.contains(seg)`
 * ⇒ `/teacher/grades/abdaawatmuaz` **يُطابِق فيبقى داخل التطبيق بلا APK جديد**. وvc32
 * أمتن (‏`path.startsWith("/teacher/")`) فيقبله أيضاً.
 * ⚠️ و`/portal/<page>` **لا يُطابِق** على vc31 («portal» ليست في قائمة المقاطع) ⇒ يبقى
 * `/portal` رابطاً قصيراً **بلا مقاطع تالية**، للمشاركة البشرية وحدها.
 *
 * 🔴 وثلاثة ضوابط ينجو بها القائمُ تلقائياً بحكم صنف المحارف `[a-z0-9-]`:
 *   · `/teacher/index.html` — فيه نقطة فلا يُطابِق ⇒ يُخدَم 200 كما هو **للأبد**
 *     (مجمَّد في الـAPK بلا Deep Link — كسرُه لا رجعة فيه).
 *   · `/student/Student_Reports.html` — شرطة سفلية ونقطة ⇒ لا يُطابِق.
 *   · `/teacher` و`/teacher/` — لا مقطع بعدهما ⇒ لا يُطابِقان.
 * ومقطعان كحدٍّ أقصى: `/teacher/a/b/c` لا يُطابِق (لا نخترع عمقاً لا تخدمه الواجهة).
 *
 * ثابتٌ مسمّى لا حرفيّ داخل الدالّة: `worker/test-routes.js` يستخرجه **من هذا المصدر**
 * ويُشغّله، فلا يقيس نسخةً قد تنحرف عن الحيّ. */
var _DEEP_PORTAL_RE = /^\/(teacher|student)\/[a-z0-9-]+(?:\/[a-z0-9-]+)?\/?$/i;

/* ── أصولٌ طُلبت من عمقٍ خاطئ: شبكةُ أمان لا مسارٌ قانوني (‏gas#166، 2026-08-21) ──
 *
 * 🔴 **العلّة المقيسة:** المسارات العميقة أعلاه تُعاد كتابتها **داخلياً** إلى
 * `index.html`، فيبقى `location` في المتصفّح كما طلبه الزائر. وصفحاتُ `frontend/`
 * كانت تحقن أصولها بمسارٍ **نسبيّ** `../assets/…` — والمتصفّح يحلّ النسبيّ من دليل
 * العنوان الذي يراه لا من الملفّ الذي خُدم فعلاً:
 *     `/teacher/login`              ⇒ `/assets/gas-bridge.js`        ✅
 *     `/teacher/login/<slug>`       ⇒ `/teacher/assets/gas-bridge.js` 🔴 404
 * وغيابُ `gas-bridge.js` وحده يترك `window.google` غير معرَّف ⇒ `ReferenceError`
 * عند الإقلاع وعند الدخول = المنصّة لا تفتح على كلّ رابطٍ مُشارَك.
 *
 * 🟢 **الجذر عولج في المصدر** (‏`school-app-yemen-gas` — الأصول صارت `/assets/…`
 * مطلقةً)، وهذا هنا **شبكةُ أمان للنسخ المخبّأة**: آلافُ نسخ HTML القديمة تعيش في
 * كاش عامل الخدمة عند المستخدمين وتحمل المسار النسبيّ، ولا تُستبدَل فوراً.
 * ⚠️ ولا تُقرأ كرخصةٍ لإعادة المسار النسبيّ — الحارس في مستودع المصدر يمنعها.
 *
 * ومقصورةٌ على المنصّتين عمداً (نفس نطاق `_DEEP_PORTAL_RE`): `/cms/assets/x`
 * وغيرها تبقى كما هي، فلا نخترع أسماءً مستعارة لعمقٍ لا تخدمه الواجهة. */
var _APP_ASSET_ALIAS_RE = /^\/(?:teacher|student)\/(assets\/.+)$/i;

// رابط مدرسة قصير احترافي: yemenschoolz.com/<slug> (مسار بعد الدومين، لا نطاق فرعي قبله —
// قرار مالك صريح 2026-07-28، يُلغي أي حاجة لسجلّ DNS فرعي/Workers Route خارجي؛ يعمل فوراً عبر
// مسار خدمة الموقع الثابت أدناه بلا أي إعداد Cloudflare إضافي). أي قطعة مسار واحدة فقط (بلا
// امتداد ملف، بلا مسار إضافي بعدها) وليست من الأسماء المحجوزة أدناه تُعامَل كـslug مدرسة.
var _RESERVED_TOP_PATHS = {
  'home': 1, 'home-all-school': 1, 'teacher': 1, 'student': 1, 'cms': 1, 'schedule': 1,
  'master-admin': 1, 'pricing': 1, 'gas': 1, 'qr-img': 1, 'qr-download': 1, 'oauth': 1,
  'drive-upload': 1, 'media': 1, 'assets': 1, 'index.html': 1, 'manifest.webmanifest': 1,
  'sw.js': 1, 'robots.txt': 1, 'sitemap.xml': 1, 'favicon.ico': 1,
  // 'portal' يُخدَم بإعادة كتابة صريحة **تسبق** حساب الـslug (أدناه)، فحجزه هنا غير
  // ضروري وظيفياً اليوم. يبقى دفاعاً عن ترتيبٍ يتغيّر: لو انتقلت إعادة الكتابة يوماً
  // إلى ما بعد `_schoolSlugFromPath` لعاد `/portal` يُخدَم كـslug مدرسة بصمت تامّ —
  // وهو بالضبط سلوكه قبل 2026-08-10. والحجز يمنع كذلك تسجيل مدرسة بهذا الـslug.
  'portal': 1,
  // 'app' و'download' — روابط تحميل/تحديث التطبيق القصيرة (2026-08-12).
  // الحجز هنا **دفاعي بحت** بنفس منطق 'portal': معالجهما يعترضهما قبل حساب الـslug.
  // ⚠️ ولا يُبرَّر بأن `/app` كان يُخدَم `home-all-school` — ذاك وصفٌ بائد: منذ 404
  //    الحقيقي للـslug غير المنشور (‏#129) يُرجِع `/app` **404** لا 200. والحجز يمنع
  //    كذلك تسجيل مدرسة بأيّ من الاسمين.
  'app': 1, 'download': 1
};
function _schoolSlugFromPath(path) {
  var m = /^\/([a-z0-9-]+)\/?$/i.exec(path);
  if (!m) return '';
  var seg = m[1].toLowerCase();
  if (_RESERVED_TOP_PATHS[seg]) return '';
  return seg;
}

/* ── مفتاح المستأجر: مقطعُ المسار **أو** المعامل الصريح (2026-08-14) ──────────────
 *
 * 🔴 العلّة المقيسة: حقن الهوية كان مشروطاً بـ`_pathSlug` وحده، و«مقطع المسار» ليس
 *    الطريقة الوحيدة التي يصل بها مستأجرٌ معروف. رابط **تطبيق الأندرويد المنشور**
 *    (‏`AppConfig.kt::HOME_URL`) هو حرفياً `…/home/index.html?school=<UUID>` — نفس
 *    المستأجر، بلا مقطع مسار ⇒ **صفر حقن**. قياس 2026-08-14: `__HOME_BRAND__` يرد
 *    مرّتين (مرجعا قراءة) على ذلك الرابط مقابل ثلاث على `/abdaawatmuaz`، وكلّ عُقَد
 *    `.school-brand-name` الستّ تصل بـ«يمن سكولز» ثمّ يعيد جافاسكربت طلاءها بعد
 *    1.7–4.3 ثانية. أي أن السطح الذي يستعمله ٦٦٣ تثبيتاً كان **الوحيد بلا علاج**.
 *
 * 🔒 بوّابة الشكل إلزامية ولا تُرخى: القيمة تصل من العميل وتصير **مفتاح كاش حافة**،
 *    فأيّ سلسلة حرّة تُنشئ مدخلاً لكلّ قيمة ممكنة. المقبول: slug **منشور** أو UUID
 *    مطابقٌ للشكل حصراً — وما عداه `''` (لا حقن، والصفحة تُخدَم كما هي بلا تغيير).
 *
 * 🔒 ومحصورة بـ`/home/index.html`: هي الملفّ الوحيد الذي يقرأ `?school=` ويحمل عُقَد
 *    الهوية. الجذر `/` **خطٌّ أحمر** (بندا 68/75) ولا يصله هذا الفرع أصلاً — يُعاد
 *    كتابته إلى `/home/schools.html` قبل هذه النقطة.
 *
 * دالّة **نقيّة** (تأخذ المسار وسلسلة الاستعلام لا `URL`) كي يستخرجها `test-routes.js`
 * بـ`vm` ويشغّلها على جدول حالات — فحصٌ سلوكي لا نصّي، بنفس نمط `_canonicalFor`.
 * ───────────────────────────────────────────────────────────────────────────── */
var _SCHOOL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function _tenantKeyFrom(path, search) {
  var slug = _schoolSlugFromPath(path);
  if (slug) return slug;
  if (!/^\/home\/index\.html$/i.test(String(path || ''))) return '';
  var raw = '';
  try {
    var sp = new URLSearchParams(String(search || ''));
    raw = sp.get('school') || sp.get('schoolId') || '';
  } catch (e) { return ''; }
  var v = String(raw).trim();
  if (!v) return '';
  var lc = v.toLowerCase();
  if (_KNOWN_SCHOOL_SLUGS[lc]) return lc;
  if (_SCHOOL_UUID_RE.test(v)) return lc;
  return '';
}

// 🔴 سجلّ الـslugs المنشورة — مرآةُ `_build/schools.public.json` في مستودع الـgas.
//
// قبل 2026-08-11 لم تكن هناك قائمة إطلاقاً: أيّ مقطع مسار واحد غير محجوز (‏`/foo` ·
// `/test` · أيّ شيء) كان يُرجِع **200 وصفحةً كاملة** — سطحُ فهرسةٍ لا نهائي من صفحات
// متطابقة، يُصدَّر للزاحف بلا حدّ. التعليق القديم برّره بأن «slug غير حقيقي يُرجِع
// `not_found` خادمياً لا عطلاً» — وهو صحيح للمستخدم، لكنه لا يقول شيئاً لمحرّك البحث:
// الحالة 200 وحدها هي ما يقرؤه.
//
// ⚠️ **تبعية تشغيلية جديدة:** تسجيلُ مدرسة جديدة صار يتطلّب إضافة slugها **هنا وفي
//    `_build/schools.public.json` معاً** — وإلّا رجعت صفحتها 404. القائمة ثابتة في الكود
//    عمداً (لا نداء GAS): التحقّق من الوجود على المسار الحارّ يستهلك من حصّة الثلاثين
//    نفسها التي نحاول حمايتها، ولكلّ زائر.
var OWNER_SCHOOL_SLUG = 'abdaawatmuaz';
var _KNOWN_SCHOOL_SLUGS = {
  'abdaawatmuaz': 1,
  'ibn-khaldoun': 1,
  'aljil-al-hadith': 1
};

// ── الرابط القانوني — يُحسَب من الطلب، لا من قيمة ساكنة في المصدر ─────────────
//
// `home/Index.html` ملفٌّ **واحد يخدم N مستأجرين من M مسارات** (مُصرَّح به في مصدره).
// ⇒ **لا قيمة `canonical` ساكنة يمكن أن تكون صحيحة فيه**: كانت `/home/index.html`، فكان
// كلُّ مستأجر يُعلن أن قانونيّه صفحةُ مدرسة المالك. وتثبيتها على `/abdaawatmuaz` كان
// سيسوّئ الأمر لا يُصلحه. والتصحيح الوحيد الصحيح أن يُحسَب من العنوان المطلوب فعلاً.
//
// دالّة **نقيّة** عمداً: يستخرجها `test-routes.js` بـ`vm` ويشغّلها على جدول حالات — فحصٌ
// سلوكي لا نصّي (‏`grep` يُثبت أن السطر مكتوب، لا أن `/ibn-khaldoun` يخرج بقيمته الصحيحة).
//
// وبلا معاملات استعلام عمداً: `?news=<id>` تحويلةٌ جافاسكربتية إلى صفحة المقال، فإعلانها
// قانونيةً يدعو الزاحف لفهرسة عددٍ لا نهائي من نسخ الصفحة الأمّ. المعاينة الاجتماعية
// (‏`og:url`) وحدها تحمل `?news=` — وهي إشارةٌ أخرى لغرضٍ آخر.
// صفحة الـslug المجهول — مضمَّنة بالكامل (صفر طلب خارجي، صفر استهلاك من حصّة GAS).
// ── هوية النطاق عبر الأصول الثلاثة — البديل الصحيح للـ301 المحظور ────────────
//
// المشكلة: هذا الوركر الواحد يخدم `yemenschoolz.com` و`school.procorners.com`
// و`…workers.dev` **بمحتوى مطابق**. فالنطاقان الإرثيان ينافسان الرسميَّ في الفهرس على
// نفس الصفحات، و`procorners.com` متجرٌ مفهرَس بكثافة كان يُسرّب اسمه («ركن التسوق»)
// لصفحاتنا.
//
// 🔴 ولماذا لا 301: تطبيقا الأندرويد يوجّهان **بمقطع المسار متجاهلَين المضيف تماماً**
//    (‏`AppConfig.kt::matchesDeployment`)، وروابطهما مجمَّدة في الـAPK بلا Deep Link. فأيّ
//    301 إلى جذر النطاق الجديد يُقابَل بمسار بلا مقطع معروف ⇒ `Intent.ACTION_VIEW` ⇒
//    **يفتح Chrome ويترك التطبيق فارغاً بلا رجعة**. ولا سبيل لإصلاحه إلا بـAPK جديد.
//
// البديل: `X-Robots-Tag: noindex, follow` — يُزيل الازدواج من الفهرس **بصفر تغيير في
// الحالة (200) أو الجسم**، والتطبيقان لا يقرآن رؤوس الفهرسة إطلاقاً. و`Link: rel=canonical`
// كرأس HTTP يعمل حتى حين يفشل تصحيح الوسم في الجسم.
//
// 🚫 وما لا يُشحن: `robots.txt` بـ`Disallow: /` على الإرثيَّين — يمنع الزحف ⇒ يمنع Google
//    من **رؤية** canonical، فيبقى العنوان مفهرَساً بلا محتوى. أسوأ من المرض.
//
// دالّة **نقيّة** ليقيسها `test-routes.js` على جدول مضيفات — والضابط الحاسم فيه معاكس:
// 🔴 النطاق الرسمي **بلا `X-Robots-Tag` إطلاقاً**. رأسُ `noindex` هناك يمحو الموقع من
//    Google بنشرةٍ واحدة، ولا يكشفه أي فحص نصّي على وجود السطر.
function _identityHeaders(hostname, isHtml, canonHref) {
  var out = {};
  if (!isHtml) return out;                       // الأصول الثابتة لا تُفهرَس أصلاً
  // الرأس يُرسَل **فقط حين نعرف القيمة الصحيحة** — `_canonicalFor` تُرجِع `''` لكل صفحة
  // وسمُها الساكن أدقّ، وإرسالُ رأسٍ مخالف له يُنتج إشارتين متعارضتين لا توحيداً.
  if (canonHref) out['Link'] = '<' + canonHref + '>; rel="canonical"';
  var canonHost = (hostname === 'yemenschoolz.com' || hostname === 'www.yemenschoolz.com');
  if (!canonHost) out['X-Robots-Tag'] = 'noindex, follow';
  return out;
}

function _unknownSlugPage(slug) {
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<meta name="robots" content="noindex, follow"/>' +
    '<title>المدرسة غير موجودة | Yemen Schoolz</title>' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;' +
    'color:#e2e8f0;font-family:system-ui,"Segoe UI",Tahoma,sans-serif;padding:24px}' +
    '.c{max-width:32rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .75rem}' +
    'p{color:#94a3b8;line-height:1.9;margin:0 0 1.5rem}code{background:#1e293b;padding:.15em .5em;' +
    'border-radius:.35em;color:#f1f5f9;direction:ltr;display:inline-block}' +
    'a{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:.7em 1.6em;' +
    'border-radius:.6em;font-weight:600}</style></head><body><div class="c">' +
    '<div style="font-size:3rem">&#127979;</div>' +
    '<h1>لم نجد هذه المدرسة</h1>' +
    '<p>العنوان <code>' + _attrEsc(slug) + '</code> غير مسجَّل على المنصّة. ' +
    'قد يكون الرابط غير مكتمل، أو المدرسة لم تُنشَر بعد.</p>' +
    '<a href="' + CANONICAL_ORIGIN + '/">تصفّح دليل المدارس</a>' +
    '</div></body></html>';
}

// 🔴 **يُرجِع `''` لكل ما ليس صفحة مدرسة — ولا يحقن شيئاً حينها.** هذا ليس تحفّظاً بل
//    تصحيحُ انحدارَين رصدتهما المراجعة المستقلّة في أوّل صياغة، وكلاهما كان **يُسوّئ**
//    ما جاء الحقن ليُصلحه:
//    (أ) المُعامل `path` هو المسار **بعد** إعادة الكتابة الداخلية، فالجذر `/` صار
//        `/home/schools.html` ⇒ كان سيعلن أن قانونيّه عنوانٌ **غير مُدرَج في الخريطة
//        إطلاقاً**، بينما الخريطة تعلن `/` بأولوية 1.0. أخطر حالة ممكنة.
//    (ب) فرعُ «self-canonical» العامّ كان يدهس **أربع قيم ساكنة صحيحة كُتبت عمداً**
//        لتوحيد الأسماء المستعارة: `/portal` ⇒ `/student` · `/home-all-school/index.html`
//        ⇒ `/` (صفحة متقاعدة وُحِّدت على الجذر عمداً، بند 104) · `/student/index.html`
//        ⇒ `/student` · `/schedule/index.html` ⇒ `/schedule`.
//    ⇒ القاعدة: **لا تحقن إلا حيث تعرف أنك تُحسِّن.** الوسم الساكن أدقّ في كل ما عداه،
//      وحصرُ الحقن يزيل الخطأ والحملَ معاً (‏`teacher/index.html` وحده 1.88MB).
function _canonicalFor(path, pathSlug, schoolParam) {
  if (pathSlug) return CANONICAL_ORIGIN + '/' + pathSlug;
  if (/^\/home\/index\.html$/i.test(path)) {
    var s = String(schoolParam || '').toLowerCase();
    // slug منشور ⇒ الشكل القصير. وأيُّ معرّف آخر (‏UUID مثلاً) يبقى مميَّزاً بمعامله:
    // إسقاطه على مدرسة المالك كان يوحّد مستأجرَين مختلفَين على عنوان واحد — نفس العلّة.
    if (_KNOWN_SCHOOL_SLUGS[s]) return CANONICAL_ORIGIN + '/' + s;
    if (s) return CANONICAL_ORIGIN + path + '?school=' + encodeURIComponent(s);
    // 🔴 **2026-08-14 — انقلب هذا الفرع.** كان يُرجِع `/abdaawatmuaz` تطبيقاً لبند 99
    // («الفارغ = مدرسة المالك»)، فكانت الصفحة تُعلن أنّها صفحة المالك بينما تصل مطليّةً
    // بهوية المنصّة ثمّ تُطلى بالمالك — تناقضُ هويةٍ مقيسٌ في الرأس `Link:` حيّاً.
    // وبند 99 يحكم **حلّ المستأجر داخل الخادم**، لا ما يُعلَن للزاحف على عنوانٍ عامّ
    // بلا معرّف؛ وإعلانُ قانونيٍّ يخصّ مستأجراً بعينه على عنوانٍ لا يذكره هو بالضبط
    // فخّ بند 68. والرابط العاري صار يُحوَّل إلى الجذر قبل بلوغ هذه النقطة (أدناه)،
    // فهذا **دفاعٌ مضاعف** لمسارٍ لم يعد مسلوكاً — لا سلوكاً وحيداً.
    return '';
  }
  return '';   // ← لا حقن: الوسم الساكن في المصدر صحيح وأدقّ من أي اشتقاق من المسار
}

// النطاق الرسمي للمشروع (قرار مالك 2026-07-28). المضيف الوحيد الذي يُحوَّل إليه.
var CANONICAL_ORIGIN = 'https://yemenschoolz.com';
// 🔴 مضيف واحد بالضبط يُحوَّل — **لا قائمة قابلة للتوسّع بلا تفكير**.
// `school.procorners.com` و`school-teacher-proxy.procorners-shop.workers.dev` يبقيان
// يخدمان كما هما **للأبد**: تطبيقا الأندرويد يحملان روابطهما مجمَّدةً في الـAPK بلا
// Deep Link وبلا مزامنة ديناميكية، ويوجّهان بمقطع المسار **متجاهلَين المضيف تماماً**
// (`AppConfig.kt::matchesDeployment`). فأي 301 إلى جذر النطاق الجديد يُقابَل بمسار بلا
// مقطع معروف ⇒ `Intent.ACTION_VIEW` ⇒ **يفتح Chrome ويترك التطبيق فارغاً**، ولا سبيل
// لإصلاحه إلا بـAPK جديد. `www` وحده آمن لأنه نطاق جديد بلا أي مستخدم سابق.
var REDIRECT_TO_CANONICAL = { 'www.yemenschoolz.com': 1 };

/* ═══════════════════════════════════════════════════════════════════════════════════════
   هوية المدرسة في الـHTML الخام على `/<slug>`  (2026-08-13)

   العلّة المقيسة: `/<slug>` يُعاد كتابته إلى `home/index.html` — **ملفّ واحد بايتاً ببايت
   لكل المدارس** (‏179,816 بايت متطابقة على `/abdaawatmuaz` و`/ibn-khaldoun`؛ الفرق سطرا
   `canonical` و`og:url` اللذان نحقنهما أصلاً). فالهوية التي تصل الزائرَ **والزاحفَ وبطاقةَ
   معاينة واتساب** هي هوية المنصّة: `<title>` و`og:title` و`description` و`og:image` كلّها
   «يمن سكولز» لكلّ مدرسة. والصفحة لا تصحّح ذلك إلا بعد `getHomePageBundle` — وسيطه
   **14,535ms** وفشله **38.81٪** (‏`_docs/perf/trend.jsonl`, 2026-08-13).

   العلاج هنا يغطّي ما **لا يستطيع العميل تغطيته**: الزائر الأوّل بلا كاش، والزاحف الذي
   قد لا ينفّذ JS، وبطاقة المشاركة التي لا تنفّذه أبداً.

   🔴 **fail-open بصفر تأخير مُضاف**: عند غياب الهوية من كاش الحافة نخدم الصفحة **فوراً**
      كما هي ونُحدِّث الكاش في الخلفية بـ`ctx.waitUntil`. لا ننتظر GAS في مسار الطلب
      إطلاقاً — انتظارُه هو العلّة نفسها، فجعلُه شرطاً للعرض يُضاعفها.
   🔒 مشروطٌ بـ`_pathSlug` ⇒ الجذر `/` و`/home/index.html` العاري و`/portal` وبوّابات
      الدخول **لا تُمَسّ**. وهوية الجذر خطٌّ أحمر (بندا 68/75).
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* ٦ ساعات: الاسم والشعار واللون شبه ثابتة (تتغيّر حين يحرّرها مدير من تبويب «بيانات
   المدرسة»)، والنتيجة ≈٤ نداءات/يوم/مدرسة تصيب GAS بدل نداءٍ لكلّ زيارة. */
var BRAND_TTL_S = 21600;

/* 🔴 مفتاح الكاش على **أصل الطلب نفسه** لا مضيف وهمي: `caches.default` في Workers يشترط
   مفتاحاً داخل النطاق. والمسار ثلاثي المقاطع فيرفضه `_schoolSlugFromPath` (مقطعٌ واحد
   حصراً) ⇒ لا يمكن أن يصير سطحاً مخدوماً بأي حال. */
function _brandCacheKey(origin, slug) {
  return new Request(origin + '/__brand-cache/v1/' + encodeURIComponent(slug), { method: 'GET' });
}

async function _brandFromCache(origin, slug) {
  try {
    var hit = await caches.default.match(_brandCacheKey(origin, slug));
    if (!hit) return null;
    var o = await hit.json();
    return (o && o.name) ? o : null;
  } catch (e) { return null; }
}

/* يُشغَّل في `ctx.waitUntil` حصراً — خارج مسار الاستجابة تماماً.
   يستهلك مقعداً من حصّة الثلاثين، فيمرّ بنفس bulkhead «افتحْ الآن أو تخطَّ» الذي يحكم
   حقن OG: تحديثُ هويةٍ خلفيّ يجب ألّا يُزاحم تسجيل دخول معلّم أبداً. */
async function _brandRefresh(origin, slug, env) {
  var mode = (env && env.BULKHEAD_MODE) || 'on';
  var held = (mode !== 'off') ? await _bhAcquire('home', 0) : false;
  if (mode === 'on' && !held) {
    _bhLog({ ev: 'bulkhead', act: 'skip_brand', app: 'home', mode: mode, n: _bhN, q: _bhQ.length });
    return;
  }
  var timer = null;
  try {
    var ab = new AbortController();
    timer = setTimeout(function () { ab.abort(); }, 8000);
    var res = await fetch(GAS.home, {
      method: 'POST',
      signal: ab.signal,
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ fn: 'getHomePageBundle', args: [slug] })
    });
    var json = await res.json();
    var b = (json && json.result) ? json.result : json;
    if (!b || b.ok !== true || !b.brand || !b.brand.name) return;
    var page = b.page || {};
    /* هوية العرض وحدها — لا هاتف/عنوان/سوشل. تلك محكومة عميلياً بـ`_homeContactField`
       الذي يُخفيها لغير المالك، وقيمةُ تواصلٍ متقادمة أسوأ من غيابها. */
    var brand = {
      name: String(b.brand.name || ''),
      logo: _safeHttpUrl(b.brand.logo),
      color: String(b.brand.color || ''),
      tagline: String(page.tagline || ''),
      description: String(page.aboutText || ''),
      /* 🔴 **UUID القانوني للمستأجر** (‏`_PublicPage.js::getHomePageBundle` يُرجِعه) —
         لا المفتاح الذي طلبنا به. سببه أن الصفحة تحتاجه لوصل روابط البوّابات الستّ:
         `getTeacherSchoolBrand` تطابق `school_id` حصراً، والـslug يمرّ عندها بـ`ok:true`
         واسمٍ **فارغ** ⇒ شاشة دخول بلا هوية، أسوأ من العطل. وبلا هذا الحقل تبقى الروابط
         عاريةً حتى ترجع الحمولة — و**للأبد إن فشلت** — فيهبط زائرُ مدرسةٍ على شاشة دخول
         مدرسة المالك (‏`build-frontend.js` يحقن `|| OWNER_SCHOOL_ID` في `teacher`).

         🔴 **والمالك يُخزَّن بـ`''` عمداً** — بنفس قاعدة `_homeCacheBrand` و
         `_homeSafeApply('portals', …)` في `home/Index.html` حرفياً: الفارغ = مدرسة
         المالك (بند 99)، وشكلان للشيء الواحد يشقّان فضاء الجلسة والكاش (بند 97).
         وقاعدةٌ هنا تخالف نظيرتها هناك تجعل الرابط **يقفز** لحظة وصول الحمولة. */
      schoolId: (b.isOwner === true) ? '' : String(b.schoolId || '')
    };
    await caches.default.put(
      _brandCacheKey(origin, slug),
      new Response(JSON.stringify(brand), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'max-age=' + BRAND_TTL_S
        }
      })
    );
  } catch (e) { /* fail-open: الصفحة خُدِمت أصلاً؛ المحاولة القادمة تُعيد الكرّة */ }
  finally {
    if (timer) clearTimeout(timer);
    if (held) _bhRelease('home');
  }
}

/* 🔴 بوّابة مخطّط صارمة قبل أي إسناد إلى `src`/`og:image`: القيمة تصل من شيت **يحرّره بشر**.
 *
 * ⚠️ **تصحيح اتجاه بند 35 هنا — كشفه اختبارُ طفرة.** البند يقول «احذف أحرف التحكّم ولا
 * تستبدلها بمسافة»، وهو صحيح لبوّابة **حاجبة** (تبحث عن مخطّط خطر): الاستبدال يحوّل
 * `ja<TAB>vascript:` إلى `ja vascript:` فيفلت من الحجب. لكن هذه بوّابة **سامحة** (تشترط
 * `https://`)، والاتجاه **ينقلب**: الحذفُ يحوّل `https:<TAB>//evil` إلى `https://evil`
 * فيُقبَل، بينما الاستبدال يرفضه. أي أن تطبيق البند حرفياً هنا كان **يفتح** ثغرة لا يسدّها.
 *
 * ⇒ لا حذف ولا استبدال: **رفضٌ صريح** لأي قيمة تحوي حرف تحكّم أو فراغاً. عنوانٌ صالح لا
 * يحوي أياً منهما أصلاً، فالرفض بلا كلفة والغموض يُزال من جذره لا يُدار. */
function _safeHttpUrl(v) {
  var s = String(v == null ? '' : v).trim();
  /* 🔴 رفضٌ صريح لا حذف ولا استبدال — راجع الكتلة أعلاه: الاتجاه ينقلب في بوّابة سامحة. */
  if (!s || /[\u0000-\u0020\u007f]/.test(s)) return '';
  return /^https:\/\//i.test(s) ? s : '';
}

/** يستبدل النصّ الداخلي لعنصر — نصّاً لا HTML (اسم المدرسة قيمة مستأجر). */
function _TextSet(val) { this.val = val; }
_TextSet.prototype.element = function (el) { if (this.val) el.setInnerContent(this.val, { html: false }); };

/* يحقن `window.__HOME_BRAND__` ليقرأه سكربت الهوية المتزامن في الصفحة فيطلي فوراً
   **ويبذر كاشه المحلّي من أوّل زيارة**.
   🔴 `<` يُهرَّب إلى `<` داخل JSON: بلا ذلك يكفي أن يحمل اسمُ مدرسةٍ `</script>`
   لكسر الوثيقة كلّها — والاسم يأتي من شيت يحرّره بشر. */
function _BrandHead(brand) { this.brand = brand; }
_BrandHead.prototype.element = function (el) {
  var json = JSON.stringify(this.brand).replace(/</g, '\\u003c');
  el.append('<script>window.__HOME_BRAND__=' + json + ';</' + 'script>', { html: true });
};

/* لاحقة عنوان التبويب — **نسخةٌ ثالثة بالضرورة**: هذا مستودع منفصل عن `SchoolApp-gas`
   وGAS لا يشارك كوداً معه. يحرس تطابقها الحرفي مع `__homeDocTitle` هناك حارسٌ في
   `test-routes.js`؛ انحرافُها يجعل العنوان **يقفز** لحظة وصول الحمولة بدل أن يستقرّ. */
function _brandDocTitle(name, tagline) {
  return name + (tagline ? ' — ' + tagline : '') + ' | يمن سكولز';
}

/* يُلحِق معالجات الهوية بسلسلة `HTMLRewriter` قائمة. مفصولٌ في دالّة كي تستعمله
   المسارات كلّها بلا نسخ ثانٍ ينحرف. */
function _brandRewrite(rw, brand) {
  rw = rw.on('title', new _TextSet(_brandDocTitle(brand.name, brand.tagline)))
         .on('.school-brand-name', new _TextSet(brand.name))
         .on('meta[property="og:title"]', new _AttrSet('content', brand.name))
         .on('head', new _BrandHead(brand));
  if (brand.description) {
    rw = rw.on('meta[name="description"]', new _AttrSet('content', brand.description))
           .on('meta[property="og:description"]', new _AttrSet('content', brand.description));
  }
  if (brand.logo) {
    rw = rw.on('#hdrLogo', new _AttrSet('src', brand.logo))
           .on('#ftLogo', new _AttrSet('src', brand.logo))
           .on('meta[data-og="img1"]', new _AttrSet('content', brand.logo))
           .on('meta[name="twitter:image"]', new _AttrSet('content', brand.logo));
  }
  /* 🔒 `og:site_name` غائب عن القائمة **عمداً وأبداً** — بندا 68/75: كتابة اسم مدرسة
     فوق اسم الموقع هي سبب خمس رفضات OAuth Branding. */
  return rw;
}

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    var path = url.pathname;
    /* 🔴 المسار **كما طلبه الزائر**، قبل أي إعادة كتابة داخلية. `path` يُدهَس أدناه
       (‏`/` ⇒ `/home/schools.html` · `/<slug>` ⇒ `/home/index.html` · `/portal` ⇒ …)،
       فأيّ قرارٍ يخصّ ما طلبه الزائر فعلاً يجب أن يُبنى على هذه لا على تلك. */
    var _rawPath = path;

    // ── 0) www ⇒ الجذر (بحفظ المسار والاستعلام) ───────────
    // يسبق كل شيء: لا معنى لتنفيذ منطق على مضيف سنغادره. و`301` لا `302` كي تتوقّف
    // المتصفّحات ومحرّكات البحث عن العودة إليه — لا محتوى مكرَّراً ولا هوية منقسمة.
    //
    // 🔴 **لكن 301 لغير `GET/HEAD` يُفقِد الجسم — مقيسٌ حيّاً 2026-08-21:**
    //   POST https://www.yemenschoolz.com/gas/teacher  ⇒ 301 ⇒ وباتّباعه:
    //   {"ok":false,"error":"اسم الدالة مفقود"}
    // لأن 301 (و302) يُجيزان للعميل تحويل الطريقة إلى `GET` وإسقاط الجسم، وهذا ما يقع
    // فعلاً. وهذا الفرع **يسبق** وكيل `/gas/*` أدناه، فيبتلع كلّ نداءات الـAPI القادمة
    // من `www` قبل أن تصل الوكيل أصلاً — أي **تسجيل دخولٍ يفشل صامتاً** لأي عميل يقع
    // أصلُه على `www` (عاملُ خدمةٍ مسجَّل هناك · أو مرجعٌ مطلق داخل صفحة).
    //
    // 🔑 والعلاج **جراحيّ لا إلغاء**: قصدُ الـ301 مشروع ويبقى لـ`GET/HEAD` (وهي وحدها ما
    // تفهرسه محرّكات البحث وتُخبِّئه المتصفّحات). وما عداها ⇒ **308** — نفس دلالة «دائم»
    // تماماً، لكنه **يُلزم** العميل بحفظ الطريقة والجسم.
    if (REDIRECT_TO_CANONICAL[url.hostname]) {
      var _canonUrl = CANONICAL_ORIGIN + path + url.search;
      var _safeMethod = (request.method === 'GET' || request.method === 'HEAD');
      return Response.redirect(_canonUrl, _safeMethod ? 301 : 308);
    }

    // ── 1) وكيل الـ API: /gas/<app> ─────────────────────────────
    var match = path.match(/^\/gas\/([a-zA-Z-]+)\/?$/);
    if (match) {
      var app = match[1];
      var target = GAS[app];
      if (!target) return jsonResponse({ ok: false, error: 'تطبيق غير معروف: ' + app }, 404);

      if (request.method === 'OPTIONS') {
        return withCors(new Response(null, { status: 204 }));
      }

      var init = {
        method: request.method === 'GET' ? 'GET' : 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow'
      };
      if (request.method !== 'GET') {
        init.body = await request.text();
      }

      // ── اسم الدالة المطلوبة — لإسناد الأداء في السجل فقط ────────────────────
      // بدونه يقول السجل «teacher بطيء» ولا يقول **أي دالة**. الجسم يبدأ دائماً بـ
      // {"fn":"...","args":[...]} فيكفي مسح أول 200 حرف — بلا JSON.parse على حمولات
      // قد تكون ضخمة. مجموعة الأحرف مطابقة لما يفرضه الخادم في _apiIsBlocked
      // (/^[A-Za-z][A-Za-z0-9]*$/) فلا يمكن حقن شيء في السجل. **لا يُسجَّل أي شيء
      // آخر من الجسم إطلاقاً** — args تحمل توكنات وأسماء طلاب.
      var _bhFn = '';
      try {
        var _bhHead = (init.body || '').slice(0, 200);
        var _bhM = _bhHead.match(/"fn"\s*:\s*"([A-Za-z][A-Za-z0-9]{0,63})"/);
        if (_bhM) _bhFn = _bhM[1];
      } catch (e) { /* لا نُفشِل طلباً بسبب سجلّ */ }

      // ── حَجز مقعد قبل إطلاق أي محاولة نحو GAS (منظّم التزاحم) ───────────────
      // فحوصات الصحّة مُعفاة عمداً: ?action=health أداة تشخيص يجب أن تُخبرنا عن حال
      // GAS نفسه لا عن حال المنظّم — حَكْمها يُخفي بالضبط الحالة التي نُشخّصها بها.
      // حجمها ضئيل (استدعاء يدوي/تشغيلي) فتُحتسَب ضمن الهامش المتروك من الثلاثين.
      var _bhMode   = (env && env.BULKHEAD_MODE) || 'on';
      var _bhExempt = url.searchParams.get('action') === 'health';
      var _bhOn     = (_bhMode !== 'off') && !_bhExempt;
      var _bhT0     = Date.now();
      var _bhHeld   = false;
      if (_bhOn) {
        // وضع الظلّ لا ينتظر إطلاقاً (انتظاره كان سيكون تغيير سلوك بحدّ ذاته): يحاول
        // الحَجز بلا انتظار، ثم يأخذ المقعد على أي حال ويُكمل. فائدته أن العدّاد n في
        // السجلّ يصبح **التزامن الحقيقي المُشاهَد** بلا سقف يقيّده — وهو بالضبط الرقم
        // المطلوب لمعايرة السقوف قبل تفعيل الرفض الفعلي.
        /* نافذةُ الدخول أوسع (لا تحجز مقعد GAS)، وغيرُها يأخذ الجِتَر — التفصيل عند
           تعريف `BH_LOGIN_WAIT_MS`/`_bhWaitMs` أعلى الملفّ. */
        var _bhWait = _bhIsLoginBody(init.body) ? BH_LOGIN_WAIT_MS : _bhWaitMs();
        _bhHeld = await _bhAcquire(app, _bhMode === 'shadow' ? 0 : _bhWait);
      }
      var _bhWaited = _bhOn ? (Date.now() - _bhT0) : 0;
      if (_bhOn && !_bhHeld) {
        _bhLog({ ev: 'bulkhead', act: _bhMode === 'shadow' ? 'would_block' : 'reject',
                 app: app, fn: _bhFn, mode: _bhMode, waitMs: _bhWaited, n: _bhN, q: _bhQ.length });
        if (_bhMode === 'shadow') {
          _bhHeld = true; _bhTake(app);   // يبقى الحساب متوازناً مع التحرير في finally
        } else {
          // 503 نظيف بنفس نصّ سطر الرفض القائم حرفياً — لا 502 خام من هذا المسار أبداً.
          // ملاحظة سلوكية: assets/gas-bridge.js لا يقرأ الجسم إطلاقاً عند status ≥ 400،
          // فالـstatus وحده هو ما يقود السلوك ⇒ القراءات تتراجع لكاش IndexedDB، والكتابات
          // تدخل طابور outbox وتُكمل تفاؤلياً. الجسم يبقى مطابقاً حرفياً لأن مستهلكاً آخر
          // (تطبيق أندرويد على نطاق workers.dev) قد يقرؤه. jsonResponse يُطبّق withCors أصلاً.
          return jsonResponse({ ok: false, error: 'تعذّر تنفيذ الطلب حالياً (اعتراض مؤقّت من الخادم). حاول مجدداً بعد لحظات.' }, 503);
        }
      }

      try {
      // تطبيقات GAS تُرجع أحيانًا 404 أو صفحة HTML اعتراضية بشكل متقطّع (~6%) بدل تنفيذ الدالة.
      // نعيد المحاولة: نعدّ 404 (أو جسمًا HTML في طلبات POST التي تتوقّع JSON) قابلًا
      // لإعادة المحاولة، فلا يظهر خلل GAS العابر للمستخدم كفشل. طلبات GET (مثل الصفحة) يُقبل HTML فيها.
      var isPost = request.method !== 'GET';
      var fullTarget = target + url.search;
      // ── ص6: مُميِّز المنصّة لمدخل `student` وحده ──────────────────────────────
      // `GAS.student` صار يشير إلى نشرة `teacher` (أعلى الملفّ). و`doGet` المدمَجة
      // تُفرِّق المنصّتين بـ`e.parameter.app` وحده، فبلا هذا الإلحاق يخدم `/gas/student`
      // **لوحة المعلّم** ويردّ فحصُ الصحّة عن التطبيق الخطأ.
      // ⚠️ الفاصل مشروط: النداء العاري `/gas/student` بلا استعلام يحتاج `?` لا `&` —
      //    وهو بالضبط ما يستعمله فحص الصحّة وجسرُ الأندرويد.
      // ولا يمسّ `/gas/teacher` ولا بقيّة التطبيقات: الشرط على `app` لا على الوجهة.
      if (app === 'student') {
        fullTarget += (url.search ? '&' : '?') + 'app=student';
      }
      var lastText = '', lastStatus = 502, attempt, good = false;
      // فاصل واحد بين المحاولتين — يمتصّ اعتراض/برود GAS المتقطّع (~6%) قبل إرجاع HTML للجسر.
      // ⚠️ 2026-07-28: كان العدد 4 محاولات (250/600/1200ms). حادثة 502 متكرّرة (تسجيل دخول
      // teacher/student/home) كشفت أن كل حالات 502 كانت تحمل wallTimeMs≈24850ms بالضبط — أي أن
      // GAS كان متعطّلاً فعلاً (استنفاد حصة تنفيذ Google المتزامنة لنفس الحساب procorners.shop@
      // gmail.com، مؤكَّد حيّاً برسالة Google الأصلية "عدد كبير من النصوص البرمجية يتم تشغيلها في
      // وقت واحد") لا عابراً — وإعادة المحاولة 4 مرات في هذه الحالة كانت تُطلق حتى 4 طلبات متزامنة
      // إضافية ضد حصة مستنفدة أصلاً (تضخيم الحمل بدل التخفيف منه)، ثم تستسلم بـ502 بعد 24.85 ثانية
      // — قبل أن تُفيد مهلة العميل الأطول (60 ثانية) أصلاً لأن الـWorker هو من يستسلم أولاً. خُفِّض
      // العدد إلى محاولتين فقط (يُنصِّف تلقائياً أي تضخيم حمل مستقبلي مشابه، ويكفي للمشكلة الأصلية
      // العابرة أعلاه) ورُفعت مهلة المحاولة الواحدة لتعويض ذلك (فرصة أكبر لالتقاط استجابة GAS
      // البطيئة لكن الناجحة فعلاً تحت ضغط تزامن عادي). التفاصيل الكاملة:
      // school-app-yemen-gas/_docs/2026-07-28-تشخيص-502-وتضخيم-اعادة-المحاولة-بالوسيط.md
      var delays = [700];
      // ميزانية زمنية إجمالية للحلقة بأكملها — أقل بأمان من مهلة XHR الحالية للعميل (60 ثانية،
      // بعد إصلاح heartbeat-perf-boot-burst في school-app-yemen-gas). بلا هذا الحدّ، محاولة
      // واحدة بطيئة (مُشاهَد فعلياً 14-30+ ثانية تحت ضغط حقيقي على مشروع GCP المشترك — سجلّات
      // Workers Observability أظهرت إلغاءات عميل حقيقية "canceled" متجمّعة عند 30 و60 ثانية
      // بالضبط) تجعل مجموع المحاولات يتجاوز مهلة العميل نفسها، فيُلغي الاتصال صامتاً
      // (status 0) قبل أن يصله أي ردّ JSON مفيد — نفس عرَض 2026-07-27 يتكرّر عند سقف أعلى فقط.
      // بهذا الحدّ: الـWorker يتوقّف عن إعادة المحاولة ويُعيد آخر نتيجة معروفة (JSON خطأ واضح
      // عادةً) بوقت كافٍ ليصل للعميل قبل أن يُلغي اتصاله من تلقاء نفسه.
      //
      // ⚠️ قيمة أوّلية (45000/20000) اختُبِرت حيّاً وأظهرت زمناً فعلياً ~63.6 ثانية (تجاوز مهلة
      // العميل 60 ثانية) — على الأرجح بسبب زمن غير محسوب لاتّباع Google لإعادة توجيه HTTP على
      // مسار /exec (`redirect:'follow'`) لا يُحسَب بدقّة داخل مهلة كل محاولة. القيم الحالية
      // (11500ms × محاولتين + فاصل 700ms ≈ 23700ms) تبقي هامش أمان واسع تحت 60 ثانية حتى مع نفس
      // الزمن غير المحسوب — مهلة كل محاولة ثابتة (لا تتقلّص مع الميزانية المتبقّية، تبسيطاً يزيل
      // مصدر خطأ محتملاً).
      var loopStart = Date.now();
      // ⚠️ زمن انتظار الطابور **يُخصَم** من الميزانية ولا يُضاف فوقها. إضافته كانت
      // ستُعيد إنتاج الفشل الموثَّق أعلاه بالضبط: القيمة الأوّلية (45000/20000) أعطت
      // ~63.6 ثانية فعلية وتجاوزت مهلة العميل، لأن ثمّة زمناً غير محسوب لاتّباع
      // إعادة توجيه Google لا يدخل في مهلة المحاولة (ويؤكّده أن فحص الميزانية أدناه
      // يحرس **بداية** المحاولة لا نهايتها) — أي أن 24000 ليست سقفاً صلباً أصلاً.
      // بالخصم: أسوأ زمن إجمالي يبقى كما هو اليوم حرفياً. الثمن أن طلباً انتظر طويلاً
      // قد يحصل على محاولة واحدة بدل اثنتين — وهو السلوك الصحيح لا تدهور: تحت إشباع
      // الحصة، إعادة المحاولة تضاعف الحمل بلا فائدة (نفس درس حادثة 2026-07-28).
      var TOTAL_BUDGET_MS = 24000 - _bhWaited;
      var PER_ATTEMPT_TIMEOUT_MS = 11500;
      for (attempt = 0; attempt < 2; attempt++) {
        var elapsedBeforeAttempt = Date.now() - loopStart;
        if (elapsedBeforeAttempt >= TOTAL_BUDGET_MS) break;
        var controller = new AbortController();
        var abortTimer = setTimeout(function () { controller.abort(); }, PER_ATTEMPT_TIMEOUT_MS);
        init.signal = controller.signal;
        try {
          var gasResp = await fetch(fullTarget, init);
          lastText = await gasResp.text();
          lastStatus = gasResp.status;
          var looksHtml = lastText.charAt(0) === '<';
          good = gasResp.status >= 200 && gasResp.status < 400 && !(isPost && looksHtml);
          if (good) break;
        } catch (err) {
          lastStatus = 502;
          lastText = JSON.stringify({ ok: false, error: 'تعذّر الوصول إلى الخادم: ' + String(err) });
        } finally {
          clearTimeout(abortTimer);
        }
        if (attempt < 1 && (Date.now() - loopStart) < TOTAL_BUDGET_MS) {
          /* 🔴 مقصوصٌ على المتبقّي من الميزانية — رصدَته المراجعة 2026-08-21: النوم كان
             غير مشروط بها، فطلبٌ انتظر 12ث ثم استغرقت محاولتُه 11.5ث كان يُضيف 700ms
             **بعد** أن صار `elapsed` تحت السقف بـ500ms وحدها، ثم تكسر الحلقة على أي حال
             ⇒ 700ms هدرٌ صافٍ فوق السقف المُعلَن. الفرق يهمّ لأن هامش الدخول ضيّق. */
          var _remain = TOTAL_BUDGET_MS - (Date.now() - loopStart);
          var _nap = Math.min(delays[attempt], Math.max(0, _remain));
          if (_nap > 0) await new Promise(function (r) { setTimeout(r, _nap); });
        }
      }
      // عند استنفاد المحاولات لطلب JSON (POST) باستجابة غير صالحة (HTML/4xx):
      // أعِد JSON خطأ واضح بدل تمرير HTML يفشل JSON.parse في الجسر (netError مضلِّل «رد غير صالح»).
      if (!good && isPost) {
        var looksJson = lastText.charAt(0) === '{' || lastText.charAt(0) === '[';
        if (!looksJson) {
          return jsonResponse({ ok: false, error: 'تعذّر تنفيذ الطلب حالياً (اعتراض مؤقّت من الخادم). حاول مجدداً بعد لحظات.' }, 503);
        }
      }
      return withCors(new Response(lastText, {
        status: lastStatus,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }));
      } finally {
        // سطر واحد لكل نداء مكتمل — هو **مصدر القياس** الذي تُبنى عليه المرحلة ب:
        //   قانون Little:  N ≈ λ × W   (λ = عدد سجلّات ev:'gas' في الثانية،
        //   W = متوسط gasMs/1000)  ⇒ N = التزامن العالمي الفعلي المُقدَّر.
        // إن بقي p99(N) عبر أسبوع دون ~12 فالمرحلة أ (هذه) كافية ولا حاجة لـDurable
        // Object. عمداً سطر واحد فقط لكل نداء (لا سطر عند كل منح) كي لا يُغرَق السجل.
        // ── srv = زمن التنفيذ الخادمي الصافي (حقل `_ms` الذي يُلحقه ApiEndpoint.js في
        // ذيل جسم الاستجابة) — يُفكّ هنا للسجلّ فقط، فتكتمل معادلة «عبء Google =
        // gasMs − srv» المعطَّلة منذ إنشاء الحقل (فجوة §٦-1، تشخيص 2026-08-06).
        // استخراج رخيص بلا JSON.parse على المسار الحارّ: الحقل آخرُ خاصية في الكائن
        // دائماً (ترتيب الإدراج) فيكفي مسح ذيل النص. srv = -1 تعني «غير متاح»
        // (دالة مُعفاة زمنياً · تطبيق بلا `_ms` · فشل نقل) — لا صفراً يُحسَب زمناً.
        var _bhSrv = -1;
        try {
          if (good && lastText) {
            var _bhSm = /"_ms":(\d+)/.exec(lastText.slice(-80));
            if (_bhSm) _bhSrv = +_bhSm[1];
          }
        } catch (e2) { /* لا نُفشِل طلباً بسبب سجلّ */ }
        _bhLog({ ev: 'gas', app: app, fn: _bhFn, ms: Date.now() - _bhT0, waitMs: _bhWaited,
                 gasMs: Date.now() - _bhT0 - _bhWaited, n: _bhN, q: _bhQ.length,
                 st: lastStatus, ok: good, srv: _bhSrv });
        // التحرير يغطّي نقاط الخروج كلها: الاستجابة العادية وأي استثناء غير متوقّع
        // (الرفض 503 يخرج قبل الـtry ولا يحجز مقعداً أصلاً). بلا هذا، أي مسار خروج
        // منسيّ يُسرّب مقعداً إلى الأبد ويُجمّد السقف تدريجياً.
        if (_bhHeld) _bhRelease(app);
      }
    }

    // ── 1ب) عرض صورة QR عبر Proxy (inline): /qr-img?url=... ──────
    //   يجلب الصورة من api.qrserver.com ويُعيدها مباشرةً (بلا attachment)
    //   يُستخدم كـ fallback في <img onerror> عندما يكون qrserver.com محجوباً
    if (path === '/qr-img') {
      var qiUrl = url.searchParams.get('url') || '';
      if (!qiUrl || !qiUrl.startsWith('https://api.qrserver.com/')) {
        return jsonResponse({ error: 'رابط QR غير مقبول' }, 400);
      }
      try {
        var qiFetch = await fetch(qiUrl, { method: 'GET' });
        var qiBuf = await qiFetch.arrayBuffer();
        var qiHeaders = new Headers();
        qiHeaders.set('Content-Type', 'image/png');
        qiHeaders.set('Access-Control-Allow-Origin', '*');
        qiHeaders.set('Cache-Control', 'public, max-age=86400');
        return new Response(qiBuf, { status: 200, headers: qiHeaders });
      } catch (qiErr) {
        return new Response('', { status: 502 });
      }
    }

    // ── 1ب) تحميل QR عبر Proxy: /qr-download?url=...&name=... ────
    //   يجلب الصورة من api.qrserver.com ويُضيف Content-Disposition:attachment
    //   حل مثالي: نفس النطاق → لا مشكلة CORS عند التحميل
    if (path === '/qr-download') {
      var qrUrl = url.searchParams.get('url') || '';
      var qrName = url.searchParams.get('name') || 'QR-Code';
      // أمان: نسمح فقط بروابط api.qrserver.com
      if (!qrUrl || !qrUrl.startsWith('https://api.qrserver.com/')) {
        return jsonResponse({ error: 'رابط QR غير مقبول' }, 400);
      }
      try {
        var qrFetch = await fetch(qrUrl, { method: 'GET' });
        var qrBuf = await qrFetch.arrayBuffer();
        var dlHeaders = new Headers();
        dlHeaders.set('Content-Type', 'image/png');
        dlHeaders.set('Content-Disposition', 'attachment; filename="' + qrName.replace(/"/g,'') + '.png"');
        dlHeaders.set('Access-Control-Allow-Origin', '*');
        dlHeaders.set('Cache-Control', 'no-cache');
        return new Response(qrBuf, { status: 200, headers: dlHeaders });
      } catch (qrErr) {
        return jsonResponse({ error: 'تعذّر جلب صورة QR: ' + String(qrErr) }, 502);
      }
    }

    // ── 1ب) عودة OAuth من فيسبوك/إنستغرام: /oauth ───────────────
    //   Meta يعيد التوجيه إلى /oauth?code=...&state=schoolId
    //   إعادة توجيه حقيقية (لا جلب+بثّ) — صفحات GAS HtmlService تُخدَم داخل
    //   إطار Sandbox من جوجل يعتمد مسارات نسبية (goog.script.init، CSS/JS ثابتة)؛
    //   جلب البايتات وبثّها تحت نطاقنا يكسر تلك المسارات (goog is not defined،
    //   404 على mae_html_css_rtl.css) ويترك الإطار فارغاً. التوجيه الحقيقي يُبقي
    //   المتصفّح على نطاق جوجل الصحيح فتعمل الصفحة كبقية صفحات GAS الأخرى.
    if (path === '/oauth' || path === '/oauth/') {
      var qs = url.search ? url.search.replace(/^\?/, '') : '';
      var oauthTarget = GAS.cms + '?action=fb_oauth' + (qs ? '&' + qs : '');
      return Response.redirect(oauthTarget, 302);
    }

    // ── 1ج) صفحة التسعيرة (HTML من GAS) عبر الوكيل: /pricing ─────
    //   تُضمَّن عبر <iframe> بدل توجيه المتصفّح أو جلب+بثّ البايتات:
    //   - جلب+بثّ (المحاولة الأولى) يكسر إطار Sandbox في جوجل (نفس شرح
    //     /oauth أعلاه) ويترك الصفحة فارغة تماماً (goog is not defined).
    //   - توجيه 302 مباشر (المحاولة الثانية) يُصلح ذلك، لكنه ينقل شريط
    //     عنوان المتصفّح إلى نطاق جوجل — غير مناسب لصفحة تصفّح دائمة
    //     (بخلاف /oauth، نقطة عبور لحظية) يُفضَّل بقاء الزائر فيها على
    //     نطاق المشروع عند الضغط على روابط "خطط الأسعار".
    //   - الحل: iframe مصدره رابط جوجل الحقيقي مباشرة (لا جلب من طرف
    //     الخادم) — المتصفّح يحمّل محتوى الإطار من أصل جوجل الحقيقي فيعمل
    //     Sandbox طبيعياً (المسارات النسبية تُحل صحيحاً)، بينما يبقى شريط
    //     العنوان على نطاقنا. appsscript.json لتطبيق pricing مضبوط على
    //     XFrameOptionsMode.ALLOWALL فيسمح بهذا التضمين. تحقّق حيّ بمتصفح
    //     فعلي: عرض كامل بلا أخطاء، وشريط تحذير جوجل العلوي يختفي أيضاً
    //     (يظهر فقط عند التنقّل المباشر، لا داخل iframe).
    if (path === '/pricing' || path === '/pricing/') {
      var prSrc = (GAS.pricing + url.search).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      var prTitle = 'يمن سكولز | Yemen Schoolz — خطط الأسعار';
      var prDesc = 'خطط أسعار منصّة يمن سكولز لإدارة المدارس: اختر الخطّة المناسبة لمدرستك — لوحات المعلمين والطلاب، إدارة المحتوى والجداول، التقارير المالية، ودعم فني كامل.';
      // meta/OG/Twitter ثابتة (لا ديناميكية — صفحة تسويقية عامة بلا بيانات مدرسة بعينها).
      // ملاحظة: محتوى الـiframe نفسه (من script.google.com) لا يُفهرَس كجزء من هذه الصفحة —
      // هذه الوسوم تُحسِّن فقط عنوان/وصف/مشاركة نتيجة البحث والروابط الاجتماعية للغلاف الخارجي.
      var prHtml = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>' + prTitle + '</title>' +
        '<meta name="description" content="' + prDesc + '">' +
        '<link rel="canonical" href="https://yemenschoolz.com/pricing">' +
        '<meta property="og:type" content="website">' +
        // أحادي اللغة عمداً (ملاحظة تشغيلية #66 + #75 بمستودع GAS): الاسم المختلط
        // يُعرَض معكوساً داخل dir="rtl"، والحقول التي تقرأها محرّكات البحث لتحديد
        // اسم الموقع يجب أن تبقى سلسلة واحدة لا لبس فيها عبر كل الصفحات.
        // ⚠️ هذا الغلاف هو ما يراه الزاحف على /pricing — الصفحة الحقيقية داخل
        // <iframe>، فتعديل pricing/Index.html بمستودع GAS لا يظهر هنا إطلاقاً.
        // «Yemen Schoolz» تطابق سلسلة النطاق yemenschoolz.com حرفياً، وتطابق
        // App name في كونسول Google OAuth. تغييرها هنا يلزمه تغييرهما معاً.
        '<meta property="og:site_name" content="Yemen Schoolz">' +
        '<meta name="application-name" content="Yemen Schoolz">' +
        '<meta name="apple-mobile-web-app-title" content="يمن سكولز">' +
        '<meta property="og:title" content="' + prTitle + '">' +
        '<meta property="og:description" content="' + prDesc + '">' +
        '<meta property="og:url" content="https://yemenschoolz.com/pricing">' +
        '<meta property="og:image" content="https://yemenschoolz.com/assets/schoolz-yemen-og.png">' +
        '<meta property="og:image:width" content="1200">' +
        '<meta property="og:image:height" content="630">' +
        '<meta name="twitter:card" content="summary_large_image">' +
        '<meta name="twitter:title" content="' + prTitle + '">' +
        '<meta name="twitter:description" content="' + prDesc + '">' +
        '<meta name="twitter:image" content="https://yemenschoolz.com/assets/schoolz-yemen-og.png">' +
        '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#060e1e}' +
        'iframe{width:100%;height:100vh;border:0;display:block}</style></head><body>' +
        '<iframe src="' + prSrc + '" title="يمن سكولز — خطط الأسعار" allowfullscreen></iframe>' +
        '</body></html>';
      var prHeaders = new Headers();
      prHeaders.set('Content-Type', 'text/html; charset=utf-8');
      prHeaders.set('Access-Control-Allow-Origin', '*');
      return new Response(prHtml, { status: 200, headers: prHeaders });
    }

    // ── 1د) بثّ فيديو Google Drive عبر الوكيل: /media/drive/<fileId> ──
    //   يجلب بايتات الفيديو من Drive ويبثّها كـ video/mp4 مع دعم Range،
    //   ليُشغّل في وسم <video> الأصلي بدل مشغّل Drive المتعثّر
    //   ("تعذّر تحميل الفيديو. يُرجى إعادة المحاولة"). خفيف: بثّ مباشر بلا تخزين.
    var mediaMatch = path.match(/^\/media\/drive\/([a-zA-Z0-9_-]+)\/?$/);
    if (mediaMatch) {
      var fileId = mediaMatch[1];
      if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
      try {
        var range = request.headers.get('Range');
        var fInit = { method: 'GET', redirect: 'follow', headers: {} };
        if (range) fInit.headers['Range'] = range;
        // نقطة التنزيل المباشر الحديثة (تتجاوز صفحة فحص الفيروسات بـ confirm=t)
        var driveUrl = 'https://drive.usercontent.google.com/download?id=' + fileId + '&export=download&confirm=t';
        var dResp = await fetch(driveUrl, fInit);
        var ct = dResp.headers.get('Content-Type') || '';
        // لو رجعت صفحة HTML (تأكيد/خطأ) جرّب نقطة uc التقليدية
        if (ct.indexOf('text/html') !== -1) {
          dResp = await fetch('https://drive.google.com/uc?export=download&id=' + fileId + '&confirm=t', fInit);
          ct = dResp.headers.get('Content-Type') || '';
        }
        var outHeaders = new Headers();
        outHeaders.set('Content-Type', (ct && ct.indexOf('text/html') === -1) ? ct : 'video/mp4');
        outHeaders.set('Accept-Ranges', 'bytes');
        outHeaders.set('Access-Control-Allow-Origin', '*');
        // محتوى الفيديو ثابت لكل fileId (لا يتغيّر) → كاش طويل على حافة Cloudflare لتسريع
        // إعادة التشغيل والتموضع (seek)؛ immutable يمنع إعادة التحقّق غير الضرورية.
        outHeaders.set('Cache-Control', 'public, max-age=86400, immutable');
        var cr = dResp.headers.get('Content-Range'); if (cr) outHeaders.set('Content-Range', cr);
        var cl = dResp.headers.get('Content-Length'); if (cl) outHeaders.set('Content-Length', cl);
        return new Response(dResp.body, { status: dResp.status, headers: outHeaders });
      } catch (mErr) {
        return withCors(new Response('video proxy error: ' + String(mErr), { status: 502 }));
      }
    }

    // ── 1هـ) وسيط رفع الملفات إلى جلسة Drive القابلة للاستئناف: /drive-upload ──
    //   يستقبل من المتصفّح طلب PUT يحمل جسم الملف (أو شريحةً منه) مع ?sessionUri=...
    //   ويمرّره كما هو — بثّاً، بلا تحميله كاملاً في الذاكرة — إلى جلسة Drive
    //   resumable (uploadType=resumable). الفائدة: المتصفّح يتكلّم مع نطاق
    //   Cloudflare فقط، فيعمل الرفع داخل اليمن (تجاوز الحجب) وبلا مشاكل CORS.
    //   أمان (منع SSRF): نقبل فقط وجهةً نطاقها ينتهي بـ .googleapis.com عبر https.
    if (path === '/drive-upload' || path === '/drive-upload/') {
      // CORS: نعكس أصل الموقع (بلا اعتماد على كوكيز → آمن)، ونسمح بـ PUT وترويسات الرفع.
      var duOrigin = request.headers.get('Origin') || '*';
      var duCors = function (resp) {
        resp.headers.set('Access-Control-Allow-Origin', duOrigin);
        resp.headers.set('Access-Control-Allow-Methods', 'PUT, OPTIONS');
        resp.headers.set('Access-Control-Allow-Headers', 'content-type, content-range, content-length');
        resp.headers.set('Access-Control-Expose-Headers', 'Range, Location, Content-Range');
        resp.headers.set('Access-Control-Max-Age', '86400');
        if (duOrigin !== '*') resp.headers.set('Vary', 'Origin');
        return resp;
      };

      // معالجة الـ preflight
      if (request.method === 'OPTIONS') {
        return duCors(new Response(null, { status: 204 }));
      }
      if (request.method !== 'PUT') {
        return duCors(jsonResponse({ ok: false, error: 'استخدم PUT لرفع الملف' }, 405));
      }

      // التحقق الصارم من وجهة الرفع وحصرها في نطاق Google (منع SSRF)
      var sessionUri = url.searchParams.get('sessionUri') || '';
      if (!sessionUri) {
        return duCors(jsonResponse({ ok: false, error: 'sessionUri مفقود' }, 400));
      }
      var target;
      try {
        target = new URL(sessionUri);
      } catch (e) {
        return duCors(jsonResponse({ ok: false, error: 'sessionUri غير صالح' }, 400));
      }
      if (target.protocol !== 'https:' ||
          !(target.hostname === 'googleapis.com' || target.hostname.endsWith('.googleapis.com'))) {
        return duCors(jsonResponse({ ok: false, error: 'وجهة الرفع غير مسموحة' }, 400));
      }

      // تمرير الجسم بثّاً مع الحفاظ الحرفي على ترويسات الرفع.
      var upHeaders = new Headers();
      var ctH = request.headers.get('Content-Type');   if (ctH) upHeaders.set('Content-Type', ctH);
      var crH = request.headers.get('Content-Range');  if (crH) upHeaders.set('Content-Range', crH);
      var clH = request.headers.get('Content-Length'); if (clH) upHeaders.set('Content-Length', clH);

      try {
        var upResp = await fetch(sessionUri, {
          method: 'PUT',
          headers: upHeaders,
          body: request.body,
          duplex: 'half',
          redirect: 'manual'  // 308 (Resume Incomplete) ليست إعادة توجيه فعلية — نُمرّرها كما هي
        });

        // إعادة حالة Drive وجسمه كما هما: 308 أثناء التقطيع (مع Range)،
        // و200/201 + JSON فيه id عند الاكتمال.
        var duOut = new Headers();
        var rngH = upResp.headers.get('Range');    if (rngH) duOut.set('Range', rngH);
        var locH = upResp.headers.get('Location'); if (locH) duOut.set('Location', locH);
        duOut.set('Content-Type', upResp.headers.get('Content-Type') || 'application/json; charset=utf-8');
        return duCors(new Response(upResp.body, { status: upResp.status, headers: duOut }));
      } catch (upErr) {
        return duCors(jsonResponse({ ok: false, error: 'تعذّر رفع الملف إلى Drive: ' + String(upErr) }, 502));
      }
    }

    // ── 1و) رابط تحميل/تحديث التطبيق القصير: /app (ومرادفه /download) ──────
    //   لماذا يعيش في الوسيط لا كصفحة: رابطٌ يُرسَل في واتساب وفي إشعارات التحديث
    //   ويُطبَع على ورق، فيجب أن يبقى قصيراً وثابتاً حتى لو تغيّر معرّف الحزمة أو
    //   انتقل التطبيق لمتجر آخر — نقطةُ تغييرٍ واحدة هنا بدل تعديل كل ما نُشِر.
    //   ‏302 لا 301 عمداً: الدائم يُخبَّأ في المتصفّح للأبد فيُصعِّب أي تغيير هدف لاحق.
    //   ‏?ref= يُمرَّر إلى Play كـ`referrer` (قياس مصدر التحميل)، وبلا أثر إن غاب.
    //
    // 🔴 الرؤوس الأمنية تُكرَّر هنا يدوياً — وهذا ليس نسخاً زائداً: هذا المسار **يعود
    //    مبكراً** فلا يمرّ بكتلة الرؤوس أسفل الملف. الاستجابة بلا HSTS/nosniff/Referrer
    //    كانت ستكون استثناءً صامتاً من سياسةٍ يفترض القارئ أنها شاملة — نفس ما عولج
    //    صراحةً في مسار 404. وشرط المضيف على HSTS **يبقى محفوظاً**: تثبيت HTTPS ١٨٠
    //    يوماً على نطاق إرثي يخدم متجراً منفصلاً لا رجعة فيه.
    if (path === '/app' || path === '/app/' || path === '/download' || path === '/download/') {
      var apPkg = 'com.proconrers.schoolappyemen';
      var apRef = url.searchParams.get('ref') || '';
      var apTarget = 'https://play.google.com/store/apps/details?id=' + apPkg +
        (apRef ? '&referrer=' + encodeURIComponent(apRef) : '');
      var apIsCanon = (url.hostname === 'yemenschoolz.com' ||
                       url.hostname === 'www.yemenschoolz.com');
      var apHeaders = {
        'Location': apTarget,
        // لا تخبئة: أي تغيير للهدف يسري فوراً على كل من نسخ الرابط سابقاً.
        'Cache-Control': 'no-store',
        'Strict-Transport-Security': apIsCanon
          ? 'max-age=15552000; includeSubDomains'
          : 'max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      };
      // النطاقات غير الرسمية لا تُفهرَس (نفس قاعدة بقية المسارات).
      if (!apIsCanon) apHeaders['X-Robots-Tag'] = 'noindex, follow';
      return new Response(null, { status: 302, headers: apHeaders });
    }

    // ── 1ز) Digital Asset Links: /.well-known/assetlinks.json ─────────────
    //   ملفٌّ واحد يخدم ميزتين في تطبيق أندرويد (‏vc32):
    //     ① **App Links** — `autoVerify="true"` يجعل روابط yemenschoolz.com تفتح داخل
    //        التطبيق مباشرةً بلا منتقي تطبيقات.
    //     ② **WebAuthn داخل الـWebView** — `WEB_AUTHENTICATION_SUPPORT_FOR_APP` يشترط
    //        أن يكون التطبيق مُتحقَّقاً لهذا النطاق، وعليه يتوقّف «الدخول بالبصمة».
    //
    //   🔴 لماذا من الوسيط لا من GitHub Pages: مسارٌ يبدأ بنقطة. وGitHub Pages تبني
    //      بـJekyll الذي **يتجاهل الملفات والمجلدات التي تبدأ بنقطة أو بشرطة سفلية**
    //      ما لم يوجد `.nojekyll` — أي أن الملف كان يمكن أن يختفي بصمت بعد أوّل بناء،
    //      ونوع محتواه غير مضمون. من الوسيط: وجودٌ ونوعٌ مضمونان وقابلان للاختبار.
    //
    //   ⚠️ **البصمتان — ولماذا كلتاهما إلزاميّة** (اكتملتا 2026-08-13):
    //      `relation` بـ`handle_all_urls` يمنح التطبيق الروابط، فلا يُضاف إلا مفتاحٌ نملكه.
    //      وهما مفتاحان **مختلفان يوقّعان شيئين مختلفين**، وخلطُهما هو ما يجعل التحقّق
    //      يفشل **صامتاً** (‏`Domain verification state: none` وحده، بلا رسالة):
    //
    //        · **مفتاح الرفع** — يوقّع ما **ترفعه أنت** إلى Play، وهو ما يحمله أي
    //          تثبيت يدوي (‏`adb install`) وأي بناء محلّي. مقيس من الحزمة المنشورة
    //          نفسها (‏`SchoolApp-v2.8-vc31` ⇒ `META-INF/SCHOOLAP.RSA` ⇒ keytool)،
    //          ومطابِق للمسجَّل في Firebase.
    //        · **مفتاح توقيع التطبيق** — تديره Google، ويوقّع ما **يصل المستخدم**
    //          فعلاً بعد أن يُعيد Play توقيع الحزمة. مصدره الوحيد:
    //          *Play Console ← إعداد ← تكامل التطبيق ← شهادة مفتاح توقيع التطبيق*.
    //
    //      ⇒ بالأولى وحدها تعمل الروابط في التثبيت اليدوي **وتفشل لكل مستخدم من Play**.
    //      وبالثانية وحدها ينكسر الاختبار المحلي. فالقائمة تحمل الاثنتين — وPlay نفسه
    //      يُصدِر مقتطفه بالثانية، وهذه القائمة اتحادُهما لا بديلٌ عنه.
    if (path === '/.well-known/assetlinks.json') {
      var alFingerprints = [
        // ① مفتاح الرفع (مقيس من الحزمة المنشورة 2026-08-12، ومطابِق لمسجَّل Firebase)
        '11:E9:B0:2B:1F:26:06:54:04:F8:64:46:51:F8:FA:84:EC:52:DF:3D:0D:11:16:9B:E3:E9:E3:40:B7:50:FA:39',
        // ② مفتاح توقيع التطبيق الذي تديره Google — **هذا هو الذي يحمله المستخدم**
        //    (من Play Console ← إعداد ← تكامل التطبيق، 2026-08-13)
        'CF:63:D5:66:10:1F:6C:1D:4D:3D:90:29:BD:8D:A6:89:A8:80:1A:BC:6A:2D:1F:F6:EE:62:87:F3:49:E0:FE:C9'
      ];
      var alBody = JSON.stringify([{
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.proconrers.schoolappyemen',
          sha256_cert_fingerprints: alFingerprints
        }
      }]);
      return new Response(alBody, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          // نظام أندرويد يجلبه عند التثبيت وبعده دورياً — ساعةٌ تكفي، وتُبقي إضافة
          // بصمة جديدة سارية في وقت معقول بلا انتظار يوم كامل.
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }

    // ── 2) خدمة الموقع الثابت من GitHub Pages ───────────────────
    // الجذر / يخدم **home/Schools.html** منذ 2026-08-07: صفحة هبوط كاملة (هيرو · about-app ·
    // features · platform-details · faq) + دليل المدارس في قسم واحد — أي كل ما كان يخدمه
    // home-all-school وزيادة. المحتوى نُقِل **نسخاً** والملف القديم مجمَّد بلا لمسة:
    // /home-all-school/index.html يبقى يُخدَم 200 (معرّف نشره ثابت — بند 104، وأندرويد
    // SchoolzYemen يشير إليه)، وكذلك /index.html القديمة. راجع _build/gen-sitemap.js في
    // school-app-yemen-gas — مدخل الجذر هناك يشير إلى home/Schools.html فيتطابق المصدران.
    //
    // 🔴 الترتيب مع مستودع الـgas غير قابل للعكس: هذا السطر لا يُنشَر إلا بعد أن يُثبت
    // curl أن /home/schools.html صار index,follow حيّاً. العكس يخدم الجذر بـnoindex
    // لنافذة كاملة، وHTML يُخدَم هنا بـno-cache (أدناه) فيصل الزاحف فوراً.
    if (path === '/' || path === '') path = '/home/schools.html';
    // ── /portal → منصّة الطالب (2026-08-10) ──────────────────────────────
    // رابط قصير جديد لمنصّة الطالب، **بلا تعطيل أي شيء قائم**: `/student/index.html`
    // و`/gas/student` وكل النطاقات تبقى كما هي حرفياً — تطبيق الأندرويد يحمّل رابطه
    // الثابت من `AppConfig.kt` ويتجاهل أي URL مُمرَّر، **وبلا Deep Link إطلاقاً**، فلا
    // طريق لتحديثه ⇒ أي كسر هناك لا رجعة فيه.
    //
    // 🔴 هذا **تغيير سلوك لمسار حيّ لا إضافة مسار جديد**: `/portal` كان يُرجِع 200 ويُخدَم
    // بـ`/home/index.html` لأن `_schoolSlugFromPath` تقرؤه slug مدرسة (قياس حيّ قبل
    // التغيير: 147,212 بايت — نفس بايتات `/ibn-khaldoun` بالضبط). تُحقِّق قبل الدمج أن
    // `portal` ليس slug مدرسة مسجَّلة (‏sitemap الحيّ وقتها: `abdaawatmuaz` ·
    // `ibn-khaldoun` · `aljil-al-hadith` — لا ثالث لها).
    //
    // إعادة كتابة داخلية لا redirect: الرابط يبقى `/portal` بشريط المتصفّح (أنظف
    // للمشاركة)، ويرث السطرُ الواحد كلَّ ما بعده — حذف CSP/X-Frame-Options، وسماح
    // CORS، وسياسة no-cache للـHTML، وبثّ الجسم. نفس نمط سطر الجذر أعلاه حرفياً.
    // ويسبق حساب `_pathSlug` أدناه عمداً فلا يُلتقَط كـslug.
    if (path === '/portal' || path === '/portal/') path = '/student/index.html';
    // ── الرابط العاري `/home/index.html` بلا أيّ معرّف ⇒ الجذر (2026-08-14) ──────
    //
    // 🔴 **الفجوة التي يُغلقها هذا السطر**: عنوانٌ لا يذكر أيّ مدرسة كان **نافذةً كاملة
    //    على بيانات مدرسة المالك**. قياس حيّ 2026-08-14: `getHomePageBundle('')` يُرجِع
    //    `isOwner:true` و**30,056 بايت** (اسم · هاتف · عنوان · شعار · أخبار · صور ·
    //    فيديو · إحصاءات · شهادات) مقابل 626 بايت لمستأجرٍ آخر. و١٣٨ مستخدماً في ٢٨
    //    يوماً يصلون هكذا فيرون صفحة مدرسة بعينها على عنوان المنصّة.
    //    ⇒ قرار مالك 2026-08-14: **الرابط بلا معرّف يجب أن يكون فارغاً**، والمالك
    //      يُطلَب بمساره `/abdaawatmuaz` كأيّ مستأجر آخر بلا استثناء.
    //
    // 🔒 **الشرط `!url.search` وحده** — لا يمسّ أيّ رابط يحمل معرّفاً:
    //    · تطبيق الأندرويد المنشور (٦٦٣ تثبيتاً) يفتح `…/home/index.html?school=<UUID>`
    //      (‏`AppConfig.kt::HOME_URL`) ⇒ **خارج الشرط تماماً**.
    //    · وحتى لو بلغه يوماً: `/` صفحةُ واجهة عامّة مسموحة داخل الـWebView
    //      (‏`AppConfig.kt` — «الجذر · `/home/**`») ⇒ لا `ACTION_VIEW` ولا قذفٌ إلى
    //      المتصفّح. هذا **ليس** حالة الـ301 المحظورة عند `REDIRECT_TO_CANONICAL`:
    //      تلك تغيّر **المضيف** فيفقد التطبيق مقطعَ مساره المعروف؛ وهذه تُبقيه.
    //
    // 🔴 والشرط **وجود المعامل لا صحّته**: لو بُني على `_tenantKeyFrom` لصار أيّ مدرسة
    //    جديدة لم تُضَف بعد إلى `_KNOWN_SCHOOL_SLUGS` (والقائمة **تُصان يدوياً**) تُحوَّل
    //    إلى الجذر فتُكسَر صفحتها بصمت. المعرّف المجهول يُرفَض خادمياً بـ`not_found` —
    //    وهذا هو الموضع الصحيح لرفضه، لا هنا.
    //
    // 302 لا 301 عمداً: القرار سياسة منتج قابلة للمراجعة، و**301 يُخبَّأ في المتصفّح
    // للأبد** فيصير عكسُه مستحيلاً على كلّ من زار الرابط مرّة واحدة.
    // و`news.html` معه: العاري منها يستدعي `getHomePageBundle('', 'library')` ⇒ **مكتبة
    // المالك كاملةً بما فيها الأخبار الموجَّهة لصفّ/شعبة** (وضع المكتبة يرفع الحجب عنها
    // عمداً) — تسريبٌ أوسع من الصفحة الرئيسية لا أضيق. `newsarticle.html` **خارج** القائمة:
    // مسار مشاركةٍ يحمل `?news=` دائماً، وحقن OG له سلسلته الخاصّة.
    if (/^\/home\/(index|news)\.html\/?$/i.test(path) &&
        !url.searchParams.has('school') && !url.searchParams.has('schoolId')) {
      return Response.redirect(CANONICAL_ORIGIN + '/', 302);
    }
    // ── المسارات العميقة للمنصّتين (راجع `_DEEP_PORTAL_RE` أعلاه للمبرّر والضوابط) ──
    // تسبق حساب `_pathSlug` أدناه عمداً — وإن كان لا يلتقطها أصلاً (يشترط مقطعاً واحداً).
    // أصلٌ طُلب من عمقٍ خاطئ ⇒ يُوجَّه إلى موضعه الحقيقي. **يسبق** إعادة كتابة المسار
    // العميق عمداً: أصلٌ بلا امتداد (`/teacher/assets/foo`) كان سيُطابق `_DEEP_PORTAL_RE`
    // فيُخدَم صفحةَ المنصّة كاملةً بدل الأصل — 200 مضلِّل أسوأ من 404 صادق.
    var _assetAlias = _APP_ASSET_ALIAS_RE.exec(path);
    if (_assetAlias) path = '/' + _assetAlias[1];
    var _deepSeg = _DEEP_PORTAL_RE.exec(path);
    if (_deepSeg) path = '/' + _deepSeg[1].toLowerCase() + '/index.html';
    // رابط مدرسة قصير (yemenschoolz.com/<slug>): يُعاد كتابته إلى **`/home/index.html`**
    // منذ 2026-08-07 (بند 104) — بدل `home-all-school`. السبب: قرار مالك بأن تكون صفحة كل
    // مدرسة **نفس تصميم `/home/index.html` بالضبط**، والمطابقة الحقيقية أن يخدمهما ملف واحد
    // لا أن يُصان تصميمان متطابقان يدوياً. `home` صار متعدّد المستأجرين بالكامل
    // (‏`getHomePageBundle` + مسار المشاركة/OG) في school-app-yemen-gas #916→#931.
    // فحص _schoolSlugFromPath يستبعد كل الأسماء المحجوزة فلا يتعارض مع أي مسار قائم.
    // 🔴 **تصحيح 2026-08-11:** كان مكتوباً هنا «لا نداء GAS للتحقّق من وجود المدرسة —
    // slug غير حقيقي يُرجِع `not_found` خادمياً لا عطلاً». صحيحٌ للمستخدم، **وأعمى تماماً
    // عن محرّك البحث**: الحالة 200 وحدها هي ما يقرؤه، فكان كلّ مقطع مسار مخترَع صفحةً
    // كاملة قابلة للفهرسة. صار الفحص ضدّ `_KNOWN_SCHOOL_SLUGS` أدناه — بلا نداء GAS
    // أيضاً (القائمة ثابتة في الكود)، لكن بحالة 404 صادقة.
    // ⚠️ لا حقن ?school= في المسار (كان بلا فائدة): إعادة الكتابة تخصّ الجلب الداخلي من
    // GitHub Pages فقط؛ `location.search` بالمتصفّح يبقى كما طلبه الزائر. لذلك
    // `home/Index.html::__hasPathSlug()` تقرأ `location.pathname` مباشرةً.
    // 🔴 لكن حقن OG أدناه **يحتاج** المعرّف صراحةً — فيُلتقَط هنا **قبل** إعادة الكتابة،
    // وإلّا صار `?school=` فارغاً بعدها فتُعرَض معاينة مدرسة المالك لكل مدرسة.
    var _pathSlug = _schoolSlugFromPath(path);
    // 🔴 slug غير منشور ⇒ **404 حقيقي**، لا 200 بصفحة كاملة. قبل هذا كان أيّ مقطع مسار
    //    واحد غير محجوز يُخدَم بمحتوى `/home/index.html` كاملاً بحالة 200 — سطحُ فهرسةٍ
    //    لا نهائي. الجسم عربيّ مفيد (لا شاشة فارغة) ويحمل رابط دليل المدارس.
    if (_pathSlug && !_KNOWN_SCHOOL_SLUGS[_pathSlug]) {
      return new Response(_unknownSlugPage(_pathSlug), {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Robots-Tag': 'noindex, follow',
          // يخرج قبل كتلة الرؤوس الأمنية أدناه، فتُكرَّر هنا صراحةً — «الرؤوس في الكود»
          // سياسةٌ لا تحتمل استثناءً صامتاً. والمدّة القصيرة عمداً: هذه استجابة قد تصل
          // من أيّ مضيف، ولا يجوز أن تثبّت HSTS طويلاً على النطاقين الإرثيين.
          'Strict-Transport-Security': 'max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin'
        }
      });
    }
    if (_pathSlug) path = '/home/index.html';
    var ghUrl = GITHUB_BASE + path + url.search;
    var ghResp = await fetch(ghUrl, {
      headers: { 'User-Agent': 'cf-worker-proxy', 'Accept': request.headers.get('Accept') || '*/*' },
      redirect: 'follow'
    });

    var headers = new Headers(ghResp.headers);
    // إزالة قيود قد تمنع التضمين/التشغيل عبر نطاق آخر
    headers.delete('content-security-policy');
    headers.delete('x-frame-options');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.delete('etag');
    headers.delete('last-modified');
    headers.delete('expires');

    // ── رؤوس أمنية ────────────────────────────────────────────────────
    // 🔴 **في الكود لا في لوحة Cloudflare** عمداً: رأسٌ باللوحة لا يظهر في أي مراجعة،
    // ولا يُختبَر، ولا يُتراجَع عنه بنشرة واحدة — وهو بالضبط الانحراف الصامت الذي
    // جعل إعداد النطاقات كلَّه غير مرئي من المستودع.
    //
    // ⚠️ المدّة **مشروطة بالمضيف** — وهذا ليس تجميلاً: هذا الوركر الواحد يخدم **ثلاثة
    // أصول** (‏`yemenschoolz.com` · `school.procorners.com` · `…workers.dev`)، وقياسٌ حيّ
    // 2026-08-11 أثبت أن الثلاثة كانت تتلقّى الرأس الثابت نفسه. فرفعُ سطرٍ واحد كان
    // سيمنح النطاق الإرثي ١٨٠ يوماً + `includeSubDomains` أيضاً — أي تثبيت HTTPS لا
    // رجعة فيه على مضيفٍ داخل نطاق **متجرٍ منفصل** (‏`procorners.com`) وتخدمه نسخةُ
    // أندرويد مجمَّدة في الـAPK. الشرط يُبقيه على المرحلة الأولى القصيرة.
    //
    // المرحلة الأولى (‏`max-age=300`) بلغت غايتها: HSTS يُلزم المتصفّح بـHTTPS للمدّة
    // كاملةً ولا سبيل لإلغائه من الخادم قبل انقضائها، فنُشِر قصيراً حتى يُتحقَّق أن الجذر
    // و`www` يعملان — وقد تحقّق حيّاً 2026-08-11 (‏`www` مربوط Custom Domain ⇒ 301 إلى
    // الجذر بحفظ المسار والاستعلام، والأصول الثلاثة الأخرى 200 بلا تحويل).
    // **بلا `preload`** بقرار مالك — إدراجُ القائمة المدمجة شبه غير قابل للتراجع.
    var _isCanonHost = (url.hostname === 'yemenschoolz.com' ||
                        url.hostname === 'www.yemenschoolz.com');
    headers.set('Strict-Transport-Security',
                _isCanonHost ? 'max-age=15552000; includeSubDomains' : 'max-age=300');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // عزل نافذة المتصفّح (‏2026-08-12) — رصده PageSpeed تحت «أفضل الممارسات».
    // 🔴 `same-origin-allow-popups` **لا** `same-origin`: المنصّة تفتح نوافذ خارجية
    //    بـ`window.open` (واتساب من `cms/QR_Dashboard.html`، ومسار OAuth فيسبوك)،
    //    و`same-origin` الصارمة تقطع `window.opener` عنها فتكسر عودة OAuth تحديداً.
    //    هذه القيمة تُعطي العزل عن أي نافذة تفتحنا، وتُبقي نوافذنا تعمل.
    headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    // 🚫 ولا تُعاد `content-security-policy` ولا `x-frame-options` هنا: حذفهما أعلاه
    // **مقصود** — `/pricing` يُخدَم داخل `<iframe>` من هذا الوركر نفسه.

    // سياسة تخزين ذكية حسب نوع الملف:
    //  - HTML / sw.js / manifest: لا تخزين (تظهر التحديثات فوراً، ويتحدّث الـ SW).
    //  - الأصول الثابتة (js/css/صور/خطوط): تخزين يوم + stale-while-revalidate أسبوع
    //    → على الشبكات الضعيفة تُعاد من كاش المتصفّح فوراً بدل جولة شبكة لكل ملف.
    var lowerPath = path.toLowerCase();
    var isHtml = lowerPath === '/' || /\.html?$/.test(lowerPath) || !/\.[a-z0-9]+$/.test(lowerPath);
    var isNoCache = isHtml || /\/sw\.js$/.test(lowerPath) || /manifest\.webmanifest$/.test(lowerPath);
    if (isNoCache) {
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }

    // ── هوية الرابط والنطاق (راجع `_identityHeaders` أعلاه للسبب الكامل) ─────
    // يُحسَب مرّةً ويُستخدَم ثلاثاً: رأس `Link`، وحقن `?news=` أدناه، والحقن العامّ في النهاية.
    var _canonHref = _canonicalFor(path, _pathSlug, url.searchParams.get('school'));
    var _idHeaders = _identityHeaders(url.hostname, isHtml, _canonHref);
    Object.keys(_idHeaders).forEach(function (k) { headers.set(k, _idHeaders[k]); });

    // حقن وسوم OG لكل خبر (?news=<id>) كي تُظهر تطبيقات المشاركة (واتساب/فيسبوك) صورة الخبر وعنوانه.
    // /home/ (مدرسة المالك، أحادية المستأجر) تستهدف GAS.home كسابقاً؛ أي مسار آخر (بما فيه الجذر
    // المُعاد كتابته أعلاه إلى home-all-school) يستهدف home-all-school (getNewsOg متعدّدة المستأجرين).
    // ?t=<توكن> (2026-07-27): توكن معاينة موقَّع (HMAC، home/Code.js::_homeVerifyShareToken) —
    // مطلوب فقط لأخبار GAS.home الموجَّهة لصفّ/شعبة محدَّدة؛ يُمرَّر بلا ضرر لـhome-all-school أيضاً
    // (وسيط إضافي يُتجاهَل — getNewsOg هناك بمعاملين فقط).
    var _newsId = url.searchParams.get('news');
    if (_newsId && isHtml) {
      var _ogApp = /^\/home\//.test(path) ? 'home' : 'home-all-school';
      // «افتحْ الآن أو تخطَّ» (maxWait = 0): وسوم OG لزائر مشاركة يجب ألّا تُزاحم تسجيل
      // دخول معلّم في الطابور أبداً. عند عدم توفّر مقعد فوراً نتخطّى الحقن ونخدم الصفحة
      // بوسوم الهوية العامة — وهو بالضبط ما يفعله الـcatch أدناه اليوم عند أي فشل.
      // (هذا النداء يستهلك من حصة الثلاثين أيضاً ولم يكن محكوماً إطلاقاً قبل اليوم.)
      var _ogMode = (env && env.BULKHEAD_MODE) || 'on';
      var _ogHeld = (_ogMode !== 'off') ? await _bhAcquire(_ogApp, 0) : false;
      if (_ogMode !== 'off' && !_ogHeld) {
        _bhLog({ ev: 'bulkhead', act: 'skip_og', app: _ogApp, mode: _ogMode, n: _bhN, q: _bhQ.length });
      }
      // التخطّي الفعلي في وضع 'on' فقط: وضع 'shadow' يُسجّل ولا يغيّر السلوك إطلاقاً،
      // ووضع 'off' لا يحكم أصلاً. والتحرير مشروط بـ_ogHeld وحده — تحرير مقعد لم نأخذه
      // كان سيخصم مقعد طلب متزامن آخر ويُفسد العدّاد.
      if (_ogHeld || _ogMode !== 'on') try {
        var _ogTarget = /^\/home\//.test(path) ? GAS.home : GAS['home-all-school'];
        // ⚠️ إصلاح خلل قائم: هذا النداء كان بلا أي مهلة إطلاقاً — يمكن أن يعلق طويلاً
        // ويحتجز مقعداً من حصة GAS بينما الزائر ينتظر صفحة ثابتة أصلاً.
        var _ogAbort = new AbortController();
        var _ogTimer = setTimeout(function () { _ogAbort.abort(); }, 8000);
        var _ogRes = await fetch(_ogTarget, {
          method: 'POST',
          signal: _ogAbort.signal,
          headers: { 'Content-Type': 'text/plain' },
          // 🔴 `_pathSlug` أولاً ثم `?school=`: على صفحة مدرسة (`/‌<slug>?news=…`) لا وجود
        // لـ`?school=` إطلاقاً، فالاكتفاء به كان يُمرِّر فراغاً = **مدرسة المالك** (بند 99)
        // ⇒ معاينة واتساب لكل مدرسة تعرض خبر الإبداع. التُقِط قبل إعادة كتابة المسار أعلاه.
        body: JSON.stringify({ fn: 'getNewsOg', args: [_newsId, _pathSlug || url.searchParams.get('school') || '', url.searchParams.get('t') || ''] })
        });
        clearTimeout(_ogTimer);
        var _ogJson = await _ogRes.json();
        var _og = (_ogJson && _ogJson.result) ? _ogJson.result : _ogJson;
        if (_og && _og.ok && (_og.image || _og.title)) {
          // 🔗 الرابط القانوني للمعاينة — يُبنى من **ما طلبه الزائر فعلاً** لا من ثابت:
          // على الرابط القصير `/<slug>?news=<id>` يصير `<origin>/<slug>?news=<id>`،
          // وعلى الشكل القديم يبقى مساره كما هو. بلا هذا يعلن كلُّ خبر أن رابطه
          // القانوني هو صفحة المكتبة العامّة، فتوحّد منصّات المشاركة المعاينات كلَّها
          // على رابط واحد.
          // ⚠️ يعمل فقط لأن الوسم موجود في المصدر: `_AttrSet` يضبط سمةً على وسم موجود
          // ولا يُنشئ غائباً — أُضيف `og:url` إلى `home/News.html` في مستودع الـgas
          // بنفس الدفعة.
          // 🔴 **تصحيح 2026-08-11:** كان مكتوباً هنا «ويحرس وجودَه `ogTagsExistGuard` هناك»
          //    — و**لا وجود لهذا الحارس في أيّ مستودع**. بحثٌ كامل أعاد مطابقتين، كلتاهما
          //    داخل وثائق. أي أن التعليق كان يمنح ثقةً بشبكة أمان غير موجودة، وهو أسوأ من
          //    الصمت. الحارس الفعلي القائم في `test-routes.js` يفحص **نصّ الحقن في الوركر**
          //    لا **وجود الوسم في الـHTML المخدوم** — فحذفُ الوسم من المصدر غداً يُصمِت
          //    الحقن كلَّه ويبقى الفحص أخضر (فئة بند 123 حرفياً). دَينٌ مفتوح مقصود.
          var _ogCanonical = CANONICAL_ORIGIN + (_pathSlug ? '/' + _pathSlug : path) +
                             '?news=' + encodeURIComponent(_newsId);
          // 🖼️ صور المعاينة: `images[]` من الخادم، وتراجعٌ للحقل المفرد `image` كي يبقى
          //    الوسيط عاملاً لو خُدِم من نشرة GAS أقدم لم تعرف الحقل الجديد بعد.
          var _ogImgs = (_og.images && _og.images.length) ? _og.images : (_og.image ? [_og.image] : []);
          // ⚠️ المرساة `data-og="img1"` لا `property`: محدِّد `meta[property="og:image"]`
          //    يطابق **كلّ** وسم صورة (بما فيها ما نُلحِقه) فيوحّد قيمتها ⇒ تعدّدٌ يصير تكراراً.
          // ⚠️ `og:url` يحمل `?news=` (المعاينة تخصّ الخبر) بينما `canonical` **لا يحمله**:
          //    إشارتان لغرضَين مختلفَين. إعلانُ `?news=` قانونياً يدعو الزاحف لفهرسة عددٍ
          //    لا نهائي من نسخ الصفحة الأمّ — والتحويلة إلى صفحة المقال جافاسكربتية أصلاً.
          return new HTMLRewriter()
            .on('meta[property="og:title"]', new _AttrSet('content', _og.title))
            .on('meta[property="og:description"]', new _AttrSet('content', _og.description))
            .on('meta[data-og="img1"]', new _OgImages(_ogImgs.slice(0, 4)))
            .on('meta[property="og:url"]', new _AttrSet('content', _ogCanonical))
            .on('link[rel="canonical"]', new _AttrSet('href', _canonHref))
            .on('meta[name="twitter:image"]', new _AttrSet('content', _ogImgs[0] || _og.image))
            .transform(new Response(ghResp.body, { status: ghResp.status, headers: headers }));
        }
      } catch (_ogErr) { /* تجاهل — نُعيد الصفحة بوسوم الهوية العامة */ }
      finally {
        // إلزامي أن يكون finally: مسار النجاح يخرج بـreturn HTMLRewriter().transform()
        // من **داخل** الـtry، فأي تحرير بعد الكتلة لن يُنفَّذ في الحالة الشائعة.
        clearTimeout(_ogTimer);
        if (_ogHeld) _bhRelease(_ogApp);
      }
    }

    // ── الرابط القانوني — على صفحات المدرسة وحدها ────────────────────────────
    // يُصحَّح **خادمياً** لا بجافاسكربت: كان `home/Index.html` يُصلح canonical بعد التحميل
    // (‏`location.pathname`)، بينما الـHTML الخام الذي يراه الزاحف **أوّلاً** يقول
    // `/home/index.html` لكلّ مستأجر. و`og:url` كان يُضبَط داخل فرع `?news=` وحده.
    //
    // 🔒 مشروطٌ بـ`_canonHref` غير فارغ ⇒ لا يمرّ على `/` ولا `/portal` ولا بوّابات
    //    الدخول ولا `home-all-school` — أوسامها الساكنة صحيحة وأدقّ (راجع `_canonicalFor`).
    //    وهذا يُجنّب أيضاً تحليل `teacher/index.html` (‏1.88MB) بلا فائدة على كل طلب.
    //
    // ⚠️ `_AttrSet` يعدّل وسماً موجوداً و**لا يُنشئ غائباً** (بند 123). والوسمان موجودان
    //    فعلاً في `home/Index.html`. 🔴 **ولا حارس يقيس ذلك اليوم:** `test-routes.js` يقرأ
    //    ملفّ الوركر وحده (‏`fs.readFileSync(W)` قراءتُه الوحيدة) وصفر HTML مخدوم — فحذفُ
    //    الوسم من المصدر غداً يُصمِت الحقن ويبقى كلّ فحص أخضر. دَينٌ مفتوح مقصود ومُعلَن،
    //    لا ادّعاءُ حمايةٍ غير قائمة.
    if (isHtml && ghResp.status === 200 && _canonHref) {
      var _rw = new HTMLRewriter()
        .on('link[rel="canonical"]', new _AttrSet('href', _canonHref))
        .on('meta[property="og:url"]', new _AttrSet('content', _canonHref));

      /* ── هوية المدرسة في الـHTML الخام (راجع الكتلة الشارحة عند `BRAND_TTL_S`) ──
         🔒 مشروطٌ بـ`_pathSlug` وحده ⇒ الجذر `/` و`/home/index.html` العاري لا يُمَسّان.
         🔒 و`!_newsId`: مسار المشاركة يملك سلسلته الخاصّة أعلاه بوسوم OG **خاصّة بالخبر**،
            ودهسُها باسم المدرسة يُفرِغ بطاقة المعاينة من مضمونها. (ولا يصل هذا السطر
            أصلاً حين ينجح ذلك المسار — لكنه يصله حين يفشل أو يتخطّاه الـbulkhead.)
         🔴 fail-open: `_brandFromCache` تقرأ كاش الحافة فقط. إخفاقها ⇒ نخدم الصفحة كما
            هي **بلا أي انتظار** ونُحدِّث في الخلفية. أوّل زائر بعد انتهاء المهلة يرى
            السلوك القديم — وهو مقبول لأن كاش الصفحة العميلي يغطّيه، والبديل (انتظار GAS
            في مسار الطلب) يُضاعف العلّة التي جئنا نُصلحها. */
      /* 🔴 `_tenantKey` لا `_pathSlug` (2026-08-14): المستأجر قد يصل بمقطع مسار **أو**
         بمعامل صريح، والثاني هو رابط تطبيق الأندرويد المنشور — راجع `_tenantKeyFrom`. */
      var _tenantKey = _tenantKeyFrom(_rawPath, url.search);
      if (_tenantKey && !_newsId) {
        var _brand = await _brandFromCache(url.origin, _tenantKey);
        if (_brand) _rw = _brandRewrite(_rw, _brand);
        else if (ctx && ctx.waitUntil) ctx.waitUntil(_brandRefresh(url.origin, _tenantKey, env));
      }

      return _rw.transform(new Response(ghResp.body, { status: ghResp.status, headers: headers }));
    }

    return new Response(ghResp.body, {
      status: ghResp.status,
      statusText: ghResp.statusText,
      headers: headers
    });
  }
};

// build: re-trigger v2
