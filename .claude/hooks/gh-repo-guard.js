#!/usr/bin/env node
/* eslint-disable */
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// gh-repo-guard.js — يحجب فعلاً مُغيِّراً في GitHub يُحدَّد **برقمٍ صريح بلا `--repo`**.
//
// 🔴 العلّة المقيسة: **رقمُ الـPR ليس معرّفاً عالمياً** — `gh pr merge 12` يعني PR مختلفةً
//    في كلّ مستودع، و`gh` يستنتج المستودعَ من **دليل العمل** لا من الأمر. فأمرٌ صحيحُ
//    الصياغة يُنفَّذ على **المستودع الخطأ** إن كان الدليلُ غيرَ المقصود — بلا خطأ ولا تحذير.
//    وقع قريباً من ذلك فعلاً: أمرٌ من مجلدٍ خطأ **كاد يدمج PR في مستودعٍ آخر**.
//    ⚠️ وهذه الجلسةُ الأكثرُ تعرّضاً للفخّ: عملُها يعبر مستودعين (‏`SchoolApp` و
//    `SchoolApp-gas`)، ودُمجت فيها ستُّ PRs بالرقم في جلسةٍ واحدة.
//
// 🟢 والقاعدة **ثلاثيّةٌ ضيّقة** عمداً — فحارسٌ واسعٌ يُعطَّل، وضيّقٌ يُحترَم:
//    ① فعلٌ **مُغيِّر** (merge/close/edit/…) — **والقراءةُ لا تُحجَب أبداً**
//    ② **ورقمٌ صريح** (‏`gh pr merge` بلا رقمٍ يستعمل فرعَ دليلِك الحاليّ ⇒ لا التباس)
//    ③ **وغيابُ `--repo`/`-R`**.
//    سقوطُ أيٍّ من الثلاثة ⇒ يمرّ.
//
// 🟢 وله ضابطٌ معاكس: `node .claude/hooks/gh-repo-guard.js --self-test`
//    يُثبت أنه **يحمرّ** على الانتهاك و**يخضرّ** على الصيغة الصحيحة. وبلا الشقّ الثاني
//    ينقلب سياجاً يمنع الهدفَ الذي كُتب لحمايته.
// ─────────────────────────────────────────────────────────────────────────────
var fs = require('fs');

/* أفعالٌ **مُغيِّرة** تقبل رقماً. والقراءةُ (‏`view` · `list` · `diff` · `checks` · `status`)
   غائبةٌ عمداً — إدراجُها يجعل الحارسَ يعترض التشخيصَ اليوميّ فيُعطَّل خلال يوم. */
var MUTATING = {
  pr: ['merge', 'close', 'reopen', 'edit', 'ready', 'comment', 'review'],
  issue: ['close', 'reopen', 'edit', 'comment', 'delete', 'pin', 'unpin', 'transfer'],
  run: ['rerun', 'cancel', 'delete'],
  release: ['delete', 'edit']
};

/* 🔴 تُحذَف المناطقُ المقتبَسة قبل المطابقة — نفسُ درسِ `measure-guard`: أوّلُ استعمالٍ له
   حجب **توثيقَ نفسه** (عنوانُ PR يذكر الراية). فذكرُ `gh pr merge 12` داخل رسالةِ كوميت
   أو `--body` أو `echo` **ليس تنفيذاً**، ويجب أن يمرّ. */
