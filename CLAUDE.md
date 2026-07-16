# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# school-app-yemen-web — منصة مدارس الإبداع والتميز الدولية

> هذا الـrepo (**عام**) يحتوي: `frontend/` + `worker/` + `media/`
> كود GAS المصدري والأدوات موجودة في `C:\Users\osama\SchoolApp-gas` (مستودع **خاص**).
> آخر تحديث: 2026-07-09

---

## Scope & Authorization

STRICT SCOPE RULE: only implement exactly what is authorized. Do not add extra phases or features without explicit approval — ask before expanding scope.

---

## Workflow Modes

PLANNING-ONLY mode: When asked to plan, produce execution prompts and doc/memory updates ONLY. Do NOT write or edit production code until explicitly authorized. This complements the scope rule above — planning sessions output a plan/prompt, not a diff.

---

## ما يُعدَّل هنا وما لا يُعدَّل

| الملف/المجلد | الحكم | السبب |
|---|---|---|
| `worker/school-app-proxy.js` | ✅ عدِّل هنا | الـWorker خاص بهذا الـrepo |
| `wrangler.jsonc` | ✅ عدِّل هنا | إعداد Cloudflare Worker |
| `media/covers/` | ✅ يُكتَب هنا (غير كود) | أغلفة الأخبار النصية المُستضافة علناً (يكتب رابطها CMS عبر `_build/social/` من مستودع gas) |
| `frontend/` | ❌ لا تعدِّل | يُبنى تلقائياً من gas repo عبر CI |

**أي تعديل في GAS (teacher/student/home/home-all-school/cms/schedule/master-admin) → اذهب إلى `C:\Users\osama\SchoolApp-gas`.**

---

## المعمارية (ثلاث طبقات)

**طبقة البيانات:** Google Sheets لكل مدرسة + سجل مركزي `Master_Admin_School`
- ID: `10Zk0vwjrHagydYlU0kyjB6X9uoyVCN6sl5nSet1_c7w`
- أعمدة مفتاحية: school_id(0)، teacher_file_id(4)، student_file_id(5)، cms_file_id(6)، schedule_file_id(7)، subscription_end(9)، is_active(10).

**طبقة الخلفية:** 7 مشاريع GAS كاملة (ES5 صارم: `var`، دوال عادية، بلا قوالب نصية) + نقطة توجيه ثامنة
- `home · home-all-school · teacher · student · cms · schedule · master-admin`
- + `pricing` — مشروع GAS مستقلّ ثامن يُخدَّم عبر مسار `/pricing` في الـWorker (صفحة تسعيرة فقط، لا `doPost`/API كامل مثل السبعة الرئيسية).
- كل مشروع: `doGet` (HTML) + `doPost` عبر `ApiEndpoint.js` (JSON API).
- النشر: Execute as **Me** · Access **Anyone** — **لا تغيير Deployment IDs أبداً**.

**طبقة العرض (هذا الـrepo):**
- `frontend/` — واجهة ثابتة على GitHub Pages، تستخدم `gas-bridge.js` لإعادة تعريف `google.script.run` كـ XHR POST على مسار نسبي `/gas/<app>`.
- `worker/school-app-proxy.js` — Cloudflare Worker يخدم الموقع ويمرّر الـAPI (يحلّ مشكلة حجب github.io في اليمن).
- **PWA:** `sw.js` + IndexedDB (`offline-db.js`) + طابور outbox (`offline-sync.js`).

---

## Cloudflare Worker — مسارات رئيسية

الملف: `worker/school-app-proxy.js` · النشر: `school.procorners.com` (نطاق مخصّص أساسي منذ
2026-07-16، يتفادى حجب يمن نت لـ`workers.dev` — راجع
`school-app-yemen-gas/_docs/2026-07-16-حجب-يمن-نت-workers-dev-ونطاق-مخصص.md`)؛ النطاق القديم
`school-teacher-proxy.procorners-shop.workers.dev` لا يزال حيّاً بالتوازي (تطبيق أندرويد يعتمده).

| المسار | الوظيفة |
|---|---|
| `/gas/<app>` | يمرّر POST/GET إلى GAS `/exec` المقابل (home/home-all-school/teacher/student/cms/schedule/master-admin) |
| `/qr-img?url=...` | Proxy لصور QR من `api.qrserver.com` (fallback عند الحجب) |
| `/qr-download?url=&name=` | تحميل QR كـ attachment |
| `/oauth` | إعادة توجيه OAuth من فيسبوك/إنستغرام → GAS CMS |
| `/pricing` | عرض HTML صفحة التسعيرة من GAS منفصل |
| `/media/drive/<fileId>` | بثّ فيديو Google Drive كـ `video/mp4` مع دعم Range requests (بثّ مباشر بلا تخزين، يتجاوز فحص الفيروسات لملفات Drive الكبيرة) |
| `/drive-upload` | وسيط رفع resumable إلى جلسة Drive (PUT مباشر)، مع تحقّق SSRF مقيَّد بنطاق `*.googleapis.com` فقط |
| `/*` | يخدم الصفحات من GitHub Pages (`procorners-labs.github.io/school-app-yemen-web`) — يحقن أيضاً وسوم OG لكل خبر عبر `?news=<id>` |

