# 🤖 ملف ارتباط Claude — منصة مدارس الإبداع والتميز الدولية (School App Yemen)

> هذا المجلد `C:\SchoolApp` هو **المصدر الرسمي المرتبط** للمشروع.
> Claude حاضر ومُرتبط بهذا المشروع كـ "مساعد التشغيل التقني" (Technical Operating Copilot).
> آخر تحديث: 2026-06-13 · الحالة: أمان P1–P3 + التسعيرة مدموجة في الكود (راجع قسم ✅).

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

### ⚙️ أوامر البناء وسير العمل (إلزامي)
```bash
node _build/build-frontend.js   # يبني frontend/ من مصادر HTML (يحقن GA4+robots+الجسر+طبقة offline)
node _build/test-offline.js     # اختبارات العمل دون اتصال + المزامنة (15 اختباراً)
node _build/gen-endpoints.js    # يولّد ApiEndpoint.js داخل كل تطبيق
```
- **لا تُعدّل `frontend/` يدوياً** — هي ناتج مُولّد. عدّل المصدر (مثل `home/Index.html` بأحرف CamelCase) ثم **أعد البناء** والتزم بالمصدر و`frontend/` **معاً**. الاستثناء الوحيد المكتوب يدوياً: `frontend/index.html` (البوابة).
- **CI يفرض التطابق** (`ci.yml`): يعيد البناء ويفشل إن اختلفت `frontend/` عن المصدر. أي تعديل HTML بلا إعادة بناء = بناء أحمر.
- على Windows قد تُظهر `git status` فروق أسطر (CRLF) وهمية بعد البناء — ميّز التغيير الحقيقي بـ `git diff --ignore-all-space` والتزم بالملفات ذات المحتوى الفعلي فقط.

---

## 🔌 ربط البيانات (تم التحقق منه حيّاً)
- موصّل **Google Drive/Sheets** مفعّل وقارئ — تمّ العثور على سجل `Master_Admin_School` الحيّ بالمعرّف المطابق للكود، وعلى ملف مدرسة فعلي «منصة المدرسين».
- موصّل **GitHub** قارئ — المستودع كامل ومتزامن (المحلي `main` = `origin/main` تماماً).
- موصّل **Canva** متاح للتفعيل عند الطلب (هويّة بصرية للمنصّات الخمس).

### البيانات الحيّة المعروفة
- **لوحة المدارس الحيّة** موجودة داخل مشروع **master-admin** (Dashboard من سجل Master).
- **8 مدارس** مُفعَّلة (الافتراضية + العلاء + ابناء الامة + الجيل + البني + جديد + البناء/الجيل الاهلي + ابن خلدون). محرّك مزامنة تلقائي يعمل كل 24 ساعة (grades/fees/violations، ~760 سجلاً).

## 📘 دليل التشغيل والإصلاح (مرجع Claude Code)
> **مصدر الحقيقة للإصلاحات والنشر:** `docs/دليل-التشغيل-والإصلاح-Claude.html`
> **توجيه الجلسات وربط البيانات والتسويق:** `docs/سجلات-Claude-Code-والجلسات.html`
> قبل أي تعديل: اقرأ هذا الملف ثم الدليلين. Claude Code مسؤول عن تنفيذ الإصلاحات بصياغة المشروع؛ Claude يوجّه ويدقّق؛ المالك يوافق وينشر. سجّل أي تغيير جديد في القسم ٣ من الدليل.

## 🧭 توجيه الجلسات (سطر واحد — التفاصيل + Cheatsheet في الدليل أعلاه)
- **Core System**=خلفية GAS/أمان/مزامنة · **Frontend & UI**=`frontend/`/تصميم · **Operations**=نشر/clasp/Worker/health · **Growth & Search**=SEO/اشتراكات/تسعيرة · **Marketing**=محتوى/Canva · **Android**=الغلاف.

## 🧭 مُوجّه الجلسات (Router — اقرأه أولاً · لا تخلط نطاقين · العمق في `docs/ROUTING.md`)

| الجلسة | تملك (افعل هنا) | لا تفعل → سلّم لـ |
|---|---|---|
| **Core System** | منطق GAS/ES5 · `ApiEndpoint`/الأمان/denylist · Tenant · المزامنة · مخطّط Sheets | واجهة→Frontend · نشر→Operations |
| **Frontend & UI** | `frontend/` · HTML مصدر المنصّات · `gas-bridge`/PWA/`sw.js` · RTL | منطق خادمي→Core · نشر→Operations |
| **Operations** | clasp/نشر (نفس Deployment ID) · Worker · CI · health · تراجع · دمج PR | منطق→Core · واجهة→Frontend |
| **Growth & Search** | SEO · الاشتراك/التسعيرة · التحليلات · التدقيق | كود خلفي→Core · زر→Frontend · نشر→Operations |
| **Marketing** | محتوى/سوشل · Canva · الهوية (claude.ai لا Code) | أي كود→الجلسة التقنية |
| **Android** | غلاف WebView (مستودع منفصل) · AppConfig · `?action=deployments` | كود الويب→Frontend/Core |

