# 🤖 ملف ارتباط Claude — منصة مدارس الإبداع والتميز الدولية (School App Yemen)

> هذا المجلد `C:\SchoolApp` هو **المصدر الرسمي المرتبط** للمشروع.
> Claude حاضر ومُرتبط بهذا المشروع كـ "مساعد التشغيل التقني" (Technical Operating Copilot).
> آخر تحديث: 2026-06-11 · الحالة: تمّ التدقيق الكامل · لم يُعدَّل أي كود.

---

## 🎯 دور Claude في هذا المشروع
- تحليل الأكواد وتصحيح الأخطاء وتوثيق التدفقات بين الأنظمة.
- توجيه إعدادات GCP / GitHub / Cloudflare / Apps Script.
- ضمان التوافق مع **ES5 + Apps Script** في كل الخلفية.
- العمل وفق مبدأ: **افهم أولاً، لا تكسر التوافق، لا تلمس معرّفات النشر.**

## 🔒 قواعد حاكمة (إلزامية لأي تعديل لاحق)
1. **لا تعديل بدون إذن صريح** لكل تغيير على حدة.
2. صياغة الخلفية: `var` فقط، دوال عادية، بلا قوالب نصية، متوافقة ES5.
3. **ثبات Deployment IDs**: عند إعادة النشر استخدم *New version* لنفس الـDeployment فقط، حتى تبقى روابط `/exec` والـWorker صالحة.
4. تعديل **مشروع GAS واحد في كل مرة** والتحقق عبر `?action=health` قبل الانتقال.
5. فرع لكل تغيير (Pull Request)، لا دفع مباشر إلى `main`.

---

## 🏛️ المعمارية (ثلاث طبقات)
**الطبقة 1 — البيانات (Google Sheets):**
- سجل المدارس الرئيسي `Master_Admin_School` — ID: `10Zk0vwjrHagydYlU0kyjB6X9uoyVCN6sl5nSet1_c7w`
  - ورقة `Schools`: school_id(0)، name(1)، teacher_file_id(4)، student_file_id(5)، cms_file_id(6)، schedule_file_id(7)، subscription_end(9)، is_active(10).
- ورقة الموقع العام — ID: `1J7DY-Z2PZU5y5HH-LR3vhuEhPAkjWz22vMu1rYLcse0` (News/Images/Videos/Stats).
- كل مدرسة لها ملفات teacher/student/cms/schedule مستقلّة تُحلّ معرّفاتها من سجل Master وقت الطلب.

**الطبقة 2 — الخلفية (6 مشاريع GAS، ES5):**
`home` · `teacher` · `student` · `cms` · `schedule` · `master-admin`
- كل مشروع: `doGet` (HTML) + `doPost` عبر `ApiEndpoint.js` (JSON API).
- النشر: Execute as **Me** · Access **Anyone**.
- تعدّد المدارس عبر `_Tenant.js` / `_MasterScope.js` بقراءة سجل Master.

**الطبقة 3 — العرض:**
- واجهة ثابتة على **GitHub Pages** (`frontend/`) + `gas-bridge.js` يعيد تعريف `google.script.run` كـ XHR POST.
- **Cloudflare Worker** (`worker/school-app-proxy.js`) يمرّر `/gas/<app>` ويخدم الصفحات (لتجاوز حجب github.io في اليمن).
- **PWA** عمل دون اتصال: `sw.js` + IndexedDB + طابور `outbox`.
- **تطبيق أندرويد** (WebView) — مستودع منفصل: `com.proconrers.schoolappyemen`.

**المستودع المصدر:** https://github.com/procorners-labs/school-app-yemen-web
**أدوات البناء:** `_build/` → `build-frontend.js` · `gen-endpoints.js` · `extract.js`

---

