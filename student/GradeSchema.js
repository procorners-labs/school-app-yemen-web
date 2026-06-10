/**
 * ════════════════════════════════════════════════════════════════════
 *  GradeSchema.gs  —  Unified Grade Schema v3.1
 *  Single Source of Truth لكل قواعد الفترات الدراسية وعرضها
 * ════════════════════════════════════════════════════════════════════
 *  هذا الملف يجب أن يُنسخ كما هو إلى:
 *    1) مشروع منصة المعلم   (مع TeacherCore.gs)
 *    2) مشروع منصة الطالب   (مع StudentLogic.gs)
 *
 *  الطبقات:
 *    - v2: المنطق الأساسي (اكتشاف الأعمدة، حسابات)
 *    - v3: العرض والمحولات (تسميات جديدة، أعمدة افتراضية، تطبيع)
 *    - v3.1: قفل العمود الأول، عرض نصف العام مع نهاية العام
 *
 *  متوافق ES5 بالكامل.
 * ════════════════════════════════════════════════════════════════════
 */

/* ══════════════════════════════════════════════════════════════
   V2 — Unified Grade Schema (الطبقة الأساسية)
   ══════════════════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════════
// قائمة الأشهر الهجرية الدراسية المعتمدة (ترتيب كرونولوجي صحيح)
// ══════════════════════════════════════════════════════════════
var GS_VALID_MONTHS = [
  'محرم', 'صفر', 'ربيع اول', 'ربيع ثاني',
  'جماد اول', 'جماد ثاني', 'رجب', 'شعبان',
  'نصف العام', 'نهاية العام'
];

// الترتيب الدراسي الفعلي (يُستخدم في الفرز — يشمل جميع الأشهر)
var GS_ORDERED_MONTHS = [
  'محرم', 'صفر', 'ربيع اول', 'ربيع ثاني',
  'جماد اول', 'جماد ثاني', 'رجب', 'شعبان',
  'نصف العام', 'نهاية العام'
];

function GS_getPeriodType(monthName) {
  if (monthName === 'نصف العام' || monthName === 'نهاية العام') return 'term';
  return 'regular';
}

function GS_isTermMonth(monthName) {
  return GS_getPeriodType(monthName) === 'term';
}

var GS_SCHEMA = {
  'regular': {
    type: 'regular',
    columnCount: 5,
    reservedColumns: 0,
    fields: [
      { key: 'behavior', label: 'السلوك',    max: 10,  locked: false, auto: false, position: 0 },
      { key: 'homework', label: 'الواجبات',  max: 20,  locked: false, auto: false, position: 1 },
      { key: 'oral',     label: 'الشفوي',    max: 30,  locked: false, auto: false, position: 2 },
      { key: 'written',  label: 'التحريري', max: 40,  locked: false, auto: false, position: 3 },
      { key: 'total',    label: 'الاجمالي', max: 100, locked: true,  auto: true,  position: 4, isTotal: true }
    ]
  },
  'term': {
    type: 'term',
    columnCount: 3,
    reservedColumns: 2,
    fields: [
      { key: 'monthly_score', label: 'الأعمال المستمرة', max: 20, locked: true,  auto: true,  position: 0 },
      { key: 'exam_score',    label: 'درجة الاختبار',    max: 30, locked: false, auto: false, position: 1 },
      { key: 'total_score',   label: 'المحصلة',          max: 50, locked: true,  auto: true,  position: 2, isTotal: true }
    ],
    derivedFrom: {
      'نصف العام':   ['محرم', 'صفر'],
      'نهاية العام': ['جماد اول', 'جماد ثاني']
    }
  }
};

var GS_SYNONYMS = {
  'monthly_score': ['الأعمال المستمرة', 'اعمال مستمرة', 'الدرجة الشهرية',
                    'الشهري', 'المحصلة1', 'محصلة1'],
  'exam_score':    ['درجة الاختبار', 'الاختبار', 'النصفي', 'النهائي',
                    'الاختبار النهائي', 'اختبار'],
  'total_score':   ['المحصلة', 'الإجمالي', 'المجموع', 'الاجمالي',
                    'الكلي', 'المجموع الكلي'],
  'behavior': ['السلوك'],
  'homework': ['الواجبات'],
  'oral':     ['الشفوي'],
  'written':  ['التحريري'],
  'total':    ['الاجمالي', 'الإجمالي', 'المجموع']
};

function GS_resolveFieldKey(label) {
  if (label === null || label === undefined) return null;
  var clean = String(label).trim();
  if (clean === '') return null;
  for (var key in GS_SYNONYMS) {
    if (GS_SYNONYMS.hasOwnProperty(key)) {
      var aliases = GS_SYNONYMS[key];
      for (var i = 0; i < aliases.length; i++) {
        if (aliases[i] === clean) return key;
      }
    }
  }
  return null;
}

function GS_findSubjectLocation(monthRow, subjectRow, typeRow, month, subject) {
  try {
    if (!monthRow || !subjectRow) {
      return { success: false, error: 'صفوف الرؤوس غير متوفرة' };
    }
    var filled = [];
    var lastM = '';
    for (var fi = 0; fi < monthRow.length; fi++) {
      var mc = (monthRow[fi] === null || monthRow[fi] === undefined)
                 ? '' : String(monthRow[fi]).trim();
      if (GS_VALID_MONTHS.indexOf(mc) !== -1) { lastM = mc; filled.push(mc); }
      else if (mc === '' && lastM)            { filled.push(lastM); }
      else                                    { filled.push(''); lastM = ''; }
    }
    var startCol = -1, endCol = -1;
    for (var i = 0; i < filled.length; i++) {
      if (filled[i] === month) {
        if (startCol === -1) startCol = i;
        endCol = i;
      }
    }
    if (startCol === -1) return { success: false, error: 'الشهر "' + month + '" غير موجود' };
    var subjectCol = -1;
    for (var j = startCol; j <= endCol; j++) {
      var sName = (subjectRow[j] === null || subjectRow[j] === undefined)
                    ? '' : String(subjectRow[j]).trim();
      if (sName === subject) { subjectCol = j; break; }
    }
    if (subjectCol === -1) return { success: false, error: 'المادة "' + subject + '" غير موجودة في ' + month };
    var periodType = GS_getPeriodType(month);
    var schema     = GS_SCHEMA[periodType];
    var columns    = {};
    for (var fIdx = 0; fIdx < schema.fields.length; fIdx++) {
      columns[schema.fields[fIdx].key] = -1;
    }
    var maxScan = schema.columnCount + schema.reservedColumns;
    for (var ti = 0; ti < maxScan && (subjectCol + ti) <= endCol; ti++) {
      var label = (typeRow && typeRow[subjectCol + ti] !== undefined && typeRow[subjectCol + ti] !== null)
                    ? String(typeRow[subjectCol + ti]).trim() : '';
      var key = GS_resolveFieldKey(label);
      if (key && columns.hasOwnProperty(key) && columns[key] === -1) {
        columns[key] = subjectCol + ti;
      }
    }
    for (var fb = 0; fb < schema.fields.length; fb++) {
      var f = schema.fields[fb];
      if (columns[f.key] === -1) {
        var defaultCol = subjectCol + f.position;
        if (defaultCol <= endCol) columns[f.key] = defaultCol;
      }
    }
    return {
      success: true,
      type: periodType,
      isTermMonth: (periodType === 'term'),
      columns: columns,
      schema: schema,
      monthStart: startCol,
      monthEnd: endCol,
      subjectCol: subjectCol
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function GS_computeTermMonthly(termMonth, subject, readMonthTotalFn) {
  if (!GS_isTermMonth(termMonth)) return null;
  var sources = GS_SCHEMA.term.derivedFrom[termMonth] || [];
  if (sources.length === 0) return null;
  var total = 0;
  var foundAny = false;
  for (var i = 0; i < sources.length; i++) {
    var monthName = sources[i];
    var monthTotal = readMonthTotalFn(monthName, subject);
    if (monthTotal !== null && monthTotal !== undefined && !isNaN(monthTotal)) {
      var score = Math.round(monthTotal / 10);
      if (score > 10) score = 10;
      total += score;
      foundAny = true;
    }
  }
  if (total > 20) total = 20;
  return foundAny ? total : null;
}

function GS_computeTermTotal(monthlyScore, examScore) {
  var ms = (monthlyScore === null || monthlyScore === undefined || monthlyScore === '')
             ? null : parseFloat(monthlyScore);
  var es = (examScore === null || examScore === undefined || examScore === '')
             ? null : parseFloat(examScore);
  if (isNaN(ms)) ms = null;
  if (isNaN(es)) es = null;
  if (ms === null && es === null) return null;
  var sum = (ms || 0) + (es || 0);
  return Math.round(sum * 10) / 10;
}

function GS_computeRegularTotal(behavior, homework, oral, written) {
  var b = parseFloat(behavior); if (isNaN(b)) b = 0;
  var h = parseFloat(homework); if (isNaN(h)) h = 0;
  var o = parseFloat(oral);     if (isNaN(o)) o = 0;
  var w = parseFloat(written);  if (isNaN(w)) w = 0;
  var sum = b + h + o + w;
  if (sum > 100) sum = 100;
  return sum;
}

function GS_getLinkedTermMonth(regularMonth) {
  var derived = GS_SCHEMA.term.derivedFrom;
  for (var term in derived) {
    if (derived.hasOwnProperty(term)) {
      if (derived[term].indexOf(regularMonth) !== -1) return term;
    }
  }
  return null;
}

function GS_getMonthDisplayConfig(monthName) {
  var type   = GS_getPeriodType(monthName);
  var schema = GS_SCHEMA[type];
  var visibleFields = [];
  for (var i = 0; i < schema.fields.length; i++) {
    var f = schema.fields[i];
    visibleFields.push({
      key: f.key,
      label: f.label,
      max: f.max,
      locked: f.locked,
      auto: f.auto,
      isTotal: f.isTotal || false
    });
  }
  return {
    monthName: monthName,
    type: type,
    isTermMonth: (type === 'term'),
    isFinal: (type === 'term'),
    fields: visibleFields,
    derivedFrom: (type === 'term') ? (GS_SCHEMA.term.derivedFrom[monthName] || []) : []
  };
}

function GS_healthCheck() {
  var report = {
    version: '2.0',
    timestamp: new Date().toISOString(),
    validMonths: GS_VALID_MONTHS.length,
    schemas: {}
  };
  for (var type in GS_SCHEMA) {
    if (GS_SCHEMA.hasOwnProperty(type)) {
      report.schemas[type] = {
        columnCount: GS_SCHEMA[type].columnCount,
        fieldCount: GS_SCHEMA[type].fields.length,
        fields: []
      };
      for (var f = 0; f < GS_SCHEMA[type].fields.length; f++) {
        report.schemas[type].fields.push(GS_SCHEMA[type].fields[f].key);
      }
    }
  }
  Logger.log('═══ GS_healthCheck Report ═══');
  Logger.log(JSON.stringify(report, null, 2));
  Logger.log('═══ End of Report ═══');
  return report;
}

/* ══════════════════════════════════════════════════════════════
   V3 — Display & Normalizer Layer (مُلحقة)
   ══════════════════════════════════════════════════════════════ */

