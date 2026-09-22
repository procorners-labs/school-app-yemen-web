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
  // ⚠️ هذه القيمة **لم تعد وجهةَ `/gas/student`** منذ ص6 — انظر التحويل أسفل الجدول مباشرةً.
  // 🔴 **ولم تعد مسارَ تراجعٍ أيضاً — قِيس 2026-09-19:** مشروعُ `student` **غيرُ موجودٍ في Drive**
  //    (جلسة `SchoolApp-gas` بقراءة بيانات Drive). ⇒ **لا يُعاد `GAS.student` إلى هذه القيمة بحال**:
  //    ذلك يكسر منصّة الطالب كلَّها. والمعرّفُ يبقى **سجلاً** لا مساراً (سياسةُ المعرّفات).
  // 🗑️ **و`pricing` تقاعد 2026-09-10** بقرار المالك: **معالجُ `/pricing` حُذف** من هذا
  //    الملفّ (انظر شاهدةَ القبر في موضعه)، **ومعرّفُه أدناه بقي كما هو ولم يُمسّ.**
  // 🔴 ولماذا بقي — سببان، والثاني منهما وقع فعلاً:
  //    ① ‏(`student` و`schedule` مشروعاهما **غيرُ موجودَين** منذ قياس 2026-09-19 — فوصفُ «حيّةٌ
  //       خاملة» صار يخصّ `pricing` وحدَه، ومشروعُه قائم.) **النشرةُ تبقى حيّةً خاملةً مسارَ تراجع**، ولا
  //       `clasp undeploy` بحال. وهذا الجدولُ **سجلُّ معرّفاتِ نشرٍ لا قائمةُ مساراتٍ فاعلة**.
  //    ② 🔴 **وحاولتُ حذفَ السطر فحجبه `protect-deploy-ids`** — يقرأ **مجموعةَ** المعرّفات
  //       ولا يميّز «إسقاطَ مدخلٍ خامل» من «تغييرِ معرّفٍ حيّ**، ونصُّه: إن كان مقصوداً فهو
  //       **قرارُ مالكٍ صريحٌ يُنفَّذ بتعطيل الحارس لا بالالتفاف عليه**. ⇒ **لم يُتجاوَز.**
  //    ⚠️ وأثرُ بقائه صفرٌ: **صفرُ قارئٍ لـ`GAS.pricing` بعد حذف المعالج** — يحرسه فحصٌ.
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
//   (١) قيمته الأصلية **كانت** مسارَ التراجع الفوري (2026-08-19). 🔴 **وبطَل ذلك — قِيس 2026-09-19:
//       مشروعُ `student` غيرُ موجودٍ في Drive** ⇒ لا تراجعَ إليه، و**هذا السطرُ دائمٌ لا مؤقّت**.
//       والمعرّفُ يبقى في الجدول سجلاً فقط (`clasp undeploy` ممنوع — المعرّف لا يعود إن حُذف).
//   (٢) `student: GAS.teacher` **داخل** الحرفيّة نفسها لا يعمل أصلاً: `GAS` لم يُسنَد
//       بعد وقت تقييم الحرفيّة ⇒ `undefined` ⇒ «تطبيق غير معروف» على كل نداء.
//
//  ⚠️ ولا يكفي تبديلُ الوجهة وحده: معالج `/gas/<app>` يبني الهدف بـ`target + url.search`،
//     فنداءٌ عارٍ يصل `doGet` المعلّم **بلا مُميِّز** فيخدم لوحة المعلّم بدل صفحة الطالب.
//     المُميِّزُ `app=student` يُلحَق في المعالج **للمدخل `student` وحده** — انظر
//     `fullTarget` أدناه، وقارئه `teacher/TeacherCore.js::doGet`.
GAS.student = GAS.teacher;

/* 🗑️ تطبيقاتٌ متقاعدةٌ مشروعُها غيرُ موجود — `/gas/<app>` يردّ 410 بلا نداءٍ على Google (انظر المعالج).
   القيمةُ بديلُ المستخدم نصّاً. ⚠️ **لا يُضاف اسمٌ هنا إلا بقياسين:** المشروعُ غيرُ موجود فعلاً،
   وصفرُ مستهلكٍ عبر الوسيط. (`pricing` و`home-all-school` مشروعاهما قائمان ⇒ ليسا هنا.) */
var _RETIRED_GAS_APPS = {
  schedule: 'الجدول صار داخل منصّة المعلّم'
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
//
//  🟢 **والقياس تمّ وحكمُه صريح (‏2026-08-26).** سجلّات وضع الظلّ بعد إصلاح تسرّب المقاعد
//  (فالعدّاد صادق): `median(n)=7 · p95=30 · p99=83 · max=87 · min=0`. أي أن **عاملاً واحداً**
//  يتجاوز حصّة الحساب كلَّها (٣٠) عند p95 ويبلغ ثلاثة أضعافها عند p99 — مقابل عتبة ~12
//  المكتوبة أعلاه. ⇒ الظلُّ انتهى، والوضع الحيّ صار `on` (‏`wrangler.jsonc`).
//  والأثر المقيس الذي دفع إليه: **٢٨٫٨٪ من نداءات `/gas/*` كانت تردّ 502** — كلُّها عند
//  `wallTimeMs ≈ 23,700` (استنفادُ الميزانية) وعلى teacher وstudent وhome في اللحظة نفسها.
var BH_ISO_GLOBAL  = 8;      // أقصى تزامن نحو GAS داخل عامل واحد (كل التطبيقات)
var BH_ISO_APP     = 5;      // سقف فرعي لكل تطبيق داخل عامل واحد (منع الاحتكار)
// 🔴 ولا ثابتَ ثالثاً لأقصى انتظار: كان `BH_MAX_WAIT_MS = 8000` معرَّفاً هنا **ولا يُقرأ في
// أيّ موضعٍ تنفيذيّ** (الانتظار الفعلي من `_bhWaitMs()` أدناه، و`BH_LOGIN_WAIT_MS` للدخول).
// ثابتٌ ميّتٌ يُقرأ كسياسةٍ سارية هو بالضبط ما يجعل تعديلَه بلا أثر — حُذف 2026-08-26.

// ── عمرُ المقعد: استردادٌ ذاتيّ بدل الثقة بـ`finally` (‏2026-08-26) ──────────────
//
// 🔴 **العلّة المقيسة — عدّادٌ يتسرّب، لا تزامنٌ حقيقيّ.** سجلّات ٢٤ ساعة أعطت
// `p99(n) = 103` و`max = 109` بينما السقف ٨. والضابط الحاسم كان **أدنى** قيمة لا أقصاها:
// في نافذة 18:00–21:12 تناوب `min(n)` بين `1` (عوامل جديدة) وأرضيةٍ **تصعد ولا تنزل**:
// ‏82 → 87 → 89 → 90 → 91 → 98 → 99 — وفي دلوٍ فيه **حدثان اثنان** خلال ٤٠ ثانية بقي `n`
// عند ٩٠. ثم انهارت الأرضية إلى صفر عند 21:20 حين مات العامل. شكلُ **سقّاطة** لا شكلُ حمل:
// التزامن الحقيقيّ يتذبذب صعوداً وهبوطاً؛ هذا يصعد فقط ولا يُصفَّر إلا بموت العامل.
//
// **ولماذا لم يكشفه تدقيق الكود:** المواضع الأربعة كلّها تُحرّر في `finally` وهي صحيحةٌ
// نصّياً — لكنّ `finally` **ليس مضموناً** في Workers حين يُلغى تنفيذُ الطلب (انقطاعُ العميل
// قبل أن يردّ الخادم). وبانتظارٍ يبلغ ٢٤ ثانية على شبكةٍ يمنية، القطعُ حالةٌ شائعة لا نادرة
// ⇒ كلّ طلبٍ مقطوع يترك مقعداً محجوزاً للأبد.
//
// 🔴 **والأثر حيٌّ الآن لا مستقبليّ:** `_bhCan` تقارن العدّاد المتضخّم بالسقف فتُرجِع `false`
// دائماً في العامل المعمَّر ⇒ ثلاثة مسارات مبنيّة على «افتحْ الآن أو تخطَّ» تُتخطّى **دائماً**
// في الذروة: تحديثُ سجلّ الـslug · `_brandRefresh` · وحقنُ OG. أي أن هوية المدرسة وبطاقة
// معاينة واتساب تتوقّفان عن التحديث تحت الحمل، بصمتٍ تامّ.
//
// **العلاج: المقعد يحمل عمراً ويُستردّ بذاته.** أيّ مقعدٍ تجاوز `BH_SEAT_TTL_MS` يُسترجَع
// عند أوّل فحصٍ أو تحرير. والقيمة = ميزانية الوسيط الكاملة (24,000) + هامشٌ للإفلات من
// السباق ⇒ **لا يُسترَدّ مقعدٌ لطلبٍ ما يزال حيّاً**: الطلب مقتولٌ بالمهلة قبلها حتماً.
// ⇒ العدّاد يعود مقياساً صادقاً للتزامن، والحماية تصير قابلةً للتفعيل أصلاً.
var BH_SEAT_TTL_MS = 30000;

// ── جِتَر على مهلة الانتظار (‏2026-08-21) ──────────────────────────────────────
// 🔴 تصادفٌ مقيس: `BH_MAX_WAIT_MS = 8000` كان **يساوي بالضبط** مؤقّت إفراجٍ عميليّ
// (`BOOT_SCHEMA_RELEASE_MS = 8000` في منصّة المعلم) ⇒ لحظةُ رفض الطابور بـ503 هي نفس
// لحظة إطلاق نداءٍ إضافي، فيلتقي بخانقٍ امتلأ للتوّ. عولج الجذرُ عميلياً (بند 169:
// العضو ينضمّ للحزمة الطائرة)، ويبقى الجِتَر لأيّ مؤقّتٍ ثابتٍ آخر — عميلٍ قديم في
// كاش، أو تطبيق أندرويد لا يُحدَّث، أو مؤقّتٍ يُضاف لاحقاً بلا انتباه.
// ±1 ثانية حول 8,000 يفكّ الرنين بصفر كلفة وبلا تغيير في أسوأ زمن.
// ⚠️ **وهذه هي مهلةُ الطابور الفعليّة الوحيدة** لغير الدخول — لا ثابتَ آخر يحكمها.
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
// **أسوأ زمن — يُقرأ من الحارس لا يُحسب هنا:** الانتظارُ **مخصومٌ** من الميزانية
// (`TOTAL_BUDGET_MS = 24000 - _bhWaited` أدناه) ومهلةُ المحاولة **ما تبقّى منها**
// (‏`_gasAttemptPlan`) ⇒ الزمنُ الكلّي **واحدٌ مهما بلغ الانتظار**: ‏24,000 ناقصَ
// `GAS_ATTEMPT_MARGIN_MS` = **23,700ms**، تحت `_LOGIN_TIMEOUT = 28000` العميلي
// (‏#1201) بهامش **4,300ms**.
// 🔴 والرقمان **لا يُكتبان يدوياً بلا مصدرٍ يُشتقّان منه** (فئة بند 83-ب): يطبعهما
// `node worker/test-routes.js` مقيسَين بمحاكاة الحلقة نفسها بثوابتها المقروءة من
// المصدر — فإن تغيّر ثابتٌ لاحقاً **حمِرَ الحارسُ** ولم يتقادم هذا السطر بصمت.
// ⚠️ وكان التعليق حتى 2026-08-31 يقول ‏«12,000 + 11,500 = 23.5ث بهامش 4.5ث» — وهو
// اشتقاقٌ من `PER_ATTEMPT_TIMEOUT_MS` الذي **حُذف** في `web#150`، لا من كودٍ قائم.
// ⚠️ وكان **24.2ث** حتى رصدَت المراجعةُ أنّ `delays[0] = 700ms` يُنفَّذ بلا قصٍّ على
// الميزانية المتبقّية؛ صار مقصوصاً أدناه فعاد الرقم مطابقاً لما يقوله الحارس.
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

/* ══════════════════════════════════════════════════════════════════════════════
   خطّةُ محاولةِ GAS — ميزانيةٌ متبقّية لا ثابتٌ أعمى · ولا إعادةَ محاولةٍ على المهلة
   ══════════════════════════════════════════════════════════════════════════════
   🔴 **الجذرُ المقيس 2026-08-29** (‏`curl` ×٣ على `/gas/teacher?action=health`):

     | المحاولة |    الزمن   | النتيجة                                    |
     |---------|------------|--------------------------------------------|
     |    ١    | 24,339ms   | **502** · الجسم `AbortError`               |
     |    ٢    | 20,958ms   | 200 (‏`cached:true`) — أي أنّه **كان سينجح** |
     |    ٣    |  7,159ms   | 200                                        |

   والحساب القديم يطابق الرقم حرفياً: ‏11,500 × ٢ + 700 = **23,700ms**.

   🔴 **والعلّة أن `PER_ATTEMPT_TIMEOUT_MS = 11500` كانت ثابتةً وأدنى من زمن GAS تحت
   الضغط.** حين يستغرق GAS أكثر منها تُجهَض المحاولة الأولى — **لكنّ إجهاضَ `fetch`
   يقطع الاتصال لا التنفيذ: سكربتُ Apps Script يمضي إلى نهايته على الخادم.** فالمحاولة
   الثانية تفتح تنفيذاً **ثانياً** على نفس الحصّة (٣٠ تنفيذاً متزامناً/حساب) ⇒ إعادةُ
   المحاولة **تضاعف استهلاك الحصّة في لحظة الإشباع بعينها**، وتحوّل استجابةً بطيئةً
   كانت ستنجح إلى 502. وهو حرفياً بند 128: «إعادةُ المحاولة على إشباعٍ تُسيئه لا تُصلحه».

   🟢 **والعلاج شقّان — ولا يُطيلان أسوأ زمنٍ بمللي‑ثانية واحدة:**
   ① مهلةُ المحاولة = **ما تبقّى من الميزانية** لا ثابت ⇒ الاستجابة البطيئة الناجحة
      (‏المقيسة 21.0s) تصل في محاولةٍ واحدة بدل أن تُجهَض عند 11.5s.
   ② فشلُ المهلة **لا يُعيد المحاولة** ⇒ تنفيذٌ واحد لا اثنان تحت الإشباع.
      وفشلُ النقل السريع (‏شبكة · إعادةُ تعيين) **ما زال** يُعيدها — وهو ما كانت
      `delays = [700]` مكتوبةً له أصلاً.

   ⚠️ والسقفُ الكلّي `24,000ms` **لم يتغيّر**: `_gasAttemptPlan` يرفض بدءَ محاولةٍ لا
   تنتهي داخله، وهو نفسُ الضمان الاستشرافي المضاف 2026-08-26.

   🔴 ودالّتان **نقيّتان على المستوى الأعلى عمداً** لا منطقاً مدفوناً في الحلقة —
   كي يستخرجهما `worker/test-routes.js` بـ`vm` ويقيسهما، وغيابُهما هناك **أحمر** لا
   تخطٍّ صامت (نفسُ نمط `_schoolSlugFromPath` و`_DEEP_PORTAL_RE`).                */

// أقلُّ زمنٍ يستحقّ فتحَ تنفيذٍ على حصّة GAS. أدنى منه: الطلبُ يُستهلك مقعداً ثمّ يُجهَض
// على أي حال — استهلاكٌ صافٍ بلا احتمال نجاح.
var GAS_MIN_ATTEMPT_MS = 2000;
// هامشُ إرجاعِ الاستجابة إلى العميل داخل السقف (قراءةُ الجسم + بناءُ الردّ).
var GAS_ATTEMPT_MARGIN_MS = 300;
// محاولتان كحدٍّ أقصى — كما كانت. الجديدُ **متى** تُستعمل الثانية، لا عددُها.
var GAS_MAX_ATTEMPTS = 2;

/* ── قياسُ الظلّ: «كم كان سيستغرق لو لم نقطعه؟» (‏2026-09-22) ────────────────────
   🎯 **السؤالُ الذي لا يجيب عنه أيُّ سجلٍّ قائم.** `abort_budget` = **٣٢٫٤٪** من كلّ
   النداءات (‏613/1,890 في ٢٤س) وكلُّها عند **25,700** بالضبط — **لأننا نقتلها هناك**،
   فلا نعرف أيُّها كان سينجح لو أُمهل. وبلا هذا الرقم يبقى رفعُ السقف تخميناً.

   🔒 **ومشروعيّتُه مكتوبةٌ في هذا الملفّ سلفاً** (‏تعليقُ `_gasShouldRetry` أعلاه وكتلةُ
   الخروج على المهلة أدناه): **«تنفيذُ GAS ما زال جارياً على الخادم»** ⇒ الإجهاضُ
   **لا يوقف العملَ عند Google أصلاً** ⇒ تركُ الاتّصال مفتوحاً **صفرُ حِملٍ إضافيٍّ على
   الحصّة**، وكلُّ ثمنه اتّصالٌ صادرٌ يبقى مفتوحاً في العامل.
   🔴 **ولذلك لا يُنسَخ النداءُ ولا يُعاد** — نداءٌ ثانٍ كان سيُضاعف الاستهلاك فعلاً.

   🔴 **وصفرُ تغيّرٍ فيما يراه المستخدم:** الردُّ يبقى 502 في موعده تماماً (‏`timedOut`
   يُرفع كما هو، و`_bhWhy` يبقى `abort_budget`، والمقعدُ يُحرَّر في موعده). الظلُّ يعيش
   في `ctx.waitUntil` وحدَه — **خارج مسار الاستجابة وخارج حساب المنظّم**، وإلّا قِسنا
   أثرَ قياسِنا. وضابطُ عدمِ الانزياح: `median(ms | why='abort_budget')` يبقى **25,700**. */
/* 🔴 **رمزٌ فريدٌ لا قيمةٌ سحريّة:** السباقُ أدناه يفرّق بين «وصل الردّ» و«انتهت المهلة»
   بالهويّة (`===`) — ونصٌّ أو `null` كان يلتبس بردٍّ مشروع. */
var _SHADOW_TIMEOUT = { shadowTimeout: true };
/* 🔴 **١٫٠ بقرار المالك (‏2026-09-22 مساءً) — والعلّةُ عدديّةٌ لا تفضيل:** ٦٢ إجهاضاً
   يوميّاً على `loginStudent` × ٠٫٢ = **~١٢ عيّنة** ⇒ حكمٌ على دالّةٍ بعينها يحتاج
   **٢–٥ أيّام**. وبـ١٫٠ يُحسَم خلال ساعات.
   ⚠️ **وثمنُه يُقال:** كلُّ نداءٍ مُجهَضٍ يترك اتّصالاً صادراً مفتوحاً حتى `SHADOW_CAP_MS`.
   🟢 **وصفرُ حِملٍ إضافيٍّ على حصّة Google** — العملُ جارٍ هناك أصلاً سواءٌ قطعناه أم لا
   (‏`_gasShouldRetry` أدناه)، فالثمنُ موردُ العامل وحدَه.
   🔒 **والتراجعُ متغيّرُ بيئةٍ لا نشرةُ كود:** `SHADOW_ABORT` ⇒ أيُّ قيمةٍ غير `on`. */
var SHADOW_SAMPLE  = 1.0;     // نسبةُ المسح
var SHADOW_CAP_MS  = 55000;   // سقفُ الظلّ من بدء المحاولة: تحت `xhr.timeout = 60000`
                              // العميليّ، وبعيدٌ عن جدار الحافّة (~100ث).
/* 🔴 **fail-closed: مطفأٌ ما لم يُعلَن `on` صراحةً.** `BULKHEAD_MODE` افتراضُه `on` لأنه
   حمايةٌ يُخشى غيابُها؛ وهذا **قياسٌ** يُخشى بقاؤه ⇒ الافتراضان متعاكسان بحقّ. */
function _shadowOn(env) {
  try { return !!(env && String(env.SHADOW_ABORT || '').toLowerCase() === 'on'); }
  catch (e) { return false; }
}

/** يراقب وعدَ `fetch` الذي تركناه حيّاً ويسجّل متى اكتمل فعلاً. يُستدعى من
 *  `ctx.waitUntil` حصراً. 🔴 ولا يرمي أبداً — سطرُ سجلٍّ لا يُفشل طلباً. */
function _shadowWatch(p, controller, startedAt, app, fn, budgetMs) {
  var capped = false;
  var capIn = Math.max(1000, SHADOW_CAP_MS - budgetMs);
  var capTimer = setTimeout(function () { capped = true; try { controller.abort(); } catch (e) {} }, capIn);
  function done(st, ok, why, srv, len) {
    clearTimeout(capTimer);
    _bhLog({ ev: 'gasshadow', app: app, fn: fn,
             shadowMs: Date.now() - startedAt, budget: budgetMs,
             st: st, ok: ok, why: why, srv: srv, len: len });
  }
  return p.then(function (r) {
    /* 🔴 **الجسمُ يُقرأ هنا، ولولا قراءتُه لكان الظلُّ نصفَ قياس.** `srv` (‏`_ms`) يعيش
       في ذيل الجسم، **والنداءُ الذي نقتله لا جسمَ له** ⇒ `srv = -1` في كلّ صفوف
       `abort_budget`. ⇒ **الذيلُ البطيءُ غائبٌ عن كلّ متوسّطاتنا** (‏تغطيةُ `srv` على
       `loginStudent` = **٦٠٫٩٪** مقيسةً)، وهو بعينه ما نريد الحكمَ عليه.
       🎯 **وبه وحدَه يُفصَل «شغلٌ ثقيل» عن «انتظارٌ طويل» — وعلاجُهما متعاكس:**
       الأوّلُ يُرشَّق، والثاني **لا تُصلحه إعادةُ كتابةٍ إطلاقاً.**
       🔒 **ونفسُ منطق المسار الرئيس حرفياً** (`_bhSrv` أدناه) — لا يُعاد اختراعُه:
       الحقلُ آخرُ خاصيّةٍ في الكائن دائماً، فيكفي مسحُ ذيل النصّ بلا `JSON.parse`.
       🔒 **وصفرُ بايتٍ من الجسم يدخل السجلّ** — الطولُ والرقمُ فقط، كقاعدة `ev:'gas'`. */
    return r.text().then(function (t) {
      var srv = -1;
      try {
        var m = /"_ms":(\d+)/.exec(String(t).slice(-80));
        if (m) srv = +m[1];
      } catch (e) { /* لا نُفشِل سطرَ سجلٍّ بسبب جسمٍ شاذّ */ }
      done(r.status, r.status >= 200 && r.status < 400, 'done',
           srv, (typeof t === 'string') ? t.length : -1);
    }, function () {
      /* الردُّ وصل ثمّ تعذّرت قراءةُ جسمه (‏قطعٌ أثناء البثّ · أو إجهاضُ السقف أثناء
         القراءة) — **حالةٌ مستقلّةٌ عن `err`**: نعرف أنه وصل ولا نعرف محتواه. */
      done(r.status, false, capped ? 'cap' : 'bodyerr', -1, -1);
    });
  }).catch(function () { done(0, false, capped ? 'cap' : 'err', -1, -1); });
}

/** خطّةُ المحاولة التالية من الميزانية المتبقّية.
 *  @returns {{go:boolean, timeoutMs:number}} — `go:false` يعني: لا تبدأ، اخرج بآخر نتيجة. */
function _gasAttemptPlan(elapsedMs, budgetMs) {
  var t = budgetMs - elapsedMs - GAS_ATTEMPT_MARGIN_MS;
  if (t < GAS_MIN_ATTEMPT_MS) return { go: false, timeoutMs: 0 };
  return { go: true, timeoutMs: t };
}

/** هل تُعاد المحاولة؟ 🔴 **لا** على فشل المهلة — تنفيذُ GAS ما زال جارياً، وإعادتُها
 *  تفتح تنفيذاً ثانياً على حصّةٍ مشبَعة أصلاً. 🟢 **نعم** على فشل النقل السريع. */
function _gasShouldRetry(timedOut, attempt, maxAttempts) {
  if (timedOut) return false;
  return attempt < (maxAttempts - 1);
}

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

// المقاعد المحجوزة بأعمارها — مصدرُ الحقيقة للاسترداد الذاتيّ. العدّادان `_bhN`/`_bhApp`
// يبقيان كما هما (مسارٌ ساخن يُقرأ كثيراً)، ويظلّان **مشتقَّين** من هذه القائمة حرفياً.
var _bhSeats  = [];          // [{ app, at }] بترتيب الحجز
var _bhReaped = 0;           // عدّادٌ تراكميّ للمقاعد المستردّة — يُصدَّر في السجلّ

/** يستردّ كل مقعدٍ تجاوز عمرُه `BH_SEAT_TTL_MS`. رخيصٌ: القائمة مرتَّبةٌ زمنياً فنقف عند أوّل حيّ. */
function _bhReap() {
  var now = Date.now();
  while (_bhSeats.length && (now - _bhSeats[0].at) > BH_SEAT_TTL_MS) {
    var s = _bhSeats.shift();
    if (_bhN > 0) _bhN--;
    if (_bhApp[s.app] > 0) _bhApp[s.app]--;
    _bhReaped++;
  }
}

function _bhCan(app) {
  _bhReap();
  return _bhN < BH_ISO_GLOBAL && (_bhApp[app] || 0) < BH_ISO_APP;
}
/** يحجز مقعداً **ويُعيد كائنه** — المُستدعي يحمله ويُعيده بعينه إلى `_bhRelease`. */
function _bhTake(app) {
  _bhN++;
  _bhApp[app] = (_bhApp[app] || 0) + 1;
  var seat = { app: app, at: Date.now() };
  _bhSeats.push(seat);
  return seat;
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
      _bhQ.splice(i, 1); clearTimeout(w.timer); w.resolve(null); continue;
    }
    if (!_bhCan(w.app)) {
      if (_bhN >= BH_ISO_GLOBAL) break;             // السقف العالمي ⇒ لا فائدة من المتابعة
      i++; continue;                                // سقف فرعي ⇒ تجاوز إلى من خلفه
    }
    _bhQ.splice(i, 1); clearTimeout(w.timer); w.resolve(_bhTake(w.app));
  }
}

// يُرجِع `Promise<seat|null>` — كائنُ المقعد عند النجاح، و`null` عند الإخفاق. الصدقُ
// المنطقيّ للقيمة يبقى كما كان (`if (held)`)، ويُضاف إليه أنّ المُستدعي يعرف **أيّ** مقعدٍ
// يملكه فيُعيده بعينه. maxWaitMs = 0 ⇒ وضع «افتحْ الآن أو تخطَّ» بلا انتظار.
function _bhAcquire(app, maxWaitMs) {
  if (_bhCan(app)) return Promise.resolve(_bhTake(app));
  if (!(maxWaitMs > 0)) return Promise.resolve(null);
  return new Promise(function (resolve) {
    var entry = { app: app, resolve: resolve, deadline: Date.now() + maxWaitMs, timer: 0 };
    entry.timer = setTimeout(function () {
      var ix = _bhQ.indexOf(entry);
      if (ix !== -1) { _bhQ.splice(ix, 1); resolve(null); }
    }, maxWaitMs);
    _bhQ.push(entry);
  });
}

// ── التحرير **بهويّة المقعد لا بنوعه** (‏2026-08-26) ──────────────────────────
//
// 🔴 **العلّة التي عالجها هذا:** كان التحرير يُسقِط «أقدم مقعدٍ لهذا التطبيق» ويُنقِص
// العدّادَين بلا شرط. فإذا **حُصد** مقعدُ طلبٍ (‏`_bhReap` أنقص العدّادَين سلفاً) ثمّ عاد
// ذلك الطلب حيّاً ونفّذ `finally`، وقع الإنقاصُ **مرّتين**، وأُسقِط من `_bhSeats` مقعدُ
// طلبٍ **آخرَ ما يزال حيّاً** — فيبدو ذلك الطلب بلا مقعد ويُحصَد أوانه من جديد.
// الاتجاه fail-open: عدّادٌ أقلّ من الحقيقة ⇒ قبولٌ **فوق** السقف. مقبولٌ حين كان
// المنظّم في وضع الظلّ (لا يحكم أصلاً)، **وغيرُ مقبولٍ الآن** وقد صار السقف نافذاً.
//
// ⚠️ ولا يُغني عنه أن `BH_SEAT_TTL_MS = 30000 > TOTAL_BUDGET_MS = 24000`: التعليق داخل
// حلقة إعادة المحاولة أدناه يوثّق أن **زمن اتّباع إعادة توجيه Google غير محسوب** في مهلة
// المحاولة، وأن حارس الميزانية يفحص **بداية** المحاولة لا نهايتها ⇒ ٢٤ ألفاً ليست سقفاً
// صلباً، فحصادُ مقعدٍ حيّ ممكنٌ فعلاً لا نظرياً.
//
// **العلاج:** المُستدعي يحمل كائن مقعده ويُعيده بعينه. لا يوجد ⇒ حُصد سلفاً ⇒ **صفر إنقاص**.
function _bhRelease(seat) {
  if (!seat) return;
  var ix = _bhSeats.indexOf(seat);
  if (ix === -1) { _bhPump(); return; }   // حُصد سلفاً: العدّادان أُنقِصا وقتها
  _bhSeats.splice(ix, 1);
  if (_bhN > 0) _bhN--;
  if (_bhApp[seat.app] > 0) _bhApp[seat.app]--;
  _bhReap();
  _bhPump();
}

// سطر JSON منظّم واحد — قابل للترشيح في Cloudflare Workers Observability.
function _bhLog(o) {
  try {
    // `r` = المقاعد المستردّة تراكمياً في هذا العامل. صعودُه المطّرد **هو** مقياس التسرّب:
    // بلا هذا الحقل يبقى الاسترداد إصلاحاً غير مرئيّ، فلا نعرف هل بقيت العلّة أم زالت.
    if (o && typeof o === 'object' && o.r === undefined) o.r = _bhReaped;
    console.log(JSON.stringify(o));
  } catch (e) { /* لا نُفشِل طلباً بسبب سجلّ */ }
}

/* ═══ وجهةُ أخطاء العميل `/client-err` — دالّتان نقيّتان (‏2026-09-18) ══════════════
   قرارُ المالك (الخطّة المشتركة مع `SchoolApp-gas` · د2): أخطاءُ الواجهة **لا تُرسَل إلى
   GAS** — `reportAppError` نداءُ GAS يقع **عند إشباع GAS تحديداً** ⇒ علاجٌ يغذّي عرضَه
   (كلُّ إخفاقٍ يضيف نداءً إلى الطابور المشبَع). ⇒ الوجهةُ هنا: `console.log` وحده، **صفرُ
   نداءٍ على GAS**، ويُقرأ من Workers Observability بـ`ev:'clienterr'`.
   🔒 **والحقولُ قائمةٌ بيضاءُ لا سوداء:** أيُّ مفتاحٍ خارجها ⇒ رفضُ الطلب كلِّه (لا
      تقليمُه) — فلا يُضخُّ نصٌّ لا نملكه ولا بيانٌ شخصيٌّ يمرّ متخفّياً بحقلٍ جديد.
      **ولا يُسجَّل عنوانُ IP** — يُستعمل للحدّ وحده ثمّ يُترك.
   ⚠️ **وحدُّ معدّل الـisolate ليس حدّاً عالمياً** (نفسُ حدّ المنظّم): يكبح عميلاً واحداً
      يُغرق مثيلاً، ولا يمنع إغراقاً موزَّعاً. والكلفةُ في أسوأ حالاتها سطورُ سجلٍّ لا حصّة GAS. */
var _CE_KEYS  = { app: 1, fn: 1, kind: 1, status: 1, ms: 1, schoolId: 1, page: 1 };
var _CE_APPS  = { home: 1, teacher: 1, student: 1, cms: 1, 'master-admin': 1 };
var _CE_KINDS = { timeout: 1, network: 1, http5xx: 1, js: 1 };
var CE_MAX_BYTES = 2048;
var CE_RATE_WINDOW_MS = 60000;
var CE_RATE_MAX = 30;           // لكلّ IP في الدقيقة داخل المثيل
var CE_RATE_TRACK_MAX = 5000;   // سقفُ الذاكرة: يُفرَّغ السجلّ كلُّه عند بلوغه
var _ceHits = {};
var _ceTracked = 0;

