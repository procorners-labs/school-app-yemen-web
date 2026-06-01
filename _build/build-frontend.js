// يبني مجلد frontend/ بنسخ معدّلة من كل ملفات HTML:
//  - يحقن إعداد GAS_ENDPOINT/SCHOOL_ID + وسم تحميل gas-bridge.js بعد <head>
//  - يستبدل scriptlet الخادم '<?= schoolId ?>' بقيمة window.SCHOOL_ID
//  - ينبّه على أي scriptlets متبقية
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var OUT = path.join(ROOT, 'frontend');

var BASE = 'https://script.google.com/macros/s/';
var ENDPOINTS = {
  home:     BASE + 'AKfycbzDfGEK6IpChVNl9k8xbt_iv5p6bLOktt-TvEzDp8yBpH3Ga3yNMen_0S2ZyuuvGtKFCA/exec',
  cms:      BASE + 'AKfycbz-iAj9L3ROOn4CAjmwkVBUqpWuxIx1LkgPLwKnHu7kHLWKCy3GVJNo1vZbnekop0VlMA/exec',
  teacher:  BASE + 'AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND/exec',
  student:  BASE + 'AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq/exec',
  schedule: BASE + 'AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag/exec'
};

// خريطة: app -> [ [ملف المصدر, ملف الوجهة, مستوى العمق لمسار assets] ]
// كل الصفحات داخل التطبيق توجد في frontend/<app>/ ، فعمق assets = ../assets
var FILES = {
  home: [
    ['Index.html', 'index.html'],
    ['Privacy.html', 'privacy.html'],
    ['Diagnostics.html', 'diagnostics.html']
  ],
  student: [
    ['Student Portal.html', 'index.html']
    // Student_Reports.html مُستبعَد: مقتطف يُدمج داخل البوابة، ليس صفحة مستقلة
  ],
  teacher: [
    ['Teacher Dashboard.html', 'index.html']
    // Teacher_Reports.html مُستبعَد: مقتطف يُدمج داخل اللوحة، ليس صفحة مستقلة
  ],
  cms: [
    ['Dashboard.html', 'index.html'],
    ['AddForm.html', 'add.html'],
    ['ViewContent.html', 'view.html'],
    ['AuditLog.html', 'audit.html'],
    ['README.html', 'readme.html']
  ],
  schedule: [
    ['TeacherScheduleManager.html', 'index.html']
  ]
};

function injectionBlock(endpoint) {
  return [
    '<!-- ▼▼ حُقِن آلياً: جسر GAS عبر fetch (بدل google.script.run الأصلي) ▼▼ -->',
    '<script>',
    '  (function(){',
    '    var qs = new URLSearchParams(window.location.search);',
    "    window.GAS_ENDPOINT = '" + endpoint + "';",
    "    window.SCHOOL_ID = qs.get('schoolId') || window.SCHOOL_ID || '';",
    '  })();',
    '</script>',
    '<script src="../assets/gas-bridge.js"></script>',
    '<!-- ▲▲ نهاية الحقن ▲▲ -->'
  ].join('\n');
}

function transform(src, endpoint, report) {
  var out = src;

  // 1) حقن الإعداد + الجسر بعد أول <head ...>
  var headRe = /<head[^>]*>/i;
  if (headRe.test(out)) {
    out = out.replace(headRe, function (m) { return m + '\n' + injectionBlock(endpoint) + '\n'; });
  } else {
    out = injectionBlock(endpoint) + '\n' + out;
    report.noHead = true;
  }

  // 2) استبدال scriptlet معرّف المدرسة من الخادم
  //    var SERVER_SCHOOL_ID = '<?= ... ?>';  ->  = (window.SCHOOL_ID || '')
  out = out.replace(
    /'<\?=[\s\S]*?\?>'/g,
    "(window.SCHOOL_ID || '')"
  );

  // 3) رصد أي scriptlets متبقية للتنبيه
  var leftover = out.match(/<\?[!=]?[\s\S]*?\?>/g);
  if (leftover) report.leftoverScriptlets = leftover.length;

  return out;
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

var summary = [];
Object.keys(FILES).forEach(function (app) {
  var appOut = path.join(OUT, app);
  if (!fs.existsSync(appOut)) fs.mkdirSync(appOut, { recursive: true });
  FILES[app].forEach(function (pair) {
    var srcPath = path.join(ROOT, app, pair[0]);
    if (!fs.existsSync(srcPath)) { summary.push('SKIP (مفقود): ' + app + '/' + pair[0]); return; }
    var src = fs.readFileSync(srcPath, 'utf8');
    var report = {};
    var out = transform(src, ENDPOINTS[app], report);
    fs.writeFileSync(path.join(appOut, pair[1]), out);
    var note = app + '/' + pair[1];
    if (report.noHead) note += '  [⚠ لا يوجد <head>]';
    if (report.leftoverScriptlets) note += '  [⚠ scriptlets متبقية: ' + report.leftoverScriptlets + ']';
    summary.push('OK  ' + note);
  });
});

console.log(summary.join('\n'));
