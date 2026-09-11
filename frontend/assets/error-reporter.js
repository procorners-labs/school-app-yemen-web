/* ═══════════════════════════════════════════════════════════════════════════
 *  error-reporter.js — التقاطُ أخطاء المستخدمين وإرسالُها إلى لوحة المطوّر
 *  ES5 صارم. يُشحن إلى `frontend/assets/` عبر `_build/build-frontend.js`.
 * ───────────────────────────────────────────────────────────────────────────
 *  🔴 **لا يعتمد على `assets/gas-bridge.js` إطلاقاً — وهذا شرطُ عملٍ لا تفضيل.**
 *  المُبلِّغُ الذي ينادي `google.script.run` يفشل بعلّةِ ما يُبلِّغ عنه بالضبط: أشيعُ خطإٍ
 *  في هذه المنصّة هو `google is not defined` (سباقُ `defer` — بند 225)، وفي تلك اللحظةِ
 *  `window.google` **غيرُ معرَّف** ⇒ صفرُ بلاغٍ يصل الخادم عن أكثر الأخطاء وقوعاً.
 *  وقعت الفئةُ فعلاً في `cms/Dashboard.html` وبقيت غيرَ مرئيّةٍ حتى بلاغٍ شفهيّ.
 *  ⇒ الإرسالُ بـ`XMLHttpRequest` خامّاً مباشرةً إلى `/gas/<app>`.
 *
 *  🔴 **ويُسجَّل نفسُه في أعلى الملفّ قبل أيّ شيءٍ آخر** — معالجٌ يُسجَّل بعد كتلةِ إقلاعٍ
 *  لا يلتقط خطأَ تلك الكتلة، وهي أوّلُ ما يفشل.
 *
 *  🔒 **وما لا يُرسَل أبداً:** الرابطُ الكامل · حمولةُ أيّ نداء · أيُّ توكن · أيُّ قيمةِ
 *  حقلٍ من الصفحة. الصفحةُ **اسمُ قسمٍ مشتقٌّ من المسار**، لا `location.href`.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__errReporterInstalled) return;
  window.__errReporterInstalled = true;

  var MAX_PER_PAGE = 8;      // سقفٌ لكلّ تحميلِ صفحة — عاصفةٌ لا تُغرق القناة
  var sent = 0;
  var seen = {};             // طيُّ المكرّر عميلياً قبل أن يصل الخادم

  function qp(name) {
    try {
      var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search);
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    } catch (e) { return ''; }
  }

  /* التطبيقُ والصفحةُ من **المسار** لا من الرابط الكامل — والمسارُ عندنا
     `/<app>/<page>.html` أو `/<app>/<section>/<slug>`. */
  function appName() {
    try {
      if (window.__ERR_APP) return String(window.__ERR_APP);
      var parts = window.location.pathname.split('/').filter(Boolean);
      return parts.length ? parts[0] : 'root';
    } catch (e) { return 'unknown'; }
  }
  function pageName() {
    try {
      var parts = window.location.pathname.split('/').filter(Boolean);
      return parts.length > 1 ? parts.slice(1).join('/') : 'index';
    } catch (e) { return ''; }
  }
  function schoolId() {
    try { return qp('school') || qp('schoolId') || (window.SCHOOL_ID || ''); }
    catch (e) { return ''; }
  }

  /* نقطةُ الإرسال: `/gas/<app>` القائمةُ نفسُها التي يستعملها الجسر — **صفرُ مسارٍ جديد
     في الوركر**. والوركرُ يوجّه أيَّ `app` إلى نشرته، ونقطةُ `logAppErrorPublic` تعيش في
     `master-admin` ⇒ يُرسَل إليها صراحةً لا إلى نشرة التطبيق الذي وقع فيه الخطأ. */
  function endpoint() {
    try {
      if (window.__ERR_ENDPOINT) return String(window.__ERR_ENDPOINT);
      return window.location.origin + '/gas/master-admin';
    } catch (e) { return '/gas/master-admin'; }
  }

  function firstLines(stack, n) {
    if (!stack) return '';
    try { return String(stack).split('\n').slice(0, n).join('\n'); }
    catch (e) { return ''; }
  }

  function report(type, message, stack, fn) {
    try {
      if (sent >= MAX_PER_PAGE) return;
      var msg = String(message || '').substring(0, 500);
      if (!msg) return;
      var key = type + '|' + (fn || '') + '|' + msg;
      if (seen[key]) return;
      seen[key] = 1;
      sent++;

      var body = {
        fn: 'logAppErrorPublic',
        args: [{
          school : schoolId(),
          app    : appName(),
          page   : pageName(),
          fn     : fn || '',
          type   : type,
          message: msg,
          stack  : firstLines(stack, 5).substring(0, 1200),
          ua     : String(navigator.userAgent || '').substring(0, 200)
        }],
        schoolId: null
      };

      var xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint(), true);
      /* `text/plain` لتفادي preflight — نفسُ عقد `gas-bridge.js` حرفياً. */
      xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      xhr.timeout = 10000;
      /* 🔴 صفرُ معالجٍ يرمي: خطأٌ داخل مُبلِّغ الأخطاء يُنتج حلقةً. */
      xhr.onerror = function () {};
      xhr.ontimeout = function () {};
      xhr.onload = function () {};
      xhr.send(JSON.stringify(body));
    } catch (e) { /* يُبتلَع عمداً — انظر أعلاه */ }
  }

  /* 🔴 **تصريفُ طابور المِلقَط المبكّر — بغيره تسقط الفئةُ التي بُنيت القناةُ لأجلها.**
     هذا الملفُّ يُحقَن بـ`defer` فلا يُنفَّذ إلّا **بعد** انتهاء التحليل، بينما `ReferenceError`
     الناتجُ عن سباق الجسر يقع **أثناءه** ⇒ معالجٌ يُسجَّل هنا **لا يلتقطه أبداً** (المعالجاتُ
     لا تعمل بأثرٍ رجعيّ). ⇒ يحقن البناءُ في `<head>` مِلقَطاً مضمَّناً بلا طلبِ شبكة يدفع في
     `window.__errQ`، وهذا الملفُّ يصرّفه. **الطابورُ هو ما يجعل القناةَ ترى أوّلَ خطإٍ لا آخرَه.** */
  try {
    var q = window.__errQ || [];
    for (var qi = 0; qi < q.length; qi++) {
      report(q[qi][0], q[qi][1], q[qi][2], q[qi][3] || '');
    }
    window.__errQ = null;
  } catch (eQ) {}

  window.addEventListener('error', function (ev) {
    try {
      var where = (ev.filename || '') + ':' + (ev.lineno || 0) + ':' + (ev.colno || 0);
      report('js', (ev.message || 'Unknown error') + ' @ ' + where,
             ev.error ? ev.error.stack : '', '');
    } catch (e) {}
  });

  window.addEventListener('unhandledrejection', function (ev) {
    try {
      var r = ev.reason;
      report('promise', (r && r.message) ? r.message : String(r),
             (r && r.stack) ? r.stack : '', '');
    } catch (e) {}
  });

  /* خطّافٌ عامٌّ يستدعيه الجسرُ أو أيُّ معالجِ فشلٍ في الواجهة — يسمّي **الدالّةَ** التي
     فشلت، وهي أثمنُ حقلٍ في البلاغ: بدونها تتجمّع كلُّ أخطاء الشبكة في صفٍّ واحدٍ مبهم. */
  window.reportAppError = function (type, message, stack, fn) {
    report(String(type || 'app'), message, stack, fn);
  };
})();