عند إضافة مسار جديد: أضفه قبل قسم «خدمة الموقع الثابت» (ابحث عن العنوان — لا تعتمد رقم سطر ثابت، الملف ينمو).

**إعادة المحاولة عند استجابة GAS متقطّعة:** GAS يُرجع أحياناً 404/HTML اعتراضي بدل تنفيذ الدالة
(~6% من الطلبات). `/gas/<app>` يعيد المحاولة تلقائياً حتى 4 مرّات بفواصل تصاعدية `[250,600,1200]ms`
(طلبات POST فقط؛ GET يقبل HTML طبيعياً)، ويرجع JSON خطأ صالح (503) لا HTML خام عند استنفاد المحاولات
— يهبط معدّل الفشل الظاهر للمستخدم من ~6% إلى ~0.02%.

**Deployment IDs الثابتة في الـWorker (لا تغيّرها):**
```
teacher:  AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND
```
(بقية الـIDs في `var GAS` أعلى الملف)

---

## CI وسير العمل

**gas repo → web repo (تلقائي):**
```
push to school-app-yemen-gas/main
  → CI: build-frontend.js → test-offline.js (24 test) → gen-endpoints.js --check
  → rsync frontend/ → school-app-yemen-web/main
  → GitHub Pages يُحدَّث + Worker يُنشر تلقائياً (Cloudflare Workers Builds)
```

**هذا الـrepo (`school-app-yemen-web`) CI يتحقق فقط من:**
- `node --check worker/school-app-proxy.js` — صحة syntax الـWorker
- وجود مجلد `frontend/`

**للتحقق من صحة الـWorker بعد تعديله:**
```bash
node --check worker/school-app-proxy.js
```

---

## Deployment Workflow

After implementing a Worker change: run `node --check worker/school-app-proxy.js`, open a PR, merge, then live-verify via the Worker health endpoint (Cloudflare Workers Builds auto-deploys on push to `main`) before reporting done. Any GAS-side change must be deployed separately via clasp from `SchoolApp-gas` — merging here never deploys backend logic.

Verification checklist:
- After a live check that doesn't show the expected result, rule out Cloudflare edge cache / browser cache before assuming the deploy failed — fetch fresh (cache-busting query param or hard refresh) before concluding.
- Confirm which side actually needs redeploying: a Worker-only change needs this repo's `main` to build; a GAS backend change needs `SchoolApp-gas` clasp deploy — merging a PR here never triggers that.

---

## Environment & Constraints

Environment notes: this repo is a Cloudflare Worker + generated static frontend (no GAS/ES5 code lives here — see Scope table above). Prefer terminal-only workflows (`wrangler`, `gh`, `node --check`); avoid browser automation unless explicitly requested.

---

## Codebase Conventions

Before editing, confirm you're editing `worker/school-app-proxy.js` (the real source) and not `frontend/` (generated output — overwritten by the next CI run from `SchoolApp-gas`).

---

## قواعد إلزامية

1. **فرع لكل تغيير** — لا دفع مباشر إلى `main`.
2. **لا تعديل `frontend/` يدوياً** — هي ناتج مُولَّد، أي تعديل يُحذف بأول CI تلقائي.
3. **ثبات Deployment IDs** — أي تغيير يكسر `gas-bridge.js` + تطبيق الأندرويد.
4. **Worker syntax فقط من هنا** — منطق الجلسات/البيانات/الأمان في `C:\Users\osama\SchoolApp-gas`.

---

## مستودعات المشروع

| المستودع | النطاق | المسار المحلي |
|---|---|---|
| `procorners-labs/school-app-yemen-web` (هذا) | `frontend/` + `worker/` | `C:\Users\osama\SchoolApp` |
| `procorners-labs/school-app-yemen-gas` (خاص) | GAS source + `_build/` + `assets/` | `C:\Users\osama\SchoolApp-gas` |
| `com.proconrers.schoolappyemen` | Android WebView | مستودع منفصل |

---

## نقاط الفحص الحية

- **Worker health (النطاق القانوني):** `https://school.procorners.com/gas/teacher?action=health`
- **Worker health (workers.dev، لا يزال حيّاً):** `https://school-teacher-proxy.procorners-shop.workers.dev/gas/teacher?action=health`
- **GitHub Pages:** `https://procorners-labs.github.io/school-app-yemen-web/`
- **CI gas repo:** `https://github.com/procorners-labs/school-app-yemen-gas/actions`