## 🔌 ربط البيانات (تم التحقق منه حيّاً)
- موصّل **Google Drive/Sheets** مفعّل وقارئ — تمّ العثور على سجل `Master_Admin_School` الحيّ بالمعرّف المطابق للكود، وعلى ملف مدرسة فعلي «منصة المدرسين».
- موصّل **GitHub** قارئ — المستودع كامل ومتزامن (المحلي `main` = `origin/main` تماماً).
- موصّل **Canva** متاح للتفعيل عند الطلب (هويّة بصرية للمنصّات الخمس).

### البيانات الحيّة المعروفة
- **لوحة المدارس الحيّة** موجودة داخل مشروع **master-admin** (Dashboard من سجل Master).
- **8 مدارس** مُفعَّلة (الافتراضية + العلاء + ابناء الامة + الجيل + البني + جديد + البناء/الجيل الاهلي + ابن خلدون). محرّك مزامنة تلقائي يعمل كل 24 ساعة (grades/fees/violations، ~760 سجلاً).

## 💲 منصّة التسعيرة (التطبيق السابع — قيد الدمج)
- **Script ID:** `10e-pf9KN0OaBhdWa1BjiDSfh0_RJwezwHSRowaB5Nj6gbV-KMXrfMXeg`
- **رابط النشر /exec:** `https://script.google.com/macros/s/AKfycbz11yUbrix4F1lE_GbiAFqE3EClGpoRvAb19LoLoABQX_Xo3i2U25jlQpOFcN9S_yLC/exec`
- **مكان التشغيل المناسب:** صفحة عامة (تسويق اشتراكات المدارس) تُربط من **الموقع الرئيسي (home)** ومن **master-admin** قرب تجديد الاشتراك `renewSubscriptionProtected`.
- **نقاط الدمج الديناميكي (بانتظار الموافقة):** (1) `DEPLOY_PRICING` في سجل النشر بـ `home/Code.js`؛ (2) `pricing` في خريطة `GAS` بالـWorker؛ (3) صفحة/رابط في `frontend/`. التطبيق على أندرويد يلتقطها تلقائياً عبر `?action=deployments`.

---

## 🐞 خلاصة التدقيق (التفاصيل في: `تدقيق-النظام-لوحة-تفاعلية.html` بمجلد المشروع)
**حَرِج:** `ApiEndpoint.js` يعتمد قائمة منع لا قائمة سماح → أي دالة عامّة قابلة للاستدعاء من زائر مجهول؛ `whitelist.json` غير مُفعّل وقت التشغيل.
**عالٍ:** النسخة المحلية غير متزامنة مع GitHub · معرّفات حسّاسة في مستودع عام · `checkSession`/`getStudentsForView` مُستدعاة بلا تنفيذ · قائمة API لمنصّة `schedule` فارغة.
**متوسط:** `?page=terms` يشير إلى `Terms.html` مفقود · تكرار `DriveUrlUtils`/`DeploymentRegistry` عبر الوحدات · ترويسة `cms/_Tenant.js` موسومة خطأً "منصة المعلم" · الوكيل يجرّد CSP عالمياً · قيد `Session.getActiveUser()`.
**منخفض:** ملفات «بلا عنوان» · ملفات اختبار مع الإنتاج · إبطال كاش يدوي · لا منع تكرار خادمي (opId).

---

## 🧭 المراحل القادمة (بالترتيب)
- **المرحلة 0 (الآن):** مزامنة المحلي ↔ GitHub + نسخة احتياطية. ← *نقطة البداية.*
- **المرحلة 1 (أمان):** تفعيل whitelist فعلياً + إزالة eval + اشتراط التوكن على دوال الإدارة.
- **المرحلة 2 (وظيفي):** تنفيذ/إزالة الدوال المكسورة + `Terms.html` + تعبئة دوال schedule.
- **المرحلة 3 (صيانة):** توحيد المكتبات المكرّرة عبر `_build/` + تنظيف الملفات.
- **المرحلة 4 (متانة):** opId خادمي + إبطال كاش تلقائي + تضييق CSP.

> أي تنفيذ يبدأ بإذن صريح من المالك، مشروعاً واحداً في كل مرة، مع إبقاء Deployment IDs ثابتة.
