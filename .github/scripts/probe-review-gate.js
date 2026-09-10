#!/usr/bin/env node
'use strict';
/**
 * ضابطٌ سلوكيٌّ لبوّابة «تعليقٌ منشور» في `.github/workflows/claude-review.yml`.
 *
 * 🔴 **ولماذا يوجد:** البوّابةُ هي ما يفرّق «راجعت» من «لم تُراجَع»، والفئةُ المخيفةُ فيها
 *    **الأخضرُ المُصدَّق** لا الأحمرُ المزعج. وقد رصدت مراجعةُ `claude[bot]` على PR #243
 *    **بحقٍّ** أن الضابطَ الأوّلَ لم يختبر **المسارَ الأخضرَ الأساسيّ** (`unchecked=0 &&
 *    checked>0`) بل فرعَ غيابِ التعليق وحدَه ⇒ أُنشئ هذا ليغطّيه.
 *
 * 🟢 **ويُشغَّل على نصّ الوركفلو نفسِه لا على نسخةٍ منه** — يُستخرَج جسمُ `run:` ويُنفَّذ
 *    بشِلٍّ حقيقيٍّ مع `gh` مُزيَّفٍ في `PATH`. ⇒ لا نسخةَ منطقٍ تتباعد عن الأصل بصمت.
 *
 * 🔴 **و`gh` المُزيَّفُ يحاكي المقيسَ لا المتوقَّع:** على 404 يخرج بـ`1` **ويطبع جسمَ
 *    الخطأ إلى stdout** (‏قِيس 2026-09-10: ١٢٧ بايتاً) — وهي بعينها العلّةُ التي جعلت
 *    الصيغةَ `$(gh api … || true)` تقرأ جسمَ خطإٍ **بصمةً**.
 *
 * الرموز: `0` سليم · `1` سقط ضابط · `2` **تعذّر القياس** (لا يُقرأ نجاحاً).
 */

var fs = require('fs'), cp = require('child_process'), os = require('os'), path = require('path');

var WF = path.join(__dirname, '..', 'workflows', 'claude-review.yml');
if (!fs.existsSync(WF)) { console.error('🔴 تعذّر القياس: ' + WF + ' غيرُ موجود'); process.exit(2); }

/* ── استخراجُ جسم `run:` بمرساةٍ نصّيّةٍ وضابطٍ على ما استُخرج ──
   🔴 ولا يُقبَل استخراجٌ فارغٌ ولا ناقص: بصماتٌ إلزاميّةٌ تُفحَص، وإلّا خرج بـ2. */
var lines = fs.readFileSync(WF, 'utf8').replace(/\r/g, '').split('\n');
var start = -1;
for (var i = 0; i < lines.length; i++) {
  if (/^\s*run:\s*\|\s*$/.test(lines[i]) && /set -u/.test(lines[i + 1] || '')) { start = i + 1; break; }
}
if (start < 0) { console.error('🔴 تعذّر القياس: لم يُعثَر على كتلة `run: |` تبدأ بـ`set -u`'); process.exit(2); }
var indent = (lines[start].match(/^\s*/) || [''])[0].length;
var body = [];
for (var j = start; j < lines.length; j++) {
  if (lines[j].trim() === '') { body.push(''); continue; }
  if ((lines[j].match(/^\s*/) || [''])[0].length < indent) break;
  body.push(lines[j].slice(indent));
}
var script = body.join('\n');

/* 🔴 **بصماتٌ بنيويّةٌ لا نصوصُ رسائل — صُحِّح 2026-09-10 بعد فئةٍ رفعتها جلسةُ الخلفية:**
   كانت القائمةُ تضمّ `'تعذّر الاستعلام'` وهو **نصُّ رسالةٍ للقارئ**. ⇒ **إعادةُ صياغته
   إلى ما هو أدقُّ (‏«تعذّر القياس») تُحمِّر المِجَسَّ على تحسين.**
   🎯 **والفئة: حارسُ توثيقٍ يُقاس بالشكل يعاقب على استيفاء المضمون** — 🔴 **وضررُه العمليّ
   أنه يدفع لترك الصياغة كما هي كي يبقى أخضر، وهو عكسُ غرضه.**
   🟢 **والمرساةُ على ما يعنيه لا على ما كُتب به:** أسماءُ متغيّراتٍ وحقولٍ مطبوعة —
   `queried` يفرّق «تعذّر الاستعلام» عن «لا تعليق»، وهو **بنيةٌ لا عبارة**. */
