# school-app-yemen — مدارس الإبداع والتميز الدولية

تحويل تطبيقات Google Apps Script من واجهة `google.script.run` (التي تُظهر رسالة
تحذير Google عند الفتح) إلى واجهة ثابتة تُستضاف على **GitHub Pages** وتتصل بـ GAS كـ **API**
عبر `fetch()`.

## التطبيقات ومسارات `/gas/<app>`

> 🔴 **كان هذا القسم يقول «التطبيقات الخمسة» ويسرد `student` و`schedule` سطحَين حيَّين
> مستقلَّين — وهو وصفٌ سابقٌ للفطم والتقاعد.** الجدولُ أدناه يطابق `var GAS` في
> `worker/school-app-proxy.js` وما يليه من تحويل، **لا ذاكرةَ محرِّرٍ**. والمصدرُ الحاكم
> للحالة هو الكود: اقرأ `var GAS` والسطرَ `GAS.student = GAS.teacher;`.

| المسار | المجلد المصدري (GAS) | الحال |
|---|---|---|
| `/gas/home` | `home/` | 🟢 حيّ — والجذرُ `/` يُخدَم من `home/schools.html` |
| `/gas/teacher` | `teacher/` | 🟢 حيّ |
| `/gas/student` | `teacher/` ← **لا `student/`** | ⚠️ **مفطوم**: يُخدَم من نشرة **المعلّم** بمُميِّز `app=student`. ونشرةُ `student` الخاصّة **مسارُ تراجعٍ خامل** — 🔴 لا يُنشَر عليها |
| `/gas/cms` | `cms/` | 🟢 حيّ |
| `/gas/master-admin` | `master-admin/` | 🟢 حيّ |
| `/gas/home-all-school` | `home-all-school/` | ⚠️ **مفطومٌ عملياً** — الجذرُ لم يعُد يقصده. النشرةُ حيّةٌ خاملة و`/home-all-school/index.html` يردّ 200 (تطبيق يمن سكولز يشير إليه) |
| `/gas/schedule` | `schedule/` | ⚠️ **متقاعدٌ كمصدرِ حقيقة** — الشبكةُ صارت مصدرَ الحقيقة. والمسارُ محجوزٌ في `_RESERVED_TOP_PATHS` عمداً ويحرسه `worker/test-routes.js` |
| `/pricing` | مشروع GAS مستقلّ | 🟢 صفحةُ تسعيرة فقط — يبنيها الوركرُ نفسُه HTML |

🔴 **وأثرٌ تشغيليٌّ يتبع الفطم ولا يُغفَل:** طيُّ `student` في نشرة `teacher` يجعل حملَ
المنصّتين على **مشروع Apps Script واحد**، والحصّةُ **٣٠ تنفيذاً متزامناً للحساب كلّه** لا
لكلّ مشروع ⇒ **حملُ الطالب يُسقط دخولَ المعلّم.**

## كيف يعمل الحل

1. **جسر العميل** `frontend/assets/gas-bridge.js` يعيد تعريف `google.script.run`
   ليوجّه كل استدعاء إلى نقطة `doPost` في تطبيق GAS عبر `fetch()`. لذلك **لم يُعدَّل**
   أي موضع استدعاء في الصفحات — الكود الأصلي يعمل كما هو.
2. **نقطة الخادم** `ApiEndpoint.js` (أُضيفت إلى كل مشروع GAS) فيها `doPost(e)` يفكّ
   الطلب وينفّذ الدالة المطلوبة — **فقط** إن كانت ضمن قائمة `API_ALLOWED_FUNCTIONS`
   (حماية) — ويُعيد النتيجة JSON.
3. كل صفحة في `frontend/` تضبط `window.GAS_ENDPOINT` الخاص بتطبيقها، ويمكن تمرير
   `?schoolId=...` في الرابط لتحديد المدرسة (يحلّ محل قالب الخادم `<?= schoolId ?>`).

