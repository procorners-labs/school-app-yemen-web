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

## ملاحظات / قيود معروفة
- الدالتان `checkSession` (home) و`getStudentsForView` (teacher) تُستدعيان من الواجهة
  لكن **لا تنفيذ خادمي لهما** في الكود الأصلي — سيرد `doPost` بخطأ نظيف يلتقطه معالج
  الفشل (نفس سلوك الأصل).
- الدوال التي تعتمد على `Session.getActiveUser()` تعمل بهوية مالك النشر (Execute as Me)
  وليس بهوية الزائر، بسبب طبيعة طلبات `fetch` الخارجية.
- `frontend/student/reports.html` و`teacher/reports.html` غير منشأة عمداً لأن ملفّي
  `*_Reports.html` المصدريين **مقتطفات** تُدمج داخل البوابة، لا صفحات مستقلة.

## أدوات البناء
سكربتات `_build/` (Node) تُعيد توليد الواجهة ونقاط الخادم:
- `node _build/build-frontend.js` → يبني `frontend/`
- `node _build/gen-endpoints.js` → يولّد `ApiEndpoint.js` في كل تطبيق
- `node _build/extract.js` → يستخرج قوائم الدوال المسموح بها
