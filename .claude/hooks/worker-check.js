#!/usr/bin/env node
/* eslint-disable */
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// worker-check.js — فحصٌ تاليَ التعديل لأي ملفّ داخل `worker/`.
//
// **لماذا يلزم هنا تحديداً:** الدمج في `main` بهذا المستودع **يَنشُر حيّاً فوراً** عبر
// Cloudflare Workers Builds. فلا توجد نافذةٌ بين «الكود مكسور» و«الموقع مكسور» يملؤها أحد.
// وCI الخارجيّ يفحص بعد الدفع — أي بعد أن يصير الخطأ مكتوباً في التاريخ.
//
// يشغّل ما يشغّله CI حرفياً، بنفس الأمرين ونفس الترتيب:
//   ① `node --check` على الملفّ المعدَّل — يُثبت أنه يُحلَّل نحوياً.
//   ② `node worker/test-routes.js` — يُثبت أن المسارات تذهب حيث نظنّ. و`node --check` وحده
//      لا يقول شيئاً عن ذلك: `/portal` كان يُرجِع 200 ويُخدَم كـslug مدرسة بصمتٍ تامّ
//      والملفّ سليمٌ نحوياً تماماً.
//
// 🔴 يخرج دائماً بـ**صفر**: هذا مُبلِّغٌ لا حاجز. الفشل يُطبَع ليُقرأ ويُصلَح فوراً؛ وجعلُه
//    حاجزاً يمنع الخطوة التالية من التحرير في منتصف تعديلٍ متعدّد الملفّات — فيُنتج التفافاً
//    بدل إصلاح. الحاجزُ الحقيقيّ هو بروتوكول الدمج، وهذا يجعل الخطأ **مرئياً في حينه**.
// ─────────────────────────────────────────────────────────────────────────────
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { process.exit(0); }

var ti = (input && input.tool_input) || {};
var file = ti.file_path || ti.filePath || ti.path || '';
if (!file) process.exit(0);

var target = path.resolve(String(file));
var norm = target.replace(/\\/g, '/');
if (!/\/worker\/[^/]+\.js$/i.test(norm)) process.exit(0);
if (!fs.existsSync(target)) process.exit(0);

// جذر المستودع = المجلّد الأب لـ`worker/`.
var repoRoot = path.dirname(path.dirname(target));
var out = [];

function run(args, cwd, label, ms) {
  var r = cp.spawnSync(process.execPath, args, {
    cwd: cwd, encoding: 'utf8', timeout: ms, windowsHide: true
  });
  // 🔴 `status === null` مع `r.error` = فشلُ إنشاء عملية لا فشلُ تأكيد — يُصنَّف صراحةً
  //    ولا يُقرأ نجاحاً ولا فشلَ اختبار. (نفس تمييز `hooks:check` في مستودع الـgas.)
  if (r.status === null && r.error) return { ok: false, spawn: true, text: String(r.error.message || r.error) };
  var text = String(r.stdout || '') + String(r.stderr || '');
  return { ok: r.status === 0, spawn: false, text: text };
}

var chk = run(['--check', target], repoRoot, 'syntax', 20000);
if (!chk.ok) {
  out.push(chk.spawn
    ? '🔧 تعذّر تشغيل `node --check` (فشلُ إنشاء عملية): ' + chk.text
    : '❌ `node --check` أخفق:\n' + chk.text.trim().split('\n').slice(0, 12).join('\n'));
} else if (/school-app-proxy\.js$/i.test(norm)) {
  var routes = path.join(repoRoot, 'worker', 'test-routes.js');
  if (fs.existsSync(routes)) {
    var rt = run([routes], repoRoot, 'routes', 60000);
    if (!rt.ok) {
      out.push(rt.spawn
        ? '🔧 تعذّر تشغيل `worker/test-routes.js` (فشلُ إنشاء عملية): ' + rt.text
        : '❌ `node worker/test-routes.js` أخفق:\n' +
          rt.text.trim().split('\n').slice(-25).join('\n'));
    }
  } else {
    out.push('⚠️ `worker/test-routes.js` غير موجود — عقدُ المسارات غير مفحوص.');
  }
}

if (out.length) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        out.join('\n\n') +
        '\n\n🔴 لا تفتح PR قبل تخضير الأمرين — الدمج هنا يَنشُر حيّاً فوراً.'
    }
  }));
}
process.exit(0);
