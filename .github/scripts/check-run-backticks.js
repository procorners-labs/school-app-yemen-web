#!/usr/bin/env node
/* eslint-disable */
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// check-run-backticks.js — يمنع backtick في كتل `run:` بوركفلوهات هذا المستودع.
//
// **العلّة التي يغلقها (وقعت مقيسةً عند جلسةٍ نظيرة، PR #14 · 2026-09-08):**
// backtick داخل رسالةِ خطأٍ مزدوجةِ الاقتباس في كتلة `run:` ⇒ **استبدالُ أمرٍ لا نصّ**.
// والأثرُ ليس نصّاً مشوَّهاً بل فشلٌ صامتٌ **داخل رسالة الفشل نفسِها**: الحارسُ طبع
// `premise gone:  missing` — أي فقدت رسالتُه مضمونَها — وخرج بحالته المقصودة كما لو نجح.
// فمن يقرأ السجلَّ يرى حارساً حمرَّ بحقّ، ولا يرى أن سببَه ضاع.
//
// 🔴 **ولماذا ليس `bash -n`:** قِيس بالأثر — خرج بـ**صفر** والنحوُ سليم، لأن استبدالَ
//    الأمر **صحيحٌ نحوياً**؛ العلّةُ دلاليّةٌ لا نحويّة. ⇒ `bash -n` ضميمةٌ لا كاشف.
//    ونظيرُه المعاكس مسجَّل: `js-yaml` يصدّق الـYAML **ولا يرى الشِلَّ داخله** ⇒ طبقتان
//    لازمتان معاً، وهذا الملفُّ يغطّي الطبقة الثانية وحدَها.
//
// ⚠️ **واستثناءان إلزاميّان لا تحسين — كلٌّ منهما يمنع إنذاراً كاذباً دائماً:**
//    ① **أسطرُ التعليق `#`** — backtick في تعليقِ شِلٍّ غيرُ ضارٍّ مقيساً (٩ في تعليقات
//       ملفٍّ واحد، و٧ في آخر).
//    ② **المهرَّبُ ``\` ``** — قِيس بالأثر في bash على ثلاث حالاتٍ في سطرٍ واحد:
//         "…`echo X`…"      ⇒ **نُفِّذ**   (فخّ)
//         "…\`echo X\`…"    ⇒ **نصٌّ حرفيّ، لم يُنفَّذ**   (مشروع)
//         "…'`echo X`'…"    ⇒ **نُفِّذ** — 🔴 **المفردُ لا يحمي داخل المزدوج**، وهي الأخطر
//                                        لأنها تبدو محميّة.
//       ⇒ الكاشفُ `(^|[^\])` ` لا «أيُّ backtick». وشاهدٌ ميدانيّ: مِجَسٌّ بلا هذا
//       الاستثناء بلّغ ١٤ مطابقةً **كلُّها مشروعة** (‏٧ مهرَّبة في نصّ Markdown و٧ `$(...)`).
//
// 🎯 **وحدُّ ما يُصاد يُقال: `$(...)` استبدالٌ مقصودٌ لا فخّ** — الفخُّ **استبدالٌ غيرُ
//    مقصودٍ داخل سلسلةِ رسالة**، لا كلُّ استبدال. ولذلك لا يُلاحَق `$(...)` هنا إطلاقاً.
//
// 🟢 **وضابطُه المعاكس مدمَجٌ فيه ويجري في كلّ تشغيلة** (`selfTest` أدناه): يُثبت أنه
//    **يحمرّ** على انتهاكٍ مصطنَع في سطرِ كود، و**يخضرّ** على backtick داخل تعليقٍ وعلى
//    سطرٍ نظيف. وبلا ذلك تكون «صفرُ مطابقة» نقصَ قياسٍ لا شهادةَ سلامة.
// ─────────────────────────────────────────────────────────────────────────────
var fs = require('fs');
var path = require('path');

/* يستخرج أسطرَ الشِلّ من كتل `run:` — متعدّدةَ الأسطر (`|`/`>`) والسطرَ الواحد معاً،
   ويعيد [{ line, text }]. لا يُحلَّل الـYAML بمكتبة: الغرضُ نصُّ الشِلّ لا بنيةُ الملفّ. */
function extractRunLines(source) {
  var lines = String(source).replace(/\r\n/g, '\n').split('\n');
  var out = [];
  var inBlock = false;
  var blockIndent = 0;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    if (inBlock) {
      var blank = line.trim() === '';
      var indent = line.length - line.replace(/^\s*/, '').length;
      if (!blank && indent <= blockIndent) { inBlock = false; i--; continue; }
      if (!blank) out.push({ line: i + 1, text: line });
      continue;
    }

    var m = /^(\s*)-?\s*run:\s*(\|-?\+?|>-?\+?)?\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[2]) { inBlock = true; blockIndent = m[1].length; continue; }
    if (m[3]) out.push({ line: i + 1, text: m[3] });
  }
  return out;
}

