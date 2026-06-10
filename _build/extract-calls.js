// extract-calls.js — يستخرج أسماء دوال الخادم التي تستدعيها واجهة كل تطبيق فعلاً
// عبر مسح كل ملفات HTML ورصد سلاسل google.script.run.<fn>( ... ).
// يُستبعد دوال الجسر (withSuccessHandler/withFailureHandler/withUserObject).
// النتيجة هي المصدر الموثوق لـ whitelist.json (يُغذّي ApiEndpoint في كل مشروع).
var fs = require('fs');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');

var BRIDGE = { withSuccessHandler: 1, withFailureHandler: 1, withUserObject: 1 };
var APPS = ['home', 'teacher', 'student', 'cms', 'schedule', 'master-admin'];

// أغلفة الاستدعاء التي تأخذ اسم الدالة كأول وسيط نصّي
var WRAPPER_RE = /\b(?:callServer|callServerSmart|rawCall|gsr)\s*\(\s*['"]([A-Za-z_$][\w$]*)['"]/g;

// يمشي على سلسلة google.script.run مع وعيٍ بالسلاسل النصية لتفادي أقواس داخلها
function extractFromText(s, names) {
  var wm;
  while ((wm = WRAPPER_RE.exec(s))) { if (!BRIDGE[wm[1]]) names[wm[1]] = true; }
  var re = /google\.script\.run/g, m;
  while ((m = re.exec(s))) {
    var i = m.index + 'google.script.run'.length;
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] !== '.') break;
      i++;
      while (i < s.length && /\s/.test(s[i])) i++;
      var name = '';
      while (i < s.length && /[\w$]/.test(s[i])) { name += s[i]; i++; }
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] !== '(') break;
      if (name && !BRIDGE[name]) names[name] = true;
      // تجاوز الأقواس المتوازنة مع تجاهل محتوى السلاسل النصية
      var depth = 0, q = null;
      for (; i < s.length; i++) {
        var c = s[i];
        if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
        if (c === '"' || c === "'" || c === '`') { q = c; continue; }
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) { i++; break; } }
      }
    }
  }
}

// أسماء الدوال العامة المعرّفة في خلفية المشروع (غير المسبوقة بـ _)
function backendPublic(appDir) {
  var pub = {};
  fs.readdirSync(appDir).forEach(function (f) {
    if (!/\.(js|gs)$/.test(f)) return;
    if (f === 'ApiEndpoint.js') return;
    var txt = fs.readFileSync(path.join(appDir, f), 'utf8');
    var re = /function\s+([A-Za-z][\w$]*)\s*\(/g, m;
    while ((m = re.exec(txt))) { if (m[1].charAt(0) !== '_') pub[m[1]] = true; }
  });
  return pub;
}

var FRAMEWORK = { doGet:1, doPost:1, doOptions:1, onOpen:1, onEdit:1, onInstall:1, onFormSubmit:1, onSelectionChange:1 };
var result = {};
APPS.forEach(function (app) {
  var dir = path.join(ROOT, app);
  if (!fs.existsSync(dir)) return;
  var called = {};
  fs.readdirSync(dir).forEach(function (f) {
    if (/\.html$/i.test(f)) extractFromText(fs.readFileSync(path.join(dir, f), 'utf8'), called);
  });
  var pub = backendPublic(dir);
  var calledList = Object.keys(called).sort();
  var missing = calledList.filter(function (n) { return !pub[n] && !FRAMEWORK[n]; });
  var excludedPublic = Object.keys(pub).filter(function (n) { return !called[n] && !FRAMEWORK[n]; }).sort();
  result[app] = { called: calledList, missingBackend: missing, excludedPublic: excludedPublic };
});

// ── قائمة المنع: دوال خطرة مؤكّدة (إدارية/صيانة/هجرة/تشخيص مدمّرة) ──
// تُمنع فقط إن كانت موجودة فعلاً في المشروع وغير مستدعاة من واجهته (صفر كسر).
var DANGEROUS = {};
[
  // مُغيّرات روابط النشر — كارثية (تكسر كل المنصّات + أندرويد)
  'updateAllDeploymentUrls','resetDeploymentUrls','updateDeploymentUrl','showDeploymentUrls',
  // ترقية صلاحيات
  'upgradeDefaultAdminToOwner',
  // حذف/إصلاح مدارس
  'deleteSchoolProtected','repairAllSchools','registerSchoolProtected','setInviteKeyProtected',
  // مسح الكاش الشامل
  'clearAllCaches','fullClearCache','clearSchoolCache','clearCmsCache','clearStudentCache','clearScheduleCache','clearTeacherCoreCache','clearNewsCache',
  // هجرات البيانات (مدمّرة محتملة)
  'migrateExistingDriveUrls','migrateNewsImagesToThumbnail','migrateStudentPasswordsToMaster',
  // إعداد/تثبيت/بذر
  'setupEverything','setupAllTokens','setupFbOAuth','setupMasterTriggers','fullSystemStart','initializeSheets','initializeMasterSheets','installDailySyncTriggers','createDailySync','createHourlyGradesSync','smmSetupSystem','smmSeedTemplates','smmSeedYearCalendar',
  // اختبار/تشخيص
  'runFullSystemTest','runDataIntegrityCheck','deepAudit','testDriveAccess','testDriveUpload','testAuthSystem','testV3End2End','testGradesUnified','fullDiagnosticsForTeacher','inspectAllSheetsWithFormulas','diagnoseGradesSchema','diagnoseGradesSchemaV2','autoSyncAllStudentData'
].forEach(function (n) { DANGEROUS[n] = true; });

var whitelist = {}, denylist = {};
Object.keys(result).forEach(function (app) {
  var r = result[app];
  var pubSet = {}; r.excludedPublic.concat(r.called).forEach(function(n){ pubSet[n]=true; });
  // نمنع فقط الخطرة الموجودة فعلاً وغير المستدعاة
  var calledSet = {}; r.called.forEach(function(n){ calledSet[n]=true; });
  var block = Object.keys(DANGEROUS).filter(function(n){ return pubSet[n] && !calledSet[n]; }).sort();
  console.log('=== ' + app + ' ===');
  console.log('  تستدعيها الواجهة: ' + r.called.length);
  console.log('  🚫 ستُمنع (خطرة وغير مستدعاة): ' + block.length + (block.length ? ' → ' + block.join(', ') : ''));
  whitelist[app] = r.called;
  denylist[app] = block;
});
fs.writeFileSync(path.join(ROOT, '_build', 'whitelist.generated.json'), JSON.stringify(whitelist, null, 2) + '\n');
fs.writeFileSync(path.join(ROOT, '_build', 'denylist.generated.json'), JSON.stringify(denylist, null, 2) + '\n');
console.log('\n✅ كُتب: whitelist.generated.json + denylist.generated.json');