/** مُدخَلٌ خام (كائن JSON) ⇒ سجلٌّ معقَّم، أو `null` = رفض. لا استثناءَ ولا تقليمَ جزئيّ. */
function _clientErrSanitize(o) {
  if (!o || typeof o !== 'object' || Object.prototype.toString.call(o) !== '[object Object]') return null;
  for (var k in o) {
    /* 🔴 `hasOwnProperty` على القائمة لا `!_CE_KEYS[k]`: الوصولُ المباشر يُرجع قيمةً موروثةً
       صادقةً لـ`constructor`/`toString`/… فيتخطّاها الرفض (رصدته مراجعةُ #314). */
    if (Object.prototype.hasOwnProperty.call(o, k) &&
        !Object.prototype.hasOwnProperty.call(_CE_KEYS, k)) return null;
  }
  var app = o.app, kind = o.kind;
  if (typeof app !== 'string' || !Object.prototype.hasOwnProperty.call(_CE_APPS, app)) return null;
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(_CE_KINDS, kind)) return null;
  var fn = (o.fn === undefined || o.fn === '') ? '' : o.fn;
  if (typeof fn !== 'string' || (fn && !/^[A-Za-z0-9_]{1,64}$/.test(fn))) return null;
  var status = (o.status === undefined) ? 0 : o.status;
  if (typeof status !== 'number' || status !== Math.floor(status) || status < 0 || status > 599) return null;
  var ms = (o.ms === undefined) ? 0 : o.ms;
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0 || ms > 600000) return null;
  var sid = (o.schoolId === undefined) ? '' : o.schoolId;
  if (typeof sid !== 'string' || (sid && !_SCHOOL_UUID_RE.test(sid))) return null;
  var page = (o.page === undefined) ? '' : o.page;
  /* 🔒 مسارٌ بلا استعلامٍ ولا جزء — `?`/`#` يحملان توكناتٍ ومعرّفاتٍ في هذه المنصّة. */
  if (typeof page !== 'string' || (page && !/^\/[A-Za-z0-9\/._-]{0,160}$/.test(page))) return null;
  return { ev: 'clienterr', app: app, fn: fn, kind: kind, status: status,
           ms: Math.round(ms), sid: sid.toLowerCase(), page: page };
}

/** `true` = مسموح. نافذةٌ ثابتةٌ لكلّ IP؛ و`now` يُمرَّر ليُختبَر بلا ساعة. */
function _clientErrRate(ip, now) {
  var key = String(ip || '-');
  var h = _ceHits[key];
  if (!h || now - h.t0 >= CE_RATE_WINDOW_MS) {
    if (!h) {
      if (_ceTracked >= CE_RATE_TRACK_MAX) { _ceHits = {}; _ceTracked = 0; }
      _ceTracked++;
    }
    _ceHits[key] = { t0: now, n: 1 };
    return true;
  }
  h.n++;
  return h.n <= CE_RATE_MAX;
}
/* ═══ نهايةُ `/client-err` النقيّة ═══ */

/* ═══ ذيلُ ردّ GAS: `_v` و`_dedup` — للسجلّ وحده (‏2026-09-23) ═══════════════════
   عقدٌ مع جلسة `SchoolApp-gas`: `doPost` يُلحق بجانب `_ms` حقلين:
   · `_v`     = أوّلُ ٧ محارف hex من كوميت المصدر الذي نُشرت منه نشرةُ GAS — **ويغيب كلّياً**
                حين لا يُعرَف (لا نصَّ فارغاً).
   · `_dedup` = `true` على ردٍّ أُعيد من سجلّ منع التكرار **بلا تنفيذٍ ثانٍ**.
   🔒 **حارسٌ بقطبين:** `_v` يُقبل بالشكل `^[0-9a-f]{7}$` حرفياً وإلّا `''` ⇒ **لا نصَّ حرٌّ
   يدخل السجلّ**؛ و`_dedup` هو `true` الحرفيّةُ وحدَها، وكلُّ ما عداها (غيابٌ · `"true"` · `1`)
   ⇒ `false`. والمسحُ على الذيل وحده (الحقولُ آخرُ الكائن بترتيب الإدراج) بلا `JSON.parse`
   على المسار الحارّ — نفسُ نمط `srv`. */
function _gasTailMeta(text) {
  var out = { gv: '', dd: false };
  if (typeof text !== 'string' || !text) return out;
  var tail = text.slice(-160);
  var mv = /"_v":"([0-9a-f]{7})"[,}]/.exec(tail);
  if (mv) out.gv = mv[1];
  if (/"_dedup":true[,}]/.test(tail)) out.dd = true;
  return out;
}

/* ═══ `/dev-stats` — عدّاداتُ صحّة النقل للوحة المطوّر (عقد v1 · 2026-09-23) ═════════
   🎯 **لماذا من الوركر:** سجلُّ `ev:'gas'` يحمل كلَّ إجهاضٍ سلفاً — فالناقصُ سطحُ قراءةٍ لا
   قناةُ تبليغ. والقراءةُ من Workers Observability API ⇒ **صفرُ نداءٍ على GAS وصفرُ تخزينٍ جديد.**
   🔒 **المصادقة:** رأسُ `X-Dev-Stats-Key` يُقارَن بـ`env.DEV_STATS_KEY` مقارنةً ثابتةَ الزمن.
      يُنادى من `UrlFetchApp` في master-admin بعد تحقّقه من دور المطوّر — **لا من متصفّح**
      ⇒ لا CORS. والسرُّ نصفان (Worker Secret + Script Property) يُدخلهما المالكُ بنفسه.
   🔴 **قاعدةُ الفشل:** قسمٌ فشل استعلامُه ⇒ `null` + اسمُه في `missing` — **لا صفرَ أبداً**،
      فالصفرُ الكاذبُ يُقرأ «لا أخطاء». وفشلُ `totals` نفسِه ⇒ 503 بلا جسمٍ جزئيّ. */
var DEV_STATS_WINDOWS = { '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3 };
var DEV_STATS_MIN_N   = 100;
var DEV_STATS_TTL_S   = 300;
var DEV_STATS_TOP_FN  = 40;
var DEV_STATS_SCRIPT  = 'school-teacher-proxy';

function _devStatsWindow(q) {
  var k = (q === null || q === undefined || q === '') ? '24h' : String(q);
  return Object.prototype.hasOwnProperty.call(DEV_STATS_WINDOWS, k) ? { key: k, ms: DEV_STATS_WINDOWS[k] } : null;
}

/* مقارنةٌ ثابتةُ الزمن بالنسبة لمحتوى السرّ: تمرّ على طول السرّ كاملاً دائماً. والسرُّ الغائب
   أو الفارغ ⇒ `false` (fail-closed) — لا يُقبل مفتاحٌ فارغٌ لسرٍّ فارغ. */
function _devStatsKeyOk(given, secret) {
  if (typeof secret !== 'string' || secret.length < 16) return false;
  if (typeof given !== 'string') given = '';
  var diff = given.length ^ secret.length;
  for (var i = 0; i < secret.length; i++) {
    diff |= (given.charCodeAt(i % (given.length || 1)) || 0) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

/* فاصلُ Wilson بثقة 95% لنسبة k/n. n=0 ⇒ `null` (لا نسبةَ بلا مقام). */
function _wilson(k, n) {
  if (!(n > 0)) return null;
  var z = 1.959964, p = k / n, z2 = z * z;
  var den = 1 + z2 / n;
  var mid = (p + z2 / (2 * n)) / den;
  var half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / den;
  function r(x) { return Math.round(Math.max(0, Math.min(1, x)) * 10000) / 10000; }
  return { lo: r(mid - half), hi: r(mid + half) };
}

/* خليّةٌ من عدّادات `why`. `n` = كلُّ الأحداث غير المُسترَدّة — و`dd:true` مُستبعدٌ قبل الوصول هنا. */
function _devStatsCell(c) {
  var ok = c.ok || 0, ab = c.abort_budget || 0;
  var up = (c.upstream_status || 0) + (c.upstream_html || 0);
  /* `transport` = فشلُ `fetch` نفسِه لا انقضاءُ مهلتنا — يُسمّى صراحةً (مراجعة #368)،
     و`other` ما لا اسمَ له ⇒ **مجموعُ الحقول الخمسة = n دائماً**، فلا فئةَ تختبئ في المقام. */
  var tr = c.transport || 0;
  var n = 0;
  for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) n += c[k];
  var w = _wilson(ab, n);
  return { n: n, ok: ok, abort: ab, upstream: up, transport: tr, other: n - ok - ab - up - tr,
           abortRate: n > 0 ? Math.round(ab / n * 10000) / 10000 : null,
           wilsonLo: w ? w.lo : null, wilsonHi: w ? w.hi : null,
           enough: n >= DEV_STATS_MIN_N };
}

/* صفوفُ الـAPI ⇒ `[{g:{key:value}, n}]`. الشكلُ المقيس: `result.calculations[0].aggregates[]`
   كلٌّ بـ`groups:[{key,value}]` و`value` (العدّ). وأيُّ شكلٍ آخر ⇒ استثناءٌ لا مصفوفةٌ فارغة —
   **فالفارغُ يُقرأ «صفرُ أحداث»** وهو ما تمنعه قاعدةُ الفشل. */
function _devStatsRows(apiJson) {
  if (!apiJson || apiJson.success === false) throw new Error('obs_api_error');
  var calc = apiJson.result && apiJson.result.calculations;
  if (!calc || !calc.length || !calc[0] || !calc[0].aggregates) throw new Error('obs_shape');
  var agg = calc[0].aggregates, out = [];
  for (var i = 0; i < agg.length; i++) {
    var g = {}, gs = agg[i].groups || [];
    for (var j = 0; j < gs.length; j++) g[gs[j].key] = gs[j].value;
    out.push({ g: g, n: +agg[i].value || 0 });
  }
  return out;
}

/* يجمع الصفوفَ بمفتاحٍ مشتقّ ⇒ `{key: {why: count}}`، ويُسقط `dd:true` (ليست تنفيذاً) ويعدّها. */
function _devStatsFold(rows, keyFn) {
  var acc = {}, dedup = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.g.dd === true) { dedup += r.n; continue; }
    var k = keyFn(r.g);
    if (k === null) continue;
    var why = (typeof r.g.why === 'string' && r.g.why) ? r.g.why : 'other';
    if (!acc[k]) acc[k] = {};
    acc[k][why] = (acc[k][why] || 0) + r.n;
  }
  return { acc: acc, dedup: dedup };
}

/* 🔴 **لماذا الطرحُ لا التجميعُ بـ`dd` — مقيسٌ على الـAPI الحيّ 2026-09-23:** التجميعُ بحقلٍ
   تفتقده الصفوفُ القديمة (`dd`) أعاد **`aggregates: []` بـ`success:true`** — أي أن الـAPI
   **يُسقط كلَّ صفٍّ لا يحمل الحقلَ بصمت**، فنافذةٌ تعبر لحظةَ إضافته تُقرأ «صفرَ أحداث».
   ⇒ الأبعادُ الموجودةُ في كلّ الصفوف (app · fn · why · النسخة) تُجمَّع **بلا** `dd`، ثمّ يُطرح
   منها استعلامٌ مستقلّ مُفلتَرٌ بـ`dd = true`. والأبعادُ الجديدة (`hr` · `gv`) تُعلن **تغطيتَها**. */
function _devStatsFoldMinus(rows, dedupRows, keyFn) {
  var f = _devStatsFold(rows, keyFn);
  f.subtracted = 0;
  for (var i = 0; dedupRows && i < dedupRows.length; i++) {
    var r = dedupRows[i], k = keyFn(r.g);
    var why = (typeof r.g.why === 'string' && r.g.why) ? r.g.why : 'other';
    if (k === null || !f.acc[k] || !f.acc[k][why]) continue;
    var d = Math.min(f.acc[k][why], r.n);
    f.acc[k][why] -= d;
    f.subtracted += d;
  }
  return f;
}

/* تغطيةُ بُعدٍ جديد: كم من الأحداث حملته (بما فيها المُسترَدّة) من المجموع الخام. */
function _devStatsCoverage(fold, rawN) {
  var s = fold.dedup || 0;
  for (var k in fold.acc) if (Object.prototype.hasOwnProperty.call(fold.acc, k)) {
    for (var w in fold.acc[k]) if (Object.prototype.hasOwnProperty.call(fold.acc[k], w)) s += fold.acc[k][w];
  }
  return { coverage: rawN > 0 ? Math.round(Math.min(1, s / rawN) * 10000) / 10000 : null,
           unbucketedN: Math.max(0, rawN - s) };
}

/* رفضُ المنظّم (503): العددُ وحصّتُه من كلّ ما طُلب (المنفَّذ `gasN` + المرفوض). بلا طرحٍ ولا
   تجميعٍ بـ`why` — الرفضُ لا يبلغ GAS أصلاً. `share` = null حين لا مقام. */
function _devStatsRejected(rows, gasN, top) {
  var n = 0, byApp = {}, byFn = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], a = typeof r.g.app === 'string' ? r.g.app : '', f = typeof r.g.fn === 'string' ? r.g.fn : '';
    n += r.n;
    byApp[a] = (byApp[a] || 0) + r.n;
    byFn[a + '\u0001' + f] = (byFn[a + '\u0001' + f] || 0) + r.n;
  }
  var all = n + (gasN || 0);
  function list(o, mk) {
    var out = [];
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out.push(Object.assign(mk(k), { n: o[k] }));
    return out.sort(function (x, y) { return y.n - x.n; });
  }
  return {
    n: n, share: all > 0 ? Math.round(n / all * 10000) / 10000 : null,
    byApp: list(byApp, function (k) { return { app: k }; }),
    byFn: list(byFn, function (k) { var p = k.split('\u0001'); return { app: p[0], fn: p[1] }; }).slice(0, top)
  };
}

/* ساعةٌ UTC بصيغة السجلّ (`2026-09-22T12`) ⇒ حقولُ العرض بتوقيت اليمن (UTC+3 ثابتٌ بلا توقيتٍ صيفيّ). */
function _devStatsHourYE(hr) {
  var t = Date.parse(hr + ':00:00Z');
  if (isNaN(t)) return null;
  var ye = new Date(t + 3 * 3600e3).toISOString();
  return { hourZ: new Date(t).toISOString().slice(0, 19) + 'Z', hourYE: ye.slice(11, 16), dateYE: ye.slice(0, 10) };
}
/* ═══ نهايةُ `/dev-stats` النقيّة ═══ */

/* يبني جسمَ `/dev-stats` من ستّة استعلاماتٍ متوازية + قائمة النسخ. **ليست نقيّة** (fetch)،
   لكنّ كلَّ تحويلٍ فيها يمرّ بالدوالّ النقيّة أعلاه — وهي المختبَرة. */
async function _devStatsBuild(env, win, now) {
  var from = now - win.ms, to = now;
  var base = 'https://api.cloudflare.com/client/v4/accounts/' + env.CF_ACCOUNT_ID;
  var auth = { 'Authorization': 'Bearer ' + env.CF_OBS_TOKEN, 'Content-Type': 'application/json' };
  function q(ev, groupBys, extra) {
    var filters = [
      { key: '$metadata.service', operation: 'eq', type: 'string', value: DEV_STATS_SCRIPT },
      { key: 'ev', operation: 'eq', type: 'string', value: ev }
    ].concat(extra || []);
    var body = {
      queryId: 'dev-stats', view: 'calculations', chartType: 'aggregate', ignoreSeries: true,
      dry: true, limit: 2000,
      parameters: {
        datasets: ['cloudflare-workers'],
        filters: filters,
        calculations: [{ operator: 'count', alias: 'n' }],
        groupBys: groupBys.map(function (g) { return { type: g[1], value: g[0] }; }),
        limit: 2000
      },
      timeframe: { from: from, to: to }
    };
    return fetch(base + '/workers/observability/telemetry/query',
                 { method: 'POST', headers: auth, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(_devStatsRows);
  }
  var S = 'string', W = ['why', S], D = ['dd', 'boolean'], VER = '$workers.scriptVersion.id';
  var DD_TRUE = [{ key: 'dd', operation: 'eq', type: 'boolean', value: true }];
  var jobs = [
    q('gas', [['app', S], W]),                                // 0 totals · byApp
    q('gas', [['app', S], ['fn', S], W]),                     // 1 byFn
    q('gas', [['hr', S], W, D]),                              // 2 byHour   (بُعدٌ جديد ⇒ تغطية)
    q('gas', [[VER, S], W]),                                  // 3 byVersion
    q('gas', [['gv', S], W, D]),                              // 4 byGasV   (بُعدٌ جديد ⇒ تغطية)
    q('clienterr', [['app', S], ['fn', S], ['kind', S]]),     // 5
    fetch(base + '/workers/scripts/' + DEV_STATS_SCRIPT + '/versions', { headers: auth })
      .then(function (r) { return r.json(); }),               // 6 أرقامُ النسخ وتواريخُها
    q('gas', [['app', S], ['fn', S], W, [VER, S]], DD_TRUE),  // 7 المُسترَدّة — تُطرح من 0·1·3
    /* 8 🔴 رفضُ المنظّم (503) — يُسجَّل `ev:'bulkhead'` **قبل** كتلة `ev:'gas'` فلا يبلغها أبداً
       ⇒ بدونه تبدو اللوحةُ سليمةً في ذروة الإشباع بالضبط (مراجعة #368). */
    q('bulkhead', [['app', S], ['fn', S]], [{ key: 'act', operation: 'eq', type: 'string', value: 'reject' }])
  ];
  var res = await Promise.allSettled(jobs);
  function val(i) { return res[i].status === 'fulfilled' ? res[i].value : null; }
  if (!val(0)) return null;                                   // totals ⇒ 503 عند المستدعي

  var missing = [];
  function cells(foldRes, mk) {
    var out = [];
    for (var k in foldRes.acc) if (Object.prototype.hasOwnProperty.call(foldRes.acc, k)) {
      out.push(Object.assign(mk(k), _devStatsCell(foldRes.acc[k])));
    }
    return out;
  }
  var byAbort = function (a, b) { return (b.abort - a.abort) || (b.n - a.n); };
  /* المُسترَدّةُ لا تدخل المقام. وإن فشل استعلامُها ⇒ `dedup:null` والأرقامُ تشملها (يُعلَن في missing). */
  var dRows = val(7);
  if (!dRows) missing.push('dedup');
  var rawN = 0;
  val(0).forEach(function (r) { rawN += r.n; });

  var fT = _devStatsFoldMinus(val(0), dRows, function () { return 'all'; });
  var fA = _devStatsFoldMinus(val(0), dRows, function (g) { return typeof g.app === 'string' ? g.app : ''; });
  var body = {
    v: 1, generatedAt: new Date(now).toISOString().slice(0, 19) + 'Z', cacheAgeS: 0,
    window: { key: win.key, from: new Date(from).toISOString().slice(0, 19) + 'Z',
              to: new Date(to).toISOString().slice(0, 19) + 'Z' },
    tz: { name: 'Asia/Aden', offset: '+03:00' }, minN: DEV_STATS_MIN_N,
    totals: _devStatsCell(fT.acc.all || {}),
    byApp: cells(fA, function (k) { return { app: k }; }).sort(byAbort),
    byFn: null, byHour: null, hourCoverage: null, byVersion: null, byGasV: null, gasVCoverage: null,
    clienterr: null, rejected503: null, dedup: dRows ? { n: fT.subtracted } : null, partial: false, missing: missing
  };

  if (val(1)) {
    var fnKey = function (g) { return (g.app || '') + '\u0001' + (g.fn || ''); };
    body.byFn = cells(_devStatsFoldMinus(val(1), dRows, fnKey),
      function (k) { var p = k.split('\u0001'); return { app: p[0], fn: p[1] }; })
      .sort(byAbort).slice(0, DEV_STATS_TOP_FN);
  } else missing.push('byFn');

  if (val(2)) {
    var fH = _devStatsFold(val(2), function (g) { return (typeof g.hr === 'string' && /^\d{4}-\d\d-\d\dT\d\d$/.test(g.hr)) ? g.hr : null; });
    body.hourCoverage = _devStatsCoverage(fH, rawN);
    body.byHour = cells(fH, function (k) { return _devStatsHourYE(k) || { hourZ: k }; })
      .sort(function (a, b) { return a.hourZ < b.hourZ ? -1 : 1; });
  } else missing.push('byHour');

  if (val(3)) {
    var vmeta = {}, vl = val(6);
    if (vl && vl.result && vl.result.items) {
      vl.result.items.forEach(function (it) {
        vmeta[it.id] = { number: (typeof it.number === 'number') ? it.number : null,
                         createdAt: (it.metadata && it.metadata.created_on) ? String(it.metadata.created_on).slice(0, 19) + 'Z' : null };
      });
    } else missing.push('versionMeta');
    body.byVersion = cells(_devStatsFoldMinus(val(3), dRows, function (g) { return g[VER] || 'unknown'; }),
      function (k) { var m = vmeta[k] || {}; return { id: k.slice(0, 8), number: m.number || null, createdAt: m.createdAt || null }; })
      .sort(function (a, b) { return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1; });
  } else missing.push('byVersion');

  if (val(4)) {
    var fG = _devStatsFold(val(4), function (g) { return (typeof g.gv === 'string' && /^[0-9a-f]{7}$/.test(g.gv)) ? g.gv : 'unknown'; });
    body.gasVCoverage = _devStatsCoverage(fG, rawN);
    body.byGasV = cells(fG, function (k) { return { gasV: k }; }).sort(byAbort);
  } else missing.push('byGasV');

  if (val(8)) {
    body.rejected503 = _devStatsRejected(val(8), body.totals.n, DEV_STATS_TOP_FN);
  } else missing.push('rejected503');

  if (val(5)) {
    body.clienterr = val(5).map(function (r) {
      return { app: r.g.app || '', fn: r.g.fn || '', kind: r.g.kind || '', n: r.n };
    }).sort(function (a, b) { return b.n - a.n; }).slice(0, 60);
  } else missing.push('clienterr');

  body.partial = missing.length > 0;
  return body;
}

/* ═══ حدُّ تسجيل المشاهدات العامّة لكلّ IP (قرار المالك 2026-09-19) ═══════════════
   🔴 **العلّة المقيسة:** `recordPublicNewsView`/`recordPublicNewsViewBatch` عامّتان **بلا
   توكن**، و«رقمُ الزائر» يصنعه العميلُ نفسُه ⇒ سكربتٌ بأرقامٍ عشوائيّةٍ يسجّل حتى 50
   مشاهدةً في النداء، **وكلُّ نداءٍ غيرِ مخبوءٍ يقرأ عمودين كاملين من «اخبار_مشاهدات»**
   التي تنمو بلا حذف ⇒ التضخيمُ يرفع العددَ **ويُبطئ كلَّ تسجيلٍ لاحقٍ** على الحصّة
   المشتركة نفسِها (قِيس: ~1% من مقعد الحصّة اليوم، وكلفتُه تكبر مع حجم الورقة).
   🎯 **يُكبَح هنا قبل الكاش وقبل حجز المقعد** ⇒ صفرُ حصّة GAS لما فوق الحدّ.
   🟢 **والردُّ نجاحٌ صامت** `{ok:true, result:{success:true, throttled:true}}` — `gas-bridge.js`
   يعامل `ok:true` نجاحاً فلا يعيد المحاولة (الفشلُ كان سيضاعف الحِملَ الذي نكبحه).
   ⚠️ **والحدُّ سخيٌّ عمداً (60/دقيقة):** مستخدمو اليمن يتشاركون عناوينَ IP (CGNAT لدى
   المشغّلين)، والصفحةُ الواحدة تُطلق دفعةً واحدةً لا نداءً لكلّ خبر ⇒ ستّون دفعةً في
   الدقيقة من عنوانٍ واحدٍ لا يبلغها استعمالٌ بشريّ. وثمنُ الخطأ مشاهدةٌ لا تُعَدّ، لا بياناتٌ تُفقَد.
   ⚠️ **وحدُّ المثيل ليس حدّاً عالمياً** (نفسُ حدّ `/client-err`): يكبح مُغرِقاً واحداً لا
   إغراقاً موزَّعاً. **ولا يُسجَّل عنوانُ IP.** */
var PV_RATE_WINDOW_MS = 60000;
var PV_RATE_MAX = 60;           // دفعاتُ تسجيلٍ لكلّ IP في الدقيقة داخل المثيل
var PV_RATE_TRACK_MAX = 5000;
var _PV_FNS = { recordPublicNewsView: 1, recordPublicNewsViewBatch: 1 };
var _pvHits = {};
var _pvTracked = 0;

/** `true` = دالّةُ تسجيلِ مشاهدةٍ عامّة (قائمةٌ بيضاءُ بـhasOwnProperty). */
function _isPublicViewFn(fn) {
  return typeof fn === 'string' && Object.prototype.hasOwnProperty.call(_PV_FNS, fn);
}

/* 🔴 **اسمُ الدالّة يُقرأ من الجسم كاملاً بـ`JSON.parse` — لا من نافذة `_bhFn`.**
   `_bhFn` تُستخرج من أوّل 200 حرفٍ بتعبيرٍ نمطيّ لغرض **السجلّ**؛ وتحميلُها قراراً أمنياً
   على مسارٍ عامٍّ يتحكّم المهاجمُ بجسمه كاملاً ثغرةٌ: حقلٌ طويلٌ قبل `"fn"` يُخرجه من
   النافذة فيتخطّى الطلبُ الحدَّ كلّياً (رصدتها مراجعةُ #319). `JSON.parse` يقرأ المفتاحَ
   **كما يقرؤه GAS** (`doPost` يحلّل الجسمَ نفسَه، والمفتاحُ المكرَّر يأخذ آخرَ قيمة في
   الطرفين) ⇒ لا فجوةَ بين ما نكبحه وما يُنفَّذ. وجسمٌ غيرُ JSON ⇒ `''` (لا تسجيلَ فيه أصلاً). */
function _publicViewFnOf(body) {
  try {
    var o = JSON.parse(String(body || ''));
    var fn = (o && typeof o === 'object') ? o.fn : '';
    return _isPublicViewFn(fn) ? fn : '';
  } catch (e) { return ''; }
}

/** `true` = مسموح. نافذةٌ ثابتةٌ لكلّ IP؛ و`now` يُمرَّر ليُختبَر بلا ساعة. */
function _publicViewRate(ip, now) {
  var key = String(ip || '-');
  var h = _pvHits[key];
  if (!h || now - h.t0 >= PV_RATE_WINDOW_MS) {
    if (!h) {
      if (_pvTracked >= PV_RATE_TRACK_MAX) { _pvHits = {}; _pvTracked = 0; }
      _pvTracked++;
    }
    _pvHits[key] = { t0: now, n: 1 };
    return true;
  }
  h.n++;
  return h.n <= PV_RATE_MAX;
}
/* ═══ نهايةُ حدّ المشاهدات العامّة ═══ */

/* ═══ سياسةُ وسيط الفيديو `/media/drive/<fileId>` — دالّتان نقيّتان ═══════════════
   🔴 العلّةُ المقيسة (2026-09-06): `Cache-Control: public, max-age=86400, immutable`
   كان يُلحَق بالردّ **أيّاً كانت حالتُه** ⇒ فشلُ الجلب (فحصُ فيروسات Drive ما زال جارياً
   على ملفٍّ كبيرٍ رُفع للتوّ) يُكاش ٢٤ ساعة، و`immutable` تمنع إعادةَ التحقّق **حتى عند
   التحديث** ⇒ «رفعتُه ولا يعمل، وما زال لا يعمل».
   ⚠️ ونقيّتان عمداً كي يقيسهما `test-routes.js` **سلوكياً** لا بـ`grep` على المصدر. */
var MEDIA_CACHE_OK = 'public, max-age=86400, immutable';
var MEDIA_TIMEOUT_MS = 20000;
function _mediaCacheControl(status) {
  // النجاحُ وحده يُكاش — محتوى الفيديو ثابتٌ لكلّ `fileId` فيُسرَّع إعادةُ التشغيل والتموضع.
  return (status === 200 || status === 206) ? MEDIA_CACHE_OK : 'no-store';
}
function _mediaIsHtml(ct) {
  return String(ct || '').indexOf('text/html') !== -1;
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
  'app': 1, 'download': 1,
  // 'csp-report' — وجهةُ تقارير `Content-Security-Policy-Report-Only` (2026-09-11).
  // 🔴 الحجزُ **ليس دفاعياً هنا بل لازم**: معالجُه يعترض المسارَ قبل حساب الـslug، لكنّ
  //    إسقاطَ الاسم يجعله **مرشَّحَ slug مدرسة** فيصير قابلاً للاختطاف بتسجيل مدرسةٍ
  //    بهذا الاسم ⇒ تُوجَّه تقاريرُ الانتهاك إلى صفحةِ مستأجرٍ بدل أن تُسجَّل.
  //    وهي نفسُ العلّة التي أبقت `'pricing'` محجوزاً بعد حذف معالجه.
  'csp-report': 1,
  // 'client-err' — وجهةُ أخطاء العميل (2026-09-18). **لازمٌ لا دفاعيّ** بنفس علّة 'csp-report':
  //    إسقاطُه يجعله مرشَّحَ slug مدرسةٍ فتُوجَّه تقاريرُ الأخطاء إلى صفحةِ مستأجر.
  'client-err': 1,
  // 'dev-stats' — عدّاداتُ صحّة النقل للوحة المطوّر (2026-09-23). **لازمٌ** بنفس العلّة.
  'dev-stats': 1,
  // 'register' — يُحوَّل إلى صفحة التسجيل (2026-09-19). **لازمٌ لا دفاعيّ**: كان يُقرأ slug
  //    مدرسةٍ فيُكلّف نداءَ GAS ثمّ ٤٠٤، وإسقاطُه يجعله قابلاً للاختطاف بتسجيل مدرسةٍ بالاسم.
  'register': 1
};

/* تحويلاتُ المضيف نفسِه — `Location` نسبيٌّ دائماً (انظر المعالج «1و-ب»).
   🔒 بـ`hasOwnProperty` لا `obj[k]`: مسارٌ مثل `/constructor` يجب ألّا يطابق شيئاً. */
var _SAME_HOST_REDIRECTS = {
  '/pricing': '/#pricing',
  '/register': '/master-admin/register.html'
};
function _sameHostRedirectFor(path) {
  var p = String(path || '');
  if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
  return Object.prototype.hasOwnProperty.call(_SAME_HOST_REDIRECTS, p) ? _SAME_HOST_REDIRECTS[p] : '';
}
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

function _tenantKeyFrom(path, search, dynSlugs) {
  var p = String(path || '');
  var slug = _schoolSlugFromPath(p);
  if (slug) return slug;
  /* بوّابة الشكل الواحدة لكلّ المصادر: slug منشور أو UUID حصراً — وإلّا `''`.
     🟢 **و«منشور» يشمل السجلَّ الديناميكيَّ منذ 2026-09-19** (`dynSlugs` — مصفوفةُ
     `_slugsFromCache`، يمرّرها المستدعي فتبقى الدالّةُ نقيّة). العلّة المقيسة (جلسة
     `SchoolApp-gas`): البذرةُ الساكنة ثلاثُ مدارس ⇒ `/teacher/<slug>` لمدرسةٍ جديدة يُقرأ
     بلا مستأجر فيهبط مديرُها على دخول مدرسةٍ أخرى. 🔒 **والقائمةُ من سجلّ GAS لا من المسار**
     ⇒ أسماءُ الأقسام (`login` · `grades` …) تبقى `''` ما لم تُسجَّل مدرسةٌ باسمها. */
  function norm(v) {
    v = String(v || '').trim();
    if (!v) return '';
    var lc = v.toLowerCase();
    if (_KNOWN_SCHOOL_SLUGS[lc]) return lc;
    if (dynSlugs && dynSlugs.indexOf(lc) !== -1 && /^[a-z0-9-]+$/.test(lc)) return lc;
    if (_SCHOOL_UUID_RE.test(v)) return lc;
    return '';
  }
  /* 🟢 2026-09-03 (قرار المالك: الهوية على السطوح الثلاثة) — المقطعُ الثاني في المسارات
     العميقة لبوّابتَي الدخول: `/teacher/login/<k>` · `/student/<tab>/<k>` (شكل `_DEEP_PORTAL_RE`
     بمقطعين). المقطعُ الأوّل تبويبٌ لا مدرسة، فلا يُقرأ مفتاحاً أبداً. */
  var deep = /^\/(teacher|student)\/[a-z0-9-]+\/([a-z0-9-]+)\/?$/i.exec(p);
  if (deep) return norm(deep[2]);
  /* 🟢 **2026-09-17 (الخطة المشتركة · «نافذةٌ واحدة»):** `/teacher/<slug>` بمقطعٍ واحد.
     كان يُقرأ **تبويباً** فلا مستأجر ⇒ الملفُّ نفسُه بايتاً يُخدَم بلا هوية وتعرض الواجهة
     «اختر مدرستك». 🔒 **ولا يصير كلُّ مقطعٍ مدرسة:** `norm` تقبل slug **منشوراً** أو UUID
     حصراً، فأسماءُ الأقسام (`login` · `visits` · `grades` …) تبقى `''` كما كانت.
     ⚠️ **وحدُّه:** مدرسةٌ يُسجَّل slugها باسم قسم تُقرأ مدرسةً هنا — منعُه عند التسجيل
     (‏`SchoolApp-gas`)، والمُوجِّهُ الأماميّ يجب أن يقرأ المقطعَ بالقاعدة نفسها. */
  var single = /^\/(teacher|student)\/([a-z0-9-]+)\/?$/i.exec(p);
  if (single) return norm(single[2]);
  /* والمعامل الصريح `?school=`/`?schoolId=` على الملفّات الثلاثة التي تقرؤه وتحمل عُقَد
     هوية (‏`/home/index.html` — رابط تطبيق الأندرويد — و`/teacher/index.html` و
     `/student/index.html`) وعلى `/portal` (يُعاد كتابته إلى بوّابة الطالب).
     🔴 الجذر `/home/schools.html` و`/home/news.html` ليسا هنا: هوية الجذر خطّ أحمر (بندا 68/75). */
  if (!/^\/(home|teacher|student)\/index\.html$/i.test(p) && !/^\/portal\/?$/i.test(p)) return '';
  var raw = '';
  try {
    var sp = new URLSearchParams(String(search || ''));
    raw = sp.get('school') || sp.get('schoolId') || '';
  } catch (e) { return ''; }
  return norm(raw);
}

/* السطحُ الذي يُعاد كتابته — يقرّر أيَّ عائلة محدِّدات تُطبَّق في `_brandRewrite`.
   دالّة نقيّة (المسار الخام قبل أيّ إعادة كتابة داخلية) يستخرجها `test-routes.js` بـ`vm`. */
function _brandSurfaceFor(path) {
  var p = String(path || '');
  if (/^\/teacher\//i.test(p)) return 'teacher';
  if (/^\/student\//i.test(p) || /^\/portal\/?$/i.test(p)) return 'student';
  if (/^\/home\/index\.html$/i.test(p) || _schoolSlugFromPath(p)) return 'home';
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
/* 🟢 **صارت بذرةً ساكنة لا مصدرَ حقيقة (2026-08-22).**
   السجلُّ الحيّ يأتي الآن من `home::listPublicSlugsPublic` عبر `_slugsFromCache` أدناه،
   ويُؤخَذ **اتحادُه** مع هذه البذرة. والاعتراضُ أعلاه («ولكلّ زائر») عولج حرفياً: القائمة
   تُخزَّن في `caches.default` فيصير **نداءٌ لكلّ نافذة كاش لا لكلّ زائر**.
   🔴 **ولا تُحذف البذرة:** لو سقط GAS أو أخفق النداء بقيت المدارس الثلاث تعمل —
   **fail-open للمعروف · fail-closed لغيره**. وحذفُها يجعل عطلَ GAS يُسقط الموقع كلَّه. */
/* 🗑️ **حُذف `OWNER_SCHOOL_SLUG` (‏2026-08-26).** كان يُعرَّف هنا **ولا يُقرأ في الملفّ كلّه**
   (مطابقةٌ واحدة، والاختبارُ يُعيد تعريفه في قالب `vm` خاصّته). وبقاؤه كان يُوهم قارئَ
   الملفّ بوجود معاملةٍ خاصّة لمدرسة المالك في الوسيط — وهي غير موجودة هنا أصلاً.
   وكانت البقيّةُ الحيّةُ الأخيرة `isOwner === true` في `_brandRefresh` — **سقطت 2026-09-18**
   بعد سقوط نظيرها `|| OWNER_SCHOOL_ID` من `_build/build-frontend.js` بمستودع الـgas. */
var _KNOWN_SCHOOL_SLUGS = {
  'abdaawatmuaz': 1,
  'ibn-khaldoun': 1,
  'aljil-al-hadith': 1
};

/* ── سجلُّ الـslugs الديناميكيّ ──────────────────────────────────────────────────
   بنيةٌ **منسوخةٌ عن `_brandCacheKey`/`_brandFromCache`/`_brandRefresh` عمداً** — نفس
   `caches.default`، نفس المفتاح داخل الأصل بمسارٍ ثلاثيّ المقاطع (يرفضه
   `_schoolSlugFromPath` فلا يصير سطحاً مخدوماً)، ونفس ضوابط المهلة والـbulkhead.
   **وTTL أقصر (‏٥ د لا ٦ س):** الهويةُ شبه ثابتة، أمّا **مدرسةٌ جديدة فيجب أن تعمل صفحتُها
   خلال دقائق** — وهذا هو الرقم الذي يحوّل «ديناميكيّ» من وصفٍ إلى سلوك. */
var SLUGS_TTL_S = 300;

function _slugsCacheKey(origin) {
  return new Request(origin + '/__slugs-cache/v1/all', { method: 'GET' });
}

/** الوثيقةُ كاملةً: `{slugs:[…], pairs:{slug:uuid}}` — و`pairs` قد تغيب (شكلٌ قديمٌ مخزَّن). */
async function _slugsDocFromCache(origin) {
  try {
    var hit = await caches.default.match(_slugsCacheKey(origin));
    if (!hit) return null;
    var o = await hit.json();
    if (!o || !Array.isArray(o.slugs)) return null;
    return { slugs: o.slugs, pairs: (o.pairs && typeof o.pairs === 'object') ? o.pairs : {} };
  } catch (e) { return null; }
}

async function _slugsFromCache(origin) {
  var doc = await _slugsDocFromCache(origin);
  return doc ? doc.slugs : null;
}

/* 🔴 **حاجبةٌ بالضرورة** خلافاً لـ`_brandRefresh` التي تعمل في `ctx.waitUntil`: القرارُ
   هنا «404 أم صفحة» ولا يُتّخذ قبل معرفة الجواب. ولهذا: مهلةٌ صارمة، وbulkhead يتخطّى عند
   الإشباع (فيسقط على البذرة الساكنة)، وتخزينٌ **حتى للقائمة الفارغة** كي لا يتحوّل عنوانٌ
   مجهولٌ مكرَّر إلى نداءٍ لكلّ زيارة — وهو بالضبط ما كان يُخشى منه. */
async function _slugsRefresh(origin, env) {
  var mode = (env && env.BULKHEAD_MODE) || 'on';
  /* 🔴 **انتظارٌ محدود لا «افتحْ الآن أو تخطَّ» — خلافاً لأختَيها (‏2026-08-26).**
     ‏`_brandRefresh` وحقنُ OG يتخطّيان بلا ضرر: هويةٌ متقادمة أو بطاقةُ معاينةٍ عامّة،
     والصفحة تُخدَم. أمّا هذه فمخرَجُها قرارُ **نشر**: تخطّيها ⇒ `_slugsRefresh` تُرجِع
     `null` ⇒ `_slugIsKnown` تُرجِع `false` ⇒ **صفحةُ المدرسة 404**. ومع تفعيل `on`
     (والمقيسُ `median(n) = 7` مقابل سقفٍ 8) صار الفرعُ المُتخطَّى شائعاً لا نادراً ⇒ كلُّ
     مدرسةٍ خارج البذرة الثلاثية تسقط كلّما انقضت نافذةُ الـ300 ثانية أثناء الذروة —
     نقضٌ مباشر لما بُني في #139: «صفحةُ أيّ مدرسةٍ تعمل بلا نشرِ وسيط».
     ⇒ تنتظر دورَها ثانيتين. والانتظار **لا يحجز مقعد GAS** فلا يزيد الحمل، وثانيتان
     على صفحةٍ تُحمَّل أرخصُ من 404 على مدرسةٍ قائمة بما لا يُقاس. */
  var _slugWait = (mode === 'on') ? 2000 : 0;
  var held = (mode !== 'off') ? await _bhAcquire('home', _slugWait) : null;
  if (mode === 'on' && !held) {
    _bhLog({ ev: 'bulkhead', act: 'skip_slugs', app: 'home', mode: mode, n: _bhN, q: _bhQ.length });
    return null;
  }
  var timer = null;
  try {
    var ab = new AbortController();
    timer = setTimeout(function () { ab.abort(); }, 8000);
    var res = await fetch(GAS.home, {
      method: 'POST',
      signal: ab.signal,
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ fn: 'listPublicSlugsPublic', args: [] })
    });
    var json = await res.json();
    var b = (json && json.result) ? json.result : json;
    if (!b || b.ok !== true || !Array.isArray(b.slugs)) return null;
    var clean = [];
    for (var i = 0; i < b.slugs.length; i++) {
      var s = String(b.slugs[i] || '').toLowerCase();
      /* نفسُ صيغة `_schoolSlugFromPath` — سجلٌّ يحمل قيمةً خارجها لا يمكن أن تُطابَق
         أصلاً، وتخزينُها يُوهم بتغطيةٍ غير قائمة. */
      if (/^[a-z0-9-]+$/.test(s) && !_RESERVED_TOP_PATHS[s]) clean.push(s);
    }
    /* 🟢 **الأزواج (slug ⇒ UUID) — أُضيفت 2026-09-17 مع `home@145`.** نفسُ النداء ونفسُ
       الكاش ⇒ **صفرُ نداءٍ إضافيٍّ على GAS**، وبها يحلّ الوركرُ الاسمَ المختصرَ إلى
       المعرّف القانونيّ على الحافّة. 🔒 وكلُّ طرفٍ يُصفَّى بشكله: الاسمُ بصيغة المسار،
       والمعرّفُ بـ`_SCHOOL_UUID_RE` — فزوجٌ مشوَّهٌ يسقط ولا يُخزَّن.
       ⚠️ **والغيابُ مقبولٌ عمداً:** نشرةُ GAS أقدمُ (أو مدخلٌ مخزَّنٌ بالشكل القديم) ⇒
       `pairs` فارغة ⇒ يبقى المفتاحُ كما وصل. **fail-open: لا هويّةَ خاطئة، وأسوأُ حالةٍ
       سلوكُ الأمس.** */
    var pairs = {};
    var rows = (b && Object.prototype.toString.call(b.schools) === '[object Array]') ? b.schools : [];
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j] || {};
      var rs = String(r.slug || '').toLowerCase();
      var rid = String(r.schoolId || '');
      if (/^[a-z0-9-]+$/.test(rs) && !_RESERVED_TOP_PATHS[rs] && _SCHOOL_UUID_RE.test(rid)) {
        pairs[rs] = rid.toLowerCase();
      }
    }
    await caches.default.put(
      _slugsCacheKey(origin),
      new Response(JSON.stringify({ slugs: clean, pairs: pairs }), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'max-age=' + SLUGS_TTL_S
        }
      })
    );
    return clean;
  } catch (e) {
    return null;          // fail-open نحو البذرة الساكنة
  } finally {
    if (timer) clearTimeout(timer);
    /* 🔴 يُمرَّر **كائن المقعد** لا اسمُ التطبيق: `_bhRelease` تُنقِص العدّادَين فقط إن
       كان المقعد ما يزال في `_bhSeats` — فمقعدٌ حُصد سلفاً لا يُنقَص مرّتين، ولا يُسقِط
       معه مقعدَ طلبٍ آخرَ حيّ. (التفصيل عند تعريف `_bhRelease`.) */
    if (held) _bhRelease(held);
  }
}

