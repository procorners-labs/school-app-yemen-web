# 🧭 نظام توجيه الجلسات — School App Yemen

> **مصدر الحقيقة الوحيد لحدود الجلسات.** المُوجّه المضغوط في `CLAUDE.md §🧭` يُقرأ في كل
> جلسة؛ هذا الملف يُفتح **عند الالتباس فقط**. لا تنسخ محتواه إلى CLAUDE.md ولا إلى جلسة أخرى.

## 0) لماذا هذا التصميم (اقتصاد الرموز)
`CLAUDE.md` يُحمَّل في سياق **كل** جلسة وكل دور → يجب أن يبقى **موجّهاً خفيفاً** (جدول + شجرة).
العمق (هذا الملف) + تفاصيل النطاق (ملفات الذاكرة) تُفتح **عند الطلب**. القاعدة الذهبية:

- **مشترك ونادر التغيّر** → `CLAUDE.md` (القواعد الحاكمة + المعمارية + المُوجّه).
- **خاص بنطاق واحد** → ملف ذاكرة ذلك النطاق (انظر §5). لا تكرّره في CLAUDE.md.
- كل جلسة تفتح **ذاكرتها فقط**؛ لا تقرأ تفاصيل نطاق ليس لك.

---

## 1) حدود المسؤولية الدقيقة (DO / DON'T / سلّم لـ)

### 🟣 Core System — المنطق والبيانات
- **افعل:** منطق GAS (ES5) في الملفات `*.js` للمشاريع الستة · `ApiEndpoint.js` وسياسة الأمان/`denylist.generated.json` · حلّ المستأجر `_Tenant.js`/`_MasterScope.js` · محرّك المزامنة (grades/fees/violations) · مخطّط أوراق Sheets ومنطق الدرجات/الحجب/الاشتراك الخلفي.
- **لا تفعل:** HTML/CSS، النشر، SEO، المحتوى، كود أندرويد.
- **سلّم:** الواجهة→Frontend · النشر→Operations · سياسة الاشتراك/التسعير→Growth (التنفيذ الخلفي يبقى Core).

### 🟢 Frontend & UI — العرض
- **افعل:** `frontend/` (المُخرَج) + HTML المصدر داخل مجلدات المنصّات (`teacher/Teacher Dashboard.html`…) · `gas-bridge.js` · طبقة PWA (`sw.js`, `offline-db.js`, `offline-sync.js`) · `_build/build-frontend.js` · RTL/التصميم.
- **لا تفعل:** منطق خادمي، مخطّط Sheets، دفع GAS، إعدادات النشر.
- **سلّم:** منطق خادمي→Core · النشر/رفع الكاش الفعلي→Operations.

### 🟠 Operations — الشحن والتشغيل
- **افعل:** النشر (`clasp push` + إعادة نشر **بنفس Deployment ID**) · Cloudflare Worker · CI `.github/workflows/` · `_build/*.ps1` · فحص `?action=health` · الإصدارات والتراجع · دمج PR.
- **لا تفعل:** كتابة منطق أو واجهة (تشحنها فقط).
- **سلّم:** خلل منطقي→Core · خلل واجهة→Frontend.

### 🔵 Growth & Search — تنمية المنتج
- **افعل:** SEO (`sitemap.xml`/`robots.txt`) · دورة الاشتراك والتجديد (`checkSubscriptions`, `renewSubscriptionProtected`) · صفحة `/pricing` · التحليلات (GA4) · التدقيق والبحث.
- **لا تفعل:** إصلاح خلفي منخفض المستوى، النشر، الواجهة التفصيلية.
- **سلّم:** الدالة الخلفية→Core · الزر/الصفحة→Frontend · النشر→Operations · الترويج→Marketing.

### 🔴 Marketing — المحتوى والهوية
- **افعل:** منشورات/سوشل · قوالب Canva · الهوية البصرية · نسخ الموقع التسويقية. (يُدار من **claude.ai + Canva MCP**، ليس Claude Code.)
- **لا تفعل:** أي تعديل كود.
- **سلّم:** أي كود→الجلسة التقنية المناسبة.

### ⚪ Android — الغلاف
- **افعل:** غلاف WebView `com.proconrers.schoolappyemen` (**مستودع منفصل**: `C:\Users\osama\AndroidStudioProjects\SchoolAppyemen`) · `AppConfig` · البناء/keystore/Play Store · استهلاك `?action=deployments`.
- **لا تفعل:** كود الويب.
- **سلّم:** كود الويب→Frontend/Core.

---

## 2) التداخلات المكتشفة (مناطق الالتباس + من يملك القرار)

