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

/* نزعُ التعليقات **واعياً بالسلاسل الحرفية** — أداةُ فحصٍ مشتركة.
   🔴 لا يُستبدَل بقناعٍ نمطيٍّ عامّ: `'https://…'` داخل سلسلةٍ يجعل القناعَ يبتلع
   بقيّةَ سطرِ كودٍ سليم، فيخضرُّ الفحصُ **بالمصادفة** لأنه لم يعد يقرأ ما ظنّ.
   ويُحرَس بضابطٍ ثلاثيِّ الأطراف عند أوّل مستهلكٍ له (وسيطُ الفيديو). */
function _stripComments(s) {
  var out = '', i = 0, n = s.length, q = null, e;
  while (i < n) {
    var c = s.charAt(i), d = s.charAt(i + 1);
    if (q) {                                   // داخل سلسلة: لا تعليقَ ولا نهايةَ إلّا بالمُغلِق
      if (c === '\\') { out += c + d; i += 2; continue; }
      if (c === q) q = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && d === '*') { e = s.indexOf('*' + '/', i + 2); i = (e < 0 ? n : e + 2); out += ' '; continue; }
    if (c === '/' && d === '/') { e = s.indexOf('\n', i); i = (e < 0 ? n : e); out += ' '; continue; }
    out += c; i++;
  }
  return out;
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
  ['/register',           '/register',           'ضابط: محجوز — لا يُقرَأ slug (يُحوَّل 301 أدناه)'],
  ['/assets/sw.js',       '/assets/sw.js',       'ضابط: أصل ثابت'],
  ['/sitemap.xml',        '/sitemap.xml',        'ضابط: محجوز'],
  // ‏`app`/`download` محجوزان ⇒ لا يُقرآن slug مدرسة. (سلوكهما الفعلي 302 يُقاس
  //  سلوكياً أدناه — هذا الجدول يصف إعادة الكتابة وحدها ولا يرى العودة المبكرة.)
  ['/app',                '/app',                'ضابط: محجوز — لا يُقرَأ slug'],
  ['/download',           '/download',           'ضابط: محجوز — لا يُقرَأ slug'],
  // ‏`schedule` — المشروع يُحذف من `SchoolApp-gas` والمسارُ يبقى صفحةً ثابتة (2026-09-05).
  //  الحالتان تُثبتان أن **التوجيه عامّ**: لا إعادة كتابة ولا قراءة slug ⇒ الاثنان يخرجان
  //  كما هما إلى `GITHUB_BASE`. وعقدُ بقاء الحجز في كتلته المستقلّة أدناه.
  ['/schedule',           '/schedule',           'ضابط: محجوز — لا يُقرَأ slug'],
  ['/schedule/index.html','/schedule/index.html','ضابط: المسار المجمَّد في الـAPK يُخدَم كما هو'],

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
  /* ⚠️ المرساةُ **بادئةٌ بلا شرطٍ ولا قوس ختام** عمداً: كانت
     `'if (REDIRECT_TO_CANONICAL[url.hostname]) {'` حرفياً، فلمّا أُضيف استثناءُ
     `/.well-known/` إلى نفس السطر (2026-09-01) سقطت المرساةُ وأخفق الاختبار.
     🟢 وذلك **سلوكٌ صحيح** — الحارسُ أمسك تغييراً في الفرع الذي يحرسه؛ والمرساةُ
     الأضيق كانت ستُبقيه أخضرَ لو تخطّى بدل أن يُخفق. */
  var _wwwBranchIdx = src.indexOf('if (REDIRECT_TO_CANONICAL[url.hostname]');
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

    /* 🔴 **`/.well-known/` مُعفى من التحويل — مقيسٌ 2026-09-01:**
       المانيفستُ المنشور يعلن `www.yemenschoolz.com` بـ`autoVerify`، وتحقّقُ
       Digital Asset Links **لا يتبع التحويلات**. وكان `www/.well-known/assetlinks.json`
       يردّ **301 بجسمٍ فارغ** بينما الجذرُ يردّ 200 ⇒ تحقّقُ ذلك المضيف يفشل **صامتاً**.
       ⇒ الإعفاءُ **بادئةٌ حرفية** لا `indexOf > -1`: الضوابطُ الثلاثة أدناه هي ما يفرّق
       بين الاثنين، وبلاها يمرّ «يحتوي» أخضرَ وهو يفتح ثقباً في التحويل كلِّه. */
    [['/.well-known/assetlinks.json', null, '🔴 `‏/.well-known/assetlinks.json` من `www` ⇒ **لا تحويل** (يُخدَم 200)'],
     ['/.well-known/anything',        null, 'كلُّ ما تحت `/.well-known/` معفىً — لا الملفُّ وحده'],
     // ── ضوابط الاتجاه المعاكس: بلاها يمرّ الإعفاءُ الفضفاض أخضرَ ──
     ['/',                            301,  'ضابط: جذرُ `www` ما زال يُحوَّل'],
     ['/home/index.html',             301,  'ضابط: صفحاتُ `www` ما زالت تُحوَّل'],
     ['/well-known/assetlinks.json',  301,  'ضابط 🔒: بلا نقطةٍ بادئة ⇒ يُحوَّل (المطابقةُ حرفية)'],
     ['/x/.well-known/assetlinks.json', 301, 'ضابط 🔒: بادئةٌ لا تضمين ⇒ مسارٌ داخليّ يُحوَّل']
    ].forEach(function (c) {
      var r = mctx.__run('GET', c[0], '');
      var got = r ? r.status : null;
      var good = (got === c[1]);
      if (!good) failed++;
      console.log((good ? '  ✅ ' : '  ❌ ') + c[2] + '  [' + c[0] + ' → ' +
                  (r ? r.status : 'لا تحويل') + ']');
    });
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
/* 🔴 **الرأسان صارا حالتين مختلفتين 2026-09-10 — وكان فحصٌ واحدٌ يدّعيهما ويفرض واحداً.**
 *
 * العلّةُ المكتشَفة: كان الفحصُ موسوماً «CSP وX-Frame-Options تبقيان محذوفتين» **ولا يفحص
 * `headers.set('X-Frame-Options'` إطلاقاً** — فحين أُعيد الرأسُ فعلاً **بقي أخضر**.
 * 🎯 **وسمٌ يدّعي شرطين ويفرض واحداً — والقارئُ يقرأ الوسمَ لا الشرط.** وهي فئةُ «حارسٌ يبدو
 *    شاملاً»: الشقُّ المفروضُ صحيحٌ فيُكسب الفحصَ ثقةً لا يستحقّها شقُّه الآخر.
 *
 * والحالُ الآن — شرطان مستقلّان لا شرطٌ مزدوج:
 *   ① **`x-frame-options` يُحذف من ردّ المنبع ثمّ يُضبَط بقيمتنا** — والترتيبُ جوهريّ:
 *      `delete` عند المنبع (‏~2211) ثمّ `set` (‏~2263) ⇒ **يُفحَص موضعُهما لا وجودُهما.**
 *   ② **و`content-security-policy` تبقى محذوفةً ولا تُضبَط** — دَينٌ مُعلَنٌ (بندُ
 *      `csp-absent-on-worker-responses`)، **وإضافتُها الصامتةُ تكسر صفحاتٍ سكربتاتُها
 *      مضمَّنةٌ بكثافة** ⇒ الفحصُ يحمي من إضافةٍ متعجّلة كما يحمي من حذفٍ متعجّل. */
(function () {
  var xDel = src.indexOf("headers.delete('x-frame-options')");
  var xSet = src.search(/headers\.set\('X-Frame-Options',\s*'SAMEORIGIN'\)/);
  var okX = xDel !== -1 && xSet !== -1 && xSet > xDel;
  if (!okX) failed++;
  console.log((okX ? '  ✅ ' : '  ❌ ') +
    '🔒 `X-Frame-Options: SAMEORIGIN` مضبوطٌ **بعد** حذف رأس المنبع [delete@' +
    xDel + ' set@' + xSet + ']');

  /* 🔴 **صُحِّح 2026-09-11 — وكان الفحصُ السابقُ يمرّ خضراءَ على تغييرٍ يناقض وسمَه.**
   * كان يزعم «CSP تبقى محذوفةً **وغيرَ مضبوطة**» بنمطٍ `headers.set('Content-Security-Policy'`
   * — **والاقتباسُ بعد `Policy` يمنعه من مطابقة `…-Report-Only'`** ⇒ نُشرت سياسةُ الإبلاغ
   * **وبقي الفحصُ أخضرَ ووسمُه كاذباً**. 🎯 وهي فئةُ «حارسٌ يفحص صيغةً لا حالة».
   *
   * والحالُ الآن **أربعةُ أقطابٍ مستقلّة، وسقوطُ أيٍّ منها يُحمِّر**:
   *   ① `Content-Security-Policy-Report-Only` **مضبوطة** — وإلّا فلا سياسةَ أصلاً.
   *   ② و`Content-Security-Policy` النافذةُ **مضبوطةٌ ومقصورةٌ على المجموعة الآمنة**.
   *      🔴 **ضُيِّق القطبُ 2026-09-20 ولم يُسقَط — والفرقُ جوهريّ:** كان يشترط **غيابَ**
   *      النافذة، وعلّتُه المكتوبةُ «سياسةٌ نافذةٌ تكسر صفحاتٍ سكربتاتُها مضمَّنةٌ بكثافة».
   *      **وتلك العلّةُ تخصّ التوجيهاتِ المشروطةَ بقائمةِ مصادرَ وحدَها** — والقائمةُ عندنا
   *      **أخفقت مرّتين في يومٍ واحد** (‏09-11) لأن GA4 يوجّه إلى نقطةٍ إقليميّةٍ مشتقّةٍ من
   *      موقع الزائر ⇒ **الإخفاقُ الثالثُ يقع عند مستخدمٍ لا عندنا.**
   *      ⇒ **فالمشروطُ بقائمةٍ يبقى في `Report-Only`، وما لا يحتاج قائمةً يُفرَض.**
   *      🎯 **والمُختبَرُ الآن مضمونُ النافذة لا وجودُها:** حضورُ الأربعة الآمنة **وغيابُ**
   *      كلِّ توجيهٍ يحمل قائمةَ مضيفات. **وإسقاطُ القطب كان سيفتح البابَ لـ`script-src`
   *      نافذةً بلا أيّ حارس** — وهو بعينه ما وُضع ليمنعه.
   *   ③ و`report-uri` **موصولٌ بمعالجٍ قائم** — 🔴 **وهذا القطبُ هو جوهرُ الفحص:**
   *      `Report-Only` بلا وجهةٍ تُسجّل **زينةٌ لا حارس**، ولا يُكتشَف غيابُها بالنظر.
   *   ④ و`'csp-report'` **محجوزٌ في `_RESERVED_TOP_PATHS`** — إسقاطُه يجعل المسارَ
   *      مرشَّحَ slug مدرسةٍ فيصير قابلاً للاختطاف.
   *   ⑤ 🟢 **وعائلتا GA4 مغطّاتان ببدلٍ لا باسم** (أُضيف 2026-09-11 بعد انتكاسةٍ مقيسة):
   *      GA4 يوجّه `/g/collect` إلى نقطةٍ **إقليميّة** (‏`region1.` · `region2.` · …) مشتقّةٍ
   *      من موقع الزائر ⇒ **قائمةُ أسماءٍ مجرّدةٍ تُخالَف بأوّل زائرٍ من إقليمٍ لم نره.**
   *      🎯 **والفئةُ: قائمةٌ تُعدِّد _ما رأيناه_ لا _ما يمكن أن يقع_** — تبدو مكتملةً لأن
   *      العيّنةَ من إقليمٍ واحد. **والفحصُ يمنع الانتكاسَ إلى التعداد**، لا يضيف مضيفاً.
   *      ⚠️ **ولا يُقبل `*.google.com`** — يبتلع نطاقاتٍ لا علاقةَ لها بالقياس؛ ولذلك
   *      يُطابَق البدلُ على **العائلتين بعينهما** لا على أيّ بدلٍ كان.
   * ⚠️ ويبقى `delete('content-security-policy')` مفروضاً: رأسُ المنبع يُحذف ثمّ يُضبَط رأسُنا. */
  var cDel = /headers\.delete\('content-security-policy'\)/.test(src);
  var cRep = /headers\.set\('Content-Security-Policy-Report-Only'/.test(src);
  var cEnf = /headers\.set\('Content-Security-Policy'\s*,/.test(src);
  var cUri = /report-uri \/csp-report/.test(src);
  var cHnd = /path === '\/csp-report'/.test(src);
  var cRes = /'csp-report':\s*1/.test(src);
  var cGaW = /"connect-src[^"]*https:\/\/\*\.google-analytics\.com/.test(src);
  var cGaA = /"connect-src[^"]*https:\/\/\*\.analytics\.google\.com/.test(src);
  /* 🔒 مضمونُ النافذة: تُستخرَج كتلتُها من المصدر ويُقاس **ما فيها وما ليس فيها**.
     🔴 والقائمةُ السوداءُ هي الحارسُ الحقيقيُّ هنا — كلُّ توجيهٍ يحمل قائمةَ مضيفات. */
  /* 🔴 **تُنزَع التعليقاتُ قبل الفحص — وهذا ليس تجميلاً بل إصلاحُ إيجابيّةٍ كاذبةٍ وقعت
     فعلاً 2026-09-20:** التعليقُ المرافقُ داخل المصفوفة يذكر `connect-src` بالاسم (يشرح
     **لماذا** لا تُفرَض)، فقرأه المِجَسُّ **توجيهاً متسرّباً** وأحمرَّ على كودٍ سليم.
     🎯 **والفئةُ نفسُها التي يطاردها هذا الملفّ: مِجَسٌّ يُجيب عن «أالكلمةُ في النصّ؟»
     بينما السؤالُ «أالتوجيهُ مُفعَّل؟».** ⚠️ **وخبثُها أنها كانت كامنةً لا ظاهرة:** بلا
     تعليقٍ يذكر الاسمَ يبقى الحارسُ أخضرَ سنواتٍ، **ويُفعَّل العيبُ بنصٍّ لا بكود.** */
  var enfM = _stripComments(src).match(/headers\.set\('Content-Security-Policy'\s*,\s*\[([\s\S]*?)\]\.join/);
  var enfBlock = enfM ? enfM[1] : '';
  var ENF_MUST = ["base-uri 'self'", "object-src 'none'", "form-action 'self'", "frame-ancestors 'self'"];
  var ENF_FORBID = ['default-src', 'script-src', 'style-src', 'connect-src',
                    'img-src', 'font-src', 'media-src', 'frame-src'];
  var enfHas = ENF_MUST.every(function (d) { return enfBlock.indexOf(d) !== -1; });
  var enfLeak = ENF_FORBID.filter(function (d) { return enfBlock.indexOf(d) !== -1; });
  var enfSafe = !!enfM && enfHas && enfLeak.length === 0;

  var okC = cDel && cRep && cEnf && enfSafe && cUri && cHnd && cRes && cGaW && cGaA;
  if (!okC) failed++;
  console.log((okC ? '  ✅ ' : '  ❌ ') +
    '🔒 النافذةُ مقصورةٌ على المجموعة الآمنة · والإبلاغُ موصولٌ بمعالجٍ قائم · والمسارُ محجوز · وعائلتا GA4 ببدل [del=' + cDel +
    ' report-only=' + cRep + ' enforced=' + cEnf + ' enf-safe=' + enfSafe + ' uri=' + cUri +
    ' handler=' + cHnd + ' reserved=' + cRes +
    ' ga-wild=' + cGaW + ' ga-analytics-wild=' + cGaA + ']');
  /* 🔴 **ضابطٌ معاكسٌ صريحٌ ومنفصل — وهو الذي يمنع الانزلاقَ الحقيقيّ:** لو تسرّب توجيهٌ
     مشروطٌ بقائمةٍ إلى النافذة (‏`script-src` مثلاً) لَظلّ `enforced=true` و`enf-safe`
     وحدَه هو ما يسقط. ⇒ **يُطبَع المتسرّبُ بالاسم** كي يُقرأ السببُ لا الرمز. */
  if (enfLeak.length) {
    console.log('  ❌ 🔴 توجيهٌ مشروطٌ بقائمةِ مصادرَ تسرّب إلى النافذة: ' + enfLeak.join(' · ') +
                ' — موضعُه `Report-Only` (القائمةُ أخفقت مرّتين في يومٍ واحد)');
  }

  /* ③ 🗑️ **`GAS.pricing` مدخلٌ خاملٌ — صفرُ قارئ.** التعليقُ عند الجدول يَعِد بأن «أثرَ
   *    بقائه صفرٌ يحرسه فحص» — وهذا هو. والمدخلُ باقٍ لأن `protect-deploy-ids` حجب
   *    حذفَه بحقّ (يقرأ **مجموعةَ** المعرّفات ولا يميّز الخاملَ من الحيّ).
   * 🔴 **والقيمةُ الحقيقيّةُ للفحص عكسيّة:** لو أُعيد استعمالُ `GAS.pricing` يوماً بلا
   *    إعادةِ المعالج، لكان **مساراً نصفَ حيٍّ** — والفحصُ يحمرّ فيُظهره.
   * ⚠️ ويُستثنى التعليقُ قبل العدّ، وإلّا عدّ الفحصُ ذكرَ الاسم في شاهدة القبر نفسِها
   *    (‏فئةُ «`grep` يجد العبارةَ المُدانةَ في تصحيحها») — **وقع فعلاً في أوّل تشغيلة.**
   * 🔴 **ولا يُستعمل `_stripComments` هنا — وسببُه مقيسٌ لا مفترَض:** جرّبتُه على خمس
   *    حالاتٍ دنيا (سطريّ · كتليّ · متعدّدُ الأسطر · عربيّ · وفيه اقتباسٌ مفرد) ⇒ **نزعها
   *    كلَّها**؛ ومع ذلك **يترك شاهدةَ القبر عند ~س1800 كما هي**، وصفرُ اقتباسٍ غيرِ متوازنٍ
   *    في تعليقاتي (قِيس سطراً سطراً). ⇒ **العلّةُ سابقةٌ في تتبّع حالة السلاسل عند هذا
   *    الموضع من الملفّ، لا في التعليق المضاف** — ولا تُطارَد من هنا: النازعُ **بنيةٌ
   *    مشتركةٌ لها ضابطُها الثلاثيّ**، وتعديلُه لأجل فحصٍ واحدٍ يخاطر بمستهلكيه.
   * 🟢 **فالعدُّ على الأسطر غيرِ التعليقية — قاعدةٌ مستقلّةٌ عن موضع السطر في الملفّ**،
   *    وهي الصيغةُ المستعملةُ في حرّاسٍ أخرى بهذا المستودع. */
  var readers = src.split(/\r?\n/).filter(function (ln) {
    var t = ln.trim();
    if (t.indexOf('//') === 0 || t.indexOf('*') === 0 || t.indexOf('/*') === 0) return false;
    return ln.indexOf('GAS.pricing') !== -1;
  }).length;
  var okP = readers === 0;
  if (!okP) failed++;
  console.log((okP ? '  ✅ ' : '  ❌ ') +
    '🗑️ صفرُ قارئٍ لـ`GAS.pricing` في الكود (لا التعليق) — مدخلٌ خاملٌ لا مسارٌ نصفُ حيّ [' +
    readers + ']');
})();

/* ── 🔴 حقلُ `why` — سببُ الإخفاق مبنيَّ الشكل لا نصّاً عربياً (2026-09-10) ────────
 *
 * **العلّةُ التي يغلقها، وقعت اليوم:** كان الوركرُ يميّز «أجهضتُ» من «المنبعُ أخطأ»
 * **بنصّ الجسم العربيّ وحدَه** ⇒ **كلُّ ٥٠٢ سواءٌ في السجلّ** ⇒ بُحث عن العطل في المنبع
 * ثلاثَ مرّاتٍ والمنبعُ سليم. والفرقُ عمليّ: `abort_budget` ⇒ زمنُ GAS/الميزانية ·
 * `upstream_*` ⇒ كودُ GAS · `transport` ⇒ الشبكة — **ثلاثةُ مستودعاتٍ برمزٍ واحد.**
 *
 * 🔴 **ولماذا نصّيٌّ هنا لا سلوكيّ — يُقال بحدّه:** الفرزُ يقع داخل `fetch`/`catch` ولا
 * يُشغَّل بـ`vm` بلا شبكةٍ ومنبعٍ حقيقيّين. ⇒ **تُفحَص الأطرافُ الأربعةُ نصّاً**، ومعها
 * **ضوابطُ ربطٍ** تُثبت أن الحقلَ **يصل السجلَّ** وأن **الجسمَ لم يتغيّر** — وهما ما
 * يُخفيه الفحصُ النصّيُّ الساذج.
 * 🎯 **والقيمةُ الحقيقيّة: يُغلق «صفرُ تمييزٍ» لا «صفرُ ذكرٍ»** — أي أن أيَّ حذفٍ لأحد
 *    الأطراف يُحمّر، لا أن الكلمةَ مكتوبةٌ في مكانٍ ما. */
console.log('');
console.log('حقلُ `why` في سجلّ `ev:gas` (نصّيٌّ بحدّه · مع ضوابطِ ربط):');
(function () {
  var wIdx = src.indexOf("_bhLog({ ev: 'gas'");
  check(wIdx !== -1, 'ضابط: سطرُ سجلّ `gas` موجود');
  if (wIdx === -1) return;
  var wLine = src.slice(wIdx, src.indexOf('});', wIdx) + 3);

  /* ① الحقلُ يصل السجلَّ فعلاً — وهو ما يميّز «مُحتسَبٌ» من «مُسجَّل». */
  check(/\bwhy:\s*_bhWhy\b/.test(wLine),
        '🔴 `why: _bhWhy` **داخل سطر السجلّ** — لا محسوبٌ ثمّ مُهمَل');

  /* ② الأطرافُ الأربعةُ مُسنَدةٌ كلُّها — وحذفُ أحدها يُحمّر. */
  [['abort_budget', 'إجهاضُ ميزانية'],
   ['transport', 'فشلُ نقل'],
   ['upstream_html', 'اعتراضُ صفحةٍ من المنبع'],
   ['upstream_status', 'خطأُ حالةٍ من المنبع']
  ].forEach(function (c) {
    var ok = new RegExp("_bhWhy\\s*=\\s*[^;]*'" + c[0] + "'").test(src);
    if (!ok) failed++;
    console.log((ok ? '  ✅ ' : '  ❌ ') + '🔴 طرفٌ مُسنَد: `' + c[0] + '` — ' + c[1]);
  });

  /* ③ 🔒 الضابطُ المعاكسُ الحاسم: التمييزُ من **علَمِ المؤقّت** لا من نوع الخطأ.
     `err.name === 'AbortError'` يخلط إجهاضَنا بقطعِ العميل، وعلاجُهما متعاكس. */
  check(/_bhWhy\s*=\s*timedOut\s*\?/.test(src),
        '🔒 ضابط معاكس: الإجهاضُ يُميَّز بـ`timedOut` لا بـ`err.name`');

  /* ④ 🔒 وضابطٌ يمنع تسرُّبَ التغيير إلى العميل: الجسمُ لم يُمَسّ.
     أيُّ إضافةٍ لـ`why` **داخل الجسم** تُغيّر عقداً يقرؤه APK منشور. */
  var bodyLeak = /error:\s*[^,}]*_bhWhy|JSON\.stringify\([^)]*_bhWhy/.test(src);
  if (bodyLeak) failed++;
  console.log((bodyLeak ? '  ❌ ' : '  ✅ ') +
    '🔒 ضابط معاكس: `_bhWhy` **لا يدخل جسمَ الردّ** — عقدُ العميل والـAPK لم يُمَسّ');
})();

/* ── 🔴 إسنادُ اسم الدالّة في السجلّ — سلوكيٌّ لا نصّيّ (2026-09-10) ──────────────
 *
 * **العلّةُ التي يغلقها:** كان النمطُ `[A-Za-z][A-Za-z0-9]{0,63}` **يستثني `_`** ⇒ كلُّ
 * دالّةٍ فيها شرطةٌ سفلية تُسجَّل بـ`fn` فارغاً ⇒ **تسقط من أيّ تجميعٍ بـ`fn`**.
 * ⚠️ **والشاهدُ ميدانيّ:** سجلُّ متصفّح المالك أظهر `smm_loadPlan` و`smm_loadAccounts`
 *    تُخفقان بـ502، **وكلتاهما غائبةٌ عن تجميع `fn`** في نفس النافذة.
 * 🎯 **ولماذا سلوكيٌّ لا نصّيّ:** فحصٌ نصّيٌّ على النمط يُثبت أن `_` **مكتوبةٌ فيه**، ولا
 *    يُثبت أن الاستخراجَ **ينجح**؛ والطفرةُ التي تعيد النمطَ القديم تمرّ خضراءَ لو كان
 *    الفحصُ يبحث عن حرفٍ في سلسلة. ⇒ **يُشغَّل الاستخراجُ على حمولةٍ حقيقية.**
 * 🔒 **وضابطٌ معاكسٌ إلزاميّ:** القائمةُ بيضاءُ لمنع الحقن ⇒ يُثبَت أنها **ما زالت ترفض**
 *    الاقتباسَ والسطرَ الجديد والمحارفَ الخاصّة — وإلّا صار «الإصلاح» بابَ حقنٍ في السجلّ. */
console.log('');
console.log('إسنادُ اسم الدالّة في السجلّ (سلوكي عبر `vm`):');
(function () {
  /* 🔴 غيرُ نَهِمٍ حتى `/)` — النمطُ نفسُه يحوي `)` (مجموعةُ الالتقاط)، فتعبيرٌ نَهِمٌ أو
     `[^)]+` **يقطعه في منتصفه** فيُرمى `Invalid regular expression`. وقع فعلاً. */
  var m = src.match(/_bhHead\.match\((\/"fn".*?\/)\)/);
  check(!!m, 'ضابط: استُخرج نمطُ اسم الدالّة من المصدر');
  if (!m) return;
  var pctx = vm.createContext({});
  vm.runInContext('var RE = ' + m[1] + ';', pctx);
  function pick(body) {
    pctx.__b = body;
    return vm.runInContext('(function(){var x=String(__b).slice(0,200).match(RE);return x?x[1]:"";})()', pctx);
  }

  /* ① الحالةُ التي كانت تسقط — وهي بأسماءٍ حقيقيّةٍ من بلاغ المالك. */
  [['smm_loadPlan', '{"fn":"smm_loadPlan","args":[]}'],
   ['smm_loadAccounts', '{"fn":"smm_loadAccounts","args":[1]}'],
   ['tc_getActivities', '{"fn":"tc_getActivities","args":[]}']
  ].forEach(function (c) {
    var got = pick(c[1]);
    var ok = got === c[0];
    if (!ok) failed++;
    console.log((ok ? '  ✅ ' : '  ❌ ') + '🔴 اسمٌ فيه `_` يُستخرَج: `' + c[0] + '` [' + (got || 'فارغ — فقدُ إسناد') + ']');
  });

  /* ② ضابطٌ موجب: الأسماءُ بلا شرطةٍ لم تُكسَر. */
  var plain = pick('{"fn":"getHomePageBundle","args":[]}');
  check(plain === 'getHomePageBundle', '🔒 ضابط موجب: الاسمُ العاديُّ ما زال يُستخرَج [' + plain + ']');

  /* ②-ب ⚠️ **حدٌّ مُعلَنٌ لا عطبٌ مسكوتٌ عنه: الشرطةُ السفليةُ في **البادئة** لا تُستخرَج.**
     النمطُ يشترط حرفاً أوّلَ ⇒ `_stuGetSheet` تُسجَّل فارغةً. **ولم يُوسَّع عمداً:** بادئةُ
     `_` هي **عرفُ الدالّة الخاصّة** في مصدر GAS، والجسرُ ينادي العامَّ وحدَه ⇒ **حالةٌ لم
     تُقَس على السلك، ولا تُوسَّع قائمةٌ بيضاءُ لحالةٍ لم تُقَس.**
     🔴 **ويُثبَت الحدُّ بفحصٍ لا يُترك ضمنياً** — وإلّا قرأه لاحقٌ عطباً فوسّع القائمةَ بلا موجب،
     أو ظنّ الإسنادَ شاملاً وهو ليس كذلك. **وإن ظهر يوماً نداءٌ حقيقيٌّ ببادئة `_` فهذا
     الفحصُ هو موضعُ تغيير القرار.** */
  var lead = pick('{"fn":"_stuGetSheet","args":[]}');
  check(lead === '', '⚠️ حدٌّ مُعلَن: بادئةُ `_` لا تُستخرَج — عرفُ الدالّة الخاصّة، لم يُقَس على السلك [' +
                    (lead || 'فارغ') + ']');

  /* ③ 🔒 الضابطُ المعاكسُ الأمنيّ — القائمةُ ما زالت بيضاء. */
  [['اقتباسٌ مزدوج', '{"fn":"a\\"b","args":[]}'],
   ['سطرٌ جديد', '{"fn":"a\\nb","args":[]}'],
   ['شرطةٌ عادية', '{"fn":"a-b","args":[]}'],
   ['نقطة', '{"fn":"a.b","args":[]}'],
   ['بادئةٌ رقمية', '{"fn":"1abc","args":[]}']
  ].forEach(function (c) {
    var got = pick(c[1]);
    /* المطلوب: لا يُقبَل المحرفُ الخاصّ — فإمّا فراغٌ أو مقطعٌ نظيفٌ قبله، ولا يتسرّب هو. */
    var leaked = /["\n\r\-.]/.test(got);
    if (leaked) failed++;
    console.log((leaked ? '  ❌ ' : '  ✅ ') + '🔒 لا يتسرّب ' + c[0] + ' إلى السجلّ [' + (got || 'فارغ') + ']');
  });
})();

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
   /* 🟢 **انقلب 2026-09-03 بقرار المالك** (الهوية على السطوح الثلاثة). كان هنا:
      «بوّابة المعلّم ⇒ لا مفتاح مهما حمل المعامل — الحقن لـ`home` وحده».
      ولا يُقرأ ذلك ترخيصاً عامّاً: البوّابة الشكلية كما هي (slug منشور أو UUID)،
      والحالات المعاكسة أدناه تحرس أن الجذر وصفحة المكتبة ما زالا خطّاً أحمر. */
   ['/teacher/index.html', '?school=' + EB,       EB.toLowerCase(),
    '🟢 بوّابة المعلّم بمعامل صريح ⇒ مفتاح (رأسُ الدخول يُطلى خادمياً)'],
   ['/student/index.html', '?school=' + EB,       EB.toLowerCase(),
    '🟢 بوّابة الطالب بمعامل صريح ⇒ مفتاح'],
   ['/portal', '?school=' + EB,                   EB.toLowerCase(),
    '🟢 `/portal` (اسمٌ مستعار لبوّابة الطالب) ⇒ مفتاح'],
   ['/teacher/login/ibn-khaldoun', '',            'ibn-khaldoun',
    '🟢 المقطع الثاني في المسار العميق ⇒ مفتاح (‏`/teacher/login/<slug>`)'],
   ['/student/grades/' + EB, '',                  EB.toLowerCase(),
    '🟢 والمقطع الثاني يقبل UUID أيضاً'],
   ['/teacher/login/not-a-school', '',            '',
    '🔴 ضابط معاكس: slug غير منشور في المقطع الثاني ⇒ لا مفتاح'],
   ['/teacher/login', '',                         '',
    '🔴 مقطعٌ واحد = تبويبٌ لا مدرسة ⇒ لا مفتاح (‏`login` ليس مستأجراً)'],
   /* 🟢 2026-09-17 «نافذةٌ واحدة»: المقطعُ الواحد **slug منشور أو UUID** ⇒ مدرسة.
      والضوابطُ المعاكسة: اسمُ قسمٍ وslugٌ غيرُ منشور يبقيان بلا مفتاح. */
   ['/teacher/ibn-khaldoun', '',                  'ibn-khaldoun',
    '🟢 `/teacher/<slug>` بمقطعٍ واحد ⇒ مفتاح (كان شاشةَ «اختر مدرستك»)'],
   ['/student/ibn-khaldoun/', '',                 'ibn-khaldoun',
    '🟢 و`/student/<slug>/` بشرطةٍ ختامية ⇒ مفتاح'],
   ['/teacher/' + EB, '',                         EB.toLowerCase(),
    '🟢 والمقطعُ الواحد يقبل UUID'],
   ['/teacher/visits', '',                        '',
    '🔴 ضابط معاكس: اسمُ قسمٍ بمقطعٍ واحد ⇒ لا مفتاح'],
   ['/teacher/not-a-school', '',                  '',
    '🔴 ضابط معاكس: slug غير منشور بمقطعٍ واحد ⇒ لا مفتاح'],
   ['/teacher/index.html', '?school=../../etc',   '',
    '🔴 والبوّابة الشكلية تسري على السطوح الجديدة حرفياً'],
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

  /* 🟢 **2026-09-19 — مدرسةٌ خارج البذرة عبر السجلّ الديناميكيّ** (الوسيطُ الثالث).
     المقيس (جلسة `SchoolApp-gas`): مديرُ مدرسةٍ جديدة يفتح `/teacher/<slug>` فيهبط على دخول
     مدرسةٍ أخرى لأن `norm` كانت تعرف البذرةَ الثلاثية وحدَها. */
  var tkf = vm.runInContext('_tenantKeyFrom', tctx);
  var DYN = ['new-school'];
  [['/teacher/new-school', '', DYN, 'new-school', '🟢 `/teacher/<slug>` لمدرسةٍ جديدةٍ في السجلّ ⇒ مفتاح'],
   ['/student/grades/new-school', '', DYN, 'new-school', '🟢 والمسارُ العميق للطالب ⇒ مفتاح'],
   ['/home/index.html', '?school=new-school', DYN, 'new-school', '🟢 و`?school=<slug>` الجديد ⇒ مفتاح'],
   ['/teacher/new-school', '', null, '', '🔴 ضابط معاكس: بلا سجلٍّ ⇒ السلوكُ القديم (لا مفتاح)'],
   ['/teacher/visits', '', DYN, '', '🔴 ضابط معاكس: اسمُ قسمٍ غيرُ مسجَّل ما زال بلا مفتاح'],
   ['/teacher/login', '', ['login'], 'login', '⚠️ حدٌّ موثَّق: slug مدرسةٍ باسم قسمٍ يُقرأ مدرسةً — المنعُ عند التسجيل'],
   ['/home/schools.html', '?school=new-school', DYN, '', '🔴 الجذرُ خطٌّ أحمر ولو كان الـslug في السجلّ']
  ].forEach(function (c) {
    var got = tkf(c[0], c[1], c[2]);
    var good = (got === c[3]);
    if (!good) failed++;
    console.log((good ? '  ✅ ' : '  ❌ ') + c[4] + '\n       [' + got + ']');
  });
  var dynWired = /_tenantKey = _tenantKeyFrom\(_rawPath, url\.search, _dynSlugs\)/.test(src) &&
                 /var _dynSlugs = await _slugsFromCache\(url\.origin\)/.test(src);
  if (!dynWired) failed++;
  console.log((dynWired ? '  ✅ ' : '  ❌ ') + '🔴 بنيوي: السجلُّ الديناميكيُّ موصولٌ في مسار الطلب (قراءةُ كاشٍ لا GAS)');

  // ضابط بنيوي: الحقن يستهلك `_tenantKey` لا `_pathSlug` — وإلّا بقي السطح بلا علاج
  // بينما كلّ ما سبق أخضر (نفس فئة «حارسٌ يفحص وجود الشرط دون أثره»، بند 137).
  // ⚠️ **تحرّكت المرساة لا الضمانة (‏2026-08-26):** حلُّ الهوية نُقل إلى ما **قبل** كتلة
  //    إعادة الكتابة لأن بصمة الهوية صارت جزءاً من المُصادِق المركّب (‏`_pageEtag`)، فتُقرأ
  //    مرّةً وتُستهلَك في الموضعين. الادّعاء نفسه: السلسلة تستهلك `_tenantKey` لا `_pathSlug`.
  var usesKey = /_brandFromCache\(url\.origin, _tenantKey\)/.test(src) &&
                /_brandRefresh\(url\.origin, _tenantKey, env\)/.test(src) &&
                /_tenantKey && !_newsId/.test(src);
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

  // 🔴 **انقلب 2026-09-18:** كان هذا الفحصُ يفرض `''` للمالك — وصار يمنعه. قرارُ المالك
  //    «لا مدرسةَ مالك» أسقط القاعدةَ المقابلة في `home/Index.html` (‏gas #1604/#1607)،
  //    فصار الفراغُ هنا وحدَه يُعري روابطَ بوّابات مدرسة المالك. ⇒ الشكلُ الواحد UUID للجميع.
  //    فحصٌ نصّي لأن الفرع داخل `_brandRefresh` لا دالّة نقيّة؛ والنمطُ يلتقط أيَّ فرعٍ على
  //    `isOwner` في سطر `schoolId:` لا الصيغةَ القديمة حرفياً وحدَها.
  var ownerBlank = /schoolId:[^\n]*isOwner/.test(src);
  if (ownerBlank) failed++;
  console.log((!ownerBlank ? '  ✅ ' : '  ❌ ') +
              '🔴 لا استثناءَ للمالك في `schoolId` المُخبَّأ — UUID للجميع (قرار «لا مدرسةَ مالك»)');
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

// ── 🔴 الشكلُ العاري من المسار `/home` و`/home/` (2026-09-15) ────────────────
//
// الفجوة التي يقفلها: البوّابةُ أعلاه مشروطةٌ بـ`(index|news).html` ⇒ **`/home` العاري
// لا يطابقها**، وPages يخدم فهرسَ المجلد فيصل نفسُ الملفّ بلا بوّابة. قياسٌ حيّ
// 2026-09-15: `/home` و`/home/` ⇒ **200 · 210,209 بايت · md5 متطابق**، بينما
// `/home/index.html` ⇒ **302**. ⇒ نفسُ الحالة المُغلَقة في 08-14 من مدخلٍ آخر.
console.log('');
console.log('الشكل العاري من المسار (`/home` · `/home/`):');
var bareNorm = /if \(path === '\/home' \|\| path === '\/home\/'\) path = '\/home\/index\.html';/;
var bareOk = bareNorm.test(src);
if (!bareOk) failed++;
console.log((bareOk ? '  ✅ ' : '  ❌ ') +
            '🔴 `/home` و`/home/` تُطبَّعان إلى `/home/index.html` — تطبيعٌ لا تحويل (يُبقي حاملَ المعرّف مخدوماً)');

// 🔴 **ضابط معاكس قابلٌ للإفشال — والترتيبُ هو المُختبَر لا الوجود:** سطرُ التطبيع
//    **عديمُ الأثر تماماً** لو وقع بعد البوّابة، وهو خطأٌ يمرّ على أي فحصِ وجودٍ ساذج
//    (السطرُ موجودٌ والاختبارُ أخضرُ والثغرةُ مفتوحة). فيُقاس موضعُه نسبةً إليها.
var _iNorm = src.search(bareNorm);
var _iGate = src.search(/if \(\/\^\\\/home\\\/\(index\|news\)\\\.html\\\/\?\$\/i\.test\(path\) &&/);
var orderOk = _iNorm !== -1 && _iGate !== -1 && _iNorm < _iGate;
if (!orderOk) failed++;
console.log((orderOk ? '  ✅ ' : '  ❌ ') +
            '🔴 **الضابط المعاكس**: التطبيعُ **يسبق** البوّابة — لو تلاها لَما التقطت العاريَ أبداً · المقيس: ' +
            _iNorm + ' < ' + _iGate);

// ── 🔴 استثناءُ `?news=` من التحويل (2026-09-02) ─────────────────────────────
//
// الفجوة التي يقفلها: بنّاءُ رابط المشاركة يُنتج `‎/home/news.html?news=…&t=…` **بلا
// `school`** حين يكون `schoolId` فارغاً — و`session.schoolId` فارغةٌ لحساب المالك
// بالتصميم. فكان التحويلُ يبتلع `?news=` و`?t=` (‏`Response.redirect` بلا `url.search`)
// ⇒ الزائرُ يهبط على دليل المدارس بلا خبر، بلا خطأ ولا أثر.
//
// 🔴 وضابطان متقابلان عمداً: الأوّل يُثبت أن الاستثناء **قائم**، والثاني يُثبت أنه
//    **لم يبتلع القصدَ الأمنيّ** — بلا الثاني يصير الإصلاحُ ثغرةً تفتح مكتبةَ المالك.
console.log('');
console.log('استثناء `?news=` من التحويل العاري:');
[[/!url\.searchParams\.has\('news'\) &&/,
  '✅ الاستثناء قائم: وجودُ `news` يرفع التحويل'],
 [/!url\.searchParams\.has\('news'\) &&\s*\n\s*!url\.searchParams\.has\('school'\)/,
  "🔴 **الضابط المعاكس**: الشروط الثلاثة مقرونةٌ بـ`&&` ⇒ الرابطُ العاري **بلا** `news` يبقى محوَّلاً (مكتبةُ المالك محميّة)"],
 [/has\('news'\)/,
  '🔴 الشرط بـ**وجود** المعامل لا بصحّة قيمته — خبرٌ محذوفٌ أو معرّفٌ فاسد لا يُعيد فتح التسريب']
].forEach(function (c) {
  var good = c[0].test(src);
  if (!good) failed++;
  console.log((good ? '  ✅ ' : '  ❌ ') + c[1]);
});

// 🔴 ضابطٌ مضادٌّ للانعكاس: `has('news')` بلا `!` يقلب المعنى تماماً (يُحوِّل روابطَ
//    المشاركة وحدها ويترك العاري) — وهو خطأُ حرفٍ واحدٍ يمرّ على أي فحصٍ نصّيٍّ ساذج.
var newsNeg = /!url\.searchParams\.has\('news'\)/.test(src) &&
              !/[^!]url\.searchParams\.has\('news'\) &&/.test(src);
if (!newsNeg) failed++;
console.log((newsNeg ? '  ✅ ' : '  ❌ ') +
            '🔴 النفي `!` حاضرٌ ولا يوجد `has(\'news\')` موجَبٌ في موضع الشرط — انعكاسُ المعنى محروس');

// ── 🔴 `getNewsOg`: تسلسلُ حلّ المستأجر (2026-09-02) ─────────────────────────
//
// كان يقرأ `?school=` وحده بينما `_tenantKeyFrom` و`frontend/home/newsarticle.html`
// يقبلان `?schoolId=` أيضاً ⇒ رابطٌ بالاسم الثاني يُمرِّر **فراغاً** ⇒ مدرسةُ المالك
// (بند 99). عدمُ تناظرٍ في أسماء المعاملات يُنتج سقوطاً صامتاً إلى مستأجرٍ خاطئ.
console.log('');
console.log('حلّ المستأجر في `getNewsOg`:');
var ogArgsM = src.match(/fn: 'getNewsOg', args: \[_newsId, ([^,]+(?:\|\| [^,]+)*), url/);
var ogArgs = ogArgsM ? ogArgsM[1].replace(/\s+/g, ' ').trim() : '(لم تُلتقَط)';
var ogOk = /_pathSlug \|\| url\.searchParams\.get\('school'\) \|\| url\.searchParams\.get\('schoolId'\) \|\| ''/.test(ogArgs);
if (!ogOk) failed++;
console.log((ogOk ? '  ✅ ' : '  ❌ ') +
            '🔴 التسلسل `_pathSlug → school → schoolId → \'\'` بهذا الترتيب · المقيس: ' + ogArgs);

// 🔴 الضابط المعاكس: `_pathSlug` **أوّلاً** لا آخِراً. على صفحة مدرسة (`/<slug>?news=`)
//    لا وجودَ لـ`?school=` إطلاقاً؛ ولو تأخّر الـslug لعادت علّةُ «معاينةُ كلّ مدرسة
//    تعرض خبرَ المالك» التي عولجت في بند 99 — إصلاحُ اليوم لا يجوز أن ينقضها.
var slugFirst = /args: \[_newsId, _pathSlug \|\|/.test(src);
if (!slugFirst) failed++;
console.log((slugFirst ? '  ✅ ' : '  ❌ ') +
            '🔴 **الضابط المعاكس**: `_pathSlug` أوّلُ المرشَّحين — لا يُزاح بمعاملِ استعلام');

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
[[/if \(_pathSlug && !\(await _slugIsKnown\(/, 'الـslug يُفحَص ضدّ السجلّ قبل إعادة الكتابة'],
 [/status: 404/, 'الحالة المُرجَعة 404 لا 200'],
 [/'X-Robots-Tag': 'noindex, follow'/, 'ورأس noindex معها (حزام وحمّالة)']
].forEach(function (c) {
  var good = c[0].test(src);
  if (!good) failed++;
  console.log((good ? '  ✅ ' : '  ❌ ') + c[1]);
});
// ضابط الاتجاه المعاكس: الـslugs المنشورة **لا** تُرجَع 404 — يقيسه جدول `_canonicalFor`
// أعلاه ضمناً (يُرجِع لها عنواناً صحيحاً)، ويؤكّده هنا أن الفحص مشروط بالنفي لا مطلق.
var guardIsConditional = /!\(await _slugIsKnown\(/.test(src) &&
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
var spIdx = src.indexOf('async function _slugIsKnown(');
var spEnd = spIdx < 0 ? -1 : src.indexOf('\n}', spIdx) + 2;
if (spIdx < 0 || spEnd <= 1) {
  console.log('  ❌ ضابط: تعذّر استخراج `_slugIsKnown` — الفحص أجوف');
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
    _slugsMissRefreshDue: function () { calls.due++; return spCtx.__due; },
    __cached: null, __fresh: null, __due: false
  });
  vm.runInContext(spSrc, spCtx);
  function run(slug, cached, fresh, due) {
    spCtx.__cached = cached; spCtx.__fresh = fresh; spCtx.__due = !!due;
    calls.cache = 0; calls.refresh = 0; calls.due = 0;
    return vm.runInContext('_slugIsKnown(' + JSON.stringify(slug) + ', "https://x", {})', spCtx);
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
    ['🟢 مدرسةٌ قُبلت للتوّ وقائمةٌ مكاشةٌ بائتة ⇒ **تحديثٌ واحد** يجدها حين يحين دورُه (2026-09-19)',
     (function () { var r = run('just-approved', ['a'], ['a', 'just-approved'], true);
       return r === true && calls.refresh === 1; })()],
    ['🔴 ضابط: المحدِّدُ الزمنيُّ **يُستشار** على الإخفاق — لا تحديثَ لكلّ عنوانٍ مخترَع',
     (function () { var r = run('ghost', ['a'], ['a'], false);
       return r === false && calls.due === 1 && calls.refresh === 0; })()],
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

// ── 🔴 عقد مسار `/schedule` — يبقى بعد حذف مشروع `schedule` من المصدر ─────────
//
// السياق المقيس (2026-09-05، جلسة `SchoolApp-gas`): مشروع `schedule/` يُحذف بالكامل
// بقرار مالك — مفطومٌ منذ 2026-08-24، وعمود `schedule_file_id` أُفرِغ في السجلّ المركزي.
// و`/schedule/index.html` **يبقى يردّ 200** عبر صفحةٍ ثابتة بديلة تُبنى هناك.
//
// 🔴 **ولماذا يلزم حارسٌ هنا رغم أن هذا المستودع لم يتغيّر:** التوجيه إلى المسار عامٌّ
// بالكامل — لا فرعَ يذكر `/schedule` في الوركر — فبقاؤه 200 يتّكئ على شيءٍ **واحدٍ غير
// بديهيّ**: أن `'schedule'` ما زال في `_RESERVED_TOP_PATHS`. وحذفُ المشروع من المصدر
// يجعل ذلك المدخلَ يبدو لمنظِّفٍ لاحقٍ **بقيّةً من مشروعٍ ميت** — وإسقاطُه يقلب المسار
// من صفحةٍ ثابتة إلى **مرشَّحِ slug مدرسة** ⇒ `_slugIsKnown` يخفق ⇒ صفحة «لم نجد
// هذه المدرسة» بـ**404**. أي أن الكسر يقع في مستودعٍ آخر تماماً، بلا أيّ خطأ نحويّ.
//
// ⚠️ والمسار **مجمَّدٌ في ثنائيّ تطبيقَي الأندرويد** (‏`AppConfig.kt::matchesDeployment`
//    يطابق `/(home|student|teacher|cms|schedule)/`) ⇒ لا Deep Link ولا مزامنة، والإصلاح
//    الوحيد إصدارٌ جديد على Play. ومخزَّنٌ مسبقاً في `assets/sw.js` ⇒ كسرُه لا رجعة فيه.
// 🔒 و`GAS.schedule` يبقى في جدول النشرات، ولا `clasp undeploy` بحال (نفس قاعدة `student` — بند 124).
//    🔴 **لكنّه لم يعد «مسارَ تراجعٍ خاملاً» — قِيس 2026-09-19:** مشروعُ الجدول غيرُ موجودٍ في Drive،
//    والنشرةُ تعيد صفحةَ خطأ HTML من Google. ⇒ `/gas/schedule` يردّ 410 من الوسيط (`_RETIRED_GAS_APPS`).
//    والمعرّفُ يبقى سجلاً لا مساراً.
console.log('');
console.log('عقد مسار `/schedule` (يبقى بعد حذف المشروع من المصدر):');
[[/'schedule': 1/,
  "🔴 `'schedule'` محجوز في `_RESERVED_TOP_PATHS` ⇒ لا يُقرأ slug مدرسة"],
 [/^\s*schedule:\s*'https:\/\/script\.google\.com\/macros\/s\/[^']+\/exec'/m,
  '🔒 مدخل `schedule` في جدول GAS قائم — مسارُ تراجعٍ خامل، ومعرّف النشر لا يُحذف']
].forEach(function (c) {
  var good = c[0].test(src);
  if (!good) failed++;
  console.log((good ? '  ✅ ' : '  ❌ ') + c[1]);
});

// الضابط الإيجابي — **سلوكي لا نصّي**: الحجزُ مكتوبٌ *وفاعل*.
ctx.__p = '/schedule';
var schedNotSlug = vm.runInContext('_schoolSlugFromPath(__p)', ctx) === '';
if (!schedNotSlug) failed++;
console.log((schedNotSlug ? '  ✅ ' : '  ❌ ') +
            '`/schedule` لا يُقرَأ slug مدرسة ⇒ يُخدَم من `GITHUB_BASE` كما هو');

/* 🔴 **الضابط المعاكس — وبلاه يكون كلُّ ما سبق أجوف.** الفحصان النصّيّان يُثبتان أن
   السطر مكتوب، والفحصُ السلوكيّ أعلاه يُثبت أن الناتج `''` — ولا يُثبت أيٌّ منها أن
   **الحجزَ هو السبب**: لو صار `/schedule` يُردّ لعلّةٍ أخرى (تغيُّرُ الـregex مثلاً)
   لبقي الحارسُ أخضرَ وهو لم يعد يقيس ما يدّعيه. فتُطبَّق الطفرةُ في نسخةٍ **في الذاكرة**
   (‏لا تُمَسّ الشجرة): يُحذف المدخل ⇒ يجب أن ينقلب الناتج إلى `'schedule'` فعلاً. */
var mctx = vm.createContext({});
vm.runInContext(src.slice(rIdx, rEnd) + '\n' + src.slice(fIdx, fEnd), mctx);
var mutated = vm.runInContext(
  "delete _RESERVED_TOP_PATHS['schedule']; _schoolSlugFromPath('/schedule');", mctx);
var mutFlips = (mutated === 'schedule');
if (!mutFlips) failed++;
console.log((mutFlips ? '  ✅ ' : '  ❌ ') +
            '🔴 ضابط معاكس: بحذف الحجز يصير `/schedule` slug مدرسة ⇒ 404 [' +
            (mutated === '' ? 'فارغ — الحارس أجوف' : mutated) + ']');

/* ── 🔴 عقدُ المسارات المجمَّدة في APK منشور — فئةٌ لا حالات (2026-09-10) ──────────
 *
 * **السياقُ المقيس:** فوّض المالكُ بحذف `student` · `schedule` · `pricing` ·
 * `home-all-school` نهائياً. والقياسُ فصَل ثلاثَ طبقاتٍ كانت تُقرأ طبقةً واحدة:
 *   ① **مصدرُ GAS** ⇒ يُحذف (‏وقد حُذف `schedule/` فعلاً 09-05، و`student/` أرشيفٌ محضٌ
 *      لا يولّد شيئاً بعد انقلاب اتجاه التوليد إلى `teacher/`).
 *   ② **النشراتُ** ⇒ تبقى حيّةً خاملةً — «لا `clasp undeploy` أبداً».
 *   ③ **المساراتُ المخدومة** ⇒ 🔴 **تبقى تردّ 200، وهذا عقدٌ لا إهمال.**
 *
 * **ولماذا ③ ليست تهاوناً — مقيسٌ من مستودعَي الأندرويد قراءةً (2026-09-10):**
 *   · `SchoolAppyemen` **منشورٌ على Play والمستخدمون على `vc31`**، و`AppConfig.kt:69`
 *     يحمل `DEFAULT_STUDENT = …/student/index.html` وهو **`startUrl` لشاشة
 *     `StudentActivity`**؛ ومعه **Deep Links مُتحقَّقٌ منها** (‏`autoVerify` على
 *     `/student/abdaawatmuaz` — `AndroidManifest.xml:162-167`) ⇒ رابطُ المشاركة يفتح
 *     التطبيقَ ثمّ يعرض ٤٠٤ **داخله**، وهو أسوأُ من ألّا يفتح.
 *   · `home-all-school/index.html` هو **`DEFAULT_HOME` لتطبيق `YemenSchoolz`** — شاشةُ
 *     إقلاعه كلُّها.
 *   · 🔴 **ولا طريقَ إصلاح:** `syncIfNeeded()` **معطَّلةٌ بالتعليق في التطبيقين**،
 *     و`isValidUrl` ترفض كلَّ رابطٍ ليس `script.google.com/…/exec` ⇒ **حتى لو فُعّلت
 *     لأسقطت أيَّ بديل**. والتفعيلُ نفسُه يحتاج إصداراً جديداً لا يُحدّثه الجميع.
 *
 * 🎯 **ونقطةُ الانهيار واحدةٌ وغيرُ بديهيّة:** لا فرعَ في الوركر يذكر هذه المسارات —
 * بقاؤها 200 يتّكئ **حصراً** على وجود اسمها في `_RESERVED_TOP_PATHS`. وحذفُ الاسم
 * **أوّلُ ما يبدو «تنظيفاً بريئاً»** بعد حذف المشروع من المصدر، **ويقلب المسارَ سلكياً
 * إلى مرشَّحِ slug مدرسة ⇒ 404**، في مستودعٍ آخرَ تماماً وبلا أيّ خطإٍ نحويّ.
 *
 * ⚠️ **ولماذا فئةٌ لا حالات:** التغطيةُ كانت غيرَ متكافئة — `student` ٥٥ سطرَ فحص ·
 * `schedule` ٢٧ · و**`home-all-school` سطرٌ واحد**. ⇒ حارسٌ لكلّ اسمٍ على حدة يترك
 * البابَ مفتوحاً لأوّل اسمٍ يُنسى؛ والفئةُ تُغطّي الأربعةَ بنفس الشرط.
 *
 * 🔴 **و`cms` أُضيف 2026-09-15 — وهو بعينه «أوّلُ اسمٍ نُسي» الذي حذّر منه السطرُ أعلاه.**
 * كُتبت الفئةُ لتمنع النسيان **فنسيت واحداً**، ولم يُكتشف إلّا بقياسِ جلسة `SchoolAppyemen`
 * لِـ`dex` الحزم: **`vc31` يطلب `school.procorners.com/cms/index.html` صراحةً**
 * (و`vc34/35` لا يطلبانه) ⇒ **عقدٌ مُثبَتٌ ما بقي مستخدمو `vc31`.**
 *
 * ⚠️ **وفارقٌ دلاليٌّ يُقال كي لا يُقرأ `cms` متقاعداً:** الثلاثةُ الأولى **مشاريعُ
 * متقاعدةٌ حُذف مصدرُها**، و**`cms` مشروعٌ حيٌّ يُطوَّر**. ⇒ ما يحرسه هذا الفحصُ ليس
 * «بقاءَ مشروعٍ ميّت» بل **بقاءَ الاسم في `_RESERVED_TOP_PATHS`** — وذلك خطرٌ مشترك:
 * أيُّ تنظيفٍ للقائمة يقلب المسارَ إلى مرشَّحِ slug مدرسةٍ ⇒ **٤٠٤ لمستخدمي `vc31`**،
 * **وحياةُ المشروع لا تحمي منه إطلاقاً.**
 * 🔒 **و`pricing` مستثنىً عمداً من هذه الفئة** — الوحيدُ **بلا مجلدٍ في `frontend/`
 *    وبلا ثابتٍ مجمَّدٍ في أيّ تطبيق** ⇒ حذفُه قرارُ مالكٍ منفَّذ، لا عقدَ APK يحميه.
 */
console.log('');
console.log('عقدُ المسارات المجمَّدة في APK منشور (فئةٌ — بطفرةٍ لكلّ اسم):');
['student', 'schedule', 'home-all-school', 'cms'].forEach(function (name) {
  var p = '/' + name;

  /* ① نصّيّ: الاسمُ ما زال محجوزاً. */
  var declared = new RegExp("'" + name + "':\\s*1").test(src);
  if (!declared) failed++;
  console.log((declared ? '  ✅ ' : '  ❌ ') +
              '🔴 `' + name + '` محجوز في `_RESERVED_TOP_PATHS` — مجمَّدٌ في APK منشور، والحذفُ لا يُعكَس');

  /* ② سلوكيّ: الحجزُ **فاعل** لا مكتوبٌ فقط. */
  ctx.__p = p;
  var notSlug = vm.runInContext('_schoolSlugFromPath(__p)', ctx) === '';
  if (!notSlug) failed++;
  console.log((notSlug ? '  ✅ ' : '  ❌ ') +
              '`' + p + '` لا يُقرَأ slug مدرسة ⇒ يُخدَم كما هو');

  /* ③ 🔴 الضابطُ المعاكس — وبلاه يكون ما سبق أجوف: يُثبت أن **الحجزَ هو السبب**.
     الطفرةُ في نسخةٍ بالذاكرة، ولا تُمَسّ الشجرة. ويُطبَع **ما اشتُقّ لا عدَدُه**:
     الناتجُ الفعليّ يظهر بين قوسين، فيفضح الحارسَ الأجوف في سطر. */
  var fctx = vm.createContext({});
  vm.runInContext(src.slice(rIdx, rEnd) + '\n' + src.slice(fIdx, fEnd), fctx);
  var flipped = vm.runInContext(
    "delete _RESERVED_TOP_PATHS['" + name + "']; _schoolSlugFromPath('" + p + "');", fctx);
  var flips = (flipped === name);
  if (!flips) failed++;
  console.log((flips ? '  ✅ ' : '  ❌ ') +
              '🔴 طفرة: بحذف الحجز يصير `' + p + '` slug مدرسة ⇒ 404 [' +
              (flipped === '' ? 'فارغ — الحارس أجوف' : flipped) + ']');
});

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

  /* 🔴 **والمضيفُ الثاني يُخدَم أيضاً — أُضيف 2026-09-01 بعد قياسٍ حيّ:**
     المانيفستُ المنشور يعلن `www.yemenschoolz.com` بـ`autoVerify` كذلك
     (‏`AndroidManifest.xml:101-106`)، وتحقّقُ Digital Asset Links **لا يتبع التحويلات**.
     وكان فرعُ `REDIRECT_TO_CANONICAL` يبتلع المسارَ فيردّ **301 بجسمٍ فارغ** ⇒ ذلك
     المضيفُ يفشل تحقّقُه **صامتاً**. هذا الفحصُ يُثبت أن الكتلة تخدم المضيفَين معاً؛
     ⚠️ **وحدُّ هذا الفحص يُقال صراحةً:** الكتلةُ المقتطَعة **لا ترى فرعَ التحويل** الذي
     يسبقها، فهو **لا يحمرّ** بإلغاء الإعفاء — قِيس بمعمل طفرة: إلغاءُ الإعفاء يُحمِّر
     ضوابطَ كتلة «تحويل النطاق» **وحدها**. ⇒ ما يقيسه هذا السطر: أن المعالجَ **محايدٌ
     تجاه المضيف** فيخدم الجسمَ نفسَه متى بلغه الطلب. والحارسُ الفعليّ للإعفاء هناك. */
  var raw = runBlock(alBlock, '/.well-known/assetlinks.json', 'www.yemenschoolz.com', '');
  check(!!raw && raw.status === 200 && raw.body === ra.body,
        'المعالجُ محايدٌ تجاه المضيف — `www` يُخدَم نفسَ الجسم بـ200 متى بلغه الطلب');

  /* 🔴 وموضعُ المعالج بنيويّ: يسبق حسابَ الـslug. وإلّا قرأ `_schoolSlugFromPath` المسارَ
     اسمَ مدرسةٍ فخُدم `home/index.html` بـ200 **ونوعِ محتوى HTML** ⇒ تحقّقٌ يفشل وكلُّ
     شيءٍ يبدو سليماً — وهي فئةُ `/portal` نفسُها التي وُجد هذا الملفّ بسببها. */
  var _alIdx   = src.indexOf("if (path === '/.well-known/assetlinks.json')");
  var _slugIdx = src.indexOf('var _pathSlug = _schoolSlugFromPath(path);');
  check(_alIdx > 0 && _slugIdx > 0 && _alIdx < _slugIdx,
        '🔴 المعالجُ **يسبق** حسابَ الـslug — وإلّا خُدم HTML بـ200 وفشل التحقّق صامتاً');
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
  /* ⚠️ **المرساة انتقلت (‏2026-08-26)** من كتلةٍ واحدة إلى نطاقٍ يمتدّ من حلّ الهوية حتى
     `_rw.transform(` — لأن الهوية صارت مُدخَلاً في المُصادِق المركّب فسبقت إعادة الكتابة.
     🔴 والشرطُ يُفحَص حيث هو الآن: الحقن ما زال محكوماً بـ`_tenantKey && !_newsId` في
        الموضعين معاً (حلُّ الهوية، ثمّ استهلاكُها). أيُّ شرطٍ يسقط ⇒ يُمَسّ الجذرُ أو
        مسارُ المشاركة، وهو بالضبط ما بُني هذا الحارس لمنعه. */
  var gIdx = src.indexOf('_brandFromCache(url.origin, _tenantKey)');
  var gateCond = /if \(isHtml && !isSwOrManifest && ghResp\.status === 200 && _tenantKey && !_newsId\)/.test(src) &&
                 /if \(_tenantKey && !_newsId && _brand\)/.test(src);
  check(gIdx !== -1 && gateCond,
        '🔒 الحقن مشروط بـ`_tenantKey && !_newsId` (الجذر ومسار المشاركة لا يُمَسّان)');
  var gEnd = src.indexOf('_rw.transform(', gIdx);
  var gate = gIdx === -1 ? '' : src.slice(gIdx, gEnd === -1 ? gIdx + 900 : gEnd);
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
    'function _BrandField(v){this.val=v;}\n' +
    'function _Unhide(){}\n' +
    'function _LogoInner(u,a){this.url=u;this.alt=a;}\n' +
    fnSrc('_brandText') + '\n' + fnSrc('_brandDigits') + '\n' + fnSrc('_brandPhone') + '\n' +
    fnSrc('_brandDocTitle') + '\n' + fnSrc('_brandRewrite') + '\n' +
    'function mkRw(sink){ return { on: function(sel, h){ sink.push([sel, h]); return this; } }; }', rwCtx);
  rwCtx.__sink = [];
  /* 🔴 الحمولةُ هنا تحاكي **ما يُرجعه GAS فعلاً** (قِيس حيّاً 2026-09-03): الهاتفُ مطبَّعٌ
     `+967…` وواتساب **خامٌ بأرقامٍ فقط** — عقدان مختلفان في الحمولة الواحدة. حمولةٌ
     اختباريةٌ «مرتّبة» بشكلٍ واحد كانت ستُخفي علّةَ القفزة بدل أن تكشفها. */
  rwCtx.__brand = { name: 'مدارس ابن خلدون الاهلية', tagline: 'ت', description: 'وصف', logo: 'https://lh3.googleusercontent.com/d/X=w400',
                    phone: '+967771234567', address: 'صنعاء — شارع الستين', whatsapp: '771234567' };
  vm.runInContext('_brandRewrite(mkRw(__sink), __brand, "home")', rwCtx);
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
  vm.runInContext('_brandRewrite(mkRw(__sink2), __brand2, "home")', rwCtx);
  var sels2 = rwCtx.__sink2.map(function (p) { return p[0]; });
  check(sels2.indexOf('#hdrLogo') === -1 && sels2.indexOf('meta[name="twitter:image"]') === -1,
        '🔴 ضابط معاكس: بلا شعار ⇒ صفر محدِّد صورة (لا `content=""` مُعلَن)');
  check(sels2.indexOf('meta[name="description"]') === -1,
        '🔴 ضابط معاكس: بلا وصف ⇒ لا يُدهَس وصف الصفحة بفراغ');
  check(sels2.indexOf('title') !== -1 && sels2.indexOf('.school-brand-name') !== -1,
        '… والاسم يُحقَن دائماً (هو الحدّ الأدنى الذي جاءت الميزة لأجله)');

  /* ── عقد الخطّافات الموحَّد + الهاتف/العنوان (2026-09-03 — قرار المالك) ──────────
     🔴 الضابطُ على **الآلية والاتّجاه معاً**: أن يُحقَن الخطّاف حين تكون القيمة، وألّا
        يُحقَن حين تغيب — لأن `data-brand-host` **يُظهِر حاويةً مخفيّة**، وإظهارُها بقيمةٍ
        فارغة يعيد بالضبط العلّة التي أُخفيت لأجلها (أيقونةُ هاتفٍ بلا رقم · بند 08-27). */
  ['[data-brand="name"]', '[data-brand="phone"]', '[data-brand="address"]',
   '[data-brand="whatsapp"]', '[data-brand="logo"]',
   '[data-brand-host="phone"]', '[data-brand-host="address"]', '[data-brand-host="whatsapp"]',
   '[data-brand-href="phone"]', '[data-brand-href="whatsapp"]',
   '#tbPhone', '#fcPhone', '#tbAddr', '#ftAddr', '#tbWa', '#fcWa'].forEach(function (s) {
    check(sels.indexOf(s) !== -1, 'يُحقَن الخطّاف `' + s + '`');
  });
  var telH = rwCtx.__sink.filter(function (p) { return p[0] === '[data-brand-href="phone"]'; })[0];
  check(telH && telH[1].val === 'tel:+967771234567', '`tel:` مبنيٌّ من الرقم كما ورد من GAS (بلا إعادة تطبيع)');
  var waH = rwCtx.__sink.filter(function (p) { return p[0] === '[data-brand-href="whatsapp"]'; })[0];
  check(waH && waH[1].val === 'https://wa.me/967771234567',
        '🔴 `wa.me` بالأرقام وحدها **ورمزُ الدولة مُضاف** — `+` يكسر الرابط، ونقصُ الرمز يُبطله');
  /* 🔴 والوجهُ الثاني، وهو ما وقع فعلاً: **العرضُ يبقى خاماً.** واتساب عقدُه في الـgas
     «أرقامٌ فقط» ويثبّته اختبارٌ هناك، فتطبيعُه للعرض يُنتج قفزةً معاكسة عند طلاء العميل. */
  var waT = rwCtx.__sink.filter(function (p) { return p[0] === '[data-brand="whatsapp"]'; })[0];
  check(waT && waT[1].val === '771234567',
        '🔴 عرضُ واتساب يبقى خاماً كما يُرجعه GAS — لا يُطبَّع كالهاتف (قفزةٌ معاكسة)');
  var waTb = rwCtx.__sink.filter(function (p) { return p[0] === '#tbWa'; })[0];
  check(waTb && waTb[1].val === '771234567', '… و`#tbWa` كذلك — عقدٌ واحدٌ في الموضعين');
  ['[data-brand-host="phone"]', '[data-brand-host="address"]', '[data-brand-host="whatsapp"]',
   '[data-brand="phone"]', '#tbPhone', '#stuLoginContact'].forEach(function (s) {
    check(sels2.indexOf(s) === -1,
          '🔴 ضابط معاكس: بلا هاتف/عنوان ⇒ لا `' + s + '` (الحاوية تبقى مخفيّة)');
  });

  /* ── السطوح الثلاثة: عائلةُ محدِّداتٍ لكلٍّ، والعنوانُ ووسومُ OG لـ`home` وحدها ───── */
  rwCtx.__sink3 = [];
  vm.runInContext('_brandRewrite(mkRw(__sink3), __brand, "teacher")', rwCtx);
  var sels3 = rwCtx.__sink3.map(function (p) { return p[0]; });
  check(sels3.indexOf('#tchLoginLogo') !== -1 && sels3.indexOf('#tchNavLogo') !== -1,
        'سطح المعلّم: حاويتا الشعار تُملآن (‏<div> بـ`innerHTML` لا `img[src]`)');
  check(sels3.indexOf('.school-brand-name') !== -1 && sels3.indexOf('[data-brand="phone"]') !== -1,
        '… والاسم والخطّافات تعمل على المعلّم أيضاً');
  check(sels3.indexOf('title') === -1 && sels3.indexOf('meta[property="og:title"]') === -1,
        '🔴 سطح المعلّم بلا `title` ولا وسوم OG — العميل يملك العنوان، والوسوم غائبة أصلاً و`_AttrSet` لا يُنشئ');
  check(sels3.indexOf('#hdrLogo') === -1 && sels3.indexOf('#stuLoginLogo') === -1,
        '🔴 ولا تتسرّب محدِّدات سطحٍ آخر إليه');
  /* 🟢 خانتا الهاتف/العنوان في رأس المعلّم — أضافتهما جلسةُ `SchoolApp-gas` في المرور
     نفسِه (لم تكونا موجودتين أصلاً، بخلاف الطالب). ولا يُضافان بعدُ إلى حارس الـHTML
     المخدوم: `frontend/` مُولَّدٌ من هناك ولن يحملهما حتى تُدمَج دفعتُهم وتُعاد الدورة. */
  var tchC = rwCtx.__sink3.filter(function (p) { return p[0] === '#tchLoginContact'; })[0];
  check(tchC && tchC[1].val === '📞 +967771234567',
        'سطح المعلّم: `#tchLoginContact` بصيغة الطالب نفسِها (وإلّا قفز النصّ عند وصول الحمولة)');
  check(sels3.indexOf('#tchLoginAddress') !== -1, '… و`#tchLoginAddress` كذلك');
  rwCtx.__sink4 = [];
  vm.runInContext('_brandRewrite(mkRw(__sink4), __brand, "student")', rwCtx);
  var sels4 = rwCtx.__sink4.map(function (p) { return p[0]; });
  check(sels4.indexOf('#stuLoginContact') !== -1 && sels4.indexOf('#stuLoginAddress') !== -1,
        'سطح الطالب: خانتا الهاتف والعنوان في شاشة الدخول تُملآن خادمياً');
  var stuC = rwCtx.__sink4.filter(function (p) { return p[0] === '#stuLoginContact'; })[0];
  check(stuC && stuC[1].val === '📞 +967771234567',
        '🔴 بنفس صيغة `applyBrand` في `_stu-js-boot-runtime.html` (وإلّا قفز النصّ عند وصول الحمولة)');
  check(sels4.indexOf('#stuNavLogo') !== -1 && sels4.indexOf('#tchNavLogo') === -1,
        '… وشعار الطالب وحده — لا شعار المعلّم');
  check(sels4.indexOf('#tchLoginContact') === -1 && sels4.indexOf('#tchLoginAddress') === -1,
        '🔴 ضابط معاكس: خانتا المعلّم لا تظهران على سطح الطالب');

  /* السطح يُشتقّ من المسار الخام: دالّة نقيّة بجدول حالات. */
  var sfCtx = vm.createContext({ String: String });
  vm.runInContext(
    src.slice(rIdx, rEnd) + '\n' + src.slice(fIdx, fEnd) + '\n' + fnSrc('_brandSurfaceFor'), sfCtx);
  [['/abdaawatmuaz', 'home'], ['/home/index.html', 'home'],
   ['/teacher/login', 'teacher'], ['/teacher/login/ibn-khaldoun', 'teacher'],
   ['/teacher/index.html', 'teacher'], ['/student/index.html', 'student'],
   ['/student/grades/ibn-khaldoun', 'student'], ['/portal', 'student'],
   ['/home/schools.html', ''], ['/home/news.html', '']].forEach(function (c) {
    sfCtx.__p = c[0];
    check(vm.runInContext('_brandSurfaceFor(__p)', sfCtx) === c[1],
          'سطحُ `' + c[0] + '` = `' + c[1] + '`');
  });

  /* ── روابطُ البوّابات في الـHTML الخام (2026-09-19) ─────────────────────────────
     🔴 الحارسُ على الاتّجاهين: أن يُكتب الرابطُ للقيمتين المعروفتين، **وألّا** يُكتب لغيرهما
        ولا بلا مفتاح — رابطٌ مكتوبٌ خطأً أسوأ من رابطٍ عارٍ يكمّله العميل. */
  var phCtx2 = vm.createContext({ String: String, Object: Object, encodeURIComponent: encodeURIComponent });
  var pbIdx = src.indexOf('var _PORTAL_BASE');
  check(pbIdx !== -1, '`_PORTAL_BASE` موجود (وإلّا لا يُقاس شيء — خروجٌ أحمر لا تخطٍّ)');
  vm.runInContext(src.slice(pbIdx, src.indexOf('\n', pbIdx)) + '\n' + fnSrc('_portalHref'), phCtx2);
  function ph2(k, key) { phCtx2.__k = k; phCtx2.__key = key; return vm.runInContext('_portalHref(__k, __key)', phCtx2); }
  check(ph2('teacher', 'abdaawatmuaz') === '/teacher/index.html?school=abdaawatmuaz',
        'بوّابة المعلّم تحمل المدرسة: `/teacher/index.html?school=<key>`');
  check(ph2('student', '12725ed7-c139-422c-a2d1-ec0ddd358104') ===
        '/student/index.html?school=12725ed7-c139-422c-a2d1-ec0ddd358104',
        'بوّابة الطالب تحمل الـUUID كما هو');
  check(ph2('teacher', '') === '', '🔴 ضابط معاكس: بلا مفتاح ⇒ لا كتابة (يبقى الرابط كما في المصدر)');
  check(ph2('admin', 'abdaawatmuaz') === '', '🔴 ضابط معاكس: قيمةُ `data-portal` خارج القائمة ⇒ لا كتابة');
  check(ph2('constructor', 'abdaawatmuaz') === '' && ph2('toString', 'x') === '',
        '🔴 `constructor`/`toString` لا يتخطّيان القائمة البيضاء (‏hasOwnProperty لا `obj[k]`)');
  check(ph2('teacher', 'a&b"c') === '/teacher/index.html?school=a%26b%22c',
        '🔒 المفتاحُ يُهرَّب بـ`encodeURIComponent` (دفاعٌ ثانٍ خلف بوّابة الشكل)');
  /* الوصل: مشروطٌ بسطح `home` و`!_newsId`، **ومستقلٌّ عن `_brand`** — وهو سببُ وجوده. */
  var poIdx = src.indexOf('var _portalOn');
  var poLine = poIdx === -1 ? '' : src.slice(poIdx, src.indexOf('\n', poIdx));
  check(/_tenantKey && !_newsId && _brandSurfaceFor\(_rawPath\) === 'home'/.test(poLine) && poLine.indexOf('_brand)') === -1,
        '🔴 `_portalOn` مشروطٌ بـ`_tenantKey && !_newsId` وسطح `home` — **ولا ينتظر كاش الهويّة**');
  check(/\(_canonHref \|\| _brandOn \|\| _portalOn \|\| _sidOn\)/.test(src),
        '… ويفتح سلسلةَ `HTMLRewriter` وحدَه ولو غابت الهويّة (وإلّا صار تعريفاً بلا وصل)');
  check(/if \(_portalOn\) _rw = _rw\.on\('a\[data-portal\]', new _PortalHref\(_tenantKey\)\)/.test(src),
        '… ويُطبَّق على `a[data-portal]` بمفتاح المستأجر');

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
  /* ── تطبيعُ الهاتف إلى E.164 — عطلٌ **مقيسٌ حيّاً** بعد أوّل نشر، لا احتياط ─────
     `getHomePageBundle` يُرجع الرقمَ خاماً من الشيت (‏`775189922`) بينما
     `get*SchoolBrand` تُطبّعانه (‏`+967775189922`) ⇒ الخادمُ يكتب شكلاً والعميلُ يعيد
     طلاءه بآخر (قفزة)، **ورابطُ `wa.me` بالرقم المحلّي لا يفتح محادثةً أصلاً**. */
  var phCtx = vm.createContext({ String: String });
  vm.runInContext(fnSrc('_brandText') + '\n' + fnSrc('_brandPhone') + '\n' + fnSrc('_brandDigits'), phCtx);
  function ph(v) { phCtx.__v = v; return vm.runInContext('_brandPhone(__v)', phCtx); }
  check(ph('775189922') === '+967775189922', '🔴 رقمٌ محلّيٌّ خام ⇒ E.164 (الحالةُ الحيّة المقيسة)');
  check(ph('0775189922') === '+967775189922', '🔒 والصفرُ البادئ يُسقَط لا يُضاعَف');
  check(ph('+967775189922') === '+967775189922', '🔒 المطبَّعُ سلفاً لا يُطبَّع مرّتين');
  check(ph('+201234567890') === '+201234567890', '🔒 ورقمٌ غيرُ يمنيّ لا يُنتزَع منه رمزُه');
  check(ph('  775 189 922  ') === '+967775189922', 'الفراغاتُ والشرطاتُ تُقلَّم');
  check(ph('') === '' && ph(null) === '', '🔴 الفارغُ يبقى فارغاً — لا `+967` وحدَه (حاويةٌ تُظهَر برمزِ دولةٍ فقط)');
  phCtx.__v2 = ph('775189922');
  check(vm.runInContext('_brandDigits(__v2)', phCtx) === '967775189922',
        '🔴 و`wa.me` يتلقّى الرقمَ الدوليّ كاملاً — وهو ما كان باطلاً قبل التطبيع');

  ctx.__k = '/__brand-cache/v5/ibn-khaldoun';
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
/* 🔗 يُصدَّران إلى حارس العقد المنشور أدناه — **قيمةٌ واحدةٌ محسوبةٌ مرّةً**، فلا
   تُعاد المحاكاةُ هناك فيصير الحارسُ يقيس نسختَه بدل المصدر. */
var LOGIN_WORST_MS = -1;
var LOGIN_MARGIN_MIN_MS = 2000;
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
  /* 🔴 **سقفان منذ 2026-09-21 — والمرساةُ تطابق الشكلَ الشرطيَّ لا رقماً واحداً.**
     `doPost` عند 26,000 و`doGet` عند 24,000. والعلّةُ أن `_LOGIN_TIMEOUT = 28000` يشمل
     **التنفيذَ والنقلَ معاً**: صفحةُ `doGet` ‏625 ك.ب على السلك (~5ث نقلاً على 1Mbps)
     ⇒ رفعُها يشتري احتجازَ تنفيذٍ لا تسليماً. */
  check(/\r?\n\s*var TOTAL_BUDGET_MS = \(isPost \? \d+ : \d+\) - _bhWaited;/.test(src),
        '🔴 الانتظار **يُخصَم** من ميزانية المحاولات، والسقفُ شرطيٌّ بالطريقة (POST/GET)');

  /* ③ الأسماء تُطابَق بمصدر GAS حين يتوفّر — وغيابُه `SKIPPED` صريحة لا نجاحٌ صامت.
     🔴 **وأُعيدت قسمةُ الفرع 2026-09-13 بعد قياسٍ يوسّع العلّة:** كان فرعُ `else` يبتلع
     **١٨ فحصاً**، والمقيسُ أن **خمسةً منها فقط** تلمس المستودعَ الشقيق فعلاً
     (‏`520` فحصاً بمصدر GAS مقابل **`502`** بدونه — نفسُ الملفّ، بيئتان).
     ⇒ محاكاةُ الميزانية وسياسةُ المحاولة — **وثوابتُهما كلُّها من مصدر هذا المستودع** —
     كانتا مبوَّبتين خلف توفّر مستودعٍ خاصٍّ لا علاقةَ لهما به ⇒ **لا تُشغَّلان في CI
     إطلاقاً**، وهي البيئةُ التي تُلزم وحدَها. 🎯 **وحارسٌ يتخطّى صامتاً في البيئة
     المُلزِمة ليس حارساً** — والقسمةُ الصحيحةُ بمصدر المُدخَل لا بموضع الكتلة. */
  var GAS = process.env.SCHOOLAPP_GAS_DIR ||
            path.join(path.dirname(path.dirname(__dirname)), 'SchoolApp-gas');
  var gasOk = false;
  try { gasOk = fs.statSync(path.join(GAS, 'teacher')).isDirectory(); } catch (e) { gasOk = false; }

  /* ═══ أسوأُ زمنِ دخولٍ مُحاكىً — كلُّ ثوابته من `school-app-proxy.js` ⇒ **دائماً** ═══
     🔴 **النموذج أُعيد بناؤه 2026-08-29 مع علاج تضخيم إعادة المحاولة.** لم تعُد ثمّة
     `PER_ATTEMPT_TIMEOUT_MS` ثابتة: مهلةُ المحاولة = ما تبقّى من الميزانية ناقصَ الهامش،
     وفشلُ المهلة **لا يُعيد المحاولة**. فالمساران الممكنان:
       ① مهلة على المحاولة الأولى ⇒ خروجٌ فوراً.
       ② فشلُ نقلٍ سريع ⇒ نومٌ مقصوص ⇒ محاولةٌ ثانية بما تبقّى.
     وأسوأُ زمنٍ هو الأكبر منهما — ويجب أن يبقى تحت `BASE` في الحالتين.
     🔗 **والناتجُ يُنشَر في `worker/login-fns-contract.json`** ليطرحه CI الـGAS من مهلة
     عميله، فالمقارنةُ عبر المستودعين لا تموت بغياب أحدهما عن قرص الآخر. */
  var winM = /var BH_LOGIN_WAIT_MS = (\d+);/.exec(src);
  var attM = /var GAS_ATTEMPT_MARGIN_MS = (\d+);/.exec(src);
  /* 🔴 **يُقرأ سقفُ `POST` لا `GET` — ومسارُ الدخول هو المُلزِم.**
     دوالُّ `BH_LOGIN_FNS` تُستدعى عبر `google.script.run` ⇒ **POST دائماً** ⇒ أسوأُ زمنِ
     دخولٍ يُحسب من السقف الأعلى. وحسابُه من سقف `GET` كان سيُنتج رقماً **أصغرَ من الواقع**
     فيُنشَر في العقد ⇒ **عميلٌ يقتطع هامشاً أوسعَ ممّا يملك، والخطأُ في اتّجاه الخطر.** */
  var budM = /var TOTAL_BUDGET_MS = \(isPost \? (\d+) : (\d+)\) - _bhWaited;/.exec(src);
  var napM = /var delays = \[(\d+)\];/.exec(src);
  var minM = /var GAS_MIN_ATTEMPT_MS = (\d+);/.exec(src);
  check(!!winM && !!attM && !!budM && !!napM && !!minM,
        'قُرئت ثوابتُ الحلقة الخمسة من المصدر (فشلُ الاستخراج = عمى لا نجاح)');
  var worstLoginMs = -1;
  if (winM && attM && budM && napM && minM) {
    var MARGIN = Number(attM[1]), MINATT = Number(minM[1]);
    var NAP = Number(napM[1]), BASE = Number(budM[1]);
    var _planT = function (elapsed, budget) {
      var t = budget - elapsed - MARGIN;
      return (t < MINATT) ? 0 : t;
    };
    var worstFor = function (W) {
      var budget = BASE - W;
      // ① مسارُ المهلة: محاولةٌ واحدة تستهلك كلَّ المتبقّي ثمّ تخرج بلا إعادة.
      var timeoutPath = _planT(0, budget);
      // ② مسارُ فشلِ النقل السريع (‏≈0ms) ثمّ نومٌ ثمّ محاولةٌ ثانية.
      var e = 0;
      e += Math.min(NAP, Math.max(0, budget - e));
      e += _planT(e, budget);
      return W + Math.max(timeoutPath, e);
    };
    var worstAll = 0, w;
    for (w = 0; w <= Number(winM[1]); w += 100) {
      var t = worstFor(w);
      if (t > worstAll) worstAll = t;
      worstLoginMs = Math.max(worstLoginMs, t);   // نافذةُ الدخول هي الأوسع أصلاً
    }
    check(worstAll <= BASE,
          '🔴 الزمنُ الكلّي مسقوفٌ بالميزانية (' + worstAll + 'ms ≤ ' + BASE +
          'ms) مهما بلغ انتظارُ الطابور — الحارسُ يستشرف نهاية المحاولة');
    /* 🔒 ضابطٌ معاكس: المحاكاة تُميّز فعلاً. النموذجُ الذي **يُعيد المحاولة على المهلة**
       (‏ما كان قائماً حتى 2026-08-29) يجب أن يتجاوز السقف — وإلّا كانت المحاكاة
       تُصادق على أي شيء. وهذا بعينه ما كان يُنتج 502 المقيسة عند 24,339ms. */
    var worstIfRetryOnTimeout = function (W) {
      var budget = BASE - W, e = 0;
      for (var a = 0; a < 2; a++) {
        var t2 = _planT(e, budget);
        if (!t2) break;
        e += t2;                                  // مهلةٌ استهلكت كلَّ المتبقّي
        if (a < 1) e += NAP;                      // 🔴 ثمّ يُعيد المحاولة رغم المهلة
      }
      return W + e;
    };
    check(worstIfRetryOnTimeout(0) > BASE,
          '🔒 ضابط معاكس: نموذجُ «أعِد المحاولة على المهلة» يتجاوز الميزانية (' +
          worstIfRetryOnTimeout(0) + 'ms > ' + BASE + 'ms) — فالمحاكاة تُميّز لا تُصادق');
    LOGIN_WORST_MS = worstLoginMs;   // 🔗 يقرؤه حارسُ العقد المنشور
  }

  if (!gasOk) {
    console.log('  ⏭️  SKIPPED: مصدر GAS غير متاح (' + GAS + ') — لم تُطابَق أسماءُ الدخول عبر المستودعين');
    /* 🔴 **والتخطّي مشروطٌ بقيام بديله، وإلّا صار عمىً كاملاً يُقرأ تخطّياً بريئاً.**
       البديلُ عقدٌ منشورٌ يقرؤه CI الـGAS بلا توكن — وغيابُه **فشلٌ صريحٌ يُقرأ**. */
    check(fs.existsSync(path.join(__dirname, 'login-fns-contract.json')),
          '🔴 التخطّي مشروطٌ ببديله: `worker/login-fns-contract.json` منشورٌ ليقرأه CI الـGAS');
  }
  if (gasOk) {
    /* 🔴 **يُقرأ الموجودُ لا المفترَض — وقع الانهيارُ فعلاً 2026-09-10:** كانت القائمة
       `['teacher','student']` تُقرأ بلا فحصِ وجود، فلمّا حُذف `SchoolApp-gas/student/`
       (تقاعدُ المشروع بقرار المالك) **انهار الملفُّ كلُّه بـ`ENOENT`** — لا فحصٌ أحمرُ
       ولا `SKIPPED`، بل توقّفٌ قبل بلوغ بقيّة الفحوص.
       ⚠️ **وفحصُ `gasOk` أعلاه لم يمنعه**: يفحص `teacher/` وحدَه فيمرّ، ثمّ يُقرأ مجلدٌ
       ثانٍ غيرُ مفحوص ⇒ **حارسُ توفّرٍ يفحص أحدَ مدخلَيه**.
       🟢 والدلالةُ باقيةٌ بعد الفطم: دوالُّ الطالب لها توأمٌ منفَّذٌ في `teacher/`
       (‏`GAS.student = GAS.teacher`) ⇒ قراءةُ `teacher/` وحدَها تكفي، و`student/` يُقرأ
       **إن وُجد** بوصفه أرشيفاً لا مصدراً. */
    var apps = ['teacher', 'student'].filter(function (app) {
      try { return fs.statSync(path.join(GAS, app)).isDirectory(); } catch (e) { return false; }
    });
    check(apps.length > 0, 'ضابط: مجلدُ تطبيقٍ واحدٌ على الأقلّ قائم (صفرٌ = عمى لا نجاح) — ' +
                           'المقروء: ' + (apps.join(' · ') || 'لا شيء'));
    var defs = '';
    apps.forEach(function (app) {
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
    check(!!cliM, 'قُرئت مهلةُ العميل `_LOGIN_TIMEOUT` من مصدر GAS (فشلُ الاستخراج = عمى لا نجاح)');
    check(worstLoginMs > 0, 'ضابط: أسوأُ زمنٍ مُحاكىً مقيسٌ فعلاً قبل طرحه (‏' + worstLoginMs + 'ms)');
    if (cliM && worstLoginMs > 0) {
      var margin = Number(cliM[1]) - worstLoginMs;
      check(margin >= LOGIN_MARGIN_MIN_MS,
            '🔴 أسوأ زمنِ دخولٍ مُحاكىً (' + worstLoginMs + 'ms) تحت مهلة العميل (' +
            cliM[1] + 'ms) بهامش ' + margin + 'ms ≥ ' + LOGIN_MARGIN_MIN_MS);
    }
  }

  /* ═══ 🔴 ما لا يحتاج مصدرَ GAS خرج من فرعه — كان يُتخطّى في CI بلا أن يعلم أحد ═══
     الكتلةُ التالية تُشغّل دالّتَي المصدر نفسِه؛ **صفرُ مُدخَلٍ من المستودع الشقيق**،
     فتبويبُها خلف توفّره كان خطأً بنيويّاً لا مقايضة. */
  {
    /* ═══ سياسةُ المحاولة — سلوكيّاً عبر `vm` لا محاكاةً موازية ═══════════════════
       🔴 لماذا: المحاكاةُ أعلاه تُعيد كتابة المنطق في ملفّ الاختبار، فتصير حارساً
       يقيس **نسخته** لا الكود. هذا القسم يُشغّل الدالّتين الحقيقيّتين من المصدر —
       وغيابُهما **أحمر** لا تخطٍّ صامت. */
    var gIdx = src.indexOf('var GAS_MIN_ATTEMPT_MS');
    var gEnd = src.indexOf('\n}', src.indexOf('function _gasShouldRetry(')) + 2;
    check(gIdx >= 0 && gEnd > gIdx,
          'ضابط: استُخرجت كتلةُ سياسة المحاولة من المصدر (فشلُ الاستخراج = عمى لا نجاح)');
    if (gIdx >= 0 && gEnd > gIdx) {
      var gctx = vm.createContext({});
      vm.runInContext(src.slice(gIdx, gEnd), gctx);
      var plan  = vm.runInContext('_gasAttemptPlan', gctx);
      var retry = vm.runInContext('_gasShouldRetry', gctx);
      check(typeof plan === 'function' && typeof retry === 'function',
            'ضابط: الدالّتان قابلتان للتشغيل فعلاً (لا نصٌّ مستخرَجٌ فارغ)');

      // ① الجوهر: فشلُ المهلة لا يفتح تنفيذاً ثانياً على حصّةٍ مشبَعة (بند 128).
      check(retry(true, 0, 2) === false,
            '🔴 فشلُ المهلة **لا** يُعيد المحاولة — تنفيذُ GAS ما زال جارياً');
      // ② الضابطُ المعاكس: الحارسُ ليس سياجاً — فشلُ النقل السريع ما زال يُعيدها.
      check(retry(false, 0, 2) === true,
            '🔒 ضابط معاكس: فشلُ النقل السريع **ما زال** يُعيد المحاولة (لا سياج)');
      check(retry(false, 1, 2) === false,
            'المحاولةُ الأخيرة لا تُعيد مهما كان سببُ الفشل');

      // ③ الاستجابةُ البطيئة الناجحة صار لها متّسع: المقيس حيّاً 20,958ms نجح.
      var p0 = plan(0, 24000);
      check(p0.go === true && p0.timeoutMs > 11500,
            '🔴 مهلةُ المحاولة الأولى (' + p0.timeoutMs + 'ms) تتجاوز الثابتَ القديم ' +
            '11,500ms — الاستجابةُ المقيسة 20,958ms تصل بدل أن تُجهَض');
      check(p0.timeoutMs >= 20958,
            '🔴 وتسع القياسَ الحيّ نفسه (' + p0.timeoutMs + 'ms ≥ 20,958ms)');
      // ④ وسقفُ الـ24s محفوظٌ كما كان — لا تبدأ محاولةٌ تنتهي خارجه.
      check(plan(22500, 24000).go === false,
            '🔴 لا تبدأ محاولةٌ لا تنتهي داخل الميزانية — سقفُ 24,000ms محفوظ');
      check(plan(0, 24000).timeoutMs + 0 <= 24000,
            'مهلةُ المحاولة لا تتجاوز الميزانية نفسها أبداً');
    }
  }
})();

// ── مُصادِقُ إعادة التحقّق: `Last-Modified` (سلوكي عبر `vm`) ───────────────────
//
// 🔴 العلّة المقيسة: `/teacher/` = 2,016,145 حرفاً تُخدَم بلا أيّ مُصادِق وبـ`no-store` ⇒ كلّ
// فتحٍ يُنزّلها كاملةً. 🔴 وقياسٌ حيٌّ في نفس الجلسة أسقط `ETag` كخيارٍ نهائياً: الحافّة
// تُسقطه (الرأسُ المرآة وصل بنفس القيمة وهو غاب)، بينما `Last-Modified` **تمرّ**.
// ⚠️ سلوكيٌّ لا نصّي: `grep` يُثبت أن الدالّة مكتوبة، لا أن تغيّرَ الهوية **يُقدّم التاريخ
//    فعلاً** — وذاك هو الحارس المركزيّ هنا (بدونه تبقى مدرسةٌ بدّلت اسمَها على القديم أبداً).
console.log('');
console.log('مُصادِقُ إعادة التحقّق `Last-Modified` (سلوكي):');
(function () {
  var eIdx = src.indexOf('function _hourWindow(');
  var eEnd = src.indexOf('var BRAND_TTL_S');
  if (eIdx < 0 || eEnd <= eIdx) {
    console.log('  ❌ ضابط: تعذّر استخراج دوالّ المُصادِق — الفحص أجوف');
    failed++;
    return;
  }
  var ectx = vm.createContext({ Date: Date, Math: Math, Number: Number, String: String });
  vm.runInContext(src.slice(eIdx, eEnd), ectx);
  var lm = function (up, ts) {
    return vm.runInContext('_pageLastMod(' + JSON.stringify(up) + ',' + JSON.stringify(ts) +
                           ', 1756216800000)', ectx);
  };
  var UP = 'Wed, 26 Aug 2026 10:00:00 GMT';
  var UP_MS = Date.parse(UP);

  check(lm(UP, 0) === UP_MS, 'تاريخُ المنبع وحده ⇒ هو المُصادِق (نشرةُ CI تصل فوراً)');
  check(lm(UP, UP_MS + 60000) === UP_MS + 60000,
        '🔴 الحارس المركزيّ: تحديثُ الهوية **بعد** المنبع يُقدّم التاريخ ⇒ الزائر يرى الاسم الجديد');
  check(lm(UP, UP_MS - 60000) === UP_MS,
        '… وطابعُ هويةٍ أقدم لا يُرجِع التاريخ للوراء (الأحدثُ يحكم)');
  check(lm('', 0) === 1756216800000 - (1756216800000 % 3600000),
        'بلا أيّ مصدر ⇒ نافذةُ الساعة احتياطاً (لا مُصادِق مفقود)');
  check(lm(UP, 0) % 1000 === 0,
        '🔴 دقّةُ الثانية — لو بقيت الميلي-ثانية لصار `>=` كاذباً دوماً فلا 304 أبداً');
  check(lm('نصٌّ ليس تاريخاً', 0) === 1756216800000 - (1756216800000 % 3600000),
        '🔒 تاريخٌ تالف لا يُنتج NaN بل يسقط على الاحتياط');

  var ims = function (h, ms) {
    return vm.runInContext('_notModifiedSince(' + JSON.stringify(h) + ',' + ms + ')', ectx);
  };
  check(ims(new Date(UP_MS).toUTCString(), UP_MS) === true, 'المطابقة: نفس اللحظة ⇒ غيرُ معدَّل');
  check(ims(new Date(UP_MS + 60000).toUTCString(), UP_MS) === true, 'نسخةُ العميل أحدث ⇒ غيرُ معدَّل');
  check(ims(new Date(UP_MS - 60000).toUTCString(), UP_MS) === false,
        '🔒 الضابط المعاكس: نسخةُ العميل أقدم ⇒ **200 بالمحتوى الجديد** لا 304 كاذب');
  check(ims('', UP_MS) === false && ims(null, UP_MS) === false,
        '🔒 غيابُ الرأس لا يُطابِق (وإلّا رُدَّ 304 على أوّل زيارة بلا جسم)');
  check(ims('غير صالح', UP_MS) === false, '🔒 رأسٌ تالف لا يُطابِق');
  check(ims(new Date(UP_MS).toUTCString(), 0) === false, '🔒 بلا تاريخٍ عندنا لا 304');
})();

// ── سياسة التخزين، ومنعُ بقاء المِجَسّات ──────────────────────────────────────
console.log('');
console.log('سياسة التخزين ونظافةُ الرؤوس (بنيوي):');
(function () {
  check(/if \(isSwOrManifest\) \{[\s\S]{0,120}no-cache, no-store, must-revalidate/.test(src),
        '🔴 `sw.js` و`manifest` يبقيان `no-store` — عاملُ خدمةٍ مُكاشٌ بخطأ يُثبّت نفسه');
  check(/\} else if \(isHtml\) \{[\s\S]{0,120}'no-cache, must-revalidate'/.test(src),
        'HTML بـ`no-cache, must-revalidate` — السؤالُ في كلّ مرّة باقٍ، والجوابُ صار 304');
  check(src.indexOf("headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')") !== -1,
        'الأصولُ الثابتة بلا تغيير — لم يُمَسّ ما كان يعمل');
  check(src.indexOf("headers.delete('last-modified')") !== -1 &&
        /var _upstreamLastMod = ghResp\.headers\.get\('last-modified'\)/.test(src),
        '🔴 تاريخُ المنبع يُلتقَط قبل الحذف ثم يُحذَف — لا يُمرَّر كما هو (الهويةُ تُحقَن بعده)');
  check(/request\.method === 'GET' && !_newsId/.test(src),
        '🔴 `?news=` مستثنىً — نداءُ OG يتخطّاه الـbulkhead لا حتمياً فيتبدّل الجسم بلا سبب');
  check(/ghResp\.body\.cancel\(\)/.test(src),
        'جسمُ المنبع يُلغى عند 304 — لا تدفّقٌ مفتوح بلا قارئ');
  check(/'X-Brand-Ts'/.test(src),
        'طابعُ الهوية يُحفَظ في رأس مدخل الكاش — لا داخل الكائن المحقون في الصفحة');
  /* 🔴 حارسُ نظافة: مِجَسّان تشخيصيّان استُعملا في هذه الجلسة (`X-Page-Validator` ورأسُ
     `ETag`) وأُزيلا بعد الحسم. رأسٌ تشخيصيّ يبقى يصير حِملاً على كلّ طلبٍ للأبد، ولا
     شيء يذكّر به. */
  /* ⚠️ المطابقةُ على **الضبط** لا على الذِكر: التعليقُ الذي يوثّق القياس يذكر اسم المِجَسّ
     عمداً — وهو أنفعُ ما في الكتلة، لأنه يمنع إعادةَ محاولةِ `ETag` من الصفر. الممنوع أن
     يبقى الرأسُ **مضبوطاً** في الاستجابة. */
  check(!/headers\.set\('X-Page-Validator'/.test(src),
        '🔴 لا مِجَسّ تشخيصيّ متروك في مسار الإنتاج');
  check(src.indexOf("headers.set('ETag'") === -1,
        '🔴 لا `ETag` — الحافّة تُسقطه فيصير رأساً ميّتاً يُوهم بميزةٍ خامدة');
})();

// ── استردادُ المقاعد الذاتيّ في منظّم التزاحم (سلوكي عبر `vm`) ─────────────────
//
// 🔴 العلّة المقيسة التي يقفلها (‏2026-08-26): `min(n)` في سجلّات ٢٤ ساعة كان يصعد ولا ينزل
// ‏(82→87→90→98→99) ويبقى عند ٩٠ في دلوٍ فيه حدثان اثنان — سقّاطةٌ لا حمل. سببُها أن
// `finally` غير مضمون في Workers عند إلغاء الطلب (انقطاعُ العميل)، فيبقى المقعد محجوزاً
// للأبد. والأثر: `_bhCan` تُرجِع `false` دائماً فتتوقّف مسارات «افتحْ الآن أو تخطَّ» كلُّها.
// ⚠️ سلوكيٌّ لا نصّي عمداً: `grep` على `_bhReap` يُثبت أن الدالّة مكتوبة، لا أن المقعد
//    **يُستردّ فعلاً** ولا أن الحيَّ **لا يُستردّ** — والثاني هو الضابط المعاكس الذي يمنع
//    علاجاً يقتل طلبات قائمة.
console.log('');
console.log('منظّم التزاحم — استردادُ المقاعد الذاتيّ (سلوكي):');
(function () {
  var bIdx = src.indexOf('var BH_SEAT_TTL_MS');
  var qIdx = src.indexOf('function _bhLog(');
  if (bIdx < 0 || qIdx < 0 || qIdx <= bIdx) {
    console.log('  ❌ ضابط: تعذّر استخراج كتلة منظّم التزاحم — الفحص أجوف');
    failed++;
    return;
  }
  var bctx = vm.createContext({ Date: Date, setTimeout: setTimeout, clearTimeout: clearTimeout,
                                Math: Math, Promise: Promise, console: { log: function () {} },
                                JSON: JSON });
  // نأخذ الكتلة من ثابت العمر حتى ما قبل `_bhLog` — تشمل العدّادات والدوالّ الخمس.
  vm.runInContext(
    src.slice(bIdx, src.indexOf(';', bIdx) + 1) + '\n' +
    'var BH_ISO_GLOBAL = 8; var BH_ISO_APP = 5;\n' +
    src.slice(src.indexOf('var _bhN', bIdx), qIdx), bctx);

  var ttl = vm.runInContext('BH_SEAT_TTL_MS', bctx);
  check(ttl >= 24000 + 2000,
        '🔴 عمرُ المقعد (' + ttl + 'ms) فوق ميزانية الوسيط الكاملة بهامش — فلا يُسترَدّ مقعدُ طلبٍ حيّ');

  // ① مقعدٌ حُجز ولم يُحرَّر (محاكاةُ طلبٍ قُطع): يُستردّ بعد انقضاء عمره.
  vm.runInContext('_bhTake("teacher"); _bhTake("teacher");', bctx);
  check(vm.runInContext('_bhN', bctx) === 2, 'مقعدان محجوزان ⇒ n = 2');
  vm.runInContext('_bhSeats[0].at -= (BH_SEAT_TTL_MS + 1000);', bctx);
  vm.runInContext('_bhCan("teacher");', bctx);          // الفحص وحده يكفي للاسترداد
  check(vm.runInContext('_bhN', bctx) === 1,
        '🔴 المقعد المتقادم يُستردّ عند أوّل فحص ⇒ n = 1 (بلا هذا يتسرّب للأبد)');
  check(vm.runInContext('_bhApp.teacher', bctx) === 1,
        'العدّاد لكلّ تطبيق يُستردّ معه — لا يُترك متسرّباً وحده');
  check(vm.runInContext('_bhReaped', bctx) === 1,
        'عدّادُ الاسترداد يرتفع ⇒ التسرّب يصير مرئياً في السجلّ لا مُصلَحاً بصمت');

  // ② الضابط المعاكس — الأهمّ: مقعدٌ **حديث** لا يُمَسّ.
  vm.runInContext('_bhCan("teacher");', bctx);
  check(vm.runInContext('_bhN', bctx) === 1,
        '🔒 ضابط معاكس: المقعد الحيّ لا يُستردّ — الاسترداد لا يقتل طلباً قائماً');

  // ③ التحرير العاديّ يُسقط **مقعده هو** لا أيَّ مقعد، ويبقى الحساب متوازناً.
  //    (العقدُ تغيّر 2026-08-26: `_bhRelease` تأخذ كائن المقعد لا اسم التطبيق.)
  vm.runInContext('var _s1 = _bhSeats[0]; _bhRelease(_s1);', bctx);
  check(vm.runInContext('_bhN', bctx) === 0 && vm.runInContext('_bhSeats.length', bctx) === 0,
        'التحرير العاديّ يُفرغ المقعد والعدّاد معاً (لا تحريرٌ مزدوج)');

  // ④ تحريرٌ زائد لنفس المقعد لا يُنزل العدّاد تحت الصفر (فيمنح سعةً وهمية).
  vm.runInContext('_bhRelease(_s1);', bctx);
  check(vm.runInContext('_bhN', bctx) === 0,
        '🔒 تحريرٌ زائد لا يُنزل العدّاد تحت الصفر');

  /* ⑤ 🔒 **الضابط الحاسم للعقد الجديد** — مقعدٌ حُصد سلفاً ثمّ عاد طلبُه حيّاً فحرّر:
     يجب أن يكون **صفر إنقاص**، و**ألّا يُسقِط مقعد طلبٍ آخرَ حيّ**. قبل هذا العقد كان
     التحرير يُسقط «أقدم مقعدٍ لهذا التطبيق» ويُنقِص بلا شرط ⇒ إنقاصٌ مزدوج بعد الحصاد،
     ومقعدٌ حيٌّ يُسحَب من تحت صاحبه فيُحصَد أوانه. الاتجاه fail-open ⇒ قبولٌ فوق السقف،
     وهو غيرُ مقبولٍ الآن وقد صار السقف نافذاً (‏`BULKHEAD_MODE = on`). */
  vm.runInContext('var _a = _bhTake("teacher"); var _b = _bhTake("teacher");', bctx);
  vm.runInContext('_a.at -= (BH_SEAT_TTL_MS + 1000); _bhCan("teacher");', bctx);  // يُحصد _a وحده
  check(vm.runInContext('_bhN', bctx) === 1 && vm.runInContext('_bhSeats.indexOf(_b)', bctx) === 0,
        'تمهيد: المقعد المتقادم `_a` حُصد والحيّ `_b` باقٍ');
  vm.runInContext('_bhRelease(_a);', bctx);
  check(vm.runInContext('_bhN', bctx) === 1 && vm.runInContext('_bhApp.teacher', bctx) === 1,
        '🔒 تحريرُ مقعدٍ حُصد سلفاً ⇒ صفر إنقاص (لا احتساب مزدوج)');
  check(vm.runInContext('_bhSeats.indexOf(_b)', bctx) === 0,
        '🔒 ولا يُسقِط مقعد طلبٍ آخرَ حيّ — `_b` ما يزال قائماً');

  // ⑥ تحريرٌ بلا مقعد (‏`null`) لا يفعل شيئاً — يحرس مسارات «افتحْ الآن أو تخطَّ».
  vm.runInContext('_bhRelease(null);', bctx);
  check(vm.runInContext('_bhN', bctx) === 1,
        '🔒 `_bhRelease(null)` لا يُنقِص شيئاً — الإخفاق في الحجز لا يُحرّر مقعد غيره');

  /* ⑦ 🔴 **الدورةُ الكاملة عبر الطابور** — وهي المسارُ الذي تُنشئه هذه الدفعة أصلاً
     (بتفعيل `on` صار الانتظارُ شائعاً لا نظرياً)، وكان **بلا أي تغطية**.
     رصدَته المراجعة بطفرةٍ نجت: لو أعادت `_bhPump`/`_bhAcquire` القيمةَ `true` بدل كائن
     المقعد، لمرّ كلُّ شيءٍ أخضرَ بينما `_bhRelease(true)` تجد `indexOf === -1` فلا تُنقِص
     شيئاً ⇒ **إعادةُ إنتاج سقّاطة تسرّب المقاعد نفسها، والسقفُ نافذ هذه المرّة.** */
  /* ⚠️ **والوعدُ يُشَمّ متزامناً عمداً**: `.then` الحقيقيّ microtask يُنفَّذ **بعد** سطر
     `RESULT` النهائي فيصير الفحصُ زينةً لا حارساً (نفس فخّ `_slugIsKnown` أعلاه).
     الشيمُ يستدعي المستمعَ لحظةَ `resolve`. **ويُقاس قبل أن يُصدَّق حكمُه** — الضابطُ
     الأوّل أدناه يُثبت أنه يُطلق فعلاً، وإلّا بقي `_got` عند `"PENDING"` وكلُّ ما يليه أخضر. */
  vm.runInContext(
    'function SyncP(ex) { var s = this; s._d = false; s._v = undefined; s._c = [];\n' +
    '  ex(function (v) { s._d = true; s._v = v; for (var i = 0; i < s._c.length; i++) s._c[i](v); }); }\n' +
    'SyncP.prototype.then = function (cb) { if (this._d) cb(this._v); else this._c.push(cb); return this; };\n' +
    'SyncP.resolve = function (v) { return new SyncP(function (r) { r(v); }); };\n' +
    'Promise = SyncP;', bctx);
  /* ⚠️ التمهيدُ يحترم **السقفَين معاً**: ٥ لـ`home` (سقفُها الفرعيّ) + ٣ لـ`teacher` = ٨
     عالمياً. ملءُ الثمانية بتطبيقٍ واحد كان سيتجاوز السقف الفرعيّ فيحجب المنحَ لسببٍ
     آخر — سيناريو مستحيلٌ يُنتج فشلاً مضلِّلاً لا حراسة. */
  vm.runInContext('_bhN = 0; _bhApp = {}; _bhSeats = []; _bhQ = [];', bctx);
  vm.runInContext('for (var i = 0; i < BH_ISO_APP; i++) _bhTake("home");' +
                  'for (var j = 0; j < BH_ISO_GLOBAL - BH_ISO_APP; j++) _bhTake("teacher");', bctx);
  check(vm.runInContext('_bhN', bctx) === 8 && vm.runInContext('_bhApp.home', bctx) === 5,
        'تمهيد: السقفُ العالميّ ممتلئ (n = 8) بلا تجاوزِ سقفٍ فرعيّ');
  // طلبُ `teacher` يدخل الطابور (السقفُ العالميّ ممتلئ) ⇒ لا يُمنح فوراً.
  vm.runInContext('var _got = "PENDING"; _bhAcquire("teacher", 5000).then(function (s) { _got = s; });', bctx);
  check(vm.runInContext('_bhQ.length', bctx) === 1, 'الطلبُ الفائض ينتظر في الطابور لا يُرفض فوراً');
  check(vm.runInContext('_got', bctx) === 'PENDING', 'ولم يُمنَح بعد — الطابورُ طابورٌ فعلاً');
  // يُحرَّر مقعد ⇒ `_bhPump` تمنحه للمنتظِر في الحال.
  vm.runInContext('_bhRelease(_bhSeats[0]);', bctx);
  var got = vm.runInContext('_got', bctx);
  check(got !== 'PENDING', 'ضابطُ الشيم: المستمعُ أُطلق فعلاً (بقاؤه معلّقاً = أخضرُ بلا معنى)');
  check(got && typeof got === 'object' && got.app === 'teacher',
        '🔴 المنحُ من الطابور يُعيد **كائن مقعد** لا `true` (وإلّا تسرّب المقعد عند التحرير)');
  check(vm.runInContext('_bhN', bctx) === 8 && vm.runInContext('_bhQ.length', bctx) === 0,
        'الطابورُ فُرّغ والعدّاد ثابتٌ عند السقف (مقعدٌ خرج وآخرُ دخل)');
  vm.runInContext('_bhRelease(_got);', bctx);
  check(vm.runInContext('_bhN', bctx) === 7 && vm.runInContext('_bhSeats.indexOf(_got)', bctx) === -1,
        '🔒 تحريرُ المقعد المُمنَّح من الطابور يُنقِص فعلاً — الدورةُ متوازنة');
})();

// ── كاشُ الحافّة لنداءات GAS العامّة (سلوكي عبر `vm`) ──────────────────────────
//
// 🔴 لماذا سلوكيّ لا نصّي: `grep` على `_apiCacheProbe` يُثبت أن الدالّة مكتوبة، لا أنها
// **ترفض** جسماً بمفتاح `fn` مكرَّر ولا أنها **لا تُخزّن** ردّاً فاشلاً. والضوابط المعاكسة
// هنا هي الميزةُ كلّها: كاشٌ يُخزّن الخطأ يُثبّته ١٠ دقائق، وكاشٌ يخلط مستأجراً بآخر
// يسرّب بيانات مدرسةٍ إلى أخرى. كلاهما أسوأ من غياب الكاش أصلاً.
console.log('');
console.log('كاشُ الحافّة لنداءات GAS العامّة (سلوكي):');
(function () {
  var aIdx = src.indexOf('var API_CACHE_TTL_S');
  var aEnd = src.indexOf('\n}', src.indexOf('async function _apiCachePut(')) + 2;
  if (aIdx < 0 || aEnd <= 1 || aEnd <= aIdx) {
    console.log('  ❌ ضابط: تعذّر استخراج كتلة كاش الـAPI — الفحص أجوف');
    failed++;
    return;
  }
  /* تجريدُ `async`/`await` بنفس نمط `_slugIsKnown` — والدوالّ هنا كذلك بلا فروعٍ
     تعتمد توقيت الوعد. ⚠️ والتجريدُ يُقاس قبل أن يُصدَّق حكمُه. */
  var aSrc = src.slice(aIdx, aEnd).replace(/async function/g, 'function').replace(/await /g, '');
  var stripOk = aSrc.indexOf('await ') === -1 &&
                aSrc.indexOf('function _apiCacheProbe(') !== -1 &&
                aSrc.indexOf('API_CACHE_FNS[probe.fn].ok(b)') !== -1;
  check(stripOk, 'ضابط: تجريدُ `await` نجح والجسمُ باقٍ (تجريدٌ فارغ = أخضرُ بلا معنى)');
  if (!stripOk) return;

  var hits = { match: 0, put: 0 };
  var store = {};                      // url -> {text, ts}
  function FakeResponse(body, init) {
    this._t = body;
    var h = (init && init.headers) || {};
    this.headers = { get: function (k) { return h[k] === undefined ? null : h[k]; } };
    this.text = function () { return body; };
  }
  var actx = vm.createContext({
    Date: Date, JSON: JSON, Object: Object, Number: Number, String: String,
    encodeURIComponent: encodeURIComponent, Response: FakeResponse,
    Request: function (url) { this.url = url; },
    caches: { default: {
      match: function (req) { hits.match++; var e = store[req.url];
                              return e ? new FakeResponse(e.text, { headers: { 'X-Api-Ts': e.ts } }) : undefined; },
      put:   function (req, resp) { hits.put++; store[req.url] = { text: resp._t, ts: String(Date.now()),
                                                                  cc: resp.headers.get('Cache-Control') }; }
    } }
  });
  vm.runInContext(aSrc, actx);
  var probe = vm.runInContext('_apiCacheProbe', actx);
  var put   = vm.runInContext('_apiCachePut', actx);
  var get   = vm.runInContext('_apiCacheGet', actx);

  // ① القبول الأساسي.
  var pOk = probe(JSON.stringify({ fn: 'getHomePageBundle', args: ['abdaawatmuaz'] }));
  check(!!pOk && pOk.fn === 'getHomePageBundle', 'جسمٌ عامّ مؤهَّل يُقبَل');

  // ② 🔒 دالّةٌ خارج القائمة البيضاء — أي شيءٍ يحمل توكناً في `args` يسقط هنا.
  check(probe(JSON.stringify({ fn: 'getMyActivitiesProtected', args: ['tok'] })) === null,
        '🔒 دالّةٌ خارج القائمة البيضاء ⇒ لا كاش (الحمولاتُ ذات الجلسة تسقط هنا)');

  /* ③ 🔒 **الفخّ الذي أسقط الرجيكس سابقاً**: `JSON.parse` يأخذ **آخر** قيمةٍ لمفتاحٍ
     مكرَّر بينما الرجيكس يأخذ أوّلها ⇒ جسمٌ كهذا كان **سيُصيب الكاش باسمٍ ويُنفَّذ غيره**. */
  check(probe('{"fn":"getHomePageBundle","args":[""],"fn":"getMyActivitiesProtected"}') === null,
        '🔒 مفتاحُ `fn` مكرَّر ⇒ لا كاش (يُقرأ بـ`JSON.parse` لا برجيكس)');

  // ④ 🔒 مفتاحٌ إضافيّ مجهول = احتمالُ توكن ⇒ fail-closed.
  check(probe(JSON.stringify({ fn: 'getHomePageBundle', args: [''], token: 'x' })) === null,
        '🔒 مفتاحٌ إضافيّ مجهول في الجسم ⇒ لا كاش');

  /* ⑤ 🔒 وسيطٌ حرٌّ طويل يُفجّر فضاء المفاتيح. ⚠️ ودالّةٌ **مؤهَّلةٌ اسماً** تُرفض بـ
     `reject` لا بـ`null` — التمييزُ هو ما يجعل الرفض مسجَّلاً بدل أن تخمد الميزة بصمت. */
  var pLong = probe(JSON.stringify({ fn: 'getHomePageBundle', args: [new Array(300).join('a')] }));
  check(!!pLong && !pLong.argsKey && pLong.reject === 'args',
        '🔒 وسيطٌ حرٌّ طويل ⇒ لا كاش، ورفضٌ **مسجَّل** لا صامت');

  /* ⑤ب 🔒 حدُّ الطول يُقاس على النصّ **الخام** لا المُرمَّز: اسمُ صفٍّ عربيٍّ واقعيّ
     كان يتجاوز ٢٥٦ بعد `encodeURIComponent` (العربية ×6) فيسقط أكبرُ مستهلكٍ للميزة. */
  var pAr = probe(JSON.stringify({ fn: 'getHomeScheduleBundle', args: [{
    schoolId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    klass: 'الصف الأول الابتدائي', section: 'أ'
  }] }));
  check(!!pAr && !!pAr.argsKey,
        '🔴 اسمُ صفٍّ عربيٍّ واقعيّ يبقى مؤهَّلاً (الحدُّ على الخام لا المُرمَّز)');

  /* ⑤ج 🔴 **لا مدخلَ كاشٍ بلا هويّةِ مستأجر (2026-09-15).** المعرّفُ الفارغ كان يمرّ
     فيصير `sid=''` بُعداً مشروعاً ⇒ مدخلٌ واحدٌ بلا هويّة يخدم كلَّ من يطلب بلا هويّة.
     🔴 **والهويّةُ تسافر في موضعين مقيسَين مختلفين، والضابطُ يمسّ الاثنين:** حقلٌ أعلى
     للأغلبيّة، و`args[0].schoolId` لـ`getHomeScheduleBundle` وحدَها. */
  var pNoSid = probe(JSON.stringify({ fn: 'getHomePageBundle', args: [''] }));
  check(!!pNoSid && pNoSid.reject === 'sid' && !pNoSid.argsKey,
        '🔴 نداءٌ بلا هويّةِ مستأجرٍ **يُرفَض ولا يُخزَّن** — ورفضُه مسجَّلٌ لا صامت');
  var pSchedNoSid = probe(JSON.stringify({
    fn: 'getHomeScheduleBundle', args: [{ klass: 'الأول', section: 'أ' }] }));
  check(!!pSchedNoSid && pSchedNoSid.reject === 'sid',
        '🔴 وكائنُ الجدول بلا `schoolId` يُرفَض أيضاً — لا ثغرةَ من الشكل الثاني');

  /* 🔒 **ضابطٌ معاكسٌ مزدوجٌ — بلا أيٍّ منهما يصير التشديدُ تعطيلاً شاملاً يبدو أماناً.**
     ويمسّ **كلا موضعَي الهويّة**: لو فُرض الشرطُ على `args[0]` وحدَه (وقد جُرّب في هذا
     المرور فأحمرّ) لسقط الشكلُ الغالب؛ ولو فُرض على الحقل الأعلى وحدَه لسقط الجدول. */
  check(!!probe(JSON.stringify({ fn: 'getHomePageBundle', args: [''], schoolId: 'aaa' })).argsKey,
        '🔒 ضابط معاكس ①: الهويّةُ في **الحقل الأعلى** ⇒ يبقى مؤهَّلاً (‏`args[0]` فارغٌ مشروعاً)');
  check(!!pAr.argsKey,
        '🔒 ضابط معاكس ②: الهويّةُ **داخل كائن الوسائط** ⇒ يبقى مؤهَّلاً (شكلُ الجدول)');

  /* ⑥ 🔒 **عزلُ المستأجرين — يُقاس على `_apiCacheKey` نفسها لا على مخرَج المِجَسّ.**
     🔴 رصدَته المراجعة: مقارنةُ `argsKey` وحدها كانت تمرّ خضراءَ حتى مع `_apiCacheKey`
     تُسقِط `argsKey` من الـURL كلّياً — أي **كلُّ المدارس تتشارك مدخلاً واحداً**، تسريبُ
     مستأجرٍ إلى آخر بلا أن يحمرّ شيء. الضابطُ يجب أن يمسّ **المفتاح المخدوم**. */
  var keyOf = vm.runInContext('_apiCacheKey', actx);
  var k1 = probe(JSON.stringify({ fn: 'getTeacherSchoolBrand', args: [''], schoolId: 'aaa' })).argsKey;
  var k2 = probe(JSON.stringify({ fn: 'getTeacherSchoolBrand', args: [''], schoolId: 'bbb' })).argsKey;
  check(k1 !== k2, '`schoolId` يدخل في `argsKey`');
  check(keyOf('https://x', 'teacher', 'getTeacherSchoolBrand', k1).url !==
        keyOf('https://x', 'teacher', 'getTeacherSchoolBrand', k2).url,
        '🔒 مدرستان ⇒ **مفتاحا كاشٍ مختلفان** (لا يكفي اختلافُ `argsKey` وحده)');
  check(keyOf('https://x', 'teacher', 'getTeacherSchoolBrand', k1).url !==
        keyOf('https://x', 'student', 'getTeacherSchoolBrand', k1).url,
        '🔒 `app` داخل المفتاح ⇒ منصّتان لا تتشاركان مدخلاً');
  check(keyOf('https://x', 'teacher', 'getTeacherSchoolBrand', k1).url !==
        keyOf('https://x', 'teacher', 'getStudentSchoolBrand', k1).url,
        '🔒 `fn` داخل المفتاح ⇒ دالّتان لا تتشاركان مدخلاً');

  // ⑦ التخزين الناجح ثمّ الإصابة — والإصابةُ تُعيد النصّ **حرفياً**.
  hits.match = 0; hits.put = 0;
  var goodBrand = JSON.stringify({ ok: true, name: 'مدارس الإبداع', _ms: 6 });
  var pBrand = probe(JSON.stringify({ fn: 'getTeacherSchoolBrand', args: [''] }));
  check(put('https://x', 'teacher', pBrand, goodBrand) === true && hits.put === 1,
        'ردٌّ عامٌّ صالح ⇒ يُخزَّن مرّةً واحدة');
  var hit = get('https://x', 'teacher', pBrand);
  check(!!hit && hit.text === goodBrand,
        'الإصابةُ تُعيد النصّ الخام حرفياً (بذيل `_ms` الذي يستهلكه الجسر)');

  // ⑧ 🔒 لا كاش سلبيّ — تخزينُ الفشل يُثبّته ١٠ دقائق ويُقرأ «الإصلاح لم يعمل».
  hits.put = 0;
  check(put('https://x', 'teacher', pBrand, JSON.stringify({ ok: false, error: 'x' })) === false &&
        hits.put === 0, '🔒 ردُّ `ok:false` ⇒ صفر تخزين');

  // ⑨ 🔒 الاسمُ الفارغ لا يُخزَّن — «شاشة دخول بلا هوية أسوأ من العطل».
  hits.put = 0;
  check(put('https://x', 'teacher', pBrand, JSON.stringify({ ok: true, name: '' })) === false &&
        hits.put === 0, '🔒 `ok:true` باسمٍ فارغ ⇒ صفر تخزين');

  /* ⑩ 🔒 عقدٌ مختلف: `getHomeScheduleBundle` تُرجِع `{settings, schedule}` **بلا `ok`**.
     شرطٌ موحَّد كان سيُسقطها دائماً بصمت، أو يُخزّن أخطاءها. */
  var pSched = probe(JSON.stringify({ fn: 'getHomeScheduleBundle',
                                      args: [{ schoolId: '', klass: 'الأول', section: 'أ' }] }));
  check(!!pSched, 'وسيطٌ كائنيّ محصورُ المفاتيح يُقبَل (`getHomeScheduleBundle`)');
  hits.put = 0;
  check(put('https://x', 'student', pSched,
            JSON.stringify({ settings: { dayStart: '07:00' }, schedule: { ok: false, error: 'لا جدول' } })) === false &&
        hits.put === 0, '🔒 عضوٌ فاشل داخل الحزمة ⇒ صفر تخزين');
  check(put('https://x', 'student', pSched,
            JSON.stringify({ settings: { dayStart: '07:00' }, schedule: { rows: [] } })) === true,
        'حزمةٌ بعضوَين صالحَين تُخزَّن رغم غياب `ok` — العقدُ لكلّ دالّة على حدة');

  // ⑪ 🔒 وسيطٌ كائنيّ بمفتاحٍ خارج المحصورة — وهو المسارُ الذي يحمل توكناً لو حمله.
  var pTok = probe(JSON.stringify({ fn: 'getHomeScheduleBundle', args: [{ token: 'x' }] }));
  check(!!pTok && !pTok.argsKey, '🔒 وسيطٌ كائنيّ بمفتاحٍ مجهول ⇒ لا كاش');

  // ⑫ إخفاقُ الكاش يُرجِع null لا يرمي.
  check(get('https://x', 'teacher', probe(JSON.stringify({ fn: 'getStudentSchoolBrand', args: ['zzz'] }))) === null,
        'إخفاقُ الكاش يُرجِع `null` بلا رمي');

  /* ⑬ 🔴 **بوّابةُ الطزاجة — الفرضُ انتقل من `caches.match` إلينا (2026-09-12).**
     `_apiCachePut` صار يخزّن بعمرٍ **أطول** من الطزاجة كي يبقى البائتُ مطابَقاً للتراجع
     ⇒ **`match` لم تعُد تُهمل البائتَ**، فلو خُدِم بلا بوّابةٍ صار **إصابةً طازجةً بصمت**:
     الصفحةُ تعمل، والبياناتُ قديمةٌ، ولا شيء يحمرّ — انحدارٌ أخطرُ من العطل الأصليّ.
     **ولماذا سلوكيّةٌ لا نصّية:** `grep` يُثبت أن الدالّةَ مكتوبة، لا أنها تصنّف `ttl+1`
     بائتاً، ولا أنها تقرأ **جدولَ الدوالّ** بدل ثابتٍ موحَّد. */
  var freshOf  = vm.runInContext('_apiCacheFreshness', actx);
  var ttlOf    = vm.runInContext('_apiTtlFor', actx);
  var staleMax = vm.runInContext('API_STALE_MAX_S', actx);
  var gateOk = typeof freshOf === 'function' && typeof ttlOf === 'function' && staleMax > 0;
  check(gateOk, 'ضابط: بوّابةُ الطزاجة قابلةٌ للتشغيل فعلاً (وإلّا الفحصُ أجوف)');
  if (gateOk) {
    var tHome = ttlOf('getHomePageBundle');
    check(freshOf('getHomePageBundle', 0) === 'fresh' &&
          freshOf('getHomePageBundle', tHome) === 'fresh',
          'عمرٌ داخل الطزاجة ⇒ `fresh` (والحدُّ شامل)');
    check(freshOf('getHomePageBundle', tHome + 1) === 'stale' &&
          freshOf('getHomePageBundle', tHome + staleMax) === 'stale',
          '🔴 بعد الطزاجة وداخل نافذة البيات ⇒ `stale` **لا** `fresh`');
    check(freshOf('getHomePageBundle', tHome + staleMax + 1) === 'expired',
          '🔒 بعد نافذة البيات ⇒ `expired` — البياتُ محدودٌ لا مفتوح');
    /* 🔒 fail-closed: `_apiCacheGet` يعيد `age = -1` لمدخلٍ بلا `X-Api-Ts`. ولو قُرئ
       `fresh` لخُدِم محتوىً **مجهولُ العمر** أبداً — وهو أسوأُ من غياب الميزة كلِّها. */
    check(freshOf('getHomePageBundle', -1) === 'expired' &&
          freshOf('getHomePageBundle', undefined) === 'expired',
          '🔒 عمرٌ مجهول ⇒ `expired` (fail-closed) لا `fresh`');
    /* 🔴 **أقوى ضابطٍ في المجموعة:** يُثبت أن البوّابةَ تقرأ الجدولَ لا ثابتاً واحداً.
       `getHomeScheduleBundle` طزاجتُها 1800 و`getHomePageBundle` 120 ⇒ عمرُ 600 **طازجٌ
       للأولى وليس للثانية**. وثابتٌ موحَّدٌ يجعلهما متساويَين فيحمرّ هذا وحدَه. */
    check(ttlOf('getHomeScheduleBundle') !== tHome,
          'ضابط: الدالّتان مختلفتا الطزاجة أصلاً (وإلّا الفحصُ التالي بلا معنى)');
    check(freshOf('getHomeScheduleBundle', 600) === 'fresh' &&
          freshOf('getHomePageBundle', 600) !== 'fresh',
          '🔴 الطزاجةُ **لكلّ دالّةٍ من جدولها** لا ثابتٌ موحَّد');

    /* ⑭ 🔴 العمرُ المخزَّن = طزاجة + بيات. ورجوعُه إلى `ttl` وحده يبدو تضييقاً آمناً
       **وهو يُسقط التراجعَ صامتاً**: يعود البائتُ إلى الإهمال فيعود الـ٥٠٢ بلا أن يحمرّ شيء. */
    put('https://x', 'teacher', pBrand, goodBrand);
    var ccKey = keyOf('https://x', 'teacher', 'getTeacherSchoolBrand', pBrand.argsKey).url;
    check(!!store[ccKey] &&
          store[ccKey].cc === 'max-age=' + (ttlOf('getTeacherSchoolBrand') + staleMax),
          '🔴 `Cache-Control` = طزاجة+بيات — لا الطزاجةَ وحدها');
  }

  /* ⑮ 🟢 **`checkAppVersion` — الاستثناءُ الوحيدُ من «لا كاشَ بلا هويّة» (2026-09-17).**
     التطبيقُ يرسل `{fn,args:[pkg]}` بلا `schoolId` ⇒ بلا `tenantless` يُرفض كلُّ نداء.
     🔴 **والضوابطُ المعاكسةُ هي الفحص:** الاستثناءُ لا يتسرّب إلى دالّةٍ أخرى، ولا يقبل
     وسيطاً غيرَ اسمِ حزمة، ولا يُثبّت «غيرَ مضبوط» ساعة. */
  var PKG = 'com.proconrers.schoolappyemen';
  var pVer = probe(JSON.stringify({ fn: 'checkAppVersion', args: [PKG] }));
  check(!!pVer && !!pVer.argsKey && !pVer.reject,
        '🟢 `checkAppVersion` بلا `schoolId` ⇒ مؤهَّلٌ (شكلُ `UpdateChecker.kt` حرفياً)');
  check(!!pNoSid && pNoSid.reject === 'sid',
        '🔒 ضابط معاكس: الاستثناءُ **لا يتسرّب** — `getHomePageBundle` بلا هويّة ما زال يُرفض');
  var pVer2 = probe(JSON.stringify({ fn: 'checkAppVersion', args: ['com.yemenschoolz.app'] }));
  check(!!pVer2 && pVer2.argsKey !== pVer.argsKey,
        '🔒 حزمتان ⇒ مفتاحان — لا يخدم تطبيقٌ إصدارَ الآخر');
  var pVerBad = probe(JSON.stringify({ fn: 'checkAppVersion', args: ['{"t":"x"}'] }));
  var pVerTwo = probe(JSON.stringify({ fn: 'checkAppVersion', args: [PKG, 'tok'] }));
  check(!!pVerBad && pVerBad.reject === 'args' && !!pVerTwo && pVerTwo.reject === 'args',
        '🔒 وسيطٌ ليس اسمَ حزمة، أو وسيطٌ ثانٍ ⇒ رفضٌ مسجَّل');

  /* ⑯ 🟢 **`argTenant` — `args[0]` هويّةُ `getHomePageBundle` (2026-09-19).** صفحةُ الـslug
     ترسل `{args:['<slug>'], schoolId:null}` فكانت تُرفض `sid` وتذهب كلُّ زيارةٍ إلى GAS.
     🔴 والضوابطُ المعاكسة: الاستثناءُ لا يتسرّب إلى دالّةٍ أخرى، ولا يقبل غيرَ slug/UUID،
     ومدرستان ⇒ مفتاحان. */
  var pSlug = probe(JSON.stringify({ fn: 'getHomePageBundle', args: ['abdaawatmuaz'], schoolId: null }));
  check(!!pSlug && !!pSlug.argsKey && !pSlug.reject,
        '🟢 `getHomePageBundle` بـslug في `args[0]` وبلا `schoolId` ⇒ مؤهَّل');
  var pUuid = probe(JSON.stringify({ fn: 'getHomePageBundle', args: ['0f8fad5b-d9cb-469f-a165-70867728950e'] }));
  check(!!pUuid && !!pUuid.argsKey, '🟢 وبـUUID في `args[0]` ⇒ مؤهَّل');
  var pSlug2 = probe(JSON.stringify({ fn: 'getHomePageBundle', args: ['ibn-khaldoun'], schoolId: null }));
  check(!!pSlug2 && pSlug2.argsKey !== pSlug.argsKey,
        '🔒 مدرستان بـslug ⇒ مفتاحان — لا تخدم مدرسةٌ حمولةَ أخرى');
  var pUpper = probe(JSON.stringify({ fn: 'getHomePageBundle', args: ['AbdaaWatMuaz'] }));
  var pSpace = probe(JSON.stringify({ fn: 'getHomePageBundle', args: ['a b'] }));
  var pSlash = probe(JSON.stringify({ fn: 'getHomePageBundle', args: ['x/../y'] }));
  check(!!pUpper && pUpper.reject === 'sid' && !!pSpace && pSpace.reject === 'sid' &&
        !!pSlash && pSlash.reject === 'sid',
        '🔒 بوّابةُ الشكل لا تُرخى: أحرفٌ كبيرة · مسافة · شرطة مائلة ⇒ `reject:sid`');
  check(!!pNoSid && pNoSid.reject === 'sid',
        '🔒 ضابط معاكس: `args[0]` الفارغ ما زال يُرفض');
  var pBrandSlug = probe(JSON.stringify({ fn: 'getTeacherSchoolBrand', args: ['abdaawatmuaz'] }));
  check(!!pBrandSlug && pBrandSlug.reject === 'sid',
        '🔒 ضابط معاكس: `argTenant` **لا يتسرّب** — `getTeacherSchoolBrand` بـ`args[0]` وحده ما زال يُرفض');

  /* ⑰ 🟢 **`getPublicPlansPublic` — `tenantless` بلا وسائط (2026-09-19).** */
  var pPlans = probe(JSON.stringify({ fn: 'getPublicPlansPublic', args: [] }));
  check(!!pPlans && !!pPlans.argsKey && !pPlans.reject,
        '🟢 `getPublicPlansPublic` بلا وسائط ولا `schoolId` ⇒ مؤهَّل');
  var pPlansArg = probe(JSON.stringify({ fn: 'getPublicPlansPublic', args: ['x'] }));
  check(!!pPlansArg && pPlansArg.reject === 'args', '🔒 وبوسيطٍ ⇒ رفضٌ مسجَّل');
  var pPricing = probe(JSON.stringify({ fn: 'getPublicPricingPublic', args: [] }));
  check(!!pPricing && !!pPricing.argsKey && !pPricing.reject,
        '🟢 `getPublicPricingPublic` بلا وسائط ولا `schoolId` ⇒ مؤهَّل');
  var pPricingArg = probe(JSON.stringify({ fn: 'getPublicPricingPublic', args: ['x'] }));
  check(!!pPricingArg && pPricingArg.reject === 'args', '🔒 وبوسيطٍ ⇒ رفضٌ مسجَّل');
  /* شرطُ التخزين سلوكياً — بالشكل الذي أرسلته جلسة الخلفية حرفياً (gas#1632). */
  var FNS = vm.runInContext('API_CACHE_FNS', actx);
  ['getPublicPlansPublic', 'getPublicPricingPublic'].forEach(function (fn) {
    var okf = FNS[fn] && FNS[fn].ok;
    check(!!okf && okf({ ok: true, plans: [{ id: 'p1' }], trial: null, discounts: {}, services: null, terms: null, notes: null }) === true,
          '🟢 `' + fn + '`: ردٌّ ناجحٌ بباقة واحدة ⇒ يُخزَّن (والحقولُ `null` المشروعة لا تمنعه)');
    check(!!okf && okf({ ok: true, plans: [] }) === false && okf({ ok: false, plans: [{ id: 'p1' }] }) === false &&
          okf({ ok: true }) === false,
          '🔒 `' + fn + '`: بلا باقات · `ok:false` · بلا حقل ⇒ **لا يُخزَّن** (لا قسمَ أسعارٍ فارغاً عشرَ دقائق)');
    check(!!FNS[fn] && FNS[fn].ttl === 600 && FNS[fn].tenantless === true,
          '`' + fn + '`: ‏600ث و`tenantless`');
  });
  check(probe(JSON.stringify({ fn: 'checkAppVersion', args: [PKG], token: 'x' })) === null,
        '🔒 مفتاحٌ إضافيّ في الجسم ⇒ لا كاش (الاستثناءُ لا يُرخي فحصَ الجسم)');
  hits.put = 0;
  check(put('https://x', 'teacher', pVer, JSON.stringify({ result: { latestVersionCode: 36,
          minSupportedVersionCode: 0, playUrl: 'p', updateMessage: '' } })) === true && hits.put === 1,
        'ردٌّ بـ`latestVersionCode: 36` ⇒ يُخزَّن');
  var vHit = get('https://x', 'teacher', pVer);
  check(!!vHit && vHit.text.indexOf('"latestVersionCode":36') !== -1,
        '🟢 الإصابةُ تخدم الإصدارَ بلا GAS');
  hits.put = 0;
  check(put('https://x', 'teacher', pVer2, JSON.stringify({ latestVersionCode: 0 })) === false &&
        put('https://x', 'teacher', pVer2, JSON.stringify({ ok: false, error: 'x' })) === false &&
        hits.put === 0,
        '🔒 `latestVersionCode: 0` («غيرُ مضبوط») أو خطأ ⇒ صفرُ تخزين');
  /* ⑯-أ 🟢 **`getAppUrls` — خريطةُ مداخلِ تطبيقٍ منشور (2026-09-18).**
     المقيس: 5,843 و10,584ms ذهاباً وإياباً مقابل `_ms: 5` في GAS ⇒ كلُّه انتظارُ طابور.
     🔒 والضوابطُ المعاكسة: أيُّ وسيطٍ يُرفض · وخريطةٌ ناقصةٌ أو بغير `https` لا تُخزَّن. */
  var pUrls = probe(JSON.stringify({ fn: 'getAppUrls' }));
  check(!!pUrls && !!pUrls.argsKey && !pUrls.reject,
        '🟢 `getAppUrls` بلا وسائط وبلا هويّة ⇒ مؤهَّل');
  check(!!probe(JSON.stringify({ fn: 'getAppUrls', args: ['abdaawatmuaz'] })) &&
        probe(JSON.stringify({ fn: 'getAppUrls', args: ['abdaawatmuaz'] })).reject === 'args',
        '🔒 ضابط معاكس: وسيطٌ (‏`school`) ⇒ رفضٌ مسجَّل ويمرّ حيّاً بلا كاش');
  var goodUrls = JSON.stringify({ result: { success: true, data: {
    home: 'https://yemenschoolz.com/home/index.html',
    teacher: 'https://yemenschoolz.com/teacher/index.html',
    student: 'https://yemenschoolz.com/student/index.html',
    cms: 'https://yemenschoolz.com/cms/index.html' } } });
  hits.put = 0;
  check(put('https://x', 'teacher', pUrls, goodUrls) === true && hits.put === 1,
        'خريطةٌ كاملةٌ بـ`https` ⇒ تُخزَّن');
  hits.put = 0;
  check(put('https://x', 'teacher', pUrls, JSON.stringify({ result: { success: true, data: {
          home: 'https://y/h', teacher: 'https://y/t' } } })) === false &&
        put('https://x', 'teacher', pUrls, JSON.stringify({ result: { success: true, data: {
          home: 'http://y/h', teacher: 'http://y/t', student: 'http://y/s' } } })) === false &&
        put('https://x', 'teacher', pUrls, JSON.stringify({ success: false })) === false &&
        hits.put === 0,
        '🔒 خريطةٌ ناقصةٌ (بلا `student`) · أو `http` · أو فاشلة ⇒ صفرُ تخزين');
  if (gateOk) {
    check(ttlOf('getAppUrls') === 3600 && freshOf('getAppUrls', 3601) === 'stale',
          '🔴 طزاجةٌ ساعةٌ: تغييرُ خريطةِ المسارات يظهر خلالها');
  }

  /* ⑯ 🟢 **`listPartnerSchoolsPublic` — بلا وسائط وبلا مستأجر (2026-09-17).**
     🔒 والضوابطُ المعاكسة: أيُّ وسيطٍ يُرفض (فضاءُ المفاتيح يبقى مفتاحاً واحداً)،
     والدليلُ الفارغ لا يُخزَّن (يُقرأ عطلاً لا حالة). */
  var pPart = probe(JSON.stringify({ fn: 'listPartnerSchoolsPublic', args: [] }));
  check(!!pPart && !!pPart.argsKey && !pPart.reject,
        '🟢 `listPartnerSchoolsPublic` بلا وسائط وبلا هويّة ⇒ مؤهَّل');
  var pPartNull = probe(JSON.stringify({ fn: 'listPartnerSchoolsPublic' }));
  check(!!pPartNull && !!pPartNull.argsKey,
        '🟢 وبلا حقل `args` إطلاقاً ⇒ مؤهَّل (الشكلُ الذي يرسله الجسر)');
  var pPartArg = probe(JSON.stringify({ fn: 'listPartnerSchoolsPublic', args: ['x'] }));
  check(!!pPartArg && pPartArg.reject === 'args',
        '🔒 ضابط معاكس: أيُّ وسيطٍ ⇒ رفضٌ مسجَّل (مفتاحٌ واحدٌ لا فضاءُ مفاتيح)');
  hits.put = 0;
  check(put('https://x', 'home', pPart, JSON.stringify({ result: { success: true,
          schools: [{ schoolId: 'a', name: 'مدرسة' }], total: 1 } })) === true && hits.put === 1,
        'دليلٌ بمدرسةٍ واحدةٍ على الأقلّ ⇒ يُخزَّن');
  hits.put = 0;
  check(put('https://x', 'home', pPart, JSON.stringify({ success: true, schools: [], total: 0 })) === false &&
        put('https://x', 'home', pPart, JSON.stringify({ success: false, error: 'x' })) === false &&
        hits.put === 0,
        '🔒 دليلٌ فارغٌ أو فاشل ⇒ صفرُ تخزين');
  if (gateOk) {
    check(ttlOf('listPartnerSchoolsPublic') === 120 &&
          freshOf('listPartnerSchoolsPublic', 121) === 'stale',
          '🔴 طزاجةٌ ١٢٠ث: مدرسةٌ جديدةٌ تظهر في الدليل خلال دقيقتين (لا قناةَ إبطالٍ للحافّة)');
    check(ttlOf('checkAppVersion') === 3600 &&
          freshOf('checkAppVersion', 3600) === 'fresh' &&
          freshOf('checkAppVersion', 3601) === 'stale',
          '🔴 تغييرُ الخاصيّة يظهر بعد ساعة: بعد `ttl` لا يُخدَم المدخلُ طازجاً (يُعاد إلى GAS)');
  }
})();

/* ── 🔴 موضعُ الاعتراض — بنيويّ لا سلوكيّ، وهو نصفُ الميزة ─────────────────────
   إصابةُ الكاش يجب أن تسبق `_bhAcquire`، وإلّا أنفقت أنجحُ حالةٍ أغلى مورد (مقعداً من
   حصّة Google) بلا أن تلمس GAS أصلاً. ولا يُقاس هذا سلوكياً بلا محاكاة المعالج كلّه. */
console.log('');
console.log('كاشُ الحافّة — موضعُ الاعتراض (بنيوي):');
(function () {
  var gIdx = src.indexOf("if (path.indexOf('/gas/') === 0");
  if (gIdx < 0) gIdx = src.indexOf('var _acProbe');
  /* الحدُّ الأعلى **معلَّمٌ بسجلّ `ev:'gas'`** (آخرُ سطرٍ في المعالج) لا برقمٍ ثابت:
     نافذةٌ بطولٍ ثابت تنكمش تحت الكتلة كلّما نما الملفّ فتصير الضوابطُ خضراءَ بلا معنى. */
  var gEnd = src.indexOf("ev: 'gas'", gIdx);
  var seg = src.slice(gIdx, gEnd > gIdx ? gEnd : gIdx + 9000);
  var iProbe = seg.indexOf('_apiCacheProbe(init.body)');
  var iAcq   = seg.indexOf('_bhAcquire(app');
  check(iProbe > -1 && iAcq > -1 && iProbe < iAcq,
        '🔴 الاعتراضُ **قبل** حجز المقعد — الإصابةُ لا تستهلك من السقف');
  /* 🔴 الشرطُ **أقوى** من إعفاء الصحّة وحدها ويشمله: استعلامٌ فارغٌ حصراً. سببُه المزدوج:
     (‏١) `?action=health` أداةُ تشخيصٍ تُجيب من كاشٍ تُخفي بالضبط ما نُشخّصه بها؛
     (‏٢) الوسيط يمرّر `url.search` حرفياً إلى GAS وهي ليست في المفتاح ⇒ بُعدُ تسميمٍ
     مفتوحٌ لأوّل دالّةٍ تقرأ `e.parameter`. الاشتراطُ يقفل الاثنين معاً. */
  check(/url\.search === ''[\s\S]{0,200}_apiCacheProbe/.test(seg),
        "🔴 الكاشُ مقصورٌ على استعلامٍ فارغ — يُعفي `?action=health` ويقفل تسميمَ الاستعلام معاً");
  check(seg.indexOf('ctx.waitUntil(_apiCachePut(') > -1,
        'التخزينُ في `ctx.waitUntil` — خارج مسار الاستجابة فلا يُبطئ نداءً');
  check(/_acProbe && good && ctx/.test(seg),
        '🔒 التخزين مشروطٌ بـ`good` أيضاً — نقلٌ فاشل أو HTML لا يُخزَّن');

  /* ── 🔴 التراجعُ إلى نسخةٍ بائتة (2026-09-12) — نصّيٌّ **بحدٍّ يُقال** ─────────────
     المعالجُ دالّةُ `fetch` كاملةٌ ولا تُحاكى في هذا الملفّ، فالمقيسُ هنا **صيغةُ الشرط
     وترتيبُه** لا سلوكُه. 🟢 **والسلوكُ مقيسٌ حيث يمكن:** بوّابةُ الطزاجة (⑬ أعلاه)
     سلوكيّةٌ بـ`vm` بستّة فحوصٍ — فلا يُقرأ هذا القسمُ وحدَه شهادةً على الميزة. */
  check(/_apiCacheFreshness\(_acProbe\.fn, _acHit\.age\)/.test(seg),
        '🔴 الإصابةُ تمرّ بالبوّابة — لا تُخدَم بمجرّد وجود المدخل');
  var iGate = seg.indexOf('_apiCacheFreshness');
  var iHit  = seg.indexOf("act: 'hit'");
  check(iGate > -1 && iHit > -1 && iGate < iHit,
        '🔒 ضابط معاكس: البوّابةُ **تسبق** خدمةَ الإصابة');
  check(/if \(!good && _bhWhy === 'abort_budget' && _acProbe && _acStale\)/.test(seg),
        '🔴 التراجعُ البائت مشروطٌ بـ`abort_budget` لا بـ`!good` وحده');
  /* 🔒 ضابطٌ معاكس للصيغة الخطأ بعينها: لو كان الشرطُ `!good` وحدَه لخُدِمت نسخةٌ قديمةٌ
     فوق `upstream_status` (‏دالّةٌ أخفقت) و`upstream_html` (‏اعتراضُ Google) ⇒ **إخفاءُ
     عطلٍ حقيقيّ** بدل سدِّ فجوةِ إشباع. */
  check(!/if \(!good && _acStale\)/.test(seg) && !/if \(_acStale\)/.test(seg),
        '🔒 ضابط معاكس: صفرُ صيغةٍ تخدم البائتَ بلا شرط السبب');
  check(seg.indexOf("act: 'stale'") > -1 && seg.indexOf("'X-Api-Stale'") > -1,
        'التراجعُ مرئيٌّ في السجلّ (`act:stale`) وفي الردّ (`X-Api-Stale`)');
  /* 🔴 وقياسُ الإشباع يبقى صادقاً على المنبع: لو قلب التراجعُ `good` لانخفض عدّادُ
     `abort_budget` **بلا أن يتحسّن الإشباع**، فيُبنى قرارُ نشرٍ حيّ على رقمٍ كاذب. */
  var iStale = seg.indexOf("act: 'stale'");
  var staleBlk = iStale > -1 ? seg.slice(Math.max(0, iStale - 400), iStale + 600) : '';
  check(iStale > -1 && staleBlk.indexOf('good = true') === -1,
        '🔒 التراجعُ لا يقلب `good` — عدّادُ الإشباع يبقى على المنبع');
})();

/* ── 🔴 `BULKHEAD_MODE` — تطابقُ الإعدادِ المنشور مع الكود ومع الوثيقة ────────────
   **لماذا هنا لا في مستودع الـGAS:** وثائقُ `SchoolApp-gas` قالت ثلاثَ مرّات
   «`BULKHEAD_MODE = off` معطَّلٌ عمداً · التفعيل محظور»، **والقيمةُ لم تكن `off` قطّ**
   (قِيس بالأثر 2026-09-03 · `gas#1410`). وأيُّ حارسٍ يُكتب هناك **لا يقرأ**
   `SchoolApp/wrangler.jsonc` فيقارن نصّاً بنصّ ⇒ **أجوفُ بالتعريف**.

   🔴 **والمقارنةُ ثلاثيّةٌ عمداً، ومصدرُ الحقيقة `wrangler.jsonc` وحده** (هو ما يُنشَر):
   ① القيمةُ المضبوطة **وضعٌ يتفرّع إليه الكودُ فعلاً** — والمجموعةُ **تُشتقّ من المصدر**
      لا تُكتب هنا، وإلّا تقادمت كما تقادم كلُّ ثابتٍ منسوخ.
   ② **افتراضُ الكود** (`|| 'on'`) = **الافتراضُ المُعلَن في `CLAUDE.md`**.
   ③ **القيمةُ المضبوطة = المُعلَنة في `CLAUDE.md`** — وهي العلّةُ التي وقعت.
   ولكلِّ فحصٍ **ضابطُه المعاكس** أدناه: بلاها يمرّ القسمُ أخضرَ لأنه لم يقِس شيئاً. */
console.log('');
console.log('‏`BULKHEAD_MODE` — الإعدادُ مقابل الكود والوثيقة:');
(function () {
  var WR = path.join(__dirname, '..', 'wrangler.jsonc');
  var MD = path.join(__dirname, '..', 'CLAUDE.md');
  if (!fs.existsSync(WR) || !fs.existsSync(MD)) {
    check(false, '🔴 `wrangler.jsonc` و`CLAUDE.md` موجودان — غيابُ أحدهما فشلٌ لا تخطٍّ صامت');
    return;
  }
  var wrSrc = fs.readFileSync(WR, 'utf8');
  var mdSrc = fs.readFileSync(MD, 'utf8');

  /* القارئات الثلاث دوالُّ نقيّة — يُعاد استعمالها في الضوابط المعاكسة بنصٍّ مطفور. */
  function cfgOf(s)  { var m = /"BULKHEAD_MODE"\s*:\s*"([^"]*)"/.exec(s); return m && m[1]; }
  function codeOf(s) { var m = /env\.BULKHEAD_MODE\)\s*\|\|\s*'([^']*)'/.exec(s); return m && m[1]; }
  /* 🔴 الارتساءُ على **علامةٍ تُعلن أنها مقروءةٌ آلياً** لا على النثر — صُحِّح 2026-09-12
     بعد عطلٍ وقع فعلاً: كان يطابق ``env.BULKHEAD_MODE` ∈ `on` (الافتراضي)`` في النثر،
     و**تغليظُ الصياغة وحدَه** (نقلُ `**` فصار بين الـbacktick و`∈`) أسقط المطابقةَ
     ⇒ `RESULT: ❌ 4 فشل` **على عملٍ سليمٍ تماماً**.
     🎯 والعلاجُ نقلُ العقد من التنسيق إلى العلامة: **النثرُ صار حرّاً**، والعلامةُ
     تُجاور ما تحكمه فيراها مَن ينقل الكتلة. و`check(!!doc)` أدناه يُبقي **الغيابَ فشلاً**
     فلا ينقلب المِجَسُّ إلى النوع الأعمى (الذي يخضرّ على العدم). §١٤ `_docs/قواعد-التنظيف.md`. */
  function docOf(s)  { var m = /probe:BULKHEAD_MODE_DEFAULT=([a-z]+)/.exec(s); return m && m[1]; }
  /* 🔴 المجموعةُ المشروعة **مُشتقّةٌ من فروع المصدر** (`mode === 'x'` · `mode !== 'x'`)
     زائداً افتراضَ الكود — فلا تُكتب قائمةٌ تتقادم. */
  function modesOf(s) {
    var set = {}, re = /\b_?(?:bh)?[Mm]ode\s*[!=]==\s*'([a-z]+)'/g, m;
    while ((m = re.exec(s)) !== null) set[m[1]] = true;
    var d = codeOf(s); if (d) set[d] = true;
    return Object.keys(set).sort();
  }

  var cfg = cfgOf(wrSrc), code = codeOf(src), doc = docOf(mdSrc), modes = modesOf(src);

  check(!!cfg,  '‏`vars.BULKHEAD_MODE` مقروءةٌ من `wrangler.jsonc` (لا يُنسَخ رقمُ سطر)');
  check(!!code, 'افتراضُ الكود مقروءٌ من `school-app-proxy.js`');
  check(!!doc,  'الافتراضُ المُعلَن مقروءٌ من `CLAUDE.md`');
  check(modes.length >= 3, 'الأوضاعُ المشروعة **مُشتقّةٌ من فروع المصدر** لا مكتوبةً هنا — ' + modes.join('/'));

  check(!!cfg && modes.indexOf(cfg) > -1,
        '① القيمةُ المضبوطة وضعٌ **يتفرّع إليه الكود فعلاً** — خطأٌ مطبعيٌّ يسقط إلى الافتراض بصمت');
  check(!!code && code === doc,
        '② افتراضُ الكود = الافتراضُ المُعلَن في `CLAUDE.md`');
  check(!!cfg && cfg === doc,
        '🔴 ③ الإعدادُ المنشور = ما تُعلنه الوثيقة — وهي العلّةُ التي وقعت فعلاً');

  /* ── الضوابطُ المعاكسة: يُطفَر النصُّ **في الذاكرة** ويجب أن ينقلب الحكم ────────
     🔴 وشرطُ `mut !== src` في كلٍّ **مقصودٌ ويحمل نصفَ قيمتها**: طفرةٌ لا تُغيّر شيئاً
     تُبلِغ نجاحاً كاذباً. وقع هذا مقيساً في المستودع الشقيق 2026-09-03 — طفرةٌ بـ`\n`
     على ملفٍّ CRLF **لم تقع أصلاً**، فخرج الحارسُ بـ`EXIT=0` وقُرئ «أجوف» والاستنتاجُ
     معكوس. ⇒ **أثبت أن الطفرةَ وقعت قبل أن تقرأ أثرَها.**
     ⚠️ وأثرُه الجانبيُّ متوقَّعٌ لا عطل: حين يحمل القرصُ الانتهاكَ **فعلاً**، تحمرّ هذه
     السطورُ أيضاً لأن الطفرةَ تصير بلا أثر — والحارسُ أحمرُ أصلاً بالفحص الحقيقيّ. */
  var mutCfg  = wrSrc.replace(/"BULKHEAD_MODE"\s*:\s*"[^"]*"/, '"BULKHEAD_MODE": "shadow"');
  var mutTypo = wrSrc.replace(/"BULKHEAD_MODE"\s*:\s*"[^"]*"/, '"BULKHEAD_MODE": "ON"');
  var mutDoc  = mdSrc.replace(/probe:BULKHEAD_MODE_DEFAULT=[a-z]+/, 'probe:BULKHEAD_MODE_DEFAULT=off');
  var mutGone = mdSrc.replace(/probe:BULKHEAD_MODE_DEFAULT=[a-z]+/, 'probe:BULKHEAD_MODE_WAS_HERE');
  /* 🟢 الطفرةُ الموجبة — وهي **الخاصّيّةُ الجديدةُ بعينها**: يُعاد تنسيقُ الوثيقة كلِّها
     ويجب أن **يبقى الحكمُ كما هو**. وبلا هذا الطرف يبقى التغييرُ دعوى: «لم يعُد يكسره
     النثر» لا تُثبتها خُضرةٌ على نصٍّ لم يتغيّر.
     🔴 **والطفرةُ نزعُ كلّ تغليظٍ (`**`) لا استبدالُ جملةٍ بعينها — وهذا مقصودٌ ومقيس:**
     أوّلُ صيغةٍ لها ارتست على صياغةِ السطر نفسِه، فلمّا أُعيدت صياغتُه على القرص
     **لم تقع الطفرةُ أصلاً** فسقط الضابطُ بينما المِجَسُّ الحقيقيُّ أخضر ⇒ **ضابطٌ يقيس
     صياغةً بدل أن يقيس مناعةً منها**. والتغليظُ موجودٌ في الوثيقة بكثرة وغائبٌ عن
     العلامة ⇒ الطفرةُ تقع دائماً ولا تمسّ المقيس. */
  var mutProse = mdSrc.replace(/\*\*/g, '');
  check(mutCfg !== wrSrc && cfgOf(mutCfg) !== doc,
        '🔒 ضابطٌ معاكس: قيمةٌ مضبوطةٌ تخالف الوثيقة (`shadow`) ⇒ يُكشف');
  check(mutTypo !== wrSrc && modes.indexOf(cfgOf(mutTypo)) === -1,
        '🔒 ضابطٌ معاكس: خطأٌ مطبعيٌّ في الحالة (`ON`) ⇒ يُكشف — والمطابقةُ حسّاسةٌ عمداً');
  check(mutDoc !== mdSrc && docOf(mutDoc) !== cfg,
        '🔒 ضابطٌ معاكس: **انحرافُ الوثيقة وحدَها** (`off`) ⇒ يُكشف — وهو العطلُ الأصليّ حرفياً');
  check(mutGone !== mdSrc && !docOf(mutGone),
        '🔒 ضابطٌ معاكس: **حذفُ العلامة** ⇒ `!!doc` يسقط — فلا ينقلب المِجَسُّ أعمى يخضرّ على العدم');
  check(mutProse !== mdSrc && docOf(mutProse) === doc,
        '🟢 ضابطٌ موجب: **إعادةُ صياغةِ النثر لا تكسر المِجَسّ** — وهي العلّةُ التي وقعت 2026-09-12');
  check(codeOf(src.replace(/env\.BULKHEAD_MODE\)\s*\|\|\s*'[^']*'/, "env.BULKHEAD_MODE) || 'off'")) !== doc,
        '🔒 ضابطٌ معاكس: انحرافُ **افتراضِ الكود** وحدَه ⇒ يُكشف');
})();

/* ── 🔴 ضابطُ **الفئة**: كلُّ وثيقةٍ تُقرأ هنا تُقرأ بعلامةِ `probe:` ──────────────
   **العلّةُ التي يُغلقها:** مِجَسٌّ يرتسي على **نثر** ينكسر بإعادة صياغةٍ بريئة — وقع
   2026-09-12 حرفياً. وإصلاحُ الحالة وحدَها يترك الفئةَ مفتوحة: أوّلُ مِجَسٍّ يُضاف غداً
   بارتساءٍ نثريٍّ يُعيد العطلَ نفسَه.
   🔴 **والوجهُ الأخطرُ ليس هذا:** مِجَسٌّ نثريٌّ **بلا فحصِ وجود** لا يحمرّ أصلاً — **يخضرّ
   على العدم** ويُطمئن وهو أعمى. (مقيسٌ في المستودع الشقيق: `counts-registry.json` يسمّي
   `CLAUDE.md` لستّة ادّعاءاتِ عدد، ونقلُ نصٍّ يحمل عدداً يجعله يخضرّ على لا شيء.)
   **الآليّة:** كلُّ مسارِ `.md` يُبنى بـ`path.join` في هذا الملفّ **يقابله اسمُ علامةٍ**
   في تعبيرٍ نمطيٍّ `probe:<NAME>=` — والعددان يتطابقان أو **خروجٌ أحمر**.
   ⚠️ **وحدُّه يُقال:** مداه **هذا الملفّ وحدَه**؛ مِجَسٌّ يُكتب في هوكٍ أو وركفلو يقرأ
   وثيقةً **خارج مداه**، ويُقال صراحةً بدل الإيهام بحمايةٍ غير قائمة. */
console.log('');
console.log('ضابطُ الفئة — «مَن يقرأ هذا نصّاً؟»:');
(function () {
  var SELF = path.join(__dirname, 'test-routes.js');
  if (!fs.existsSync(SELF)) {
    check(false, '🔴 الملفُّ يقرأ نفسَه — غيابُه فشلٌ لا تخطٍّ صامت');
    return;
  }
  var selfSrc = fs.readFileSync(SELF, 'utf8');

  /* 🔴 **الإعلانُ الهوياتيُّ — أُضيف 2026-09-12 بعد مراجعةِ `claude[bot]` على PR #267.**
     كانت المطابقةُ **عدديّةً** (`docPaths.length === probes.length`) فلا تربط مسارَ وثيقةٍ
     بعينه بعلامةٍ بعينها. **والثغرةُ التي سمّاها البوتُ حقيقيّةٌ ولم تكن مُختبَرةً بطفرة:**
     إضافةُ وثيقةٍ بلا علامة **مع** حذفِ علامةٍ قائمةٍ في الدفعة نفسِها **تُبقي العددين
     متساويين فيمرّ الضابطُ أخضرَ ووثيقةٌ بلا حراسة**.
     ✅ **والعلاجُ بنيويٌّ لا تعليقٌ يعترف بالحدّ:** تُعلَن الخريطةُ صراحةً، ويُطابَق
     **بالمفاتيح والقيم** لا بالأعداد. وطفرةُ البوت نفسِها صارت ضابطاً معاكساً أدناه. */
  var DOC_PROBES = { 'CLAUDE.md': ['BULKHEAD_MODE_DEFAULT'] };

  /* القارئتان نقيّتان — يُعاد استعمالهما على نصٍّ مطفورٍ في الضوابط المعاكسة.
     🔴 والاقتباسُ **ثلاثيُّ الصيغ** (مفردٌ · مزدوجٌ · خلفيّ) — وهي ملاحظةُ البوت الأولى:
     النمطُ القديم اشترط المفردَ حصراً، فقراءةٌ بصيغةٍ أخرى **تتسلّل بلا علامةٍ مقابلة**.
     ⚠️ **وحدُّ المدى يبقى ويُقال: يقيس ما يُبنى بـ`path.join` بقيمةٍ نصّيّةٍ مفردة** —
     مسارٌ يُركَّب بمتغيّرٍ أو بالتسلسل **خارج مداه**، وهو حدٌّ مُعلَنٌ لا ثغرةٌ مسكوتٌ عنها. */
  function docPathsOf(s) {
    var out = {}, re = /path\.join\([^)]*['"`]([^'"`]*\.md)['"`]\s*\)/g, m;
    while ((m = re.exec(s)) !== null) { out[m[1]] = true; }
    return Object.keys(out).sort();
  }
  function probeNamesOf(s) {
    var out = {}, re = /probe:([A-Z][A-Z0-9_]*)=/g, m;
    while ((m = re.exec(s)) !== null) { out[m[1]] = true; }
    return Object.keys(out).sort();
  }
  /* المطابقةُ الهوياتيّة: كلُّ مسارٍ مقروءٍ **معلَنٌ** في الخريطة، وكلُّ علامةٍ في المصدر
     **منسوبةٌ** إلى وثيقةٍ فيها. والاتّجاهان معاً — أحدُهما وحدَه يترك النصفَ الآخر مفتوحاً. */
  function unmapped(s) {
    var declared = {}, names = {};
    Object.keys(DOC_PROBES).forEach(function (k) {
      declared[k] = true;
      DOC_PROBES[k].forEach(function (n) { names[n] = true; });
    });
    return {
      docs:   docPathsOf(s).filter(function (p) { return !declared[p]; }),
      probes: probeNamesOf(s).filter(function (n) { return !names[n]; })
    };
  }

  var docPaths = docPathsOf(selfSrc), probes = probeNamesOf(selfSrc), gap = unmapped(selfSrc);

  check(docPaths.length > 0,
        'ضابط: وُجدت وثيقةٌ واحدةٌ على الأقلّ تُقرأ هنا — ' + docPaths.join('/') +
        ' (‏مجموعةٌ فارغة لا تُقرأ نجاحاً)');
  check(probes.length > 0, 'ضابط: وُجد اسمُ علامةٍ واحدٌ على الأقلّ — ' + probes.join('/'));
  check(gap.docs.length === 0,
        '🔴 كلُّ وثيقةٍ تُقرأ نصّاً **معلَنةٌ بالاسم** في `DOC_PROBES`' +
        (gap.docs.length ? ' — غيرُ معلَن: ' + gap.docs.join(' · ') : ''));
  check(gap.probes.length === 0,
        '🔴 وكلُّ علامةٍ في المصدر **منسوبةٌ** إلى وثيقةٍ في `DOC_PROBES`' +
        (gap.probes.length ? ' — غيرُ منسوب: ' + gap.probes.join(' · ') : ''));

  /* ── الضابطان المعاكسان: بلاهما يمرّ القسمُ أخضرَ لأنه لم يقِس شيئاً ────────────
     🔴 وشرطُ `mut !== selfSrc` يحمل نصفَ قيمتهما: طفرةٌ لا تقع تُبلِغ نجاحاً كاذباً. */
  /* 🔴 يُبنى اسمُ الوثيقة الوهميّة **وقتَ التشغيل** لا كنصٍّ حرفيّ — وقع الفخُّ فعلاً
     2026-09-12: كتابتُه حرفيّاً تجعل `docPathsOf` يعدّه في **المصدر غيرِ المطفور** أيضاً
     ⇒ الحارسُ يحمرّ على نفسه. وهي فئةُ **المِجَسِّ الذي يقيس أثرَ وجودِه هو**. */
  /* 🔴 **وأيُّ الوقايتين هي الحاملة؟ قِيس بالطفرة 2026-09-13، والجوابُ صحّح ما كان مكتوباً
     هنا:** كان مكتوباً أن بناءَ الاسم **وقتَ التشغيل** هو ما يمنع الحارسَ من الاحمرار على
     نفسه. **والمقيس: تحويلُه إلى نصٍّ حرفيٍّ (`'zzUnguarded.md'`) ⇒ `EXIT=0` · صفرُ حمرة.**
     🎯 **فالحاملُ هو الإسنادُ إلى متغيّرٍ:** `docPathsOf` يشترط نداءَ `path.join` واسمَ
     وثيقةٍ **متجاورَين في نصّ المصدر**، والقوالبُ أدناه تركّبه بالتسلسل فلا يتجاور.
     🔴 **ووقع ذلك على كاتب هذا التعليق نفسِه في المرور نفسِه:** صياغةٌ أولى ضربت المثالَ
     **بالصيغة المطابِقة داخل التعليق** ⇒ `❌ غيرُ معلَن: x.md` — **فالنثرُ هنا مُدخَلُ
     حارسٍ لا زخرفة**، وهو بعينه ما تقوله §١٤ في `_docs/قواعد-التنظيف.md`. ⇒ **لو كُتب
     المسارُ داخل القالب حرفيّاً لاحمرَّ الحارسُ على نفسه** — سواءٌ بُني الاسمُ بالتسلسل أم لا.
     🔒 **ونظيرُه `ZZ_PROBE` أدناه عكسُه تماماً، وقِيس بنفس المرور:** تحويلُه إلى حرفيٍّ
     ⇒ **`❌ … غيرُ منسوب: ZZ_UNRELATED` · `EXIT=1`** — لأن `probeNamesOf` يطابق العلامةَ
     **أينما وردت** بلا سياق. ⇒ **هناك التسلسلُ حاملٌ، وهنا ليس** — والوصفُ الواحدُ
     للاثنين كان يُعلّم مناعةً في غير موضعها.
     ⚠️ **ويبقى التسلسلُ هنا احتياطاً مقصوداً لا زينة:** أوّلُ قالبٍ يُكتب لاحقاً بمسارٍ
     متجاورٍ يُحيي الفخَّ، والتسلسلُ يجعل **قيمةَ** الاسم غيرَ قابلةٍ للمطابقة أصلاً. */
  var ZZ_MD = 'zz' + 'Unguarded' + '.m' + 'd';
  var SELF_ANCHOR = "var selfSrc = fs.readFileSync(SELF, 'utf8');";
  var mutNewDoc = selfSrc.replace(SELF_ANCHOR,
                                  SELF_ANCHOR + "\n  var ZZ = path.join(__dirname, '..', '" + ZZ_MD + "');");
  var mutNoProbe = selfSrc.replace(/probe:([A-Z][A-Z0-9_]*)=/g, 'zzWasProbe:$1=');
  check(mutNewDoc !== selfSrc && unmapped(mutNewDoc).docs.length > 0,
        '🔒 ضابطٌ معاكس: **وثيقةٌ جديدةٌ تُقرأ بلا إعلان** ⇒ يُكشف عند إضافتها لا بعد أشهر');
  check(mutNoProbe !== selfSrc && probeNamesOf(mutNoProbe).length === 0,
        '🔒 ضابطٌ معاكس: **نزعُ العلامات** ⇒ يُكشف — والمِجَسُّ لا يُجيب دائماً');

  /* 🔴 **ضابطُ ثغرةِ العدّ — سيناريو `claude[bot]` بعينه على PR #267، ولم يكن مُختبَراً:**
     وثيقةٌ جديدةٌ **بلا** علامة **مع** نزعِ علامةٍ قائمةٍ في الدفعة نفسِها ⇒ **العددان
     يتساويان**. كانت المطابقةُ العدديّةُ تمرّ **خضراءَ ووثيقةٌ بلا حراسة**؛ والمطابقةُ
     الهوياتيّةُ ترى المسارَ غيرَ المعلَن مهما تساوت الأعداد.
     🎯 **والضابطُ يُثبت الأمرين معاً:** أن الطفرةَ **تُخادع العدّ فعلاً** (وإلّا لم تكن
     تختبر الثغرة)، وأن الهوياتيّةَ **تكشفها** — وبلا الشقّ الأوّل يكون الفحصُ زينة. */
  /* 🔴 **وبناءُ الطفرة نفسُه صُحِّح بعد سقوطها أوّلَ مرّة — والسقوطُ كان صادقاً:**
     بعلامةٍ **واحدة** في المصدر يستحيل أن يتساوى العددان بحذفها (‏١ وثيقة/٠ علامة)، فكانت
     الطفرةُ الأولى **لا تختبر الثغرة أصلاً**. والسيناريو الصحيح: **وثيقةٌ جديدةٌ بلا علامةٍ
     خاصّةٍ بها + علامةٌ جديدةٌ لشيءٍ آخر** ⇒ ‏٢ مقابل ٢ ⇒ **العدُّ يُخدَع والهويّةُ لا.**
     ⚠️ **واسمُ العلامة الوهميّة يُبنى وقتَ التشغيل** — كتابتُه حرفيّاً تجعل `probeNamesOf`
     يعدّه في المصدر غيرِ المطفور (نفسُ فخّ «المِجَسّ الذي يقيس أثرَ وجودِه هو»). */
  var ZZ_PROBE = 'probe:' + 'ZZ' + '_UNRELATED' + '=x';
  var mutCountTrick = mutNewDoc.replace(SELF_ANCHOR, SELF_ANCHOR + '\n  /* ' + ZZ_PROBE + ' */');
  check(mutCountTrick !== mutNewDoc &&
        docPathsOf(mutCountTrick).length === probeNamesOf(mutCountTrick).length,
        '🔒 ① الطفرةُ تُخادع العدَّ فعلاً (العددان متساويان) — وإلّا لم تختبر الثغرة');
  check(unmapped(mutCountTrick).docs.length > 0,
        '🔴 ② والمطابقةُ **الهوياتيّة** تكشفها رغم تساوي العددين — ثغرةُ مراجعة #267 مُغلقة');

  /* 🔒 وضابطٌ ثالثٌ لملاحظة البوت الأولى: اقتباسٌ **مزدوجٌ** كان يتسلّل من النمط القديم. */
  var mutDq = selfSrc.replace(SELF_ANCHOR,
                              SELF_ANCHOR + '\n  var ZQ = path.join(__dirname, "..", "' + ZZ_MD + '");');
  check(mutDq !== selfSrc && unmapped(mutDq).docs.length > 0,
        '🔒 ③ قراءةٌ بصيغة اقتباسٍ **مزدوج** ⇒ تُكشف أيضاً — والنمطُ لم يعُد يقيس صيغةً واحدة');

  /* 🔴 **④ والصيغةُ الخلفيّة (backtick) — أُضيفت 2026-09-12 بمراجعة `claude[bot]` على #270.**
     كان النمطُ يقبل ثلاثَ صيغٍ **والضوابطُ تغطّي اثنتين**، فالوصفُ يدّعي «ثلاثيَّ الصيغ»
     والثالثةُ **غيرُ مُختبَرةٍ إطلاقاً** ⇒ فئةُ «حارسٌ يبدو شاملاً لأن حالتَه الشائعة
     تُلتقط بسببٍ آخر». 🎯 **ودعوى التغطية تُثبَت بطفرةٍ لكلّ فرعٍ لا بقراءةِ الصنف الحرفيّ.** */
  var BT = String.fromCharCode(96);
  var mutBt = selfSrc.replace(SELF_ANCHOR,
                              SELF_ANCHOR + '\n  var ZB = path.join(__dirname, "..", ' + BT + ZZ_MD + BT + ');');
  check(mutBt !== selfSrc && unmapped(mutBt).docs.length > 0,
        '🔒 ④ وقراءةٌ بصيغة الاقتباس **الخلفيّ** ⇒ تُكشف — والفروعُ الثلاثةُ مُختبَرةٌ كلُّها');

  /* 🔴 **⑤ وجهةُ `gap.probes` — كانت بلا ضابطٍ معاكس، وهي نفسُ فئةِ العلّة التي يغلق
     هذا المرورُ جهتَها الأخرى.** كلُّ الطفرات أعلاه تطفر جهةَ **الوثائق**؛ فالاتّجاهُ
     المقابل (علامةٌ تُضاف بلا نسبةٍ في `DOC_PROBES`) كان **مُعلَناً في الكود وغيرَ
     مُختبَر** — و«يبدو صحيحاً منطقياً» ليست ضابطاً. رفعتها مراجعةُ #270. */
  var ZZ_ORPHAN = 'probe:' + 'ZZ' + '_ORPHAN' + '=x';
  var mutOrphanProbe = selfSrc.replace(SELF_ANCHOR, SELF_ANCHOR + '\n  /* ' + ZZ_ORPHAN + ' */');
  check(mutOrphanProbe !== selfSrc && unmapped(mutOrphanProbe).probes.length > 0,
        '🔒 ⑤ **علامةٌ بلا نسبةٍ في `DOC_PROBES`** ⇒ تُكشف — والاتّجاهان مُختبَران لا واحد');
})();

/* ═══════════════════════════════════════════════════════════════════════════════
   الخطّافات في الـHTML **المخدوم** — لا في الوركر (2026-09-03)
   ═══════════════════════════════════════════════════════════════════════════════
   🔴 هذا يغلق دَيناً مُعلَناً في `school-app-proxy.js`: كان هذا الملفّ يقرأ مصدرَ الوركر
      **وحده**، فحذفُ الوسم من `frontend/` غداً يُصمِت الحقنَ ويبقى كلُّ فحصٍ أخضر —
      «حارسٌ أخضرُ لأنه لم يقِس شيئاً».
   ⚠️ و`frontend/` **مُولَّدٌ** من `SchoolApp-gas`: فشلُ هذا الحارس يعني أن دفعةً هناك
      أسقطت وسماً يعتمده الوركر — وهذا بالضبط ما نريد أن نراه أحمرَ لا صامتاً.
   🔒 والغيابُ الكلّي للملفّ **فشلٌ لا تخطٍّ**: مستودعٌ بلا `frontend/` لا يخدم شيئاً. */
(function () {
  console.log('');
  console.log('الخطّافات في الـHTML المخدوم (‏`frontend/` مُولَّد من مستودع الـgas):');
  var FE = path.join(__dirname, '..', 'frontend');
  /* 🟢 عائلةُ `data-brand*` وصلت من مستودع الـgas 2026-09-03 (‏`main@8483536` ⇒ دفعةُ
     `auto: rebuild frontend`) **ومُتحقَّقٌ منها حيّاً**: خانتا الاتصال في الصفحة العامّة
     تُظهَران فعلاً بالهاتف والعنوان في الـHTML الخام. فصارت الخطّافاتُ مفروضةً لا مأمولة. */
  var SURFACES = [
    ['home/index.html', ['school-brand-name', 'id="hdrLogo"', 'id="ftLogo"',
                         'id="tbPhone"', 'id="fcPhone"', 'id="tbAddr"', 'id="ftAddr"',
                         'id="tbWa"', 'id="fcWa"', '__HOME_BRAND__',
                         'data-brand="name"', 'data-brand="phone"', 'data-brand="address"',
                         'data-brand-host="phone"', 'data-brand-host="address"',
                         /* روابطُ البوّابات (2026-09-19 · `_PortalHref`): حذفُها من المصدر يُصمِت
                            الكتابةَ الخادميّة فيعود الرابطُ عارياً — وكان هذا الحارسُ سيبقى أخضر. */
                         'data-portal="teacher"', 'data-portal="student"']],
    ['teacher/index.html', ['school-brand-name', 'id="tchLoginLogo"', 'id="tchNavLogo"',
                            'id="tchLoginContact"', 'id="tchLoginAddress"',
                            'data-brand="name"', 'data-brand="phone"', 'data-brand="address"',
                            'data-brand-host="phone"', 'data-brand-host="address"',
                            '__SCHOOL_BRAND__']],
    ['student/index.html', ['school-brand-name', 'id="stuLoginLogo"', 'id="stuNavLogo"',
                            'id="stuLoginContact"', 'id="stuLoginAddress"',
                            'data-brand="name"', 'data-brand="phone"', 'data-brand="address"',
                            '__SCHOOL_BRAND__']]
  ];
  SURFACES.forEach(function (s) {
    var html = '';
    try { html = fs.readFileSync(path.join(FE, s[0]), 'utf8'); } catch (e) { html = ''; }
    if (!html) {
      check(false, '🔴 تعذّرت قراءة `frontend/' + s[0] + '` — الحارس أعمى لا نظيف');
      return;
    }
    s[1].forEach(function (hook) {
      check(html.indexOf(hook) !== -1,
            '`' + s[0] + '` يحمل `' + hook + '` (يعتمده `_brandRewrite`)');
    });
  });
  /* ضابطٌ معاكس على الحارس نفسه: وسمٌ لا وجود له يجب أن يُقرأ غائباً — وإلّا كانت
     المطابقةُ سامحةً وكلُّ ما سبق بلا معنى. */
  var probe = '';
  try { probe = fs.readFileSync(path.join(FE, 'home', 'index.html'), 'utf8'); } catch (e) { probe = ''; }
  check(probe && probe.indexOf('id="__no-such-hook__"') === -1,
        '🔒 ضابط معاكس: وسمٌ غير موجود يُقرأ غائباً (المطابقة ليست سامحة)');
})();

/* ── 🔬 بصمةُ مفتاح الكاش في السجلّ — حارس **سلوكيّ** + ضابطُ خصوصية ─────────────
 *
 * ما يحرسه شيئان لا واحد:
 *  ① **أن الأداة تعمل:** `_apiKeyFp` تُستخرَج من المصدر نفسِه وتُشغَّل — لا تُعاد كتابتها
 *     هنا، وإلّا اختُبِرت نسخةُ الاختبار لا الوركر (نفسُ درس بند 116).
 *  ② 🔴 **وأن القيمةَ الخام لا تُسجَّل أبداً:** `argsKey` يحمل `schoolId` واسمَ الصفّ
 *     والشعبة. فأيُّ نداء `_bhLog({ ev:'apicache' … })` يحمل `argsKey` **أحمرُ فوراً**.
 *     وهذا هو الضابطُ المعاكس القابلُ للتشغيل: استبدِل `_apiKeyFp(_acProbe.argsKey)`
 *     بـ`_acProbe.argsKey` ⇒ يجب أن يحمرّ. بلا هذا الضابط يكون الحارسُ نصفَ حارس:
 *     يُثبت أن السجلّ يحمل حقلاً، ولا يُثبت أنه لا يحمل ما لا يجوز.
 *  🔒 وغيابُ الدالّة من المصدر **فشلٌ لا تخطٍّ صامت** — إعادةُ تسميتها كانت ستُطفئ
 *     الحارسَ ويبقى الملفُّ أخضرَ لأنه لم يقِس شيئاً. */
(function () {
  console.log('');
  console.log('بصمةُ مفتاح كاش الحافّة في السجلّ (‏`_apiKeyFp`):');

  var kIdx = src.indexOf('function _apiKeyFp(');
  if (kIdx < 0) {
    check(false, '🔴 API_KEY_FP_MISSING — تعذّر استخراج `_apiKeyFp` من الوركر');
    return;
  }
  vm.runInContext(src.slice(kIdx, src.indexOf('\n}', kIdx) + 2), ctx);
  var fp = function (s) { return vm.runInContext('_apiKeyFp(' + JSON.stringify(s) + ')', ctx); };

  var A = '%5B%5B%22uuid-a%22%5D%2C%22s1%22%5D';
  var B = '%5B%5B%22uuid-b%22%5D%2C%22s1%22%5D';

  check(/^[0-9a-f]{8}$/.test(fp(A)), 'البصمة ثمانيةُ محارف hex بالضبط');
  check(fp(A) === fp(A), 'حتميّة: نفسُ المدخل ⇒ نفسُ البصمة');
  check(fp(A) !== fp(B), 'مدخلان مختلفان ⇒ بصمتان مختلفتان (وإلّا فالعدُّ بلا معنى)');
  check(/^[0-9a-f]{8}$/.test(fp('')), 'المدخلُ الفارغ لا يكسرها ولا يُقصّر الطول');
  /* ضابطٌ معاكس على الحارس نفسه: لو كانت الدالّةُ ثابتةً تُرجِع قيمةً واحدة لمرّ كلُّ ما
     سبق عدا هذا السطر — فهو الذي يمنع «حارساً أخضرَ لا يقيس شيئاً». */
  check(fp('a') !== fp('b') && fp('ab') !== fp('ba'),
        '🔒 ضابط معاكس: البصمة تتبع الترتيب والمحتوى معاً لا قيمةٌ ثابتة');

  // ── سطورُ السجلّ: كلٌّ يُقرأ من المصدر ويُفحَص نصّاً على شرطين ──
  var calls = [], at = 0;
  while ((at = src.indexOf("_bhLog({ ev: 'apicache'", at)) !== -1) {
    var end = src.indexOf('});', at);
    calls.push(src.slice(at, end + 3));
    at = end + 3;
  }
  check(calls.length >= 3,
        'ثلاثةُ نداءات سجلٍّ على الأقلّ (‏`nokey` · `hit` · `store/skip`) — وُجد ' + calls.length);

  /* 🔴 **الشرطُ الصحيح: `argsKey` لا يظهر إلّا ملفوفاً بـ`_apiKeyFp(...)`** — لا «لا
     يظهر إطلاقاً». الصياغةُ الأولى حمّرت على استعمالٍ **مشروع** (`_apiKeyFp(probe.argsKey)`)
     وهي فئةُ «الحارسِ الذي يمنع الهدفَ الذي كُتب لحمايته». ⇒ تُنزع اللفّاتُ أوّلاً ثمّ
     يُبحَث عمّا بقي؛ فيبقى الضابطُ المعاكس فاعلاً حرفياً: `k: _acProbe.argsKey` يترك
     الاسمَ عارياً ⇒ أحمر. */
  var leaks = calls.filter(function (c) {
    return /argsKey/.test(c.replace(/_apiKeyFp\([^)]*\)/g, '«fp»'));
  });
  check(leaks.length === 0,
        '🔴 صفرُ نداءِ سجلٍّ يحمل `argsKey` عارياً (‏بياناتُ مستأجرٍ لا تدخل السجلّ)');

  var needK = calls.filter(function (c) { return !/act: 'nokey'/.test(c); });
  check(needK.length > 0 && needK.every(function (c) { return /\bk:/.test(c); }),
        'كلُّ نداءٍ له مفتاحٌ فعلاً يحمل الحقل `k` (‏`nokey` مستثنىً — لا مفتاحَ له)');

  /* 🔴 الحسابُ **قبل** `ctx.waitUntil` لا داخل الكولباك — نفسُ سببِ التقاط `_acFn`. */
  var vIdx = src.indexOf('var _acKeyFp = _apiKeyFp(');
  var wIdx = src.indexOf('ctx.waitUntil(_apiCachePut(');
  check(vIdx !== -1 && wIdx !== -1 && vIdx < wIdx,
        'بصمةُ مسار التخزين تُحسَب قبل `ctx.waitUntil` لا داخل الكولباك');
})();

// ── 🔴 وسيطُ الفيديو `/media/drive/<id>`: الفشلُ لا يُكاش (سلوكي عبر `vm`) ─────
//
// العلّةُ المقيسة حيّاً (2026-09-06، جلسةُ `SchoolApp-gas`):
//   curl -s -D - -o /dev/null "https://yemenschoolz.com/media/drive/NOT_A_REAL_ID"
//   ⇒ 404 + `Cache-Control: public, max-age=86400, immutable`
// أي أن **الفشلَ نفسَه** يُكاش يوماً كاملاً، و`immutable` تمنع إعادةَ التحقّق حتى عند
// التحديث. وكان المسارُ **بلا حالةِ اختبارٍ واحدة** في هذا الملفّ (صفرُ ذكرٍ لـ`media`).
console.log('');
console.log('وسيطُ الفيديو — سياسةُ الكاش والنوع (سلوكي):');
(function () {
  var mIdx = src.indexOf('var MEDIA_CACHE_OK');
  var mEnd = src.indexOf('\n}', src.indexOf('function _mediaIsHtml(')) + 2;
  check(mIdx >= 0 && mEnd > mIdx,
        'ضابط: استُخرجت كتلةُ سياسة الوسيط الإعلامي من المصدر (فشلُ الاستخراج = عمى لا نجاح)');
  if (mIdx < 0 || mEnd <= mIdx) return;

  var mctx = vm.createContext({});
  vm.runInContext(src.slice(mIdx, mEnd), mctx);
  var cc = vm.runInContext('_mediaCacheControl', mctx);
  var isHtml = vm.runInContext('_mediaIsHtml', mctx);
  check(typeof cc === 'function' && typeof isHtml === 'function',
        'ضابط: الدالّتان قابلتان للتشغيل فعلاً (لا نصٌّ مستخرَجٌ فارغ)');

  // ① الجوهر: أيُّ فشلٍ ⇒ لا `max-age` إطلاقاً.
  [404, 403, 500, 502, 429].forEach(function (st) {
    check(!/max-age/.test(cc(st)) && cc(st) === 'no-store',
          '🔴 الحالة ' + st + ' لا تُكاش (‏' + cc(st) + ')');
  });
  // ② الضابطُ المعاكس: الحارسُ ليس سياجاً — النجاحُ **ما زال** يُكاش بـ`immutable`،
  //    وهو المطلوب (تسريعُ إعادة التشغيل والتموضع). بلا هذا يمرّ «no-store دائماً».
  check(/max-age=86400/.test(cc(200)) && /immutable/.test(cc(200)),
        '🔒 ضابط معاكس: 200 ما زالت تُكاش يوماً بـ`immutable`');
  check(cc(206) === cc(200),
        '🔒 ضابط معاكس: 206 (‏Range) تُكاش كالنجاح الكامل — التموضعُ لا يُبطَّأ');

  // ③ HTML لا يُوسَم مطلقاً `video/mp4`: الكاشفُ يعمل على الأشكال الحيّة كلّها.
  check(isHtml('text/html; charset=utf-8') === true && isHtml('text/html') === true,
        'كاشفُ HTML يلتقط النوعَ بمعاملٍ وبدونه');
  check(isHtml('video/mp4') === false && isHtml('') === false && isHtml(null) === false,
        '🔒 ضابط معاكس: النوعُ الإعلاميّ والفارغُ والمعدومُ ليست HTML');

  // ④ ولا يبقى في الفرع فرضٌ أعمى للنوع على بايتاتِ HTML.
  var mediaIdx = src.indexOf("var mediaMatch = path.match(");
  var mediaEnd = src.indexOf("// ── 1هـ)", mediaIdx);
  var block = mediaIdx >= 0 && mediaEnd > mediaIdx ? src.slice(mediaIdx, mediaEnd) : '';
  check(block.length > 0, 'ضابط: التُقط فرعُ `/media/drive/` من المصدر');
  check(block.indexOf("'video/mp4'") !== -1 && !/indexOf\('text\/html'\) === -1\) \? ct : 'video\/mp4'/.test(block),
        '🔴 لا فرضَ أعمى لـ`video/mp4` على نوعٍ فُحص أنه HTML');
  check(/_mediaCacheControl\(dResp\.status\)/.test(block),
        '🔴 `Cache-Control` يُبنى من حالة الردّ لا ثابتاً');
  check(/new AbortController\(\)/.test(block) && /MEDIA_TIMEOUT_MS/.test(block),
        '⚠️ للمسار مهلةٌ صريحة (‏كان بلا سقفٍ زمنيّ إطلاقاً)');

  /* ⑤ 🔒 جسمُ الفشل لا يحمل نصَّ الاستثناء الخام — المسارُ عامٌّ بلا مصادقة،
     ونصُّ الاستثناء سلسلةٌ غيرُ محدودةِ المنشأ قد تحمل عنوانَ الطلب (ومعه `fileId`)
     أو تفصيلَ زمنِ تشغيل. 🔴 والشرطُ على **الخام** لا على الاسم: `mErr.name` استعمالٌ
     مشروعٌ يبقى أخضر، وإلّا انقلب الحارسُ سياجاً يمنع التشخيصَ الذي كُتب ليُبقيه.

     🔴 **والتعليقاتُ تُنزَع أوّلاً — وهذا الحارسُ نفسُه وقع في الفخّ وقتَ كتابته:**
     نصُّ التعليق الشارح كان يذكر النمطَ المحظور، فبقي الفحصُ **أحمرَ بعد عكسِ الطفرة**
     وكاد يُقرأ «الإصلاحُ لم يُطبَّق». فئةُ «‏`grep` يعدّ التعليقات» حرفياً. */
  var codeOnly = _stripComments(block);
  var rawErr = codeOnly.replace(/String\(mErr\.name\)/g, '«name»');
  check(!/String\(mErr\)/.test(rawErr),
        '🔒 صفرُ تسريبٍ لنصّ الاستثناء الخام في جسم الفشل (‏النوعُ وحدَه يخرج)');
  check(/mErr\.name/.test(codeOnly),
        '🔒 ضابط معاكس: نوعُ الخطأ **ما زال** يخرج — `AbortError` يميّز المهلةَ من فشل النقل');
  /* ضابطُ الأداة نفسِها — بثلاثة أطراف لا طرفين.
     🔴 والثالثُ أُضيف بعد عطبٍ مقيس: النسخةُ الأولى كانت قناعاً عامّاً — تعبيرٌ
     نمطيٌّ يمسح من شرطتين مائلتين إلى آخر السطر — وكتلةُ الوسيط تحوي
     `'https://drive.usercontent.google.com/...'` ⇒ القناعُ يبتلع **بقيّةَ سطرِ كودٍ
     سليم** ابتداءً من `//` داخل السلسلة الحرفية. قِيس: `var u = 'https:` وحدَها تبقى.
     ولم يحمرَّ شيءٌ وقتها لأن الفحوصَ تستهدف أسطراً أخرى — **أخضرُ بالمصادفة**،
     وهي أخطرُ من الأحمر. ⇒ النازعُ صار واعياً بالسلاسل، والطرفُ الثالث يحرسه. */
  check(!/String\(mErr\)/.test(_stripComments('/* ذِكرٌ في تعليق: String(mErr) */ var a = 1;')) &&
        !/String\(mErr\)/.test(_stripComments('// ذِكرٌ في سطر: String(mErr)\nvar b = 2;')) &&
        /String\(mErr\)/.test(_stripComments('var c = String(mErr); /* شرح */')),
        'ضابط الأداة: النازعُ يُسقط ذِكرَ التعليق ويُبقي ذِكرَ الكود');
  check(/drive\.example\.com/.test(_stripComments("var u = 'https://drive.example.com/d?id=' + id; var k = 1;")),
        '🔒 ضابط الأداة (٣): `//` داخل سلسلةٍ حرفية **ليس تعليقاً** — سطرُ الكود يبقى كاملاً');
  /* 🔴 الطرفُ الرابع — والفجوةُ التي كشفَته ليست فجوةَ الأداة بل فجوةَ **الادّعاء**:
     النازعُ يتعامل مع التعليق الذيليّ صحيحاً، **والضابطُ لم يكن يُثبت ذلك** ⇒ تغطيةٌ
     مُدّعاةٌ أوسعُ من المقيس. رصدَته جلسةُ `SchoolApp-gas` في نازعها هي (سطريٌّ محضٌ
     فيُبقي الذيليّ)، فقِستُ نازعي بمعيارها.
     🟢 والدرسُ المشترك: **النازعُ السطريّ والنازعُ الواعي بالاقتباس يفشلان في اتجاهين
     متعاكسين** — الأوّلُ يُبقي الذيليّ، والثاني يبتر السلسلةَ إن لم يتتبّع الاقتباس.
     ⇒ الضابطُ يحمل الطرفين معاً، وإلّا أثبت نصفَ الأداة. */
  check(!/String\(mErr\)/.test(_stripComments('var a = 1;  // ذيليّ: String(mErr)\nvar b = 2;')) &&
        /var b = 2/.test(_stripComments('var a = 1;  // ذيليّ: String(mErr)\nvar b = 2;')),
        '🔒 ضابط الأداة (٤): التعليقُ **الذيليّ** يسقط والسطرُ التالي ينجو');

  /* ═══ سدُّ عمى السجلّ — كلُّ فرعِ فشلٍ يُسجَّل، لا فرعُ الاستثناء وحدَه ══════════
     🔴 العلّةُ المقيسة 2026-09-06: `_bhLog` كان في `catch` فقط، ففرعا `status>=400`
     و«HTML بدل وسائط» يخرجان بلا أثر ⇒ **«صفرُ حدث» يُقرأ «صفرُ فشل»** ولا يُميَّز
     «لم يُطلَب» من «طُلب وفشل». وهذا بعينه ما عطّل تشخيصَ عطل منصّة المعلّم. */
  var failCalls = codeOnly.split('mediaFail(').length - 1;
  check(failCalls >= 3,
        'ثلاثةُ استدعاءاتٍ لـ`mediaFail` على الأقلّ (‏upstream · html · err) — وُجد ' + failCalls);
  check(/_bhLog\(\{\s*ev:\s*'media'/.test(codeOnly),
        '🔴 `mediaFail` نفسُها تُسجّل — فالتسجيلُ يعمّ الفروعَ كلَّها بلا نسيانِ فرع');
  /* ⚠️ الوسائطُ **موضعيّةٌ لا مسمّاة** (`mediaFail(msg, st, act, upstream)`) — وأوّلُ
     صياغةٍ لهذا الفحص بحثت عن `act: 'upstream'` فحمّرت على كودٍ سليم. الفحصُ يطابق
     شكلَ الاستدعاء الفعليّ، لا شكلاً يتخيّله كاتبُ الحارس. */
  check(/'upstream'/.test(codeOnly) && /'html'/.test(codeOnly) && /'err:'\s*\+/.test(codeOnly),
        '🔴 كلُّ فرعٍ يمرّر `act` يميّز سببَه (‏`upstream` · `html` · `err:<النوع>`)');
  // 🔒 وهويّةُ الملفّ لا تدخل السجلّ خاماً — نفسُ قاعدة `argsKey` في كاش الحافّة.
  var mediaLogs = codeOnly.replace(/_apiKeyFp\([^)]*\)/g, '«fp»');
  check(!/ev:\s*'media'[\s\S]{0,120}fileId/.test(mediaLogs),
        '🔒 صفرُ `fileId` عارٍ في سجلّ الوسائط (‏يدخل مبصوماً بـ`_apiKeyFp`)');
  check(/k:\s*_apiKeyFp\(fileId\)/.test(codeOnly),
        '🔒 ضابط معاكس: البصمة **موجودةٌ فعلاً** — السجلُّ يربط الأحداث ولم يُفرَّغ من معناه');
})();

// ── 🔴 معرّفٌ فارغ ⇒ 400 صريح لا صفحةَ HTML صامتة ───────────────────────────
//
// كان `/media/drive/` بلا معرّف **لا يطابق الـregex** فيمضي إلى خدمة الموقع الثابت
// ويردّ **HTML بحالة 200** ⇒ `<video>` يفشل بلا أثرٍ في أيّ سجلّ. وهي إحدى الفرضيّات
// الحيّة لعطل «الفيديو لا يُعرض في منصّة المعلّم» (2026-09-06).
console.log('');
console.log('وسيطُ الفيديو — المعرّفُ الفارغ (سلوكي):');
(function () {
  var bIdx = src.indexOf("if (/^\\/media\\/drive\\/?$/.test(path))");
  check(bIdx !== -1, 'ضابط: فرعُ المعرّف الفارغ موجودٌ في المصدر');
  if (bIdx === -1) return;
  var mIdx = src.indexOf('var mediaMatch = path.match(');
  check(mIdx > bIdx,
        '🔴 فرعُ المعرّف الفارغ **يسبق** مطابقةَ المعرّف الصحيح — وإلّا لم يُبلَغ أبداً');
  var blk = src.slice(bIdx, mIdx);
  check(/status:\s*400/.test(blk) && /_mediaCacheControl\(400\)/.test(blk),
        '🔴 يردّ 400 **غيرَ مكاش** (‏`_mediaCacheControl(400)` ⇒ `no-store`)');
  check(/act:\s*'badid'/.test(blk),
        '🔴 ويُسجَّل بـ`act:\'badid\'` — فشلٌ صامتٌ صار حدثاً مقيساً');
  // 🔒 ضابط معاكس: لا `fileId` هنا أصلاً (لا يوجد)، ولا يُكاش الفشلُ بحال.
  check(!/max-age/.test(blk),
        '🔒 ضابط معاكس: صفرُ `max-age` في فرع المعرّف الفارغ');
})();

// ── 🔴 `ttl` جدول الحصص: 1800 لهذه الدالّة **وحدها** ─────────────────────────
console.log('');
console.log('كاشُ الحافّة — `ttl` جدول الحصص (سلوكي عبر `vm`):');
(function () {
  var aIdx = src.indexOf('var API_CACHE_FNS = {');
  var aEnd = src.indexOf('\n};', aIdx) + 3;
  check(aIdx >= 0 && aEnd > aIdx, 'ضابط: استُخرجت `API_CACHE_FNS` من المصدر');
  if (aIdx < 0 || aEnd <= aIdx) return;
  var actx = vm.createContext({ _apiArgsScalars: function () {}, _apiArgsSchedule: function () {} });
  var fns;
  try { vm.runInContext(src.slice(aIdx, aEnd), actx); fns = vm.runInContext('API_CACHE_FNS', actx); }
  catch (e) { check(false, 'ضابط: الكتلة قابلةٌ للتشغيل — ' + e.message); return; }
  check(!!fns && typeof fns === 'object', 'ضابط: الكائنُ قابلٌ للقراءة فعلاً');

  check(fns.getHomeScheduleBundle && fns.getHomeScheduleBundle.ttl === 1800,
        '🔴 `getHomeScheduleBundle.ttl === 1800` — الافتراضي 600 كان يُخفق حتماً (المفتاحُ كلّ ~٢٩ دقيقة)');
  /* 🟢 **البراندان ساعةٌ بقرار المالك 2026-09-19** (التخزينُ كان يغلب الإصابة ⇒ دورةُ حياةٍ
     قصيرة). كان هنا ضابطٌ يشترط «بلا `ttl`» كي لا يعمّ رفعُ الجدول بلا قصد — والرفعُ
     هنا **مقصودٌ ومُقرّ**، فصار الضابطُ القيمةَ المقرَّة نفسَها بالضبط. */
  check(fns.getTeacherSchoolBrand && fns.getTeacherSchoolBrand.ttl === 3600 &&
        fns.getStudentSchoolBrand && fns.getStudentSchoolBrand.ttl === 3600,
        '🔒 البراندان `ttl === 3600` بالضبط (قرارُ المالك) — لا أطولَ ولا الافتراضيّ');
  /* 🔴 **والقاعدةُ التي كان الضابطُ القديم يحرسها باقيةٌ ومحروسةٌ في موضعها الصحيح:**
     «شاشةُ دخولٍ بلا هويّة أسوأ من العطل» ⇒ **الاسمُ الفارغ لا يُخزَّن أبداً** — يحرسها
     `ok()` لا الـ`ttl`، ومع ساعةٍ صار خرقُها أغلى (فراغٌ مثبَّتٌ ساعةً لا عشرَ دقائق). */
  check(fns.getTeacherSchoolBrand.ok({ ok: true, name: '' }) === false &&
        fns.getStudentSchoolBrand.ok({ ok: true, name: '' }) === false &&
        fns.getTeacherSchoolBrand.ok({ ok: true, name: 'م' }) === true,
        '🔴 الاسمُ الفارغ لا يُخزَّن (ولا ساعة) — والاسمُ الحقيقيّ يُخزَّن (ضابطٌ معاكس)');
  check(fns.getHomePageBundle && fns.getHomePageBundle.ttl === 120,
        '🔒 ضابط معاكس: `getHomePageBundle` باقٍ على 120 (‏أقصرُ عنصرٍ مُكاشٌ خادمياً ٣٠ث)');
})();

/* ── 🔴 عقدُ كاش الحافّة المنشور = مفاتيحُ `API_CACHE_FNS` حرفياً ────────────────
 *
 * **العلّةُ التي يغلقها (2026-09-10):** أسماءُ هذه الدوالّ تعيش في مستودعٍ آخر
 * (‏`school-app-yemen-gas` · خاصّ). وإعادةُ تسميةِ إحداها هناك **تُبرّد الكاشَ صامتاً**:
 * الوسيطُ لا يجد الاسمَ فيمرّر النداءَ بلا كاش — لا خطأ · لا 502 · لا سطرٌ أحمر — فقط
 * حملٌ إضافيٌّ على حصّةٍ مشبَعة. ولا يملك هذا المستودعُ كشفَه: المستودعُ الخاصّ **غيرُ
 * مُحضَرٍ في CI هنا**، فحارسٌ يقرؤه يعمل على قرصٍ واحدٍ ويُقرأ حمايةً قائمةً وهو ليس كذلك.
 *
 * ⇒ الاتّجاهُ المعكوس هو الممكن: هذا المستودعُ **عامّ**، فيَشتقّ مستهلكُ GAS الأسماءَ من
 * `worker/edge-cache-contract.json` عبر الخام بلا توكن. **والنسخُ اليدويُّ مرفوض** — هو
 * العطلُ نفسُه بثوبٍ ثالث.
 *
 * 🔴 **وهذا التأكيدُ هو ما يمنع الملفَّ من أن يصير النسخةَ الثالثة**: ثنائيُّ القطب —
 * يحمرّ على **زيادةٍ** في الكود لا يعلنها الملفّ، وعلى **نقصٍ** يعلنه الملفُّ ولا يوجد.
 * ⚠️ وحدُّه يُقال: يحرس **الأسماء** لا الشكلَ ولا الـ`ttl`؛ وتلك يحرسها ما قبله.
 */
console.log('');
console.log('عقدُ كاش الحافّة المنشور — مطابقةٌ ثنائيّةُ القطب مع المصدر:');
(function () {
  var CJ = path.join(__dirname, 'edge-cache-contract.json');
  if (!fs.existsSync(CJ)) {
    check(false, '🔴 `worker/edge-cache-contract.json` مفقود — المستهلكُ الخارجيُّ يجلب فراغاً');
    return;
  }
  var doc;
  try { doc = JSON.parse(fs.readFileSync(CJ, 'utf8')); }
  catch (e) { check(false, '🔴 العقدُ ليس JSON صالحاً — ' + e.message); return; }

  var declared = doc && doc.cachedFunctions;
  check(Object.prototype.toString.call(declared) === '[object Array]' && declared.length > 0,
        'ضابط: `cachedFunctions` مصفوفةٌ غيرُ فارغة (‏مجموعةٌ فارغة لا تُقرأ نجاحاً)');
  if (Object.prototype.toString.call(declared) !== '[object Array]' || !declared.length) return;

  var aIdx2 = src.indexOf('var API_CACHE_FNS = {');
  var aEnd2 = src.indexOf('\n};', aIdx2) + 3;
  check(aIdx2 >= 0 && aEnd2 > aIdx2, 'ضابط: استُخرجت `API_CACHE_FNS` من المصدر');
  if (aIdx2 < 0 || aEnd2 <= aIdx2) return;
  var cctx = vm.createContext({ _apiArgsScalars: function () {}, _apiArgsSchedule: function () {} });
  var live;
  try { vm.runInContext(src.slice(aIdx2, aEnd2), cctx); live = Object.keys(vm.runInContext('API_CACHE_FNS', cctx)); }
  catch (e) { check(false, 'ضابط: الكتلة قابلةٌ للتشغيل — ' + e.message); return; }
  check(live.length > 0, 'ضابط: المصدرُ أعطى دالّةً واحدةً على الأقلّ (‏صفرٌ = لم يُقَس شيء)');

  var missing = live.filter(function (k) { return declared.indexOf(k) === -1; });
  var extra = declared.filter(function (k) { return live.indexOf(k) === -1; });

  check(missing.length === 0,
        '🔴 قطبٌ ①: كلُّ دالّةٍ مُكاشةٍ في الكود **معلَنةٌ** في العقد' +
        (missing.length ? ' — الناقصُ: ' + missing.join(' · ') : ''));
  check(extra.length === 0,
        '🔴 قطبٌ ②: كلُّ اسمٍ في العقد **موجودٌ** في الكود' +
        (extra.length ? ' — الزائدُ: ' + extra.join(' · ') : ''));
  check(declared.length === live.length,
        '🔒 ضابط: العددان متطابقان (‏' + live.length + ') — لا تكرارَ يُخفي فرقاً');
})();

/* ── 🔴 عقدُ نافذة الدخول المنشور = `BH_LOGIN_FNS` حرفياً + أسوأُ زمنٍ مُحاكىً ──────
 *
 * **العلّةُ التي يغلقها (2026-09-13):** حارسُ مطابقةِ هذه الأسماء بمصدر GAS يقرأ المستودعَ
 * الشقيق **من القرص**، وهو خاصٌّ وغيرُ مُحضَرٍ في CI هذا ⇒ `SKIPPED`. فإعادةُ تسميةِ إحداها
 * هناك **تُسقط نافذةَ القبول الأوسع صامتاً**: لا خطأ · لا سطرٌ أحمر — فقط **رفضُ دخولٍ
 * أكثرُ في أسوأ لحظة**. 🎯 **وحارسٌ يتخطّى في البيئة التي تُلزم وحدَها ليس حارساً** —
 * وهذا هو نمطُ `edge-cache-contract.json` نفسُه، لعلّةٍ من فئته.
 *
 * 🔴 **والتأكيدُ ثنائيُّ القطب هو ما يمنع الملفَّ من أن يصير النسخةَ الثالثة:** يحمرّ على
 * **زيادةٍ** في الكود لا يعلنها العقد، وعلى **نقصٍ** يعلنه العقدُ ولا وجودَ له.
 * 🔗 **و`workerWorstCaseLoginMs` يُقارَن بالقيمة المحسوبة أعلاه لا بمحاكاةٍ ثانيةٍ هنا** —
 * محاكاتان تتباعدان، والحارسُ حينها يقيس نسختَه.
 * ⚠️ **وحدُّه يُقال: يُمكِّن مستهلكَ GAS من الإحمرار ولا يجعله يحمرّ** — الفحصُ هناك، وهذا
 * الملفُّ يضمن أن ما يجلبه **مطابقٌ للمصدر** لا أنه **يُجلَب**.
 */
console.log('');
console.log('عقدُ نافذة الدخول المنشور — مطابقةٌ ثنائيّةُ القطب مع المصدر:');
(function () {
  var LJ = path.join(__dirname, 'login-fns-contract.json');
  if (!fs.existsSync(LJ)) {
    check(false, '🔴 `worker/login-fns-contract.json` مفقود — المستهلكُ الخارجيُّ يجلب فراغاً');
    return;
  }
  var doc;
  try { doc = JSON.parse(fs.readFileSync(LJ, 'utf8')); }
  catch (e) { check(false, '🔴 العقدُ ليس JSON صالحاً — ' + e.message); return; }

  var declared = doc && doc.loginFunctions;
  check(Object.prototype.toString.call(declared) === '[object Array]' && declared.length > 0,
        'ضابط: `loginFunctions` مصفوفةٌ غيرُ فارغة (‏مجموعةٌ فارغة لا تُقرأ نجاحاً)');
  if (Object.prototype.toString.call(declared) !== '[object Array]' || !declared.length) return;

  /* يُشغَّل المصدرُ نفسُه لا يُقرأ نصّاً — تعليقٌ في الكتلة لا يُنتج اسماً وهمياً. */
  var lIdx = src.indexOf('var BH_LOGIN_FNS = {');
  var lEnd = src.indexOf('\n};', lIdx) + 3;
  check(lIdx >= 0 && lEnd > lIdx, 'ضابط: استُخرجت `BH_LOGIN_FNS` من المصدر');
  if (lIdx < 0 || lEnd <= lIdx) return;
  var lctx = vm.createContext({}), liveFns;
  try { vm.runInContext(src.slice(lIdx, lEnd), lctx); liveFns = Object.keys(vm.runInContext('BH_LOGIN_FNS', lctx)); }
  catch (e) { check(false, 'ضابط: الكتلة قابلةٌ للتشغيل — ' + e.message); return; }
  check(liveFns.length > 0, 'ضابط: المصدرُ أعطى اسماً واحداً على الأقلّ (‏صفرٌ = لم يُقَس شيء)');

  var missing = liveFns.filter(function (k) { return declared.indexOf(k) === -1; });
  var extra = declared.filter(function (k) { return liveFns.indexOf(k) === -1; });
  check(missing.length === 0,
        '🔴 قطبٌ ①: كلُّ اسمٍ في `BH_LOGIN_FNS` **معلَنٌ** في العقد' +
        (missing.length ? ' — الناقصُ: ' + missing.join(' · ') : ''));
  check(extra.length === 0,
        '🔴 قطبٌ ②: كلُّ اسمٍ في العقد **موجودٌ** في الكود' +
        (extra.length ? ' — الزائدُ: ' + extra.join(' · ') : ''));
  check(declared.length === liveFns.length,
        '🔒 ضابط: العددان متطابقان (‏' + liveFns.length + ') — لا تكرارَ يُخفي فرقاً');

  /* ═ الرقمان المنشوران يُطابَقان بما حُسب من المصدر — لا يُكتبان بيدٍ فيتقادما ═ */
  check(LOGIN_WORST_MS > 0,
        'ضابط: أسوأُ زمنٍ مُحاكىً حُسب فعلاً قبل مطابقته (‏' + LOGIN_WORST_MS + 'ms)');
  check(doc.workerWorstCaseLoginMs === LOGIN_WORST_MS,
        '🔴 `workerWorstCaseLoginMs` المنشور = المحسوبُ من ثوابت المصدر (‏' +
        doc.workerWorstCaseLoginMs + ' مقابل ' + LOGIN_WORST_MS + ')');
  check(doc.requiredClientMarginMs === LOGIN_MARGIN_MIN_MS,
        '🔴 `requiredClientMarginMs` المنشور = العتبةُ المفروضةُ هنا (‏' +
        doc.requiredClientMarginMs + ' مقابل ' + LOGIN_MARGIN_MIN_MS + ')');

  /* ── الضوابطُ المعاكسة: يُطفَر **العقد** في الذاكرة ويجب أن ينقلب الحكمُ في الاتّجاهين.
     🔴 وبلاها تبقى المطابقةُ دعوى: مجموعتان متساويتان تُنتجان خُضرةً بلا أن تُثبت
     أن عدمَ التساوي يُنتج حمرة. وشرطُ «الطفرةُ وقعت» محمولٌ في كلٍّ. */
  var mutDrop = declared.slice(1);
  check(mutDrop.length !== declared.length &&
        liveFns.filter(function (k) { return mutDrop.indexOf(k) === -1; }).length > 0,
        '🔒 ضابطٌ معاكس ①: **حذفُ اسمٍ من العقد** (إعادةُ تسميةٍ في GAS) ⇒ يُكشف');
  var ZZ_FN = 'zz' + 'Login' + 'Ghost';
  var mutAdd = declared.concat([ZZ_FN]);
  check(mutAdd.length !== declared.length &&
        mutAdd.filter(function (k) { return liveFns.indexOf(k) === -1; }).length > 0,
        '🔒 ضابطٌ معاكس ②: **اسمٌ في العقد بلا وجودٍ في الكود** ⇒ يُكشف');
  check(doc.workerWorstCaseLoginMs + 1 !== LOGIN_WORST_MS,
        '🔒 ضابطٌ معاكس ③: رقمٌ منشورٌ منحرفٌ بمللي‑ثانيةٍ واحدة ⇒ يُكشف — والمطابقةُ صارمةٌ عمداً');
})();

// ── 🔴 `len` في سطر `ev:'gas'` — طولٌ لا محتوى ──────────────────────────────
//
// أُضيف لقياس الفرضيّة المرشَّحة لإخفاق `getTeacherBootBundle` (‏٥٩٫٥٪ مقابل ١٠٫٥٪):
// **حمولةٌ أثقل تتجاوز ميزانيةَ الوسيط**. واقتُرح قياسُها بحقلِ **دور** وهو متعذّرٌ
// بنيويّاً — الجسرُ يرسل `{fn, args, schoolId}` بلا دور. فـ`len` يقيس المتغيّرَ
// المسبِّبَ نفسَه لا وكيلَه.
console.log('');
console.log('سجلُّ `ev:gas` — حقلُ طولِ الحمولة (نصّي مع ضابطٍ معاكس):');
(function () {
  var lIdx = src.indexOf("_bhLog({ ev: 'gas'");
  check(lIdx !== -1, 'ضابط: سطرُ سجلّ `gas` موجودٌ في المصدر');
  if (lIdx === -1) return;
  var line = src.slice(lIdx, src.indexOf('});', lIdx) + 3);
  check(/\blen:/.test(line), '🔴 السطرُ يحمل حقلَ `len` — وبدونه تبقى الفرضيّةُ غيرَ قابلةٍ للقياس');
  check(/lastText\.length/.test(line),
        '🔴 و`len` **طولٌ** مشتقٌّ من `lastText.length` لا قيمةٌ ثابتة');
  /* 🔒 الضابطُ المعاكس الجوهريّ: **الجسمُ نفسُه لا يدخل السجلّ**. تُنزع الاستعمالاتُ
     المشروعة (‏`lastText.length` و`typeof lastText`) ثمّ يُبحَث عمّا بقي — وإلّا حمّر
     الفحصُ على الاستعمال الذي كُتب ليسمح به (فئةُ «حارسٌ يمنع هدفَه»). */
  var bare = line.replace(/lastText\.length/g, '«len»').replace(/typeof lastText/g, '«t»');
  check(!/lastText/.test(bare),
        '🔒 ضابط معاكس: صفرُ ذكرٍ لـ`lastText` عارياً — حمولةُ الردّ لا تدخل السجلّ');
  check(/-1/.test(line),
        '🔒 غيابُ النصّ يُسجَّل `-1` لا `0` — «غيرُ متاح» لا «حمولةٌ فارغة» (نفسُ عقد `srv`)');
})();

/* ── 🔒 عزلُ مفتاح كاش الحافّة — بُعدُ الهويّة لا المستأجرِ وحدَه ──────────────────
   🔴 **الفئةُ وقعت فعلاً في المستودع الشقيق (2026-09-06 · بند 229):** مفتاحُ كاشِ
   أخبارٍ في العميل عزل **المستأجرَ** (`schoolId`) والحمولةُ مفلترةٌ **بالدور** خادمياً
   ⇒ تبديلُ الحساب في نفس التبويب يخدم قائمةَ الحساب السابق. والأخطرُ عكسُ المُبلَّغ:
   حسابُ إدارةٍ يسبق معلّماً ⇒ **يرى المعلّمُ أخبارَ فصولٍ ليست له — تسريبُ نطاقٍ لا
   بطءُ تحديث**.
   ⚠️ **والدرسُ المنقول: وجودُ بُعدِ عزلٍ واحدٍ يُقرأ عزلاً تامّاً**، فيطمئنّ قارئُه.
   ⇒ يُثبَّت هنا **سلوكياً** أن هذا المستودع مُحصَّنٌ بنيويّاً لا بحسن الظنّ:
   ① أيُّ مفتاحِ جسمٍ خارج `{fn,args,schoolId}` **يُعطّل الكاش كلّياً** (لا يُتجاهَل)
     — فتوكنٌ في حقلٍ رابع يمنع التخزين بدل أن يُسمّم مدخلاً مشتركاً.
   ② `argsKey` يحمل **كلَّ الوسائط** لا `schoolId` وحدَه ⇒ أيُّ بُعدٍ يسافر في `args`
     (هويّةً كان أو غيرَها) **داخلٌ في المفتاح حتماً**.
   🔴 **وحدُّ الإثبات يُقال:** هذا يُحصّن ضدّ هويّةٍ في **الجسم**، ولا يشهد لهويّةٍ
   تسافر في **ترويسة**. والقائمةُ البيضاء اليوم أربعُ دوالَّ عامّةٍ لا تتبدّل حمولتُها
   بالهويّة — **فإن أُضيفت دالّةٌ تتبدّل، لزم بُعدٌ صريحٌ في المفتاح.** */
console.log('');
console.log('عزلُ مفتاح كاش الحافّة (سلوكي عبر `vm`):');
(function () {
  var pIdx = src.indexOf('var API_CACHE_TTL_S');
  var pEnd = src.indexOf('\n}', src.indexOf('function _apiCacheProbe(')) + 2;
  check(pIdx >= 0 && pEnd > pIdx, 'ضابط: استُخرجت كتلةُ المِجَسّ من المصدر');
  if (pIdx < 0 || pEnd <= pIdx) return;
  var pctx = vm.createContext({ JSON: JSON, Object: Object, encodeURIComponent: encodeURIComponent });
  var probe;
  try { vm.runInContext(src.slice(pIdx, pEnd), pctx); probe = vm.runInContext('_apiCacheProbe', pctx); }
  catch (e) { check(false, 'ضابط: الكتلة قابلةٌ للتشغيل — ' + e.message); return; }
  check(typeof probe === 'function', 'ضابط: المِجَسُّ قابلٌ للتشغيل فعلاً');

  var body = function (o) { return JSON.stringify(o); };
  var base = { fn: 'getHomePageBundle', args: ['SID-A'], schoolId: 'SID-A' };

  // ضابطٌ موجب: النداءُ المشروع يُنتج مفتاحاً — وإلّا كان ما يليه فراغاً.
  var ok = probe(body(base));
  check(!!ok && !!ok.argsKey, 'ضابط موجب: النداءُ المشروع يُنتج `argsKey` (لا فحصَ على فراغ)');

  // ① حقلٌ رابعٌ (توكنٌ مثلاً) ⇒ **لا كاشَ إطلاقاً**، لا تجاهلاً للحقل.
  check(probe(body({ fn: 'getHomePageBundle', args: ['SID-A'], schoolId: 'SID-A', token: 'T' })) === null,
        '🔒 ① حقلُ جسمٍ رابع (‏توكن) **يُعطّل الكاش** — لا يُتجاهَل فيُسمّم مدخلاً مشتركاً');

  // ② اختلافُ الوسائط ⇒ اختلافُ المفتاح، ولو تطابق `schoolId`.
  var a = probe(body({ fn: 'getHomePageBundle', args: ['SID-A', 'm1'], schoolId: 'SID-A' }));
  var b = probe(body({ fn: 'getHomePageBundle', args: ['SID-A', 'm2'], schoolId: 'SID-A' }));
  check(!!a && !!b && a.argsKey !== b.argsKey,
        '🔒 ② `argsKey` يتبع **كلَّ الوسائط** لا `schoolId` وحدَه — بُعدٌ في `args` داخلٌ في المفتاح حتماً');
  // 🔒 وضابطٌ معاكس: نفسُ المدخل ⇒ نفسُ المفتاح (وإلّا كان الاختلافُ عشوائياً لا دالّياً).
  check(probe(body({ fn: 'getHomePageBundle', args: ['SID-A', 'm1'], schoolId: 'SID-A' })).argsKey === a.argsKey,
        '🔒 ضابط معاكس: نفسُ المدخل ⇒ نفسُ المفتاح (الاختلافُ دالّيٌّ لا عشوائيّ)');
  // ③ واختلافُ المستأجر يبقى فارقاً أيضاً — البُعدُ القديم لم يُفقَد بإضافة الحديث.
  check(probe(body({ fn: 'getHomePageBundle', args: ['SID-A'], schoolId: 'SID-B' })).argsKey !== ok.argsKey,
        '🔒 ③ ضابط معاكس: `schoolId` ما زال بُعداً — مدرستان لا تتشاركان مدخلاً');
  // ④ ومفتاحٌ مجهولٌ داخل كائن الجدول يُرفض (احتمالُ توكن).
  var sched = probe(body({ fn: 'getHomeScheduleBundle', args: [{ schoolId: 'S', klass: 'K', tok: 'T' }], schoolId: 'S' }));
  check(!!sched && sched.reject === 'args',
        '🔒 ④ مفتاحٌ مجهولٌ في كائن الجدول **يُرفض** (‏`reject:args`) — لا يدخل الكاشَ بصمت');
})();

/* ── الصفحاتُ المجمَّدةُ في APK: حراسةُ المحتوى لا رمزِ الحالة ─────────────────
 * 🔴 **فجوةٌ مُثبَتةٌ 2026-09-11، وكادت تقع في اليوم نفسِه.** كلُّ ما سبق يحرس **التوجيه**:
 * أن `/student` و`/schedule` و`/home-all-school` **تُخدَم كما هي** وتردّ `200`. ⇒ **صفحةٌ
 * تُفرَّغ من محتواها تبقى خضراءَ عند كلّ فحص** — 200 وهي قشرة.
 *
 * **والحادثة:** خطّةٌ معتمَدةٌ في `SchoolApp-gas` كانت تبني `/home-all-school/index.html`
 * من `home/Schools.html` بفرضِ أنهما نسختان. **وقياسُ تلك الجلسة نقضه**: ‏128,032 مقابل
 * 93,380 بايتاً، و**ثمانيةُ أقسامٍ لا نظيرَ لها** (أرقامُنا · عن المدرسة · المراحل ·
 * لماذا مدرستنا · الأخبار · الألبوم · الفيديوهات · تواصل). ⇒ **التبديلُ كان يحذف ثمانيةَ
 * أقسامٍ من صفحةٍ يفتحها تطبيقٌ منشور** — و**لا فحصَ هنا كان سيمسكه**، لأن المسارَ يبقى 200.
 *
 * 🎯 **فالحدُّ الذي يُسدّ: «المسارُ يردّ 200» ليس «الصفحةُ تعمل».** وعقدُ الـAPK على
 * المحتوى لا على رمز الحالة — من لا يُحدّث يبقى مكسوراً أبداً.
 *
 * 🔒 **والعتبةُ نسبيّةٌ من خطِّ أساسٍ مُعلَنٍ لا مطلقة:** المطلقةُ تُحمِّر على أيّ نموٍّ
 * مشروع، والنسبيّةُ تتحمّل التحريرَ العاديَّ وتمسك **التفريغ**. و`0.70` مُختارةٌ بالقياس:
 * حذفُ ثمانيةِ أقسامٍ من `home-all-school` ينزل بها إلى ~٦١٪ ⇒ **يُلتقَط**.
 * ⚠️ **وإن كان النقصُ مقصوداً فالإصلاحُ تحديثُ `FROZEN_BASE` في هذا الملفّ** — بقرارٍ
 * مكتوبٍ لا بتجاهلِ حمرة. */
(function () {
  var FROZEN_BASE = {
    // 🔴 أُعيد قياسُه 2026-09-15 بعد تقاعدِ المصدر: كان `131135` لملفٍّ **لم يعد يُبنى**.
    //    المسارُ الآن يُبنى من `home/Schools.html` (‏`SRC_DIR_FOR['home-all-school']='home'`)
    //    ⇒ **٩٩٬٣٠٧** — قِيس من السطح المخدوم حيّاً لا من تقديرٍ سابق.
    //    ⚠️ **ولولا التحديثُ لبقيت العتبةُ `91,795` (‏0.70 × القديم) فيمرّ الجديدُ بهامشِ
    //    ٨٪ فقط** ⇒ أوّلُ تقليمٍ عاديٍّ في `home/Schools.html` يُحمِّر الحارسَ **بلا عطب**،
    //    ويقول «الصفحةُ المجمَّدةُ فُرِّغت» وهي لم تُفرَّغ — بل كان خطُّ الأساس يقيس
    //    **ملفّاً استُبدل**. 🎯 فئةٌ تُسمّى: *حارسٌ يحمل خطَّ أساسٍ لشيءٍ لم يعد موجوداً.*
    'home-all-school/index.html': 99307,
    'student/index.html': 517983,
    'schedule/index.html': 9109
  };
  var FLOOR = 0.70;
  Object.keys(FROZEN_BASE).forEach(function (rel) {
    var size = -1;
    try { size = fs.statSync(path.join(__dirname, '..', 'frontend', rel)).size; }
    catch (e) { size = -1; }
    var min = Math.round(FROZEN_BASE[rel] * FLOOR);
    var good = size >= min;
    if (!good) failed++;
    console.log((good ? '  ✅ ' : '  ❌ ') +
      '🔒 صفحةٌ مجمَّدةٌ في APK غيرُ مفرَّغة: `' + rel + '` [' + size +
      ' ≥ ' + min + ' · أساس ' + FROZEN_BASE[rel] + ']' +
      (size === -1 ? ' — 🔴 **غائبةٌ عن `frontend/`**' : ''));
  });
})();

/* ── عقدُ Digital Asset Links ───────────────────────────────────────────────
 * 🔴 **لماذا حارسٌ على ملفٍّ يبدو ثابتاً:** `assetlinks.json` يخدم **ميزتين**
 * (‏App Links و**WebAuthn** — «الدخول بالبصمة»)، و**عطبُه صامتٌ تماماً**: أثرُه
 * الوحيدُ `Domain verification state: none` على جهاز المستخدم — **بلا خطإٍ في أيّ
 * سجلّ، وبلا فرقٍ في رمز الحالة.** ⇒ رمزُ `200` يُثبت **خدمةَ الملفّ** لا
 * **تحقّقَ النظام منه** — طبقتان لا تُخلطان، والفحصُ هنا يمسك الأولى وحدَها.
 *
 * ⚠️ **والفحصُ سلوكيٌّ لا نصّيّ:** تُستخرَج الكتلةُ وتُنفَّذ في `vm` ثمّ يُحلَّل
 * ناتجُها — فـ`grep` على اسم حزمةٍ يمرّ على تعليقٍ يذكرها، ويسقط على إعادةِ تنسيق.
 * 🔴 **وفشلُ الاستخراج أحمرُ لا تخطٍّ صامت:** إعادةُ تسميةِ متغيّرٍ في الوركر كانت
 * ستُطفئ الحارسَ بلا أن يحمرّ شيء — وهو بعينه ما يجعل حارساً يبدو عاملاً وهو ميّت.
 */
(function () {
  console.log('');
  console.log('عقدُ `assetlinks.json` (استخراجٌ سلوكيٌّ بـ`vm` + طفرةٌ مقصودة):');

  var s = src.indexOf('var alFingerprints = [');
  var b = src.indexOf('var alBody = JSON.stringify(', s);
  var e = b < 0 ? -1 : src.indexOf('\n', src.indexOf(']);', b));
  if (s < 0 || b < 0 || e < 0) {
    failed++;
    console.log('  ❌ 🔴 تعذّر استخراجُ كتلة `assetlinks` من الوركر — **عطبُ مُدخَلٍ لا نجاح**');
    return;
  }
  var block = src.slice(s, e);

  function evalBlock(txt, host) {
    /* 🔴 `url.hostname` يُحقَن لأن الملفَّ صار **مُفرَّعاً بالمضيف** (تضييقُ سلطة).
       وبلا الحقن ترمي الكتلةُ ويُقرأ ذلك «عطبَ استخراج» لا «عطبَ عقد». */
    var c = vm.createContext({ JSON: JSON, url: { hostname: host } });
    vm.runInContext(txt, c);
    return JSON.parse(vm.runInContext('alBody', c));
  }

  /* 🎯 **العقدُ صار مشروطاً بالمضيف، فيُقاس على كلّ مضيفٍ حقيقيّ لا على واحد.**
     ولكلِّ صفٍّ **حزمةٌ متوقَّعةٌ وحزمةٌ ممنوعة** — لأن فحصَ الوجود وحدَه يمرّ على
     ملفٍّ يعلن الجميعَ في كلّ مكان، وهو بالضبط ما جاء التضييقُ ليمنعه. */
  var SCOPE = [
    /* 🟢 صارت **بصمتين** 2026-09-17: مفتاحُ الرفع + مفتاحُ توقيع Play. وبواحدةٍ (الرفعِ
       وحدَه) يفشل `autoVerify` لكلّ تثبيتٍ من المتجر **صامتاً** — قِيس بـ`apksigner` على
       حزمةِ `vc3` المسحوبةِ من جهاز المالك ومُثبِّتُها `com.android.vending`. */
    { host: 'app.yemenschoolz.com', want: 'com.yemenschoolz.app', fps: 2,
      deny: 'com.proconrers.schoolappyemen', label: 'مضيفُ «يمن سكولز»' },
    { host: 'yemenschoolz.com', want: 'com.proconrers.schoolappyemen', fps: 2,
      deny: 'com.yemenschoolz.app', label: 'مضيفُ المنشور (‏vc34/35)' },
    { host: 'school.procorners.com', want: 'com.proconrers.schoolappyemen', fps: 2,
      deny: 'com.yemenschoolz.app', label: 'مضيفُ المنشور (‏vc31)' },
    { host: 'school-teacher-proxy.procorners-shop.workers.dev', want: 'com.proconrers.schoolappyemen',
      fps: 2, deny: 'com.yemenschoolz.app', label: 'الافتراضيُّ ⇒ المنشور' }
  ];

  SCOPE.forEach(function (row) {
    var list;
    try { list = evalBlock(block, row.host); }
    catch (err) {
      failed++;
      console.log('  ❌ 🔴 `' + row.host + '` — الكتلةُ لا تُنتج JSON صالحاً: ' +
        String(err.message).slice(0, 50));
      return;
    }
    var st = (list || []).filter(function (x) {
      return x && x.target && x.target.package_name === row.want;
    })[0];
    var fps = st && st.target && st.target.sha256_cert_fingerprints;
    var denied = (list || []).some(function (x) {
      return x && x.target && x.target.package_name === row.deny;
    });
    /* 🔴 والمعرّفُ القديم ممنوعٌ على **كلّ** مضيف — قرارُ مالكٍ 2026-09-15: الجديدُ وحدَه. */
    var hasOld = (list || []).some(function (x) {
      return x && x.target && x.target.package_name === 'com.proconrers.schoolzyemen';
    });
    var good = Array.isArray(list) && list.length === 1 && !!st && !denied && !hasOld &&
      Array.isArray(st.relation) && st.relation.length > 0 &&
      st.target.namespace === 'android_app' &&
      Array.isArray(fps) && fps.length === row.fps &&
      fps.every(function (f) { return typeof f === 'string' && /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(f); });
    if (!good) failed++;
    console.log((good ? '  ✅ ' : '  ❌ ') + row.label + ' ⇒ `' + row.want + '` وحدَه بـ' +
      row.fps + ' بصمة [طول: ' + (Array.isArray(list) ? list.length : '?') +
      ' · بصمات: ' + (Array.isArray(fps) ? fps.length : 'غائبة') +
      (denied ? ' · 🔴 **الممنوعُ حاضر**' : '') +
      (hasOld ? ' · 🔴 **المعرّفُ القديم حاضر**' : '') + ']');
  });

  /* 🔴 الضابطُ المعاكس — وبلاه يكون ما سبق أجوف: يُلغى التفريعُ في **نسخةٍ بالذاكرة**
     (الشجرةُ لا تُمَسّ) بجعل شرط المضيف `false` دائماً ⇒ **يصير مضيفُ «يمن سكولز»
     يخدم حزمةَ المنشور**. ويُطبَع **ما اشتُقّ لا عدَدُه**، فيفضح الفحصَ الأجوف في سطر. */
  var mutated = block.replace(/url\.hostname === 'app\.yemenschoolz\.com'/, 'false');
  var mutatedPkg = '(لم تُطبَّق)';
  if (mutated !== block) {
    try {
      mutatedPkg = (evalBlock(mutated, 'app.yemenschoolz.com')[0] || {}).target.package_name;
    } catch (e2) { mutatedPkg = '(خطأ)'; }
  }
  var mutationBites = (mutated !== block) && mutatedPkg === 'com.proconrers.schoolappyemen';
  if (!mutationBites) failed++;
  console.log((mutationBites ? '  ✅ ' : '  ❌ ') +
    '🔴 طفرة: بإلغاء التفريع يخدم مضيفُ «يمن سكولز» حزمةَ المنشور [المقيس: ' + mutatedPkg + ']');
})();

/* ── 🟢 `getNewsOg` لزواحف المعاينة وحدَها (سلوكي + بنيوي · 2026-09-17) ─────────────
   الإنسانُ كان ينتظر نداءَ GAS قبل أوّل بايت (TTFB 2.7–8.4 ث مقيساً). ⇒ قطبان:
   الزاحفُ **يحصل** على الحقن، والمتصفّحُ **لا ينتظر**. وبنيويّاً: البوّابةُ على شرط
   الكتلة نفسِها قبل `fetch` لا بعده — بوّابةٌ بعد النداء تُبقي الانتظارَ وتُخفي الوسوم فقط. */
/* ── 🎯 المعرّفُ القانونيُّ واحدٌ في وقت التشغيل (سلوكي + بنيوي · 2026-09-17) ────────
   قرارُ مالك: «أسلوبٌ واحد». والتنفيذُ **حلٌّ عند الباب لا حذفُ سطح**: الاسمُ المختصرُ
   يُحَلّ إلى UUID مرّةً، وما بعده بمعرّفٍ واحد. وهذه الفحوصُ تُثبت الأمرين معاً:
   أن الحلَّ يقع، وأن غيابَ الأزواج **لا يُنتج هويّةً خاطئة** بل سلوكَ الأمس. */
console.log('');
console.log('المعرّفُ القانونيُّ واحد (slug ⇒ UUID):');
(function () {
  var sIdx = src.indexOf('function _slugsCacheKey(');
  var sEnd = src.indexOf('\n}', src.indexOf('async function _tenantCanonical(')) + 2;
  if (sIdx < 0 || sEnd <= sIdx) {
    check(false, 'ضابط: تعذّر استخراج كتلةِ سجلّ الـslugs — الفحص أجوف'); return;
  }
  var blk = src.slice(sIdx, sEnd).replace(/async function/g, 'function').replace(/await /g, '');
  var stripOk = blk.indexOf('await ') === -1 && blk.indexOf('function _tenantCanonical(') !== -1;
  check(stripOk, 'ضابط: التجريدُ نجح والجسمُ باقٍ');
  if (!stripOk) return;
  var store = {}, refreshed = 0;
  var ctx = vm.createContext({
    JSON: JSON, Object: Object, Array: Array, String: String,
    Request: function (u) { this.url = u; },
    Response: function (b) { this._t = b; this.json = function () { return JSON.parse(b); }; },
    caches: { default: { match: function (r) { return store[r.url]; },
                         put: function (r, resp) { store[r.url] = resp; } } },
    _RESERVED_TOP_PATHS: { 'teacher': 1 },
    _SCHOOL_UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    _slugsRefresh: function () { refreshed++; return null; }
  });
  vm.runInContext(blk, ctx);
  var canon = vm.runInContext('_tenantCanonical', ctx);
  var keyOf = vm.runInContext('_slugsCacheKey', ctx);
  var EB = '12725ed7-c139-422c-a2d1-ec0ddd358104';
  var put = function (doc) {
    store[keyOf('https://x').url] = { json: function () { return doc; } };
  };
  put({ slugs: ['ibn-khaldoun', 'abdaawatmuaz'], pairs: { 'ibn-khaldoun': EB } });
  check(canon('ibn-khaldoun', 'https://x', null) === EB,
        '🎯 الاسمُ المختصرُ يُحَلّ إلى المعرّف القانونيّ');
  check(canon('IBN-KHALDOUN', 'https://x', null) === EB,
        'والحالةُ الكبيرةُ تُطبَّع قبل الحلّ');
  check(canon(EB, 'https://x', null) === EB && canon(EB.toUpperCase(), 'https://x', null) === EB,
        '🔒 المعرّفُ يمرّ كما هو (لا حلَّ لما هو قانونيٌّ أصلاً)');
  check(canon('abdaawatmuaz', 'https://x', null) === 'abdaawatmuaz',
        '🔒 ضابط معاكس: slug بلا زوجٍ في السجلّ ⇒ يبقى كما وصل (fail-open لا هويّةٌ خاطئة)');
  put({ slugs: ['ibn-khaldoun'] });
  check(canon('ibn-khaldoun', 'https://x', null) === 'ibn-khaldoun',
        '🔒 ضابط معاكس: سجلٌّ بالشكل القديم (بلا `pairs`) ⇒ سلوكُ الأمس بلا كسر');
  check(canon('', 'https://x', null) === '',
        '🔒 مفتاحٌ فارغ ⇒ فارغ');
  var before = refreshed;
  canon('ibn-khaldoun', 'https://x', null);
  check(refreshed === before,
        '🔴 وصفرُ تحديثٍ إضافيٍّ والسجلُّ حاضر — لا نداءَ GAS على مسارِ صفحةٍ يراها إنسان');

  /* بنيويّ: السلسلةُ تستهلك المفتاحَ **بعد** التوحيد، وإلّا بقي الحلُّ بلا أثر. */
  var chain = src.indexOf('_tenantKeyFrom(_rawPath, url.search)');
  var afterChain = src.slice(chain, chain + 1200);
  check(/_tenantKey = await _tenantCanonical\(_tenantKey, url\.origin, env\)/.test(afterChain),
        '🔴 بنيوي: التوحيدُ يقع مباشرةً بعد اشتقاق المفتاح');
  check(afterChain.indexOf('_tenantCanonical') < afterChain.indexOf('_brandFromCache'),
        '🔴 بنيوي: **قبل** قراءة كاش الهويّة — وإلّا بقي مدخلان للمدرسة الواحدة');
  /* 🔒 والسطحُ العامّ لا يُمَسّ: الرابطُ القانونيُّ يبقى بالاسم المختصر. */
  check(/function _canonicalFor\(path, pathSlug, schoolParam\)/.test(src) &&
        src.indexOf('_canonicalFor(path, _pathSlug') !== -1,
        '🔒 `_canonicalFor` ما زال يُبنى من مقطع المسار (الفهرسةُ بالاسم المختصر)');
})();

console.log('');
console.log('حقنُ OG لزواحف المعاينة وحدَها:');
(function () {
  var rIdx = src.indexOf('var _PREVIEW_CRAWLER_RE');
  var rEnd = src.indexOf('\n}', src.indexOf('function _isPreviewCrawler(')) + 2;
  check(rIdx >= 0 && rEnd > rIdx, 'ضابط: استُخرجت `_isPreviewCrawler` من المصدر');
  if (rIdx < 0 || rEnd <= rIdx) return;
  var cctx = vm.createContext({});
  vm.runInContext(src.slice(rIdx, rEnd), cctx);
  var isCrawler = vm.runInContext('_isPreviewCrawler', cctx);
  var BOTS = [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A',
    'Twitterbot/1.0',
    'TelegramBot (like TwitterBot)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
  ];
  BOTS.forEach(function (ua) {
    check(isCrawler(ua) === true, 'زاحف ⇒ يُحقَن: ' + ua.slice(0, 32));
  });
  check(isCrawler('') === true && isCrawler(null) === true,
        '🔒 UA فارغ ⇒ زاحف (خطأُ هذا الاتجاه نداءٌ زائد لا بطاقةٌ مكسورة)');
  var HUMANS = [
    'Mozilla/5.0 (Linux; Android 14; SM-A146P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0'
  ];
  HUMANS.forEach(function (ua) {
    check(isCrawler(ua) === false, '🔴 متصفّح/WebView ⇒ **لا انتظارَ GAS**: ' + ua.slice(13, 45));
  });

  var gIdx = src.indexOf("var _newsId = url.searchParams.get('news');");
  var fIdx = src.indexOf("fn: 'getNewsOg'", gIdx);
  var seg = gIdx >= 0 && fIdx > gIdx ? src.slice(gIdx, fIdx) : '';
  check(seg.length > 0, 'ضابط: استُخرجت كتلةُ `?news=` حتى نداء `getNewsOg`');
  check(/if \(_newsId && isHtml && _isPreviewCrawler\(request\.headers\.get\('User-Agent'\)\)\)/.test(seg),
        '🔴 البوّابةُ في شرط الكتلة **قبل** `fetch` — لا بعده');
  check(seg.indexOf('_bhAcquire') > seg.indexOf('_isPreviewCrawler('),
        '🔒 والمتصفّحُ لا يحجز مقعداً من المنظّم أصلاً');
})();

/* ═══ `/client-err` — تعقيمٌ بقائمةٍ بيضاء وحدٌّ لكلّ IP (‏2026-09-18) ═══════════════
   سلوكيٌّ لا نصّيّ: الكتلةُ النقيّة تُستخرَج بين مرساتَيها وتُشغَّل. ولكلّ قبولٍ رفضٌ مقابل
   — مِعقِّمٌ يقبل كلَّ شيء يمرّ فحوصَ القبول وحدَها أخضر. */
(function () {
  console.log('');
  console.log('وجهةُ أخطاء العميل /client-err:');
  function check(ok, label) { if (!ok) failed++; console.log((ok ? '  ✅ ' : '  ❌ ') + label); }
  var a = src.indexOf('var _CE_KEYS');
  var b = src.indexOf('/* ═══ نهايةُ `/client-err` النقيّة ═══ */');
  var u = src.indexOf('var _SCHOOL_UUID_RE = ');
  check(a >= 0 && b > a && u >= 0, 'ضابط: استُخرجت الكتلةُ النقيّة و`_SCHOOL_UUID_RE`');
  if (!(a >= 0 && b > a && u >= 0)) return;
  var ce = vm.createContext({});
  vm.runInContext(src.slice(u, src.indexOf('\n', u)) + '\n' + src.slice(a, b), ce);
  function san(o) { ce.__o = o; return vm.runInContext('_clientErrSanitize(__o)', ce); }
  var UUID = '59b7d9f5-64ed-4894-8945-3df6d211b74f';
  var good = { app: 'teacher', fn: 'getTeacherBootBundle', kind: 'timeout', status: 0,
               ms: 24012.6, schoolId: UUID, page: '/teacher/index.html' };
  var r = san(good);
  check(!!r && r.ev === 'clienterr' && r.fn === 'getTeacherBootBundle' && r.ms === 24013 && r.sid === UUID,
        'سجلٌّ صالحٌ كامل ⇒ يُقبَل ويُعقَّم (`ms` مقرَّب · `ev:clienterr`)');
  check(!!san({ app: 'home', kind: 'js' }), 'الحدُّ الأدنى (app + kind) ⇒ يُقبَل');
  function withKey(k, v) { var o = JSON.parse(JSON.stringify(good)); o[k] = v; return o; }
  check(san(withKey('msg', 'x')) === null, '🔴 حقلٌ مجهول ⇒ رفضُ الطلب كلِّه لا تقليمُه');
  check(san(withKey('token', 'abc')) === null, '🔴 `token` (حقلٌ حسّاس) ⇒ رفض');
  // 🔴 أسماءُ خصائصَ موروثةٍ من `Object.prototype` — كانت تتخطّى `!_CE_KEYS[k]` (مراجعةُ #314).
  //    و`JSON.parse` لأنه ما يقع حيّاً: يُنشئ `__proto__` خاصّيةً ذاتيّةً لا نموذجاً أوّلياً.
  ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'].forEach(function (k) {
    var o = JSON.parse('{"app":"teacher","kind":"js","' + k + '":1}');
    check(san(o) === null, '🔴 مفتاحٌ موروثُ الاسم `' + k + '` ⇒ رفض');
  });
  check(san(withKey('app', 'pricing')) === null, 'تطبيقٌ خارج القائمة ⇒ رفض');
  check(san(withKey('kind', 'other')) === null, 'نوعٌ خارج القائمة ⇒ رفض');
  check(san(withKey('page', '/teacher/index.html?t=SECRET')) === null, '🔴 `page` باستعلام ⇒ رفض (التوكنُ يسافر في `?`)');
  check(san(withKey('page', '/teacher/#x')) === null, '`page` بجزء `#` ⇒ رفض');
  check(san(withKey('schoolId', 'abdaawatmuaz')) === null, '`schoolId` ليس UUID ⇒ رفض');
  check(san(withKey('fn', 'x; drop')) === null, '`fn` بمحارفَ خارج الصيغة ⇒ رفض');
  check(san(withKey('status', 700)) === null && san(withKey('status', 5.5)) === null, '`status` خارج 0..599 أو كسريّ ⇒ رفض');
  check(san(withKey('ms', -1)) === null && san(withKey('ms', '5')) === null, '`ms` سالبٌ أو نصّيّ ⇒ رفض');
  check(san(null) === null && san([good]) === null && san('x') === null, 'ليس كائناً ⇒ رفض');

  function rate(ip, t) { ce.__ip = ip; ce.__t = t; return vm.runInContext('_clientErrRate(__ip, __t)', ce); }
  var max = vm.runInContext('CE_RATE_MAX', ce), okN = 0;
  for (var i = 0; i < max; i++) if (rate('1.1.1.1', 1000)) okN++;
  check(okN === max, 'الحدّ: أوّلُ ' + max + ' طلباً في النافذة ⇒ مسموحة');
  check(rate('1.1.1.1', 1000) === false, '🔴 والطلبُ التالي في النافذة نفسِها ⇒ 429');
  check(rate('2.2.2.2', 1000) === true, 'وعنوانٌ آخر لا يتأثّر');
  check(rate('1.1.1.1', 1000 + 60000) === true, 'ونافذةٌ جديدة ⇒ يُسمَح من جديد');

  check(/path === '\/client-err'/.test(src), 'المعالجُ موصول');
  check(/'client-err':\s*1/.test(src), "🔴 `'client-err'` محجوزٌ في `_RESERVED_TOP_PATHS` (وإلّا صار slug مدرسة)");
  var h = src.indexOf("if (path === '/client-err')");
  var hs = h >= 0 ? src.slice(h, src.indexOf('// ── 2) خدمة الموقع الثابت', h)) : '';
  check(hs.length > 0 && hs.indexOf('fetch(') < 0 && !/GAS[.\[]/.test(hs) && hs.indexOf('_bhAcquire') < 0,
        '🔴 صفرُ نداءٍ على GAS في المعالج (لا `fetch(` ولا `GAS.`/`GAS[` ولا مقعدَ منظّم)');
})();

// ── حدُّ تسجيل المشاهدات العامّة لكلّ IP (قرار المالك 2026-09-19) ─────────────────
(function () {
  console.log('');
  console.log('حدُّ تسجيل المشاهدات العامّة:');
  function check(ok, label) { if (!ok) failed++; console.log((ok ? '  ✅ ' : '  ❌ ') + label); }
  var a = src.indexOf('var PV_RATE_WINDOW_MS');
  var b = src.indexOf('/* ═══ نهايةُ حدّ المشاهدات العامّة ═══ */');
  check(a >= 0 && b > a, 'ضابط: استُخرجت الكتلةُ النقيّة (وإلّا لا يُقاس شيء — خروجٌ أحمر)');
  if (!(a >= 0 && b > a)) return;
  var pv = vm.createContext({ String: String, Object: Object, JSON: JSON });
  vm.runInContext(src.slice(a, b), pv);
  function isPv(fn) { pv.__f = fn; return vm.runInContext('_isPublicViewFn(__f)', pv); }
  check(isPv('recordPublicNewsViewBatch') && isPv('recordPublicNewsView'), 'الدالّتان العامّتان ⇒ داخل الحدّ');
  check(!isPv('recordStudentNewsViewsBatch') && !isPv('recordNewsViewsBatchProtected') && !isPv('getHomePageBundle'),
        '🔴 ضابط معاكس: تسجيلُ الطالب/المعلّم (بتوكن) وأيُّ دالّةٍ أخرى ⇒ خارج الحدّ');
  check(!isPv('constructor') && !isPv('toString') && !isPv(''),
        '🔴 `constructor`/`toString`/الفارغ لا تتخطّى القائمة (‏hasOwnProperty)');
  function rate(ip, t) { pv.__ip = ip; pv.__t = t; return vm.runInContext('_publicViewRate(__ip, __t)', pv); }
  var max = vm.runInContext('PV_RATE_MAX', pv), okN = 0;
  check(max >= 60, 'الحدُّ سخيٌّ (≥ 60/دقيقة) — مستخدمو اليمن يتشاركون عناوينَ IP');
  for (var i = 0; i < max; i++) if (rate('9.9.9.9', 5000)) okN++;
  check(okN === max, 'أوّلُ ' + max + ' دفعةً في النافذة ⇒ مسموحة');
  check(rate('9.9.9.9', 5000) === false, '🔴 والتالية في النافذة نفسِها ⇒ مكبوحة');
  check(rate('8.8.8.8', 5000) === true, 'وعنوانٌ آخر لا يتأثّر');
  check(rate('9.9.9.9', 5000 + 60000) === true, 'ونافذةٌ جديدة ⇒ يُسمَح من جديد');
  /* 🔴 اسمُ الدالّة من الجسم كاملاً لا من نافذة الـ200 حرف (ثغرةُ مراجعة #319). */
  function fnOf(body) { pv.__b = body; return vm.runInContext('_publicViewFnOf(__b)', pv); }
  var pad = new Array(400).join('x');
  check(fnOf('{"fn":"recordPublicNewsViewBatch","args":[["1"],"v","s"]}') === 'recordPublicNewsViewBatch',
        'الشكلُ الرسميّ (`fn` أوّلاً) ⇒ يُلتقَط');
  check(fnOf('{"pad":"' + pad + '","fn":"recordPublicNewsViewBatch","args":[]}') === 'recordPublicNewsViewBatch',
        '🔴 حقلٌ طويلٌ قبل `fn` (تجاوزُ نافذة الـ200 حرف) ⇒ **يُلتقَط رغم ذلك**');
  check(fnOf('{"fn":"getHomePageBundle","fn":"recordPublicNewsView"}') === 'recordPublicNewsView',
        '🔴 مفتاحٌ مكرَّر ⇒ آخرُ قيمة، كما يقرؤه GAS تماماً');
  check(fnOf('{"fn":"getHomePageBundle"}') === '' && fnOf('not json') === '' && fnOf('') === '' && fnOf('[1]') === '',
        'ضابط معاكس: دالّةٌ أخرى أو جسمٌ غيرُ JSON ⇒ لا كبح');
  /* الوصل: قبل الكاش والمقعد، بردٍّ ناجحٍ لا يُعاد، ومقصورٌ على home وPOST. */
  var w = src.indexOf('_publicViewFnOf(init.body)');
  var cIdx = src.indexOf('_acProbe = _apiCacheProbe(init.body)');
  var bIdx = src.indexOf('_bhHeld = await _bhAcquire(app');
  check(w > 0 && w < cIdx && w < bIdx, '🔴 الكبحُ يقع قبل كاش الحافّة وقبل حجز المقعد (صفرُ حصّة GAS فوق الحدّ)');
  var seg = w > 0 ? src.slice(src.lastIndexOf('var _pvFn', w), src.indexOf('// ── كاشُ الحافّة', w)) : '';
  check(/request\.method === 'POST' && app === 'home'/.test(seg), 'مقصورٌ على POST لتطبيق `home`');
  check(seg.indexOf('_bhFn') < 0, '🔴 لا يعتمد على `_bhFn` (نافذةُ سجلٍّ لا بوّابةٌ أمنيّة)');
  check(/ok: true, result: \{ success: true, throttled: true/.test(seg),
        '🔴 الردُّ `ok:true` — فلا يعيد `gas-bridge.js` المحاولة فيضاعف الحِمل');
  check(seg.indexOf('CF-Connecting-IP') > 0 && !/ip\s*:/.test(seg), 'يُقرأ IP للحدّ وحده ولا يُسجَّل');
})();

/* ── 🟢 تحويلا `/pricing` و`/register` + حقنُ `window.SCHOOL_ID` (2026-09-19) ──────── */
console.log('');
console.log('تحويلاتُ المضيف نفسِه وحقنُ SCHOOL_ID:');
(function () {
  function grab(startMarker, endMarker) {
    var i = src.indexOf(startMarker);
    var j = i >= 0 ? src.indexOf(endMarker, i) : -1;
    return (i >= 0 && j > i) ? src.slice(i, j) : '';
  }
  var rd = grab('var _SAME_HOST_REDIRECTS', '\n}\n') + '\n}\n';
  var sid = grab('function _schoolIdScript', '\n}\n') + '\n}\n';
  check(rd.length > 20 && sid.length > 20, 'ضابط: استُخرجت الدالّتان (وإلّا لا يُقاس شيء)');
  var ctx = vm.createContext({ Object: Object, String: String, JSON: JSON,
    _SCHOOL_UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i });
  var f, s;
  try { vm.runInContext(rd + sid, ctx); f = vm.runInContext('_sameHostRedirectFor', ctx); s = vm.runInContext('_schoolIdScript', ctx); }
  catch (e) { check(false, 'ضابط: الكتلة قابلةٌ للتشغيل — ' + e.message); return; }
  check(f('/pricing') === '/#pricing' && f('/pricing/') === '/#pricing', '`/pricing` ⇒ `/#pricing` (وبشرطةٍ مائلة)');
  check(f('/register') === '/master-admin/register.html', '`/register` ⇒ صفحةُ التسجيل');
  check(f('/') === '' && f('/abdaawatmuaz') === '' && f('/pricing/x') === '' && f('/constructor') === '' &&
        f('/toString') === '' && f('') === '',
        '🔒 ضابط معاكس: الجذر · slug · مسارٌ أعمق · `constructor` ⇒ لا تحويل');
  var ks = Object.keys(vm.runInContext('_SAME_HOST_REDIRECTS', ctx));
  var allRel = ks.every(function (k) { var v = vm.runInContext('_SAME_HOST_REDIRECTS', ctx)[k]; return v.charAt(0) === '/' && v.charAt(1) !== '/'; });
  check(allRel, '🔴 كلُّ `Location` نسبيٌّ على المضيف نفسِه — لا `//` ولا مضيفٌ آخر (عقدُ المضيفات المجمَّدة)');
  var reservedOk = ks.every(function (k) { return new RegExp("'" + k.slice(1) + "': 1").test(src); });
  check(reservedOk, '🔴 كلُّ مسارٍ مُحوَّلٍ محجوزٌ في `_RESERVED_TOP_PATHS` (وإلّا صار slug مدرسة)');
  var hIdx = src.indexOf('_sameHostRedirectFor(path)');
  var slugIdx = src.indexOf('_schoolSlugFromPath(', src.indexOf('async fetch('));
  check(hIdx > 0 && (slugIdx < 0 || hIdx < slugIdx), '🔴 المعالجُ يسبق حسابَ الـslug (وإلّا ذهب `/register` إلى GAS)');

  var U = '0F8FAD5B-D9CB-469F-A165-70867728950E';
  var out = s(U);
  check(out.indexOf('window.SCHOOL_ID=window.SCHOOL_ID||"' + U.toLowerCase() + '"') > 0,
        '🟢 UUID ⇒ سكربتٌ يحفظ القيمةَ القائمة ويضع القانونيّةَ عند غيابها');
  check(s('abdaawatmuaz') === '' && s('') === '' && s('x";alert(1);//') === '',
        '🔒 ضابط معاكس: slugٌ غيرُ محلول · فارغ · حمولةٌ حرّة ⇒ لا حقن');
  check(/if \(_sidOn\) _rw = _rw\.on\('head', new _SchoolIdHead\(_tenantKey\)\)/.test(src) &&
        /_sidSurface === 'home' \|\| _sidSurface === 'teacher' \|\| _sidSurface === 'student'/.test(src) &&
        /_tenantKey && !_newsId && _schoolIdScript\(_tenantKey\)/.test(src),
        'الحقنُ موصولٌ على السطوح الثلاثة وحدَها، بمفتاحٍ محلولٍ إلى UUID وخارج `?news=`');
  /* محدِّدُ التحديث عند الإخفاق: مرّةٌ واحدة لكلّ نافذة — وإلّا صار كلُّ مسارٍ عشوائيٍّ نداءَ GAS. */
  var mr = grab('var SLUGS_MISS_REFRESH_MS', '\n}\n') + '\n}\n';
  var mctx = vm.createContext({});
  try { vm.runInContext(mr, mctx); } catch (eM) { mr = ''; }
  var due = mr ? vm.runInContext('_slugsMissRefreshDue', mctx) : null;
  var W = mr ? vm.runInContext('SLUGS_MISS_REFRESH_MS', mctx) : 0;
  check(!!due && due(1000000) === true && due(1000001) === false && due(1000000 + W - 1) === false &&
        due(1000000 + W) === true,
        '🔴 التحديثُ عند الإخفاق: الأوّلُ يمرّ · ما داخل النافذة يُحجب · وبعدها يمرّ واحدٌ من جديد');
  check(W >= 10000, '🔴 النافذةُ ≥ ١٠ ثوانٍ — نافذةٌ صغيرةٌ تجعل المسحَ العشوائيَّ حِملاً على GAS');
  /* ── 🟢 stale-while-revalidate (قرار المالك 2026-09-19) — سلوكيّ عبر `vm` بمحاكاة ── */
  var rv = grab('var _apiRevalidating', '\n}\n') + '\n}\n';
  var rvCalls;
  var rvCtx = vm.createContext({
    Object: Object, AbortController: AbortController, setTimeout: setTimeout, clearTimeout: clearTimeout,
    GAS: { home: 'https://g/home', teacher: 'https://g/teacher', student: 'https://g/teacher' },
    _bhAcquire: function (app, w) { rvCalls.acquire.push(w); return Promise.resolve(rvCtx.__seat ? { app: app } : null); },
    _bhRelease: function (s) { if (s) rvCalls.release++; },
    _bhTake: function (app) { rvCalls.take++; return { app: app, forced: true }; },
    _apiCachePut: function (o, a, p, t) { rvCalls.put.push(t); return Promise.resolve(t.charAt(0) === '{'); },
    fetch: function (u, init) { rvCalls.fetch.push(u + ' ' + init.body); return rvCtx.__gate.then(function () { return { status: rvCtx.__st, text: function () { return Promise.resolve(rvCtx.__txt); } }; }); },
    __seat: true, __st: 200, __txt: '{"ok":true}', __gate: Promise.resolve()
  });
  var rvOk = true;
  try { vm.runInContext(rv, rvCtx); } catch (eR) { rvOk = false; }
  check(rvOk && typeof vm.runInContext('_apiCacheRevalidate', rvCtx) === 'function',
        'ضابط: استُخرجت `_apiCacheRevalidate` (وإلّا لا يُقاس شيء)');
  if (rvOk) {
    var R = vm.runInContext('_apiCacheRevalidate', rvCtx);
    var P = { fn: 'getHomePageBundle', argsKey: 'K1' };
    var reset = function () { rvCalls = { acquire: [], release: 0, put: [], fetch: [], take: 0 }; };
    var results = [];
    reset(); rvCtx.__seat = true; rvCtx.__st = 200; rvCtx.__txt = '{"ok":true}';
    var gateOpen; rvCtx.__gate = new Promise(function (r) { gateOpen = r; });
    var a1 = R('https://o', 'home', P, 'BODY', {}), a2 = R('https://o', 'home', P, 'BODY', {});
    gateOpen();
    results.push(Promise.all([a1, a2]).then(function (ws) {
      check(ws[0] === 'store' && ws[1] === 'dup' && rvCalls.fetch.length === 1,
            '🔴 تحديثان متزامنان للمفتاح نفسِه ⇒ نداءٌ واحد والثاني `dup` (لا نداءَ لكلّ زائر)');
    }).then(function () {
      check(rvCalls.put.length === 1 && rvCalls.release === 1,
            '🟢 التحديثُ الأوّل ⇒ نداءٌ واحد · تخزين · وتحريرُ المقعد');
      check(rvCalls.acquire[0] === 0, '🔴 المقعدُ بلا انتظار (`_bhAcquire(app, 0)`) — لا طابورَ في الخلفية');
      reset(); rvCtx.__seat = false; rvCtx.__gate = Promise.resolve();
      return R('https://o', 'home', P, 'BODY', {});
    }).then(function (w) {
      check(w === 'noseat' && rvCalls.fetch.length === 0, '🔴 لا مقعد ⇒ لا نداء (لا حِملَ فوق السقف)');
      reset(); rvCtx.__seat = true; rvCtx.__st = 502;
      return R('https://o', 'home', P, 'BODY', {});
    }).then(function (w) {
      check(w === 'http' && rvCalls.put.length === 0 && rvCalls.release === 1,
            '🔒 ردٌّ فاشل ⇒ لا تخزين فوق البائت الصالح، والمقعدُ يُحرَّر');
      reset(); rvCtx.__st = 200;
      return R('https://o', 'home', P, 'BODY', {});
    }).then(function (w) {
      check(w === 'store', '🔒 المفتاحُ يُحرَّر بعد الانتهاء — التحديثُ التالي ممكن (لا قفلَ أبديّ)');
      reset();
      return R('https://o', 'student', { fn: 'getStudentSchoolBrand', argsKey: 'K2' }, 'B', {});
    }).then(function () {
      check(rvCalls.fetch[0] && rvCalls.fetch[0].indexOf('https://g/teacher?app=student ') === 0,
            '🔴 `student` يحمل `?app=student` كالمسار الرئيسيّ (وإلّا خُزّنت هويّةُ المعلّم للطالب)');
      /* مراجعة #326 ①: أصلان بنفس `app/fn/argsKey` ⇒ تحديثان لا `dup`. */
      reset(); rvCtx.__seat = true;
      var g2; rvCtx.__gate = new Promise(function (r) { g2 = r; });
      var o1 = R('https://yemenschoolz.com', 'home', P, 'B', {}), o2 = R('https://app.yemenschoolz.com', 'home', P, 'B', {});
      g2();
      return Promise.all([o1, o2]);
    }).then(function (ws) {
      check(ws[0] === 'store' && ws[1] === 'store' && rvCalls.fetch.length === 2,
            '🔴 مضيفان بالمفتاح نفسِه ⇒ تحديثان (`origin` في مفتاح التوحيد كمفتاح الكاش)');
      /* مراجعة #326 ②: وضعُ الظلّ بلا مقعد ⇒ مقعدٌ مفروضٌ يُحسَب ثمّ يُحرَّر. */
      reset(); rvCtx.__seat = false; rvCtx.__gate = Promise.resolve();
      return R('https://o', 'home', P, 'B', { BULKHEAD_MODE: 'shadow' });
    }).then(function (w) {
      check(w === 'store' && rvCalls.take === 1 && rvCalls.release === 1,
            '🔴 وضعُ الظلّ: التحديثُ يُحسَب في المنظّم (`_bhTake`) ويُحرَّر — لا يختفي من المعايرة');
    }).catch(function (e) { check(false, 'SWR: ' + e.message); }));
    global.__swrPending = Promise.all(results);
  }
  var swrSeg = src.slice(src.indexOf("if (_acFresh === 'fresh')"), src.indexOf('// ── حَجز مقعد قبل إطلاق أي محاولة نحو GAS'));
  check(/if \(_acFresh === 'stale' && ctx && ctx\.waitUntil\)/.test(swrSeg) &&
        swrSeg.indexOf('ctx.waitUntil(_apiCacheRevalidate(') > 0 && swrSeg.indexOf("'X-Api-Stale'") > 0,
        '🔴 البائتُ يُخدَم فوراً **قبل** حجز المقعد والنداء، والتحديثُ في `waitUntil`');
  check(/if \(_acFresh === 'fresh'\)[\s\S]*if \(_acFresh === 'stale'/.test(swrSeg),
        '🔒 المنتهي (`expired`) لا يُخدَم — الفرعان `fresh` و`stale` وحدَهما');
  check(/'X-Api-Cache': 'hit'/.test(swrSeg) && /'X-Api-Cache': 'stale',/.test(swrSeg) &&
        /'X-Api-Cache': 'stale-abort'/.test(src) && /'X-Api-Cache': _acProbe \? 'miss' : 'none'/.test(src),
        '🔬 `X-Api-Cache` على المخارج الأربعة (hit · stale · stale-abort · miss/none) — الإصابةُ مقيسةٌ من الخارج');
  /* 🗑️ `/gas/schedule` ⇒ 410 صريح (2026-09-19): المشروعُ غيرُ موجود، والنشرةُ كانت تعيد صفحةَ خطأ HTML
     من Google بحالة 200 وبعنوان JSON. */
  var ret = grab('var _RETIRED_GAS_APPS', '\n};\n') + '\n};\n';
  var retCtx = vm.createContext({});
  var RET = null;
  try { vm.runInContext(ret, retCtx); RET = vm.runInContext('_RETIRED_GAS_APPS', retCtx); } catch (eRt) {}
  check(!!RET && Object.prototype.hasOwnProperty.call(RET, 'schedule') && typeof RET.schedule === 'string' && RET.schedule.length > 0,
        '🗑️ `schedule` متقاعد (410) ومعه نصُّ البديل للمستخدم');
  check(!!RET && !Object.prototype.hasOwnProperty.call(RET, 'teacher') && !Object.prototype.hasOwnProperty.call(RET, 'student') &&
        !Object.prototype.hasOwnProperty.call(RET, 'home') && !Object.prototype.hasOwnProperty.call(RET, 'cms') &&
        !Object.prototype.hasOwnProperty.call(RET, 'master-admin') && !Object.prototype.hasOwnProperty.call(RET, 'pricing') &&
        !Object.prototype.hasOwnProperty.call(RET, 'home-all-school'),
        '🔴 ضابط معاكس: لا تطبيقَ حيٌّ في قائمة المتقاعدين (مشروعا pricing وhome-all-school قائمان)');
  var gIdx = src.indexOf("Object.prototype.hasOwnProperty.call(_RETIRED_GAS_APPS, app)");
  var probeIdx = src.indexOf('_acProbe = _apiCacheProbe(init.body)');
  var optIdx = src.indexOf("if (request.method === 'OPTIONS') {", src.indexOf("var match = path.match(/^\\/gas\\/"));
  var gLineOk = /\n\s*if \(Object\.prototype\.hasOwnProperty\.call\(_RETIRED_GAS_APPS, app\)\) \{\s*\n\s*return jsonResponse\(\{ ok: false, retired: true,[^\n]*\n[^\n]*\}, 410\);/.test(src);
  check(gLineOk, '🔴 الشرطُ نافذٌ حرفياً (لا `false &&` ولا غيرُه) ويعيد 410');
  check(gIdx > 0 && gIdx < probeIdx && optIdx > 0 && optIdx < gIdx,
        '🔴 فحصُ التقاعد بعد OPTIONS وقبل الكاش والمنظّم وأيّ نداءٍ على Google');
  check(/^\s*schedule:\s*'https:\/\/script\.google\.com\/macros\/s\/[^']+\/exec'/m.test(src),
        '🔒 معرّفُ نشرة `schedule` باقٍ في جدول GAS — التقاعدُ في الوسيط لا حذفُ المعرّف');
  check(/el\.prepend\(this\.html/.test(src),
        '🔴 `prepend` لا `append` — يسبق سكربتَ الصفحة الذي يحفظ `window.SCHOOL_ID`');
})();

// ── 🔴 عقدُ الوثيقة ↔ سلوكُ الكود: `/home/index.html` العاري (2026-09-20) ────────
//
// 🔴 **الفجوة التي يقفلها — وهي فجوةُ وثيقةٍ لا كود:** `CLAUDE.md` كان يعدّد
//    «تبقى ٢٠٠: … `/home/index.html` …» **بلا شرطِه**، والمقيسُ حيّاً أن العاريَ يردّ
//    **302** على المضيفات الثلاثة جميعاً و`?school=<slug>` يردّ **200**.
//    ⇒ من يفحص العقدَ حرفياً يستنتج **كسرَ عقدٍ مع تطبيقٍ منشور** فيبدأ إصلاحَ عطلٍ
//    غيرِ قائم — أو يُلغي التحويلَ **فيُعيد تسريبَ 2026-08-14** (‏`getHomePageBundle('')`
//    ⇒ `isOwner:true` و30,056 بايتاً من بيانات مدرسة المالك).
//
// 🎯 **ولماذا فحصٌ بدل تصحيحِ الجملة وحدَها:** الجملةُ المصحَّحةُ **تتقادم ثانيةً**
//    (فئةُ بند 83-ب)، والتأكيدُ الذي يحمرّ لا يتقادم. **والمُختبَرُ هنا التطابقُ بين
//    طرفين، لا وجودُ نصٍّ في أحدهما:** لو حُذفت البوّابةُ من الوركر وبقي النصُّ ⇒ يحمرّ،
//    ولو حُذف النصُّ وبقيت البوّابةُ ⇒ يحمرّ. **قطبان لا قطب.**
//
// ⚠️ **والمرتسى علامةٌ لا عبارة:** `<!-- probe:home-bare-302 -->` — فالنثرُ حولها حرٌّ
//    يُعاد صوغُه بلا كسرِ الحارس، وحذفُها وحدَه هو ما يحمرّ (‏`_docs/قواعد-التنظيف.md` §١٤).
console.log('');
console.log('عقدُ الوثيقة ↔ سلوكُ الكود (`/home/index.html` العاري):');
(function () {
  var mdPath = path.join(__dirname, '..', 'CLAUDE.md');
  var md;
  try { md = fs.readFileSync(mdPath, 'utf8'); } catch (e) { md = null; }

  // 🔴 غيابُ المُدخَل خروجٌ أحمرُ لا تخطٍّ صامت: حارسٌ لا يجد ما يحرسه **ليس أخضر**.
  if (md === null) {
    failed++;
    console.log('  ❌ 🔴 تعذّرت قراءةُ `CLAUDE.md` — الحارسُ بلا مُدخَل (لا يُقرأ نجاحاً)');
    return;
  }

  var anchored = md.indexOf('<!-- probe:home-bare-302 -->') !== -1;
  if (!anchored) failed++;
  console.log((anchored ? '  ✅ ' : '  ❌ ') +
              '🔒 مرتسى العقد `probe:home-bare-302` قائمٌ في `CLAUDE.md`');

  // كتلةُ العقد = من سطر «تبقى ٢٠٠» إلى البند التالي (`\n- **`).
  var bIdx = md.indexOf('**تبقى ٢٠٠:**');
  var block = bIdx === -1 ? '' : md.slice(bIdx, md.indexOf('\n- **', bIdx + 10) + 1 || undefined);

  // ① الوثيقةُ تشترط المعاملَ ولا تعدّ العاريَ في قائمة «تبقى ٢٠٠».
  var docConditions = /بمعامل/.test(block) && /(٣٠٢|302)/.test(block);
  if (!docConditions) failed++;
  console.log((docConditions ? '  ✅ ' : '  ❌ ') +
              '🔴 كتلةُ «تبقى ٢٠٠» تذكر **شرطَ المعامل** و**٣٠٢ للعاري** — لا تعدّ المسارَ مطلقاً');

  // ② البوّابةُ حيّةٌ في الوركر (نفسُ نمط §«الرابط العاري» أعلاه، مستخرَجاً من المصدر).
  var gateLive = /if \(\/\^\\\/home\\\/\(index\|news\)\\\.html\\\/\?\$\/i\.test\(path\) &&/.test(src) &&
                 /return Response\.redirect\(CANONICAL_ORIGIN \+ '\/', 302\);/.test(src);

  // ③ 🔴 **الضابطُ ثنائيُّ القطب — وهو الفحصُ الحقيقيّ:** التطابقُ بين الطرفين.
  //    قيمةٌ واحدةٌ لا تكفي: «الوثيقةُ تقول ٣٠٢» تمرّ على وركرٍ حُذفت بوّابتُه،
  //    و«البوّابةُ قائمة» تمرّ على وثيقةٍ تناقضها. **والمقيسُ هنا تساويهما.**
  var paired = (gateLive === docConditions);
  if (!paired) failed++;
  console.log((paired ? '  ✅ ' : '  ❌ ') +
              '🔴 **الطرفان متطابقان** — البوّابةُ في الوركر ' + (gateLive ? 'قائمة' : '**غائبة**') +
              ' والوثيقةُ ' + (docConditions ? 'تشترط' : '**لا تشترط**') +
              ' ⇒ أيُّ تغيّرٍ في أحدهما وحدَه يحمرّ');
})();

// ── 🔴 `frontend/` المخدوم ضدّ السياسة **النافذة** (2026-09-20) ─────────────────
//
// 🔴 **الفجوة التي يقفلها — وهي الوحيدةُ التي يفتحها فرضُ CSP:** الأربعةُ المفروضة
//    (`object-src` · `form-action` · `base-uri` · `frame-ancestors`) قِيست **صفرَ استعمال**
//    على مخرَج الواجهة **يومَ الفرض**. ⇒ أيُّ دفعةِ واجهةٍ لاحقةٍ من `SchoolApp-gas` تُدخل
//    `<form>` أو `<object>` **تُحجَب عند المستخدم صامتةً** — لا خطأَ في CI ولا في الوركر،
//    **والزرُّ لا يعمل فحسب**.
//
// 🎯 **ولماذا حارسٌ لا عادة:** الجلسةُ النظيرةُ تعهّدت بقياس دفعاتها قبل الدفع، وهو تعهّدٌ
//    صادق — **لكنّ العادةَ تعتمد من يتذكّرها، والحارسَ يعمل بلا أحد**. (وهي حجّتُها هي في
//    `.gitattributes`، تُطبَّق هنا على فئتها.)
//
// ⚠️ **وحدُّه يُقال بصدق: هذا فحصُ مخرَجٍ مولَّدٍ لا فحصُ مصدر.** `frontend/` يُدهَس بأوّل
//    بناء، فالحارسُ يمسك الانتهاكَ **بعد** النقل وقبل الدمج — لا يمنع كتابتَه في `gas`.
//    ⇒ **نقطةُ الإمساك متأخّرةٌ عن المثلى وأبكرُ من المستخدم**، وذلك كلُّ المطلوب هنا.
// 🔴 **والمِجَسُّ أوسعُ من الوسم عمداً — وسببُه خطأٌ وقع لي اليوم:** قِستُ `<form` نصّياً
//    قبل الفرض **ولم أقِس `document.createElement('form')`**، وهو يخضع لـ`form-action`
//    تماماً. ⇒ **العنصرُ يُنشَأ بطريقتين، والمِجَسُّ الذي يرى واحدةً يُطمئن كاذباً.**
console.log('');
console.log('`frontend/` المخدوم ضدّ السياسة النافذة:');
(function () {
  var root = path.join(__dirname, '..', 'frontend');
  var files = [];
  (function walk(d) {
    var ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    ents.forEach(function (e) {
      var p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.html?$/i.test(e.name)) files.push(p);
    });
  })(root);

  // 🔴 غيابُ المُدخَل خروجٌ أحمرُ لا تخطٍّ صامت (نفسُ قاعدة حارس الوثيقة أعلاه).
  if (!files.length) {
    failed++;
    console.log('  ❌ 🔴 صفرُ ملفِّ HTML في `frontend/` — الحارسُ بلا مُدخَل (لا يُقرأ نجاحاً)');
    return;
  }

  /* لكلّ توجيهٍ مفروضٍ **مِجَسّاه**: الوسمُ الحرفيّ **و**الإنشاءُ البرمجيّ.
     و`<base>` حالةٌ خاصّة: `base-uri` يحكم **`href` وحدَه**، و`<base target="_top">`
     (نمطُ Apps Script) **لا يمسّه** ⇒ يُطابَق `href` لا الوسمُ المجرَّد، وإلّا أحمرَّ
     الحارسُ على خمسةِ وسومٍ مشروعةٍ كلَّ يوم. */
  var PROBES = [
    { d: "object-src 'none'",   re: /<object[\s>]|<embed[\s>]|createElement\(\s*['"](?:object|embed)['"]/i },
    { d: "form-action 'self'",  re: /<form[\s>]|createElement\(\s*['"]form['"]/i },
    { d: "base-uri 'self'",     re: /<base[^>]*\shref\s*=|createElement\(\s*['"]base['"]/i }
  ];

  var hits = [];
  files.forEach(function (f) {
    var t;
    try { t = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    PROBES.forEach(function (p) {
      if (p.re.test(t)) hits.push(path.relative(root, f) + ' ⇒ ' + p.d);
    });
  });

  var ok = hits.length === 0;
  if (!ok) failed++;
  console.log((ok ? '  ✅ ' : '  ❌ ') +
    '🔒 صفرُ عنصرٍ يخالف الأربعةَ المفروضة عبر ' + files.length + ' ملفَّ HTML' +
    (ok ? '' : ' — المخالِف: ' + hits.join(' · ')));
  /* 🔴 **ولا يُقرأ هذا الصفرُ شهادةَ سلامةٍ للسياسة كلِّها:** يقيس الأربعةَ المفروضةَ وحدَها.
     `script-src`/`style-src` تعيشان في `Report-Only` بـ`'unsafe-inline'` (دَينٌ مُعلَن)،
     **ولا شيءَ هنا يقيسهما** — بندُ `csp-inline-debt-needs-nonce-migration`. */
})();

/* ── قياسُ الظلّ: fail-closed · وسقفٌ تحت مهلة العميل · والإجهاضُ محروس ───────────
   🔴 **الخطرُ الذي يحرسه:** الظلُّ يترك اتّصالاً صادراً مفتوحاً بعد أن يُخدَم المستخدم.
   فإن انقلب افتراضُه إلى «مُشغَّلٌ ما لم يُطفَأ» صار يعمل في بيئةٍ لم تُعلنه؛ وإن تجاوز
   سقفُه مهلةَ `xhr` العميليّة (60,000) صار يحتجز ما لا مستهلكَ له.
   🔴 **وكلُّ تأكيدٍ هنا بضابطٍ معاكس** — الحالةُ المقبولة والمرفوضة معاً. */
(function () {
  var sIdx = src.indexOf('function _shadowOn(env)');
  var sEnd = src.indexOf('\n}', sIdx) + 2;
  if (sIdx < 0 || sEnd <= 1) {
    console.log('  ❌ ضابط: تعذّر استخراج `_shadowOn` — الفحص أجوف');
    failed++;
    return;
  }
  var sctx = vm.createContext({});
  vm.runInContext(src.slice(sIdx, sEnd) + '; this.f = _shadowOn;', sctx);
  [[undefined, false, '🔴 fail-closed: بيئةٌ معدومة ⇒ مطفأ'],
   [{}, false, '🔴 fail-closed: المفتاحُ غائب ⇒ مطفأ'],
   [{ SHADOW_ABORT: 'off' }, false, '🔴 `off` ⇒ مطفأ'],
   [{ SHADOW_ABORT: 'yes' }, false, '🔴 ضابط: أيُّ قيمةٍ أخرى ⇒ مطفأ (لا تشغيلَ بالمصادفة)'],
   [{ SHADOW_ABORT: 'on' }, true, '🟢 `on` ⇒ مُشغَّل'],
   [{ SHADOW_ABORT: 'ON' }, true, '🟢 ضابط: غيرُ حسّاسٍ للحالة']
  ].forEach(function (c) {
    var got = sctx.f(c[0]);
    var good = (got === c[1]);
    if (!good) failed++;
    console.log((good ? '  ✅ ' : '  ❌ ') + c[2] + '  [' + got + ']');
  });

  /* 🔴 **ثابتٌ عدديّ: سقفُ الظلّ فوق أكبرِ ميزانيّةٍ وتحت مهلة العميل.**
     فوقَ الميزانيّة وإلّا لم يقِس شيئاً بعدها؛ وتحت `xhr.timeout = 60000` وإلّا احتجز
     اتّصالاً تخلّى عنه العميلُ أصلاً. ⇒ **حدّان من الطرفين، لا رقمٌ مختار.** */
  var capM  = src.match(/var SHADOW_CAP_MS\s*=\s*(\d+)/);
  var sampM = src.match(/var SHADOW_SAMPLE\s*=\s*([\d.]+)/);
  var budM  = src.match(/\(isPost \? (\d+) : (\d+)\) - _bhWaited/);
  if (!capM || !sampM || !budM) {
    console.log('  ❌ ضابط: تعذّر قراءةُ ثوابت الظلّ/الميزانيّة — الفحص أجوف');
    failed++;
  } else {
    var cap = +capM[1], samp = +sampM[1], maxBudget = Math.max(+budM[1], +budM[2]);
    var CLIENT_XHR_MS = 60000; // `frontend/assets/gas-bridge.js:122` — المصدرُ هناك
    [[cap > maxBudget, 'سقفُ الظلّ (' + cap + ') فوق أكبر ميزانيّة (' + maxBudget + ')'],
     [cap < CLIENT_XHR_MS, 'سقفُ الظلّ تحت مهلة العميل (' + CLIENT_XHR_MS + ')'],
     [samp > 0 && samp <= 1, 'نسبةُ المسح (' + samp + ') داخل [0,1]'],
     [/if \(!_shadowThis\) controller\.abort\(\);/.test(src),
      '🔴 الإجهاضُ في المؤقّت **محروسٌ** بـ`!_shadowThis` — بلا الحارس يُجهَض الظلُّ فلا يقيس شيئاً']
    ].forEach(function (c) {
      if (!c[0]) failed++;
      console.log((c[0] ? '  ✅ ' : '  ❌ ') + c[1]);
    });
  }
})();

/* 🔴 الفحوصُ غيرُ المتزامنة (SWR) تُنتظَر **قبل** سطر `RESULT` — وإلّا طُبعت بعده فصارت زينةً
   لا حارساً (فئةُ «فحصٌ بلا مُشغِّل»). */
/* 🔴 **حارسُ الحارس:** وعدٌ معلَّقٌ لا يُحلّ يجعل العمليةَ تنتهي **بلا سطر `RESULT` وبرمز 0** —
   أخضرُ كاذب (وقع فعلاً عند كتابة فحوص SWR). ⇒ الخروجُ بلا `RESULT` فشلٌ صريح. */
var __resultPrinted = false;
process.on('exit', function (code) {
  if (!__resultPrinted) { console.log('RESULT: ❌ انتهت العمليةُ بلا حكم (وعدٌ معلَّق)'); process.exitCode = 1; }
});
Promise.resolve(global.__swrPending).then(function () {
  __resultPrinted = true;
  console.log('');
  console.log(failed === 0
    ? 'RESULT: ✅ ' + CASES.length + ' مساراً — التوجيه صحيح وصفر تعطيل لمسار قائم'
    : 'RESULT: ❌ ' + failed + ' فشل');
  process.exit(failed === 0 ? 0 : 1);
});