/* القرارُ النهائيّ: البذرةُ الساكنة أوّلاً (صفر كلفة)، ثمّ الكاش، ثمّ تحديثٌ **واحد**.
 *
 * 🔴 **سُمّيت `_slugIsPublished` حتى 2026-09-15، وأُعيدت التسميةُ لأن الاسمَ صار يكذب:**
 *    مع بوّابة تسديد الاشتراك صارت `listPublicSlugsPublic` في GAS تُرجع **المدارسَ
 *    المتوقّفةَ أيضاً** (كي يُخدَم رابطُها بصفحة تسديدٍ بدل ٤٠٤) ⇒ **الدالّةُ تُرجع
 *    `true` لمدرسةٍ غيرِ منشورة.** ⇒ **الاسمُ القديم يصف حكماً لم تعد تصدره.**
 * 🎯 **وما تجيب عنه فعلاً: «أهذا الـslug مسجَّلٌ في السجلّ؟» لا «أهو منشور؟»** —
 *    والتمييزُ بين المتوقّفة والنشطة **لا يقع عند الحافّة أصلاً**: كلتاهما تُخدَمان
 *    **نفسَ الملفّ** (`/home/index.html` من GitHub Pages)، و**الحمولةُ تحمل حالةَ
 *    الاشتراك والواجهةُ تقرّر.** ⇒ **ثلاثُ حالاتٍ للمستخدم، وقرارانِ فقط هنا.**
 * ⚠️ **وأُعيدت التسميةُ دفعةً واحدةً في الوركر وحارسه معاً** — والاسمُ الذي يكذب في
 *    نصف المواضع أسوأُ من اسمٍ قديمٍ متّسق. **وحارسُ `test-routes.js` حمرّ فعلاً عند
 *    التسمية قبل تحديثه** (تأكيداتُه نصّيّةٌ على اسم الدالّة) ⇒ **مُثبَتٌ أنه ليس أجوف.**
 */
/* 🎯 **المعرّفُ القانونيُّ واحدٌ في وقت التشغيل (قرارُ مالكٍ 2026-09-17).**
 *
 * الاسمُ المختصرُ **مدخلٌ** يُحَلّ هنا مرّةً واحدةً إلى UUID، وكلُّ ما بعده — مفتاحُ كاش
 * الهويّة، والنداءُ الذي يجلبها، والحمولةُ المحقونة — يعمل بمعرّفٍ واحد. ⇒ **تنتهي
 * الهويّتان** بلا حذفِ سطحٍ عامّ: `/<slug>` وصيغُ App Link في حزمتين منشورتين تبقى كما هي،
 * و`_canonicalFor` يبقى **بالاسم المختصر** عمداً (هو ما نُعلنه للفهرسة).
 * 🟢 **ومكسبٌ مقيسٌ يرافقه:** مدرسةٌ تُفتح مرّةً بالاسم ومرّةً بالمعرّف كانت تُنتج
 * **مدخلَي كاشِ هويّة**؛ بالتوحيد تصير مدخلاً واحداً ⇒ إصابةٌ أعلى وحملٌ أقلّ.
 * 🔒 **ولا نداءَ GAS على المسار الحارّ:** السجلُّ نفسُه المخزَّنُ للـslugs (٣٠٠ث)،
 * وإن غابت الأزواجُ يُرجَع المفتاحُ كما وصل (fail-open).
 */
async function _tenantCanonical(key, origin, env) {
  var k = String(key || '').toLowerCase();
  if (!k || _SCHOOL_UUID_RE.test(k)) return k;
  var doc = await _slugsDocFromCache(origin);
  if (doc && doc.pairs && doc.pairs[k]) return doc.pairs[k];
  /* لا تحديثَ إضافيّاً إن كان السجلُّ حاضراً — التحديثُ لهذه الغاية وحدَها يُدخل نداءً
     على مسارِ صفحةٍ يراها إنسان، وهو ما نتجنّبه قطعاً. */
  if (doc) return k;
  var fresh = await _slugsRefresh(origin, env);
  if (fresh) {
    var d2 = await _slugsDocFromCache(origin);
    if (d2 && d2.pairs && d2.pairs[k]) return d2.pairs[k];
  }
  return k;
}

/* 🟢 **تحديثٌ عند الإخفاق — محكومٌ بزمن (2026-09-19).** كان slugٌ غائبٌ عن قائمةٍ ما زالت
   صالحةً ⇒ 404 **بلا تحديث** حتى ينقضي الـTTL (حتى ٣٠٠ث لكلّ مركز بيانات) ⇒ مدرسةٌ قُبلت
   للتوّ تظهر في الدليل وصفحتُها 404. 🔴 **والتحديثُ غيرُ المحكوم يجعل كلَّ مسارٍ عشوائيٍّ
   بمقطعٍ واحد نداءَ GAS** — وهو بالضبط ما حُمي منه السجلّ. ⇒ تحديثٌ واحدٌ على الأكثر كلَّ
   `SLUGS_MISS_REFRESH_MS` داخل الـisolate: أسوأُ كلفةِ مسحٍ عشوائيٍّ نداءٌ لكلّ نافذة. */
var SLUGS_MISS_REFRESH_MS = 30000;
var _slugsMissRefreshAt = 0;
function _slugsMissRefreshDue(now) {
  if (now - _slugsMissRefreshAt < SLUGS_MISS_REFRESH_MS) return false;
  _slugsMissRefreshAt = now;
  return true;
}

async function _slugIsKnown(slug, origin, env) {
  if (_KNOWN_SCHOOL_SLUGS[slug]) return true;
  var cached = await _slugsFromCache(origin);
  if (cached && cached.indexOf(slug) !== -1) return true;
  if (cached && !_slugsMissRefreshDue(Date.now())) return false;
  var fresh = await _slugsRefresh(origin, env);
  return !!fresh && fresh.indexOf(slug) !== -1;
}

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

/* 🟢 **زواحفُ المعاينة وحدَها تنتظر `getNewsOg` (2026-09-17).**
   وسومُ OG لا يقرؤها إلّا مُولِّدُ بطاقة المشاركة؛ والإنسانُ كان ينتظر نداءَ GAS قبل أن
   يصله بايتٌ واحد — قِيس من هاتف المالك: TTFB لـ`/home/newsarticle.html` **2.7–8.4 ث**،
   فيسبق مهلةَ عامل الخدمة (3.5 ث) فيسقط إلى `/index.html`.
   🔒 **والاتجاهُ الآمن عند الشكّ هو «زاحف»:** UA فارغٌ ⇒ زاحف. خطأُ هذا الاتجاه **نداءُ
   GAS زائدٌ نادر**، وخطأُ عكسه **بطاقةُ مشاركةٍ بلا صورةٍ لا تُصحَّح** (المنصّاتُ تُخزّنها).
   ⚠️ **وحدُّها:** زاحفٌ غيرُ مُدرَجٍ يرى وسومَ الهوية العامّة — نفسُ ما يراه اليومَ حين
   يُتخطّى النداءُ بالمنظّم أو المهلة. */