| منطقة التداخل | يملك القرار | المُستشار / الحدّ |
|---|---|---|
| HTML مصدر المنصّات (داخل مجلد GAS لكنه واجهة) | **Frontend** (HTML/CSS/JS-في-الصفحة) | Core يملك فقط عقد `<?= ?>` واستدعاءات الخادم |
| `gas-bridge.js` / `offline-sync.js` تصنيف الدوال | **Frontend** يملك الملف | Core يُستشار عند تغيّر اسم/توقيع دالة خلفية |
| `ApiEndpoint.js` (denylist) | **Core** يقرّر المحتوى (أي دالة خطرة) | Operations يفرض البوابة `gen-endpoints.js --check` في CI |
| `getDeploymentUrls()` (الروابط) | **Core** يعرّف | Frontend/Android يستهلكان · Operations ينشر |
| `sw.js` رقم الكاش | **Frontend** يرفعه عند تغيّر منطق dون اتصال (دليل §7) | Operations ينشر |
| `worker/school-app-proxy.js` | **Operations** يحرّر | Core يُستشار لعقد نقاط `/gas/<app>` |
| **التسعيرة/الاشتراك** (لمسة رباعية) | **Growth** يقود | Core(دالة)→Frontend(زر)→Operations(نشر)→Marketing(ترويج) |

> قاعدة فضّ النزاع: **مالك القرار يعدّل؛ البقية يُستشارون أو يستهلكون.** لا تعدّل ملفاً يملك قراره نطاق آخر دون تسليم.

---

## 3) سلسلة التصعيد (التموّج — كل تغيير كود ينتهي عند Operations)

اتجاه الاعتماد: `بيانات/مخطط (Core) → منطق خلفي (Core) → عقد API → {Frontend, Android} → نشر (Operations)`

- **غيّرت اسم/توقيع دالة خلفية؟** → بلّغ Frontend (تصنيف `gas-bridge` + مواضع الاستدعاء) + Android (إن استدعاها) → Operations يعيد نشر GAS.
- **غيّرت مخطّط Sheets؟** → منطق المزامنة (Core) + Growth (إن مسّ الاشتراك/التحليلات) → Operations.
- **غيّرت منطق dون اتصال؟** → ارفع كاش `sw.js` (Frontend، دليل §7) → Operations (نشر Pages).
- **ميزة تسعيرة/اشتراك؟** → Growth → Core(دالة) → Frontend(زر) → Operations(نشر GAS+Worker) → Marketing(ترويج).
- **ثغرة أمنية في أي مكان؟** → Core فوراً (السياسة/denylist) → Operations (تراجع/نشر طارئ بنفس Deployment ID).
- **أي تغيير كود مهما صغر** → ينتهي عند Operations: نشر + `?action=health`.

---

## 4) شجرة القرار (لأي طلب — أول تطابق يفوز)

```
1) تطبيق الجوال / Kotlin / Play Store / keystore؟ ───────────► Android
2) محتوى بصري / سوشل / Canva / هوية، بلا كود؟ ──────────────► Marketing
3) نشر / Worker / CI / health / تراجع، بلا تغيير كود؟ ───────► Operations
4) SEO / اشتراك / تسعيرة / تحليلات؟ ────────────────────────► Growth  (قد يسلّم Core/Frontend)
5) يغيّر منطقاً خادمياً / بيانات / أمان؟ ───────────────────► Core
6) يغيّر ما يراه المستخدم (HTML/CSS/PWA/RTL)؟ ──────────────► Frontend
7) يلمس عدّة نطاقات؟ ───────────────────────────────────────► Cowork يقسّمه ويرتّبه حسب §3
```

> **Cowork (claude.ai) = المايسترو:** يوجّه، يحضّر الخطة، يدقّق المخاطر. **Claude Code** ينفّذ في
> الجلسة المناسبة. **المالك** يوافق وينشر. لا تفتح Cowork وClaude Code على نفس الملف معاً.

---

## 5) خريطة الذاكرة لكل جلسة (منع تكرار السياق)

كل جلسة تفتح **ملف ذاكرتها فقط** — لا تقرأ تفاصيل نطاق ليس لك:

| الجلسة | ملف(ات) الذاكرة |
|---|---|
| Core System | `schoolapp-deployment` · `schoolapp-schedule` |
| Frontend & UI | `schoolapp-deployment` (قسم الواجهة) · `schoolapp-status` |
| Operations | `schoolapp-status` · `schoolapp-github-network` |
| Growth & Search | `schoolapp-analytics` · `schoolapp-audit-baseline` |
| Marketing | الهوية: كحلي `#0F2C5C` · ذهبي `#D4A537` · خط Cairo/Tajawal · RTL · CTA «لأن نجاح ابنك يبدأ بمتابعتك» (تفاصيل القوالب في `docs/سجلات-Claude-Code-والجلسات.html §④` إن وُجد) |
| Android | `schoolapp-android` |

**القواعد الحاكمة (ES5، ثبات Deployment ID، فرع لكل تغيير، مشروع واحد كل مرة)** مشتركة بين الجميع —
مكانها `CLAUDE.md §🔒` فقط، لا تتكرر هنا ولا في أي جلسة.
