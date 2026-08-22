/*
 * test-routes.js — اختبار توجيه المسارات في `worker/school-app-proxy.js`.
 *
 * 🔴 **لماذا وُجد (2026-08-10):** لم يكن في هذا المستودع أيُّ اختبار توجيه — CI فيه
 * `node --check` وحده، وهو يُثبت أن الملف **يُحلَّل نحوياً** لا أن مساراً يذهب حيث نظنّ.
 * فعاش فخٌّ صامت طويلاً: `/portal` كان يُرجِع **200** ويُخدَم بـ`/home/index.html` لأن
 * `_schoolSlugFromPath` تقرؤه slug مدرسة — أي أن إضافة الرابط كانت **تغيير سلوك لمسار
 * حيّ** لا إضافة مسار جديد، ولا شيء كان ليكشف ذلك قبل النشر.
 *
 * الآلية: يُستخرَج `_RESERVED_TOP_PATHS` و`_schoolSlugFromPath` **من المصدر نفسه** (لا
 * يُعاد كتابتهما هنا، وإلّا اختُبِرت نسخةُ الاختبار لا الوركر)، وتُستخرَج سطور إعادة
 * الكتابة بترتيبها الحقيقي، ثم يُحاكى التسلسل على مسارات حقيقية.
 *
 * أغلب الحالات **ضوابط**: تُثبت أن ما كان يعمل ما زال يعمل حرفياً. تشغيل:
 *     node worker/test-routes.js
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');

var W = path.join(__dirname, 'school-app-proxy.js');
var src = fs.readFileSync(W, 'utf8');

var rIdx = src.indexOf('var _RESERVED_TOP_PATHS = {');
var rEnd = src.indexOf('};', rIdx) + 2;
var fIdx = src.indexOf('function _schoolSlugFromPath(');
var fEnd = src.indexOf('\n}', fIdx) + 2;
if (rIdx < 0 || fIdx < 0) {
  console.error('🔴 ROUTE_SRC_MISSING — تعذّر استخراج منطق الـslug من الوركر');
  process.exit(1);
}

var ctx = vm.createContext({});
vm.runInContext(src.slice(rIdx, rEnd) + '\n' + src.slice(fIdx, fEnd), ctx);

// سطور إعادة الكتابة `if (path === 'x' [|| path === 'y']) path = 'z';` بترتيب ورودها.
// ⚠️ `m[2] !== undefined` لا `m[2] ||` — البديل الثاني لسطر الجذر هو **السلسلة الفارغة**
//    (`path === ''`)، وهي falsy فكان `||` يُسقطها ويُفشِل حالة الجذر الفارغ.
var rewrites = [];
src.split('\n').forEach(function (L) {
  var m = /^\s*if \(path === '([^']+)'(?: \|\| path === '([^']*)')?\) path = '([^']+)';/.exec(L);
  if (m) rewrites.push({ a: m[1], b: (m[2] !== undefined ? m[2] : null), to: m[3] });
});

/* المسارات العميقة للمنصّتين — يُستخرَج **الـregex الحيّ من مصدر الوركر** ويُشغَّل، لا
   يُنسَخ. نسخةٌ في الاختبار تنحرف بصمت عن الحيّ فتُنتج أخضرَ لا يصف الإنتاج (بند 116). */
var dpIdx = src.indexOf('var _DEEP_PORTAL_RE = ');
if (dpIdx < 0) {
  console.error('🔴 DEEP_PORTAL_RE_MISSING — تعذّر استخراج regex المسارات العميقة من الوركر');
  process.exit(1);
}
vm.runInContext(src.slice(dpIdx, src.indexOf('\n', dpIdx)), ctx);

/* أسماء الأصول المستعارة (‏gas#166) — يُستخرَج الحيّ بنفس القاعدة، وغيابُه **أحمر**
   لا تخطٍّ صامت (بند 145): إعادةُ تسميةٍ في الوركر كانت ستُطفئ الحارس بلا أثر. */
var aaIdx = src.indexOf('var _APP_ASSET_ALIAS_RE = ');
if (aaIdx < 0) {
  console.error('🔴 APP_ASSET_ALIAS_RE_MISSING — تعذّر استخراج أسماء الأصول المستعارة من الوركر');
  process.exit(1);
}
vm.runInContext(src.slice(aaIdx, src.indexOf('\n', aaIdx)), ctx);

function resolve(p) {
  for (var i = 0; i < rewrites.length; i++) {
    if (p === rewrites[i].a || (rewrites[i].b !== null && p === rewrites[i].b)) return rewrites[i].to;
  }
  // نفس ترتيب الوركر: بعد إعادات الكتابة الحرفية، وقبل قراءة الـslug.
  ctx.__p = p;
  // نفس ترتيب الوركر حرفياً: اسم الأصل المستعار **قبل** المسار العميق.
  var alias = vm.runInContext('_APP_ASSET_ALIAS_RE.exec(__p)', ctx);
  if (alias) { p = '/' + alias[1]; ctx.__p = p; }
  var deep = vm.runInContext('_DEEP_PORTAL_RE.exec(__p)', ctx);
  if (deep) return '/' + String(deep[1]).toLowerCase() + '/index.html';
  if (vm.runInContext('_schoolSlugFromPath(__p)', ctx)) return '/home/index.html';
  return p;   // يُخدَم كما هو من GITHUB_BASE
}

var CASES = [
  ['/portal',             '/student/index.html', 'الرابط الجديد لمنصّة الطالب'],
  ['/portal/',            '/student/index.html', 'وبشرطة مائلة'],
  // ── ضوابط: كل مسار قائم يجب أن يبقى حرفياً كما هو ──
  ['/student/index.html', '/student/index.html', 'ضابط: الرابط القديم (أندرويد يعتمده)'],
  ['/student',            '/student',            'ضابط: محجوز — لا يُقرَأ slug'],
  ['/teacher/index.html', '/teacher/index.html', 'ضابط: منصّة المعلم'],
  ['/',                   '/home/schools.html',  'ضابط: الجذر'],
  ['',                    '/home/schools.html',  'ضابط: الجذر الفارغ'],
  ['/ibn-khaldoun',       '/home/index.html',    'ضابط: slug مدرسة حقيقي'],
  ['/abdaawatmuaz',       '/home/index.html',    'ضابط: slug مدرسة حقيقي'],
  ['/aljil-al-hadith',    '/home/index.html',    'ضابط: slug مدرسة حقيقي'],
  ['/pricing',            '/pricing',            'ضابط: محجوز'],
  ['/assets/sw.js',       '/assets/sw.js',       'ضابط: أصل ثابت'],
  ['/sitemap.xml',        '/sitemap.xml',        'ضابط: محجوز'],
  // ‏`app`/`download` محجوزان ⇒ لا يُقرآن slug مدرسة. (سلوكهما الفعلي 302 يُقاس
  //  سلوكياً أدناه — هذا الجدول يصف إعادة الكتابة وحدها ولا يرى العودة المبكرة.)
  ['/app',                '/app',                'ضابط: محجوز — لا يُقرَأ slug'],
  ['/download',           '/download',           'ضابط: محجوز — لا يُقرَأ slug'],

  // ── المسارات العميقة للمنصّتين (2026-08-13) ────────────────────────────────
  ['/teacher/dashboard/abdaawatmuaz',  '/teacher/index.html', 'معلم: صفحة + slug'],
  ['/teacher/attendance/abdaawatmuaz', '/teacher/index.html', 'معلم: صفحة أخرى + slug'],
  ['/teacher/grades/ibn-khaldoun',     '/teacher/index.html', 'معلم: slug بشرطة'],
  ['/student/news/abdaawatmuaz',       '/student/index.html', 'طالب: صفحة + slug'],
  ['/student/grades/abdaawatmuaz/',    '/student/index.html', 'طالب: بشرطة مائلة ختامية'],
  ['/teacher/dashboard',               '/teacher/index.html', 'معلم: صفحة بلا slug (مدرسة المالك)'],
  ['/TEACHER/Dashboard/AbdaaWatmuaz',  '/teacher/index.html', 'حالة مختلطة ⇒ القسم يُطبَّع'],

  // ── أصلٌ طُلب من عمقٍ خاطئ (‏gas#166، 2026-08-21) ──────────────────────────
  // نسخُ HTML المخبّأة في عامل الخدمة تحمل `../assets/…` النسبيّ، وهو يُحلّ من العمق
  // الذي يراه المتصفّح ⇒ `/teacher/assets/…` = 404 ⇒ `window.google` غير معرَّف.
  ['/teacher/assets/gas-bridge.js',   '/assets/gas-bridge.js',   'أصل: عمق خاطئ ⇒ الموضع الحقيقي'],
  ['/student/assets/gas-bridge.js',   '/assets/gas-bridge.js',   'أصل: نظير الطالب'],
  ['/teacher/assets/offline-sync.js', '/assets/offline-sync.js', 'أصل: ملفّ آخر'],
  ['/student/assets/img/logo.png',    '/assets/img/logo.png',    'أصل: مسار متداخل يُحفَظ كاملاً'],
  ['/teacher/assets/foo',             '/assets/foo',             'أصل بلا امتداد: الاسم المستعار يسبق المسار العميق (لا يُخدَم صفحةً)'],
  // ── ضوابط الاتجاه المعاكس: القاعدة مقصورة على المنصّتين ولا تلمس ما سواها ──
  ['/assets/sw.js',                   '/assets/sw.js',           'ضابط: الأصل الجذري كما هو'],
  ['/cms/assets/x.js',                '/cms/assets/x.js',        'ضابط: cms خارج القاعدة'],
  ['/home/assets/x.js',               '/home/assets/x.js',       'ضابط: home خارج القاعدة'],
  // ⚠️ `assetsx` ليس `assets` — والضابطان يقيسان الحالتين معاً: بامتداد (فيه نقطة ⇒
  //    خارج `_DEEP_PORTAL_RE` أصلاً فيمرّ كما هو) وبلا امتداد (مسارٌ عميق قانوني).
  //    التوقّع الأوّل كُتب هنا خطأً `/teacher/index.html` فحمّر — والمرساة هي التي
  //    صُحِّحت لا الكود (بند 163-③: حارسٌ يحمرّ على سلوكٍ صحيح يُصحَّح لا يُخفَّف).
  ['/teacher/assetsx/y.js',           '/teacher/assetsx/y.js',   'ضابط: `assetsx` بامتداد ⇒ يمرّ كما هو'],
  ['/teacher/assetsx/y',              '/teacher/index.html',     'ضابط: `assetsx` بلا امتداد ⇒ مسار عميق لا أصل'],

  // 🔴 ضوابط معاكسة — أهمّ من الحالة الموجبة
  ['/teacher/a/b/c',      '/teacher/a/b/c',      '🔴 ضابط: ثلاثة مقاطع لا تُطابِق (لا عمق مخترَع)'],
  ['/student/Student_Reports.html', '/student/Student_Reports.html',
                                                 '🔴 ضابط: ملفٌّ بشرطة سفلية ونقطة يُخدَم كما هو'],
  ['/teacher/',           '/teacher/',           '🔴 ضابط: بلا مقطع تالٍ ⇒ لا تُطابِق'],
  ['/gas/teacher',        '/gas/teacher',        '🔴 ضابط: نقطة الـAPI لا تُمَسّ'],
  /* 🔴 هذان الضابطان أُضيفا **بعد** أن كشف اختبارُ الطفرة أن سابقيهما جوفاوان:
     `/teacher/index.html` يُعاد كتابته إلى **نفسه** فلا يميّز بين regex يقبل النقطة
     وآخر يرفضها. فيلزم مسارٌ **يختلف** مخرَجه بين الحالتين.
     ① أصلٌ مستقبليّ تحت القسم (‏`.js`) يجب أن يُخدَم كما هو لا أن يُبتلَع في `index.html`.
     ② اسم صفحة بشرطة سفلية ليس من صيغتنا (‏kebab-case) ⇒ 404 صادق لا تصييرٌ صامت للتطبيق. */
  ['/teacher/app.js',     '/teacher/app.js',     '🔴 ضابط: أصلٌ تحت القسم يُخدَم كما هو (يكشف قبولَ النقطة)'],
  ['/teacher/some_page',  '/teacher/some_page',  '🔴 ضابط: شرطة سفلية ليست صيغةَ صفحة (يكشف توسيع الصنف)']
];