**التصعيد (كل تغيير كود ينتهي عند Operations):** `Core (منطق/مخطّط) → Frontend+Android (استهلاك العقد) → Operations (نشر+health)`.
- غيّرت اسم/توقيع دالة خلفية؟ بلّغ Frontend (تصنيف gas-bridge + مواضع الاستدعاء) + Android ← ثم Operations يعيد النشر.
- منطق dون اتصال؟ ارفع كاش `sw.js` (دليل §7) ← Operations. · ثغرة أمنية؟ Core فوراً (denylist) ← Operations (تراجع/نشر طارئ).

**شجرة القرار (أول تطابق يفوز):** ①جوال/Kotlin/Play→**Android** · ②بصري/سوشل/Canva بلا كود→**Marketing** · ③نشر/Worker/CI/health/تراجع بلا كود→**Operations** · ④SEO/اشتراك/تسعيرة/تحليلات→**Growth** · ⑤منطق خادمي/بيانات/أمان→**Core** · ⑥واجهة HTML/CSS/PWA→**Frontend** · ⑦عدّة نطاقات→**Cowork** يقسّمه حسب التصعيد.

**منع تكرار السياق:** كل جلسة تفتح **ذاكرتها فقط** — Core/Frontend=`schoolapp-deployment` · Ops=`schoolapp-status`+`schoolapp-github-network` · Growth=`schoolapp-analytics`+`schoolapp-audit-baseline` · Android=`schoolapp-android`. القواعد الحاكمة (§🔒) مشتركة — لا تتكرر في الجلسات.

## ✅ الإصلاحات المنفّذة في الكود (بانتظار النشر)
- **المرحلة 1:** سدّ ثغرة `provisionNewSchool` (مفتاح دعوة إجباري + استثناء المالك) — `master-admin/Master_Admin.js` + `frontend/master-admin/index.html`.
- **المرحلة 2:** حجب 10 دوال مكشوفة في `master-admin/ApiEndpoint.js` (أهمها `getMasterSetting` التي كانت تسرّب `invite_key`) + مزامنة `_build/denylist.generated.json`.
- **المرحلة 3:** دمج التسعيرة — `DEPLOY_PRICING` في `home/Code.js` + مسار `/pricing` في الـWorker.

## 💲 منصّة التسعيرة (التطبيق السابع — مدموجة في الكود)
- **Script ID:** `10e-pf9KN0OaBhdWa1BjiDSfh0_RJwezwHSRowaB5Nj6gbV-KMXrfMXeg`
- **رابط النشر /exec:** `https://script.google.com/macros/s/AKfycbz11yUbrix4F1lE_GbiAFqE3EClGpoRvAb19LoLoABQX_Xo3i2U25jlQpOFcN9S_yLC/exec`
- **الوصول:** عبر الوكيل `https://<worker>/pricing` (HTML نظيف)، أو ديناميكياً عبر `getDeploymentUrls().pricing` و`?action=deployments` (أندرويد).
- **مكان التشغيل المناسب:** صفحة عامة (تسويق اشتراكات المدارس) تُربط من **الموقع الرئيسي (home)** ومن **master-admin** قرب تجديد الاشتراك `renewSubscriptionProtected`.

---

## 🐞 خلاصة التدقيق
> التفاصيل الكاملة: `docs/تدقيق-النظام-لوحة-تفاعلية.html` + ذاكرة `schoolapp-audit-baseline.md`.
**الأبرز (حَرِج):** `ApiEndpoint.js` يعتمد قائمة منع لا سماح؛ `whitelist.json` غير مُفعّل وقت التشغيل → أولوية المرحلة 1.

---

## 🧭 المراحل القادمة (بالترتيب)
- **المرحلة 0 (الآن):** مزامنة المحلي ↔ GitHub + نسخة احتياطية. ← *نقطة البداية.*
- **المرحلة 1 (أمان):** تفعيل whitelist فعلياً + إزالة eval + اشتراط التوكن على دوال الإدارة.
- **المرحلة 2 (وظيفي):** تنفيذ/إزالة الدوال المكسورة + `Terms.html` + تعبئة دوال schedule.
- **المرحلة 3 (صيانة):** توحيد المكتبات المكرّرة عبر `_build/` + تنظيف الملفات.
- **المرحلة 4 (متانة):** opId خادمي + إبطال كاش تلقائي + تضييق CSP.

> أي تنفيذ يبدأ بإذن صريح من المالك، مشروعاً واحداً في كل مرة، مع إبقاء Deployment IDs ثابتة.