var GS_V3_FLAG = true;

var GS_V3_FEATURES = {
  renameTotal:       true,
  virtualColumn:     true,
  normalizeTo100:    true,
  unifyLabels:       true,
  lockMonthlyScore:  true,     /* v3.1: قفل عمود المحصلة في الفترات الفصلية */
  showTerm1InTerm2:  true      /* v3.1: عرض نصف العام مع نهاية العام */
};

var GS_DISPLAY_LABELS = {
  'نصف العام': {
    'monthly_score': 'المحصلة',          /* v3.1: تغيير التسمية */
    'exam_score':    'درجة الاختبار',
    'total_score':   'المجموع'
  },
  'نهاية العام': {
    'monthly_score': 'المحصلة',          /* v3.1: تغيير التسمية */
    'exam_score':    'درجة الاختبار',
    'total_score':   'المجموع',
    'final_total':   'الإجمالي (100)'
  },
  '_default': {
    'behavior': 'السلوك',
    'homework': 'الواجبات',
    'oral':     'الشفوي',
    'written':  'التحريري',
    'total':    'الاجمالي'
  }
};

function GS_getDisplayLabel(monthName, fieldKey, fallback) {
  if (!GS_V3_FLAG || !GS_V3_FEATURES.unifyLabels) {
    return fallback || fieldKey;
  }
  var monthMap = GS_DISPLAY_LABELS[monthName];
  if (monthMap && monthMap[fieldKey]) {
    if (fieldKey === 'total_score' && !GS_V3_FEATURES.renameTotal) {
      return fallback || 'المحصلة';
    }
    return monthMap[fieldKey];
  }
  var defaultMap = GS_DISPLAY_LABELS['_default'];
  if (defaultMap && defaultMap[fieldKey]) return defaultMap[fieldKey];
  return fallback || fieldKey;
}

