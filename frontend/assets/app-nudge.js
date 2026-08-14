/* app-nudge.js — دعوةٌ واحدة غير حاجبة: «حمِّل التطبيق» لزائر متصفّح أندرويد على صفحة عامّة.
 *
 * ═══ لماذا **دعوة التحميل وحدها**، ولا أثر لدعوة التحديث هنا (قرار مقيس 2026-08-14) ═══
 *
 * النسخة الأصلية (‏PR#759، 2026-07-30) كانت بحالتين: تحديثٌ لمن في التطبيق بإصدار أقدم،
 * وتحميلٌ لمن في المتصفّح. وشقُّ التحديث **ميّتٌ عند الوصول** لا مؤجَّلاً:
 *
 *   • كان يميّز الإصدار من وسم `SchoolAppBuild/<versionCode>` في الـUA — و`git grep` على
 *     `main` يُرجِع **صفر** ورود له. الـUA المنشور لا يزال `SchoolAppYemen/1.0` حرفياً.
 *   • وثابتُه `LATEST_BUILD = 0` كان يُعطّل الشقّ بشرطه الخاص (`if (!LATEST_BUILD) return;`).
 *
 * ⇒ شحنُه كان سيعني **مئتَي سطر لا تنفَّذ قطّ**، تبدو ميزةً قائمة لأي قارئ لاحق — وهي فئة
 * «دالّة مُعرَّفة بلا مستدعٍ» نفسها. فنُزع بالكامل بدل إبقائه ساكناً.
 *
 * 🔴 **والقناة الحيّة الفعلية للتحديث موجودة أصلاً ولا تحتاج هذا الملفّ إطلاقاً:**
 * `UpdateChecker.kt` في تطبيق أندرويد ينادي `checkAppVersion` (‏`teacher/AppVersionCheck.js`)
 * — **318 نداءً يومياً من مستخدمي vc31 فعلاً**. وينقصها **قيمة خاصيّة واحدة** في Script
 * Properties (`ANDROID_LATEST_VERSION_CODE_<packageName>`) لا كودٌ جديد. أي إحياء لدعوة
 * تحديث ويبية يجب أن يُقاس مقابل تلك القناة أوّلاً، لا أن يُضاف بجانبها.
 *
 * ═══ قرارات مقصودة (لا تُنقَض بلا سبب أقوى) ═══════════════════════════════════════════
 *   • **بلا أي نداء شبكة إطلاقاً.** الاعتماد على نقطة GAS كان سيُطلق نداءً لكل زائر ⇒ ضغطٌ
 *     مباشر على حصّة «٣٠ تنفيذاً متزامناً للحساب» (بنود 55/60/62). لا يُقايَض تسجيل دخول
 *     معلّم مقابل بانر — و`teacher` عند 40.5٪ إخفاق أصلاً.
 *   • **غير حاجبة**، وقابلة للتأجيل ٣٠ يوماً — الإزعاج المتكرّر يُدرِّب المستخدم على تجاهل
 *     كل تنبيه لاحق، بما فيه المهمّ.
 *   • **الصفحات الإدارية مستثناة** (‏`cms`/`master-admin`/`schedule`/`pricing`): التطبيق لا
 *     يخدمها، فالدعوة هناك تضليل. والاستثناء **مفروضٌ عند الحقن** في `_build/build-frontend.js`
 *     (الملفّ لا يُحمَّل أصلاً على تلك الأسطح) **وعند القرار** هنا — طبقتان لا واحدة.
 *   • **لا تظهر لمن هو داخل التطبيق** (‏`SchoolAppYemen` في الـUA): دعوةُ تحميلِ ما هو
 *     مثبَّت بالفعل عبثٌ يُفقِد الثقة.
 *   • **ولا على سطح المكتب ولا iOS**: لا تطبيق iOS منشوراً، والدعوة لما لا يُمكن تحميله
 *     كذبةٌ صغيرة تُكلِّف ثقة.
 *
 * ES5 صارم (‏`var`/دوال عادية/بلا قوالب نصية) — نفس قيد بقية `assets/` المخدومة داخل
 * WebView قديم. وصفر مورد خارجي: الأنماط مُدرَجة نصّاً هنا.
 */