### ملاحظة CORS مهمّة
- لا يستطيع GAS ضبط ترويسة `Access-Control-Allow-Origin` يدوياً، لكن رابط `/exec`
  المنشور يُرجِعها تلقائياً (`*`).
- يرسل الجسر الطلب بنوع `Content-Type: text/plain` ليبقى **طلباً بسيطاً** فلا يُطلب
  `preflight (OPTIONS)` الذي لا يملك GAS داله للرد عليه.

## خطوات النشر على جانب Google Apps Script (مطلوبة لمرة واحدة)

لكلّ مشروعٍ حيٍّ في جدول التطبيقات أعلاه (‏🔴 **لا `student/` ولا `schedule/`** — المفطومُ
يُخدَم من نشرة المعلّم، والمتقاعدُ لا يُنشَر عليه):

1. أضِف الملف `ApiEndpoint.js` الموجود في مجلده إلى مشروع GAS المقابل
   (انسخه كما هو، أو ارفعه عبر `clasp push`).
2. أعد النشر: **Deploy → Manage deployments → Edit → New version → Deploy**.
   > مهم: أبقِ على نفس الـ Deployment ID حتى تبقى روابط `/exec` كما هي.
3. تأكّد من إعدادات النشر:
   - **Execute as:** `Me (owner)`
   - **Who has access:** `Anyone`
   
   (هذا ضروري ليعمل `fetch` من نطاق خارجي دون تسجيل دخول Google.)

## النشر على GitHub Pages

يوجد سير عمل `.github/workflows/pages.yml` ينشر مجلد `frontend/` تلقائياً عند كل دفع
إلى `main`. بعد الدفع: فعّل **Settings → Pages → Source: GitHub Actions**.

الرابط الناتج: `https://<USERNAME>.github.io/school-app-yemen/`

## التشغيل بدون VPN (المناطق التي يُحجب فيها github.io — مثل اليمن)

في بعض الدول يُحجب نطاق `github.io` (بينما تعمل خدمات Google عادةً). الحل: وضع
كل شيء خلف **Cloudflare Worker**.

- ملف الـ Worker: `worker/school-app-proxy.js`
- يخدم صفحات الواجهة بجلبها من GitHub Pages، ويمرّر نداءات الـ API على `/gas/<app>`
  إلى روابط Google Apps Script. المتصفّح يتكلّم فقط مع نطاق Cloudflare.
- الواجهة تستخدم مساراً نسبياً `/gas/<app>` (لا روابط Google مباشرة) ليعمل الوكيل.

**خطوات النشر:** Cloudflare → Workers & Pages → Create Worker → الصق محتوى
`worker/school-app-proxy.js` → Deploy. الرابط الناتج (مثل
`https://school-app.<account>.workers.dev/`) هو رابط تلقائي مجاني، لكنه معرَّض هو نفسه
للحجب في بعض الشبكات (نطاقا `workers.dev`/`pages.dev` مُساء استخدامهما عالمياً لأدوات
VPN/الالتفاف، فيُستهدَفان أحياناً بحجب DNS كامل — حدث فعلياً على شبكة يمن نت 2026-07-16).
التوجيهُ بالكامل مبنيٌّ على **المسار لا اسم المضيف** ⇒ ربطُ نطاقٍ جديد لا يحتاج تعديلَ كود.

### 🔴 النطاق القانونيّ — تصحيحٌ مقيس (2026-09-08)

**كان مكتوباً هنا: «رابط التطبيق النهائي القانوني … `school.procorners.com`» و«**لا بديل
لـ`school.procorners.com`** — يبقى نطاق التشغيل الأساسي».**
🔴 **والشقُّ الأوّل يناقض الكودَ في هذا المستودع نفسِه:**
`worker/school-app-proxy.js` يُعلن `CANONICAL_ORIGIN = 'https://yemenschoolz.com'`،
و`REDIRECT_TO_CANONICAL` يحوّل `www.yemenschoolz.com` إليه، و`_isCanonHost` يعرف
`yemenschoolz.com` و`www` وحدهما. (المواضعُ تُقرأ بـ`grep -n "CANONICAL_ORIGIN" worker/school-app-proxy.js`
— **ولا يُثبَّت رقمُ سطرٍ هنا: يتقادم بصمت.**)