function GS_normalizeTermFinal(totalScore50) {
  if (!GS_V3_FLAG || !GS_V3_FEATURES.normalizeTo100) return null;
  if (totalScore50 === null || totalScore50 === undefined || totalScore50 === '') return null;
  var num = parseFloat(totalScore50);
  if (isNaN(num)) return null;
  var normalized = num * 2;
  if (normalized > 100) normalized = 100;
  if (normalized < 0)   normalized = 0;
  return Math.round(normalized * 10) / 10;
}

function GS_buildVirtualColumns(monthName, gradesArr) {
  if (!GS_V3_FLAG || !GS_V3_FEATURES.virtualColumn) return gradesArr;
  if (monthName !== 'نهاية العام') return gradesArr;
  if (!gradesArr || !gradesArr.length) return gradesArr;
  var totalValue = '';
  for (var i = 0; i < gradesArr.length; i++) {
    if (gradesArr[i].key === 'total_score' || gradesArr[i].type === 'المحصلة' || gradesArr[i].type === 'المجموع') {
      totalValue = gradesArr[i].value || '';
      break;
    }
  }
  var finalNormalized = GS_normalizeTermFinal(totalValue);
  var virtualField = {
    type       : GS_getDisplayLabel('نهاية العام', 'final_total', 'الإجمالي (100)'),
    key        : 'final_total',
    value      : (finalNormalized === null) ? '' : String(finalNormalized),
    isEmpty    : (finalNormalized === null),
    max        : 100,
    locked     : true,
    auto       : true,
    isTotal    : true,
    isVirtual  : true
  };
  var result = [];
  for (var j = 0; j < gradesArr.length; j++) result.push(gradesArr[j]);
  result.push(virtualField);
  return result;
}