var _PREVIEW_CRAWLER_RE = /facebookexternalhit|facebot|meta-externalagent|whatsapp|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|googlebot|google-inspectiontool|bingbot|applebot|pinterest|redditbot|skypeuripreview|viber|snapchat|embedly|iframely|vkshare|mastodon/i;
function _isPreviewCrawler(ua) {
  if (typeof ua !== 'string' || ua.trim() === '') return true;
  return _PREVIEW_CRAWLER_RE.test(ua);
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
/* ═══════════════════════════════════════════════════════════════════════════════════════
   مُصادِقٌ مركّب لصفحات HTML — إعادةُ تحقّقٍ بدل إعادةِ تنزيل  (‏2026-08-26)

   **العلّة المقيسة حيّاً:** `/teacher/` = **2,016,145 حرفاً** (‏~527KB على السلك) تُخدَم
   بـ`no-cache, **no-store**, must-revalidate` و**بلا `ETag` ولا `Last-Modified`**، بينما
   المنبع (GitHub Pages) يُرجِعهما فعلاً — والوركر يحذفهما عند السطر `headers.delete('etag')`.
   ⇒ **كلُّ فتحٍ للصفحة، ولو بعد ثانية، يُنزّل الملفَّ كاملاً.** وعلى شبكةٍ يمنية هذا أثقلُ
   سببٍ منفردٍ لبطء الفتح.

   🔴 **ولا يُمرَّر `ETag` المنبع كما هو — ولا `If-None-Match` إليه.** جسمُ `/<slug>` ملفٌّ
   واحدٌ من المنبع (‏`/home/index.html`) يُعاد كتابته بثلاث طبقات: `canonical`+`og:url` ·
   `_brandRewrite` · وأحياناً OG الخبر. فمُصادِقُ المنبع **لا يصف الجسم المخدوم** بل مُدخَلاً
   واحداً من ثلاثة: هويةُ مدرسةٍ تتغيّر بلا أن يتغيّر الملفّ ⇒ 304 يُثبّت هويةً بائتةً عند
   العميل **بلا رجعة**. ولو مرّرنا `If-None-Match` إلى المنبع لردّ 304 بلا جسم بينما بصمةُ
   المستأجر تغيّرت ⇒ لا جسمَ نُعيد كتابته ⇒ جلبةٌ ثانية في المسار الحارّ.

   ⇒ **المُصادِق يُشتقّ من المُخرَج لا المُدخَل:** مُصادِقُ المنبع + مفتاحُ المستأجر + بصمةُ
   الهوية التي ستُحقَن حرفياً + المضيف (‏`_identityHeaders` يختلف بين الرسمي والإرثيَّين) +
   نافذةٌ زمنية. فانتقالُ «بلا هوية ⇒ بهوية» يُبطل المُصادِق تلقائياً، ولا مسارَ يُنتج جسماً
   مختلفاً بنفس الوسم.

   🔒 **والضمانُ الأصليّ محفوظٌ حرفياً:** `no-cache` تُلزم المتصفّح بالسؤال في كلّ مرّة —
   لا تُخزّن بلا سؤال. الفرقُ الوحيد أن جوابَ السؤال صار **304 (~٣٠٠ بايت)** بدل 200 (527KB)
   حين لا يتغيّر شيء. `no-store` وحدها هي التي تمنع **وجودَ نسخةٍ تُسأل عنها** — وهي الزائدة.
   🔴 و`sw.js` و`manifest.webmanifest` يبقيان `no-store` **وبلا مُصادِق**: عاملُ خدمةٍ مُكاشٌ
   بخطأ **يُثبّت نفسه** ولا يُصلَح من الخادم — فئةُ عطلٍ لا رجعةَ فيها.
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* 🔴 **`ETag` غيرُ قابلٍ للاستعمال هنا — قِيس ولم يُخمَّن (‏2026-08-26).** جُرِّب الشكلان:
   الضعيف `W/"…"` والقويّ `"…"`، وعلى المضيفَين (النطاق المخصّص و`workers.dev`) ⇒ **لا يبلغ
   العميل في أيّ حالة**. والمِجَسّ الحاسم: رأسٌ مرآةٌ `X-Page-Validator` بنفس القيمة حرفياً
   **وصل**، و`ETag` غاب في الطلب نفسه ⇒ الإسقاطُ من **حافّة Cloudflare** لا من الوركر
   (الحافّة تضغط الجسم فيتغيّر الكيان، فتُسقط وسمَه). والأخطر أن الميزة كانت تبدو منجزةً:
   `If-None-Match: *` يُرجِع **304** فعلاً — المنطقُ سليم، والرأسُ وحده مفقود ⇒ لا وسمَ يصل
   ⇒ لا سؤالَ يعود ⇒ **صفرُ أثرٍ في متصفّحٍ حقيقيّ**، وكلُّ فحصٍ محلّيّ أخضر.
   ⇒ لا تُعِد `ETag` هنا. و`Last-Modified` **تمرّ** (قِيس في نفس الجلسة) — فهي المُصادِق.
   📌 والدرسُ المعمَّم: «الكود يعمل» ليس «الميزة تعمل». الفاصلُ بينهما رحلةُ الرأس. */

/** نافذةٌ بالساعة — تُستعمل **احتياطاً وحدها** حين لا يُعطي المنبعُ تاريخاً. */
function _hourWindow(nowMs) { return Math.floor((nowMs || Date.now()) / 3600000); }

/** لحظةُ آخر تغيّرٍ حقيقيّ للصفحة المخدومة، بالميلي-ثانية.
 *
 *  🔴 المصدران **كلاهما ضروريّ**، وأيٌّ منهما وحده يُنتج بياتاً صامتاً:
 *   · `upstreamLastModified` — يتغيّر مع كلّ نشرة CI ⇒ التحديثُ يظهر **فوراً** كما كان.
 *   · `brandTs` — لحظةُ آخر تحديثٍ لهوية المدرسة المحقونة في الجسم. بدونه تُبدّل مدرسةٌ
 *     اسمَها أو شعارَها فلا يتغيّر شيءٌ عند المنبع ⇒ يبقى الزائر على الهوية القديمة **إلى
 *     الأبد**. وهذه بالضبط علّةُ «صفحةٌ واحدة تخدم N مستأجرين».
 *  ودقّةُ الثانية لأن ترويسة HTTP لا تحمل أدقّ منها — والمقارنةُ لو تمّت بالميلي-ثانية
 *  لصار `>=` كاذباً دوماً فلا 304 أبداً. */
function _pageLastMod(upstreamLastModified, brandTs, nowMs) {
  var up = Date.parse(String(upstreamLastModified || '')) || 0;
  var br = Number(brandTs) || 0;
  var v = Math.max(up, br);
  if (!v) v = _hourWindow(nowMs) * 3600000;
  return Math.floor(v / 1000) * 1000;
}

/** هل نسخةُ العميل حديثةٌ بما يكفي؟ (`If-Modified-Since` ≥ آخر تغيّر). */
function _notModifiedSince(ims, lastModMs) {
  var t = Date.parse(String(ims || ''));
  if (!t || !lastModMs) return false;
  return t >= lastModMs;
}

var BRAND_TTL_S = 21600;

/* 🔴 مفتاح الكاش على **أصل الطلب نفسه** لا مضيف وهمي: `caches.default` في Workers يشترط
   مفتاحاً داخل النطاق. والمسار ثلاثي المقاطع فيرفضه `_schoolSlugFromPath` (مقطعٌ واحد
   حصراً) ⇒ لا يمكن أن يصير سطحاً مخدوماً بأي حال. */
/* 🔁 `v2` منذ 2026-09-03: الحمولةُ صارت تحمل الهاتف/العنوان/واتساب (قرار المالك).
   🔁 و`v3` في اليوم نفسِه بعد قياسٍ حيّ: الهاتفُ يُطبَّع إلى E.164 (‏`_brandPhone`).
   **رفعُ النسخة ليس تجميلاً:** مدخلاتُ `v2` تحمل رقماً خاماً، وبلا الرفع تُخدَم ستّ
   ساعاتٍ برقمٍ يقفز عند طلاء العميل وبرابط `wa.me` باطل.
   🔁 و`v4` بعد قياسٍ حيٍّ ثانٍ: **واتساب رُدَّ إلى الخام** (‏`v3` طبّعه فأنتج القفزةَ
   نفسَها معكوسةً). ولكلّ تغييرِ **قيمةٍ مخزَّنة** رفعٌ — لا لتغيير الشكل وحده. */
function _brandCacheKey(origin, slug) {
  return new Request(origin + '/__brand-cache/v5/' + encodeURIComponent(slug), { method: 'GET' });
}

async function _brandFromCache(origin, slug) {
  try {
    var hit = await caches.default.match(_brandCacheKey(origin, slug));
    if (!hit) return null;
    var o = await hit.json();
    if (!o || !o.name) return null;
    /* الحمولةُ والطابعُ منفصلان: `brand` يُحقَن في الصفحة كما هو، و`ts` يُقرأ من رأس مدخل
       الكاش (‏`X-Brand-Ts`). ومدخلٌ قديمٌ بلا الرأس ⇒ `ts = 0` ⇒ يسقط `_pageLastMod` على
       تاريخ المنبع وحده — تدرّجٌ آمن بلا إبطال كاشٍ قائم. */
    return { brand: o, ts: Number(hit.headers.get('X-Brand-Ts')) || 0 };
  } catch (e) { return null; }
}

/* يُشغَّل في `ctx.waitUntil` حصراً — خارج مسار الاستجابة تماماً.
   يستهلك مقعداً من حصّة الثلاثين، فيمرّ بنفس bulkhead «افتحْ الآن أو تخطَّ» الذي يحكم
   حقن OG: تحديثُ هويةٍ خلفيّ يجب ألّا يُزاحم تسجيل دخول معلّم أبداً. */
async function _brandRefresh(origin, slug, env) {
  var mode = (env && env.BULKHEAD_MODE) || 'on';
  var held = (mode !== 'off') ? await _bhAcquire('home', 0) : null;
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
    /* 🔴 **قرار المالك 2026-09-03 ينقض قرار 2026-08-14 صراحةً:** كان هنا «هوية العرض وحدها —
       لا هاتف/عنوان/سوشل … وقيمةُ تواصلٍ متقادمة أسوأ من غيابها». المالك يريد الهاتف
       والعنوان في رؤوس الصفحات لكلّ الزوّار، فصارت الحمولة تحملها. والتقادمُ محكومٌ
       بـ`BRAND_TTL_S` (٦ ساعات) وبكاش `/gas/` (١٠ دقائق) على الطريق العميلي.
       🔒 كلُّ حقل **مقصوصٌ ومُعقَّم** (`_brandText`) لأن الكائن كلَّه يُحقَن حرفياً في
       الصفحة (`_BrandHead`) ويعيش في كاش الحافة — والقيم من شيتٍ يحرّره بشر.
       🔒 والروابط تمرّ بـ`_safeHttpUrl` (https مطلق وإلّا `''`). */
    var brand = {
      name: String(b.brand.name || ''),
      logo: _safeHttpUrl(b.brand.logo),
      color: String(b.brand.color || ''),
      tagline: String(page.tagline || ''),
      description: String(page.aboutText || ''),
      phone: _brandPhone(b.brand.phone),
      address: _brandText(b.brand.address, 200),
      /* 🔴 **واتساب يُترك خاماً عمداً — ولا يُطبَّع كالهاتف.** عقدُه في مستودع الـgas
         «أرقامٌ فقط» **يثبّته اختبارٌ قائم هناك**، وتطبيعُه هنا يُنتج بالضبط العلّةَ التي
         عالجناها للهاتف مقلوبةً: الخادمُ يكتب `+967775189922` ثمّ يعيد العميلُ طلاءه
         `775189922` ⇒ **قفزةٌ في الاتجاه المعاكس**. رمزُ الدولة يُضاف عند بناء `wa.me`
         وحده — انظر `_brandRewrite`. قِيس حيّاً 2026-09-03: GAS يُرجع
         `phone = "+967775189922"` و`whatsapp = "775189922"` في الحمولة نفسِها. */
      whatsapp: _brandText(b.brand.whatsapp, 32),
      facebook: _safeHttpUrl(b.brand.facebook),
      instagram: _safeHttpUrl(b.brand.instagram),
      youtube: _safeHttpUrl(b.brand.youtube),
      /* 🔴 **UUID القانوني للمستأجر** (‏`_PublicPage.js::getHomePageBundle` يُرجِعه) —
         لا المفتاح الذي طلبنا به. سببه أن الصفحة تحتاجه لوصل روابط البوّابات الستّ:
         `getTeacherSchoolBrand` تطابق `school_id` حصراً، والـslug يمرّ عندها بـ`ok:true`
         واسمٍ **فارغ** ⇒ شاشة دخول بلا هوية، أسوأ من العطل. وبلا هذا الحقل تبقى الروابط
         عاريةً حتى ترجع الحمولة — و**للأبد إن فشلت** — فيهبط زائرُ مدرسةٍ على شاشة دخول
         مدرسة المالك (‏`build-frontend.js` يحقن `|| OWNER_SCHOOL_ID` في `teacher`).

         🗑️ **سقط استثناءُ المالك 2026-09-18 — ولا يُعاد.** كان المالكُ يُخزَّن بـ`''`
         مطابقةً لقاعدةٍ في `home/Index.html`، **والقاعدةُ هناك سقطت** بقرار المالك «لا
         مدرسةَ مالك» (‏gas #1604/#1607 · web #306/#310). فبقي هذا السطرُ وحدَه يُفرغ
         المعرّفَ ⇒ **روابطُ بوّابات مدرسة المالك عاريةٌ من الحمولة المحقونة** (قِيس حيّاً:
         `"schoolId":""` على `/teacher/index.html?school=abdaawatmuaz`)، بينما GAS يُرجع
         معرّفَها الحقيقيّ (‏`home/_Tenant.js` ⇒ `schoolId` من الصفّ للمالك وغيره سواءً).
         ⇒ **شكلٌ واحدٌ لكلّ مدرسة: UUID.** والمفتاحُ رُفع إلى `v5` كي لا تُخدَم مدخلاتُ
         `''` القديمة حتى انقضاء `BRAND_TTL_S`. */
      schoolId: String(b.schoolId || '')
    };
    await caches.default.put(
      _brandCacheKey(origin, slug),
      new Response(JSON.stringify(brand), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'max-age=' + BRAND_TTL_S,
          /* 🔴 لحظةُ التحديث تُحفَظ **في رأس مدخل الكاش لا داخل الكائن**: الكائن يُحقَن
             حرفياً في الصفحة عبر `_BrandHead` (‏`JSON.stringify(brand)`)، فإضافةُ حقلٍ
             إليه تُلوّث المخرَج المخدوم. والرأسُ يُقرأ بلا مسّ الحمولة.
             ووظيفتُه: `_pageLastMod` يحتاج أن يعرف متى تغيّرت الهوية، وإلّا بقي زائرُ
             مدرسةٍ بدّلت اسمَها على الاسم القديم إلى الأبد. */
          'X-Brand-Ts': String(Date.now())
        }
      })
    );
  } catch (e) { /* fail-open: الصفحة خُدِمت أصلاً؛ المحاولة القادمة تُعيد الكرّة */ }
  finally {
    if (timer) clearTimeout(timer);
    if (held) _bhRelease(held);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// كاشُ الحافّة لنداءات GAS **العامّة** على `/gas/<app>` (‏2026-08-26)
// ═══════════════════════════════════════════════════════════════════════════════
//
// 🔴 **العلّة المقيسة:** مسار `/gas/` كان **بلا أي طبقة تخزين إطلاقاً** — كلّ نداءٍ يصل
// GAS ويستهلك مقعداً من حصّة Google (٣٠ متزامناً للحساب كلّه). وقياسُ ١٢ ساعة أعطى
// `getHomePageBundle` **825** نداءً و`getHomeScheduleBundle` **802** و`getStudentSchoolBrand`
// **345** — حمولاتٌ **متطابقة** لكلّ زائر، تُعاد حسابتُها من الشيتات في كلّ مرّة.
// والنتيجة **حينها (نافذةُ 2026-08-26)**: ٢٨٫٨٪ من نداءات `/gas/*` تردّ 502 بعد ٢٣٫٧ ثانية.
// 🔴 **رقمٌ تاريخيٌّ يشرح سببَ بناء هذه الطبقة — لا حالةٌ قائمة.** أُعيد القياس 2026-09-08
// على نافذةٍ خاليةٍ من النشر (‏`09-07T03:00Z → 09-08T14:00Z`) ⇒ **١٥٫٩٪** (‏2,595/16,320).
//
// **النمط مُعادٌ لا مخترَع:** الملفّ يحوي نسختين متعمَّدتين من نفس البنية — `_slugs*`
// و`_brand*` — والتعليق عند `_brandCacheKey` يقول إن الثانية نُسخت عن الأولى عمداً.
// فهذه ثالثةٌ على النمط نفسه، لا انحرافٌ عنه.
//
// 🔴 **والمبدأ الحاكم للأمان:** الوسيط **لا يمرّر أي رأس اعتماد** — توكن الجلسة يسافر
// **داخل `args`**. ⇒ أي دالّة قد تحمل توكناً ممنوعةٌ من الكاش قطعاً. القائمة البيضاء
// أدناه مقصورةٌ على حمولاتِ **عرضٍ عامّ** لا تتطلّب جلسة أصلاً، ومفتاحُ الكاش يحمل
// `args` **و`schoolId`** معاً فلا يمكن أن يختلط مستأجرٌ بآخر.
/* ‏١٠ د للحمولات بطيئة التغيّر — أقصرُ من كاش الهوية (21600) فلا صنفَ تقادمٍ جديد.
   🔴 **وليس موحَّداً**: `getHomePageBundle` تحمل إعداداتِ صفحةٍ وتقييماتٍ مُكاشةً خادمياً
   بـ**٣٠ ثانية عمداً** (‏`home/_PublicPage.js`) لأن كاتبها مشروعُ GAS آخر ولا قناة إبطال
   بينهما — فـ600 على الحافّة كانت ستضاعف نافذة «حدّثتُ ولم يظهر» ~٢٠ ضعفاً، وتُبقي مدرسةً
   انتهى اشتراكُها مخدومةً عشر دقائق بعد إيقافها. لكلّ دالّةٍ مدّتُها في الجدول أدناه. */
var API_CACHE_TTL_S      = 600;
var API_CACHE_BODY_MAX   = 4096;   // نفس حدّ `_bhIsLoginBody`: لا `JSON.parse` على حمولةٍ ضخمة
/* 🔴 الحدُّ على **النصّ الخام قبل `encodeURIComponent`** لا بعده. القياس: مفتاحُ
   `{schoolId:<UUID>, klass:'الصف الأول الابتدائي', section:'أ'}` يبلغ **254** حرفاً بعد
   الترميز (العربية ×6) ⇒ حرفٌ واحد إضافي كان يُخرِج **أكبرَ مستهلكٍ للميزة** من الكاش
   كلّياً. والأسوأ أنه صامت: `null` بلا سطر سجلّ ⇒ ميزةٌ خامدةٌ وسجلٌّ يبدو طبيعياً.
   القياسُ على الخام يجعل الحدّ يعني ما يقوله، ويُسجَّل الرفضُ بـ`act:'nokey'` أدناه. */
var API_CACHE_ARGSKEY_MAX = 200;
/* ‏نافذةُ البيات (‏`stale-if-error`) — تُخدَم **عند إجهاضنا نحن وحده** لا عند أيّ فشلٍ آخر.
   🔴 **لماذا لزمت، بقياسٍ لا بتقدير:** نافذةٌ نظيفةٌ من البناء (‏2026-09-12T12:05→15:05Z)
   أعطت **٤٧٩ من ٥٠٤ إخفاقاً (٩٥٪) بسبب `abort_budget`** — أي أن المنبعَ لم يُخفق مرّةً
   واحدة (`upstream_status` = ٠)، بل **لم يردّ داخل الميزانية**. ومنها **٤٦** على دالّتين
   عامّتين مُكاشتين أصلاً (`getHomePageBundle` 26 · `getHomeScheduleBundle` 20) ⇒ كان عندنا
   ردٌّ صالحٌ على الحافّة **ونخدم ٥٠٢ فوقه**.
   🔒 **ولا ينقض هذا «لا كاش سلبيّ»:** تلك القاعدةُ تمنع **تخزينَ** ردٍّ فاشل، وهذا **يخدم
   ردّاً كان ناجحاً** والمنبعُ مشبَع. وشرطا التخزين المزدوجان (`good` **و**`ok(b)`) لم يُمَسّا.
   ⚠️ **والمقايضةُ معلَنة:** عشرُ دقائق **أضيقُ ممّا أُقرّ فعلاً** — `getHomeScheduleBundle`
   مقبولٌ فيها بياتُ ١٨٠٠ث بقرار مالك. والبديلُ عن «محتوى أقدمَ قليلاً» صفحةٌ مكسورة. */
var API_STALE_MAX_S      = 600;

/** قيمةٌ قياديّة مقبولة في مفتاح الكاش: نصٌّ قصير بلا أحرف تحكّم. */
function _apiSafeScalar(v) {
  if (typeof v !== 'string') return false;
  if (v.length > 64) return false;
  return !/[\u0000-\u001F\u007F]/.test(v);
}

/** ‏`[schoolId?, mode?]` — وسائطُ قياديّة قصيرة لا أكثر. */
function _apiArgsScalars(args) {
  if (args.length > 2) return false;
  for (var i = 0; i < args.length; i++) if (!_apiSafeScalar(args[i])) return false;
  return true;
}

/* ‏`getHomeScheduleBundle(params)` وحدها تأخذ **كائناً** — `{schoolId, klass|class, section}`
   (‏`teacher/StudentLogic.js`). المفاتيح محصورةٌ صراحةً: مفتاحٌ مجهولٌ = احتمالُ توكن. */
var _API_SCHED_KEYS = { schoolId: 1, klass: 1, 'class': 1, section: 1 };
function _apiArgsSchedule(args) {
  if (args.length !== 1) return false;
  var o = args[0];
  if (!o || typeof o !== 'object') return false;
  if (Object.prototype.toString.call(o) === '[object Array]') return false;
  var k = Object.keys(o);
  if (k.length > 3) return false;
  for (var i = 0; i < k.length; i++) {
    if (!_API_SCHED_KEYS.hasOwnProperty(k[i])) return false;
    if (!_apiSafeScalar(o[k[i]])) return false;
  }
  return true;
}

/* 🔴 **القائمة البيضاء وشرطُ التخزين معاً في مدخلٍ واحد** — لا جدولان يتباعدان.
   `ok(b)` تُقرَّر **لكلّ دالّة على حدة** لأن العقود مختلفة فعلاً: الثلاثة الأولى تُرجِع
   `{ok:true,…}`، بينما `getHomeScheduleBundle` تُرجِع `{settings, schedule}` **بلا `ok`
   إطلاقاً** — فشرطٌ موحَّد `ok===true` كان سيُسقطها بصمت (كاشٌ لا يُصيب أبداً يبدو
   عاملاً في السجلّ ولا يوفّر شيئاً)، وشرطٌ موحَّد أرخى كان سيُخزّن أخطاء الثلاثة الأولى. */
var API_CACHE_FNS = {
  getHomePageBundle: {
    args: _apiArgsScalars,
    /* ‏١٢٠ث لا ٦٠٠: أقصرُ عنصرٍ في الحمولة مُكاشٌ خادمياً ٣٠ث، والاشتراكُ المنتهي
       يُفحَص هنا. مكسبُ الحمل يبقى معتبَراً (‏825 نداءً/١٢س) والتقادمُ يبقى مقبولاً. */
    ttl: 120,
    /* 🟢 **`argTenant` (2026-09-19):** `args[0]` **هو** معاملُ المستأجر في هذه الدالّة
       (‏`getHomePageBundle(schoolId, mode)`)، وصفحةُ الـslug ترسل `{args:['<slug>'],
       schoolId:null}` ⇒ كان يُرفض `reject:'sid'` فتذهب **كلُّ زيارة slug إلى GAS**
       (قِيس: 1.6–24ث ومرّتا 502، مقابل 140ms من الكاش حين يحمل `schoolId`).
       🔒 **وبوّابةُ الشكل لا تُرخى:** UUID أو slug بأحرفٍ صغيرةٍ غيرُ محجوز حصراً
       (`_apiArgTenantOk`)، لأن القيمة تصير بُعداً في مفتاح الكاش. والعزلُ قائمٌ لأن
       `args` داخل المفتاح أصلاً، و`ok(b)` يمنع تخزينَ slug لا مدرسةَ له. */
    argTenant: true,
    ok: function (b) { return b.ok === true && !!(b.brand && b.brand.name); }
  },
  getTeacherSchoolBrand: {
    args: _apiArgsScalars,
    /* 🟢 **`ttl` ساعةٌ لا الافتراضيّ 600 — قرارُ المالك 2026-09-19 (في الجلستين).**
       المقيس (‏24س): إصابة 2 مقابل تخزين 14 هنا، و11 مقابل 39 للطالب ⇒ **التخزينُ يغلب
       الإصابة = دورةُ حياةٍ قصيرة لا تنوّعُ مفاتيح** (المدخلُ يُمحى قبل أن يطلبه زائرٌ
       ثانٍ في المركز نفسِه) ⇒ **الرافعةُ `ttl` أطول**. والاسمُ والشعارُ نادرا التغيّر.
       ⚖️ **والمقايضةُ مُقرَّة:** تغييرُ اسم المدرسة أو شعارها يتأخّر ظهورُه في بوّابتَي
       الدخول حتى ساعة. ⚠️ ولا يمسّ `BRAND_TTL_S` (هويّةُ الحقن الخادميّ — كاشٌ آخر). */
    ttl: 3600,
    /* 🔴 الاسمُ الفارغ **لا يُخزَّن**: نفس قاعدة `_brandRefresh` حرفياً — «شاشة دخول بلا
       هوية أسوأ من العطل»، وتثبيتُها يجعل ملءَ الخانة لاحقاً لا يظهر. */
    ok: function (b) { return b.ok === true && !!b.name; }
  },
  getStudentSchoolBrand: {
    args: _apiArgsScalars,
    ttl: 3600,   // نفسُ قرار `getTeacherSchoolBrand` أعلاه وتعليلِه
    ok: function (b) { return b.ok === true && !!b.name; }
  },
  getHomeScheduleBundle: {
    args: _apiArgsSchedule,
    /* 🔴 **`ttl` صريحٌ 1800 — والافتراضي `600` كان يُخفق حتماً، قِيس 2026-09-06:**
       `uniq(k) = 33` مقابل `n = 167` في نافذةِ حركةٍ فعليّة ~١٤٤ دقيقة ⇒ **المفتاحُ
       الواحد يُطلب كلّ ~٢٩ دقيقة وسطيّاً** — أي **خارج نافذة الـ١٠ دقائق**، فأكثرُ
       النداءات المتكرّرة تُخفق ولا تُصيب. والتجزئةُ حقيقيةٌ لا وهمية (الضابطُ الوهميّ
       ثابتٌ على 1 في نفس الاستعلام)، **والرافعةُ `ttl` أطول لا مفتاحٌ أوسع**:
       إسقاطُ `class`/`section` يخلط جداولَ فصولٍ مختلفة.
       السياق **وقتَ الضبط (2026-09-06)**: `/gas/*` تُخفق **٢٤٫٦٪** (‏502+503 من 3374).
       ⚠️ وأُعيد القياس 2026-09-08 ⇒ **١٥٫٩٪** — والرقمُ أعلاه يبقى للسرد لا للحكم.
       ⚖️ **والمقايضةُ مُقرَّةٌ من المالك 2026-09-06:** تعديلُ الجدول قد يتأخّر ظهورُه
       حتى نصف ساعة.
       ⚠️ **وحدُّ الاشتقاق يُقال:** «٢٩ دقيقة» **وسطيٌّ لا توزيع**. إن كان الاستعمالُ
       رشقيّاً فبعضُ الإصابة واقعٌ عند 600 أصلاً والمكسبُ أقلُّ من المتوقَّع — لم يُفرَّق
       بينهما، ويلزمه توزيعُ الفواصل. ⇒ **يُعاد قياسُ `hit/store` لهذه الدالّة بعد يوم
       ويُراجَع الرقم**، ولا يُقرأ 1800 قيمةً نهائية. */
    ttl: 1800,
    /* كلُّ عضوٍ مغلَّفٌ بمعالج خطئه في GAS ويردّ `{ok:false,error}` عند الإخفاق.
       فالشرط: العضوان حاضران **ولا أحدهما خطأ**.
       ⚠️ **وكان مكتوباً هنا «عند غياب ورقة الجدول» — وبطَل 2026-09-05:** المسطّحةُ
       `teacher::الجدول` **حُذفت نهائياً** والمخزنُ صار `عرض_الجدول_للمعلمين`
       (‏`teacher@907`) ⇒ **غيابُها لم يعد حالةَ خطأ بل الحالةَ الطبيعية**، ومن يبني على
       ذاك الشرط يبني على باطل. والمنطقُ أدناه لم يتغيّر — العلّةُ كانت في وصف السبب.

       🔴 **وحدُّ هذا الشرط يُقال حيث يُقرأ، لا في وثيقةِ تسليمٍ تُقرأ مرّةً:**
       `ok()` يتحقّق من **البنية لا المعنى**. ⇒ حمولةٌ سليمةُ الشكل تحمل صفوفاً مشوَّهة
       **تُخزَّن `API_CACHE_TTL_S` كاملةً**. مثالٌ مقيس 2026-09-05: الصيغةُ المتقاعِدة
       `4 أ (رياضة)` يفكّها `_smGridParseCell` إلى `subject` كاملاً بصفٍّ وشعبةٍ فارغين
       — **حمولةٌ صحيحةُ البنية بصفوفٍ لا معنى لها**، ويقبلها هذا الشرط.
       🟢 وصفرُ أثرٍ يومَها (مدرستان تجريبيتان بلا قارئٍ حقيقيّ)، **والحدُّ باقٍ**.

       ⚖️ **والمسطرةُ العامّة (مشتركةٌ مع جلسة `SchoolApp-gas` · 2026-09-05):**
       **شرطٌ يستلزم يصلح دليلاً؛ وشرطٌ يسمح لا يصلح — ولو تشابها في الشكل.**
       (‏حذفُ ورقةٍ مشروطٌ بصفوفٍ غيرِ فارغة **يستلزم** وجودَها فيصلح شهادة؛ وهذا الشرطُ
       **يسمح** بما لا يفحصه.) ⇒ قبل الاتّكاء على أيّ شرطٍ دليلاً: **أيستلزم ما تريد
       إثباتَه أم يسمح به فقط؟** */
    ok: function (b) {
      if (!b.settings || !b.schedule) return false;
      return b.settings.ok !== false && b.schedule.ok !== false;
    }
  },
  /* 🟢 **`checkAppVersion(pkg)` — 2026-09-17.** تقرأ خصائصَ السكربت وحدها
     (‏`teacher/AppVersionCheck.js`) ⇒ لا جلسة ولا توكن ولا مستأجر. وقِيس أنها تبلغ
     **gasMs ≥ 23000 ×45 في ٢٤ ساعة** وهي قراءةُ خاصيّةٍ واحدة ⇒ الانتظارُ طابورٌ لا عمل.
     🔴 **`tenantless` صريحٌ لهذه الدالّة وحدَها** — التطبيقُ يرسل `{fn,args:[pkg]}` بلا
     `schoolId` (‏`UpdateChecker.kt:96`) فكانت قاعدةُ «لا كاشَ بلا هويّة» ترفضها. والاستثناءُ
     مقيَّدٌ بوسيطٍ **يطابق اسمَ حزمةٍ حرفياً** فلا يصير بوّابةً لحمولةٍ حرّة.
     ⚖️ **والمقايضة:** تغييرُ `ANDROID_LATEST_VERSION_CODE_*` يظهر خلال ساعةٍ لا فوراً —
     والتطبيقُ نفسُه يكبح فحصَه ٦ ساعات، فالساعةُ داخل تقادمٍ قائمٍ أصلاً. */
  checkAppVersion: {
    /* ‏`[pkg]` — اسمُ حزمة أندرويد حرفياً ولا شيءَ غيره. مضمَّنةٌ هنا لا دالّةً مستقلّة:
       حرّاسُ `test-routes.js` يشغّلون هذه الكتلةَ وحدَها بـ`vm`. */
    args: function (a) {
      return a.length === 1 && typeof a[0] === 'string' && a[0].length <= 64 &&
             /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(a[0]);
    },
    tenantless: true,
    ttl: 3600,
    /* ‏`latestVersionCode = 0` تعني «غيرُ مضبوط» — لا يُثبَّت ساعةً فيُخفي ضبطاً لاحقاً. */
    ok: function (b) { return typeof b.latestVersionCode === 'number' && b.latestVersionCode > 0; }
  },
  /* 🟢 **`listPartnerSchoolsPublic()` — 2026-09-17.** دليلُ المدارس العامّ: بلا وسائط وبلا
     مستأجر (`tenantless`) — قائمةٌ واحدةٌ لكلّ الزوّار، وهي بنفسها ما يقرؤه
     `home/_PublicPage.js` من كاشٍ خادميٍّ عامّ (`home_partners_public_v2`).
     المقيس (‏نافذةُ ٣ ساعات): ١٤ نداءً اليوم و٥٠ أمس · `ok` p95 = 4,199ms · و٤ إخفاقاتٍ
     بالميزانية أمس.
     ⚖️ **والمقايضةُ تُقال لأنها تخصّ سلوكاً مقصوداً:** تسجيلُ مدرسةٍ جديدة يُبطِل كاشَ
     `home` **فوراً** عبر `flushPartnersCacheProtected`، **ولا قناةَ إبطالٍ لكاش الحافّة**
     ⇒ المدرسةُ الجديدة قد تتأخّر في الدليل **حتى دقيقتين**. ولذلك `ttl` قصيرٌ صريحٌ
     (١٢٠ لا ٦٠٠) بنفس منطق `getHomePageBundle`: نصفُ إبطالٍ يُنتج تناقضاً مرئياً (بند 71).
     🔒 والقائمةُ الفارغة لا تُخزَّن — «دليلٌ فارغ» يُقرأ عطلاً لا حالةً. */
  /* 🟢 **`getAppUrls()` — 2026-09-18.** خريطةُ مداخلِ التطبيق (‏`home` · `teacher` ·
     `student` · `cms`) التي يقرؤها تطبيقُ «يمن سكولز» **قبل أن يعرف إلى أين يذهب**.
     🔴 **ولماذا هي أوجبُ مدخلٍ في هذه القائمة:** قِيس ذهاباً وإياباً **5,843 و10,584ms**
     من هنا (‏وقياسُ جلسة الأندرويد: 4,789–11,696ms وواحدةٌ ردّت 503)، **ومعالجُها في GAS
     `_ms: 5`** ⇒ **كلُّ الزمن انتظارُ قبولٍ في الطابور وصفرٌ منه حساب.** وشاشةٌ بيضاءُ
     5–12 ثانيةً عند إقلاع تطبيقٍ **منشور** أسوأُ من الروابط المجمَّدة التي جاءت القناةُ
     لتُنهيها. ⇒ بالكاش يصير الإقلاعُ **قراءةَ حافّة**، والنداءُ **يخرج من الطابور قبل أن
     يدخله** — فلا يضيف حملاً على حصّةٍ مشبَعة أصلاً.
     🔒 **بلا مستأجرٍ إطلاقاً** (‏`tenantless`): ردٌّ واحدٌ لكلّ الزوّار، ولا يقرأ شيتاً،
     ولا يلمس `_tenantCanonical`. **والمقبولُ النداءُ بلا وسائطَ وحدَه** — والمعاملُ
     الاختياريُّ `school` يمرّ حيّاً بلا كاش، فلا يتلوّث المفتاح.
     ⚖️ ttl 3600: خريطةُ مساراتٍ تتغيّر مرّةً في أشهر، و`SchoolApp-gas` تُبلغ عند التغيير. */
  getAppUrls: {
    args: function (a) { return a.length === 0; },
    tenantless: true,
    ttl: 3600,
    /* 🔴 المداخلُ الثلاثةُ الحاكمةُ لازمةٌ وبـ`https` — خريطةٌ ناقصةٌ تُخزَّن ساعةً
       تجعل التطبيقَ يسقط إلى قيمه المدمجة بلا سببٍ ظاهر. و`cms` غيرُ لازمٍ (ليس مدخلَ
       إقلاع)، و`schedule` غيرُ مُدرَجٍ عمداً في المصدر (متقاعد). */
    ok: function (b) {
      if (b.success !== true || !b.data || typeof b.data !== 'object') return false;
      var need = ['home', 'teacher', 'student'];
      for (var i = 0; i < need.length; i++) {
        var v = b.data[need[i]];
        if (typeof v !== 'string' || v.indexOf('https://') !== 0) return false;
      }
      return true;
    }
  },
  listPartnerSchoolsPublic: {
    args: function (a) { return a.length === 0; },
    tenantless: true,
    ttl: 120,
    ok: function (b) {
      return b.success === true &&
             Object.prototype.toString.call(b.schools) === '[object Array]' &&
             b.schools.length > 0;
    }
  },
  /* 🟢 **`listPublicSlugsPublic()` — 2026-09-21.** دليلُ الـslugs المنشورة
     (‏`home/_PublicPage.js:632`): **بلا وسائطَ إطلاقاً** ⇒ `tenantless` بحقّ — الورقةُ
     واحدةٌ لكلّ الزوّار. ⚖️ ttl 120 = نظيرُ `listPartnerSchoolsPublic`: مدرسةٌ جديدةٌ قد
     تتأخّر في الدليل دقيقتين، ولا قناةَ إبطالٍ للحافّة.
     🔴 **والمسارُ المتدهورُ لا يُخزَّن — وهو الفخُّ هنا تحديداً:** الدالّةُ تُرجع عند العطل
     `{ ok:true, slugs:[], states:[], schools:[], degraded:true }` — **`ok:true` مع فراغ!**
     ⇒ شرطُ `success === true` وحدَه كان سيُثبّت **دليلاً فارغاً** ساعتين. ولذلك يُفحَص
     `degraded` صراحةً **ويُشترَط طولٌ غيرُ صفريّ**. (نفسُ قاعدة «لا كاشَ سلبيّاً».)
     ⚠️ والحمولةُ v3 تحمل `schools` إلى جانب `slugs`/`states` القديمتين — والشرطُ على
     `slugs` لأنها الحقلُ الذي يقرؤه الوسيطُ المنشورُ اليوم. */
  listPublicSlugsPublic: {
    args: function (a) { return a.length === 0; },
    tenantless: true,
    ttl: 120,
    ok: function (b) {
      return b.ok === true && b.degraded !== true &&
             Object.prototype.toString.call(b.slugs) === '[object Array]' &&
             b.slugs.length > 0;
    }
  },
  /* 🟢 **`getSchoolName(schoolId)` — 2026-09-21.** اسمُ المدرسة من السجلّ المركزيّ
     (‏`teacher/_Tenant.js:556`): **وسيطُه الأوّلُ هو المستأجرُ نفسُه** ⇒ `argTenant` كما في
     `getHomePageBundle` — فيصير المعرّفُ جزءاً من مفتاح الكاش ولا تتشارك مدرستان مدخلاً.
     ⚖️ ttl 3600 = نظيرُ `getTeacherSchoolBrand`/`getStudentSchoolBrand`: تغييرُ اسم
     المدرسة يتأخّر حتى ساعة — وهي مقايضةٌ مُقرَّةٌ سلفاً لنفس البيانات بعينها.
     🔴 **والاسمُ الفارغُ لا يُخزَّن أبداً** — الدالّةُ تُرجع `{ ok:false, name:'' }` في أربعة
     مساراتِ فشلٍ (‏`SCHOOLS_SHEET_MISSING` · `SCHOOL_NOT_FOUND` · `ERROR` · تعذّرُ الوصول
     إلى Master). وتخزينُ أيٍّ منها يعني **مدرسةً بلا اسمٍ ساعةً كاملة**. */
  getSchoolName: {
    args: function (a) { return a.length <= 1; },
    argTenant: true,
    ttl: 3600,
    ok: function (b) {
      return b.ok === true && typeof b.name === 'string' && b.name.trim() !== '';
    }
  },
  /* 🟢 **`getPublicPlansPublic()` — 2026-09-19.** باقاتُ قسم `#pricing` في الصفحة الرئيسية
     (‏`home/Code.js`): بلا وسائط ولا مستأجر — الورقةُ `Settings_Master` واحدةٌ لكلّ الزوّار،
     والمُرجَعُ حقولُ عرضٍ مُعلَنةٌ أصلاً. قِيس 2.3–11.5ث من GAS (جلسة `SchoolApp-gas`).
     ⚖️ ttl 600 = كاشُها الخادميُّ نفسُه (‏`_public_plans_v1`) ⇒ تعديلُ باقةٍ يتأخّر حتى ١٠ دقائق.
     🔒 القائمةُ الفارغةُ لا تُخزَّن — نفسُ شرط الخادم (فراغُ عطلٍ عابرٍ لا يُثبَّت). */
  getPublicPlansPublic: {
    args: function (a) { return a.length === 0; },
    tenantless: true,
    ttl: 600,
    ok: function (b) {
      return b.ok === true &&
             Object.prototype.toString.call(b.plans) === '[object Array]' &&
             b.plans.length > 0;
    }
  },
  /* 🟢 **`getPublicPricingPublic()` — 2026-09-19 (`home` · gas#1632).** قسمُ `#pricing` الكامل:
     الباقات + الخصومات + الخدمات + الشروط، بلا وسائط ولا مستأجر — وبعد #1632 هي نداءُ `/`
     الوحيد للأسعار (و`getPublicPlansPublic` يبقى لـ`register.html`).
     ⚖️ ttl 600 — تعديلُ سعرٍ يتأخّر حتى ١٠ دقائق. 🔒 **لا تُخزَّن بلا باقات** (قسمٌ فارغٌ
     عشرَ دقائق يُقرأ «لا أسعار»). و`trial`/`services`/`terms`/`notes` قد تكون `null`
     مشروعاً فلا تدخل الشرط. */
  getPublicPricingPublic: {
    args: function (a) { return a.length === 0; },
    tenantless: true,
    ttl: 600,
    ok: function (b) {
      return b.ok === true &&
             Object.prototype.toString.call(b.plans) === '[object Array]' &&
             b.plans.length > 0;
    }
  }
};

/* هويّةُ مستأجرٍ في `args[0]` (للدوالّ ذات `argTenant` وحدَها): UUID أو slug بأحرفٍ صغيرة
   — نفسُ شكل `_schoolSlugFromPath`. وما عداه ⇒ `false` ⇒ `reject:'sid'` كما كان.
   ⚠️ مكتفيةٌ بذاتها عمداً (لا `_SCHOOL_UUID_RE` ولا `_RESERVED_TOP_PATHS`): `test-routes.js`
   يشغّل كتلةَ المِجَسّ وحدَها بـ`vm`، ومرجعٌ خارجها يرمي فيسقط المِجَسُّ كلُّه إلى `null`.
   والاسمُ المحجوزُ لا مدرسةَ له ⇒ `ok(b)` يمنع تخزينَه، فلا حاجة لفحصه هنا. */
function _apiArgTenantOk(v) {
  if (typeof v !== 'string' || !v || v.length > 64) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ||
         /^[a-z0-9-]+$/.test(v);
}

/* 🔴 مفتاحٌ **خماسيّ المقاطع** عمداً: `_schoolSlugFromPath` يقبل مقطعاً واحداً حصراً،
   فمفتاحٌ كهذا لا يمكن أن يصير سطحاً مخدوماً بأيّ حال. نفس قاعدة `_brandCacheKey`. */
function _apiCacheKey(origin, app, fn, argsKey) {
  return new Request(origin + '/__api-cache/v1/' + app + '/' + fn + '/' + argsKey,
                     { method: 'GET' });
}

/* 🔬 **بصمةُ مفتاحٍ للسجلّ — بصمةٌ لا قيمة** (2026-09-06).
 *
 * **لماذا وُجدت:** سطورُ `ev:'apicache'` كانت تحمل `app`+`fn` **ولا تحمل هويّةَ مفتاح**
 * إطلاقاً ⇒ السؤالُ الوحيد الذي يفسّر نسبةَ الإصابة — **كم مفتاحاً مميّزاً لكلّ دالّة
 * داخل نافذة الـttl؟** — كان **غيرَ قابلٍ للقياس بالأدوات القائمة**. وهو حرفياً العائقُ
 * المسجَّل على بندَي `edge-cache-stores-more-than-it-hits` و
 * `worker-schedule-bundle-cache-fragmented`: بلاه يبقى البندان مفتوحَين أبداً أو
 * يُغلقان بلا دليل. ⇒ **الأداةُ قبل القياس، والقياسُ قبل الحكم.**
 *
 * 🔴 **ولماذا بصمةٌ لا القيمة نفسُها:** `argsKey` يحمل `schoolId` (‏UUID) واسمَ الصفّ
 * والشعبة عربيّاً. وكتابتُه خاماً تُدخل بياناتِ مستأجرٍ في سجلّات Cloudflare **بلا أيّ
 * حاجة** — لأن الاستعلامَ المطلوب `uniq(k)` مقابل `count()` مجمَّعاً بـ`fn`، وهو
 * **لا يحتاج القيمةَ بحال**. ⇒ ‏FNV‑1a 32‑بت ⇒ ثمانيةُ محارف hex.
 *
 * ⚠️ **وحدُّه يُقال حيث يُقرأ: بصمةٌ لا تعمية، وعدٌّ تقريبيٌّ لا هويّةٌ قاطعة.** فضاءُ
 * ‏2³² يعطي احتمالَ تصادمٍ ~0.01٪ عند ألفِ مفتاحٍ مميّز، و~1.2٪ عند عشرة آلاف
 * (‏تقريبُ عيد الميلاد) ⇒ `uniq(k)` **يُقلّل قليلاً** ولا يُبالغ أبداً، فالخطأُ في
 * الاتّجاه الآمن للسؤال المطروح. 🔴 **ولا يُبنى عليه قرارُ عزلٍ بين مستأجرين ولا مفتاحُ
 * كاش** — العزلُ يبقى على `_apiCacheKey` بقيمته الكاملة، وهذه للسجلّ وحده. */
function _apiKeyFp(argsKey) {
  var h = 0x811c9dc5;
  for (var i = 0; i < argsKey.length; i++) {
    h = Math.imul(h ^ argsKey.charCodeAt(i), 16777619) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

/* يُحلّل الجسم ويُرجِع `{fn, argsKey}` إن كان مؤهَّلاً، وإلّا `null`.
   🔴 **بـ`JSON.parse` لا برجيكس** — نفس درس `_bhIsLoginBody`: الرجيكس يأخذ **أوّل** قيمةٍ
   لمفتاحٍ مكرَّر و`JSON.parse` يأخذ **آخرها**، فجسمٌ مصنوع
   `{"fn":"getHomePageBundle",…,"fn":"دالّةٌ أخرى"}` كان **سيُصيب الكاش باسمٍ ويُنفّذ غيره**.
   وأيُّ شكٍّ ⇒ `null` ⇒ المسارُ العادي (fail-closed). */
function _apiCacheProbe(body) {
  try {
    if (typeof body !== 'string' || body.length > API_CACHE_BODY_MAX) return null;
    var o = JSON.parse(body);
    if (!o || typeof o !== 'object') return null;
    /* 🔒 لا مفتاحَ خارج الثلاثة: الجسر يرسل `{fn, args, schoolId}` حصراً، وأيُّ مفتاحٍ
       إضافيّ قد يحمل توكناً أو يغيّر دلالة النداء خادمياً بلا أن يدخل المفتاح. */
    var keys = Object.keys(o);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] !== 'fn' && keys[i] !== 'args' && keys[i] !== 'schoolId') return null;
    }
    if (typeof o.fn !== 'string' || !API_CACHE_FNS.hasOwnProperty(o.fn)) return null;
    var args = (o.args === undefined || o.args === null) ? [] : o.args;
    if (Object.prototype.toString.call(args) !== '[object Array]') return null;
    /* 🔴 من هنا فصاعداً الدالّةُ **مؤهَّلةٌ اسماً** — فرفضُها لاحقاً حدثٌ يستحقّ سطراً في
       السجلّ (‏`reject`)، بخلاف `null` أعلاه الذي يعني «ليست من أهل الكاش أصلاً» وهو
       الحالةُ الغالبة فلا يُسجَّل. بلا هذا التمييز تصير الميزةُ خامدةً بصمتٍ تامّ. */
    if (!API_CACHE_FNS[o.fn].args(args)) return { fn: o.fn, reject: 'args' };
    var sid = (o.schoolId === undefined || o.schoolId === null) ? '' : o.schoolId;
    if (!_apiSafeScalar(sid)) return { fn: o.fn, reject: 'sid' };
    /* 🔴 **لا مدخلَ كاشٍ بلا هويّةِ مستأجر (2026-09-15).** كان المعرّفُ الفارغ يمرّ فيصير
       `sid=''` **بُعداً مشروعاً في المفتاح** ⇒ مدخلٌ واحدٌ بلا هويّة يخدم كلَّ من يطلب بلا
       هويّة — وهو نقيضُ قرار المالك 2026-08-14 («لا شيءَ يعمل بلا معرّف») مطبَّقاً على
       طبقةِ الكاش بدل طبقة الصفحة.

       🔴 **والهويّةُ تُقبل من موضعين لأن الشكلين مقيسان مختلفان — ولا يُوحَّدان:**
       · **الأغلبيّة** ترسل المعرّفَ في **حقلٍ أعلى** بجانب `fn`/`args` (‏`getTeacherSchoolBrand`
         مثالُها: `args:['']` و`schoolId:'…'`) ⇒ **`args[0]` ليس المستأجرَ أصلاً.**
       · **و`getHomeScheduleBundle` وحدَها** تحمله **داخل كائن الوسائط** (`args[0].schoolId`).
       ⚠️ **وهذا بعينه ما كاد يُكسر في هذا المرور:** شُدِّد `_apiArgsScalars` ليرفض `args[0]`
       الفارغ، **فأحمرَّ ضابطُ عزل المستأجرين فوراً** — لأنه يرفض الشكلَ المشروعَ الغالب.
       ⇒ **الشرطُ يُفرَض على الهويّة حيث تسافر فعلاً، لا حيث يُفترَض أنها تسافر.**

       ⚠️ **وحدُّه يُقال بصدق: تشديدٌ بطبقةٍ ثانية لا سدُّ تسرّبٍ قائم.** التخزينُ مشروطٌ
       أيضاً بـ`ok(b)`، والخلفيّةُ اليومَ تردّ `no_tenant` على المستأجر الفارغ ⇒ لا يُخزَّن
       شيءٌ فعلياً الآن. 🔴 **لكنّ ذلك الشرطَ يعيش في مستودعٍ آخر** — ويومَ تُرجع تلك
       الدالّةُ حمولةً صالحةً لمستأجرٍ فارغ (وقد فعلت: `isOwner:true` و30,056 بايتاً قبل
       2026-08-14) يصير التخزينُ مشروعاً **بلا سطرٍ يتغيّر هنا**.

       🔒 **والرفضُ لا يكسر نداءً:** `reject` ⇒ يمرّ إلى GAS بلا كاش كأيّ دالّةٍ خارج
       القائمة البيضاء ⇒ **صفرُ تغييرٍ فيما يراه المستخدم**، وحدَه الكاشُ يمتنع. */
    var _a0 = (args.length > 0 && args[0] && typeof args[0] === 'object') ? args[0] : null;
    var _argSid = (_a0 && typeof _a0.schoolId === 'string') ? _a0.schoolId : '';
    var _argTenant = (API_CACHE_FNS[o.fn].argTenant && _apiArgTenantOk(args[0])) ? args[0] : '';
    if (sid === '' && _argSid === '' && _argTenant === '' && !API_CACHE_FNS[o.fn].tenantless) return { fn: o.fn, reject: 'sid' };
    /* 🔴 `schoolId` **داخل المفتاح** — يُحلّ المستأجر خادمياً، فإسقاطُه من المفتاح يخلط
       مدرسةً بأخرى. والحدُّ يُقاس على الخام لا على المُرمَّز (انظر تبريره أعلى الكتلة). */
    var raw = JSON.stringify([args, sid]);
    if (raw.length > API_CACHE_ARGSKEY_MAX) return { fn: o.fn, reject: 'len' };
    return { fn: o.fn, argsKey: encodeURIComponent(raw) };
  } catch (e) { return null; }
}

