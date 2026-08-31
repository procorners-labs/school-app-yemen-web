#!/usr/bin/env node
/* eslint-disable */
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// protect-deploy-ids.js — يمنع تغيير معرّفات نشر Apps Script داخل الوركر.
//
// **لماذا هذه ثابتةٌ لا تُلمَس:** معرّفات النشر في `var GAS` أعلى `worker/school-app-proxy.js`
// مثبَّتةٌ **داخل APK منشور على Play** (‏`AppConfig.kt` — روابط مجمَّدة بلا Deep Link وبلا
// مزامنة ديناميكية)، وفي `assets/gas-bridge.js` المبنيّ في ثمانيةَ عشرَ صفحة. فتغييرُ معرّفٍ
// واحد يقطع الوصول عن كل مستخدم لا يملك إصداراً جديداً — **ولا سبيل لإصلاحه إلا بنشرة Play
// جديدة**، أي أيامٌ لا دقائق.
//
// **المعيار سلوكيّ لا نصّي:** نستخرج مجموعة الرموز `AKfycb…` من النصّ القديم والجديد ونقارن.
// إضافةُ تعليقٍ أو إعادةُ ترتيبٍ حول المعرّف تمرّ؛ وتبديلُ رمزٍ أو حذفُه يُحظَر. ⇒ لا يحمرّ
// على تحريرٍ بريء، ولا يصمت على التغيير الحقيقيّ.
//
// وإعادةُ النشر الصحيحة **نسخةٌ جديدة لنفس الـDeployment** — لا معرّفٌ جديد. فمن يجد نفسه
// مضطراً لتغيير الرمز هنا فغالباً أخطأ الخطوة، لا الملفّ.
// ─────────────────────────────────────────────────────────────────────────────
var fs = require('fs');
var path = require('path');

var input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { process.exit(0); }

var ti = (input && input.tool_input) || {};
var file = ti.file_path || ti.filePath || ti.path || '';
if (!file) process.exit(0);

var target = String(file).replace(/\\/g, '/');
if (!/\/worker\/[^/]+\.js$/i.test(target)) process.exit(0);

var ID_RE = /AKfycb[A-Za-z0-9_-]+/g;

/** مجموعةٌ مرتَّبة من المعرّفات داخل نصّ (بلا تكرار) — للمقارنة لا للطباعة كاملةً. */
function ids(text) {
  var m = String(text || '').match(ID_RE) || [];
  var seen = {}, out = [];
  for (var i = 0; i < m.length; i++) { if (!seen[m[i]]) { seen[m[i]] = 1; out.push(m[i]); } }
  return out.sort();
}

var before, after;

if (typeof ti.content === 'string') {
  // Write: يُقارَن المحتوى الجديد بالملفّ على القرص (إن وُجد).
  // 🔴 **تعذُّرُ القياس حجبٌ لا مرور** — كان هنا `catch { process.exit(0) }` صامتاً، أي أن
  //  فشلَ قراءة القرص يُقرأ **«نظيف»** فيمرّ التعديلُ بلا مقارنةٍ أصلاً. وهو الفشلُ الصامت
  //  بعينه: الحارسُ يبدو عاملاً ولا يقيس شيئاً. (نمطُ `clasp-deploy-guard` في المستودع الشقيق.)
  //
  // ⚠️ **والتمييزُ إلزاميّ وإلّا انقلب الحارسُ سياجاً يمنع الهدفَ الذي كُتب لحمايته:**
  //  `ENOENT` = ملفٌّ جديد لا وجود له بعد ⇒ لا معرّفاتٍ سابقةً تُقارَن، و**إنشاؤه مسموح**.
  //  وما عداه (‏`EACCES` · `EISDIR` · قرصٌ معطوب) = **قياسٌ تعذّر على ملفٍّ قائم** ⇒ يُحظَر.
  var onDisk = '';
  try {
    onDisk = fs.readFileSync(path.resolve(String(file)), 'utf8');
  } catch (e) {
    if (!e || e.code !== 'ENOENT') {
      process.stderr.write(
        '🚫 حُظر التعديل: تعذّر قراءةُ الملفّ على القرص، فتعذّرت المقارنة.\n\n' +
        '  الملفّ : ' + target + '\n' +
        '  السبب : ' + ((e && e.code) || 'غير معروف') + '\n\n' +
        'هذا الحارسُ يقارن معرّفات النشر قبل التعديل وبعده. وحين يتعذّر القياس فالمرورُ\n' +
        'يعني «لم أفحص» لا «نظيف» — فيُحظَر. أصلِح سببَ تعذّر القراءة ثمّ أعِد المحاولة.\n'
      );
      process.exit(2);
    }
    onDisk = '';   // ENOENT ⇒ ملفٌّ جديد: `before` فارغة، والإنشاءُ يمرّ.
  }
  before = ids(onDisk);
  after = ids(ti.content);
} else if (typeof ti.old_string === 'string' || typeof ti.new_string === 'string') {
  before = ids(ti.old_string);
  after = ids(ti.new_string);
} else if (Array.isArray(ti.edits)) {
  var ob = [], oa = [];
  for (var j = 0; j < ti.edits.length; j++) {
    ob = ob.concat(ids(ti.edits[j].old_string));
    oa = oa.concat(ids(ti.edits[j].new_string));
  }
  before = ids(ob.join(' '));
  after = ids(oa.join(' '));
} else {
  process.exit(0);
}

if (before.join('|') === after.join('|')) process.exit(0);

// نطبع **الفرق عدّاً ومقطعاً قصيراً** لا الرمز كاملاً: المعرّف ليس سرّاً لكنه ضجيجٌ في السجلّ.
function brief(list) {
  return list.length ? list.map(function (s) { return s.slice(0, 12) + '…'; }).join(' · ') : '(لا شيء)';
}

process.stderr.write(
  '🚫 حُظر التعديل: تغييرُ معرّف نشر Apps Script داخل الوركر.\n\n' +
  '  الملفّ : ' + target + '\n' +
  '  قبل   : ' + brief(before) + '\n' +
  '  بعد   : ' + brief(after) + '\n\n' +
  'هذه المعرّفات مثبَّتةٌ داخل APK منشور على Play وفي `assets/gas-bridge.js` المبنيّ في كل\n' +
  'الصفحات. تغييرُ واحدٍ منها يقطع الوصول عن كل مستخدمٍ لا يملك إصداراً جديداً، ولا يُصلَح\n' +
  'إلا بنشرة Play جديدة.\n\n' +
  '✅ إعادةُ النشر الصحيحة: **نسخةٌ جديدة لنفس الـDeployment** — بلا تغيير المعرّف.\n' +
  '   وإن كان التغيير مقصوداً فعلاً فهو قرارُ مالكٍ صريح، ويُنفَّذ بتعطيل هذا الحارس عمداً\n' +
  '   لا بالالتفاف عليه.\n'
);
process.exit(2);
