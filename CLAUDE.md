# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# school-app-yemen-web — منصة مدارس الإبداع والتميز الدولية

> هذا الـrepo (**عام**) يحتوي فقط: `frontend/` + `worker/`
> كود GAS المصدري والأدوات موجودة في `C:\Users\osama\SchoolApp-gas` (مستودع **خاص**).
> آخر تحديث: 2026-06-19

---

## Scope & Authorization

STRICT SCOPE RULE: only implement exactly what is authorized. Do not add extra phases or features without explicit approval — ask before expanding scope.

---

## ما يُعدَّل هنا وما لا يُعدَّل

| الملف/المجلد | الحكم | السبب |
|---|---|---|
| `worker/school-app-proxy.js` | ✅ عدِّل هنا | الـWorker خاص بهذا الـrepo |
| `wrangler.jsonc` | ✅ عدِّل هنا | إعداد Cloudflare Worker |
| `frontend/` | ❌ لا تعدِّل | يُبنى تلقائياً من gas repo عبر CI |

**أي تعديل في GAS (teacher/student/home/cms/schedule/master-admin) → اذهب إلى `C:\Users\osama\SchoolApp-gas`.**

---

## المعمارية (ثلاث طبقات)

**طبقة البيانات:** Google Sheets لكل مدرسة + سجل مركزي `Master_Admin_School`
- ID: `10Zk0vwjrHagydYlU0kyjB6X9uoyVCN6sl5nSet1_c7w`
- أعمدة مفتاحية: school_id(0)، teacher_file_id(4)، student_file_id(5)، cms_file_id(6)، schedule_file_id(7)، subscription_end(9)، is_active(10).

**طبقة الخلفية:** 6 مشاريع GAS (ES5 صارم: `var`، دوال عادية، بلا قوالب نصية)
- `home · teacher · student · cms · schedule · master-admin`
- كل مشروع: `doGet` (HTML) + `doPost` عبر `ApiEndpoint.js` (JSON API).
- النشر: Execute as **Me** · Access **Anyone** — **لا تغيير Deployment IDs أبداً**.

**طبقة العرض (هذا الـrepo):**
- `frontend/` — واجهة ثابتة على GitHub Pages، تستخدم `gas-bridge.js` لإعادة تعريف `google.script.run` كـ XHR POST على مسار نسبي `/gas/<app>`.
- `worker/school-app-proxy.js` — Cloudflare Worker يخدم الموقع ويمرّر الـAPI (يحلّ مشكلة حجب github.io في اليمن).
- **PWA:** `sw.js` + IndexedDB (`offline-db.js`) + طابور outbox (`offline-sync.js`).

---

## Cloudflare Worker — مسارات رئيسية

الملف: `worker/school-app-proxy.js` · النشر: `school-teacher-proxy.procorners-shop.workers.dev`

| المسار | الوظيفة |
|---|---|
| `/gas/<app>` | يمرّر POST/GET إلى GAS `/exec` المقابل (home/teacher/student/cms/schedule/master-admin) |
| `/qr-img?url=...` | Proxy لصور QR من `api.qrserver.com` (fallback عند الحجب) |
| `/qr-download?url=&name=` | تحميل QR كـ attachment |
| `/oauth` | إعادة توجيه OAuth من فيسبوك/إنستغرام → GAS CMS |
| `/pricing` | عرض HTML صفحة التسعيرة من GAS منفصل |
| `/*` | يخدم الصفحات من GitHub Pages (`procorners-labs.github.io/school-app-yemen-web`) |

عند إضافة مسار جديد: أضفه قبل قسم «خدمة الموقع الثابت» (السطر 164+).

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
  → CI: build-frontend.js → test-offline.js (15 test) → gen-endpoints.js --check
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

- **Worker health:** `https://school-teacher-proxy.procorners-shop.workers.dev/gas/teacher?action=health`
- **GitHub Pages:** `https://procorners-labs.github.io/school-app-yemen-web/`
- **CI gas repo:** `https://github.com/procorners-labs/school-app-yemen-gas/actions`