function GS_decorateGrade(monthName, grade) {
  if (!GS_V3_FLAG) return grade;
  if (!grade || !grade.key) return grade;
  var newLabel = GS_getDisplayLabel(monthName, grade.key, grade.type);
  var copy = {};
  for (var k in grade) {
    if (grade.hasOwnProperty(k)) copy[k] = grade[k];
  }
  copy.type = newLabel;
  copy.displayLabel = newLabel;
  copy.originalLabel = grade.type;
  return copy;
}

function GS_decorateMonth(monthData) {
  if (!GS_V3_FLAG) return monthData;
  if (!monthData || !monthData.subjects) return monthData;
  var decorated = {
    name        : monthData.name,
    isFinal     : monthData.isFinal,
    isTermMonth : monthData.isTermMonth,
    subjects    : []
  };
  for (var s = 0; s < monthData.subjects.length; s++) {
    var subj = monthData.subjects[s];
    var newGrades = [];
    for (var g = 0; g < subj.grades.length; g++) {
      newGrades.push(GS_decorateGrade(monthData.name, subj.grades[g]));
    }
    newGrades = GS_buildVirtualColumns(monthData.name, newGrades);
    decorated.subjects.push({ name: subj.name, grades: newGrades });
  }
  return decorated;
}

/* ══════════════════════════════════════════════════════════════
   V3.1 — قفل الحقول وعرض المقارنة (مُلحقة)
   ══════════════════════════════════════════════════════════════ */