/** يُرجِع `{text, age}` عند الإصابة و`null` عند الإخفاق. */
async function _apiCacheGet(origin, app, probe) {
  try {
    var hit = await caches.default.match(_apiCacheKey(origin, app, probe.fn, probe.argsKey));
    if (!hit) return null;
    var text = await hit.text();
    if (!text || text.charAt(0) !== '{') return null;
    var ts = Number(hit.headers.get('X-Api-Ts')) || 0;
    return { text: text, age: ts ? Math.round((Date.now() - ts) / 1000) : -1 };
  } catch (e) { return null; }
}

/** مدّةُ طزاجةِ دالّةٍ بعينها — الجدولُ أوّلاً ثمّ الافتراضُ العامّ. */
function _apiTtlFor(fn) {
  return (API_CACHE_FNS[fn] && API_CACHE_FNS[fn].ttl) || API_CACHE_TTL_S;
}

/* يصنّف مدخلاً **بعمره** إلى ثلاثة: `fresh` يُخدَم دائماً · `stale` يُخدَم عند إجهاضنا
   وحده · `expired` لا يُخدَم بحال.

   🔴 **ولماذا هذه الدالّةُ جوهرُ الدفعة لا زينتُها:** الطزاجةُ كانت مفروضةً بـ
   `caches.default.match` نفسِها — تُهمل المدخلَ بعد `max-age`. ومدُّ العمر في `_apiCachePut`
   أدناه (كي يبقى البائتُ **موجوداً** للتراجع) **يُلغي ذلك الفرضَ الضمنيّ** ⇒ بلا هذه
   البوّابة يصير المدخلُ البائتُ **إصابةً طازجةً تُخدَم بصمت**، وهو انحدارٌ أخطرُ من العطل
   الذي جاءت الدفعةُ لعلاجه: الصفحةُ تعمل، والبياناتُ قديمةٌ، ولا شيء يحمرّ.
   ⇒ **الفرضُ انتقل من الأداة إلينا، فصار لازماً أن يكون مقيساً.**

   🔒 و`age < 0` (‏مدخلٌ بلا `X-Api-Ts` فلا يُحكَم على عمره) ⇒ `expired` — **fail-closed**:
   ما لا نعرف عمرَه لا نخدمه، لا طازجاً ولا بائتاً. */
function _apiCacheFreshness(fn, age) {
  if (typeof age !== 'number' || age < 0) return 'expired';
  var ttl = _apiTtlFor(fn);
  if (age <= ttl) return 'fresh';
  if (age <= ttl + API_STALE_MAX_S) return 'stale';
  return 'expired';
}

/* يُخزّن **`text` خاماً كما هو** (بذيله `"_ms"`) — `assets/gas-bridge.js` يستهلكه نصّاً،
   فإعادةُ بنائه تُلوّث المخرَج المخدوم. والطابعُ الزمنيّ في **رأس مدخل الكاش** لا داخل
   الحمولة، أسوةً بـ`X-Brand-Ts`. يُرجِع `true` إن خُزّن فعلاً (للسجلّ). */
async function _apiCachePut(origin, app, probe, text) {
  try {
    if (!text || text.charAt(0) !== '{') return false;
    var json = JSON.parse(text);
    var b = (json && json.result) ? json.result : json;   // نفس تفكيك `_brandRefresh`
    if (!b || typeof b !== 'object') return false;
    if (!API_CACHE_FNS[probe.fn].ok(b)) return false;
    await caches.default.put(
      _apiCacheKey(origin, app, probe.fn, probe.argsKey),
      new Response(text, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          /* 🔴 **العمرُ = الطزاجةُ + نافذةُ البيات** — كي يبقى المدخلُ **مطابَقاً** بعد
             انقضاء طزاجته فيصلح للتراجع عند `abort_budget`. والطزاجةُ صارت تُفرَض في
             `_apiCacheFreshness` أعلاه لا هنا — **ولا يُعاد هذا السطرُ إلى `ttl` وحده
             ظنّاً أنه تضييقٌ آمن**: ذلك يُعيد البائتَ إلى الإهمال فيعود الـ٥٠٢ صامتاً. */
          'Cache-Control': 'max-age=' + (_apiTtlFor(probe.fn) + API_STALE_MAX_S),
          'X-Api-Ts': String(Date.now())
        }
      })
    );
    return true;
  } catch (e) { return false; }
}

/* 🟢 **تحديثُ مدخلٍ بائتٍ في الخلفية (stale-while-revalidate · 2026-09-19).**
   يُستدعى من `ctx.waitUntil` بعد خدمة البائت فوراً. ثلاثةُ قيود:
   ① **مرّةٌ واحدة لكلّ مفتاح داخل الـisolate** (`_apiRevalidating`) — عشرةُ زوّارٍ في
      الثانية نفسِها لا يُطلقون عشرةَ نداءات.
   ② **مقعدٌ من المنظّم بلا انتظار** (`_bhAcquire(app, 0)`) — لا مقعدَ ⇒ لا تحديث، والزائرُ
      التالي يحاول (نفسُ نمط `_brandRefresh`). فلا يصير التحديثُ الخلفيُّ حِملاً فوق السقف.
   ③ **التخزينُ عبر `_apiCachePut` نفسِه** ⇒ شرطُ `ok(b)` الخاصّ بكلّ دالّة سارٍ حرفياً،
      فلا يُثبَّت فشلٌ فوق البائت الصالح.
   ويُرجِع سببَ النتيجة (للسجلّ): `store` · `skip` · `dup` · `noseat` · `http` · `err`. */
