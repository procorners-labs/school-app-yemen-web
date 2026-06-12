// يبني مجلد frontend/ بنسخ معدّلة من كل ملفات HTML:
//  - يحقن إعداد GAS_ENDPOINT/SCHOOL_ID + وسم تحميل gas-bridge.js بعد <head>
//  - يستبدل scriptlet الخادم '<?= schoolId ?>' بقيمة window.SCHOOL_ID
//  - ينبّه على أي scriptlets متبقية
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var OUT = path.join(ROOT, 'frontend');

// ── إعدادات Google (تحليلات + إثبات ملكية Search Console) ───────────────
//   معرّف القياس GA4 ورمز إثبات ملكية وسم HTML من Google Search Console.
//   تُحقَن في <head> لكل صفحة آلياً عبر analyticsBlock().
var GA_MEASUREMENT_ID = 'G-06QS5PMS6F';
var GSC_META_TOKEN = 'fjhRDb9pvQoo43UDBQ67zdYlTADcSdyabBmD6i_xUXc';

// كتلة وسم Google: تُوضع فور <head> مباشرةً (قبل أي شيء آخر) في كل صفحة.
function analyticsBlock() {
  return [
    '<!-- ▼▼ حُقِن آلياً: وسم Google (GA4) + إثبات ملكية Search Console ▼▼ -->',
    '<meta name="google-site-verification" content="' + GSC_META_TOKEN + '" />',
    '<script async src="https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID + '"></script>',
    '<script>',
    '  window.dataLayer = window.dataLayer || [];',
    '  function gtag(){dataLayer.push(arguments);}',
    "  gtag('js', new Date());",
    "  gtag('config', '" + GA_MEASUREMENT_ID + "');",
    '</script>',
    '<!-- ▲▲ نهاية وسم Google ▲▲ -->'
  ].join('\n');
}

// المسارات نسبية تُخدَم عبر Cloudflare Worker (/gas/<app>) بدل روابط Google
// المباشرة، حتى يعمل الموقع بدون VPN في المناطق التي يُحجب فيها github.io.
// الـ Worker يمرّر هذه المسارات إلى روابط Google الحقيقية (انظر worker/school-app-proxy.js).
var ENDPOINTS = {
  home:     '/gas/home',
  cms:      '/gas/cms',
  teacher:  '/gas/teacher',
  student:  '/gas/student',
  schedule: '/gas/schedule',
  'master-admin': '/gas/master-admin'
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
    ['README.html', 'readme.html'],
    ['QR_Dashboard.html', 'qr.html']
  ],
  schedule: [
    ['TeacherScheduleManager.html', 'index.html']
  ],
  'master-admin': [
    ['MasterAdmin.html', 'index.html'],
    ['SchoolRegister.html', 'register.html']
  ]
};

function injectionBlock(endpoint) {
  return [
    '<!-- ▼▼ حُقِن آلياً: جسر GAS عبر fetch (بدل google.script.run الأصلي) ▼▼ -->',
    '<link rel="manifest" href="/manifest.webmanifest">',
    '<script>',
    '  (function(){',
    '    var qs = new URLSearchParams(window.location.search);',
    "    window.GAS_ENDPOINT = '" + endpoint + "';",
    "    window.SCHOOL_ID = qs.get('schoolId') || qs.get('school') || window.SCHOOL_ID || '';",
    '  })();',
    '</script>',
    '<!-- طبقة العمل دون اتصال + المزامنة التلقائية (تُحمَّل قبل الجسر) -->',
    '<script src="../assets/offline-db.js"></script>',
    '<script src="../assets/offline-sync.js"></script>',
    '<script src="../assets/gas-bridge.js"></script>',
    '<script>',
    "  if ('serviceWorker' in navigator) {",
    "    window.addEventListener('load', function () {",
    "      navigator.serviceWorker.register('/sw.js').catch(function(){});",
    '    });',
    '  }',
    '</script>',
    '<!-- ▲▲ نهاية الحقن ▲▲ -->'
  ].join('\n');
}

function transform(src, endpoint, report) {
  var out = src;

  // 1) حقن وسم Google (أولاً، فور <head>) ثم الإعداد + الجسر بعد أول <head ...>
  var headRe = /<head[^>]*>/i;
  if (headRe.test(out)) {
    out = out.replace(headRe, function (m) {
      return m + '\n' + analyticsBlock() + '\n' + injectionBlock(endpoint) + '\n';
    });
  } else {
    out = analyticsBlock() + '\n' + injectionBlock(endpoint) + '\n' + out;
    report.noHead = true;
  }

  // 2) استبدال scriptlet معرّف المدرسة من الخادم
  //    var SERVER_SCHOOL_ID = '<?= ... ?>';  ->  = (window.SCHOOL_ID || '')
  out = out.replace(
    /'<\?=[\s\S]*?\?>'/g,
    "(window.SCHOOL_ID || '')"
  );

  // 3) تحويل روابط التنقّل بين البوابات (روابط /exec القديمة المحجوبة) إلى
  //    مسارات نسبية يخدمها الـ Worker، حتى تُفتح بدون VPN.
  var S = 'https://script\\.google\\.com/macros/s/';
  var IDS = {
    home:     'AKfycbzDfGEK6IpChVNl9k8xbt_iv5p6bLOktt-TvEzDp8yBpH3Ga3yNMen_0S2ZyuuvGtKFCA',
    cms:      'AKfycbz-iAj9L3ROOn4CAjmwkVBUqpWuxIx1LkgPLwKnHu7kHLWKCy3GVJNo1vZbnekop0VlMA',
    teacher:  'AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND',
    student:  'AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq',
    schedule: 'AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag',
    master:   'AKfycbx5H6uYXb-6iVt_nT4YkdnYMhl6eZJSDxsULsKa2eyblZQcwzRo4CXR3Mh_ecRSZd4M'
  };
  // الخصوصية أولاً (أكثر تحديداً) ثم الرابط العام لكل تطبيق
  out = out.replace(new RegExp(S + IDS.home + '/exec\\?page=privacy', 'g'), '/home/privacy.html');
  out = out.replace(new RegExp(S + IDS.home + '/exec(\\?[^"\'\\s<]*)?', 'g'), '/home/index.html');
  out = out.replace(new RegExp(S + IDS.teacher + '/exec(\\?[^"\'\\s<]*)?', 'g'), '/teacher/index.html');
  out = out.replace(new RegExp(S + IDS.student + '/exec(\\?[^"\'\\s<]*)?', 'g'), '/student/index.html');
  out = out.replace(new RegExp(S + IDS.cms + '/exec(\\?[^"\'\\s<]*)?', 'g'), '/cms/index.html');
  out = out.replace(new RegExp(S + IDS.schedule + '/exec(\\?[^"\'\\s<]*)?', 'g'), '/schedule/index.html');
  out = out.replace(new RegExp(S + IDS.master + '/exec(\\?[^"\'\\s<]*)?', 'g'), '/master-admin/index.html');

  // 4) رصد أي scriptlets متبقية للتنبيه
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