/**
 * هل الحقل مقفل في شهر معين؟
 * @param {string} monthName
 * @param {string} fieldKey
 * @return {boolean}
 */
function GS_isFieldLocked(monthName, fieldKey) {
  if (!GS_V3_FLAG) return false;
  if (GS_isTermMonth(monthName)) {
    if (fieldKey === 'monthly_score' && GS_V3_FEATURES.lockMonthlyScore) return true;
    if (fieldKey === 'total_score' || fieldKey === 'final_total') return true;
  }
  if (!GS_isTermMonth(monthName) && fieldKey === 'total') return true;
  return false;
}

/**
 * قائمة الحقول المقفلة في شهر معين
 * @param {string} monthName
 * @return {Array}
 */
function GS_getLockedFields(monthName) {
  var locked = [];
  var type = GS_getPeriodType(monthName);
  var schema = GS_SCHEMA[type];
  for (var i = 0; i < schema.fields.length; i++) {
    if (GS_isFieldLocked(monthName, schema.fields[i].key)) {
      locked.push(schema.fields[i].key);
    }
  }
  if (monthName === 'نهاية العام' && GS_V3_FEATURES.virtualColumn) {
    if (locked.indexOf('final_total') === -1) locked.push('final_total');
  }
  return locked;
}

function GS_getV3Config() {
  return {
    enabled: GS_V3_FLAG,
    features: GS_V3_FEATURES,
    lockedFields: {
      'نصف العام': GS_getLockedFields('نصف العام'),
      'نهاية العام': GS_getLockedFields('نهاية العام')
    },
    labels: GS_DISPLAY_LABELS,
    version: '3.1'
  };
}

function GS_v3HealthCheck() {
  return {
    version: '3.1',
    timestamp: new Date().toISOString(),
    flag: GS_V3_FLAG,
    features: GS_V3_FEATURES,
    tests: {
      normalizer_25_to_50: GS_normalizeTermFinal(25),
      normalizer_50_to_100: GS_normalizeTermFinal(50),
      normalizer_null: GS_normalizeTermFinal(null),
      label_term1_total: GS_getDisplayLabel('نصف العام', 'total_score', 'المحصلة'),
      label_term2_final: GS_getDisplayLabel('نهاية العام', 'final_total', 'الإجمالي (100)'),
      label_regular: GS_getDisplayLabel('محرم', 'behavior', 'السلوك'),
      lock_monthly_term1: GS_isFieldLocked('نصف العام', 'monthly_score'),
      lock_exam_term1: GS_isFieldLocked('نصف العام', 'exam_score'),
      lock_total_term1: GS_isFieldLocked('نصف العام', 'total_score'),
      lock_monthly_term2: GS_isFieldLocked('نهاية العام', 'monthly_score'),
      lock_final_total: GS_isFieldLocked('نهاية العام', 'final_total')
    }
  };
}