(function () {
  'use strict';

  var APP_ID = 'com.proconrers.schoolappyemen';
  var PLAY_URL = 'https://play.google.com/store/apps/details?id=' + APP_ID;

  var SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; /* ٣٠ يوماً */
  var KEY_SNOOZE = 'schoolz_nudge_install_until';
  var SHOW_DELAY_MS = 2600; /* بعد بوّابة تحميل الطالب (1100ms) وبعد أوّل رسم فعلي */

  /* الصفحات العامّة التي يخدمها التطبيق فعلاً.
   * `/portal` مُدرَج لأنه **إعادة كتابة داخلية** في الوسيط إلى `/student/index.html`
   * (‏web#123): شريط المتصفّح يبقى `/portal` فلا يُطابِق `/student/` إطلاقاً.
   * والجذر `/` يخدم `home/Schools.html` منذ 2026-08-07 — يغطّيه فحص الجذر أدناه.
   * وصفحةُ مدرسةٍ على `/<slug>` تُخدَم من `home` أيضاً ⇒ تُغطّى بنفس الفحص. */
  var PUBLIC_PATHS = ['/home/', '/home-all-school/', '/teacher/', '/student/', '/portal'];

  var ua = '';
  try { ua = navigator.userAgent || ''; } catch (e) { ua = ''; }

  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* خاصّ/ممتلئ */ }
  }
  function snoozed() {
    var until = parseInt(lsGet(KEY_SNOOZE) || '0', 10);
    return !!until && Date.now() < until;
  }
  function snooze() {
    lsSet(KEY_SNOOZE, String(Date.now() + SNOOZE_MS));
  }

  /** داخل تطبيقنا؟ العلامة `SchoolAppYemen` ثابتة في كل الإصدارات المنشورة. */
  function inApp() {
    return ua.indexOf('SchoolAppYemen') !== -1;
  }

  function isAndroidBrowser() {
    return ua.indexOf('Android') !== -1 && !inApp();
  }

  function isStandalonePwa() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) { /* تجاهل */ }
    return !!(window.navigator && window.navigator.standalone === true);
  }

  function onPublicPage() {
    var path = '';
    try { path = (window.location.pathname || '').toLowerCase(); } catch (e) { return false; }
    for (var i = 0; i < PUBLIC_PATHS.length; i++) {
      if (path.indexOf(PUBLIC_PATHS[i]) === 0) return true;
    }
    /* الجذر وصفحة المدرسة على `/<slug>` — كلاهما يُخدَم من `home` */
    return path === '/' || path === '' || /^\/[a-z0-9-]+\/?$/.test(path);
  }

  /* ═══ الأنماط (مرّة واحدة، بلا أي مورد خارجي) ═════════════════════════════ */
  function injectStyle() {
    if (document.getElementById('__nudgeStyle')) return;
    var css = [
      '#__nudge{position:fixed;z-index:2147482000;inset-inline:0;bottom:0;',
      '  padding:0 12px calc(12px + env(safe-area-inset-bottom,0px));',
      '  font-family:Cairo,"Segoe UI",Tahoma,system-ui,sans-serif;direction:rtl;',
      '  pointer-events:none}',
      '#__nudge .nx-card{pointer-events:auto;max-width:520px;margin:0 auto;display:flex;',
      '  align-items:center;gap:10px;padding:12px 14px;border-radius:16px;',
      '  background:linear-gradient(135deg,#0f3b5c,#081625);color:#fff;',
      '  box-shadow:0 10px 30px rgba(3,10,22,.42);',
      '  transform:translateY(140%);opacity:0;transition:transform .38s ease,opacity .38s ease}',
      '#__nudge .nx-card.nx-in{transform:translateY(0);opacity:1}',
      '#__nudge .nx-ic{font-size:22px;line-height:1;flex:0 0 auto}',
      '#__nudge .nx-tx{flex:1 1 auto;min-width:0;font-size:13px;line-height:1.65}',
      '#__nudge .nx-tx b{display:block;font-size:14px;margin-bottom:2px}',
      '#__nudge .nx-go{flex:0 0 auto;background:#fff;color:#0f3b5c;border:0;border-radius:20px;',
      '  padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}',
      '#__nudge .nx-go:active{transform:scale(.97)}',
      '#__nudge .nx-no{flex:0 0 auto;background:transparent;border:0;color:#cbd5e1;',
      '  font-size:16px;line-height:1;padding:8px;cursor:pointer;font-family:inherit}',
      '@media (prefers-color-scheme: light){',
      '  #__nudge .nx-card{background:linear-gradient(135deg,#12496e,#0f3b5c)}}',
      '@media (max-width:360px){#__nudge .nx-tx{font-size:12px}#__nudge .nx-go{padding:8px 12px}}',
      '@media (prefers-reduced-motion: reduce){',
      '  #__nudge .nx-card{transition:none;transform:none;opacity:1}}'
    ].join('');
    var st = document.createElement('style');
    st.id = '__nudgeStyle';
    st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }

  /* بناء العقدة بـ`createTextNode` لا `innerHTML` — لا نصّ هنا من مصدر خارجي اليوم،
     لكن البناء الآمن يبقى الافتراض كي لا يتحوّل إلى ثغرة عند أوّل تخصيص لاحق. */
  function render() {
    if (document.getElementById('__nudge')) return;
    injectStyle();

    var wrap = document.createElement('div');
    wrap.id = '__nudge';
    wrap.setAttribute('role', 'status');

    var card = document.createElement('div');
    card.className = 'nx-card';

    var ic = document.createElement('div');
    ic.className = 'nx-ic';
    ic.setAttribute('aria-hidden', 'true');
    ic.appendChild(document.createTextNode('📲'));

    var tx = document.createElement('div');
    tx.className = 'nx-tx';
    var b = document.createElement('b');
    b.appendChild(document.createTextNode('التطبيق أسرع وينبّهك فوراً'));
    tx.appendChild(b);
    tx.appendChild(document.createTextNode(
      'إشعارات بصوت للأخبار والدرجات — نفس حسابك بلا أي خطوة إضافية.'));

    var go = document.createElement('button');
    go.className = 'nx-go';
    go.type = 'button';
    go.appendChild(document.createTextNode('تحميل التطبيق'));

    var no = document.createElement('button');
    no.className = 'nx-no';
    no.type = 'button';
    no.setAttribute('aria-label', 'إغلاق الإشعار');
    no.appendChild(document.createTextNode('✕'));

    function close() {
      card.className = 'nx-card';
      window.setTimeout(function () {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }, 400);
    }

    go.onclick = function () {
      try { window.open(PLAY_URL, '_blank'); }
      catch (e) { window.location.href = PLAY_URL; }
      close();
    };
    no.onclick = function () { snooze(); close(); };

    card.appendChild(ic);
    card.appendChild(tx);
    card.appendChild(go);
    card.appendChild(no);
    wrap.appendChild(card);
    document.body.appendChild(wrap);

    window.setTimeout(function () { card.className = 'nx-card nx-in'; }, 30);
  }

  function decide() {
    if (!document.body) return;
    if (!isAndroidBrowser()) return;   /* داخل التطبيق · سطح مكتب · iOS ⇒ لا شيء */
    if (isStandalonePwa()) return;
    if (!onPublicPage()) return;
    if (snoozed()) return;
    render();
  }

  function boot() {
    window.setTimeout(function () {
      try { decide(); } catch (e) { /* لا يُسقِط الصفحة أبداً */ }
    }, SHOW_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