var failed = 0;
CASES.forEach(function (c) {
  var got = resolve(c[0]);
  var good = (got === c[1]);
  if (!good) failed++;
  console.log((good ? '  ✅ ' : '  ❌ ') + c[2] + '  [' + (c[0] || '(فارغ)') + ' → ' + got + ']');
});

// ═══════════════════════════════════════════════════════════════════════════
//  تحويل النطاق — `www` وحده يُحوَّل، والإرثيان لا يُمَسّان أبداً
//  🔴 الضوابط هنا **أهمّ من الحالة الموجبة**: خطأٌ يُحوِّل نطاقاً إرثياً يقذف كل
//  مستخدمي تطبيق الأندرويد إلى Chmoe ويترك التطبيق فارغاً، ولا يُصلَح إلا بـAPK جديد.
// ═══════════════════════════════════════════════════════════════════════════
console.log('');
console.log('تحويل النطاق إلى الرسمي:');

var rcIdx = src.indexOf('var REDIRECT_TO_CANONICAL = {');
var coIdx = src.indexOf("var CANONICAL_ORIGIN = '");
if (rcIdx < 0 || coIdx < 0) {
  console.log('  ❌ ضابط: تعذّر استخراج منطق التحويل من الوركر — الاختبار أجوف');
  failed++;
} else {
  var dctx = vm.createContext({});
  vm.runInContext(src.slice(coIdx, src.indexOf(';', coIdx) + 1) + '\n' +
                  src.slice(rcIdx, src.indexOf('};', rcIdx) + 2), dctx);
  dctx.__redirects = function (host) { return !!dctx.REDIRECT_TO_CANONICAL[host]; };

  [['www.yemenschoolz.com', true,  'www يُحوَّل إلى الجذر'],
   // ── ضوابط الاتجاه المعاكس — كلٌّ منها يحمي مستخدمين حقيقيين ──
   ['yemenschoolz.com', false, 'ضابط: الجذر نفسه لا يُحوَّل (وإلّا حلقة لا نهائية)'],
   ['school.procorners.com', false, 'ضابط 🔴: النطاق الإرثي لا يُحوَّل (أندرويد SchoolzYemen يعتمده)'],
   ['school-teacher-proxy.procorners-shop.workers.dev', false,
    'ضابط 🔴: workers.dev لا يُحوَّل (أندرويد SchoolAppYemen يعتمده)'],
   ['www.school.procorners.com', false, 'ضابط: لا مطابقة جزئية على النطاق الإرثي']
  ].forEach(function (c) {
    var got = dctx.__redirects(c[0]);
    var good = (got === c[1]);
    if (!good) failed++;
    console.log((good ? '  ✅ ' : '  ❌ ') + c[2] + '  [' + c[0] + ' → ' +
                (got ? '301' : 'يُخدَم كما هو') + ']');
  });

  var canon = vm.runInContext('CANONICAL_ORIGIN', dctx);
  var okCanon = (canon === 'https://yemenschoolz.com');
  if (!okCanon) failed++;
  console.log((okCanon ? '  ✅ ' : '  ❌ ') + 'وجهة التحويل هي النطاق الرسمي  [' + canon + ']');

  // 🔒 عدد المضيفين المُحوَّلين **واحد بالضبط**: أي توسيع للقائمة يجب أن يمرّ بقرار
  //    واعٍ لا بإضافة سطر — لأن الخطأ هنا لا يُكتشف إلا من بلاغ مستخدم.
  var nHosts = Object.keys(vm.runInContext('REDIRECT_TO_CANONICAL', dctx)).length;
  var okN = (nHosts === 1);
  if (!okN) failed++;
  console.log((okN ? '  ✅ ' : '  ❌ ') + '🔒 مضيف واحد بالضبط يُحوَّل  [' + nHosts + ']');

  /* 🔴 **رمز التحويل يتبع الطريقة — مقيسٌ حيّاً 2026-08-21:**
     `POST https://www.yemenschoolz.com/gas/teacher` كان يردّ 301، وباتّباعه:
     `{"ok":false,"error":"اسم الدالة مفقود"}` — الجسم **فُقِد**، لأن 301/302 يُجيزان
     للعميل تحويل الطريقة إلى GET. وهذا الفرع **يسبق** وكيل `/gas/*` فيبتلع نداءات
     الـAPI كلَّها من `www` ⇒ تسجيل دخولٍ يفشل صامتاً.
     ⇒ `GET/HEAD` تبقى 301 (الفهرسة والتخبئة)، وما عداها **308** يحفظ الطريقة والجسم.

     ويُقاس **سلوكياً** بتشغيل الفرع المقتطَع من المصدر — لا بفحص وجود الرقم في النصّ
     (`indexOf('308')` يمرّ أخضر على شرطٍ معكوس أو ميّت). */
  /* ⚠️ الاسم مسبوقٌ بـ`_www` عمداً: `rIdx` مستعمَلٌ لاحقاً في هذا الملفّ لـ
     `_RESERVED_TOP_PATHS`، وكلاهما `var` في **نطاق السكربت نفسه** ⇒ التسمية المتطابقة
     تدهسه فيرمي اختبارٌ **آخر** `ReferenceError`. وقع فعلاً أثناء كتابة هذه الكتلة. */
  var _wwwBranchIdx = src.indexOf('if (REDIRECT_TO_CANONICAL[url.hostname]) {');
  if (_wwwBranchIdx < 0) {
    console.log('  ❌ ضابط: تعذّر اقتطاع فرع التحويل ⇒ الاختبار أجوف');
    failed++;
  } else {
    var branch = src.slice(_wwwBranchIdx, src.indexOf('\n    }', _wwwBranchIdx) + 6);
    var mctx = vm.createContext({
      CANONICAL_ORIGIN: 'https://yemenschoolz.com',
      REDIRECT_TO_CANONICAL: { 'www.yemenschoolz.com': 1 },
      Response: { redirect: function (u, s) { return { url: u, status: s }; } }
    });
    vm.runInContext(
      'function __run(method, path, search) {\n' +
      '  var request = { method: method }, url = { hostname: "www.yemenschoolz.com", search: search };\n' +
      '  ' + branch.replace(/\breturn Response\.redirect/, 'return Response.redirect') + '\n' +
      '  return null;\n}', mctx);

    [['GET',    301, '‏GET يبقى 301 — الفهرسة والتخبئة الدائمة لم تتغيّر'],
     ['HEAD',   301, '‏HEAD مثله'],
     ['POST',   308, '🔴 POST ⇒ **308** — 301 كان يُفقِد الجسم فيفشل الدخول صامتاً'],
     ['PUT',    308, '‏PUT مثله'],
     ['DELETE', 308, '‏DELETE مثله']
    ].forEach(function (c) {
      var r = mctx.__run(c[0], '/gas/teacher', '');
      var good = !!r && r.status === c[1];
      if (!good) failed++;
      console.log((good ? '  ✅ ' : '  ❌ ') + c[2] + '  [' + c[0] + ' → ' +
                  (r ? r.status : 'لا تحويل') + ']');
    });

    var rq = mctx.__run('POST', '/gas/teacher', '?a=1');
    var okKeep = !!rq && rq.url === 'https://yemenschoolz.com/gas/teacher?a=1';
    if (!okKeep) failed++;
    console.log((okKeep ? '  ✅ ' : '  ❌ ') +
                '🔒 المسار والاستعلام محفوظان في التحويل  [' + (rq ? rq.url : '—') + ']');
  }
}