var _apiRevalidating = {};
async function _apiCacheRevalidate(origin, app, probe, body, env) {
  /* 🔴 **`origin` داخل المفتاح** — نفسُ أبعاد `_apiCacheKey` الأربعة. بلاه يقفل زائرُ مضيفٍ
     تحديثَ مدخلِ مضيفٍ آخر (الدوالُّ `tenantless` وسائطُها متطابقةٌ عبر المضيفات) فيبقى بائتاً
     بصمت. (رصدته مراجعة PR #326.) */
  var key = origin + '/' + app + '/' + probe.fn + '/' + probe.argsKey;
  if (Object.prototype.hasOwnProperty.call(_apiRevalidating, key)) return 'dup';
  _apiRevalidating[key] = 1;
  var mode = (env && env.BULKHEAD_MODE) || 'on';
  var held = null, timer = null;
  try {
    held = (mode !== 'off') ? await _bhAcquire(app, 0) : null;
    if (mode === 'on' && !held) return 'noseat';
    /* وضعُ الظلّ يقيس ولا يحجب: مقعدٌ مفروضٌ كالمسار الرئيسيّ كي يبقى `n` تزامناً حقيقياً. */
    if (mode === 'shadow' && !held) held = _bhTake(app);
    var ab = new AbortController();
    timer = setTimeout(function () { ab.abort(); }, 20000);
    /* نفسُ مُميِّز `student` في المسار الرئيسيّ: `GAS.student` نشرةُ `teacher`. */
    var tgt = GAS[app] + (app === 'student' ? '?app=student' : '');
    var res = await fetch(tgt, {
      method: 'POST',
      signal: ab.signal,
      headers: { 'Content-Type': 'text/plain' },
      body: body
    });
    if (res.status < 200 || res.status >= 400) return 'http';
    var text = await res.text();
    return (await _apiCachePut(origin, app, probe, text)) ? 'store' : 'skip';
  } catch (e) {
    return 'err';
  } finally {
    if (timer) clearTimeout(timer);
    if (held) _bhRelease(held);
    delete _apiRevalidating[key];
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

/** نصٌّ مستأجرٍ مقصوص ومُعقَّم لحمولة الهوية: بلا `<`/`>` وبلا محارف تحكّم، بحدّ طول. */
function _brandText(v, max) {
  var s = (v == null) ? '' : String(v).replace(/[<>\u0000-\u001f\u007f]/g, '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** أرقام فقط — لرابط `wa.me/<digits>` (‏`+967 7x…` ⇒ `9677x…`). */
function _brandDigits(v) { return String(v || '').replace(/\D/g, ''); }

/* 🔴 **تطبيعٌ إلى E.164 — نسخةٌ ثالثة بالضرورة، وتطابقُها الحرفيُّ إلزاميّ.**
   قِيس حيّاً 2026-09-03 بعد أوّل نشر: `getHomePageBundle.brand.phone` يصل **خاماً من
   عمود الشيت** (‏`775189922`)، بينما `getTeacherSchoolBrand`/`getStudentSchoolBrand`
   تُطبّعانه في `_Tenant.js` إلى `+967775189922`. والأثرُ عطلان لا واحد:
   ① **النصُّ يقفز** — الخادمُ يكتب `775189922` ثمّ يعيد العميلُ طلاءه `+967775189922`
      بعد ثوانٍ. نفسُ علّةِ `_brandDocTitle` مع `__homeDocTitle` حرفياً.
   ② 🔴 **ورابطُ `wa.me` يصير باطلاً** — يشترط الرقمَ الدوليّ كاملاً، و`wa.me/775189922`
      لا يفتح محادثةً أصلاً. عطلٌ صامتٌ يظهر للمستخدم لا في أيّ سجلّ.
   المنطقُ مطابقٌ لـ`teacher/_Tenant.js:502-503` في مستودع الـgas. */
function _brandPhone(v) {
  var s = _brandText(v, 32).replace(/[\s()-]/g, '');
  if (!s) return '';
  if (s.charAt(0) === '+') return s;
  return '+967' + s.replace(/^0+/, '');
}

/* ── عقد الخطّافات الموحَّد للسطوح الثلاثة (2026-09-03) ────────────────────────
   محدِّدٌ واحد يعمل على أيّ صفحة بدل محدِّدٍ لكلّ صفحة:
     `[data-brand="name|logo|phone|address|whatsapp"]`  ⇒ نصّ، أو `src` على <img>
     `[data-brand-href="phone|whatsapp"]`                ⇒ `href` = tel: / wa.me/
     `[data-brand-host="phone|address|whatsapp"]`         ⇒ يُزال `hidden` **فقط حين تكون
                                                            القيمة موجودة** (الفارغ يبقى مخفياً —
                                                            نفس فلسفة `_homeContactField`)
   الوسومُ تعيش في مصدر `SchoolApp-gas` (‏`home/Index.html` · `Teacher Dashboard.html` ·
   `Student Portal.html`)، وهذا الملفّ يشحن الآلية. غيابُ الخطّاف ⇒ لا أثر (المعالج لا
   يُستدعى)، فالتدرّج آمن في الاتجاهين. */
function _BrandField(val) { this.val = val; }
_BrandField.prototype.element = function (el) {
  if (!this.val) return;
  var tag = String(el.tagName || '').toLowerCase();
  if (tag === 'img') { el.setAttribute('src', this.val); return; }
  if (tag === 'input') { el.setAttribute('value', this.val); return; }
  el.setInnerContent(this.val, { html: false });
};
function _Unhide() {}
_Unhide.prototype.element = function (el) {
  el.removeAttribute('hidden');
  /* `display:none` المكتوب على العنصر نفسه (كما تفعل `_homeContactField` عند الإخفاء) */
  var st = el.getAttribute('style');
  if (st && /display\s*:\s*none/i.test(st)) el.setAttribute('style', st.replace(/display\s*:\s*none\s*;?/ig, ''));
};
/* حاويةُ شعارٍ من نوع <div> تُملأ بـ`innerHTML` عميلياً (‏`#tchLoginLogo` · `#stuNavLogo` …):
   نحقن <img> بنفس الشكل الذي يكتبه `applyBrand` هناك كي لا «يقفز» الشعار عند وصول الحمولة.
   🔒 الرابط مرّ بـ`_safeHttpUrl` (https حصراً، بلا محارف تحكّم) ويُهرَّب كخاصية. */
function _LogoInner(url, alt) { this.url = url; this.alt = alt; }
_LogoInner.prototype.element = function (el) {
  if (!this.url) return;
  el.setInnerContent('<img src="' + _attrEsc(this.url) + '" alt="' + _attrEsc(this.alt || '') + '" loading="eager">', { html: true });
};

/* يحقن `window.__SCHOOL_BRAND__` ليقرأه سكربت الهوية المتزامن في الصفحة فيطلي فوراً
   **ويبذر كاشه المحلّي من أوّل زيارة**. و`__HOME_BRAND__` مرادفٌ له للتوافق مع
   `home/Index.html` القائم (تُقرأ هناك عند `__homeApplyCachedBrand`).
   🔴 `<` يُهرَّب إلى `<` داخل JSON: بلا ذلك يكفي أن يحمل اسمُ مدرسةٍ `</script>`
   لكسر الوثيقة كلّها — والاسم يأتي من شيت يحرّره بشر. */
function _BrandHead(brand) { this.brand = brand; }
_BrandHead.prototype.element = function (el) {
  var json = JSON.stringify(this.brand).replace(/</g, '\\u003c');
  el.append('<script>window.__SCHOOL_BRAND__=' + json + ';window.__HOME_BRAND__=window.__SCHOOL_BRAND__;</' + 'script>', { html: true });
};

/* 🟢 **روابطُ البوّابات تحمل المدرسةَ في الـHTML الخام (2026-09-19).**
   العلّة المقيسة: `a[data-portal]` في `home/Index.html` مكتوبٌ عارياً (‏`href="/teacher/index.html"`)
   ويكمّله العميلُ من الهويّة المحقونة **أو** من حمولة GAS. والحقنُ مشروطٌ بكاش الحافّة **لكلّ
   مركز بيانات** (قِيس: MUC ⇒ `schoolId` محقون · CDG ⇒ لا شيء)، وتحديثُه الخلفيّ بمهلة 8ث تحت
   الإشباع ⇒ زرُّ البوّابة يبقى عارياً، **وللأبد إن أُجهض النداء** ⇒ يهبط زائرُ المدرسة على
   «اختر مدرستك».
   🎯 والرافعة: المفتاحُ معروفٌ **من المسار وحده بلا GAS** (‏`_tenantKey` بعد `_tenantCanonical`)
   ⇒ الرابطُ صحيحٌ قبل أيّ JS وأيّ كاش. والعميلُ يعيد كتابته بالـUUID القانونيّ حين تصل الحمولة
   (‏`_homePortalHref` يمسح الاستعلام ثمّ يضيف `?school=` — لا يقرأ ما كتبناه).
   🔒 قائمةٌ بيضاء لقيمتين بـ`hasOwnProperty` (لا `obj[k]` — `constructor` يتخطّى الفحص)،
   والمفتاحُ مرّ ببوّابة الشكل (slug منشور أو UUID) ويُهرَّب بـ`encodeURIComponent`. */
var _PORTAL_BASE = { teacher: '/teacher/index.html', student: '/student/index.html' };
function _portalHref(kind, key) {
  var k = String(kind || '');
  if (!Object.prototype.hasOwnProperty.call(_PORTAL_BASE, k) || !key) return '';
  return _PORTAL_BASE[k] + '?school=' + encodeURIComponent(String(key));
}
/* 🟢 **`window.SCHOOL_ID` من الوسيط على صفحة الـslug (2026-09-19).**
   العلّة المقيسة: `gas-bridge.js` يأخذ `schoolId` من `window.SCHOOL_ID`، وصفحةُ `home` تملؤه
   من `?school=` وحده ⇒ على `/<slug>` يسافر النداءُ بلا هويّةٍ قانونيّة، فيُفتح مدخلُ كاشٍ
   منفصلٌ عن `?school=<uuid>` لنفس المدرسة. والمفتاحُ القانونيُّ محلولٌ هنا أصلاً
   (‏`_tenantCanonical`) ⇒ يُحقَن **أوّلَ `<head>`** فيسبق سكربتَ الصفحة الذي يحفظه
   (`… || window.SCHOOL_ID`)، ويعيده `__homeTenantKey` ⇒ مدخلٌ واحدٌ للشكلين.
   🔒 **UUID حصراً** — slugٌ لم يُحَلّ لا يُحقَن (الصفحةُ تعمل كما كانت). والقيمةُ مطابقةٌ
   للشكل فلا تحمل محرفاً يكسر السكربت، ومع ذلك تُكتب بـ`JSON.stringify`. */
function _schoolIdScript(key) {
  var k = String(key || '');
  if (!_SCHOOL_UUID_RE.test(k)) return '';
  return '<script>window.SCHOOL_ID=window.SCHOOL_ID||' + JSON.stringify(k.toLowerCase()) + ';</' + 'script>';
}
function _SchoolIdHead(key) { this.html = _schoolIdScript(key); }
_SchoolIdHead.prototype.element = function (el) {
  if (this.html) el.prepend(this.html, { html: true });
};
function _PortalHref(key) { this.key = key; }
_PortalHref.prototype.element = function (el) {
  var h = _portalHref(el.getAttribute('data-portal'), this.key);
  if (h) el.setAttribute('href', h);
};

/* لاحقة عنوان التبويب — **نسخةٌ ثالثة بالضرورة**: هذا مستودع منفصل عن `SchoolApp-gas`
   وGAS لا يشارك كوداً معه. يحرس تطابقها الحرفي مع `__homeDocTitle` هناك حارسٌ في
   `test-routes.js`؛ انحرافُها يجعل العنوان **يقفز** لحظة وصول الحمولة بدل أن يستقرّ. */
function _brandDocTitle(name, tagline) {
  return name + (tagline ? ' — ' + tagline : '') + ' | يمن سكولز';
}

/* يُلحِق معالجات الهوية بسلسلة `HTMLRewriter` قائمة. مفصولٌ في دالّة كي تستعمله
   المسارات كلّها بلا نسخ ثانٍ ينحرف.
   `surface` ∈ `home` (الافتراضي) · `teacher` · `student` — راجع `_brandSurfaceFor`:
   · `home`: كما كان + خانات الاتصال (‏`#tbPhone` …) التي تبقى **مخفيّةً** حتى يصل
     خطّاف `data-brand-host` من المصدر (يُكتب النصّ فقط؛ الحاوية `<span hidden>` بلا معرّف).
   · `teacher`/`student`: **بلا `title` ولا وسوم OG** — العميل يملك العنوان هناك، ووسوم
     OG غائبة أصلاً و`_AttrSet` لا يُنشئ غائباً. الشعار حاوية <div> تُملأ بـ`_LogoInner`. */
function _brandRewrite(rw, brand, surface) {
  var sf = surface || 'home';
  rw = rw.on('.school-brand-name', new _TextSet(brand.name))
         .on('[data-brand="name"]', new _BrandField(brand.name))
         .on('head', new _BrandHead(brand));
  if (sf === 'home') {
    rw = rw.on('title', new _TextSet(_brandDocTitle(brand.name, brand.tagline)))
           .on('meta[property="og:title"]', new _AttrSet('content', brand.name));
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
  }
  if (brand.logo) {
    rw = rw.on('[data-brand="logo"]', new _BrandField(brand.logo));
    if (sf === 'teacher') {
      rw = rw.on('#tchLoginLogo', new _LogoInner(brand.logo, brand.name))
             .on('#tchNavLogo', new _LogoInner(brand.logo, brand.name));
    } else if (sf === 'student') {
      rw = rw.on('#stuLoginLogo', new _LogoInner(brand.logo, brand.name))
             .on('#stuNavLogo', new _LogoInner(brand.logo, brand.name));
    }
  }
  if (brand.phone) {
    rw = rw.on('[data-brand="phone"]', new _BrandField(brand.phone))
           .on('[data-brand-host="phone"]', new _Unhide())
           .on('[data-brand-href="phone"]', new _AttrSet('href', 'tel:' + brand.phone));
    if (sf === 'home') rw = rw.on('#tbPhone', new _TextSet(brand.phone)).on('#fcPhone', new _TextSet(brand.phone));
    /* 🔴 صيغةُ الأيقونة مطابقةٌ حرفياً لما يكتبه `applyBrand` في مستودع الـgas
       (‏`_stu-js-boot-runtime.html` و`_tcRenderLoginContact`) — وإلّا **قفز النصّ**
       لحظةَ وصول الحمولة بدل أن يستقرّ. نفسُ علّة `_brandDocTitle` مع `__homeDocTitle`. */
    if (sf === 'student') rw = rw.on('#stuLoginContact', new _TextSet('📞 ' + brand.phone));
    if (sf === 'teacher') rw = rw.on('#tchLoginContact', new _TextSet('📞 ' + brand.phone));
  }
  if (brand.address) {
    rw = rw.on('[data-brand="address"]', new _BrandField(brand.address))
           .on('[data-brand-host="address"]', new _Unhide());
    if (sf === 'home') rw = rw.on('#tbAddr', new _TextSet(brand.address)).on('#ftAddr', new _TextSet(brand.address));
    if (sf === 'student') rw = rw.on('#stuLoginAddress', new _TextSet('📍 ' + brand.address));
    if (sf === 'teacher') rw = rw.on('#tchLoginAddress', new _TextSet('📍 ' + brand.address));
  }
  if (brand.whatsapp) {
    /* 🔴 رمزُ الدولة يُضاف **هنا وحده**: العرضُ يبقى خاماً (عقدُ الـgas) و`wa.me` يشترط
       الرقمَ الدوليّ كاملاً — `wa.me/775189922` لا يفتح محادثةً أصلاً. */
    var waDigits = _brandDigits(_brandPhone(brand.whatsapp));
    rw = rw.on('[data-brand="whatsapp"]', new _BrandField(brand.whatsapp))
           .on('[data-brand-host="whatsapp"]', new _Unhide());
    if (waDigits) rw = rw.on('[data-brand-href="whatsapp"]', new _AttrSet('href', 'https://wa.me/' + waDigits));
    if (sf === 'home') rw = rw.on('#tbWa', new _TextSet(brand.whatsapp)).on('#fcWa', new _TextSet(brand.whatsapp));
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
    // 🔴 **واستثناءٌ ثانٍ من نفس الفئة — `/.well-known/` لا يُحوَّل (مقيسٌ 2026-09-01):**
    //   المانيفستُ في التطبيق المنشور يعلن **مضيفَين** بـ`autoVerify="true"`:
    //   `yemenschoolz.com` **و`www.yemenschoolz.com`** (‏`AndroidManifest.xml:101-106`،
    //   بلا `android:path` ⇒ كلُّ المسارات). وتحقّقُ Digital Asset Links **لا يتبع
    //   التحويلات**: يطلب الملفَّ من كلِّ مضيفٍ معلَن ويشترط 200 مباشرةً.
    //   والقياسُ الذي كشفه: `curl -D - https://www.yemenschoolz.com/.well-known/assetlinks.json`
    //   ⇒ **301 · `Content-Length: 0`** بينما الجذرُ يردّ **200 · `application/json`**
    //   ⇒ مضيفُ `www` **يفشل تحقّقُه صامتاً** — بلا رسالةٍ في أيّ مكان.
    //   والأثرُ المحتمل: App Links و**WebAuthn** («الدخول بالبصمة») لمستخدمي `vc31`.
    //   ⚠️ **وما لم يُقَس بعد:** أيُسقط فشلُ `www` تحقّقَ الجذر معه أم يبقى الجذرُ وحده
    //   متحقّقاً؟ يُقاس بـ`adb shell pm get-app-links com.proconrers.schoolappyemen`،
    //   ولا يُحسم استنتاجاً — والعلاجُ أدناه صحيحٌ في الحالين وكلفتُه صفر.
    //   🔑 والعلاجُ **جراحيّ لا إلغاء** كسابقه: `/.well-known/` وحده يُعفى (‏بادئةً
    //   حرفية)، وكلُّ ما عداه من `www` يبقى محوَّلاً كما هو. وهو **أرخص الخيارين**:
    //   البديلُ حذفُ `www` من المانيفست، ويلزمه إصدارٌ جديد **ولا يُصلح المثبَّتَ اليوم**.
    if (REDIRECT_TO_CANONICAL[url.hostname] && path.indexOf('/.well-known/') !== 0) {
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

      /* 🗑️ **تطبيقٌ متقاعدٌ مشروعُه غيرُ موجود ⇒ 410 صريحٌ بلا نداءٍ على Google (2026-09-19).**
         قِيس حيّاً: `/gas/schedule?action=health` كان يعيد **صفحةَ خطأ HTML من Google (5.5 ك.ب)
         بحالة 200 وبعنوان JSON** — مشروعُ الجدول لم يعد موجوداً (جلسة `SchoolApp-gas`: غيرُ موجود
         في Drive)، فـ«مسارُ التراجع الخامل» الموصوف في الحارس صار ميتاً. ⇒ ردٌّ صادقٌ مقروءٌ آلياً،
         وصفرُ نداءٍ على الحصّة. وصفرُ مستهلكٍ عبر الوسيط في ٣ أيام قِيست.
         🔒 **ولا يُحذف معرّفُ النشرة من `GAS`** (سياسةُ المعرّفات، ويحرسه `test-routes.js`)، **ولا
         يُمسّ المسارُ الثابت `/schedule/index.html`** (صفحةُ إعلان التقاعد — حزمُ الأندرويد تحمله). */
      if (Object.prototype.hasOwnProperty.call(_RETIRED_GAS_APPS, app)) {
        return jsonResponse({ ok: false, retired: true, app: app,
          error: 'هذه الخدمة متقاعدة — ' + _RETIRED_GAS_APPS[app] }, 410);
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
      // قد تكون ضخمة. **لا يُسجَّل أي شيء آخر من الجسم إطلاقاً** — args تحمل توكنات
      // وأسماء طلاب، والمجموعةُ قائمةٌ بيضاءُ صارمة (بلا اقتباسٍ ولا سطرٍ جديد) فلا حقن.
      //
      // 🔴 **أُضيفت `_` إلى المجموعة 2026-09-10 — والعطبُ كان فقدَ إسنادٍ صامتاً:**
      // كانت المجموعة `[A-Za-z][A-Za-z0-9]{0,63}` **تستثني الشرطةَ السفلية** ⇒ كلُّ دالّةٍ
      // اسمُها فيه `_` تُسجَّل بـ`fn` **فارغاً** ⇒ **تسقط من أيّ تجميعٍ بـ`fn`** ⇒ السجلُّ
      // يقول «`teacher` بطيء» ولا يقول أيَّ دالّة — وهو بعينه ما وُجد هذا الحقلُ لمنعه.
      // ⚠️ **والشاهدُ ميدانيٌّ لا نظريّ:** سجلُّ متصفّح المالك (‏2026-09-10T02:06Z) أظهر
      //    **`smm_loadPlan`** و**`smm_loadAccounts`** تُخفقان بـ502، **وكلتاهما غائبةٌ تماماً
      //    عن تجميع `fn` في نفس النافذة** ⇒ **الدوالُّ التي رآها المستخدمُ تفشل كانت
      //    الأعجزَ عن الظهور في إسنادنا.**
      // 🔴 **والتعليقُ القديم كان يبرّر التضييق بأنه «مطابقٌ لما يفرضه الخادم في
      //    `_apiIsBlocked`» — و`_apiIsBlocked` غيرُ موجودٍ في هذا الملفّ إطلاقاً** (قِيس:
      //    صفرُ تعريف)، أي أن **الوركرَ لا يفرض هذا النمطَ على أحد**؛ كان يضيّق **سجلَّه**
      //    وحدَه بحجّةٍ تخصّ مستودعاً آخر. ⇒ **حجّةُ تضييقٍ مستعارةٌ من سطحٍ لا تسري عليه.**
      // 🟢 والأمنُ محفوظ: الإضافةُ حرفٌ واحدٌ إلى قائمةٍ بيضاء، والسقفُ ٦٤ محرفاً كما هو.
      var _bhFn = '';
      try {
        var _bhHead = (init.body || '').slice(0, 200);
        var _bhM = _bhHead.match(/"fn"\s*:\s*"([A-Za-z][A-Za-z0-9_]{0,63})"/);
        if (_bhM) _bhFn = _bhM[1];
      } catch (e) { /* لا نُفشِل طلباً بسبب سجلّ */ }

      // ── حدُّ تسجيل المشاهدات العامّة لكلّ IP — قبل الكاش والمقعد (انظر `_publicViewRate`) ──
      var _pvFn = (request.method === 'POST' && app === 'home') ? _publicViewFnOf(init.body) : '';
      if (_pvFn && !_publicViewRate(request.headers.get('CF-Connecting-IP'), Date.now())) {
        _bhLog({ ev: 'pubview', act: 'throttle', app: app, fn: _pvFn });
        return withCors(new Response(
          JSON.stringify({ ok: true, result: { success: true, throttled: true, recorded: 0 } }),
          { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8',
                                    'Cache-Control': 'no-store' } }));
      }

      // ── كاشُ الحافّة: يُعترَض **قبل حجز المقعد** ─────────────────────────────
      // 🔴 الموضع مقصود: هنا وحدها يكون `init.body` مقروءاً و**لا مقعد مأخوذ بعد** ⇒
      // إصابةُ الكاش تتخطّى `_bhAcquire` كلّياً فلا تستهلك من السقف. لو وُضع بعد الحجز
      // لأخذ مقعداً بلا داعٍ — أي أن أنجحَ حالةٍ تُنفق أغلى مورد.
      // ⚠️ و`?action=health` معفىً هنا أيضاً بنفس سبب إعفائه من المنظّم أدناه: أداةُ
      // تشخيصٍ تُجيب من كاشٍ لا تُخبرنا عن حال GAS، بل تُخفي بالضبط ما نُشخّصه بها.
      /* 🔒 و`url.search` **يجب أن يكون فارغاً**: الوسيط يمرّرها حرفياً إلى GAS
         (`fullTarget = target + url.search` أدناه) وهي **ليست** في مفتاح الكاش.
         قِيس أن لا `doPost` في السبعة يقرأ `e.parameter` اليوم ⇒ لا استغلال حيّ —
         لكنّ أوّل دالّةٍ تقرأ معاملاً تفتح تسميمَ كاشٍ فوريّاً. الاشتراطُ هنا يقفل
         البُعد كلَّه بسطرٍ واحد بدل أن يعتمد على بقاء حقيقةٍ في مستودعٍ آخر.
         (‏`app=student` يُلحقه الوسيط **بعد** هذه النقطة فلا يتأثّر.) */
      var _acProbe = null;
      /* مدخلٌ فقد طزاجتَه وما زال داخل نافذة البيات — يُخدَم **عند `abort_budget` وحده**
         (أدناه عند نقطة الخروج) — ومنذ 2026-09-19 يُخدَم أوّلاً بـSWR عند المطابقة (انظر فرعَ `stale` أدناه). */
      var _acStale = null;
      if (request.method !== 'GET' && url.search === '') {
        _acProbe = _apiCacheProbe(init.body);
        /* دالّةٌ مؤهَّلةٌ اسماً لكنّ شكلَها رُفض ⇒ سطرٌ واحد. بلا هذا تبقى الميزةُ خامدةً
           لأكبر مستهلكيها والسجلُّ يبدو طبيعياً — وهي فئةُ الفشل الصامت بعينها. */
        if (_acProbe && _acProbe.reject) {
          _bhLog({ ev: 'apicache', act: 'nokey', app: app, fn: _acProbe.fn, why: _acProbe.reject });
          _acProbe = null;
        }
        if (_acProbe) {
          var _acHit = await _apiCacheGet(url.origin, app, _acProbe);
          if (_acHit) {
            /* 🔴 البوّابةُ صريحةٌ هنا لأن `match` لم تعُد تفرضها (انظر `_apiCacheFreshness`).
               والبائتُ يُخدَم هنا **فوراً مع تحديثٍ خلفيّ** (SWR · 2026-09-19 — أدناه)، أو للتراجع عند الإجهاض حين لا `ctx`. */
            var _acFresh = _apiCacheFreshness(_acProbe.fn, _acHit.age);
            if (_acFresh === 'fresh') {
              _bhLog({ ev: 'apicache', act: 'hit', app: app, fn: _acProbe.fn,
                       k: _apiKeyFp(_acProbe.argsKey),
                       age: _acHit.age, n: _bhN, q: _bhQ.length });
              return withCors(new Response(_acHit.text, {
                status: 200,
                /* 🔬 `X-Api-Cache` (2026-09-19): حالةُ كاش الحافّة رأساً لا حقلاً في الجسم — كي تُقاس
                   الإصابةُ من الخارج حين تعجز أداةُ السجلّات (وقد عجزت: ردٌّ ~1000ms بلا رأسٍ
                   لم يكن ممكناً فصلُه بين «إخفاقٍ ذهب إلى GAS» و«إصابةٍ بطيئة»). */
                headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Api-Cache': 'hit' }
              }));
            }
            /* 🟢 **stale-while-revalidate — قرارُ المالك 2026-09-19.** كان البائتُ يُخدَم عند
               `abort_budget` وحده ⇒ أوّلُ زائرٍ بعد انقضاء الطزاجة ينتظر GAS، وقِيس اليومَ
               **22–24ث** تحت الإشباع؛ والمدرسةُ قليلةُ الزيارة **كلُّ زائرٍ فيها «أوّلُ زائر»**.
               ⇒ يُخدَم البائتُ **فوراً** ويُحدَّث المدخلُ في الخلفية **مرّةً واحدة** (مُوحَّداً
               داخل الـisolate، وبمقعدٍ من المنظّم بلا انتظار). ⚖️ **المقايضةُ المُقرَّة:** قد
               يرى زائرٌ محتوىً عمرُه حتى `ttl + API_STALE_MAX_S`، والتالي يرى المحدَّث.
               🔒 والحِملُ على GAS **لا يزيد**: التحديثُ نداءٌ واحدٌ كان الزائرُ سيُطلقه أصلاً. */
            if (_acFresh === 'stale' && ctx && ctx.waitUntil) {
              var _swrProbe = _acProbe, _swrApp = app, _swrOrigin = url.origin, _swrBody = init.body;
              _bhLog({ ev: 'apicache', act: 'swr', app: app, fn: _acProbe.fn,
                       k: _apiKeyFp(_acProbe.argsKey), age: _acHit.age });
              ctx.waitUntil(_apiCacheRevalidate(_swrOrigin, _swrApp, _swrProbe, _swrBody, env).then(function (why) {
                _bhLog({ ev: 'apicache', act: 'reval', app: _swrApp, fn: _swrProbe.fn,
                         k: _apiKeyFp(_swrProbe.argsKey), why: why });
              }));
              return withCors(new Response(_acHit.text, {
                status: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8',
                           'X-Api-Cache': 'stale',
                           'X-Api-Stale': String(_acHit.age) }
              }));
            }
            /* 🔒 يُلتقَط **من نفس القراءة** — صفرُ مراجعةٍ إضافيّةٍ للكاش على المسار الحارّ. */
            if (_acFresh === 'stale') _acStale = _acHit;
          }
        }
      }

      // ── حَجز مقعد قبل إطلاق أي محاولة نحو GAS (منظّم التزاحم) ───────────────
      // فحوصات الصحّة مُعفاة عمداً: ?action=health أداة تشخيص يجب أن تُخبرنا عن حال
      // GAS نفسه لا عن حال المنظّم — حَكْمها يُخفي بالضبط الحالة التي نُشخّصها بها.
      // حجمها ضئيل (استدعاء يدوي/تشغيلي) فتُحتسَب ضمن الهامش المتروك من الثلاثين.
      var _bhMode   = (env && env.BULKHEAD_MODE) || 'on';
      var _bhExempt = url.searchParams.get('action') === 'health';
      var _bhOn     = (_bhMode !== 'off') && !_bhExempt;
      var _bhT0     = Date.now();
      var _bhHeld   = null;   // كائنُ المقعد المملوك — يُعاد بعينه إلى `_bhRelease`
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
          _bhHeld = _bhTake(app);         // يبقى الحساب متوازناً مع التحرير في finally
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
      // تطبيقات GAS تُرجع أحيانًا 404 أو صفحة HTML اعتراضية بشكل متقطّع بدل تنفيذ الدالة.
      // 🔴 حُذف الرقم «~6%» 2026-09-08: أعلنته CLAUDE.md بائداً وقالت إنه «حُذف» — وكان قد
      //    حُذف من الوثيقة وحدها وبقي هنا موضعين ⇒ الوثيقةُ والمصدرُ يتناقضان. ولا يُستبدَل
      //    برقمٍ آخر: نسبةُ الاعتراض المتقطّع هذه لم تُقَس مستقلّةً عن إشباع الحصّة قطّ.
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
      /* 🔴 **سببُ الإخفاق حقلاً مبنيَّ الشكل — لا نصّاً عربياً في الجسم (2026-09-10).**
       *
       * العلّةُ التي يغلقها، وقعت اليوم وكلّفت ساعات: سُئلتُ «هل يميّز الوركرُ بين
       * «أنا أجهضتُ» و«GAS ردّ بخطأ»؟» فكان الجوابُ **نعم — بنصّ الجسم**. وذلك يكفي
       * قارئاً بشرياً في DevTools **ولا يكفي استعلاماً**: لا يُجمَّع، ولا يُفرَز، ويتغيّر
       * بأوّل تحريرٍ لصياغة. ⇒ **كان كلُّ ٥٠٢ سواءً في السجلّ، فبحثنا عن العطل في
       * المنبع ثلاث مرّاتٍ والمنبعُ سليم.**
       * 🎯 والفرقُ عمليٌّ لا تصنيفيّ: `abort` علاجُه **زمنُ GAS أو الميزانية** ·
       *    `upstream` علاجُه **كودُ GAS** · و`transport` علاجُه **الشبكة** — ثلاثةُ
       *    مستودعاتٍ مختلفة، وكانت تُقرأ رمزاً واحداً.
       * 🟢 ويُكتب في السجلّ وحدَه — **الجسمُ لا يتغيّر بحرف**، فلا يمسّ عميلاً ولا APK. */
      var _bhWhy = 'ok';
      // فاصل واحد بين المحاولتين — يمتصّ اعتراض/برود GAS المتقطّع قبل إرجاع HTML للجسر.
      // (‏«~6%» حُذف هنا أيضاً 2026-09-08 — انظر التعليق عند بداية حلقة المحاولات.)
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
      // مسار /exec (`redirect:'follow'`) لا يُحسَب بدقّة داخل مهلة كل محاولة.
      //
      // 🔴 **والوصفُ القديم لهذا السطر بائتٌ منذ `web#150` — يُصحَّح لا يُحذف:** كان يقول
      // «القيم الحالية (11500ms × محاولتين + فاصل 700ms ≈ 23700ms) … مهلة كل محاولة **ثابتة**
      // (لا تتقلّص مع الميزانية المتبقّية)». وهذا **نقيضُ** الكود اليوم: لا `PER_ATTEMPT_TIMEOUT_MS`
      // بعد الآن، ومهلةُ المحاولة = **ما تبقّى من الميزانية** (‏`_gasAttemptPlan` أعلى الملفّ)،
      // وفشلُ المهلة **لا يُعيد المحاولة** (‏`_gasShouldRetry`). صدفةً يبقى أسوأُ زمنٍ **23,700ms**
      // كما كان — لكن اشتقاقُه صار ‏`TOTAL_BUDGET_MS (24000) − GAS_ATTEMPT_MARGIN_MS (300)`
      // لا ضرباً في عدد المحاولات. ⇒ **رقمٌ واحد باشتقاقين متعاكسين**، وهو بالضبط ما يجعل
      // التعليقَ البائت يمرّ بلا أن يحمرّ شيء. يقيسه `worker/test-routes.js` ويطبعه.
      var loopStart = Date.now();
      // ⚠️ زمن انتظار الطابور **يُخصَم** من الميزانية ولا يُضاف فوقها. إضافته كانت
      // ستُعيد إنتاج الفشل الموثَّق أعلاه بالضبط: القيمة الأوّلية (45000/20000) أعطت
      // ~63.6 ثانية فعلية وتجاوزت مهلة العميل، لأن ثمّة زمناً غير محسوب لاتّباع
      // إعادة توجيه Google لا يدخل في مهلة المحاولة (ويؤكّده أن فحص الميزانية أدناه
      // يحرس **بداية** المحاولة لا نهايتها) — أي أن 24000 ليست سقفاً صلباً أصلاً.
      // بالخصم: أسوأ زمن إجمالي يبقى كما هو اليوم حرفياً. الثمن أن طلباً انتظر طويلاً
      // قد يحصل على محاولة واحدة بدل اثنتين — وهو السلوك الصحيح لا تدهور: تحت إشباع
      // الحصة، إعادة المحاولة تضاعف الحمل بلا فائدة (نفس درس حادثة 2026-07-28).
      /* 🔴 **سقفان لا واحد — والفرقُ بنيويٌّ لا معايرة (‏2026-09-21).**
         قِيس من سطحين: لوحةُ Executions تُظهر GAS **يُتمّ** حتى `25.7–27.8`ث بينما الوركرُ
         يُجهض عند `23,700` ⇒ **`502` على عملٍ نجح**؛ المستخدمُ يرى فشلاً وعملُه قد تمّ.
         و`abort_budget` = **٦٩١ من ٧١٦ إخفاقاً (٩٦٫٥٪)** في ٤٤ ساعة، ورفضُ المنظّم **٨٠ فقط**
         ⇒ النظامُ **بطيءٌ ونحن نقطعه**، لا مشبَع.

         🔴 **ولماذا `doPost` وحدَها:** الحدُّ الحاكمُ `_LOGIN_TIMEOUT = 28000` في
         `gas-bridge.js` يشمل **التنفيذَ والنقلَ معاً**.
           · `doPost` يعيد JSON صغيراً ⇒ المتبقّي **زمنُ كمونٍ** ⇒ 1,500ms معقول.
           · `doGet` يعيد صفحةً **٦٢٥ ك.ب على السلك** ⇒ **~٥ث نقلاً على 1Mbps** ⇒ لو نفّذ
             ٢٦ث لتجاوز النقلُ بعده حدَّ العميل **حتماً** ⇒ رفعُه **يشتري احتجازَ تنفيذٍ
             لا تسليماً** — وهو بعينه سببُ رفضِ ٣٠٬٠٠٠.
         🟢 ومكسبٌ ثانٍ: `doGet` مرّةٌ لكلّ جلسة و`doPost` عشراتٌ ⇒ **المكسبُ حيث التكرار،
         والخطرُ يبقى حيث لم نلمس.**

         🔴 **ولماذا 26,000 لا 26,500:** العقدُ المنشور `worker/login-fns-contract.json`
         يفرض `requiredClientMarginMs = 2000`. وأسوأُ زمنٍ = السقف − `GAS_ATTEMPT_MARGIN_MS`
         ⇒ ‏26,500 يعطي **26,200** وهامشاً **1,800 < 2,000** ⇒ **يخرق العقد**؛
         و‏26,000 يعطي **25,700** وهامشاً **2,300** ⇒ مطابق.
         🔴 **ولا يُرفَع `requiredClientMarginMs` لتمرير رقم — ذلك علاجٌ بتغيير المقياس.**

         ⚠️ **والهامشُ تقديرٌ لا قياس:** زمنُ الحافّة→اليمن **غيرُ مقيسٍ عندنا** — كلُّ
         قياساتنا عبر نفقٍ أوروبيٍّ أو من جهاز المالك. ⇒ لا يُضيَّق أكثر بلا قياس.

         🔴 **ويبقى صنفٌ لا يُسلَّم مهما فعل الوركر:** تنفيذٌ فوق `_LOGIN_TIMEOUT` (قِيس
         ‏27,816ms **ليلاً**، والذيلُ النهاريُّ أعلى ولم يُقَس) ⇒ **مسكّنٌ مقيسُ الحدّ،
         وتقصيرُ زمن GAS هو المسار.**
         📖 `_docs/2026-09-21-سقف-الإجهاض-من-جهة-الوركر.md` · وبند
            `gas-abort-ceiling-raised-doPost-26500` يحمل خطَّ الأساس النهاريّ. */
      var TOTAL_BUDGET_MS = (isPost ? 26000 : 24000) - _bhWaited;
      /* 🔴 **مهلةُ المحاولة صارت الميزانيةَ المتبقّية لا `PER_ATTEMPT_TIMEOUT_MS = 11500`
         الثابتة (‏2026-08-29).** القياسُ الحيّ: نداءُ صحّةٍ **مكاش** استغرق 20,958ms ونجح،
         بينما الثابتُ يُجهضه عند 11,500ms ثمّ يفتح تنفيذاً ثانياً على حصّةٍ مشبَعة أصلاً.
         التفصيلُ والقياسُ الكامل عند تعريف `_gasAttemptPlan` أعلى الملفّ. */
      for (attempt = 0; attempt < GAS_MAX_ATTEMPTS; attempt++) {
        var elapsedBeforeAttempt = Date.now() - loopStart;
        /* 🔴 **الحارسُ يستشرف نهايةَ المحاولة لا بدايتَها فقط (‏2026-08-26).** كان
           `elapsed >= TOTAL_BUDGET_MS` وحده، فمحاولةٌ تبدأ **داخل** الميزانية تنتهي
           **خارجها** بأحد عشر ألفاً ونصف. وبقي غيرَ مؤذٍ ما دام `_bhWaited ≈ 0` في وضع
           الظلّ — **وتفعيلُ `on` هو ما جعله مؤذياً**: انتظارُ طابورٍ 11,000ms كان يُنتج
           ‏11,000 + 23,700 = **34,700ms** مقابل `_LOGIN_TIMEOUT = 28,000` عند العميل ⇒
           العميل يقطع ويُعلن «تعذّر تسجيل الدخول» **بينما الوسيط ما يزال يحتجز مقعد GAS**.
           بالاستشراف: المحاولة لا تبدأ إلا إن كانت ستنتهي داخل الميزانية ⇒ الزمن الكلّي
           ‏(انتظارٌ + حلقة) ‏**مسقوفٌ بـ24,000ms مهما بلغ الانتظار** — وهو ما كان التعليق
           أعلاه يَعِد به ولا يُنفّذه. والثمن: طلبٌ انتظر طويلاً يأخذ محاولةً واحدة بدل
           اثنتين — وهو السلوك الصحيح تحت الإشباع لا تدهور (درس 2026-07-28). */
        var _plan = _gasAttemptPlan(elapsedBeforeAttempt, TOTAL_BUDGET_MS);
        if (!_plan.go) break;
        var controller = new AbortController();
        /* 🔴 **علَمٌ صريح لا `err.name === 'AbortError'`:** الإجهاضُ قد يأتي من غير مؤقّتنا
           (قطعُ العميل مثلاً)، فالاستدلالُ بنوع الخطأ يخلط سببين علاجُهما متعاكس. */
        var timedOut = false;
        /* 🔬 **عيّنةُ الظلّ تُقرَّر قبل المؤقّت لا داخله** — قرارٌ داخل المؤقّت يجعل
           المسارَين يفترقان في لحظةٍ لا نتحكّم بها، فيصير السلوكُ غيرَ قابلٍ للتفسير. */
        var _shadowThis = _shadowOn(env) && !!(ctx && ctx.waitUntil) && (Math.random() < SHADOW_SAMPLE);
        var abortTimer = setTimeout(function () {
          timedOut = true;
          /* 🔴 المسارُ العاديُّ يُجهض كما كان حرفياً. وعيّنةُ الظلّ **لا تُجهَض هنا** —
             تُترك حيّةً ويُسلَّم وعدُها إلى `waitUntil` أدناه. */
          if (!_shadowThis) controller.abort();
        }, _plan.timeoutMs);
        init.signal = controller.signal;
        try {
          var _attemptAt = Date.now();
          var _fetchP = fetch(fullTarget, init);
          var gasResp;
          if (_shadowThis) {
            /* 🔴 **سباقٌ لا انتظار:** المستخدمُ يُخدَم في موعده بالضبط، والوعدُ يبقى حيّاً
               للظلّ. ولولا السباق لَحجب الانتظارُ الردَّ حتى يكتمل — أي لقِسنا بتغيير ما نقيس. */
            var _raced = await Promise.race([_fetchP, new Promise(function (r) {
              setTimeout(function () { r(_SHADOW_TIMEOUT); }, _plan.timeoutMs);
            })]);
            if (_raced === _SHADOW_TIMEOUT) {
              ctx.waitUntil(_shadowWatch(_fetchP, controller, _attemptAt, app, _bhFn, _plan.timeoutMs));
              /* 🔴 **يُرمى عمداً ليمرّ بكتلة `catch` أدناه نفسِها** — و`timedOut` مرفوعٌ
                 سلفاً من المؤقّت ⇒ `_bhWhy = 'abort_budget'` · ورسالةُ «مزدحمة» · ورمزُ 502
                 · وقرارُ عدم الإعادة (`_gasShouldRetry`) **كلُّها بلا أيّ فرق.**
                 ⇒ **مسارٌ واحدٌ للمستخدم، وفرعٌ واحدٌ للقياس.** */
              throw new Error('shadow_budget');
            }
            gasResp = _raced;
          } else {
            gasResp = await _fetchP;
          }
          lastText = await gasResp.text();
          lastStatus = gasResp.status;
          var looksHtml = lastText.charAt(0) === '<';
          good = gasResp.status >= 200 && gasResp.status < 400 && !(isPost && looksHtml);
          /* المنبعُ ردّ فعلاً — فالإخفاقُ إن وقع منه لا منّا. و`html` تُفصَل عن `status`
             لأن علاجَهما مختلف: الأولى اعتراضُ صفحةٍ من Google، والثانية خطأُ دالّة.
             🔴 **ورمزُ الحالة يُفحَص قبل شكل الجسم — قِيس 2026-09-14 (بند 243).** كان
             الشرطُ يبدأ بـ`isPost && looksHtml`، **وصفحةُ خطإ Google نفسُها HTML** ⇒ كلُّ
             ٤٠٤ تُصنَّف `upstream_html`، و`upstream_status` **فئةٌ لا تُملأ أبداً**.
             الأثرُ المقيس: `upstream_status = 0` مع `st:404 = 10` في النافذة نفسِها —
             **تطابقٌ تامّ بين عدّادَين يفترض أن يفترقا**، و١٨ حدثاً في ٢٤ ساعة على
             `doPost` حقيقيّ منها مساراتُ دخول. 🔴 **والخطرُ أن العَلَمَ يكذب في الاتّجاه
             الذي يُطمئن:** «صفرُ خطإ دالّة» تُقرأ صحّةً، وهي **نقصُ قياسٍ** لا سلامة.
             ⚠️ والترتيبُ الجديد يُبقي `upstream_html` على معناها الأصليّ وحدَه: ردٌّ
             **ناجحُ الحالة** يحمل صفحةً بدل JSON — وهو ما وُضعت له. */
          _bhWhy = good
            ? 'ok'
            : ((gasResp.status >= 200 && gasResp.status < 400 && isPost && looksHtml)
                ? 'upstream_html'
                : 'upstream_status');
          if (good) break;
        } catch (err) {
          lastStatus = 502;
          /* 🔴 `timedOut` علَمٌ صريحٌ من مؤقّتنا — لا `err.name`: الإجهاضُ قد يأتي من قطع
             العميل، والخلطُ يقلب العلاج. ونفسُ التمييز يُكتب في السجلّ حرفاً بحرف. */
          _bhWhy = timedOut ? 'abort_budget' : 'transport';
          /* 🔴 رسالتان لسببين مختلفين — لا `AbortError` خاماً في وجه المستخدم. «مزدحمة»
             تصف الإشباع بصدق، و«تعذّر الوصول» تبقى لفشل النقل وحده. */
          lastText = timedOut
            ? JSON.stringify({ ok: false, error: 'الخدمة مزدحمة حالياً — أعد المحاولة بعد لحظات.' })
            : JSON.stringify({ ok: false, error: 'تعذّر الوصول إلى الخادم: ' + String(err) });
        } finally {
          clearTimeout(abortTimer);
        }
        /* 🔴 **الخروجُ على فشل المهلة — جوهرُ الإصلاح.** تنفيذُ GAS ما زال جارياً على
           الخادم، فالمحاولةُ الثانية تفتح ثانياً بلا أن تُلغي الأول ⇒ مضاعفةُ استهلاك
           الحصّة في لحظة الإشباع (بند 128). وفشلُ النقل السريع يمرّ إلى إعادة المحاولة. */
        if (!_gasShouldRetry(timedOut, attempt, GAS_MAX_ATTEMPTS)) break;
        if ((Date.now() - loopStart) < TOTAL_BUDGET_MS) {
          /* 🔴 مقصوصٌ على المتبقّي من الميزانية — رصدَته المراجعة 2026-08-21: النوم كان
             غير مشروط بها، فطلبٌ انتظر 12ث ثم استغرقت محاولتُه 11.5ث كان يُضيف 700ms
             **بعد** أن صار `elapsed` تحت السقف بـ500ms وحدها، ثم تكسر الحلقة على أي حال
             ⇒ 700ms هدرٌ صافٍ فوق السقف المُعلَن. الفرق يهمّ لأن هامش الدخول ضيّق. */
          var _remain = TOTAL_BUDGET_MS - (Date.now() - loopStart);
          var _nap = Math.min(delays[attempt], Math.max(0, _remain));
          if (_nap > 0) await new Promise(function (r) { setTimeout(r, _nap); });
        }
      }
      /* ── تراجعٌ إلى نسخةٍ بائتة — **عند إجهاضنا نحن وحده** ────────────────────────
         🔴 **الشرطُ `abort_budget` لا `!good`، والفرقُ هو الميزةُ كلُّها:** `upstream_status`
         يعني أن الدالّةَ نفسَها أخفقت، و`upstream_html` اعتراضاً من Google — وخدمةُ نسخةٍ
         قديمةٍ فوق أيٍّ منهما **تُخفي عطلاً حقيقياً** بدل أن تسدّ فجوةَ إشباع. والإجهاضُ
         وحدَه يعني «كان لدينا ردٌّ صالحٌ ولم يَصِل في الوقت».
         ⚠️ **وسجلُّ `ev:'gas'` في `finally` يبقى `ok:false · why:abort_budget · st:502`
         عمداً** — فالمنبعُ أخفق فعلاً، والعميلُ خُدِم من الحافّة. ⇒ **لا يُقرأ هذا تناقضاً
         ولا «يُصلَح»:** لولاه لانخفض عدّادُ الإشباع بلا أن يتحسّن الإشباعُ نفسُه، وهو أسوأُ
         ما يمكن أن يحدث لقياسٍ نبني عليه قرارَ نشرٍ حيّ. القياسُ يبقى على المنبع، والراحةُ
         تُقاس بـ`act:'stale'` وحدَه. */
      if (!good && _bhWhy === 'abort_budget' && _acProbe && _acStale) {
        _bhLog({ ev: 'apicache', act: 'stale', app: app, fn: _acProbe.fn,
                 k: _apiKeyFp(_acProbe.argsKey), age: _acStale.age });
        return withCors(new Response(_acStale.text, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            /* رأسٌ تشخيصيٌّ لا يمسّ الجسم: الجسرُ يستهلك النصَّ خاماً، فأيُّ حقلٍ نضيفه
               داخل الحمولة قد يكسر مستهلكاً. والرأسُ يُقرأ بـ`curl -D -` وفي السجلّ. */
            'X-Api-Cache': 'stale-abort',
            'X-Api-Stale': String(_acStale.age)
          }
        }));
      }

      // عند استنفاد المحاولات لطلب JSON (POST) باستجابة غير صالحة (HTML/4xx):
      // أعِد JSON خطأ واضح بدل تمرير HTML يفشل JSON.parse في الجسر (netError مضلِّل «رد غير صالح»).
      if (!good && isPost) {
        var looksJson = lastText.charAt(0) === '{' || lastText.charAt(0) === '[';
        if (!looksJson) {
          return jsonResponse({ ok: false, error: 'تعذّر تنفيذ الطلب حالياً (اعتراض مؤقّت من الخادم). حاول مجدداً بعد لحظات.' }, 503);
        }
      }
      /* ── تخزينُ الردّ العامّ في كاش الحافّة ────────────────────────────────────
         🔴 عبر `ctx.waitUntil` حصراً: الكتابة **خارج مسار الاستجابة** فلا تُبطئ نداءً،
         ولا تلمس GAS فلا تحتاج مقعداً — و`_bhRelease` في `finally` لا يتأثّر بها.
         🔒 وشرطُ التخزين مزدوج: `good` (نقلٌ ناجح ليس HTML) **و**`ok(b)` الخاصّ بالدالّة
         (داخل `_apiCachePut`). ⇒ **لا كاش سلبيّ إطلاقاً** — تخزينُ الفشل يُثبّته ١٠ دقائق
         ويُقرأ «الإصلاح لم يعمل». */
      if (_acProbe && good && ctx && ctx.waitUntil) {
        var _acFn = _acProbe.fn, _acOrigin = url.origin, _acApp = app, _acText = lastText;
        /* 🔴 البصمةُ تُحسَب **هنا** لا داخل `then`: نفسُ سببِ التقاط `_acFn`/`_acApp` —
           الكولباك يجري بعد انتهاء الطلب، و`_acProbe` قد لا يبقى ما نظنّه حينها. */
        var _acKeyFp = _apiKeyFp(_acProbe.argsKey);
        ctx.waitUntil(_apiCachePut(_acOrigin, _acApp, _acProbe, _acText).then(function (stored) {
          _bhLog({ ev: 'apicache', act: stored ? 'store' : 'skip',
                   app: _acApp, fn: _acFn, k: _acKeyFp });
        }));
      }
      return withCors(new Response(lastText, {
        status: lastStatus,
        /* `miss` = مؤهَّلٌ ولم يُصَب (ذهب إلى GAS) · `none` = خارج القائمة البيضاء أو رُفض شكلُه. */
        headers: { 'Content-Type': 'application/json; charset=utf-8',
                   'X-Api-Cache': _acProbe ? 'miss' : 'none' }
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
        /* 🔴 `len` = **طولُ حمولة الردّ بالمحارف** (لا بالبايت — والعربيةُ حرفان بايتياً،
           فخلطُ الوحدتين أنتج «فرقَ ٢٨٥ك.ب» وهميّاً في هذه الجلسة نفسِها).
           **مجّانيٌّ تماماً:** `lastText` مُخزَّنٌ كاملاً أصلاً بـ`await gasResp.text()`
           أعلاه — صفرُ تخزينٍ إضافيّ وصفرُ تحليل.
           **ولماذا يلزم:** قِيس 2026-09-06 أن `getTeacherBootBundle` تُخفق **٥٩٫٥٪** مقابل
           **١٠٫٥٪** لبقيّة المنصّة، وأن `median(ms|ok)` لها **11,128** مقابل **6,631**
           ⇒ توزيعُها ملاصقٌ لسقف الميزانية. والفرضيّةُ المرشَّحة **«حمولةٌ أثقل تتجاوز
           السقف»** — واقتُرح قياسُها بحقلِ **دور**، 🔴 **وهو متعذّرٌ بنيويّاً هنا**: الجسر
           يرسل `{fn, args, schoolId}` **بلا أيّ دور**، فالوركرُ لا يراه أصلاً.
           ⇒ `len` يقيس **المتغيّرَ المسبِّبَ نفسَه** لا وكيلَه: ثقلُ الحمولة.
           🔒 **وطولٌ لا محتوى** — صفرُ بايتٍ من الجسم يدخل السجلّ. */
        /* `gv`/`dd` من ذيل الردّ (انظر `_gasTailMeta`) و`hr` ساعةُ UTC — ثلاثتُها أبعادُ
           تجميعٍ لـ`/dev-stats`: الساعةُ بلا سلاسلَ زمنيّةٍ من الـAPI (`granularity` لا يُحترَم
           مقيساً)، ونشرةُ GAS بجانب نسخة الوركر فيحمل كلُّ صفٍّ الطرفين معاً. */
        var _bhTail = _gasTailMeta(lastText);
        _bhLog({ ev: 'gas', app: app, fn: _bhFn, ms: Date.now() - _bhT0, waitMs: _bhWaited,
                 gasMs: Date.now() - _bhT0 - _bhWaited, n: _bhN, q: _bhQ.length,
                 st: lastStatus, ok: good, srv: _bhSrv, why: _bhWhy,
                 len: (typeof lastText === 'string') ? lastText.length : -1,
                 gv: _bhTail.gv, dd: _bhTail.dd, hr: new Date().toISOString().slice(0, 13) });
        // التحرير يغطّي نقاط الخروج كلها: الاستجابة العادية وأي استثناء غير متوقّع
        // (الرفض 503 يخرج قبل الـtry ولا يحجز مقعداً أصلاً). بلا هذا، أي مسار خروج
        // منسيّ يُسرّب مقعداً إلى الأبد ويُجمّد السقف تدريجياً.
        if (_bhHeld) _bhRelease(_bhHeld);
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

    /* ── 🗑️ 1ج) `/pricing` — حُذف المعالجُ 2026-09-10 بقرار المالك ─────────────────
     *
     * **الترتيبُ الذي نُفِّذ به، ولا يُقلَب:** ① أسقطت جلسةُ `SchoolApp-gas` الروابطَ الستّة
     * من مصدر HTML ودمجت ⇒ ② وصلت دفعةُ `frontend` الآلية (`7212bb9`) ⇒ ③ **قِيس الشرطُ
     * من هذه الشجرة**: `grep -c "/pricing"` على `home/schools.html` و`home/news.html`
     * و`sitemap.xml` ⇒ **`0 · 0 · 0`** ⇒ ④ حُذف المعالج.
     * 🔴 **وعكسُه كان يُنتج ٤٠٤ من الجذر** — `home/schools.html` هو ما يُخدَم به `/`.
     * 🟢 والمطابقةُ الباقيةُ الوحيدةُ (`frontend/master-admin/register.html:1665`) **تعليقُ
     *    JS لا رابطٌ حيّ** — قِيس بالبحث عن سمة href تشير إليه ⇒ **صفر**.
     * ⚠️ **وفخٌّ وقع في كتابة هذا التعليق نفسِه ويُسجَّل:** كانت الجملةُ أعلاه تحمل نمطَ
     *    `grep` بمحارف اقتباسٍ داخلية، **فأربكت نازعَ التعليقات في `test-routes.js`**
     *    (‏وهو واعٍ بالسلاسل الحرفية) ⇒ خرج من التعليق مبكّراً ⇒ **قرأ فحصٌ نصّيٌّ بقيّةَ
     *    التعليق كوداً فأحمرّ بحقٍّ لسببٍ خاطئ**. ⇒ **لا محارفَ اقتباسٍ في تعليقٍ يقرؤه
     *    فحصٌ نصّيّ.** (كشفه الفحصُ الجديد أدناه في أوّل تشغيلة.)
     *
     * ⚠️ **وما لم يُحذف ولماذا:**
     *   · **`GAS.pricing`** باقٍ في الجدول — النشرةُ حيّةٌ خاملةٌ مسارَ تراجع، **وحجبَ
     *     `protect-deploy-ids` حذفَه بحقّ** (انظر تعليقَ الجدول).
     *   · **`'pricing': 1` باقٍ في `_RESERVED_TOP_PATHS`** — 🔴 **وهذا مقصودٌ لا سهو:**
     *     إسقاطُه يجعل `/pricing` **مرشَّحَ slug مدرسة**، فتستطيع مدرسةٌ تسجيلُ الاسم
     *     واختطافُ المسار. والحجزُ يُبقي الجوابَ ٤٠٤ **متوقَّعاً لا قابلاً للاختطاف**.
     *     🟢 **ومنذ 2026-09-19 صار الجوابُ 301 إلى `/#pricing`** (المعالج «1و-ب») — والحجزُ
     *     باقٍ للعلّة نفسِها.
     *     وهو تطبيقُ درسٍ مسجَّل: «قائمةُ حارسٍ بيضاءُ للاختصاص، وحذفُ عنصرٍ منها
     *     «تنظيفاً» يفتح تخطّياً صامتاً».
     *
     * 🔴 **والدَّينُ الذي كشفه هذا الحذفُ أُغلق في نفس الدفعة:** كان إسقاطُ
     * `x-frame-options` من **كلّ** الردود مبرَّراً بأن `/pricing` يُضمَّن في `<iframe>` —
     * والمبرِّرُ زال معه، **فأُعيد الرأسُ**. وبلا ذلك كان يبقى تدهورٌ أمنيٌّ **بلا سببٍ ولا
     * إشارةٍ حمراء**. (‏و`content-security-policy` تبقى دَيناً مُعلَناً — بندُ
     * `csp-absent-on-worker-responses`.)
     *
     * والسردُ الأصليّ للحلّ المحذوف (لماذا `<iframe>` لا جلبٌ ولا 302) في تاريخ git عند
     * هذا الموضع — لا يُعاد نسخُه هنا.
     * ─────────────────────────────────────────────────────────────────────────── */

    // ── 1د) بثّ فيديو Google Drive عبر الوكيل: /media/drive/<fileId> ──
    //   يجلب بايتات الفيديو من Drive ويبثّها كـ video/mp4 مع دعم Range،
    //   ليُشغّل في وسم <video> الأصلي بدل مشغّل Drive المتعثّر
    //   ("تعذّر تحميل الفيديو. يُرجى إعادة المحاولة"). خفيف: بثّ مباشر بلا تخزين.
    /* 🔴 **معرّفٌ فارغ أو غيرُ مطابق كان يسقط صامتاً** — الـregex أعلاه لا يطابق
       `/media/drive/` بلا معرّف، فيمضي الطلبُ إلى خدمة الموقع الثابت **ويردّ صفحةَ
       HTML بحالة 200** ⇒ `<video>` يفشل في الفكّ بلا أيّ أثرٍ في أيّ سجلّ، ويُقرأ
       «الفيديو لا يعمل». وهو أحدُ الفرضيّات الحيّة لعطل منصّة المعلّم (2026-09-06).
       ⇒ يُلتقط صراحةً ويردّ 400 مقروءاً غيرَ مكاش، **ويُسجَّل** فيصير مقيساً. */
    if (/^\/media\/drive\/?$/.test(path)) {
      _bhLog({ ev: 'media', act: 'badid' });
      var bh = new Headers();
      bh.set('Content-Type', 'text/plain; charset=utf-8');
      bh.set('Access-Control-Allow-Origin', '*');
      bh.set('Cache-Control', _mediaCacheControl(400));
      return new Response('media proxy: missing or invalid fileId', { status: 400, headers: bh });
    }
    var mediaMatch = path.match(/^\/media\/drive\/([a-zA-Z0-9_-]+)\/?$/);
    if (mediaMatch) {
      var fileId = mediaMatch[1];
      if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
      /* ردُّ فشلٍ نصّيٌّ مقروء — **لا يُكاش أبداً**، فأوّلُ محاولةِ تشغيلٍ بعد الرفع
         قد تفشل وحدَها (فحصُ فيروسات Drive) ثمّ تنجح بعد ثوانٍ.
         🔴 **ويُسجَّل كلُّ فرعٍ لا فرعُ الاستثناء وحدَه** — كان `_bhLog` في `catch` فقط،
         فخرج فرعا `status>=400` و«HTML بدل وسائط» بلا أثر ⇒ **«صفرُ حدث» كان يُقرأ
         «صفرُ فشل» وهو لا يعني ذلك**، ولا يُميَّز «لم يُطلَب» من «طُلب وفشل».
         🔒 و`fileId` يدخل السجلّ **مبصوماً** بـ`_apiKeyFp` لا خاماً: المسارُ عامٌّ بلا
         مصادقة، والبصمةُ تكفي لربط الأحداث ولا تُسرّب هويّةَ ملفّ. (نفسُ قاعدة `argsKey`.) */
      var mediaFail = function (msg, st, act, upstream) {
        _bhLog({ ev: 'media', act: act || 'fail', st: upstream || 0, k: _apiKeyFp(fileId) });
        var fh = new Headers();
        fh.set('Content-Type', 'text/plain; charset=utf-8');
        fh.set('Access-Control-Allow-Origin', '*');
        fh.set('Cache-Control', _mediaCacheControl(st || 502));
        return new Response(msg, { status: st || 502, headers: fh });
      };
      try {
        var range = request.headers.get('Range');
        // ⚠️ مهلةٌ صريحة: هذا المسار كان **بلا سقفٍ زمنيّ إطلاقاً** بخلاف `/gas/*`.
        //    مُجهِضٌ واحد للجلبتين معاً ⇒ الميزانيةُ كلّية لا لكلِّ محاولةٍ على حدة.
        var mAbort = new AbortController();
        var mTimer = setTimeout(function () { mAbort.abort(); }, MEDIA_TIMEOUT_MS);
        var fInit = { method: 'GET', redirect: 'follow', headers: {}, signal: mAbort.signal };
        if (range) fInit.headers['Range'] = range;
        try {
          // نقطة التنزيل المباشر الحديثة (تتجاوز صفحة فحص الفيروسات بـ confirm=t)
          var driveUrl = 'https://drive.usercontent.google.com/download?id=' + fileId + '&export=download&confirm=t';
          var dResp = await fetch(driveUrl, fInit);
          var ct = dResp.headers.get('Content-Type') || '';
          // لو رجعت صفحة HTML (تأكيد/خطأ) جرّب نقطة uc التقليدية
          if (_mediaIsHtml(ct)) {
            dResp = await fetch('https://drive.google.com/uc?export=download&id=' + fileId + '&confirm=t', fInit);
            ct = dResp.headers.get('Content-Type') || '';
          }
        } finally { clearTimeout(mTimer); }

        /* 🔴 لا تُوسَم بايتاتُ HTML بأنها `video/mp4`. كان السطرُ يفرض النوعَ فرضاً بعد
           المحاولة الثانية ⇒ `<video>` يفشل في الفكّ ⇒ `onerror` ⇒ تراجعٌ إلى إطار
           `/preview` ⇒ **«تعذّر تحميل الفيديو»** — وهي بعينها الرسالةُ التي وُلد هذا
           المسارُ لقتلها. الصوابُ ردُّ فشلٍ صريحٍ غيرِ مكاشٍ. */
        if (dResp.status >= 400) {
          return mediaFail('video proxy: upstream ' + dResp.status, 502, 'upstream', dResp.status);
        }
        if (_mediaIsHtml(ct)) {
          return mediaFail('video proxy: upstream returned HTML, not media', 502, 'html', dResp.status);
        }
        var outHeaders = new Headers();
        outHeaders.set('Content-Type', ct || 'video/mp4');
        outHeaders.set('Accept-Ranges', 'bytes');
        outHeaders.set('Access-Control-Allow-Origin', '*');
        outHeaders.set('Cache-Control', _mediaCacheControl(dResp.status));
        var cr = dResp.headers.get('Content-Range'); if (cr) outHeaders.set('Content-Range', cr);
        var cl = dResp.headers.get('Content-Length'); if (cl) outHeaders.set('Content-Length', cl);
        return new Response(dResp.body, { status: dResp.status, headers: outHeaders });
      } catch (mErr) {
        /* 🔒 **نوعُ الخطأ وحدَه يخرج للعميل** — لا نصُّه. المسارُ عامٌّ بلا مصادقة،
           و`String(mErr)` سلسلةٌ غيرُ محدودةِ المنشأ قد تحمل عنوانَ الطلب (ومعه
           `fileId`) أو تفصيلاً من زمن التشغيل. والاسمُ يكفي للتشخيص: `AbortError`
           ⇒ تجاوزُ المهلة، وغيرُه ⇒ فشلُ نقل. (نفسُ منطق تعقيم السجلّ.) */
        var mName = (mErr && mErr.name) ? String(mErr.name) : 'Error';
        return mediaFail('video proxy error: ' + mName, 502, 'err:' + mName, 0);
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

    // ── 1و-ب) `/pricing` و`/register` — تحويلٌ على المضيف نفسِه (2026-09-19) ─────
    //   🔴 العلّة المقيسة (جلسة `SchoolApp-gas`): `/register` كان يُقرأ **slug مدرسة** فيذهب
    //      إلى GAS ثمّ يردّ ٤٠٤ «المدرسة غير موجودة» بعد ~8 ثوانٍ؛ و`/pricing` ٤٠٤ من Pages.
    //   · `/pricing` ⇒ `/#pricing` — قرارُ المالك: الأسعارُ في قسم الصفحة الرئيسية وحدَه.
    //   · `/register` ⇒ `/master-admin/register.html` (صفحةُ التسجيل القائمة).
    //   ‏301 **بعمرٍ محدود** (ساعة) لا بلا رأس: الدائمُ بلا `Cache-Control` يُثبَّت في المتصفّح
    //   للأبد، وقرارُ `/pricing` تغيّر مرّتين. و`Location` **نسبيٌّ** ⇒ لا يعبر مضيفاً أبداً
    //   (عقدُ المضيفات المجمَّدة: لا يُخرَج زائرٌ إلى مضيفٍ آخر).
    //   🔒 الاسمان محجوزان في `_RESERVED_TOP_PATHS` — 'register' **لازمٌ لا دفاعيّ**: بلاه
    //   يصير مرشَّحَ slug فتستطيع مدرسةٌ تسجيلَه واختطافَ صفحة التسجيل.
    //   والرؤوسُ الأمنية تُكرَّر يدوياً للعلّة نفسِها في `/app` أعلاه (عودةٌ مبكرة).
    var _sameHostRedirect = _sameHostRedirectFor(path);
    if (_sameHostRedirect && (request.method === 'GET' || request.method === 'HEAD')) {
      var rdIsCanon = (url.hostname === 'yemenschoolz.com' ||
                       url.hostname === 'www.yemenschoolz.com');
      var rdHeaders = {
        'Location': _sameHostRedirect,
        'Cache-Control': 'public, max-age=3600',
        'Strict-Transport-Security': rdIsCanon
          ? 'max-age=15552000; includeSubDomains'
          : 'max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      };
      if (!rdIsCanon) rdHeaders['X-Robots-Tag'] = 'noindex, follow';
      return new Response(null, { status: 301, headers: rdHeaders });
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
      // 🆕 **«يمن سكولز» — أُضيف 2026-09-15، وبصمتُه واحدةٌ عمداً لا اثنتان.**
      //    مفتاحُ الرفع مقيسٌ من مصدرين مستقلَّين (وثيقةُ `YemenSchoolz/CLAUDE.md`
      //    §حالة التوقيع · ولوحةُ Firebase — تطابقٌ تامّ)، **ولم تُمرَّر كلمةُ سرٍّ
      //    عبر أيّ أمرِ شِلّ.**
      // 🔴 **ومفتاحُ توقيع Play غائبٌ عمداً لا سهواً:** التطبيقُ **لم يُنشر بعد**
      //    (`versionCode 1`)، ومصدرُ ذلك المفتاح الوحيد *Play Console ← إعداد ←
      //    تكامل التطبيق* — **ولا يوجد قبل أوّل رفع.** ⇒ بهذه البصمة وحدَها
      //    **تعمل الروابطُ في التثبيت اليدويّ وتفشل لكلّ مستخدمٍ من Play** صامتةً
      //    (`Domain verification state: none`). **بندٌ إلزاميٌّ باسم المالك:**
      //    `assetlinks-needs-play-signing-key-after-first-upload`.
      // ⚠️ **ولا تُكمِلها جلسةٌ لاحقةٌ ببصمةٍ من الـkeystore** — ذاك مفتاحُ الرفع
      //    نفسُه، ومفتاحُ التوقيع **يديره Google ولا يُشتقّ محلّياً**.
      var alSchoolzUpload = 'BD:65:0C:2E:9E:21:78:46:A3:52:57:3B:97:FE:52:2B:AD:09:97:6C:01:40:EE:85:23:88:1B:C7:7E:D9:7B:FD';
      /* 🟢 **مفتاحُ توقيع Play — أُضيف 2026-09-17، والدعوى أعلاه بطَلت بالقياس.**
         كان مكتوباً «غائبٌ عمداً لا سهواً: التطبيقُ لم يُنشر بعد ولا يوجد المفتاحُ قبل
         أوّل رفع» — **والمقيسُ اليوم أنه رُفع فعلاً إلى الاختبار الداخليّ**: الحزمةُ
         المثبَّتةُ على هاتف المالك `versionCode 3` ومُثبِّتُها `com.android.vending` ⇒
         **Play App Signing قائمٌ**، والبصمةُ أدناه مقروءةٌ بـ`apksigner` **من الحزمة
         المسحوبة من الجهاز نفسِه** لا منقولةً من لوحة (‏قياسُ `yemenschoolz-e5`).
         🔴 **والأثرُ كان صامتاً تماماً:** بمفتاح الرفع وحدَه **يفشل `autoVerify` لكلّ
         مستخدمٍ من Play** وتبقى الروابطُ تفتح في المتصفّح، **بلا خطأٍ ولا رسالة**.
         🔒 **والبصمتان تبقيان معاً:** مفتاحُ الرفع يغطّي التثبيتَ اليدويَّ والبناءَ
         المحلّيّ، ومفتاحُ Play يغطّي كلَّ تثبيتٍ من المتجر. */
      var alSchoolzPlay = 'C9:D6:FD:7B:42:32:69:C6:53:3F:7A:42:F7:91:A8:DC:19:BC:3D:9F:01:2C:DB:0C:93:ED:28:F9:EC:79:44:2F';

      // 🔴 **ومعرّفُ «يمن سكولز» واحدٌ لا اثنان — قرارُ مالكٍ صريحٌ 2026-09-15:**
      //    **`com.yemenschoolz.app` وحدَه، والقديمُ `com.proconrers.schoolzyemen` لا يُعلَن.**
      //    (كان الملفُّ يحملهما معاً ساعةً واحدةً كحالةٍ انتقاليّة، ثمّ حسم المالكُ
      //    **اعتمادَ الجديد وحدَه** — والتطبيقُ **لم يُنشر بعد** فلا مستخدمَ يحمل القديم.)
      //    🎯 **والقرارُ أنظفُ ممّا كان:** حزمةٌ لا وجودَ لها في `assetlinks` **تُقرأ
      //    لاحقاً حزمةً حيّة**، وثلاثةُ معرّفاتٍ متشابهةٍ في قائمةٍ واحدة **تُغري
      //    بتقليم أحدها** — وهو بعينه الالتباسُ الذي وقع فيه المالكُ نفسُه اليوم.
      // ⚠️ **وشرطُ ترتيبٍ يلزم الطرفَ الآخر:** البناءُ المحلّيُّ لـ«يمن سكولز» ما زال
      //    يحمل المعرّفَ القديم حتى تُنفَّذ إعادةُ التسمية ⇒ **اختبارُ App Links على
      //    جهازٍ حقيقيّ لا يصحّ قبلها** (‏`adb shell pm get-app-links com.yemenschoolz.app`).
      //    ⇒ **التسميةُ تسبق الاختبار، والاختبارُ يسبق النشر.**
      var alStatement = function (pkg, fps) {
        return {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fps }
        };
      };
      // 🎯 **تضييقُ نطاقِ السلطة بالمضيف — أُضيف 2026-09-15، والحجّةُ تُسمّى بدقّة:**
      //    كان الملفُّ **كائناً واحداً لكلّ المضيفات** (مقيسٌ 2026-09-07: `app.` و
      //    `school.procorners.com` أعادا نفسَ البايتات). ⇒ كلُّ حزمةٍ كانت تُعلَن على
      //    **كلّ** مضيف.
      // 🔴 **وما لا يُقال — ادُّعي سابقاً ونُقض في اليوم نفسِه:** ذلك **لا يُنتج تنازعَ
      //    نطاق**. التحقّقُ يُقاد بما يُعلنه المانيفست بـ`autoVerify`، والعناصرُ غيرُ
      //    المطابِقة **تُتجاهَل** ⇒ **مُدخَلٌ بلا مُطالِبٍ على المضيف خامل**،
      //    **والتنازعُ شرطُه تطبيقان يُعلنان نفسَ المضيف.**
      // 🟢 **والحجّةُ الصحيحةُ للتفريع: تضييقُ نطاقِ سلطة** — لو أَعلن تطبيقٌ مضيفاً
      //    سهواً يوماً، **يفشل تحقّقُه وحدَه** بدل أن ينجح صامتاً على مضيفٍ لا يخصّه.
      //    ⇒ الفصلُ يتبع **مَن يخدمه المضيفُ فعلاً**:
      //      · `app.yemenschoolz.com` ⇒ «يمن سكولز» وحدَه (‏`CANONICAL_ORIGIN` عنده).
      //      · وما عداه ⇒ التطبيقُ **المنشور** وحدَه — وهو يطلب `school.procorners.com`
      //        في `vc31` و`yemenschoolz.com` في `vc34/35`، **وكلاهما حيٌّ على أجهزة.**
      // ⚠️ **والافتراضيُّ عمداً هو المنشور** (‏`workers.dev` وأيُّ مضيفٍ يُضاف لاحقاً):
      //    **فشلُ تحقّقٍ لتطبيقٍ لم يُنشر أرخصُ من فشلِه لتطبيقٍ على أجهزةِ مستخدمين.**
      var alIsSchoolzHost = (url.hostname === 'app.yemenschoolz.com');
      var alBody = JSON.stringify(alIsSchoolzHost
        ? [alStatement('com.yemenschoolz.app', [alSchoolzUpload, alSchoolzPlay])]
        // 🔒 عقدُ التطبيق **المنشور** — لا يُمَسّ، وبصمتاه إلزاميّتان معاً (انظر أعلاه).
        : [alStatement('com.proconrers.schoolappyemen', alFingerprints)]);
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

    /* ── 1ح) وجهةُ تقارير CSP: /csp-report ─────────────────────────────────
       🔴 **لماذا مسارٌ أصلاً، ولماذا يسبق نشرَ السياسة:** `Report-Only` بلا وجهةٍ تُسجّل
       **زينةٌ لا حارس** — المتصفّحُ يطبع الانتهاكَ في كونسول الزائر، **ولا أحد يقرأ
       كونسولَ مستخدميه**. فتبقى السياسةُ «منشورةً» ويُظنُّ أنها تقيس، وهي تقيس لا أحد.
       ⇒ الوجهةُ تُنشَر **مع** السياسة لا بعدها، وإلّا وُلد الحارسُ أجوف.
       🟢 والتسجيلُ عبر `console.log` يلتقطه Workers Observability ⇒ يُستعلَم عنه
       بـ`ev:'csp'`. ⚠️ **واحتفاظُه سبعةُ أيامٍ متدحرجة** ⇒ ما يُراد الاحتجاجُ به لاحقاً
       **يُستخرَج إلى وثيقةٍ وقتَ القياس** لا يُترك في القناة.
       🔒 وثلاثةُ قيودٍ مقصودة: **POST حصراً** · **حدُّ جسمٍ 8KB** (التقريرُ قد يأتي من
       عميلٍ معادٍ فلا يُبتلع بلا حدّ) · و**204 بلا جسمٍ ولا كاش** — لا يُعاد شيءٌ للمُبلِّغ.
       ⚠️ ولا يُسجَّل الجسمُ خاماً: تُقتطَف أربعةُ حقولٍ بأسمائها، فلا يُضخُّ نصٌّ لا نملكه. */
    if (path === '/csp-report') {
      if (request.method !== 'POST') {
        return new Response(null, { status: 405, headers: { 'Allow': 'POST', 'Cache-Control': 'no-store' } });
      }
      return request.text().then(function (raw) {
        var cut = (raw || '').slice(0, 8192);
        var rep = null;
        try { rep = JSON.parse(cut); } catch (e) { rep = null; }
        var body = (rep && (rep['csp-report'] || rep)) || {};
        console.log(JSON.stringify({
          ev: 'csp',
          d: String(body['violated-directive'] || body.violatedDirective || '').slice(0, 120),
          b: String(body['blocked-uri'] || body.blockedURI || '').slice(0, 200),
          doc: String(body['document-uri'] || body.documentURI || '').slice(0, 200),
          ln: Number(body['line-number'] || body.lineNumber || 0) || 0
        }));
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
      });
    }

    /* ── 1ط) وجهةُ أخطاء العميل: /client-err (‏2026-09-18 · قرار المالك) ──────────
       التعقيمُ والحدُّ في `_clientErrSanitize`/`_clientErrRate` أعلى الملفّ (نقيّتان
       مختبَرتان). 🔒 هنا الغلافُ وحده: **POST حصراً** · **نفسُ الأصل** (رأسُ `Origin` إن
       حضر يجب أن يطابق المضيف — المُرسِلُ `gas-bridge` بمسارٍ نسبيّ) · **حدُّ جسمٍ 2KB**
       على `Content-Length` المُعلَن ثمّ على النصّ المقروء قبل التحليل — ⚠️ والرأسُ الغائب
       أو الكاذب يعني أن الجسمَ يُقرأ كاملاً قبل الرفض (نفسُ حدّ `/csp-report`؛ والسقفُ
       الفعليّ حدُّ طلب Workers) · و**صفرُ نداءٍ على GAS**. والردودُ بلا جسم: 204 قُبل · 400 رُفض ·
       413 كبير · 429 حدّ · 403 أصلٌ آخر. */
    /* ── 1ي) عدّاداتُ صحّة النقل للوحة المطوّر: /dev-stats (عقد v1 · 2026-09-23) ──────
       المنطقُ في `_devStats*` أعلى الملفّ. هنا الغلاف: GET حصراً · بلا CORS · السرُّ أوّلاً
       ثمّ النافذة ثمّ الكاش — **فالكاشُ لا يصير طريقاً حول المصادقة** · وصفرُ نداءٍ على GAS. */
    if (path === '/dev-stats') {
      var dsHdr = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
      function dsJson(o, st) { return new Response(JSON.stringify(o), { status: st, headers: dsHdr }); }
      if (request.method !== 'GET') {
        return new Response(null, { status: 405, headers: { 'Allow': 'GET', 'Cache-Control': 'no-store' } });
      }
      if (!env.DEV_STATS_KEY || !env.CF_OBS_TOKEN || !env.CF_ACCOUNT_ID) {
        return dsJson({ v: 1, error: 'not_configured' }, 503);
      }
      if (!_devStatsKeyOk(request.headers.get('X-Dev-Stats-Key'), env.DEV_STATS_KEY)) {
        return dsJson({ v: 1, error: 'unauthorized' }, 401);
      }
      var dsWin = _devStatsWindow(url.searchParams.get('window'));
      if (!dsWin) return dsJson({ v: 1, error: 'bad_window' }, 400);
      var dsKey = new Request(url.origin + '/__dev-stats/v1/' + dsWin.key);
      var dsHit = await caches.default.match(dsKey);
      if (dsHit) {
        var dsCached = await dsHit.json();
        dsCached.cacheAgeS = Math.max(0, Math.round((Date.now() - Date.parse(dsCached.generatedAt)) / 1000));
        return dsJson(dsCached, 200);
      }
      var dsBody = null;
      try { dsBody = await _devStatsBuild(env, dsWin, Date.now()); } catch (e) { dsBody = null; }
      if (!dsBody) return dsJson({ v: 1, error: 'obs_unavailable' }, 503);
      /* الجزئيُّ لا يُخزَّن — كي لا يُثبَّت قسمٌ «تعذّر» خمسَ دقائق بعد أن يعود المصدر. */
      if (!dsBody.partial) {
        ctx.waitUntil(caches.default.put(dsKey, new Response(JSON.stringify(dsBody), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + DEV_STATS_TTL_S }
        })));
      }
      return dsJson(dsBody, 200);
    }

    if (path === '/client-err') {
      var ceNoStore = { 'Cache-Control': 'no-store' };
      if (request.method !== 'POST') {
        return new Response(null, { status: 405, headers: { 'Allow': 'POST', 'Cache-Control': 'no-store' } });
      }
      var ceOrigin = request.headers.get('Origin');
      if (ceOrigin && ceOrigin !== url.origin) {
        return new Response(null, { status: 403, headers: ceNoStore });
      }
      var ceLen = Number(request.headers.get('Content-Length') || 0);
      if (ceLen > CE_MAX_BYTES) return new Response(null, { status: 413, headers: ceNoStore });
      if (!_clientErrRate(request.headers.get('CF-Connecting-IP'), Date.now())) {
        return new Response(null, { status: 429, headers: ceNoStore });
      }
      return request.text().then(function (raw) {
        /* `Content-Length` قد يغيب (ترميزٌ مقطَّع) ⇒ الحدُّ يُعاد على النصّ نفسِه. */
        if ((raw || '').length > CE_MAX_BYTES) return new Response(null, { status: 413, headers: ceNoStore });
        var obj = null;
        try { obj = JSON.parse(raw || ''); } catch (e) { obj = null; }
        var rec = _clientErrSanitize(obj);
        if (!rec) return new Response(null, { status: 400, headers: ceNoStore });
        rec.host = url.hostname;
        console.log(JSON.stringify(rec));
        return new Response(null, { status: 204, headers: ceNoStore });
      });
    }

    // ── 2) خدمة الموقع الثابت من GitHub Pages ───────────────────
    // الجذر / يخدم **home/Schools.html** منذ 2026-08-07: صفحة هبوط كاملة (هيرو · about-app ·
    // features · platform-details · faq) + دليل المدارس في قسم واحد — أي كل ما كان يخدمه
    // home-all-school وزيادة. وكذلك /index.html القديمة. راجع _build/gen-sitemap.js في
    // school-app-yemen-gas — مدخل الجذر هناك يشير إلى home/Schools.html فيتطابق المصدران.
    //
    // 🔴 **حُدِّث 2026-09-15 — والوصفُ السابق تقادم في ثلاث دعاوى دفعةً واحدة:**
    //    كان يقول إن المحتوى «نُقِل **نسخاً** والملفُّ القديمُ مجمَّدٌ بلا لمسة»، وإن
    //    `/home-all-school/index.html` يُخدَم بـ«معرّف نشرٍ ثابت»، وإن «أندرويد
    //    SchoolzYemen يشير إليه». **والثلاثُ بطَلت في اليوم نفسِه:**
    //      · **مصدرُ `home-all-school/` حُذف** من مستودع الـgas.
    //      · **والمسارُ يُبنى الآن من `home/Schools.html`** (‏`SRC_DIR_FOR`) ويُخدَم من
    //        `frontend/` كأيّ ملفٍّ ثابت — **لا من نشرة GAS**. قِيس حيّاً: **٩٩٬٣٠٧ بايت**.
    //      · **وتطبيقُ «يمن سكولز» فُطم عنه** — وجهتُه صارت `/home/schools.html`.
    //    🟢 **والمسارُ يبقى ٢٠٠ رغم ذلك كلِّه**، ويحرسه `test-routes.js` بخطِّ أساسِ حجم.
    // 🎯 **ويُسجَّل الدرسُ لا التصحيحُ وحدَه:** ثلاثُ دعاوى في تعليقٍ واحدٍ سقطت معاً،
    //    **وكلُّها كانت صحيحةً يومَ كُتبت** — وهي فئةُ «وصفٌ يتقادم بينما الكودُ يعمل»،
    //    ولا يمسكها فحصٌ لأن **التعليقَ لا يُشغَّل**.
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
    /* 🔴 **`/home` و`/home/` تُطبَّعان إلى `/home/index.html` — سدُّ ثغرةٍ مقيسة 2026-09-15.**
       البوّابةُ أدناه مشروطةٌ بـ`/^\/home\/(index|news)\.html\/?$/` ⇒ **الشكلُ العاري من
       المسار لا يطابقها**، وGitHub Pages يخدم فهرسَ المجلد فيصل نفسُ الملفّ **بلا أيّ
       بوّابة**. القياسُ الحيّ على `yemenschoolz.com`:

         /home            ⇒ 200 · 210,209 بايت  ┐ نفسُ البصمة تماماً
         /home/           ⇒ 200 · 210,209 بايت  ┘ (‏md5 متطابق)
         /home/index.html ⇒ 302 إلى الجذر         ← البوّابةُ تعمل هنا وحدها
         /abdaawatmuaz    ⇒ 200 · 210,205 بايت    ← نفسُ الملفّ، ويفترق بـ`canonical` فقط

       ⇒ **صفحةٌ بلا هويّةٍ تُخدَم بحالة 200**، و`canonical` فيها يشير إلى العنوان
       المحوَّل نفسِه ⇒ الحالةُ التي أُغلقت في 2026-08-14 **باقيةٌ من مدخلٍ آخر**.
       🔴 وقرارُ المالك يومَها كان عامّاً لا خاصّاً بشكلٍ من أشكال المسار: **«الرابطُ بلا
       معرّفٍ يجب أن يكون فارغاً»** — والمقيسُ حينها `getHomePageBundle('')` ⇒ `isOwner:true`
       و30,056 بايتاً من بيانات مدرسة المالك.
       ⚠️ **وحدُّ ما قِسته اليوم يُقال: قِستُ أنّ *الصفحةَ* تُخدَم بلا بوّابة** (‏حالةٌ وحجمٌ
       وبصمة) — **ولم أُشغّل الـJS فلم أُعِد قياسَ نداء `getHomePageBundle('')` نفسِه**؛
       ذاك منقولٌ عن قياس 2026-08-14 المكتوب أدناه.

       🔒 **والتطبيعُ لا التحويلُ عمداً** — وهو نفسُ نمط `/portal` أعلاه حرفياً:
       · `‎/home?school=<id>` **يبقى يُخدَم** (يصير `/home/index.html?school=…` فيمرّ
         بالبوّابة بحقٍّ **ويكسب حقنَ الهويّة خادميّاً** الذي كان يفوته — انظر `:577`).
       · والعاري وحدَه هو ما تلتقطه البوّابةُ فيُحوَّل ⇒ **صفرُ سلوكٍ جديدٍ لحاملِ معرّف.**
       · وحزمةُ الأندرويد المنشورة تفتح `…/home/index.html?school=<UUID>` ⇒ **خارجَ هذا
         السطر أصلاً**، ولا يمسّها. */
    if (path === '/home' || path === '/home/') path = '/home/index.html';
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
    // 🔒 **الشرط غيابُ معاملَي الهوية وحدَهما** (`!has('school') && !has('schoolId')`) —
    //    لا يمسّ أيّ رابط يحمل معرّفاً:
    //    🔴 **وتصحيحٌ مقيس 2026-09-20 — كان مكتوباً هنا «الشرط `!url.search` وحده» وهو
    //       بائتٌ ويصف شرطاً أضيقَ من القائم**، والفرقُ عمليٌّ لا تحريريّ: بـ`!url.search`
    //       كان **أيُّ** استعلامٍ يمنع التحويل ⇒ `‎/home/index.html?cb=1` يُخدَم **صفحةً بلا
    //       هويّة**، وهي بعينها ثغرةُ 2026-08-14 من مدخلٍ أرخص. والمقيسُ حيّاً اليوم:
    //       `‎?cb=<n>` ⇒ **302** ⇒ الكودُ أصحُّ من تعليقه، **والتعليقُ وحدَه كان يُضلّل**
    //       من يبني عليه (‏ومن يُعيد كتابة الشرط على وصفه يفتح الثغرة).
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
    // 🔴 استثناءُ `?news=` — أُضيف 2026-09-02 بعد بلاغِ مالكٍ مقيس.
    //
    // العلّة: بنّاءُ رابط المشاركة (`_tcNewsShareUrl`/`_stNewsShareUrl`) يُنتج الشكل
    // `‎/home/news.html?news=<id>&school=<uuid>&t=<tok>` — و`school` **مشروطٌ بأن يكون
    // `schoolId` غيرَ فارغ**. و`session.schoolId` **فارغةٌ لحساب المالك بالتصميم**
    // (‏`teacher/_ShareToken.js`) ⇒ روابطُ المالك تُنتَج بلا `school` ⇒ تُطابِق الشرطَ
    // أدناه ⇒ **302 إلى الجذر بلا `url.search`** ⇒ `?news=` و`?t=` **يضيعان**،
    // والزائرُ يهبط على دليل المدارس بلا خبر. عطلٌ صامت: لا خطأ ولا أثر.
    //
    // ⚠️ والقصدُ الأمنيّ الأصليّ يبقى كما هو ولا يُمَسّ: `news.html` **العارية** تستدعي
    // `getHomePageBundle('', 'library')` ⇒ مكتبةَ المالك كاملةً بما فيها الأخبار
    // الموجَّهة لصفّ/شعبة — تسريبٌ حقيقيّ، والتحويلُ هو موضعُ منعه. فالاستثناءُ
    // **بأضيق شرطٍ ممكن**: وجودُ `news` وحده يرفع التحويل، وما دونه يبقى محوَّلاً.
    // 🔒 ورفعُ التحويل **لا يرفع أيَّ تحقّق**: `?news=` له سلسلتُه الخاصّة
    // (‏`getNewsOg` يتحقّق من التوكن ويحلّ المستأجر)، و`newsarticle.html` مستثناةٌ
    // من هذه القائمة أصلاً **لهذا السبب بعينه** — فالاستثناءُ تسويةٌ لا توسيع.
    if (/^\/home\/(index|news)\.html\/?$/i.test(path) &&
        !url.searchParams.has('news') &&
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
    /* 🟢 **ديناميكيّ منذ 2026-08-22:** البذرةُ الساكنة أوّلاً (صفر كلفة)، ثمّ القائمةُ
       المكاشة، ثمّ تحديثٌ **واحد** محكومٌ بالـbulkhead. فمدرسةٌ تسجّل اليوم تعمل صفحتُها
       خلال دقائق **بلا تعديل كودٍ ولا نشرِ وسيط** — وكان ذلك يتطلّب تعديلَ مستودعين.
       والاستدعاءُ `await` **بعد** فحص `_pathSlug` فلا يُكلّف شيئاً على المسارات الأخرى. */
    if (_pathSlug && !(await _slugIsKnown(_pathSlug, url.origin, env))) {
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
    /* 🔴 تاريخُ المنبع يُلتقَط **قبل** الحذف ثم يُحذَف كما كان: لا يُمرَّر للعميل كما هو
       (لا يصف الجسم المخدوم — الهويةُ تُحقَن بعده)، لكنه أدقُّ مُدخَلٍ لدينا عن «هل تغيّر
       الملفّ في المنبع؟» ⇒ يدخل `_pageLastMod` مع طابع الهوية. */
    var _upstreamLastMod = ghResp.headers.get('last-modified') || '';
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
    /* 🔴 **`x-frame-options` أُعيد 2026-09-10 — ومبرِّرُ إسقاطه زال في نفس الدفعة.**
     * كان محذوفاً لأن `/pricing` **يُضمَّن في `<iframe>` من هذا الوركر نفسه**؛ وقد حُذف
     * ذلك المعالجُ بقرار المالك (انظر شاهدةَ القبر عند `1ج`) ⇒ **زال المبرِّرُ فعاد الرأس.**
     * ⚠️ **ولولا ذلك لبقي الوركرُ بلا الرأس مع اختفاء سببه** — تدهورٌ أمنيٌّ بلا أيّ إشارةٍ
     *    حمراء، وهو الصنفُ الذي لا يُكتشَف إلّا بجردٍ مقصود.
     * 🟢 و`SAMEORIGIN` لا `DENY`: تُبقي تضميناً من أصلنا إن لزم، وتمنع الأجانب.
     *    وتأطيرُنا لجوجل (كان في `/pricing`) **خارجٌ** لا يمسّه هذا الرأس أصلاً.
     * 🔴 **و`content-security-policy` تبقى محذوفةً — دَينٌ مُعلَنٌ لا حمايةٌ مُدّعاة:**
     *    سكربتاتُ هذه الصفحات **مضمَّنةٌ داخل HTML بكثافة** (‏`frontend/teacher/index.html`
     *    وحدها 2,016,145 حرفاً) ⇒ سياسةٌ صارمةٌ تكسرها **صامتةً**. تلزمها جردةُ مصادرَ
     *    ثمّ `Content-Security-Policy-Report-Only` أوّلاً — بندُ
     *    `csp-absent-on-worker-responses`. */
    headers.set('X-Frame-Options', 'SAMEORIGIN');

    // سياسة تخزين ذكية حسب نوع الملف:
    //  - sw.js / manifest: **لا تخزين إطلاقاً** — عاملُ خدمةٍ مُكاشٌ بخطأ يُثبّت نفسه.
    //  - HTML: `no-cache, must-revalidate` — يُسأل الخادمُ في كلّ مرّة (الضمانُ محفوظ)،
    //    والجوابُ صار 304 بدل 527KB حين لا يتغيّر شيء. راجع الكتلة عند `_pageLastMod`.
    //  - الأصول الثابتة (js/css/صور/خطوط): تخزين يوم + stale-while-revalidate أسبوع
    //    → على الشبكات الضعيفة تُعاد من كاش المتصفّح فوراً بدل جولة شبكة لكل ملف.
    var lowerPath = path.toLowerCase();
    var isHtml = lowerPath === '/' || /\.html?$/.test(lowerPath) || !/\.[a-z0-9]+$/.test(lowerPath);
    /* 🔴 يُفصَل عن `isHtml` صراحةً: الاثنان لهما امتدادٌ فلا يقعان في `isHtml` أصلاً، لكنّ
       الفصلَ يجعل الاستثناء **مقروءاً ومختبَراً** بدل أن يعتمد على تفصيلٍ في تعبيرٍ نمطيّ
       قد يتغيّر يوماً فيفقد `sw.js` حمايته بصمت. */
    var isSwOrManifest = /\/sw\.js$/.test(lowerPath) || /manifest\.webmanifest$/.test(lowerPath);
    if (isSwOrManifest) {
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (isHtml) {
      headers.set('Cache-Control', 'no-cache, must-revalidate');
    } else {
      headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }

    /* ── CSP في وضع الإبلاغ وحده (‏2026-09-11) ────────────────────────────────
       🔴 **`Report-Only` حصراً — ولا `Content-Security-Policy` نافذةٌ في هذه الدفعة.**
       سكربتاتُ المنصّة **مضمَّنةٌ داخل HTML بكثافة** (‏`frontend/teacher/index.html` وحدها
       2,016,145 حرفاً) ⇒ سياسةٌ نافذةٌ تكسر الصفحاتِ **صامتةً** على مستخدمٍ حقيقيّ.
       ⇒ تُنشَر مُبلِّغةً، تُقرأ تقاريرُها، **ثمّ** يُقرَّر التنفيذ.

       **والقائمةُ مشتقّةٌ من جردٍ على `frontend/` المخدوم لا من تخمين** (2026-09-11):
       `cdn.jsdelivr.net` (‏xlsx) · `www.googletagmanager.com` (‏gtag) · `unpkg.com`
       (‏`teacher/index.html`) · `cdnjs.cloudflare.com` · `fonts.googleapis.com` ·
       `lh3.googleusercontent.com` · `drive.google.com` · `img.youtube.com` ·
       `api.qrserver.com` · `chart.googleapis.com` · ويوتيوب للتأطير.

       🟢 **و`'unsafe-eval'` مُسقَطةٌ عمداً — بدليلٍ لا بصفرِ مطابقة:** أوّلُ مِجَسٍّ
       (`"eval("`) أعطى **صفراً كاذباً**؛ وضابطٌ موجبٌ كشف **أربعَ ورودات** لـ`eval`،
       وقراءةُ مواضعها أثبتت أنها **مفتاحُ `eval` في امتداد WebAuthn PRF**
       (‏`extensions:{prf:{eval:{first:…}}}` — الدخولُ بالبصمة) **لا الدالّةَ التنفيذيّة**.
       ⇒ صفرُ `eval()` و`new Function` ⇒ لا حاجةَ للراية.

       🔴 **و`'unsafe-inline'` في `script-src` دَينٌ مُعلَنٌ لا سهو** — تفرضها السكربتاتُ
       المضمَّنة، **وهي تُضعف الحمايةَ كثيراً**. والبديلُ الصحيحُ `nonce` يلزمه أن يحمل كلُّ
       `<script>` سمةً ⇒ **تغييرٌ في مصدر `SchoolApp-gas` لا في هذا المخرَج المولَّد**.
       ⇒ يُسجَّل مقايضةً مرئيّةً، ولا يُترك ديناً خفيّاً.

       ⚠️ **و`img-src https:` واسعةٌ عمداً:** صورُ المدارس تأتي من Drive بمضيفاتٍ متغيّرة
       (‏`lh3` · `lh4` · `*.googleusercontent`)، وتضييقُها يكسر عرضَ الشعارات **صامتاً**
       — وهو بعينه ما تتجنّبه هذه المرحلة. والصورةُ لا تُنفَّذ.
       🔒 **والحدُّ الحقيقيُّ في `script-src` و`object-src 'none'` و`base-uri 'self'`.**
       ⚠️ ولا `frame-ancestors` هنا: `X-Frame-Options: SAMEORIGIN` يغطّيها، وتكرارُها
          في وضع الإبلاغ يُنتج تقاريرَ عن شيءٍ محجوبٍ أصلاً.
       🔒 **وتُحقَن على HTML وحده** — على أصلٍ ثابتٍ بلا DOM هي بايتاتٌ بلا أثر.

       🔴 **وزونُ `procorners.com` مشتركٌ مع متجرٍ آخر، والكتلةُ بلا شرطِ مضيف** ⇒ **وجب
       الضابطُ المعاكس قبل النشر، وشُغّل 2026-09-11:**
         · موجب : `school.procorners.com/teacher/index.html` ⇒ رؤوسُنا **حاضرة**.
         · معاكس: `procorners.com/` ⇒ **200 وصفرُ رأسٍ من رؤوسنا** (لا `x-content-type-options`
           ولا `referrer-policy` ولا `cross-origin-opener-policy`) ⇒ **المتجرُ لا يمرّ بهذه
           الكتلة أصلاً** (مسارُ الوركر `school.procorners.com/*` وحدَه) ⇒ **صفرُ إصابة**.
       ⚠️ **وفخُّ قياسٍ وقع في الطريق ويُسجَّل:** `/home/index.html` أعطى **صفرَ رؤوسٍ أيضاً**
          — **وليس عطلاً**: يردّ **302** إلى النطاق القانونيّ فيخرج **قبل** هذه الكتلة.
          ⇒ **لا يُقاس سطحٌ يعيد تحويلاً ويُستنتَج منه غيابُ رأس.** */
    if (isHtml) {
      headers.set('Content-Security-Policy-Report-Only', [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://www.googletagmanager.com https://www.google-analytics.com https://static.cloudflareinsights.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https:",
        "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com https://drive.google.com https://docs.google.com",
        /* 🟢 **وُسّعت 2026-09-11 بعد ٤٠ دقيقةً من نشر الإبلاغ — والقائمةُ الأصليّةُ كانت ناقصة،
           وهذا بعينه ما وُضع `Report-Only` لأجله.** التقاريرُ الواردة (‏`ev:'csp'`) أعطت
           **٩ انتهاكاتِ `connect-src` و١ `script-src-elem` من مستخدمين حقيقيّين** — كلُّها
           تتبّعٌ تحليليّ: GA4 يرسل إلى **`www.google.com/g/collect`** و**`analytics.google.com`**
           و**`stats.g.doubleclick.net`** (لا إلى `www.google-analytics.com` وحدَه كما يوحي
           المصدر)، و**`static.cloudflareinsights.com/beacon.min.js`** **يحقنه Cloudflare على
           الحافّة فلا أثرَ له في `frontend/` إطلاقاً**.
           🎯 **والدرسُ: جردُ المصدر لا يرى ما يُحقَن على الحافّة ولا ما تبنيه السكربتاتُ وقتَ
           التشغيل** ⇒ **لا تُنشَر سياسةٌ نافذةٌ على جردٍ ساكنٍ أبداً.**
           🔴 **ولو نُشرت نافذةً من أوّل يومٍ لكسرت التتبّعَ كلَّه صامتاً** — عشرةُ طلباتٍ في
           أربعين دقيقة.

           🔴 **ووُسّعت ثانيةً في اليوم نفسِه — والنقصُ الأوّلُ بنيويٌّ لا سهو، وهذا هو الدرس:**
           بلاغٌ من طرفيّة المالك أظهر انتهاكَين على **`region1.analytics.google.com`** و
           **`region1.google-analytics.com`**. و**GA4 يوجّه `/g/collect` إلى نقطةٍ إقليميّةٍ
           مشتقّةٍ من موقع الزائر** (‏`region1` · `region2` · …) ⇒ **الأسماءُ المجرّدةُ لا
           تكفي أبداً، وكلُّ زائرٍ من إقليمٍ جديدٍ يُنتج مخالفةً جديدة.**
           🎯 **والفئةُ تُسمّى: القائمةُ عدّدت _ما رأيناه_ لا _ما يمكن أن يقع_** ⇒ **تغطيةٌ
           تبدو مكتملةً لأن عيّنتَنا كانت من إقليمٍ واحد.** وقِيس ذلك بعينه هنا بضابطٍ
           ثنائيِّ القطب على سجلّات ‏2026-09-10→11: `region1` ⇒ **٣ أحداثٍ فأكثر** ·
           `region2` ⇒ **صفر** · ونصٌّ مختلَقٌ ⇒ **صفر** (‏فالمِجَسُّ يفرز، والصفرُ صادق)
           ⇒ **التعدادُ كان سيضيف `region1` وحدَه ويُخالف أوّلَ زائرٍ من إقليمٍ ثانٍ.**
           🟢 **فالعلاجُ نمطٌ لا اسم:** `https://*.analytics.google.com` و
           `https://*.google-analytics.com` — سطران يغطّيان الأقاليمَ كلَّها بدل قائمةٍ تنمو أبداً.
           🔴 **ولا يُوسَّع إلى `*.google.com`** — يبتلع نطاقاتٍ لا علاقةَ لها بالقياس.
           ⚠️ **والمضيفاتُ المرصودةُ تبقى مكتوبةً صراحةً ولو غطّاها البدل** (‏`www.google-analytics.com`):
           البدلُ في CSP **يطابق النطاقاتِ الفرعيّةَ لا النطاقَ المجرَّد**، والصريحُ يوثّق ما قِيس فعلاً. */
        /* 🟢 **`www.googletagmanager.com` أُضيف 2026-09-20 — نقصُ قائمةٍ مُثبَتٌ لا توسيعُ ثقة:**
           جردُ سبعة أيامٍ من `ev:'csp'` أظهر انتهاكاتِ `connect-src` على
           `www.googletagmanager.com/a?id=…` و`/td?id=…` — **والنطاقُ مُدرَجٌ في `script-src`
           أعلاه أصلاً** (‏نحمّل منه `gtag`) ⇒ **موثوقٌ عندنا سلفاً، والغيابُ عن `connect-src`
           سهوٌ بنيويّ**: جردُ 09-11 عدّد ما **يُحمَّل** ولم يعدّ ما **يُرسَل إليه**.
           🔴 **وما لم يُضَف عمداً — ويُقال كي لا يُقرأ سهواً:** `www.google.de|ru/ads/ga-audiences`
           (وأمثالُها من نطاقاتٍ قُطريّة) **إعادةُ استهدافٍ لا تحليلات**، وحجبُها **مكسبٌ**:
           صفرُ أثرٍ على القياس ولا على وظيفة الموقع. ولا تُغطّى ببدلٍ بحال — النطاقاتُ
           القُطريّةُ غيرُ محصورة، و`*.google.com` ممنوعٌ بنصٍّ أعلاه لأنه يبتلع ما لا علاقةَ له. */
        "connect-src 'self' https://script.google.com https://script.googleusercontent.com https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net https://static.cloudflareinsights.com https://cloudflareinsights.com",
        'report-uri /csp-report'
      ].join('; '));

      /* ── 🔒 سياسةٌ **نافذة** — المجموعةُ الآمنةُ وحدَها (2026-09-20 · قرارُ المالك) ──
         🎯 **المبدأ الذي تقوم عليه هذه الكتلة: التوجيهاتُ المشروطةُ بقائمةِ مصادرَ لا
            تُفرَض، والتي لا تحتاج قائمةً تُفرَض.** وهذا ليس تحفّظاً بل **مشتقٌّ من عطلٍ
            وقع هنا حرفياً:** قائمةُ `connect-src` أخفقت **مرّتين في يومٍ واحد** (‏09-11)
            — الأولى بعد أربعين دقيقة، والثانية لأن GA4 يوجّه إلى نقطةٍ **إقليميّةٍ مشتقّةٍ
            من موقع الزائر** ⇒ **كلُّ زائرٍ من إقليمٍ جديدٍ يُنتج مخالفةً جديدة**.
            ⇒ **الإخفاقُ الثالثُ يقع عند مستخدمٍ لا عندنا، ولو كانت نافذةً لَكسرت صامتة.**
         🔴 **ولذلك لا `default-src` ولا `script-src` ولا `style-src` ولا `connect-src`
            ولا `img-src` هنا** — وغيابُها **مقصودٌ ويُقرأ كذلك**: `Report-Only` أعلاه
            يبقى مالكَها ومُعايِرَها.

         **والأربعةُ المفروضةُ هنا مقيسةٌ صفرَ كلفةٍ على `frontend/` المخدوم (2026-09-20):**
           · `object-src 'none'`   ⇐ `<object>` **صفر** · `<embed>` **صفر**
           · `form-action 'self'`  ⇐ `<form>` **صفرٌ إطلاقاً** في كلّ HTML مخدوم
           · `base-uri 'self'`     ⇐ خمسةُ `<base>` **كلُّها `target="_top"` بلا `href`**
                                     (بقيّةُ نمط Apps Script)، و`base-uri` يحكم `href` وحدَه
           · `frame-ancestors 'self'` ⇐ يعادل `X-Frame-Options: SAMEORIGIN` المنشورَ أعلاه
                                     والعاملَ منذ مدّة ⇒ لا سلوكَ جديد، بل صيغةٌ حديثةٌ
                                     تفهمها المتصفّحاتُ التي تتجاهل `XFO`.
         ⚠️ **ويبقى `X-Frame-Options` معه ولا يُحذف** — متصفّحاتٌ قديمةٌ لا تقرأ
            `frame-ancestors`، والرأسان **متوافقان لا متعارضان** (الأشدُّ يحكم).
         🟢 **و`'unsafe-eval'` غيرُ مذكورٍ ولا يلزم:** `eval(` و`new Function` **صفر**
            مقيساً على المخرَج المخدوم — مكسبٌ يُقفَل اليوم بلا ترحيل.
         🔴 **وما لا يُفرَض اليوم يُقال صراحةً بدل الإيهام:** `script-src` و`style-src`
            تحملان `'unsafe-inline'` **ديناً مُعلَناً** — تفرضه **٨٥٠ معالجاً سطريّاً
            (`on…=`) و٢٬٣١٠ سمةَ `style=`** مقيسةً على `/teacher/index.html` الحيّة
            (قِيست في جلسة `SchoolApp-gas`). ⇒ **ترحيلٌ إلى `nonce` في مصدر GAS، لا مفتاحٌ
            هنا**؛ وفرضُهما بـ`'unsafe-inline'` **يُقرأ حمايةً وهو ليس كذلك**. */
      headers.set('Content-Security-Policy', [
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
        "frame-ancestors 'self'",
        /* 🔴 **قناةُ إبلاغٍ للنافذة أيضاً — وغيابُها كان نقصاً حقيقياً لا تزييناً:**
           سياسةٌ نافذةٌ بلا `report-uri` **تحجب ولا تُخبر** ⇒ لو كسرت شيئاً لم نقِسه
           **لعرفناه من شكوى مستخدمٍ لا من سجلّ**. وهي نفسُ علّةِ «`Report-Only` بلا وجهةٍ
           تُسجّل زينةٌ لا حارس» مطبَّقةً على الوجه المقابل.
           🟢 **والتمييزُ بين الرأسين قائمٌ بلا حقلٍ جديد:** توجيهاتُ النافذة الأربعةُ
           **صفرُ تقريرٍ في سبعة أيام** (كلُّ السبعين `connect-src`) ⇒ **أيُّ تقريرٍ يحمل
           `base-uri` أو `object-src` أو `form-action` أو `frame-ancestors` هو انتهاكُ
           النافذة بالضرورة** — يُقرأ من `d` مباشرةً.
           ⚠️ **وحدُّه يُقال: التمييزُ استدلاليٌّ لا بنيويّ** — يصحّ ما دامت الأربعةُ صفراً
           في `Report-Only`، **وينكسر يومَ يظهر انتهاكُ `base-uri` من سببٍ آخر**. وعندها
           يلزم حقلٌ صريح، لا تخمينٌ أدقّ. */
        'report-uri /csp-report'
      ].join('; '));
    }

    // ── هوية الرابط والنطاق (راجع `_identityHeaders` أعلاه للسبب الكامل) ─────
    // يُحسَب مرّةً ويُستخدَم ثلاثاً: رأس `Link`، وحقن `?news=` أدناه، والحقن العامّ في النهاية.
    var _canonHref = _canonicalFor(path, _pathSlug, url.searchParams.get('school'));
    var _idHeaders = _identityHeaders(url.hostname, isHtml, _canonHref);
    Object.keys(_idHeaders).forEach(function (k) { headers.set(k, _idHeaders[k]); });

    /* حقن وسوم OG لكل خبر (?news=<id>) كي تُظهر تطبيقات المشاركة (واتساب/فيسبوك) صورة
       الخبر وعنوانه.

       🟢 **ف2 · 2026-08-29 — الوجهةُ موحَّدةٌ على `GAS.home`.** كان الشرطُ السالب
       `/^\/home\//.test(path) ? 'home' : 'home-all-school'` يوجّه **كلَّ** مسارٍ آخر —
       بما فيه الجذرُ و`/<slug>` — إلى نشرة `home-all-school`. وذاك وصفٌ بائد: الجذرُ
       صار `/home/schools.html` وslug المدرسة صار `/home/index.html` (بند 104)، فلم يبقَ
       من `home-all-school` إلّا هذا النداءُ وحده — آخرُ تبعيةٍ حيّة عليه.

       🔴 **والقلبُ تشديدٌ لا تسريب — قِيس قبل تنفيذه:** `home/Code.js::getNewsOg`
       بثلاثة معاملات `(newsId, schoolId, token)`، يحلّ المستأجر **قبل** أي عملية كاش
       (`_homeSetActiveTenant`)، ويبصم المفتاح بالمعرّف **القانوني** ومستوى التخويل معاً،
       **ويتحقّق من توكن المشاركة** (`_homeVerifyShareToken`). ونظيرُه في
       `home-all-school/Code.js:430` بمعاملَين فقط — **بلا أيّ تحقّقٍ من التوكن** ⇒
       الوجهةُ الجديدة أضيقُ لا أوسع.

       🔴 **ولا `clasp undeploy`:** نشرةُ `home-all-school` تبقى حيّةً خاملةً مسارَ تراجع.
       ⚠️ **وصُحِّح تعليلُها 2026-09-15:** كان مكتوباً هنا «‏و`/home-all-school/index.html`
       يبقى يردّ 200 — **تطبيق SchoolzYemen يشير إليه**». **والمسارُ ما زال ٢٠٠**، لكنّه
       يُخدَم من `frontend/` مبنيّاً من `home/Schools.html` **لا من هذه النشرة**،
       **والتطبيقُ فُطم عنه** (وجهتُه `/home/schools.html`).
       ⇒ **بقاءُ النشرة مبرَّرٌ بكونها مسارَ تراجعٍ وبحارس `protect-deploy-ids` —
       لا بمستهلكٍ حيّ.** 🔴 **والتمييزُ عمليٌّ لا لفظيّ:** مَن يقرأ التعليلَ القديمَ
       اليومَ يظنّ أن حذفَ النشرة يكسر تطبيقاً، **فيبقيها للسبب الخطأ** — أو يحذفها حين
       يكتشف أن السببَ باطل، **وكلا الطريقين يقود إلى قرارٍ غيرِ مسنود.**

       ?t=<توكن> (2026-07-27): توكن معاينة موقَّع (HMAC) — وصار **مستهلَكاً فعلاً** على
       كلّ المسارات لا على `/home/` وحدها. */
    var _newsId = url.searchParams.get('news');
    /* 🔴 `_isPreviewCrawler` — الإنسانُ يأخذ الصفحةَ فوراً بلا نداء GAS (انظر تعريفها).
       و`_newsId` نفسُه لا يُمسّ: كتلُ المُصادِق والهوية أدناه تستثني `?news=` لكلّ زائر كما كانت. */
    if (_newsId && isHtml && _isPreviewCrawler(request.headers.get('User-Agent'))) {
      var _ogApp = 'home';
      // «افتحْ الآن أو تخطَّ» (maxWait = 0): وسوم OG لزائر مشاركة يجب ألّا تُزاحم تسجيل
      // دخول معلّم في الطابور أبداً. عند عدم توفّر مقعد فوراً نتخطّى الحقن ونخدم الصفحة
      // بوسوم الهوية العامة — وهو بالضبط ما يفعله الـcatch أدناه اليوم عند أي فشل.
      // (هذا النداء يستهلك من حصة الثلاثين أيضاً ولم يكن محكوماً إطلاقاً قبل اليوم.)
      var _ogMode = (env && env.BULKHEAD_MODE) || 'on';
      var _ogHeld = (_ogMode !== 'off') ? await _bhAcquire(_ogApp, 0) : null;
      if (_ogMode !== 'off' && !_ogHeld) {
        _bhLog({ ev: 'bulkhead', act: 'skip_og', app: _ogApp, mode: _ogMode, n: _bhN, q: _bhQ.length });
      }
      // التخطّي الفعلي في وضع 'on' فقط: وضع 'shadow' يُسجّل ولا يغيّر السلوك إطلاقاً،
      // ووضع 'off' لا يحكم أصلاً. والتحرير مشروط بـ_ogHeld وحده — تحرير مقعد لم نأخذه
      // كان سيخصم مقعد طلب متزامن آخر ويُفسد العدّاد.
      if (_ogHeld || _ogMode !== 'on') try {
        var _ogTarget = GAS.home;   // ف2: وجهةٌ واحدة — انظر التعليق أعلى الكتلة
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
        // ➕ 2026-09-02: `schoolId` مقبولٌ بجوار `school` — تسويةٌ مع `_tenantKeyFrom`
        // و`frontend/home/newsarticle.html` اللذين يقبلان الاسمين منذ زمن، بينما كان
        // هذا الموضعُ يقرأ `school` وحده ⇒ رابطٌ بـ`?schoolId=` يُمرِّر **فراغاً** إلى
        // `getNewsOg` ⇒ **مدرسةُ المالك** (بند 99). عدمُ تناظرٍ في أسماء المعاملات
        // يُنتج سقوطاً صامتاً إلى مستأجرٍ خاطئ — لا خطأ ولا أثر.
        body: JSON.stringify({ fn: 'getNewsOg', args: [_newsId, _pathSlug || url.searchParams.get('school') || url.searchParams.get('schoolId') || '', url.searchParams.get('t') || ''] })
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
        if (_ogHeld) _bhRelease(_ogHeld);
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
    /* ── المُصادِق المركّب و304 ──────────────────────────────────────────────────
       يُحسَب **قبل** بناء الاستجابة لأن الهوية جزءٌ من المُصادِق: `_brandFromCache` كانت
       تُقرأ داخل كتلة إعادة الكتابة أدناه، فنُقِلت هنا وتُستهلَك في الموضعين — قراءةُ كاشٍ
       واحدة لا اثنتان. و`_brandRefresh` يبقى في `waitUntil` حرفياً كما كان.
       🔴 `?news=` مستثنىً كلّياً (بلا مُصادِق، ويبقى بلا تخزين): حقنُ OG يعتمد نداء GAS
          **يتخطّاه الـbulkhead لا حتمياً** ⇒ نفس العنوان قد يُنتج جسمين في ثانيتين،
          ومُصادِقٌ هناك يُثبّت بطاقة معاينةٍ خاطئة على واتساب بلا رجعة.
       🔴 و`GET` وحده: مُصادِقٌ على استجابة `HEAD`/غيرها لا معنى له. */
    var _tenantKey = _tenantKeyFrom(_rawPath, url.search);
    /* 🟢 مدرسةٌ خارج البذرة الساكنة على بوّابتَي الدخول (`/teacher/<slug>` · `?school=<slug>`):
       قراءةُ كاشٍ واحدة **بلا GAS**، وعلى مسارات البوّابات/الصفحة وحدَها. */
    if (!_tenantKey && isHtml && /^\/(teacher|student|home|portal)(\/|$)/i.test(_rawPath)) {
      var _dynSlugs = await _slugsFromCache(url.origin);
      if (_dynSlugs) _tenantKey = _tenantKeyFrom(_rawPath, url.search, _dynSlugs);
    }
    /* 🎯 توحيدُ الهويّة: الاسمُ المختصرُ يُحَلّ إلى UUID **مرّةً واحدةً هنا**، فما بعده
       (‏`_brandCacheKey` · `_brandRefresh` · الحمولةُ المحقونة) بمعرّفٍ واحدٍ لا اثنين.
       انظر `_tenantCanonical` — وبلا أزواجٍ في السجلّ يبقى المفتاحُ كما وصل. */
    if (_tenantKey) _tenantKey = await _tenantCanonical(_tenantKey, url.origin, env);
    var _brand = null, _brandTs = 0;
    if (isHtml && !isSwOrManifest && ghResp.status === 200 && _tenantKey && !_newsId) {
      var _bc = await _brandFromCache(url.origin, _tenantKey);
      if (_bc) { _brand = _bc.brand; _brandTs = _bc.ts; }
      if (!_brand && ctx && ctx.waitUntil) ctx.waitUntil(_brandRefresh(url.origin, _tenantKey, env));
    }
    if (isHtml && !isSwOrManifest && ghResp.status === 200 &&
        request.method === 'GET' && !_newsId) {
      var _lmMs = _pageLastMod(_upstreamLastMod, _brandTs);
      headers.set('Last-Modified', new Date(_lmMs).toUTCString());
      if (_notModifiedSince(request.headers.get('If-Modified-Since'), _lmMs)) {
        // الجسمُ لا يُستهلَك ⇒ يُلغى صراحةً، وإلّا بقي تدفّقٌ مفتوح بلا قارئ.
        try { if (ghResp.body) ghResp.body.cancel(); } catch (e) { /* أُغلق أصلاً */ }
        return new Response(null, { status: 304, headers: headers });
      }
    }

    /* 🟢 2026-09-03: البوّابة صارت **`_canonHref` أو هويةٌ محلولة** — فتُعاد كتابة بوّابتَي
       الدخول أيضاً حين يُعرَف المستأجر (قرار المالك: الاسم والشعار والهاتف والعنوان على
       السطوح الثلاثة). canonical/og:url يبقيان مشروطَين بـ`_canonHref` وحده (لا يُحقَنان
       على بوّابات الدخول — `_canonicalFor` لم يُمَسّ). وكلفةُ تمرير `teacher/index.html`
       (‏٢ م.ب) عبر HTMLRewriter **تُقاس بعد النشر لا تُفترض**: الأساس المقيس قبله
       median 1ms/p95 3ms على `/teacher/`، ومعيار التراجع p95 > 30ms أو أيّ `1102`.
       والحقنُ لا يقع إلّا حين تكون الهوية في كاش الحافة أصلاً (`_brand` غير فارغ). */
    var _brandOn = !!(_tenantKey && !_newsId && _brand);
    /* روابطُ البوّابات: على سطح `home` وحده، **ولا تنتظر `_brand`** — المفتاحُ من المسار. */
    var _portalOn = !!(_tenantKey && !_newsId && _brandSurfaceFor(_rawPath) === 'home');
    /* 🟢 `window.SCHOOL_ID` على السطوح الثلاثة (2026-09-19): على `home` يوحّد مدخلَ الكاش،
       وعلى البوّابتين يُنقذ مدرسةً خارج البذرة — سكربتُ الصفحة يعرف البذرةَ المبنيّة وحدَها،
       فيسقط إلى `window.SCHOOL_ID` الذي نحقنه (UUID محلولٌ حصراً). */
    var _sidSurface = _brandSurfaceFor(_rawPath);
    var _sidOn = !!(_tenantKey && !_newsId && _schoolIdScript(_tenantKey) &&
                    (_sidSurface === 'home' || _sidSurface === 'teacher' || _sidSurface === 'student'));
    if (isHtml && ghResp.status === 200 && (_canonHref || _brandOn || _portalOn || _sidOn)) {
      var _rw = new HTMLRewriter();
      if (_canonHref) {
        _rw = _rw.on('link[rel="canonical"]', new _AttrSet('href', _canonHref))
                 .on('meta[property="og:url"]', new _AttrSet('content', _canonHref));
      }

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
      // 🔁 `_tenantKey` و`_brand` محسوبان أعلاه (قبل المُصادِق) — لا تُعاد قراءة الكاش هنا.
      if (_tenantKey && !_newsId && _brand) _rw = _brandRewrite(_rw, _brand, _brandSurfaceFor(_rawPath));
      if (_portalOn) _rw = _rw.on('a[data-portal]', new _PortalHref(_tenantKey));
      if (_sidOn) _rw = _rw.on('head', new _SchoolIdHead(_tenantKey));

      return _rw.transform(new Response(ghResp.body, { status: ghResp.status, headers: headers }));
    }

    return new Response(ghResp.body, {
      status: ghResp.status,
      statusText: ghResp.statusText,
      headers: headers
    });
  }
};