🟢 **والشقُّ الثاني — «لا بديل له» — صحيحٌ بالقياس، ولسببٍ لم يكن مكتوباً:**
توزيعُ الحركة الفعليّ على نافذةٍ **خاليةٍ من أيّ نشر** (`2026-09-07T03:00Z → 09-08T14:00Z`)،
مجمَّعاً بـ`$workers.event.request.headers.host` (‏n = **29,959**):

| المضيف | الطلبات | النسبة |
|---|---|---|
| `school.procorners.com` | **22,402** | **٧٤٫٨٪** |
| `yemenschoolz.com` | 5,977 | ١٩٫٩٪ |
| `school-teacher-proxy.…workers.dev` | 1,189 | ٤٫٠٪ |
| `www.yemenschoolz.com` | 348 | ١٫٢٪ |
| `app.yemenschoolz.com` | 43 | ٠٫١٤٪ |

⇒ **الفرقُ بين «القانونيّ» و«المستعمَل» حقيقيٌّ ويُقال صراحةً:** الكودُ يُعلن
`yemenschoolz.com` قانونياً، **والمستخدمون على `school.procorners.com` بثلاثةِ أرباعهم**.
🔴 **فتقاعدُ `school.procorners.com` حدثٌ كبيرٌ لا تنظيف** — ولا يُقرَّر بلا خطّةِ تحويلٍ
وقياسٍ بعده. **وكلاهما يبقى مربوطاً**، ولا يُحذف أيٌّ منهما بحجّة «التوحيد».

🔒 **وأربعةُ مضيفاتٍ تعني أربعَ نسخٍ من كاش الحافّة:** مفتاحُ الكاش يبدأ بـ`origin`
(‏`_apiCacheKey` · `_brandCacheKey` · `_slugsCacheKey`) ⇒ الحمولةُ الواحدة تُخزَّن مرّةً
لكلّ مضيف. وهذا **ليس عطلاً يُصلَح بإسقاط `origin`** — إسقاطُه يخلط أصولاً، لكنه يفسّر
جزءاً من ضعف نسبة الإصابة (انظر `_docs/2026-09-08-*`).

