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
  student:  'https://script.google.com/macros/s/AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq/exec',
  schedule: 'https://script.google.com/macros/s/AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag/exec',
  'master-admin': 'https://script.google.com/macros/s/AKfycbx5H6uYXb-6iVt_nT4YkdnYMhl6eZJSDxsULsKa2eyblZQcwzRo4CXR3Mh_ecRSZd4M/exec',
  pricing:  'https://script.google.com/macros/s/AKfycbz11yUbrix4F1lE_GbiAFqE3EClGpoRvAb19LoLoABQX_Xo3i2U25jlQpOFcN9S_yLC/exec'
};

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

// رابط مدرسة قصير احترافي: yemenschoolz.com/<slug> (مسار بعد الدومين، لا نطاق فرعي قبله —
// قرار مالك صريح 2026-07-28، يُلغي أي حاجة لسجلّ DNS فرعي/Workers Route خارجي؛ يعمل فوراً عبر
// مسار خدمة الموقع الثابت أدناه بلا أي إعداد Cloudflare إضافي). أي قطعة مسار واحدة فقط (بلا
// امتداد ملف، بلا مسار إضافي بعدها) وليست من الأسماء المحجوزة أدناه تُعامَل كـslug مدرسة.
var _RESERVED_TOP_PATHS = {
  'home': 1, 'home-all-school': 1, 'teacher': 1, 'student': 1, 'cms': 1, 'schedule': 1,
  'master-admin': 1, 'pricing': 1, 'gas': 1, 'qr-img': 1, 'qr-download': 1, 'oauth': 1,
  'drive-upload': 1, 'media': 1, 'assets': 1, 'index.html': 1, 'manifest.webmanifest': 1,
  'sw.js': 1, 'robots.txt': 1, 'sitemap.xml': 1, 'favicon.ico': 1
};
function _schoolSlugFromPath(path) {
  var m = /^\/([a-z0-9-]+)\/?$/i.exec(path);
  if (!m) return '';
  var seg = m[1].toLowerCase();
  if (_RESERVED_TOP_PATHS[seg]) return '';
  return seg;
}

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    var path = url.pathname;

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
        _bhHeld = await _bhAcquire(app, _bhMode === 'shadow' ? 0 : BH_MAX_WAIT_MS);
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
          await new Promise(function (r) { setTimeout(r, delays[attempt]); });
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
    // رابط مدرسة قصير (yemenschoolz.com/<slug>): يُعاد كتابته إلى **`/home/index.html`**
    // منذ 2026-08-07 (بند 104) — بدل `home-all-school`. السبب: قرار مالك بأن تكون صفحة كل
    // مدرسة **نفس تصميم `/home/index.html` بالضبط**، والمطابقة الحقيقية أن يخدمهما ملف واحد
    // لا أن يُصان تصميمان متطابقان يدوياً. `home` صار متعدّد المستأجرين بالكامل
    // (‏`getHomePageBundle` + مسار المشاركة/OG) في school-app-yemen-gas #916→#931.
    // فحص _schoolSlugFromPath يستبعد كل الأسماء المحجوزة فلا يتعارض مع أي مسار قائم. لا نداء
    // GAS للتحقّق من وجود المدرسة هنا — slug غير حقيقي يُرجِع `not_found` خادمياً لا عطلاً.
    // ⚠️ لا حقن ?school= في المسار (كان بلا فائدة): إعادة الكتابة تخصّ الجلب الداخلي من
    // GitHub Pages فقط؛ `location.search` بالمتصفّح يبقى كما طلبه الزائر. لذلك
    // `home/Index.html::__hasPathSlug()` تقرأ `location.pathname` مباشرةً.
    // 🔴 لكن حقن OG أدناه **يحتاج** المعرّف صراحةً — فيُلتقَط هنا **قبل** إعادة الكتابة،
    // وإلّا صار `?school=` فارغاً بعدها فتُعرَض معاينة مدرسة المالك لكل مدرسة.
    var _pathSlug = _schoolSlugFromPath(path);
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
          return new HTMLRewriter()
            .on('meta[property="og:title"]', new _AttrSet('content', _og.title))
            .on('meta[property="og:description"]', new _AttrSet('content', _og.description))
            .on('meta[property="og:image"]', new _AttrSet('content', _og.image))
            .on('meta[name="twitter:image"]', new _AttrSet('content', _og.image))
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

    return new Response(ghResp.body, {
      status: ghResp.status,
      statusText: ghResp.statusText,
      headers: headers
    });
  }
};

// build: re-trigger v2