function stripQuoted(s) {
  return String(s)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** يُرجع نصَّ الحجب، أو '' إن كان الأمرُ سليماً. مفصولٌ عن الإدخال ليكون قابلاً للاختبار. */
function verdict(cmd) {
  var c = stripQuoted(cmd || '');
  if (!c) return '';
  if (!/\bgh\b/.test(c)) return '';

  // `--repo owner/x` أو `-R owner/x` ⇒ الوجهةُ صريحةٌ فلا التباس.
  if (/(^|\s)(--repo(=|\s)|-R(=|\s))/.test(c)) return '';

  var nouns = Object.keys(MUTATING);
  for (var i = 0; i < nouns.length; i++) {
    var noun = nouns[i];
    var verbs = MUTATING[noun].join('|');
    // ‏`gh <noun> <verb> <رقم>` — الرقمُ **مقطعٌ مستقلٌّ** لا جزءٌ من كلمة.
    var re = new RegExp('\\bgh\\s+' + noun + '\\s+(?:' + verbs + ')\\s+(?:[^\\s]+\\s+)*?(\\d+)(?=\\s|$)');
    var m = re.exec(c);
    if (!m) continue;
    return 'BLOCKED: gh ' + noun + ' <verb> ' + m[1] + ' without --repo  ->  ADD: --repo <owner>/<name>\n\n' +
      '🚫 حُظر: فعلٌ مُغيِّرٌ في GitHub محدَّدٌ **برقمٍ صريح** بلا `--repo`.\n\n' +
      '🔴 **رقمُ الـPR/المسألة ليس معرّفاً عالمياً** — الرقم `' + m[1] + '` يعني شيئاً مختلفاً\n' +
      'في كلّ مستودع، و`gh` يستنتج المستودعَ من **دليل العمل** لا من الأمر.\n' +
      '⇒ أمرٌ صحيحُ الصياغة من مجلدٍ غيرِ المقصود يُنفَّذ على **المستودع الخطأ بلا أيّ تحذير**.\n' +
      'وقد كاد يقع فعلاً: أمرٌ من مجلدٍ خطأ كاد يدمج PR في مستودعٍ آخر.\n\n' +
      '✅ الصيغة الصحيحة:\n' +
      '     gh ' + noun + ' <الفعل> ' + m[1] + ' --repo procorners-labs/<المستودع>\n' +
      '✅ أو احذف الرقمَ ودع `gh` يستعمل فرعَ دليلِك الحاليّ (لا التباسَ حينها).\n' +
      '🟢 والقراءةُ لا تُحجَب: `gh pr view/list/diff/checks` تمرّ بلا `--repo`.\n';
  }
  return '';
}

// ── ضابطٌ معاكس مُثبَت: يحمرّ على الانتهاك ويخضرّ على الصيغة الصحيحة ──────────
if (process.argv.indexOf('--self-test') > -1) {
  var CASES = [
    // [الأمر, أيُحجَب؟, الوصف]
    ['gh pr merge 12 --squash', true, 'الانتهاكُ المقصود: دمجٌ بالرقم بلا --repo'],
    ['gh pr close 222', true, 'إغلاقٌ بالرقم بلا --repo'],
    ['gh issue comment 7 --body-file x.txt', true, 'تعليقٌ على مسألةٍ بالرقم'],
    ['gh run rerun 34245829816', true, 'إعادةُ تشغيلٍ برقمٍ طويل'],
    ['gh pr merge --squash 12', true, 'الرقمُ بعد الراية — الترتيبُ لا يُنجّي'],
    // ── ضوابطُ الاتجاه المعاكس: بلاها يمرّ حارسٌ يحجب كلَّ شيء «أخضرَ» زوراً ──
    ['gh pr merge 12 --squash --repo procorners-labs/rukn-tasawuq-erp', false,
      '🟢 الصيغةُ الصحيحة تمرّ — وإلّا كان الحارسُ سياجاً'],
    ['gh pr merge 222 -R procorners-labs/school-app-yemen-web', false, '‏-R المختصرة تُقبل'],
    ['gh pr merge --squash', false, 'بلا رقم ⇒ يستعمل فرعَ الدليل ⇒ لا التباس'],
    ['gh pr view 222', false, '🟢 القراءةُ لا تُحجَب أبداً'],
    ['gh pr list --state open', false, 'سردٌ يمرّ'],
    ['gh pr diff 222', false, 'فرقٌ يمرّ — تشخيصٌ يوميّ'],
    ['gh pr checks 222', false, 'فحوصٌ تمرّ'],
    ['gh run list -L 3', false, 'سردُ التشغيلات يمرّ'],
    ['git merge main', false, 'ليس `gh` أصلاً'],
    // 🔴 درسُ `measure-guard`: الحارسُ لا يحجب توثيقَ نفسه.
    ['git commit -m "docs: حارسٌ يحجب gh pr merge 12 بلا --repo"', false,
      '🔴 ذِكرٌ داخل اقتباس يمرّ — الحارسُ لا يحجب توثيقَه'],
    ['gh pr create --title "يحجب gh pr merge 12" --body-file x.txt', false,
      '🔴 عنوانُ PR يذكر النمطَ ⇒ يمرّ'],
    ['gh pr merge 12', true,
      'ضابطٌ مضادّ للتضييق: الانتهاكُ خارجَ الاقتباس ما زال يُحجَب']
  ];
  var bad = 0;
  CASES.forEach(function (c) {
    var blocked = verdict(c[0]) !== '';
    var ok = (blocked === c[1]);
    if (!ok) bad++;
    console.log((ok ? '  ✅ ' : '  ❌ ') + c[2] + '  [' + (blocked ? 'محجوب' : 'يمرّ') + ']');
  });
  console.log(bad === 0
    ? 'RESULT: ✅ ' + CASES.length + ' حالة — يحمرّ على الانتهاك ويخضرّ على الصيغة الصحيحة'
    : 'RESULT: ❌ ' + bad + ' فشل');
  process.exit(bad === 0 ? 0 : 1);
}

var input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { process.exit(0); }
var ti = (input && input.tool_input) || {};
var msg = verdict(ti.command);
if (!msg) process.exit(0);
process.stderr.write(msg);
process.exit(2);
