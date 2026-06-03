# school-app-yemen — مدارس الإبداع والتميز الدولية

تحويل تطبيقات Google Apps Script الخمسة من واجهة `google.script.run` (التي تُظهر رسالة
تحذير Google عند الفتح) إلى واجهة ثابتة تُستضاف على **GitHub Pages** وتتصل بـ GAS كـ **API**
عبر `fetch()`.

## التطبيقات الخمسة

| التطبيق | المجلد المصدري (GAS) | الواجهة الثابتة |
|---|---|---|
| الموقع الرئيسي | `home/` | `frontend/home/` |
| بوابة الطالب | `student/` | `frontend/student/` |
| لوحة المعلّم | `teacher/` | `frontend/teacher/` |
| إدارة المحتوى CMS | `cms/` | `frontend/cms/` |
| الجدول الدراسي | `schedule/` | `frontend/schedule/` |

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

لكل مشروع من الخمسة:

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
كل شيء خلف **Cloudflare Worker** على نطاق `workers.dev` غير المحجوب.

- ملف الـ Worker: `worker/school-app-proxy.js`
- يخدم صفحات الواجهة بجلبها من GitHub Pages، ويمرّر نداءات الـ API على `/gas/<app>`
  إلى روابط Google Apps Script. المتصفّح يتكلّم فقط مع نطاق Cloudflare.
- الواجهة تستخدم مساراً نسبياً `/gas/<app>` (لا روابط Google مباشرة) ليعمل الوكيل.

**خطوات النشر:** Cloudflare → Workers & Pages → Create Worker → الصق محتوى
`worker/school-app-proxy.js` → Deploy. الرابط الناتج (مثل
`https://school-app.<account>.workers.dev/`) هو رابط التطبيق النهائي للمستخدمين.

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
> وتجاهل المكرّر) — يتطلب إعادة نشر المشاريع الخمسة مرة واحدة.

> ملاحظة Cloudflare Worker: لا حاجة لتعديله — `Cache-Control: no-store` يخصّ كاش HTTP،
> بينما Service Worker يستخدم Cache API المستقلّ عنه. والمسارات `/sw.js`, `/manifest.webmanifest`,
> `/assets/*` تُخدَم تلقائياً من GitHub عبر الوكيل.

## أدوات البناء
سكربتات `_build/` (Node) تُعيد توليد الواجهة ونقاط الخادم:
- `node _build/build-frontend.js` → يبني `frontend/` (يحقن أيضاً طبقة العمل دون اتصال + تسجيل SW)
- `node _build/gen-endpoints.js` → يولّد `ApiEndpoint.js` في كل تطبيق
- `node _build/extract.js` → يستخرج قوائم الدوال المسموح بها
