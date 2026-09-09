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
// ⚠️ **واستثناءُ أسطر التعليق `#` إلزاميٌّ لا تحسين:** backtick داخل تعليقِ شِلٍّ غيرُ
//    ضارٍّ مقيساً (٩ منها في تعليقات ملفٍّ واحد، و٧ في آخر) ⇒ فحصٌ لا يستثنيها يُنذر
//    كاذباً **دائماً** فيُتجاهَل — وهو الحارسُ الذي يُعلّم تجاهُلَ نفسِه: سياجٌ لا حارس.
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

function scanSource(file, source) {
  var hits = [];
  var comments = 0;
  extractRunLines(source).forEach(function (r) {
    var body = r.text.replace(/^\s*/, '');
    if (body.charAt(0) === '#') {            // سطرُ تعليقٍ كامل — مستثنىً إلزامياً
      if (body.indexOf('`') >= 0) comments++;
      return;
    }
    if (r.text.indexOf('`') >= 0) hits.push({ file: file, line: r.line, text: r.text.trim() });
  });
  return { hits: hits, comments: comments };
}

/* ضابطٌ معاكسٌ يجري قبل أيّ حكم: حارسٌ لا يُثبت أنه يحمرّ يُعامَل معطوباً. */
function selfTest() {
  var fixture = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - run: |',
    '          # تعليقٌ فيه `backtick` ولا يجوز الإنذارُ عنه',
    '          echo "premise gone: `git rev-parse HEAD` missing"',
    '          echo clean',
    '      - run: echo "inline `date`"',
    '      - run: echo inline-clean'
  ].join('\n');

  var r = scanSource('<self-test>', fixture);
  var problems = [];
  if (r.hits.length !== 2) problems.push('توقّعنا مطابقتين في أسطر الكود، فجاءت ' + r.hits.length);
  if (r.comments !== 1) problems.push('توقّعنا backtick واحداً مستثنىً في تعليق، فجاء ' + r.comments);
  if (!r.hits.some(function (h) { return h.text.indexOf('premise gone') >= 0; })) {
    problems.push('لم يُلتقط انتهاكُ الكتلة متعدّدة الأسطر');
  }
  if (!r.hits.some(function (h) { return h.text.indexOf('inline') >= 0; })) {
    problems.push('لم يُلتقط انتهاكُ السطر الواحد');
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

files.forEach(function (f) {
  var r = scanSource(f, fs.readFileSync(path.join(dir, f), 'utf8'));
  all = all.concat(r.hits);
  commentTicks += r.comments;
});

console.log('الضابطُ المعاكس: ✅ اخضرَّ على النظيف واحمرَّ على المصطنَع');
console.log('ملفّات: ' + files.length + ' · backtick في تعليقات (مستثنى): ' + commentTicks);
console.log('RESULT: ' + all.length + ' backtick في أسطرِ كودٍ داخل كتل run:');

if (all.length) {
  all.forEach(function (h) { console.error('  ' + h.file + ':' + h.line + ': ' + h.text); });
  console.error('');
  console.error('🔴 backtick في كتلة run: يُنفَّذ كأمر — استعمل $(...) صراحةً إن أردتَ ذلك،');
  console.error('   أو اقتبس النصّ بعلامةٍ مفردة إن كان نصّاً. والفشلُ هنا صامتٌ: الرسالةُ');
  console.error('   تفقد مضمونَها والخطوةُ تخرج بحالتها المقصودة كما لو نجحت.');
  process.exit(1);
}
process.exit(0);