/* backtick **غيرُ مهرَّب**: يسبقه بدايةُ السطر أو محرفٌ ليس `\`. */
var BARE_TICK = /(^|[^\\])`/;

function scanSource(file, source) {
  var hits = [];
  var comments = 0;
  var escaped = 0;
  extractRunLines(source).forEach(function (r) {
    var body = r.text.replace(/^\s*/, '');
    if (body.charAt(0) === '#') {            // سطرُ تعليقٍ كامل — مستثنىً إلزامياً
      if (body.indexOf('`') >= 0) comments++;
      return;
    }
    if (BARE_TICK.test(r.text)) {
      hits.push({ file: file, line: r.line, text: r.text.trim() });
    } else if (r.text.indexOf('`') >= 0) {   // مهرَّبٌ وحدَه ⇒ نصٌّ حرفيّ، مشروع
      escaped++;
    }
  });
  return { hits: hits, comments: comments, escaped: escaped };
}

/* ضابطٌ **ثنائيُّ القطب** يجري قبل أيّ حكم: حارسٌ يُثبت أنه يحمرّ ولا يُثبت أنه يخضرّ
   على المشروع **سياجٌ لا حارس** — يُنذر كاذباً فيُتجاهَل، فيسقط معه الحارسُ الأصليّ.
   القطبُ الأحمر: العاري · وذو المفردِ داخل المزدوج (‏المفردُ لا يحمي).
   القطبُ الأخضر: المهرَّب · والتعليق · والنظيف · و`$(...)` المقصود. */
function selfTest() {
  var fixture = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - run: |',
    '          # تعليقٌ فيه `backtick` ولا يجوز الإنذارُ عنه',
    '          echo "premise gone: `git rev-parse HEAD` missing"',
    '          echo "escaped: \\`git rev-parse HEAD\\` literal"',
    '          echo "intended: $(git rev-parse HEAD)"',
    '          echo clean',
    '      - run: echo "inline \'`date`\' looks-quoted-but-runs"',
    '      - run: echo inline-clean'
  ].join('\n');

  var r = scanSource('<self-test>', fixture);
  var problems = [];
  if (r.hits.length !== 2) problems.push('توقّعنا مطابقتين حمراوَين، فجاءت ' + r.hits.length);
  if (r.comments !== 1) problems.push('توقّعنا backtick واحداً مستثنىً في تعليق، فجاء ' + r.comments);
  if (r.escaped !== 1) problems.push('توقّعنا سطراً مهرَّباً واحداً يخضرّ، فجاء ' + r.escaped);
  if (!r.hits.some(function (h) { return h.text.indexOf('premise gone') >= 0; })) {
    problems.push('لم يُلتقط انتهاكُ الكتلة متعدّدة الأسطر');
  }
  if (!r.hits.some(function (h) { return h.text.indexOf('looks-quoted-but-runs') >= 0; })) {
    problems.push('لم يُلتقط المفردَ داخل المزدوج — وهو الأخطر لأنه يبدو محميّاً');
  }
  if (r.hits.some(function (h) { return h.text.indexOf('escaped:') >= 0; })) {
    problems.push('أنذرَ كاذباً عن backtick مهرَّب');
  }
  if (r.hits.some(function (h) { return h.text.indexOf('intended:') >= 0; })) {
    problems.push('أنذرَ كاذباً عن `$(...)` وهو استبدالٌ مقصود');
  }
  return problems;
}

var problems = selfTest();
if (problems.length) {
  console.error('❌ الضابطُ المعاكس أخفق — الكاشفُ نفسُه معطوب، ولا يُقرأ أيُّ «صفرِ مطابقة» بعده:');
  problems.forEach(function (p) { console.error('  · ' + p); });
  process.exit(2);
}

var dir = process.argv[2] || path.join(__dirname, '..', 'workflows');
if (!fs.existsSync(dir)) {
  console.error('❌ مجلد الوركفلوهات غير موجود: ' + dir);
  process.exit(2);
}

var files = fs.readdirSync(dir).filter(function (f) { return /\.ya?ml$/i.test(f); });
var all = [];
var commentTicks = 0;
var escapedTicks = 0;

files.forEach(function (f) {
  var r = scanSource(f, fs.readFileSync(path.join(dir, f), 'utf8'));
  all = all.concat(r.hits);
  commentTicks += r.comments;
  escapedTicks += r.escaped;
});

console.log('الضابطُ ثنائيُّ القطب: ✅ احمرَّ على العاري وعلى المفردِ داخل المزدوج،');
console.log('                      واخضرَّ على المهرَّب وعلى $(...) وعلى التعليق.');
console.log('ملفّات: ' + files.length + ' · مستثنىً: ' + commentTicks + ' في تعليقات · ' +
            escapedTicks + ' مهرَّباً');
console.log('RESULT: ' + all.length + ' backtick غيرِ مهرَّبٍ في أسطرِ كودٍ داخل كتل run:');

if (all.length) {
  all.forEach(function (h) { console.error('  ' + h.file + ':' + h.line + ': ' + h.text); });
  console.error('');
  console.error('🔴 backtick غيرُ مهرَّبٍ في كتلة run: يُنفَّذ كأمر — ولا يحميه الاقتباسُ');
  console.error('   المفرد داخل المزدوج (مقيسٌ بالأثر). إن أردتَ الاستبدالَ فاكتبه $(...)');
  console.error('   صراحةً، وإن أردتَ النصَّ فهرِّبه \\`. والفشلُ هنا صامت: الرسالةُ تفقد');
  console.error('   مضمونَها والخطوةُ تخرج بحالتها المقصودة كما لو نجحت.');
  process.exit(1);
}
process.exit(0);
