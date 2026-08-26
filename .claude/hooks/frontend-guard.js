#!/usr/bin/env node
/* eslint-disable */
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// frontend-guard.js — يمنع تعديل `frontend/` يدوياً في هذا المستودع.
//
// **العلّة التي يقفلها:** `frontend/` **مخرَجٌ مُولَّد** يبنيه `_build/build-frontend.js` في
// `school-app-yemen-gas` ويدفعه CI إلى هنا عند كل دفعة إلى `main` هناك. فأي تعديل يدويّ هنا
// يبدو ناجحاً تماماً — ثم يُدهَس بصمت عند أوّل بناء آليّ، بلا خطأ ولا تحذير.
// وهذه فئةُ الفشل الصامت بعينها: العمل يضيع بعد ساعات، ولا شيء يربط الضياع بسببه.
//
// المصدر الصحيح لأي تعديل واجهة: `C:\Users\osama\SchoolApp-gas\<app>\*.html` و`assets/`.
//
// ⚠️ ولا يُستثنى `frontend/sw.js` ولا `manifest.webmanifest` — كلاهما مولَّد أيضاً.
// ─────────────────────────────────────────────────────────────────────────────
var fs = require('fs');
var path = require('path');

var input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) { process.exit(0); }

var ti = (input && input.tool_input) || {};
var file = ti.file_path || ti.filePath || ti.path || '';
if (!file) process.exit(0);

var norm = function (p) { return String(p || '').replace(/\\/g, '/'); };
var target = norm(path.resolve(String(file)));

// المطابقة على مقطع مسارٍ كامل لا على نصٍّ عائم: `/frontend/` وحده، فلا يُمسك
// `my-frontend-notes.md` ولا مسارٌ يحوي الكلمة في اسم ملفّ.
if (!/\/frontend\//i.test(target)) process.exit(0);

var rel = target.slice(target.toLowerCase().indexOf('/frontend/') + 1);

process.stderr.write(
  '🚫 حُظر التعديل: `frontend/` مخرَجٌ مُولَّد لا مصدر.\n\n' +
  '  الملفّ: ' + rel + '\n\n' +
  'يبنيه `_build/build-frontend.js` في `school-app-yemen-gas`، ويدفعه CI إلى هنا عند كل دفعة\n' +
  'إلى `main` هناك. فالتعديل هنا ينجح الآن **ويُدهَس بصمت** عند أوّل بناء — بلا خطأ ولا أثر.\n\n' +
  '✅ المصدر الصحيح: `C:\\Users\\osama\\SchoolApp-gas` — عدّل `<app>/*.html` أو `assets/`\n' +
  '   ثمّ دع CI يُعيد البناء.\n'
);
process.exit(2);
