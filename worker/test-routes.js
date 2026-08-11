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
  ['/sitemap.xml',        '/sitemap.xml',        'ضابط: محجوز']
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

console.log('');
console.log(failed === 0
  ? 'RESULT: ✅ ' + CASES.length + ' مساراً — التوجيه صحيح وصفر تعطيل لمسار قائم'
  : 'RESULT: ❌ ' + failed + ' فشل');
process.exit(failed === 0 ? 0 : 1);
