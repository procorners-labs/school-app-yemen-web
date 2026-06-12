// يزامن قائمة API_DANGEROUS_FUNCTIONS في ApiEndpoint.js لكل تطبيق
// من المصدر الموحّد _build/denylist.generated.json — **دون المساس ببقية الملف**.
//
// ⚠️ مهم: هذا السكربت لا يولّد الملفات من قالب (كما كان سابقاً) لأن ملفات
// ApiEndpoint.js أصبحت متباينة عمداً بعد تحصينات المرحلة 1:
//   - cms/schedule: فيهما كتلة _setActiveTenant بسلوكين مختلفين (متساهل/صارم)
//   - الجميع: طبقة API_DANGEROUS_FUNCTIONS (denylist) فوق دوال الإطار
// إعادة التوليد من قالب موحّد كانت ستدهس هذه الحماية — لذلك نُحدّث القائمة فقط.
//
// الاستخدام:
//   node _build/gen-endpoints.js          → يزامن القوائم ويبلغ عن أي انحراف
//   node _build/gen-endpoints.js --check  → فحص فقط (يفشل إن وُجد انحراف، للـ CI)
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var APPS = ['home', 'student', 'teacher', 'cms', 'schedule', 'master-admin'];
var DENYLIST = require('./denylist.generated.json');
var CHECK_ONLY = process.argv.indexOf('--check') !== -1;

// يبني نص مصفوفة الدوال الخطرة بصيغة مرتّبة وقابلة للقراءة (4 أسماء لكل سطر).
function denyArraySource(names) {
  var sorted = names.slice().sort();
  var lines = [];
  for (var i = 0; i < sorted.length; i += 4) {
    lines.push('  ' + sorted.slice(i, i + 4).map(function (n) { return "'" + n + "'"; }).join(', '));
  }
  return 'API_DANGEROUS_FUNCTIONS = [\n' + lines.join(',\n') + '\n]';
}

var failures = 0;
APPS.forEach(function (app) {
  var file = path.join(ROOT, app, 'ApiEndpoint.js');
  if (!fs.existsSync(file)) {
    console.error('❌ ' + app + ': ApiEndpoint.js مفقود — أنشئه يدوياً من نسخة تطبيق مشابه ثم أعد التشغيل');
    failures++;
    return;
  }
  var src = fs.readFileSync(file, 'utf8');
  var re = /API_DANGEROUS_FUNCTIONS = \[[\s\S]*?\]/;
  if (!re.test(src)) {
    console.error('❌ ' + app + ': لا توجد API_DANGEROUS_FUNCTIONS — الملف غير محصّن! أضف الطبقة يدوياً (انظر teacher/ApiEndpoint.js)');
    failures++;
    return;
  }
  var wanted = denyArraySource(DENYLIST[app] || []);
  var current = src.match(re)[0];

  // مقارنة بالأسماء (لا بالتنسيق) حتى لا نعيد كتابة ملف سليم
  function namesOf(block) {
    var m = block.match(/'([^']+)'/g) || [];
    return m.map(function (s) { return s.slice(1, -1); }).sort().join(',');
  }
  if (namesOf(current) === namesOf(wanted)) {
    console.log('✓ ' + app + ': القائمة متزامنة (' + (DENYLIST[app] || []).length + ' دالة)');
    return;
  }
  if (CHECK_ONLY) {
    console.error('❌ ' + app + ': القائمة منحرفة عن denylist.generated.json');
    failures++;
    return;
  }
  fs.writeFileSync(file, src.replace(re, wanted));
  console.log('✏️  ' + app + ': حُدّثت القائمة (' + (DENYLIST[app] || []).length + ' دالة)');
});

if (failures) process.exit(1);
console.log('\nكل ملفات ApiEndpoint.js محصّنة ومتزامنة.');
