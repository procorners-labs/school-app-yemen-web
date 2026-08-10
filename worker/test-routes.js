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
