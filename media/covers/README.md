# أغلفة الأخبار المولّدة (social covers)

صور منشورات مولَّدة آلياً من أخبار «منصة المعلمين» **النصية بلا صورة**، بهوية مدرسة الإبداع والتميز
(القالب والمولّد في `school-app-yemen-gas/_build/social/`). تُكتب روابطها في عمود «الملحقات» بورقة
«الاخبار» فتظهر في التطبيق وتفتح «النشر للعامة».

- **التسمية:** `news-<newsId>.png` — بمعرّف الخبر في ورقة «الاخبار» (feed 1080×1350).
- **الرابط العام:** `https://raw.githubusercontent.com/procorners-labs/school-app-yemen-web/main/media/covers/news-<id>.png`
- **آمن من CI:** مزامنة الواجهة تحذف داخل `frontend/` فقط (`rsync --delete frontend/ web-repo/frontend/`)
  — هذا المجلد خارجها ولا يُمسّ.
- التوليد/التحديث: `node _build/social/gen-covers.mjs` ثم `render.js` ثم تصدير headless Chrome
  (التفاصيل في `_build/social/README.md` بمستودع GAS).
