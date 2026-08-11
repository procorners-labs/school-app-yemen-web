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

function resolve(p) {
  for (var i = 0; i < rewrites.length; i++) {
    if (p === rewrites[i].a || (rewrites[i].b !== null && p === rewrites[i].b)) return rewrites[i].to;
  }
  ctx.__p = p;
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
  ['/download',           '/download',           'ضابط: محجوز — لا يُقرَأ slug']
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
   ['/home/index.html', '', null,             CANON + '/abdaawatmuaz',
    'الشكل الطويل بلا معامل ⇒ الشكل القصير لمدرسة المالك (الفارغ = مدرسة المالك، بند 99)'],
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

// ── 🔴 slug غير منشور ⇒ 404 لا 200 ──────────────────────────────────────────
console.log('');
console.log('سطح الفهرسة اللانهائي (soft-404):');
[[/if \(_pathSlug && !_KNOWN_SCHOOL_SLUGS\[_pathSlug\]\)/, 'الـslug يُفحَص ضدّ السجلّ قبل إعادة الكتابة'],
 [/status: 404/, 'الحالة المُرجَعة 404 لا 200'],
 [/'X-Robots-Tag': 'noindex, follow'/, 'ورأس noindex معها (حزام وحمّالة)']
].forEach(function (c) {
  var good = c[0].test(src);
  if (!good) failed++;
  console.log((good ? '  ✅ ' : '  ❌ ') + c[1]);
});
// ضابط الاتجاه المعاكس: الـslugs المنشورة **لا** تُرجَع 404 — يقيسه جدول `_canonicalFor`
// أعلاه ضمناً (يُرجِع لها عنواناً صحيحاً)، ويؤكّده هنا أن الفحص مشروط بالنفي لا مطلق.
var guardIsConditional = /!_KNOWN_SCHOOL_SLUGS\[_pathSlug\]/.test(src) &&
                         /if \(_pathSlug\) path = '\/home\/index\.html';/.test(src);
if (!guardIsConditional) failed++;
console.log((guardIsConditional ? '  ✅ ' : '  ❌ ') +
            '🔴 ضابط: مسار الـslug المنشور لا يزال يُعاد كتابته كما كان (لا 404 شامل)');

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
  var fps = (stmt.target && stmt.target.sha256_cert_fingerprints) || [];
  check(fps.length >= 1 && /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fps[0]),
        'بصمة SHA-256 واحدة على الأقل وبالصيغة الصحيحة');
  check(Array.isArray(stmt.relation) &&
        stmt.relation.indexOf('delegate_permission/common.handle_all_urls') !== -1,
        'العلاقة `handle_all_urls` (‏App Links + WebAuthn معاً)');
}

console.log('');
console.log(failed === 0
  ? 'RESULT: ✅ ' + CASES.length + ' مساراً — التوجيه صحيح وصفر تعطيل لمسار قائم'
  : 'RESULT: ❌ ' + failed + ' فشل');
process.exit(failed === 0 ? 0 : 1);