function testV3End2End() {
  Logger.log('Flag: ' + GS_V3_FLAG);
  Logger.log('25 → ' + GS_normalizeTermFinal(25));
  Logger.log('50 → ' + GS_normalizeTermFinal(50));
  Logger.log('null → ' + GS_normalizeTermFinal(null));
  Logger.log('نصف العام total: ' + GS_getDisplayLabel('نصف العام', 'total_score', 'المحصلة'));
  Logger.log('نهاية العام final: ' + GS_getDisplayLabel('نهاية العام', 'final_total', '—'));
  var sampleGrades = [
    { key: 'monthly_score', type: 'الأعمال المستمرة', value: '18', max: 20 },
    { key: 'exam_score',    type: 'درجة الاختبار',    value: '27', max: 30 },
    { key: 'total_score',   type: 'المحصلة',          value: '45', max: 50 }
  ];
  var withVirtual = GS_buildVirtualColumns('نهاية العام', sampleGrades);
  Logger.log('Virtual count: ' + withVirtual.length);
  Logger.log('Virtual value: ' + withVirtual[3].value);
  Logger.log('Locked fields نصف العام: ' + JSON.stringify(GS_getLockedFields('نصف العام')));
  Logger.log('Locked fields نهاية العام: ' + JSON.stringify(GS_getLockedFields('نهاية العام')));
}
/* ══════════════════════════════════════════════════════════════
   V4 — Unified Read API Layer
   مصدر موحّد لقراءة الدرجات يستهلكه TeacherCore و StudentLogic معاً
   ══════════════════════════════════════════════════════════════ */

/**
 * علم تفعيل الـ Read API الموحّد.
 * عند false: كل من المعلم والطالب يستخدمون منطقهم القديم (سلوك آمن).
 * عند true:  كلاهما يستهلكان نفس المصدر.
 */
var GS_V4_UNIFIED_READ = false;  /* ابدأ بـ false، فعّل بعد الاختبار */

/**
 * اسم ورقة الدرجات الرسمية (Single Source of Truth)
 * ملاحظة: ورقة "النصفي" مكررة وستُحذف في المرحلة 7.
 */
var GS_OFFICIAL_GRADES_SHEET = 'الدرجات';

/**
 * قراءة موحّدة لبيانات درجات طالب واحد في شهر معين ومادة معينة.
 * تستهلكها:
 *   - TeacherCore (لعرض جدول الدرجات للمعلم)
 *   - StudentLogic (لعرض درجات الطالب في بوابته)
 *
 * @param {Sheet}  sheet       - ورقة الدرجات (مُمرَّرة لتجنّب إعادة الفتح)
 * @param {Array}  monthRow    - الصف 1 (أسماء الأشهر)
 * @param {Array}  subjectRow  - الصف 2 (أسماء المواد)
 * @param {Array}  typeRow     - الصف 3 (أنواع الحقول)
 * @param {number} studentRow  - رقم صف الطالب في الورقة (1-indexed)
 * @param {string} monthName   - اسم الشهر
 * @param {string} subjectName - اسم المادة
 * @returns {Object} { success, fields: [{key,label,value,max,locked,auto,isTotal}] }
 */