// ── الرؤوس الأمنية ومعاينة الخبر ──
console.log('');
console.log('الرؤوس الأمنية وحقن og:url:');
[[/headers\.set\('Strict-Transport-Security',/, 'HSTS مُرسَل من الكود لا من اللوحة'],
 [/headers\.set\('X-Content-Type-Options', 'nosniff'\)/, 'nosniff مُرسَل'],
 [/headers\.set\('Referrer-Policy', 'strict-origin-when-cross-origin'\)/, 'Referrer-Policy مُرسَل'],
 [/\.on\('meta\[property="og:url"\]', new _AttrSet\('content', _ogCanonical\)\)/, 'og:url محقون بالرابط القانوني'],
 [/_pathSlug \? '\/' \+ _pathSlug : path/, '🔴 الرابط القانوني يُبنى من الـslug المطلوب لا من ثابت']
].forEach(function (c) {
  var good = c[0].test(src);
  if (!good) failed++;
  console.log((good ? '  ✅ ' : '  ❌ ') + c[1]);
});
// 🚫 ضابط: CSP وX-Frame-Options تبقى **محذوفتين** — `/pricing` يُخدَم داخل `<iframe>`.
var keepsDeleted = /headers\.delete\('content-security-policy'\)/.test(src) &&
                   /headers\.delete\('x-frame-options'\)/.test(src) &&
                   !/headers\.set\('Content-Security-Policy'/i.test(src);
if (!keepsDeleted) failed++;
console.log((keepsDeleted ? '  ✅ ' : '  ❌ ') +
            '🚫 ضابط: CSP وX-Frame-Options تبقيان محذوفتين (‏/pricing داخل iframe)');

// ── 🔴 HSTS مشروط بالمضيف — حارس **سلوكي** لا نصّي ────────────────────────
// لماذا سلوكي: فحصٌ نصّي يُثبت أن السطر مكتوب، لا أن المضيف الإرثي يخرج بالقيمة
// القصيرة فعلاً. وقياسٌ حيّ 2026-08-11 أثبت أن هذا الوركر الواحد كان يخدم **ثلاثة
// أصول** بالرأس الثابت نفسه — فخطأٌ هنا يثبّت HTTPS ١٨٠ يوماً **لا رجعة فيها** على
// مضيفٍ داخل نطاق متجرٍ منفصل تخدمه نسخةُ أندرويد مجمَّدة، ولا يكشفه أي grep.
console.log('');
console.log('HSTS مشروط بالمضيف (سلوكي):');
var hIdx = src.indexOf('var _isCanonHost =');
var hSet = src.indexOf("headers.set('Strict-Transport-Security'", hIdx);
// ⚠️ المرساة `');'` لا `';'`: الفاصلة المنقوطة ترد **داخل** السلسلة نفسها
//    (‏`'max-age=15552000; includeSubDomains'`)، فالبحث عنها وحدها يقطع المقتطف في
//    منتصف سلسلة نصّية ⇒ `SyntaxError`. وقع فعلاً أثناء بناء هذا الحارس.
var hEnd = src.indexOf(');', hSet) + 2;
if (hIdx < 0 || hSet < 0 || hEnd <= 1 || src.slice(hIdx, hEnd).indexOf('includeSubDomains') < 0) {
  console.log('  ❌ ضابط: تعذّر استخراج منطق HSTS كاملاً من الوركر — الفحص أجوف');
  failed++;
} else {
  var hSrc = src.slice(hIdx, hEnd);
  [['yemenschoolz.com',     'max-age=15552000; includeSubDomains', 'الرسمي: ١٨٠ يوماً + includeSubDomains'],
   ['www.yemenschoolz.com', 'max-age=15552000; includeSubDomains', 'www: مثله'],
   ['school.procorners.com', 'max-age=300',
    '🔴 ضابط: الإرثي يبقى قصيراً (متجر منفصل + أندرويد مجمَّد)'],
   ['school-teacher-proxy.procorners-shop.workers.dev', 'max-age=300',
    '🔴 ضابط: workers.dev يبقى قصيراً'],
   ['yemenschoolz.com.evil.example', 'max-age=300',
    '🔴 ضابط: لا مطابقة لاحقة على اسم النطاق الرسمي']
  ].forEach(function (c) {
    var got = null;
    var hctx = vm.createContext({
      url: { hostname: c[0] },
      headers: { set: function (k, v) { got = v; } }
    });
    vm.runInContext(hSrc, hctx);
    var good = (got === c[1]);
    if (!good) failed++;
    console.log((good ? '  ✅ ' : '  ❌ ') + c[2] + '  [' + got + ']');
  });
  var noPreload = !/preload/i.test(hSrc);
  if (!noPreload) failed++;
  console.log((noPreload ? '  ✅ ' : '  ❌ ') + '🔒 بلا preload (قرار مالك — الإدراج شبه دائم)');
}

// ── ضوابط اتجاه معاكس: بلا هذين يمرّ الاختبار كلُّه لأنه لم يقِس شيئاً ──
console.log('');
if (rewrites.length < 2) {
  console.log('  ❌ ضابط: لم تُستخرَج سطور إعادة الكتابة (' + rewrites.length + ') — الاختبار أجوف');
  failed++;
} else {
  console.log('  ✅ ضابط: سطور إعادة الكتابة المُستخرَجة = ' + rewrites.length);
}
if (!vm.runInContext("!!_RESERVED_TOP_PATHS['student']", ctx)) {
  console.log('  ❌ ضابط: الأسماء المحجوزة لم تُستخرَج فعلاً');
  failed++;
} else {
  console.log('  ✅ ضابط: الأسماء المحجوزة مُستخرَجة (student محجوز)');
}

// ── 🔴 الرابط القانوني مشروط بالطلب — حارس **سلوكي** ─────────────────────────
// لماذا سلوكي: `grep` يُثبت أن السطر مكتوب، لا أن `/ibn-khaldoun` يخرج بقيمته الصحيحة.
// والعلّة التي يقفلها حقيقية ومقيسة: صفحةٌ واحدة تخدم N مستأجرين من M مسارات، فكانت
// تُعلن `canonical=/home/index.html` للجميع — أي أن كلّ مستأجر يقول للزاحف إن قانونيّه
// صفحةُ مدرسة المالك. والتصحيح الجافاسكربتي يقع **بعد** التحميل، والزاحف يقرأ الخام أوّلاً.
console.log('');
console.log('الرابط القانوني مشروط بالطلب (سلوكي):');
var cIdx = src.indexOf('function _canonicalFor(');
// ⚠️ نفس فخّ حارس HSTS: المرساة `\n}` عند عمود 0 لا `}` وحدها — الأقواس ترد داخل الجسم.
var cEnd = src.indexOf('\n}', cIdx) + 2;
if (cIdx < 0 || cEnd <= 1) {
  console.log('  ❌ ضابط: تعذّر استخراج `_canonicalFor` من الوركر — الفحص أجوف');
  failed++;
} else {
  var cctx = vm.createContext({});
  vm.runInContext(
    src.slice(coIdx, src.indexOf(';', coIdx) + 1) + '\n' +          // CANONICAL_ORIGIN
    "var OWNER_SCHOOL_SLUG = 'abdaawatmuaz';\n" +
    src.slice(src.indexOf('var _KNOWN_SCHOOL_SLUGS'),
              src.indexOf('};', src.indexOf('var _KNOWN_SCHOOL_SLUGS')) + 2) + '\n' +
    src.slice(cIdx, cEnd), cctx);

  // ضابط أوّلي: القائمة استُخرجت فعلاً — قائمةٌ فارغة تجعل كلّ ما بعدها أجوف.
  // ⚠️ **بلا عدد حرفي** (فئة 83-ب): إضافةُ مدرسة رابعة عملٌ مشروع، وحارسٌ يحمرّ عليها
  //    يُدرَّب المستخدم على تجاهله. المقيس هو أن الاستخراج نجح وأن مدرسة المالك فيه.
  var known = vm.runInContext('_KNOWN_SCHOOL_SLUGS', cctx);
  var nSlugs = Object.keys(known).length;
  var okList = (nSlugs >= 1 && !!known['abdaawatmuaz']);
  if (!okList) failed++;
  console.log((okList ? '  ✅ ' : '  ❌ ') +
              'ضابط: سجلّ الـslugs مُستخرَج ويحوي مدرسة المالك  [' + nSlugs + ' مدرسة]');
  // 🟡 تبعية عابرة للمستودعات بلا رابط آلي: هذه القائمة مرآةُ
  //    `SchoolApp-gas/_build/schools.public.json`. الاتجاه الخطر **غير محروس**: إضافة
  //    مدرسة هناك بلا إضافتها هنا ⇒ 404 على صفحتها بلا أي إشارة، لأن CI الـgas لا يرى
  //    هذا الملف. دَينٌ مُعلَن: حارس تكافؤ في مستودع الـgas (نمط `reservedTopPathsParityGuard`).

  var CANON = 'https://yemenschoolz.com';
  [// الحالات الثلاث التي أبلغ عنها المالك — كلّها كانت تُعلن `/home/index.html`
   // 🔴 **انقلبت 2026-08-14**: كانت تتوقّع `/abdaawatmuaz`. الرابط بلا معرّف لم يعد
   //    يُعلن قانونيّاً يخصّ مستأجراً بعينه — يُحوَّل إلى الجذر أصلاً، وإعلانُه هويةَ
   //    مدرسةٍ على عنوانٍ لا يذكرها هو فخّ بند 68 نفسه.
   ['/home/index.html', '', null,             '',
    '🔴 الرابط بلا معرّف ⇒ **بلا حقن** — لا يُعلن قانونيّ مستأجرٍ بعينه (يُحوَّل للجذر)'],
   ['/home/index.html', '', 'abdaawatmuaz',   CANON + '/abdaawatmuaz',
    '`?school=` بـslug منشور ⇒ الشكل القصير نفسه (توحيد الشكلين)'],
   ['/home/index.html', 'abdaawatmuaz', null, CANON + '/abdaawatmuaz',
    'الشكل القصير ⇒ نفسه'],
   // 🔴 الضابط الحاسم: مستأجر آخر **لا** يُوحَّد على مدرسة المالك
   ['/home/index.html', '', 'ibn-khaldoun',   CANON + '/ibn-khaldoun',
    '🔴 مستأجر آخر بـ`?school=` ⇒ عنوانه هو، لا عنوان مدرسة المالك'],
   ['/home/index.html', 'ibn-khaldoun', null, CANON + '/ibn-khaldoun',
    '🔴 مستأجر آخر بالمسار ⇒ عنوانه هو'],
   // معرّف غير منشور (UUID) يبقى مميَّزاً لا يُسقَط على المالك
   ['/home/index.html', '', '10Zk0vwjrH',     CANON + '/home/index.html?school=10zk0vwjrh',
    'معرّف غير منشور ⇒ يبقى مميَّزاً بمعامله، لا يُوحَّد على المالك'],
   // `?news=` لا يدخل الرابط القانوني إطلاقاً (سطح فهرسة لا نهائي لولا ذلك)
   ['/home/index.html', 'abdaawatmuaz', null, CANON + '/abdaawatmuaz',
    '`?news=` لا يظهر في القانوني (‏`og:url` وحده يحمله)'],
   // 🔴 الضوابط المعاكسة — كلٌّ منها انحدارٌ وقع فعلاً في أوّل صياغة ورصدَته المراجعة.
   //    الحقن يجب أن **يصمت** حيث الوسم الساكن أصحّ، لا أن «يُصلحه».
   ['/home/schools.html', '', null, '',
    '🔴 الجذر (بعد إعادة الكتابة) ⇒ **بلا حقن** — وسمُه `/` والخريطة تعلنه بأولوية 1.0'],
   ['/home-all-school/index.html', '', null, '',
    '🔴 الصفحة المتقاعدة ⇒ بلا حقن — وُحِّدت على الجذر عمداً (بند 104)'],
   ['/student/index.html', '', null, '',
    '🔴 بوّابة الطالب ⇒ بلا حقن — وسمُها `/student` وهو الاسم المستعار المقصود'],
   ['/teacher/index.html', '', null, '',
    '🔴 بوّابة المعلّم ⇒ بلا حقن (‏1.88MB لا تُحلَّل بلا فائدة)'],
   ['/home/privacy.html', '', null, '',
    'صفحة عادية ⇒ بلا حقن — وسمها الساكن صحيح'],
   ['/home/newsarticle.html', '', null, '',
    'قالب الخبر ⇒ بلا حقن (‏noindex عمداً، وهويته ساكنة)']
  ].forEach(function (c) {
    var got = vm.runInContext('_canonicalFor', cctx)(c[0], c[1], c[2]);
    var good = (got === c[3]);
    if (!good) failed++;
    console.log((good ? '  ✅ ' : '  ❌ ') + c[4] + '\n       [' + got + ']');
  });
}

// ── 🔴 مفتاح المستأجر: المسار **أو** المعامل (2026-08-14) ────────────────────
//
// العلّة التي يقفلها: حقن الهوية كان مشروطاً بمقطع المسار وحده، فالسطح الذي يستعمله
// تطبيق الأندرويد المنشور (‏`/home/index.html?school=<UUID>`) كان **الوحيد بلا علاج** —
// يصل بـ«يمن سكولز» في كلّ عُقَد الهوية ثمّ يُطلى بعد ثوانٍ. سلوكي لا نصّي: `grep`
// يُثبت أن الدالّة مكتوبة، لا أنّ UUID يخرج منها ومقطعاً مشوّهاً لا يخرج.
console.log('');
console.log('مفتاح المستأجر — المسار أو المعامل (سلوكي):');
var tkIdx = src.indexOf('function _tenantKeyFrom(');
var tkEnd = src.indexOf('\n}', tkIdx) + 2;
var uuIdx = src.indexOf('var _SCHOOL_UUID_RE =');
if (tkIdx < 0 || tkEnd <= 1 || uuIdx < 0) {
  console.log('  ❌ ضابط: تعذّر استخراج `_tenantKeyFrom` من الوركر — الفحص أجوف');
  failed++;
} else {
  var tctx = vm.createContext({ URLSearchParams: URLSearchParams });
  vm.runInContext(
    src.slice(rIdx, rEnd) + '\n' +                                    // _RESERVED_TOP_PATHS
    src.slice(fIdx, fEnd) + '\n' +                                    // _schoolSlugFromPath
    src.slice(src.indexOf('var _KNOWN_SCHOOL_SLUGS'),
              src.indexOf('};', src.indexOf('var _KNOWN_SCHOOL_SLUGS')) + 2) + '\n' +
    src.slice(uuIdx, src.indexOf('\n', uuIdx)) + '\n' +               // _SCHOOL_UUID_RE
    src.slice(tkIdx, tkEnd), tctx);

  var EB = '12725ed7-c139-422c-a2d1-ec0ddd358104';
  [['/ibn-khaldoun',    '',                       'ibn-khaldoun',
    'مقطع مسار منشور ⇒ هو المفتاح (السلوك القائم بلا تغيير)'],
   ['/home/index.html', '?school=' + EB,          EB.toLowerCase(),
    '🔴 رابط تطبيق الأندرويد المنشور (UUID بمعامل) ⇒ صار له مفتاح — كان `\'\'`'],
   ['/home/index.html', '?school=ibn-khaldoun',   'ibn-khaldoun',
    'slug منشور بمعامل ⇒ مفتاح (الصيغة المكسورة التي رصدها GA تعمل الآن)'],
   ['/home/index.html', '?schoolId=' + EB,        EB.toLowerCase(),
    '`schoolId=` مقبول كـ`school=` — نفس ما تقرؤه الصفحة'],
   // 🔴 الضوابط المعاكسة — كلّ واحد منها يمنع مفتاح كاش حافة يتحكّم به العميل
   ['/home/index.html', '',                       '',
    '🔴 بلا معامل ⇒ لا مفتاح (وهو ما يُحوَّل للجذر أصلاً)'],
   ['/home/index.html', '?school=',               '',
    '🔴 معامل فارغ ⇒ لا مفتاح'],
   ['/home/index.html', '?school=../../etc',      '',
    '🔴 قيمة حرّة ⇒ لا مفتاح — لا يصنع العميلُ مدخلَ كاشٍ بما يشاء'],
   ['/home/index.html', '?school=' + EB.slice(0, -1), '',
    '🔴 UUID ناقص محرفاً ⇒ مرفوض (البوّابة شكلية صارمة لا `contains`)'],
   ['/home/index.html', '?school=not-a-school',   '',
    '🔴 slug غير منشور ⇒ لا مفتاح (لا كاش لما لا نخدمه)'],
   ['/teacher/index.html', '?school=' + EB,       '',
    '🔴 بوّابة المعلّم ⇒ لا مفتاح مهما حمل المعامل — الحقن لـ`home` وحده'],
   ['/home/schools.html', '?school=' + EB,        '',
    '🔴 الجذر ⇒ لا مفتاح أبداً — هوية الجذر خطّ أحمر (بندا 68/75)'],
   ['/home/news.html',   '?school=' + EB,         '',
    '🔴 صفحة المكتبة ⇒ لا مفتاح — لا عُقَد هوية فيها لتُحقَن']
  ].forEach(function (c) {
    var got = vm.runInContext('_tenantKeyFrom', tctx)(c[0], c[1]);
    var good = (got === c[2]);
    if (!good) failed++;
    console.log((good ? '  ✅ ' : '  ❌ ') + c[3] + '\n       [' + got + ']');
  });

  // ضابط بنيوي: الحقن يستهلك `_tenantKey` لا `_pathSlug` — وإلّا بقي السطح بلا علاج
  // بينما كلّ ما سبق أخضر (نفس فئة «حارسٌ يفحص وجود الشرط دون أثره»، بند 137).
  var usesKey = /var _brand = await _brandFromCache\(url\.origin, _tenantKey\)/.test(src) &&
                /_brandRefresh\(url\.origin, _tenantKey, env\)/.test(src) &&
                /if \(_tenantKey && !_newsId\)/.test(src);
  if (!usesKey) failed++;
  console.log((usesKey ? '  ✅ ' : '  ❌ ') +
              '🔴 بنيوي: سلسلة الحقن تستهلك `_tenantKey` لا `_pathSlug`');

  // و`_tenantKeyFrom` تُستدعى بالمسار **الخام** لا بالمُعاد كتابته: بعد إعادة الكتابة
  // يصير `/ibn-khaldoun` هو `/home/index.html` بلا معامل ⇒ المفتاح `''` وينهار الحقن
  // على كلّ صفحات الـslug بصمت، وكلّ الحالات أعلاه تبقى خضراء لأنها تختبر الدالّة وحدها.
  var usesRaw = /_tenantKeyFrom\(_rawPath, url\.search\)/.test(src) &&
                /var _rawPath = path;/.test(src);
  if (!usesRaw) failed++;
  console.log((usesRaw ? '  ✅ ' : '  ❌ ') +
              '🔴 بنيوي: تُستدعى بالمسار الخام (`_rawPath`) لا بالمُعاد كتابته');

  // 🔒 `og:site_name` مقيسٌ سلوكياً في كتلة «حقن هوية المدرسة» أدناه (تشغيل
  //    `_brandRewrite` على `HTMLRewriter` مزيّف يسجّل المحدِّدات) — وهو أدقّ من فحص
  //    نصّي هنا: التعليق داخل الدالّة يذكر الاسم فيُنتج فحصُ الوجود حكماً كاذباً.

  // والهوية المُخبَّأة تحمل `schoolId` — بلاه تبقى روابط البوّابات الستّ عارية.
  var carriesSid = /schoolId: .*String\(b\.schoolId \|\| ''\)/.test(src);
  if (!carriesSid) failed++;
  console.log((carriesSid ? '  ✅ ' : '  ❌ ') +
              'الهوية المُخبَّأة تحمل `schoolId` (لوصل روابط البوّابات قبل الحمولة)');

  // 🔴 والمالك يُخزَّن بـ`''` **عمداً** لا بمعرّفه — بنفس قاعدة `_homeCacheBrand` في
  //    `home/Index.html` حرفياً: الفارغ = مدرسة المالك (بند 99). وشكلان للشيء الواحد
  //    يشقّان فضاء الجلسة والكاش (بند 97)، وقاعدةٌ هنا تخالف نظيرتها هناك تجعل الرابط
  //    **يقفز** لحظة وصول الحمولة. فحصٌ نصّي لأن الفرع داخل `_brandRefresh` لا دالّة نقيّة.
  var ownerBlank = /schoolId: \(b\.isOwner === true\) \? '' : String\(b\.schoolId \|\| ''\)/.test(src);
  if (!ownerBlank) failed++;
  console.log((ownerBlank ? '  ✅ ' : '  ❌ ') +
              "🔴 المالك يُخزَّن بـ`''` لا بمعرّفه (شكلٌ واحد للمفهوم — بندا 99/97)");
}

// ── 🔴 الرابط العاري بلا معرّف ⇒ الجذر (2026-08-14) ─────────────────────────
//
// الفجوة التي يقفلها: عنوانٌ لا يذكر أيّ مدرسة كان يعرض بيانات مدرسة المالك كاملةً
// (‏30,056 بايت مقابل 626 لمستأجر آخر، قياس حيّ). فحصٌ نصّي هنا لأن الشرط يعيش داخل
// `fetch` ولا يُستخرَج كدالّة نقيّة — ولذلك يُقاس **حيّاً** بعد النشر بـ`curl -I`.
console.log('');
console.log('الرابط العاري بلا معرّف:');
[[/if \(\/\^\\\/home\\\/\(index\|news\)\\\.html\\\/\?\$\/i\.test\(path\) &&/,
  'الشرط يغطّي `/home/index.html` و`/home/news.html` معاً'],
 [/\(index\|news\)/,
  "🔴 `news.html` العاري مشمول — يستدعي `getHomePageBundle('', 'library')` ⇒ مكتبة المالك كاملةً (تسريبٌ أوسع لا أضيق)"],
 [/!url\.searchParams\.has\('school'\) && !url\.searchParams\.has\('schoolId'\)/,
  "🔴 الاستثناء بـ**وجود** المعامل لا صحّته (مدرسة جديدة خارج السجلّ لا تُكسَر)"],
 [/return Response\.redirect\(CANONICAL_ORIGIN \+ '\/', 302\);/,
  '🔴 302 لا 301 — القرار سياسة قابلة للمراجعة، و301 يُخبَّأ للأبد']
].forEach(function (c) {
  var good = c[0].test(src);
  if (!good) failed++;
  console.log((good ? '  ✅ ' : '  ❌ ') + c[1]);
});

// 🔴 ضابط معاكس قابلٌ للإفشال: يلتقط **أعضاء** مجموعة البدائل ويقارنها بالمجموعة
//    المقصودة بالضبط. فحصُ «لا يحوي newsarticle» وحده أجوفُ (يمرّ على أي نصّ)؛ أمّا
//    مقارنة المجموعة فتحمرّ عند أي إضافة أو حذف. و`newsarticle.html` مستثنى **عمداً**:
//    مسارُ مشاركةٍ يحمل `?news=` دائماً، وحقن OG له سلسلته الخاصّة — فتحويله يكسر
//    كلّ رابط خبر مُشارَك.
var altM = src.match(/\/\^\\\/home\\\/\(([a-z|]+)\)\\\.html/);
var alts = altM ? altM[1].split('|').sort().join(',') : '(لم تُلتقَط)';
var altsOk = alts === 'index,news';
if (!altsOk) failed++;
console.log((altsOk ? '  ✅ ' : '  ❌ ') +
            '🔴 مجموعة البدائل = `index,news` بالضبط — لا `newsarticle` (مسار مشاركة) ولا غيره · المقيس: ' + alts);

// 🔴 الضابط المعاكس البنيوي: التحويل يقع **قبل** حساب `_pathSlug`، وإلّا لالتُقط
// `/home/index.html` مساراً عادياً ومرّ. ويقع **بعد** `/` و`/portal` فلا يمسّهما.
var redirIdx = src.indexOf("return Response.redirect(CANONICAL_ORIGIN + '/', 302);");
var slugIdx  = src.indexOf('var _pathSlug = _schoolSlugFromPath(path);');
var portIdx  = src.indexOf("if (path === '/portal' || path === '/portal/')");
var ordered  = redirIdx > 0 && slugIdx > 0 && portIdx > 0 &&
               redirIdx < slugIdx && redirIdx > portIdx;
if (!ordered) failed++;
console.log((ordered ? '  ✅ ' : '  ❌ ') +
            '🔴 بنيوي: التحويل بعد `/portal` وقبل حساب `_pathSlug`');

// ── 🔴 slug غير منشور ⇒ 404 لا 200 ──────────────────────────────────────────
console.log('');
console.log('سطح الفهرسة اللانهائي (soft-404):');
/* ⚠️ **حُدِّث 2026-08-22 — تشديدٌ لا تخفيف.** كان التأكيد يطابق نصّ الشرط حرفياً
   (`!_KNOWN_SCHOOL_SLUGS[_pathSlug]`)، فأحمرَّ على **جعلِ السجلّ ديناميكياً** — وهو عملٌ
   صحيح. والثابتةُ التي يحرسها فعلاً ليست صياغةَ الشرط بل **وجودَ فحصٍ مشروطٍ قبل إعادة
   الكتابة**: مقطعٌ غيرُ منشور ⇒ 404، ومنشورٌ ⇒ يُعاد كتابته. */
[[/if \(_pathSlug && !\(await _slugIsPublished\(/, 'الـslug يُفحَص ضدّ السجلّ قبل إعادة الكتابة'],
 [/status: 404/, 'الحالة المُرجَعة 404 لا 200'],
 [/'X-Robots-Tag': 'noindex, follow'/, 'ورأس noindex معها (حزام وحمّالة)']
].forEach(function (c) {
  var good = c[0].test(src);
  if (!good) failed++;
  console.log((good ? '  ✅ ' : '  ❌ ') + c[1]);
});
// ضابط الاتجاه المعاكس: الـslugs المنشورة **لا** تُرجَع 404 — يقيسه جدول `_canonicalFor`
// أعلاه ضمناً (يُرجِع لها عنواناً صحيحاً)، ويؤكّده هنا أن الفحص مشروط بالنفي لا مطلق.
var guardIsConditional = /!\(await _slugIsPublished\(/.test(src) &&
                         /if \(_pathSlug\) path = '\/home\/index\.html';/.test(src);
if (!guardIsConditional) failed++;
console.log((guardIsConditional ? '  ✅ ' : '  ❌ ') +
            '🔴 ضابط: مسار الـslug المنشور لا يزال يُعاد كتابته كما كان (لا 404 شامل)');

/* ── 🟢 السجلُّ الديناميكيّ — سلوكيّ ────────────────────────────────────────────
   الأخطرُ هنا **معاكسٌ كالعادة**: لو أُسقطت البذرةُ الساكنة صار عطلُ GAS يُسقط الموقعَ
   كلَّه (كلُّ صفحات المدارس 404 دفعةً واحدة). فالترتيبُ «بذرةٌ ← كاش ← تحديث» ثابتةٌ
   تُقاس بالتنفيذ لا بالقراءة. */
console.log('');
console.log('سجلّ الـslugs الديناميكيّ (سلوكي):');
var spIdx = src.indexOf('async function _slugIsPublished(');
var spEnd = spIdx < 0 ? -1 : src.indexOf('\n}', spIdx) + 2;
if (spIdx < 0 || spEnd <= 1) {
  console.log('  ❌ ضابط: تعذّر استخراج `_slugIsPublished` — الفحص أجوف');
  failed++;
} else {
  /* 🔴 **الدالّة `async` والسكربتُ متزامن** — و`.then` هنا كان سيُطبَع **بعد** سطر
     `RESULT` النهائي فيصير الفحصُ زينةً لا حارساً (فئةُ «فحصٌ بلا مُشغِّل»).
     ⇒ يُجرَّد `async`/`await` ويُشغَّل المنطقُ متزامناً. **والتجريدُ آمنٌ ومكافئ هنا
     تحديداً** لأن الدالّة لا تحوي فروعاً تعتمد توقيتَ الوعد: ثلاثةُ شروطٍ متسلسلة على
     قيمٍ مُنتظَرة. ⚠️ **وأداةُ التجريد تُقاس قبل أن يُصدَّق حكمُها** (بند 170): الضابطُ
     أدناه يُثبت أن `await` اختفى فعلاً وأن الجسم بقي غيرَ فارغ — تجريدٌ يُنتج نصّاً
     فارغاً يجعل كلَّ ما يليه أخضرَ بلا معنى. */
  var spSrc = src.slice(spIdx, spEnd)
                 .replace(/^async function/, 'function')
                 .replace(/await /g, '');
  var stripOk = spSrc.indexOf('await ') === -1 &&
                spSrc.indexOf('_slugsFromCache(') !== -1 &&
                spSrc.indexOf('_KNOWN_SCHOOL_SLUGS[slug]') !== -1;
  if (!stripOk) failed++;
  console.log((stripOk ? '  ✅ ' : '  ❌ ') +
              'ضابط: تجريدُ `await` نجح والجسمُ باقٍ (تجريدٌ فارغ = أخضرُ بلا معنى)');
  var calls = { cache: 0, refresh: 0 };
  var spCtx = vm.createContext({
    _KNOWN_SCHOOL_SLUGS: { 'abdaawatmuaz': 1 },
    _slugsFromCache: function () { calls.cache++; return spCtx.__cached; },
    _slugsRefresh:   function () { calls.refresh++; return spCtx.__fresh; },
    __cached: null, __fresh: null
  });
  vm.runInContext(spSrc, spCtx);
  function run(slug, cached, fresh) {
    spCtx.__cached = cached; spCtx.__fresh = fresh;
    calls.cache = 0; calls.refresh = 0;
    return vm.runInContext('_slugIsPublished(' + JSON.stringify(slug) + ', "https://x", {})', spCtx);
  }
  [
    ['🔴 البذرةُ الساكنة تُجيب **بلا أيّ نداء** (وإلّا كلّفت كلَّ زيارة)',
     (function () { var r = run('abdaawatmuaz', null, null);
       return r === true && calls.cache === 0 && calls.refresh === 0; })()],
    ['🔴 مدرسةٌ جديدة في الكاش ⇒ تعمل **بلا تحديث** (نداءٌ لكلّ نافذة لا لكلّ زائر)',
     (function () { var r = run('new-school', ['new-school'], null);
       return r === true && calls.refresh === 0; })()],
    ['🔴 كاشٌ بارد ⇒ تحديثٌ **واحد** يجدها',
     (function () { var r = run('new-school', null, ['new-school']);
       return r === true && calls.refresh === 1; })()],
    ['🔴 ضابط: مجهولٌ وقائمةٌ مكاشة ⇒ **false بلا تحديث** (لا نداءَ لكلّ عنوانٍ مخترَع)',
     (function () { var r = run('ghost', ['a'], null);
       return r === false && calls.refresh === 0; })()],
    ['🔴 ضابط: سقوطُ GAS ⇒ المجهولُ false **والبذرةُ تبقى تعمل** (لا يسقط الموقع)',
     (function () { return run('ghost', null, null) === false &&
                           run('abdaawatmuaz', null, null) === true; })()]
  ].forEach(function (c) {
    if (!c[1]) failed++;
    console.log((c[1] ? '  ✅ ' : '  ❌ ') + c[0]);
  });
}

// ── 🔴 هوية النطاق عبر الأصول الثلاثة — حارس **سلوكي** ───────────────────────
// الضابط الأخطر هنا **معاكس**: النطاق الرسمي يجب أن يخرج **بلا `X-Robots-Tag` إطلاقاً**.
// رأسُ `noindex` عليه يمحو الموقع كلَّه من Google بنشرةٍ واحدة — ولا يكشفه أيّ فحص نصّي
// على وجود السطر، لأن السطر موجود وصحيح؛ الخطأ يكون في الشرط وحده.
console.log('');
console.log('هوية النطاق عبر الأصول الثلاثة (سلوكي):');
var iIdx = src.indexOf('function _identityHeaders(');
var iEnd = src.indexOf('\n}', iIdx) + 2;
if (iIdx < 0 || iEnd <= 1) {
  console.log('  ❌ ضابط: تعذّر استخراج `_identityHeaders` — الفحص أجوف');
  failed++;
} else {
  var ictx = vm.createContext({});
  vm.runInContext(src.slice(iIdx, iEnd), ictx);
  var idf = vm.runInContext('_identityHeaders', ictx);
  var HREF = 'https://yemenschoolz.com/abdaawatmuaz';

  [// 🔴 الاتجاه المعاكس أوّلاً — هو الذي يحمي الموقع كلَّه
   ['yemenschoolz.com',     true,  false, '🔴 ضابط: الرسمي **بلا** X-Robots-Tag (وإلّا مُحي من Google)'],
   ['www.yemenschoolz.com', true,  false, '🔴 ضابط: www مثله (يُحوَّل 301 إلى الرسمي أصلاً)'],
   // الحالة الموجبة
   ['school.procorners.com', true, true,  'الإرثي يُوسَم noindex (يخدم محتوى مطابقاً بلا 301)'],
   ['school-teacher-proxy.procorners-shop.workers.dev', true, true, 'workers.dev مثله'],
   // لا مطابقة لاحقة على اسم النطاق الرسمي
   ['yemenschoolz.com.evil.example', true, true, '🔴 ضابط: لا مطابقة لاحقة تمنح إعفاء الرسمي']
  ].forEach(function (c) {
    var h = idf(c[0], c[1], HREF);
    var hasNoindex = (h['X-Robots-Tag'] === 'noindex, follow');
    var good = (hasNoindex === c[2]);
    if (!good) failed++;
    console.log((good ? '  ✅ ' : '  ❌ ') + c[3] +
                '  [' + (h['X-Robots-Tag'] || 'بلا الرأس') + ']');
  });

  // الأصول الثابتة لا تُوسَم إطلاقاً — الوسم عليها ضجيج بلا معنى
  var statik = idf('school.procorners.com', false, HREF);
  var okStatic = (Object.keys(statik).length === 0);
  if (!okStatic) failed++;
  console.log((okStatic ? '  ✅ ' : '  ❌ ') +
              'ضابط: غير-HTML بلا أيّ رأس هوية  [' + Object.keys(statik).join(',') + ']');

  // رأس `Link: rel=canonical` — يعمل حتى حين يفشل تصحيح الوسم في الجسم
  var lk = idf('yemenschoolz.com', true, HREF)['Link'];
  var okLink = (lk === '<' + HREF + '>; rel="canonical"');
  if (!okLink) failed++;
  console.log((okLink ? '  ✅ ' : '  ❌ ') + 'رأس Link: rel=canonical مُرسَل على الرسمي أيضاً  [' + lk + ']');
}

// 🟡 ضابط ترتيبٍ نصّي — **بحدّه معلَناً** (بند 116: ما يُربَط بموضعٍ يقيس الموضع لا الحالة).
//    الغرض: `/gas/*` مسار API يقرؤه تطبيقا الأندرويد، ولا يجوز أن يحمل رؤوس فهرسة.
//    اليوم يخرج بـ`return` قبل كتلة الرؤوس، وهذا يقيس ترتيب سلسلتين في النصّ لا التدفّق —
//    فلو نُقلت `_identityHeaders` يوماً إلى دالّة تُستدعى من الأعلى لمرّ مجّاناً. القياس
//    السلوكي الحقيقي يحتاج تشغيل `fetch` كاملاً بـmock للشبكة، وهو دَينٌ مُعلَن لا مُدَّعى.
var gasIdx = src.indexOf("var match = path.match(/^\\/gas\\/");
var idhIdx = src.indexOf('var _idHeaders = _identityHeaders(');
var gasSafe = (gasIdx > 0 && idhIdx > gasIdx);
if (!gasSafe) failed++;
console.log((gasSafe ? '  ✅ ' : '  ❌ ') +
            '🟡 ضابط (ترتيب نصّي، حدُّه مُعلَن): رؤوس الهوية بعد مخرج /gas/');

// ── 🔴 عقد بوّابة الطالب — يُثبَّت **قبل** نقل الكود إلى مشروع المعلم ──────────
//
// قرار مالك مُعلَن (2026-08-12): كلّ أكواد مشروع `student` ستُنقَل إلى مشروع `teacher`،
// **ولا يجوز أن يفقد أيُّ مستخدم قديم وصولَه**. الضوابط أدناه تُثبِّت العقد الذي يجعل ذلك
// النقل آمناً، وتُكتَب الآن كي تحمرّ يوم يُخالَف — لا بعد بلاغ مستخدم.
//
// **الحقيقة المقيسة التي تجعل النقل آمناً** (‏`AppConfig.kt::matchesDeployment` في
// `SchoolAppyemen`): التطبيق يطابق **مقطع المسار** عبر
// `Regex("/(home|student|teacher|cms|schedule)/")` **ويتجاهل المضيف تماماً**؛ وهو يحمّل
// صفحةً ثابتة (`/student/index.html`) لا نقطةَ API. فالصفحة هي التي تنادي `/gas/student`
// عبر `gas-bridge.js`، **والوركر يملك وجهةَ ذلك النداء بالكامل**.
// ⇒ نقلُ الكود إلى مشروع المعلم لا يحتاج APK جديداً إطلاقاً: يكفي أن يُشير `GAS.student`
//   إلى نشرة `teacher` **بعد** أن تصير دوال الطالب متاحة هناك (‏denylist + `ApiEndpoint`).
//
// ⚠️ **وتحذيران يترتّبان على الـregex نفسه، وكلاهما غير بديهيّ:**
//   (١) `/portal` **لا يطابق** `/(…|student|…)/` — فأيّ رابط `/portal` يصل داخل تطبيق
//       الأندرويد يُعدّ **خارجياً** ⇒ يفتح Chrome ويترك التطبيق. الرابط القصير للمشاركة
//       البشرية وحدها؛ روابط داخل التطبيق تبقى على `/student/index.html`.
//   (٢) معرّف نشر `student` **لا يُحذف أبداً** (‏`clasp undeploy` ممنوع) — يبقى مساراً
//       للتراجع الفوري إن أخفق النقل، والمعرّف لا يعود إن حُذف.
console.log('');
console.log('عقد بوّابة الطالب (يحمي النقل إلى مشروع المعلم):');
// ⚠️ المفتاح في جدول `GAS` **بلا اقتباس** (`student:` لا `'student':`) — أوّل صياغة كتبته
//    مقتبَساً فحمرّ الحارس على كودٍ سليم. مرساةٌ غير دقيقة تُنتج حكماً كاذباً في الاتجاهين
//    (بند 115): هنا إنذاراً كاذباً، ولو انعكس الشرط لمرّت فراغاً.
[[/^\s*student:\s*'https:\/\/script\.google\.com\/macros\/s\/[^']+\/exec'/m,
  '🔴 مدخل `student` في جدول GAS قائم — حذفُه ينقطع `/gas/student` والأندرويد معاً (بند 124)'],
 [/if \(path === '\/portal' \|\| path === '\/portal\/'\) path = '\/student\/index\.html';/,
  '🔴 `/portal` إعادة كتابة **داخلية** لا 301 — الشريط يبقى `/portal`، والتطبيق لا يراه أصلاً'],
 [/'student': 1/,
  '`student` محجوز في `_RESERVED_TOP_PATHS` ⇒ لا يُقرأ slug مدرسة']
].forEach(function (c) {
  var good = c[0].test(src);
  if (!good) failed++;
  console.log((good ? '  ✅ ' : '  ❌ ') + c[1]);
});
// الضابط الأهمّ: المسار الذي يحمله الـAPK **مجمَّداً** يُخدَم كما هو — يقيسه جدول `CASES`
// أعلاه (‏`/student/index.html` ⇒ نفسه بلا تحويل)، ويُعاد تأكيده هنا صراحةً لأن كسره
// **لا رجعة فيه**: لا Deep Link ولا مزامنة ديناميكية ⇒ الإصلاح الوحيد إصدارٌ جديد على Play.
var apkFrozen = CASES.some(function (c) {
  return c[0] === '/student/index.html' && c[1] === '/student/index.html';
});
if (!apkFrozen) failed++;
console.log((apkFrozen ? '  ✅ ' : '  ❌ ') +
            '🔴 ضابط: `/student/index.html` (المسار المجمَّد في الـAPK) يُخدَم كما هو');

// ── ص6 (2026-08-19): `/gas/student` ⇒ نشرة `teacher` + مُميِّز `app=student` ────
//
// 🔴 **الضابطان معاً أو لا:** تبديلُ الوجهة بلا المُميِّز يجعل `/gas/student` يخدم
// **لوحة المعلّم** بدل صفحة الطالب — والفحص الصحّي يردّ عن التطبيق الخطأ. ولذلك
// يُقاس الأمران في كتلة واحدة، ومعهما ضابطٌ معاكس يُثبت أن الإلحاق **مقيَّد بمدخل
// الطالب** فلا يتسرّب إلى `/gas/teacher` ولا إلى بقيّة التطبيقات الستّة.
//
// ⚠️ ويُقاس **الفاصل المشروط** صراحةً: النداء العاري `/gas/student` بلا استعلام يحتاج
// `?` لا `&` — وهو بالضبط ما يستعمله فحص الصحّة وجسرُ الأندرويد. `'?' + 'app=student'`
// ثابتاً كان سيمرّ كلَّ فحصٍ نصّي ويكسر كلَّ نداءٍ يحمل استعلاماً.
console.log('');
console.log('ص6 — تحويل `/gas/student` إلى نشرة المعلّم:');
[[/^GAS\.student\s*=\s*GAS\.teacher\s*;/m,
  '🔴 `GAS.student = GAS.teacher` **بعد** الحرفيّة (داخلها `GAS` غير مُسنَد ⇒ undefined)'],
 [/if \(app === 'student'\) \{[\s\S]{0,160}?fullTarget \+=[^\n]*'app=student'/,
  '🔴 `app=student` يُلحَق بـ`fullTarget` — بلاه تُخدَم لوحة المعلّم على مسار الطالب'],
 [/fullTarget \+= \(url\.search \? '&' : '\?'\) \+ 'app=student'/,
  '🔴 الفاصل مشروط بـ`url.search` — النداء العاري يحتاج `?` لا `&`']
].forEach(function (c) {
  var good = c[0].test(src);
  if (!good) failed++;
  console.log((good ? '  ✅ ' : '  ❌ ') + c[1]);
});
// ضابطٌ معاكس: الإلحاق **مشروطٌ** لا مطلق — لا سطر يُلحِق `app=student` بلا شرط `app`.
var appTagScoped = !/\n\s*fullTarget \+= [^\n]*'app=student'[^\n]*\n/.test(
  src.replace(/if \(app === 'student'\) \{[\s\S]*?\n\s{6}\}/g, '')
);
if (!appTagScoped) failed++;
console.log((appTagScoped ? '  ✅ ' : '  ❌ ') +
            '🔴 ضابط معاكس: لا إلحاق لـ`app=student` خارج شرط `app === \'student\'`');

// ═══════════════════════════════════════════════════════════════════════════
//  روابط التطبيق القصيرة (/app · /download) وDigital Asset Links — فحص **سلوكي**
//
//  🔴 لماذا سلوكي لا نصّي: هذان مساران يعودان **مبكراً** بـ`Response` فلا يراهما
//  جدول `CASES` أعلاه (يصف إعادة الكتابة وحدها). وتأكيدٌ نصّي على وجود السطر لا يقول
//  شيئاً عن الحالة ولا عن الرؤوس — وهذه بالضبط الرؤوس التي أغفلها أوّل تنفيذ للميزة.
//  فنستخرج الكتلتين ونُشغّلهما فعلاً بـ`Response` مزيَّف.
// ═══════════════════════════════════════════════════════════════════════════
console.log('');
console.log('روابط التطبيق القصيرة وassetlinks (فحص سلوكي):');

function extractBlock(startNeedle, label) {
  var i = src.indexOf(startNeedle);
  if (i < 0) return null;
  // نهاية الكتلة: أوّل سطر يحمل `\n    }` بعد بدايتها (مستوى المسافة البادئة نفسه).
  var j = src.indexOf('\n    }', i);
  if (j < 0) return null;
  return src.slice(i, j + 6);
}

function runBlock(blockSrc, pathIn, hostIn, search) {
  var captured = null;
  function FakeResponse(body, init) {
    captured = { body: body, status: (init && init.status) || 200, headers: (init && init.headers) || {} };
    return captured;
  }
  var sandbox = {
    path: pathIn,
    url: new URL('https://' + hostIn + pathIn + (search || '')),
    Response: FakeResponse,
    JSON: JSON,
    encodeURIComponent: encodeURIComponent
  };
  vm.runInNewContext('(function () {\n' + blockSrc + '\nreturn null;\n})()', sandbox);
  return captured;
}

var appBlock = extractBlock("if (path === '/app' || path === '/app/'", '/app');
var alBlock  = extractBlock("if (path === '/.well-known/assetlinks.json')", 'assetlinks');

function check(ok, label) {
  if (!ok) failed++;
  console.log((ok ? '  ✅ ' : '  ❌ ') + label);
}

if (!appBlock) {
  check(false, '🔴 تعذّر استخراج كتلة `/app` — الفحص أجوف');
} else {
  var r1 = runBlock(appBlock, '/app', 'yemenschoolz.com', '');
  check(!!r1 && r1.status === 302, '`/app` ⇒ 302 (لا 301 — الدائم يُخبَّأ للأبد)');
  check(!!r1 && /play\.google\.com\/store\/apps\/details\?id=com\.proconrers\.schoolappyemen$/
        .test(r1.headers['Location'] || ''), 'الوجهة صفحة الحزمة المنشورة على Play');
  check(!!r1 && r1.headers['Cache-Control'] === 'no-store', '`no-store` — تغيير الهدف يسري فوراً');
  check(!!r1 && /max-age=15552000/.test(r1.headers['Strict-Transport-Security'] || ''),
        'HSTS كامل على النطاق الرسمي');
  check(!!r1 && r1.headers['X-Content-Type-Options'] === 'nosniff' &&
        !!r1.headers['Referrer-Policy'],
        '🔴 الرؤوس الأمنية حاضرة رغم العودة المبكرة (الاستثناء الصامت الذي أغفله أوّل تنفيذ)');
  check(!!r1 && !r1.headers['X-Robots-Tag'], 'ضابط: النطاق الرسمي بلا `X-Robots-Tag`');

  var r2 = runBlock(appBlock, '/download', 'yemenschoolz.com', '?ref=wa');
  check(!!r2 && r2.status === 302 && /[?&]referrer=wa$/.test(r2.headers['Location'] || ''),
        '`/download?ref=wa` ⇒ يمرّر `referrer` إلى Play');

  // 🔴 ضابط الاتجاه المعاكس — الأهمّ: نطاق إرثي **لا** يُثبَّت عليه HSTS طويل.
  var r3 = runBlock(appBlock, '/app', 'school.procorners.com', '');
  check(!!r3 && r3.headers['Strict-Transport-Security'] === 'max-age=300',
        '🔴 ضابط معاكس: النطاق الإرثي يبقى على `max-age=300` — لا تثبيت ١٨٠ يوماً');
  check(!!r3 && r3.headers['X-Robots-Tag'] === 'noindex, follow',
        'ضابط: النطاق الإرثي لا يُفهرَس');

  // ضابط: مسار لا يخصّ الميزة لا تلتقطه الكتلة إطلاقاً.
  check(runBlock(appBlock, '/appointments', 'yemenschoolz.com', '') === null,
        '🔴 ضابط معاكس: `/appointments` لا تلتقطه كتلة `/app` (الحجز بالمقطع لا بالبادئة)');
}

if (!alBlock) {
  check(false, '🔴 تعذّر استخراج كتلة assetlinks — الفحص أجوف');
} else {
  var ra = runBlock(alBlock, '/.well-known/assetlinks.json', 'yemenschoolz.com', '');
  check(!!ra && ra.status === 200, '`/.well-known/assetlinks.json` ⇒ 200 من الوسيط لا من Pages');
  check(!!ra && /application\/json/.test(ra.headers['Content-Type'] || ''), 'نوع المحتوى JSON');
  var parsed = null;
  try { parsed = JSON.parse(ra && ra.body); } catch (e) { parsed = null; }
  check(Array.isArray(parsed) && parsed.length > 0, 'الجسم JSON صالح ومصفوفة');
  var stmt = (parsed && parsed[0]) || {};
  check(stmt.target && stmt.target.package_name === 'com.proconrers.schoolappyemen',
        'اسم الحزمة مطابق للمنشور (‏`proconrers` إملاء مجمَّد صحيح — لا يُصحَّح)');
  // 🔴 **بصمتان بعينهما لا «واحدة على الأقل»** (شُدِّد 2026-08-13). الصياغة السابقة
  //    كانت تمرّ على القائمة الناقصة — وهي بالضبط الحالة التي تُفشِل App Links
  //    **لكل مستخدم من Play** بينما التثبيت اليدوي يعمل، فيبدو كل شيء سليماً محلياً.
  //    ولا يُقاس العدد وحده: تُسمّى كلُّ بصمة بدورها، فحذفُ إحداهما يحمرّ باسمها.
  var FP_UPLOAD = '11:E9:B0:2B:1F:26:06:54:04:F8:64:46:51:F8:FA:84:EC:52:DF:3D:0D:11:16:9B:E3:E9:E3:40:B7:50:FA:39';
  var FP_PLAY   = 'CF:63:D5:66:10:1F:6C:1D:4D:3D:90:29:BD:8D:A6:89:A8:80:1A:BC:6A:2D:1F:F6:EE:62:87:F3:49:E0:FE:C9';
  var FP_RE     = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
  var fps = (stmt.target && stmt.target.sha256_cert_fingerprints) || [];
  check(fps.length === 2, 'بصمتان بالضبط (‏الفعلي: ' + fps.length + ')');
  check(fps.every(function (f) { return FP_RE.test(f); }),
        'كلتا البصمتين بالصيغة الصحيحة');
  check(fps.indexOf(FP_UPLOAD) !== -1,
        '① بصمة **مفتاح الرفع** حاضرة (التثبيت اليدوي والاختبار المحلي)');
  check(fps.indexOf(FP_PLAY) !== -1,
        '🔴 ② بصمة **مفتاح توقيع التطبيق** حاضرة — بدونها تفشل الروابط لكل مستخدم من Play');
  check(Array.isArray(stmt.relation) &&
        stmt.relation.indexOf('delegate_permission/common.handle_all_urls') !== -1,
        'العلاقة `handle_all_urls` (‏App Links + WebAuthn معاً)');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
   حقن هوية المدرسة في الـHTML الخام على `/<slug>`  (2026-08-13)

   يُقاس هنا ثلاثة أشياء لا يقيسها شيء آخر في هذا المستودع:
   ① الحقن **مشروط** بـ`_pathSlug` وبغياب `?news=` — أي أن الجذر وهوية المنصّة لا يُمَسّان.
   ② `og:site_name` **ليس** ضمن ما يُحقَن (بندا 68/75).
   ③ **fail-open**: لا `await` لنداء GAS في مسار الاستجابة؛ التحديث في `ctx.waitUntil` وحده.
      هذه أهمّها: انتظارُ GAS هو العلّة (وسيط 14,535ms · فشل 38.81٪)، فجعلُه شرطاً للعرض
      يُضاعفها بدل أن يُصلحها — وهو خطأ يبدو صحيحاً تماماً في المراجعة النصّية.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
console.log('\n🏷️  حقن هوية المدرسة على `/<slug>`:');
(function () {
  /* يستخرج نصّ دالّة كاملاً بموازنة الأقواس — لا `indexOf('\n}')`: يتكسّر مع أي دالّة
     تحوي `}` في بداية سطر داخلها. */
  function fnSrc(name) {
    var i = src.indexOf('function ' + name + '(');
    if (i === -1) return null;
    var b = src.indexOf('{', i), d = 0, e = -1, j;
    for (j = b; j < src.length; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') { d--; if (d === 0) { e = j + 1; break; } }
    }
    return e === -1 ? null : src.slice(i, e);
  }

  ['_brandFromCache', '_brandRefresh', '_brandRewrite', '_brandDocTitle', '_safeHttpUrl',
   '_brandCacheKey'].forEach(function (n) {
    check(!!fnSrc(n) || src.indexOf('async function ' + n + '(') !== -1,
          'دالّة `' + n + '` موجودة');
  });

  /* ① الشرط — يُقرأ من الكتلة الحيّة لا من الذاكرة.
     🔴 **تغيّر 2026-08-14**: كان `_pathSlug` فصار `_tenantKey` — المستأجر يصل بمقطع
     مسار **أو** بمعامل صريح، وقصْرُه على الأوّل ترك سطح تطبيق الأندرويد المنشور
     (‏`/home/index.html?school=<UUID>`) بلا حقن إطلاقاً. راجع كتلة «مفتاح المستأجر». */
  var gIdx = src.indexOf('if (_tenantKey && !_newsId) {');
  check(gIdx !== -1, '🔒 الحقن مشروط بـ`_tenantKey && !_newsId` (الجذر ومسار المشاركة لا يُمَسّان)');
  var gEnd = src.indexOf('\n      }', gIdx);
  var gate = gIdx === -1 ? '' : src.slice(gIdx, gEnd === -1 ? gIdx + 600 : gEnd);
  check(gate.indexOf('_brandRewrite(') !== -1, '… وداخله يُستدعى `_brandRewrite` فعلاً (لا تعريف بلا وصل)');

  /* ③ fail-open — أهمّ تأكيد في هذه الكتلة. */
  check(/ctx\.waitUntil\(\s*_brandRefresh\(/.test(gate),
        '🔴 التحديث في `ctx.waitUntil` — خارج مسار الاستجابة تماماً');
  check(gate.indexOf('await _brandRefresh') === -1,
        '🔴 **لا `await` لـ`_brandRefresh` في مسار الطلب** (انتظار GAS هو العلّة لا العلاج)');
  check(/_brandFromCache\(/.test(gate) && gate.indexOf('caches.default.match') === -1,
        '… والقراءة من كاش الحافة عبر `_brandFromCache` وحدها');

  /* ② + سلوك `_brandRewrite`: يُشغَّل فعلياً على `HTMLRewriter` مزيّف يسجّل المحدِّدات. */
  var rwCtx = vm.createContext({ String: String, JSON: JSON });
  vm.runInContext(
    'function _AttrSet(a,v){this.attr=a;this.val=v;}\n' +
    'function _TextSet(v){this.val=v;}\n' +
    'function _BrandHead(b){this.brand=b;}\n' +
    fnSrc('_brandDocTitle') + '\n' + fnSrc('_brandRewrite') + '\n' +
    'function mkRw(sink){ return { on: function(sel, h){ sink.push([sel, h]); return this; } }; }', rwCtx);
  rwCtx.__sink = [];
  rwCtx.__brand = { name: 'مدارس ابن خلدون الاهلية', tagline: 'ت', description: 'وصف', logo: 'https://lh3.googleusercontent.com/d/X=w400' };
  vm.runInContext('_brandRewrite(mkRw(__sink), __brand)', rwCtx);
  var sels = rwCtx.__sink.map(function (p) { return p[0]; });

  check(sels.indexOf('meta[property="og:site_name"]') === -1,
        '🔒 `og:site_name` **ليس** ضمن المحدِّدات المحقونة (بندا 68/75 — خمس رفضات Branding)');
  ['title', '.school-brand-name', 'meta[property="og:title"]', 'head',
   'meta[name="description"]', 'meta[property="og:description"]',
   '#hdrLogo', '#ftLogo', 'meta[name="twitter:image"]'].forEach(function (s) {
    check(sels.indexOf(s) !== -1, 'يُحقَن المحدِّد `' + s + '`');
  });
  var titleH = rwCtx.__sink.filter(function (p) { return p[0] === 'title'; })[0];
  /* 🔴 نصّ العنوان **نسخةٌ ثالثة بالضرورة** (مستودع منفصل، وGAS لا يشارك كوداً). تطابقُه
     الحرفي مع `home/Index.html::__homeDocTitle` هو ما يمنع العنوان من **القفز** لحظة وصول
     الحمولة. تثبيتُه هنا هو الوصلة الوحيدة الممكنة عبر المستودعين. */
  check(titleH && titleH[1].val === 'مدارس ابن خلدون الاهلية — ت | يمن سكولز',
        '🔴 نصّ العنوان مطابق حرفياً لما تبنيه الصفحة (وإلّا قفز العنوان عند وصول الحمولة)');

  /* بلا شعار ⇒ صفر محدِّد صورة: `og:image` فارغاً أسوأ من غيابه (نفس علّة `_OgImages`). */
  rwCtx.__sink2 = [];
  rwCtx.__brand2 = { name: 'م', tagline: '', description: '', logo: '' };
  vm.runInContext('_brandRewrite(mkRw(__sink2), __brand2)', rwCtx);
  var sels2 = rwCtx.__sink2.map(function (p) { return p[0]; });
  check(sels2.indexOf('#hdrLogo') === -1 && sels2.indexOf('meta[name="twitter:image"]') === -1,
        '🔴 ضابط معاكس: بلا شعار ⇒ صفر محدِّد صورة (لا `content=""` مُعلَن)');
  check(sels2.indexOf('meta[name="description"]') === -1,
        '🔴 ضابط معاكس: بلا وصف ⇒ لا يُدهَس وصف الصفحة بفراغ');
  check(sels2.indexOf('title') !== -1 && sels2.indexOf('.school-brand-name') !== -1,
        '… والاسم يُحقَن دائماً (هو الحدّ الأدنى الذي جاءت الميزة لأجله)');

  /* بوّابة المخطّط — القيمة تصل من شيت يحرّره بشر (بند 35: الحذف لا الاستبدال). */
  var uCtx = vm.createContext({ String: String });
  vm.runInContext(fnSrc('_safeHttpUrl'), uCtx);
  function safe(v) { uCtx.__v = v; return vm.runInContext('_safeHttpUrl(__v)', uCtx); }
  check(safe('https://lh3.googleusercontent.com/d/X=w400') === 'https://lh3.googleusercontent.com/d/X=w400',
        'رابط https سليم يمرّ');
  check(safe('javascript:alert(1)') === '', '🔒 `javascript:` يُرفض');
  check(safe('ja\tvascript:alert(1)') === '', '🔒 حرف تحكّم داخل المخطّط ⇒ رفض');
  /* 🔴 **الحالة التي كشفها اختبار الطفرة، وهي عكس ما يوحي به بند 35 حرفياً.**
     لو حُذِفت أحرف التحكّم (كما يقول البند لبوّابة حاجبة) لصارت هذه `https://evil.example`
     و**قُبِلت**. البوّابة هنا سامحة فالاتجاه ينقلب ⇒ رفضٌ صريح. */
  check(safe('https:\t//evil.example') === '',
        '🔴 `https:<TAB>//evil` يُرفض — الحذف كان سيجعلها صالحة (اتجاه بند 35 منقلب هنا)');
  check(safe('https://a b.example') === '', '🔒 فراغ داخلي ⇒ رفض');
  check(safe('  https://ok.example  ') === 'https://ok.example', 'الفراغ المحيط يُقلَّم لا يُرفض');
  check(safe('http://x/y') === '', '🔒 `http:` غير المشفَّر يُرفض (محتوى مختلط)');
  check(safe('data:text/html,<script>') === '', '🔒 `data:` يُرفض');
  check(safe(null) === '' && safe(undefined) === '', 'الفراغ/العدم ⇒ سلسلة فارغة بلا استثناء');

  /* مفتاح الكاش لا يمكن أن يصير سطحاً مخدوماً: ثلاثة مقاطع ⇒ يرفضه `_schoolSlugFromPath`. */
  ctx.__k = '/__brand-cache/v1/ibn-khaldoun';
  check(vm.runInContext('_schoolSlugFromPath(__k)', ctx) === '',
        '🔒 مسار مفتاح الكاش لا يُقرَأ slug مدرسة (لا يصير سطحاً مخدوماً)');

  check(src.indexOf('var BRAND_TTL_S = 21600;') !== -1,
        'مهلة كاش الهوية ٦ ساعات (≈٤ نداءات/يوم/مدرسة بدل نداءٍ لكل زيارة)');
})();

/* ═══════════════════════════════════════════════════════════════════════════
   منظّم التزاحم — جِتَر الانتظار ونافذة الدخول (‏2026-08-21)
   ───────────────────────────────────────────────────────────────────────────
   🔴 خطران صامتان يقفلهما هذا الحارس:
     ① **مدخلٌ باسمٍ خاطئ** في `BH_LOGIN_FNS` ميّتٌ بلا أن يحمرّ شيء — وقع فعلاً:
        أوّل قائمةٍ كُتبت حملت `handleStudentLogin` و`teacherLoginProtected` ولا وجود
        لهما في مصدر GAS. الحارس يقيس **وجود الاسم في المصدر الحقيقي** حين يتوفّر
        المستودع الشقيق (نفس نمط `check-slug-mirror.js`).
     ② **عودةُ التصادف** `BH_MAX_WAIT_MS == BOOT_SCHEMA_RELEASE_MS` — الجِتَر يفكّه،
        وحذفُه يُعيد الرنين بلا أثرٍ ظاهر.
   ═══════════════════════════════════════════════════════════════════════════ */
(function bulkheadWaitAndLoginWindowGuard() {
  var loginBlock = /var BH_LOGIN_FNS = \{([\s\S]*?)\};/.exec(src);
  check(!!loginBlock, 'تعذّر اقتطاع `BH_LOGIN_FNS` ⇒ الحارس عمي (يجب أن يحمرّ)');
  if (!loginBlock) return;

  var names = (loginBlock[1].match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/gm) || [])
    .map(function (l) { return l.replace(/[\s:]/g, ''); });
  check(names.length >= 4, 'قائمة الدخول غير فارغة (' + names.length + ' اسماً) — ' +
        'قائمةٌ فارغة تُطفئ الميزة بصمت');

  /* الجِتَر قائمٌ ومُستعمَل — لا معرَّفٌ ومهجور (بند: «حارسٌ يفحص وجود اسمٍ لا أثره»).
     🔴 ويُقاس **بتشغيله** لا بمطابقة نصّه حرفياً: مرساةٌ على التنسيق تُحمِّر على إعادة
     صياغةٍ حميدة (رصدَته المراجعة — إنذارٌ كاذب لا ثغرة، لكنه يُفقِد الثقة بالحارس). */
  var jitterFn = /function _bhWaitMs\(\)\s*\{[\s\S]*?\}/.exec(src);
  check(!!jitterFn, 'تعذّر اقتطاع `_bhWaitMs` ⇒ الحارس عمي (يجب أن يحمرّ)');
  if (jitterFn) {
    var _bhWaitMs = new Function('return (' + jitterFn[0] + ');')();
    var lo = Infinity, hi = -Infinity, distinct = {};
    for (var s = 0; s < 400; s++) {
      var v = _bhWaitMs();
      lo = Math.min(lo, v); hi = Math.max(hi, v); distinct[v] = 1;
    }
    check(lo >= 7000 && hi < 9000 && Object.keys(distinct).length > 50,
          '🔴 الجِتَر يُنتج قيَماً **متفرّقة** داخل [7000,9000) — ' +
          '[' + lo + ',' + hi + '] بـ' + Object.keys(distinct).length + ' قيمة');
    check(hi !== lo, '🔴 وليس ثابتاً مقنَّعاً (ثابتٌ يُعيد التصادف 8000==8000 بصمت)');
  }
  check(/_bhAcquire\(app, _bhMode === 'shadow' \? 0 : _bhWait\)/.test(src),
        '🔴 والجِتَر/النافذة **مُستعمَلان فعلاً** عند `_bhAcquire` لا معرَّفَين ومهجورَين');
  /* 🔴 القرار على ما يُنفّذه GAS فعلاً: `JSON.parse` لا أوّل مطابقةٍ نصّية — رصدَته
     المراجعة، لأن المفتاح المكرَّر يُقرأ **أوّله** بالرجيكس و**آخره** بالمُحلِّل. */
  check(/_bhIsLoginBody\(init\.body\)/.test(src) && /JSON\.parse\(body\)/.test(src),
        '🔒 نافذة الدخول تُقرَّر بتحليلٍ حقيقيّ لا بمطابقةٍ نصّية قابلة للانتحال');
  check(/body\.length > BH_LOGIN_BODY_MAX\) return false;/.test(src),
        '🔒 والتحليل مقيَّدٌ بحجمٍ صغير (لا `JSON.parse` على حمولةٍ ضخمة في المسار الحارّ)');
  check(/BH_LOGIN_FNS\.hasOwnProperty\(o\.fn\)/.test(src),
        "🔒 `hasOwnProperty` لا فحص الحقيقة (‏`fn='toString'` كان سيرث نافذة الدخول)");

  /* 🔴 و`_bhIsLoginBody` تُقاس **بتشغيلها على مُدخَلات حقيقية** لا بمطابقة نصّها:
     طفرةٌ تقلب `catch` إلى `return true` (‏fail-open على الامتياز) مرّت خضراء على كلّ
     المرساة النصّية — وهي بالضبط أسوأ ما يمكن أن يقع هنا. */
  var idFn = /function _bhIsLoginBody\(body\)\s*\{[\s\S]*?\n\}/.exec(src);
  var fnsBlock = /var BH_LOGIN_FNS = \{[\s\S]*?\n\};/.exec(src);
  var maxBlock = /var BH_LOGIN_BODY_MAX = \d+;/.exec(src);
  check(!!idFn && !!fnsBlock && !!maxBlock,
        'تعذّر اقتطاع `_bhIsLoginBody` وتوابعها ⇒ الحارس عمي (يجب أن يحمرّ)');
  if (idFn && fnsBlock && maxBlock) {
    var isLogin = new Function(
      fnsBlock[0] + '\n' + maxBlock[0] + '\n' + idFn[0] +
      '\nreturn _bhIsLoginBody;')();
    var big = '{"fn":"handleTeacherLogin","args":["' + new Array(5000).join('x') + '"]}';
    check(isLogin('{"fn":"handleTeacherLogin","args":[]}') === true,
          'دخولٌ حقيقيّ يُمنَح النافذة الموسَّعة');
    check(isLogin('{"fn":"getListsDataProtected","args":[]}') === false,
          'ضابط: نداءٌ عاديّ لا يُمنَحها');
    /* 🔴 الانتحال بمفتاحٍ مكرَّر: `JSON.parse` يأخذ **آخر** قيمة كما يفعل GAS. */
    check(isLogin('{"fn":"handleTeacherLogin","fn":"getListsDataProtected"}') === false,
          '🔒 مفتاحٌ مكرَّر لا يمنح النافذة (المُحلِّل يأخذ آخره كما يأخذه GAS)');
    check(isLogin('{"fn":"handleTeacherLogin"') === false,
          '🔒 fail-closed: جسمٌ تالفٌ لا يُمنَح الامتياز');
    check(isLogin(null) === false && isLogin(undefined) === false &&
          isLogin({ fn: 'handleTeacherLogin' }) === false,
          '🔒 fail-closed: غيرُ النصّ لا يُمنَح الامتياز');
    check(isLogin(big) === false,
          '🔒 fail-closed: جسمٌ فوق الحدّ لا يُمنَح الامتياز (ولا يُحلَّل)');
    check(isLogin('{"fn":"toString","args":[]}') === false,
          "🔒 fail-closed: `fn='toString'` لا يرث الامتياز من `Object.prototype`");
  }
  check(/\r?\n\s*var _nap = Math\.min\(delays\[attempt\], Math\.max\(0, _remain\)\);/.test(src),
        '🔴 تأخير إعادة المحاولة مقصوصٌ على المتبقّي (وإلّا تجاوز السقف بـ700ms)');
  /* 🔴 مرساةٌ على **الإعلان** لا على النصّ: العبارة نفسها ترد في تعليقٍ أعلى الملفّ،
     فطفرةٌ أزالتها من الكود مرّت خضراء لأن التعليق أرضى الشرط. الفرق `\n\s*var`. */
  check(/\r?\n\s*var TOTAL_BUDGET_MS = 24000 - _bhWaited;/.test(src),
        '🔴 الانتظار **يُخصَم** من ميزانية المحاولات ⇒ السقف الكلّي يبقى ~24ث');

  /* ③ الأسماء تُطابَق بمصدر GAS حين يتوفّر — وغيابُه `SKIPPED` صريحة لا نجاحٌ صامت. */
  var GAS = process.env.SCHOOLAPP_GAS_DIR ||
            path.join(path.dirname(path.dirname(__dirname)), 'SchoolApp-gas');
  var gasOk = false;
  try { gasOk = fs.statSync(path.join(GAS, 'teacher')).isDirectory(); } catch (e) { gasOk = false; }
  if (!gasOk) {
    console.log('  ⏭️  SKIPPED: مصدر GAS غير متاح (' + GAS + ') — لم تُطابَق أسماء الدخول');
  } else {
    var defs = '';
    ['teacher', 'student'].forEach(function (app) {
      fs.readdirSync(path.join(GAS, app)).forEach(function (f) {
        if (/\.js$/.test(f)) defs += fs.readFileSync(path.join(GAS, app, f), 'utf8');
      });
    });
    check(defs.length > 0, 'قُرئ مصدر GAS فعلاً (فارغ = عمى لا نجاح)');
    var missing = names.filter(function (n) {
      return !new RegExp('function\\s+' + n + '\\s*\\(').test(defs);
    });
    check(missing.length === 0,
          '🔴 كلّ اسمٍ في `BH_LOGIN_FNS` له تعريفٌ حيّ في GAS' +
          (missing.length ? ' — الميّت: ' + missing.join(' · ') : ''));

    /* ═══ 🔴 الميزانية تُقارَن **حسابياً** عبر المستودعين لا برقمين منفصلين ═══
       الهامش بين أسوأ زمنٍ في الوركر ومهلة العميل ضاق إلى ثوانٍ معدودة، وكان يمرّ
       **بالصدفة**: حارس `SchoolApp-gas` يفحص `_LOGIN_TIMEOUT > 24000` — رقمٌ كُتب
       **قبل** نافذة الدخول أصلاً. رصدَته المراجعة (بند 113: معرّفٌ عند المستهلك قد
       يكون أضيق منه عند المنتج). الآن الطرفان يُقرآن ويُطرحان. */
    var cli = fs.readFileSync(
      path.join(GAS, 'teacher', '_js-platform-reviews.html'), 'utf8');
    var cliM  = /var _LOGIN_TIMEOUT\s*=\s*(\d+)/.exec(cli);
    var winM  = /var BH_LOGIN_WAIT_MS = (\d+);/.exec(src);
    var attM  = /var PER_ATTEMPT_TIMEOUT_MS = (\d+);/.exec(src);
    check(!!cliM && !!winM && !!attM,
          'قُرئت الثوابت الثلاثة من الطرفين (فشلُ الاستخراج = عمى لا نجاح)');
    if (cliM && winM && attM) {
      var worst  = Number(winM[1]) + Number(attM[1]);
      var margin = Number(cliM[1]) - worst;
      check(margin >= 2000,
            '🔴 أسوأ زمنٍ في الوركر (' + worst + 'ms) تحت مهلة العميل (' +
            cliM[1] + 'ms) بهامش ' + margin + 'ms ≥ 2000');
    }
  }
})();

console.log('');
console.log(failed === 0
  ? 'RESULT: ✅ ' + CASES.length + ' مساراً — التوجيه صحيح وصفر تعطيل لمسار قائم'
  : 'RESULT: ❌ ' + failed + ' فشل');
process.exit(failed === 0 ? 0 : 1);