**والنطاقُ الثاني `yemenschoolz.com`** رُبط 2026-07-25 كـCustom Domain إضافيٍّ على **نفس**
الوركر (لحلّ تعارض Google OAuth Console Branding مع `procorners.com` — نطاقِ متجر «ركن
التسوق» المنفصل). وصفحةُ `/pricing` التي يبنيها الوركرُ مباشرةً تُصرّح به في
`canonical`/`og:url`/`og:image`/`twitter:image` (‏PR#105 — الموضعُ يُقرأ بـ`grep -n "og:url" worker/school-app-proxy.js`).
التفصيل: `school-app-yemen-gas/_docs/2026-07-16-…` و`…2026-07-25-تعارض-نطاق-مشترك-oauth-branding-ونطاق-مخصص.md`.

## ملاحظات / قيود معروفة
- الدالتان `checkSession` (home) و`getStudentsForView` (teacher) تُستدعيان من الواجهة
  لكن **لا تنفيذ خادمي لهما** في الكود الأصلي — سيرد `doPost` بخطأ نظيف يلتقطه معالج
  الفشل (نفس سلوك الأصل).
- الدوال التي تعتمد على `Session.getActiveUser()` تعمل بهوية مالك النشر (Execute as Me)
  وليس بهوية الزائر، بسبب طبيعة طلبات `fetch` الخارجية.
- `frontend/student/reports.html` و`teacher/reports.html` غير منشأة عمداً لأن ملفّي
  `*_Reports.html` المصدريين **مقتطفات** تُدمج داخل البوابة، لا صفحات مستقلة.

## العمل دون اتصال + المزامنة التلقائية (Offline-First)

المنصّة تعمل الآن **دون إنترنت** وتتزامن **تلقائياً** عند عودة الاتصال (مهمّ لاستقرار
الشبكة في اليمن). التطبيق قابل للتثبيت على الجوال (PWA).

**كيف يعمل (الطبقة في مكان واحد فوق `gas-bridge.js`):**
- `frontend/sw.js` — Service Worker يخزّن قشرة التطبيق فتُفتح الصفحات دون اتصال
  (التنقّل: شبكة أولاً ثم الكاش؛ نداءات `/gas/*` تمريراً فقط بلا تخزين).
- `frontend/assets/offline-db.js` — تخزين دائم عبر IndexedDB (مع تراجع localStorage).
- `frontend/assets/offline-sync.js` — محرك التصنيف + الطابور + المزامنة + شارة الحالة:
  - **قراءة (كل التطبيقات):** تُخزَّن نتائج `get*`/`checkSession`… وتُخدَم آخر نسخة دون اتصال.
  - **كتابة (لوحة المعلّم فقط):** `saveAttendanceSingleProtected`, `addListItemProtected`,
    `updateListItemProtected`, `deleteListItemProtected`, `adminSaveTeacherGrouped`,
    `adminDeleteTeacherByName` تُحفظ في طابور `outbox` وتُزامَن تلقائياً (FIFO + إعادة محاولة
    بتراجع أُسّي + Background Sync). لا تُحذف عملية قبل تأكيد نجاحها.
  - **online-only:** المصادقة/الرفع/الكتابات خارج النطاق تفشل بلطف دون اتصال.
  - **جلسة دائمة:** جلسة المعلّم/الطالب تُحفظ بشكل دائم ليعمل التطبيق بعد إعادة الفتح دون نت.
- شارة عائمة عربية تُظهر حالة الاتصال وعدد العمليات المعلّقة + إشعارات نجاح/فشل المزامنة.
- `frontend/manifest.webmanifest` + أيقونات `frontend/assets/icon-*.png` (قابل للتثبيت).

> **لا يتطلّب إعادة نشر GAS.** كل المنطق في الواجهة. الطابور يرسل عملية واحدة وينتظر تأكيد
> `ok` قبل حذفها لتقليل التكرار.
>
> **(اختياري لاحقاً) حماية تكرار على الخادم:** عند الرغبة بضمان أقوى، يمكن إضافة فحص
> مُعرّف عملية (`opId`) في `*/ApiEndpoint.js` (تخزين مُعرّفات آخر 24 ساعة في `CacheService`
> وتجاهل المكرّر) — يتطلب إعادة نشر المشاريع الحيّة مرة واحدة.

> ملاحظة Cloudflare Worker: لا حاجة لتعديله — `Cache-Control: no-store` يخصّ كاش HTTP،
> بينما Service Worker يستخدم Cache API المستقلّ عنه. والمسارات `/sw.js`, `/manifest.webmanifest`,
> `/assets/*` تُخدَم تلقائياً من GitHub عبر الوكيل.

## أدوات البناء

🔴 **`_build/` ليست في هذا المستودع** — موضعُها `C:\Users\osama\SchoolApp-gas`، و`frontend/`
هنا **مخرَجٌ مولَّد** يدفعه CI ويدهس أيَّ تعديلٍ يدويّ. الأوامرُ أدناه تُشغَّل **هناك لا هنا**:
- `node _build/build-frontend.js` → يبني `frontend/` (يحقن أيضاً طبقة العمل دون اتصال + تسجيل SW)
- `node _build/gen-endpoints.js` → يزامن قوائم الدوال الخطرة في `ApiEndpoint.js` من `denylist.generated.json` (غير تدميري — لا يلمس بقية الملف؛ `--check` للفحص فقط)
- `node _build/extract.js` → يستخرج قوائم الدوال المسموح بها