var MUST = ['unchecked', 'checked', 'wf_new', 'workflow-file-is-new', 'queried'];
var missing = MUST.filter(function (m) { return script.indexOf(m) < 0; });
if (missing.length) { console.error('🔴 تعذّر القياس: بصماتٌ مفقودةٌ من الكتلة المستخرَجة: ' + missing.join(' · ')); process.exit(2); }
console.log('المستخرَج: ' + body.length + ' سطراً · والبصماتُ الخمسُ حاضرة');

script = script.replace(/\$\{\{\s*steps\.review\.outcome\s*\}\}/g, 'success');
if (/\$\{\{/.test(script)) { console.error('🔴 تعذّر القياس: بقيت تعبيراتُ أكشن غيرُ مُستبدَلة'); process.exit(2); }

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rgate-'));
var sh = path.join(tmp, 'gate.sh'); fs.writeFileSync(sh, script);
var shim = path.join(tmp, 'bin'); fs.mkdirSync(shim);
fs.writeFileSync(path.join(shim, 'gh'), [
  '#!/usr/bin/env bash',
  'case "$*" in',
  '  *"/comments"*)',
  '    if [ "${FAKE_QFAIL:-0}" = 1 ]; then echo "{\\"message\\":\\"Bad credentials\\"}"; exit 1; fi',
  '    printf "%s" "${FAKE_BODY:-}"; exit 0 ;;',
  '  *"/reviews"*) echo "${FAKE_REVIEWS:-0}"; exit 0 ;;',
  '  *"/contents/"*)',
  // 🔴 المحاكاةُ المقيسة: 404 ⇒ رمزُ 1 **ومعه جسمُ الخطأ على stdout**.
  '    if [ "${FAKE_SHA_MISS:-0}" = 1 ] && [[ "$*" == *"ref=main"* ]]; then',
  '      echo "{\\"message\\":\\"Not Found\\",\\"status\\":\\"404\\"}"; exit 1; fi',
  '    if [[ "$*" == *"ref=main"* ]]; then echo BASESHA; else echo HEADSHA; fi; exit 0 ;;',
  'esac',
  'exit 0'
].join('\n'));
fs.chmodSync(path.join(shim, 'gh'), 0o755);

var A = '/actions/runs/999';
var full    = '**Claude finished the task**\n' + A + '\n- [x] أ\n- [x] ب\n';
var partial = '**Claude finished the task**\n' + A + '\n- [x] أ\n- [ ] ب\n';
var noList  = '**Claude finished the task**\n' + A + '\nلا قائمةَ تتبّعٍ إطلاقاً.\n';
var errHead = '**Claude encountered an error**\n' + A + '\n- [x] أ\n- [x] ب\n';

/* 🔴 **العقدُ سلوكيٌّ لا لفظيّ — أُعيد تصميمُه 2026-09-10.**
   كانت كلُّ حالةٍ مرساةً على **نصّ رسالةٍ** (‏«لم تكتمل» · «يُنشئ» · «تعذّر الاستعلام») ⇒
   **أيُّ إعادةِ صياغةٍ للرسالة — ولو إلى ما هو أدقّ — تُحمِّر المِجَسَّ على تحسين.**
   🎯 **فئةُ «حارسُ توثيقٍ يُقاس بالشكل يعاقب على استيفاء المضمون»** (رفعتها جلسةُ الخلفية).
   🟢 **والتصميمُ الآن طبقتان مفصولتان:**
     • **`rc` + `probe` (بنيةٌ مطبوعة) = العقدُ الحاكم** ⇒ سقوطُه **فشل**.
     • **`msg` (نصُّ الرسالة) = تشخيصٌ** ⇒ سقوطُه **تحذيرٌ يُطبَع ولا يُفشِل**.
   ⇒ **إعادةُ الصياغة لا تكسر شيئاً، وتغييرُ السلوك يكسر فوراً.** */
var cases = [
  // الوصف · البيئة · rc · فحصٌ بنيويٌّ على المخرَج (العقد) · نصٌّ للتشخيص (تحذيرٌ فقط)
  ['🟢 مراجعةٌ كاملة ⇒ أخضر',                                     { FAKE_BODY: full },
    0, function (o) { return /`unchecked` = `0`/.test(o) && /`checked` = `[1-9]/.test(o); }, 'مراجعةٌ منشورة'],
  ['🔴 قائمةٌ ناقصة ⇒ أحمر',                                      { FAKE_BODY: partial },
    1, function (o) { return /`unchecked` = `[1-9]/.test(o); }, 'لم تكتمل'],
  ['🔴 لا قائمةَ إطلاقاً (٠ و٠) ⇒ أحمر — يمنع الخضورَ بالمصادفة', { FAKE_BODY: noList },
    1, function (o) { return /`unchecked` = `0`/.test(o) && /`checked` = `0`/.test(o); }, 'لم تكتمل'],
  ['🟢 رأسُ خطإٍ وقائمةٌ كاملة ⇒ أخضر — الرأسُ لا يفصل',          { FAKE_BODY: errHead },
    0, function (o) { return /`unchecked` = `0`/.test(o); }, 'مراجعةٌ منشورة'],
  ['🔴 صفرُ تعليقٍ والملفُّ جديد ⇒ `workflow-file-is-new` = 1',   { FAKE_BODY: '', FAKE_SHA_MISS: '1' },
    1, function (o) { return /`workflow-file-is-new` = `1`/.test(o); }, 'يُنشئ'],
  ['🔴 صفرُ تعليقٍ والملفُّ معدَّل ⇒ `workflow-file-is-new` = 0', { FAKE_BODY: '' },
    1, function (o) { return /`workflow-file-is-new` = `0`/.test(o) && /`workflow-file-differs-from-base` = `1`/.test(o); }, 'يعدّل'],
  // 🟢 تعذّرُ الاستعلام هو الفرعُ **الوحيدُ** الذي لا يطبع حقولَ الوركفلو إطلاقاً ⇒ غيابُها بنيةٌ لا عبارة.
  ['🔴 تعذّرُ الاستعلام ⇒ لا حقولَ وركفلو أصلاً (يفرّقه عن «لا تعليق»)', { FAKE_BODY: full, FAKE_QFAIL: '1' },
    1, function (o) { return o.indexOf('workflow-file-') < 0; }, 'تعذّر']
];

var base = { GH_TOKEN: 'x', REPO: 'o/r', PR: '243', RUN_ID: '999', HEAD_SHA: 'abc', BASE_REF: 'main',
             GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.txt'), PATH: shim + path.delimiter + process.env.PATH };
var fail = 0, warned = 0;
cases.forEach(function (c) {
  var res = cp.spawnSync('bash', [sh], { env: Object.assign({}, process.env, base, c[1]), encoding: 'utf8' });
  var sum = '';
  try { sum = fs.readFileSync(base.GITHUB_STEP_SUMMARY, 'utf8'); } catch (e) { sum = ''; }
  var out = (res.stdout || '') + (res.stderr || '') + '\n' + sum;
  try { fs.unlinkSync(base.GITHUB_STEP_SUMMARY); } catch (e) { /* أوّلُ حالةٍ بلا ملفّ */ }

  var rcOk = res.status === c[2], structOk = c[3](out), msgOk = out.indexOf(c[4]) >= 0;
  if (rcOk && structOk) {
    console.log('  ✅ ' + c[0] + ' ⇒ rc=' + res.status);
    if (!msgOk) { warned++; console.log('     ⚠️ تشخيصٌ فقط: لم تظهر «' + c[4] + '» — **الصياغةُ تغيّرت والسلوكُ سليم، فلا فشل.**'); }
    return;
  }
  fail = 1;
  console.log('  ❌ ' + c[0] + ' ⇒ rc=' + res.status + ' (المتوقَّع ' + c[2] + ')' + (structOk ? '' : ' · سقط الفحصُ البنيويّ'));
  console.log('     ' + out.split('\n').slice(0, 4).join(' | ').slice(0, 240));
});

console.log('');
if (fail) { console.log('RESULT: 🔴 سقط ضابط'); process.exit(1); }
console.log('RESULT: ✅ ' + cases.length + ' حالةً على نصّ البوّابة نفسِه — ومنها المسارُ الأخضرُ الأساسيُّ وقطبُ «٠ و٠»');
process.exit(0);
