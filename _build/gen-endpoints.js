// يولّد ApiEndpoint.js (فيه doPost) داخل مجلد كل تطبيق، اعتماداً على قائمة
// السماح المستخرجة. ويتحقق أن كل دالة معرّفة فعلاً في ملفات .js للتطبيق.
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

var WHITELIST = {
  home: ['checkSession', 'getHomeData', 'getImagesForSchool', 'getNewsForSchool', 'getSchoolStats', 'getVideosForSchool'],
  student: ['changePassword', 'getGrades', 'getStudentNotificationBadge', 'getStudentReports', 'getTeachersForClass', 'loginStudent', 'recordStudentNewsView', 'submitNote', 'toggleStudentNewsLike'],
  teacher: ['addListItemProtected', 'adminDeleteTeacherByName', 'adminGetAllTeachersGrouped', 'adminSaveTeacherGrouped', 'checkSession', 'deleteListItemProtected', 'getAttendanceListProtected', 'getEnhancedListsProtected', 'getListsDataProtected', 'getStudentsForView', 'getV3Config', 'handleTeacherLogin', 'handleTeacherLogout', 'saveAttendanceSingleProtected', 'updateListItemProtected'],
  cms: ['addImage', 'addNews', 'addSchedule', 'addVideo', 'getAuditLog', 'getPageUrl', 'getPostTypesForPlatform', 'getSystemStats', 'logClientError', 'uploadFileToDrive'],
  schedule: ['addTeacherRow', 'assignPeriod', 'autoDistributeProtected', 'autoDistributeTeacher', 'deleteAssignment', 'deleteTeacherRow', 'getAllConflicts', 'getClassSchedule', 'getScheduleSystemStats', 'getSubjectsAndClasses', 'getTeacherScheduleData', 'getTeachersData', 'getTeachersList', 'resetTeacherSchedule', 'undoLastAssignment', 'updateTeacherRow']
};

function jsSourcesFor(app) {
  var dir = path.join(ROOT, app);
  return fs.readdirSync(dir)
    .filter(function (f) { return /\.js$/i.test(f) && f !== 'ApiEndpoint.js'; })
    .map(function (f) { return fs.readFileSync(path.join(dir, f), 'utf8'); })
    .join('\n');
}

function isDefined(src, name) {
  // function NAME(  أو  NAME = function  أو  var NAME = function
  var re = new RegExp('(function\\s+' + name + '\\s*\\()|((^|[^.\\w])' + name + '\\s*[:=]\\s*function)', 'm');
  return re.test(src);
}

function endpointSource(app, names) {
  var arr = names.map(function (n) { return "'" + n + "'"; }).join(', ');
  return [
    '/**',
    ' * ApiEndpoint.js — نقطة دخول JSON/fetch للواجهة الثابتة (GitHub Pages).',
    ' * تطبيق: ' + app.toUpperCase(),
    ' * مدارس الإبداع والتميز الدولية',
    ' *',
    ' * أُضيف ليُمكِّن قيادة تطبيق الويب عبر gas-bridge.js (fetch) بدل عميل',
    ' * google.script.run الخاص بـ HtmlService، وبذلك تُستضاف الواجهة على',
    ' * GitHub Pages دون رسالة تحذير Google.',
    ' *',
    ' * CORS: لا يضبط GAS ترويسة ACAO يدوياً، لكن رابط /exec يُرجِعها تلقائياً.',
    ' * الواجهة ترسل Content-Type: text/plain (طلب بسيط) فلا preflight (OPTIONS).',
    ' *',
    ' * الأمان: يُسمح فقط باستدعاء الدوال المدرجة في API_ALLOWED_FUNCTIONS.',
    ' * صياغة ES5 فقط (var، دوال عادية، بلا قوالب نصية).',
    ' */',
    '',
    'var API_ALLOWED_FUNCTIONS = [' + arr + '];',
    '',
    'function _apiJsonOut(obj) {',
    '  return ContentService',
    '    .createTextOutput(JSON.stringify(obj))',
    '    .setMimeType(ContentService.MimeType.JSON);',
    '}',
    '',
    'function _apiIsAllowed(name) {',
    '  for (var i = 0; i < API_ALLOWED_FUNCTIONS.length; i++) {',
    '    if (API_ALLOWED_FUNCTIONS[i] === name) return true;',
    '  }',
    '  return false;',
    '}',
    '',
    'function _apiResolve(name) {',
    '  try {',
    "    if (typeof globalThis !== 'undefined' && typeof globalThis[name] === 'function') {",
    '      return globalThis[name];',
    '    }',
    '  } catch (e) {}',
    '  try {',
    '    var f = eval(name);', // الاسم مُدرَج في القائمة البيضاء مسبقاً
    "    if (typeof f === 'function') return f;",
    '  } catch (e2) {}',
    '  return null;',
    '}',
    '',
    'function doPost(e) {',
    '  try {',
    '    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";',
    '    var req = JSON.parse(raw);',
    '    var fn = req && req.fn;',
    '    var args = (req && req.args) ? req.args : [];',
    "    if (!fn || typeof fn !== 'string') {",
    '      return _apiJsonOut({ ok: false, error: "اسم الدالة مفقود" });',
    '    }',
    '    if (!_apiIsAllowed(fn)) {',
    '      return _apiJsonOut({ ok: false, error: "دالة غير مسموح بها: " + fn });',
    '    }',
    '    var target = _apiResolve(fn);',
    '    if (!target) {',
    '      return _apiJsonOut({ ok: false, error: "الدالة غير موجودة: " + fn });',
    '    }',
    '    var result = target.apply(null, args);',
    '    return _apiJsonOut({ ok: true, result: result });',
    '  } catch (err) {',
    '    return _apiJsonOut({ ok: false, error: String((err && err.message) || err) });',
    '  }',
    '}',
    ''
  ].join('\n');
}

Object.keys(WHITELIST).forEach(function (app) {
  var src = jsSourcesFor(app);
  var missing = WHITELIST[app].filter(function (n) { return !isDefined(src, n); });
  fs.writeFileSync(path.join(ROOT, app, 'ApiEndpoint.js'), endpointSource(app, WHITELIST[app]));
  var line = app + ': كُتب ApiEndpoint.js (' + WHITELIST[app].length + ' دالة)';
  if (missing.length) line += '  ⚠ غير موجودة في .js: ' + missing.join(', ');
  console.log(line);
});