function GS_readStudentGradesForSubject(sheet, monthRow, subjectRow, typeRow,
                                         studentRow, monthName, subjectName) {
  try {
    if (!sheet || !monthRow || !subjectRow) {
      return { success: false, error: 'بيانات الرؤوس غير مكتملة' };
    }
    var loc = GS_findSubjectLocation(monthRow, subjectRow, typeRow, monthName, subjectName);
    if (!loc.success) return loc;

    var rowValues = sheet.getRange(studentRow, 1, 1, sheet.getLastColumn()).getValues()[0];

    var fields = [];
    var schema = loc.schema;

    for (var i = 0; i < schema.fields.length; i++) {
      var f      = schema.fields[i];
      var col    = loc.columns[f.key];
      var value  = (col >= 0 && col < rowValues.length) ? rowValues[col] : '';
      var label  = GS_getDisplayLabel(monthName, f.key, f.label);
      var locked = (typeof GS_isFieldLocked === 'function')
                     ? GS_isFieldLocked(monthName, f.key)
                     : f.locked;

      fields.push({
        key:     f.key,
        label:   label,
        value:   (value === null || value === undefined) ? '' : value,
        max:     f.max,
        locked:  locked,
        auto:    f.auto,
        isTotal: f.isTotal || false,
        column:  col
      });
    }

    /* إضافة العمود الافتراضي final_total لـ "نهاية العام" */
    fields = GS_buildVirtualColumns(monthName, fields);

    return {
      success:     true,
      monthName:   monthName,
      subjectName: subjectName,
      isTermMonth: loc.isTermMonth,
      type:        loc.type,
      fields:      fields
    };
  } catch (e) {
    Logger.log('GS_readStudentGradesForSubject error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * قراءة موحّدة لكل المواد لطالب واحد في شهر معين.
 * مفيدة لـ StudentLogic (يعرض كل مواد الطالب).
 *
 * @param {string} spreadsheetId - معرّف ملف الشيت (ملف المعلم الرسمي)
 * @param {string} studentCode   - كود الطالب
 * @param {string} monthName     - اسم الشهر
 * @returns {Object} { success, month, subjects: [...] }
 */
function GS_readStudentMonthAllSubjects(spreadsheetId, studentCode, monthName) {
  try {
    if (!GS_V4_UNIFIED_READ) {
      return { success: false, error: 'الواجهة الموحّدة معطّلة (GS_V4_UNIFIED_READ=false)' };
    }
    var ss    = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(GS_OFFICIAL_GRADES_SHEET);
    if (!sheet) {
      return { success: false, error: 'ورقة "' + GS_OFFICIAL_GRADES_SHEET + '" غير موجودة' };
    }

    var lastCol = sheet.getLastColumn();
    var lastRow = sheet.getLastRow();
    if (lastRow < 4 || lastCol < 5) {
      return { success: false, error: 'بنية الورقة غير كاملة' };
    }

    var headers   = sheet.getRange(1, 1, 3, lastCol).getValues();
    var monthRow  = headers[0];
    var subjRow   = headers[1];
    var typeRow   = headers[2];

    /* العثور على صف الطالب */
    var codes = sheet.getRange(4, 1, lastRow - 3, 1).getValues();
    var studentRowIdx = -1;
    var target = String(studentCode).trim();
    for (var r = 0; r < codes.length; r++) {
      if (String(codes[r][0]).trim() === target) {
        studentRowIdx = r + 4;
        break;
      }
    }
    if (studentRowIdx === -1) {
      return { success: false, error: 'الطالب غير موجود' };
    }

    /* جمع المواد الفريدة للشهر المحدد */
    var subjectsSet = {};
    var subjectsList = [];
    var filled = '';
    for (var c = 0; c < monthRow.length; c++) {
      var mc = String(monthRow[c] || '').trim();
      if (GS_VALID_MONTHS.indexOf(mc) !== -1) filled = mc;
      if (filled === monthName) {
        var s = String(subjRow[c] || '').trim();
        if (s && !subjectsSet[s]) {
          subjectsSet[s] = true;
          subjectsList.push(s);
        }
      } else if (mc !== '' && mc !== monthName) {
        filled = '';
      }
    }

    /* قراءة كل مادة عبر الـ unified reader */
    var subjectsOut = [];
    for (var si = 0; si < subjectsList.length; si++) {
      var subjResult = GS_readStudentGradesForSubject(
        sheet, monthRow, subjRow, typeRow,
        studentRowIdx, monthName, subjectsList[si]
      );
      if (subjResult.success) {
        subjectsOut.push({
          name:        subjectsList[si],
          isTermMonth: subjResult.isTermMonth,
          grades:      subjResult.fields
        });
      }
    }

    return {
      success:     true,
      month:       monthName,
      isTermMonth: GS_isTermMonth(monthName),
      subjects:    subjectsOut
    };
  } catch (e) {
    Logger.log('GS_readStudentMonthAllSubjects error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * فحص الصحة الموحّد — تشخيص شامل قبل التفعيل.
 * شغّلها من محرر Apps Script للتحقق من جاهزية البنية.
 */
function GS_unifiedHealthCheck() {
  var report = {
    timestamp:   new Date().toISOString(),
    version:     'V4-Unified-Read',
    flags: {
      V3_FLAG:           GS_V3_FLAG,
      V4_UNIFIED_READ:   GS_V4_UNIFIED_READ
    },
    v3Features:  GS_V3_FEATURES,
    schemas:     {},
    synonyms:    {},
    labels:      GS_DISPLAY_LABELS,
    issues:      []
  };

  /* فحص schemas */
  for (var t in GS_SCHEMA) {
    if (GS_SCHEMA.hasOwnProperty(t)) {
      report.schemas[t] = {
        fieldCount:  GS_SCHEMA[t].fields.length,
        columnCount: GS_SCHEMA[t].columnCount,
        fields:      []
      };
      for (var f = 0; f < GS_SCHEMA[t].fields.length; f++) {
        report.schemas[t].fields.push({
          key:    GS_SCHEMA[t].fields[f].key,
          label:  GS_SCHEMA[t].fields[f].label,
          max:    GS_SCHEMA[t].fields[f].max,
          locked: GS_SCHEMA[t].fields[f].locked
        });
      }
    }
  }

  /* فحص synonyms */
  for (var k in GS_SYNONYMS) {
    if (GS_SYNONYMS.hasOwnProperty(k)) {
      report.synonyms[k] = GS_SYNONYMS[k].length;
    }
  }

  /* تحقق من وجود الدوال الحرجة */
  var criticalFns = [
    'GS_findSubjectLocation',
    'GS_computeTermMonthly',
    'GS_computeTermTotal',
    'GS_getDisplayLabel',
    'GS_buildVirtualColumns',
    'GS_normalizeTermFinal',
    'GS_isFieldLocked',
    'GS_getLockedFields'
  ];
  for (var i = 0; i < criticalFns.length; i++) {
    if (typeof this[criticalFns[i]] !== 'function') {
      report.issues.push('دالة مفقودة: ' + criticalFns[i]);
    }
  }

  Logger.log('═══ Unified Health Check ═══');
  Logger.log(JSON.stringify(report, null, 2));
  Logger.log('═══ End ═══');
  return report;
}

/**
 * اختبار end-to-end للـ V4 — يحاكي قراءة طالب حقيقي.
 * استخدم بعد تفعيل GS_V4_UNIFIED_READ = true.
 *
 * @param {string} studentCode - كود طالب فعلي للاختبار
 */
function GS_testV4WithRealStudent(studentCode) {
  if (!studentCode) {
    Logger.log('❌ مرّر كود طالب فعلي');
    return;
  }
  var teacherSheetId = '1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM';
  var months = ['محرم', 'صفر', 'نصف العام', 'جماد اول', 'جماد ثاني', 'نهاية العام'];

  Logger.log('═══ اختبار V4 للطالب: ' + studentCode + ' ═══');

  /* تفعيل مؤقت للاختبار */
  var originalFlag = GS_V4_UNIFIED_READ;
  GS_V4_UNIFIED_READ = true;

  for (var i = 0; i < months.length; i++) {
    var res = GS_readStudentMonthAllSubjects(teacherSheetId, studentCode, months[i]);
    if (res.success) {
      Logger.log('✅ ' + months[i] + ': ' + res.subjects.length + ' مواد');
      if (res.subjects.length > 0) {
        var firstSubj = res.subjects[0];
        Logger.log('   مثال — ' + firstSubj.name + ':');
        for (var fi = 0; fi < firstSubj.grades.length; fi++) {
          Logger.log('     ' + firstSubj.grades[fi].label + ' = ' +
                     firstSubj.grades[fi].value +
                     (firstSubj.grades[fi].locked ? ' 🔒' : ''));
        }
      }
    } else {
      Logger.log('❌ ' + months[i] + ': ' + res.error);
    }
  }

  GS_V4_UNIFIED_READ = originalFlag;
  Logger.log('═══ نهاية الاختبار ═══');
}