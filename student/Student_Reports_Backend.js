/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  School App Yemen — منصة الطالب / لوحة التقارير الشخصية
 *  File: Student_Reports_Backend.gs
 *  هذه الدوال تُضاف في نهاية ملف StudentLogic.gs (داخل نفس المشروع).
 *
 *  المتطلبات (موجودة فعلياً في StudentLogic.gs):
 *    - SPREADSHEET_ID, _getSS(), _getSheet()
 *    - _safe(), _safeStr(), _safeFloat()
 *    - _cacheGet(), _cacheSet()
 *
 *  المخرج: { ok: true, data: {...} } مطابقاً لباقي دوال StudentLogic
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ══════════════════════════════════════════════════════
//  مُنظّف قيم الأخطاء (#REF! / #N/A / #ERROR! ...) — يمنع تلوّث
//  التقارير بخلايا صيغ مكسورة في أوراق المدرسة (مثل «سلبيات الطالب»).
// ══════════════════════════════════════════════════════
function _srptClean(v) {
  var s = _safe(v);
  if (s && s.charAt(0) === '#') {
    if (/^#(REF!|N\/A|ERROR!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!|CALC!|SPILL!|GETTING_DATA)/.test(s)) return '';
  }
  return s;
}

// ══════════════════════════════════════════════════════
//  الدالة الرئيسية — نقطة الدخول الوحيدة
// ══════════════════════════════════════════════════════
function getStudentReports(studentIdOrParams) {
  try {
    // ═══════════════════════════════════════════════
    //  v2.1 — قبول الشكلين: كائن params أو معامل منفرد
    // ═══════════════════════════════════════════════
    var studentId;
    if (typeof studentIdOrParams === 'object' && studentIdOrParams !== null) {
      studentId = _safe(studentIdOrParams.studentId || studentIdOrParams.code || studentIdOrParams.id || '');
    } else {
      studentId = _safe(studentIdOrParams);
    }

    var sid = _safe(studentId);
    if (!sid) return { ok: false, error: 'كود الطالب مفقود' };

    var cacheKey = 'rpt_s_' + sid;
    var cached = _cacheGet(cacheKey);
    if (cached) {
      cached.fromCache = true;
      return { ok: true, data: cached };
    }

    // ① بيانات الطالب الأساسية
    var student = _srpt_getStudentRow(sid);
    if (!student) return { ok: false, error: 'لم يتم العثور على بيانات الطالب' };

    // ② الدرجات: متوسط لكل مادة + المجموع العام
    var gradesAnalysis = _srpt_analyzeGrades(student);

    // ③ الواجبات: عدد الواجبات الموجّهة للفصل
    var hwStats = _srpt_homeworkStats(student);

    // ④ المخالفات/المميزات
    var vioStats = _srpt_violationsStats(student);

    // ⑤ الحضور (إن توفّر)
    var attendance = _srpt_attendanceStats(student);

    // ⑥ آخر 5 درجات مستلمة (آخر شهر تم رصده)
    var lastGrades = _srpt_lastGrades(student, 5);

    // ⑦ المقارنة مع متوسط الفصل (اختياري - لكل مادة)
    var classAverage = _srpt_classAverage(student);

    // ⑧ آخر 5 أنشطة تخص الطالب
    var recentEvents = _srpt_recentEventsForStudent(student, 5);

    var data = {
      student: {
        code   : student.code,
        name   : student.name,
        class  : student.class,
        section: student.section
      },
      summary: {
        overallAvg     : gradesAnalysis.overall,
        subjectsCount  : gradesAnalysis.subjects.length,
        homeworkAssigned: hwStats.total,
        violationsCount: vioStats.violationCount,
        meritsCount    : vioStats.meritCount,
        attendanceRate : attendance.rate,
        absentDays     : attendance.absent,
        lateDays       : attendance.late
      },
      charts: {
        gradesBySubject : gradesAnalysis.subjects,
        attendanceBars  : attendance.bars,
        comparisonChart : classAverage
      },
      lists: {
        lastGrades   : lastGrades,
        recentEvents : recentEvents,
        topMerits    : vioStats.merits.slice(0, 5),
        topViolations: vioStats.violations.slice(0, 5)
      },
      generatedAt: _nowString()
    };

    _cacheSet(cacheKey, data, 180);
    return { ok: true, data: data };
  } catch (e) {
    console.error('getStudentReports error:', e);
    return { ok: false, error: 'تعذّر توليد التقرير: ' + e.message };
  }
}
// ══════════════════════════════════════════════════════
//  بيانات الطالب من ورقة الطلاب
// ══════════════════════════════════════════════════════

function _srpt_getStudentRow(studentId) {
  var sheet = _getSheet('الطلاب');
  if (!sheet) return null;
  var data = sheet.getDataRange().getDisplayValues();
  for (var i = 1; i < data.length; i++) {
    if (_safe(data[i][0]) === _safe(studentId)) {
      return {
        code   : _safe(data[i][0]),
        name   : _safe(data[i][1]),
        class  : _safe(data[i][2]),
        section: _safe(data[i][3]),
        rowIdx : i + 1
      };
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════
//  تحليل الدرجات (يستفيد من بنية ورقة الدرجات الحالية)
// ══════════════════════════════════════════════════════

function _srpt_analyzeGrades(student) {
  var result = { overall: 0, subjects: [] };
  try {
    var sheet = _getSheet('النصفي');
    if (!sheet) return result;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 4 || lastCol < 5) return result;

    var monthRow   = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var subjectRow = sheet.getRange(2, 1, 1, lastCol).getValues()[0];

    // إيجاد صف الطالب
    var codes = sheet.getRange(4, 1, lastRow - 3, 1).getValues();
    var targetRowIdx = -1;
    var sid = _safe(student.code);
    for (var r = 0; r < codes.length; r++) {
      if (_safe(codes[r][0]) === sid) { targetRowIdx = r + 4; break; }
    }
    if (targetRowIdx < 0) return result;

    var rowData = sheet.getRange(targetRowIdx, 1, 1, lastCol).getValues()[0];

    // تجميع لكل مادة (متوسط عبر كل الشهور)
    var subjAgg = {};
    for (var c = 4; c < lastCol; c++) {
      var subj = _safeStr(subjectRow[c]);
      if (!subj) continue;
      var v = rowData[c];
      var n = (v === '' || v === null) ? null : Number(v);
      if (n === null || isNaN(n)) continue;
      if (!subjAgg[subj]) subjAgg[subj] = { sum: 0, count: 0 };
      subjAgg[subj].sum   += n;
      subjAgg[subj].count++;
    }

    var totalSum = 0, totalCount = 0;
    var subjects = [];
    for (var sk in subjAgg) if (subjAgg.hasOwnProperty(sk)) {
      var avg = subjAgg[sk].count > 0 ? subjAgg[sk].sum / subjAgg[sk].count : 0;
      subjects.push({
        label: sk,
        value: Math.round(avg * 10) / 10,
        count: subjAgg[sk].count
      });
      totalSum += subjAgg[sk].sum;
      totalCount += subjAgg[sk].count;
    }
    subjects.sort(function(a, b) { return b.value - a.value; });

    result.subjects = subjects;
    result.overall = totalCount > 0 ? Math.round((totalSum / totalCount) * 10) / 10 : 0;
  } catch (e) {
    console.error('_srpt_analyzeGrades:', e);
  }
  return result;
}

// ══════════════════════════════════════════════════════
//  آخر N درجات مستلمة (أحدث شهر فيه قيم)
// ══════════════════════════════════════════════════════

function _srpt_lastGrades(student, n) {
  var out = [];
  try {
    var sheet = _getSheet('النصفي');
    if (!sheet) return out;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 4 || lastCol < 5) return out;

    var monthRow   = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var subjectRow = sheet.getRange(2, 1, 1, lastCol).getValues()[0];

    var codes = sheet.getRange(4, 1, lastRow - 3, 1).getValues();
    var targetRowIdx = -1;
    var sid = _safe(student.code);
    for (var r = 0; r < codes.length; r++) {
      if (_safe(codes[r][0]) === sid) { targetRowIdx = r + 4; break; }
    }
    if (targetRowIdx < 0) return out;

    var rowData = sheet.getRange(targetRowIdx, 1, 1, lastCol).getValues()[0];

    // الترتيب: نأخذ آخر الأعمدة التي بها قيمة (أحدث الإدخالات على اليمين عادةً)
    var lastMonth = '';
    var collected = [];
    for (var c = lastCol - 1; c >= 4; c--) {
      var subj = _safeStr(subjectRow[c]);
      if (!subj) continue;
      var v = rowData[c];
      if (v === '' || v === null || isNaN(Number(v))) continue;
      // إيجاد الشهر المرتبط
      var month = '';
      for (var bm = c; bm >= 0; bm--) {
        if (_safeStr(monthRow[bm])) { month = _safeStr(monthRow[bm]); break; }
      }
      collected.push({
        subject: subj,
        month  : month,
        value  : Number(v)
      });
      if (collected.length >= (n || 5)) break;
    }
    out = collected;
  } catch (e) { console.error('_srpt_lastGrades:', e); }
  return out;
}

// ══════════════════════════════════════════════════════
//  المقارنة مع متوسط الفصل لكل مادة
// ══════════════════════════════════════════════════════

function _srpt_classAverage(student) {
  var out = [];
  try {
    var sheet = _getSheet('النصفي');
    if (!sheet) return out;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 4 || lastCol < 5) return out;

    var subjectRow = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
    var data = sheet.getRange(4, 1, lastRow - 3, lastCol).getValues();

    // التحديد: عمود 0=الكود، 1=الاسم، 2=الفصل، 3=الشعبة
    var myCls = _safe(student.class);
    var mySec = _safe(student.section);

    var classAgg = {};   // subj => { sum, count }
    var myAgg    = {};   // subj => { sum, count }

    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      var rowCls = _safe(row[2]);
      var rowSec = _safe(row[3]);
      if (rowCls !== myCls || rowSec !== mySec) continue; // فقط نفس الفصل والشعبة

      var rowCode = _safe(row[0]);
      var isMe = (rowCode === _safe(student.code));

      for (var c = 4; c < lastCol; c++) {
        var subj = _safeStr(subjectRow[c]);
        if (!subj) continue;
        var v = row[c];
        if (v === '' || v === null) continue;
        var n = Number(v);
        if (isNaN(n)) continue;

        if (!classAgg[subj]) classAgg[subj] = { sum: 0, count: 0 };
        classAgg[subj].sum   += n;
        classAgg[subj].count++;

        if (isMe) {
          if (!myAgg[subj]) myAgg[subj] = { sum: 0, count: 0 };
          myAgg[subj].sum   += n;
          myAgg[subj].count++;
        }
      }
    }

    for (var sk in myAgg) if (myAgg.hasOwnProperty(sk)) {
      var myAvg    = myAgg[sk].count    > 0 ? myAgg[sk].sum    / myAgg[sk].count    : 0;
      var classAvg = classAgg[sk] && classAgg[sk].count > 0
                     ? classAgg[sk].sum / classAgg[sk].count : 0;
      out.push({
        label   : sk,
        my      : Math.round(myAvg    * 10) / 10,
        classAvg: Math.round(classAvg * 10) / 10
      });
    }
    out.sort(function(a, b) { return b.my - a.my; });
  } catch (e) { console.error('_srpt_classAverage:', e); }
  return out;
}

// ══════════════════════════════════════════════════════
//  إحصائيات الواجبات
// ══════════════════════════════════════════════════════

function _srpt_homeworkStats(student) {
  var result = { total: 0, latest: [] };
  try {
    var sheet = _getSheet('الواجبات');
    if (!sheet) return result;
    var data = sheet.getDataRange().getValues();
    if (!data || data.length < 2) return result;

    var headers = data[0].map(function(h) { return _safe(h); });
    var clsCol = headers.indexOf('الفصل');
    var secCol = headers.indexOf('الشعبة');
    var dateCol = headers.indexOf('التاريخ');

    var myCls = _safe(student.class);
    var mySec = _safe(student.section);

    for (var i = 1; i < data.length; i++) {
      var rowCls = _safe(data[i][clsCol]);
      var rowSec = _safe(data[i][secCol]);
      if (rowCls === myCls && (rowSec === mySec || rowSec === 'جميع الشعب' || rowSec === '')) {
        result.total++;
      }
    }
  } catch (e) { console.error('_srpt_homeworkStats:', e); }
  return result;
}

// ══════════════════════════════════════════════════════
//  المخالفات والمميزات (يفصل المميزات عن السلبيات)
// ══════════════════════════════════════════════════════

function _srpt_violationsStats(student) {
  var result = {
    violationCount: 0, meritCount: 0,
    violations: [], merits: []
  };
  try {
    var sid    = _safe(student.code);
    var sname  = _safe(student.name);

    // قائمة كلمات إيجابية — تشمل «تعزيز» وكلمات المميزات الشائعة
    // تتزامن مع POS_WORDS في renderViolations بالواجهة
    var POS = ['تعزيز', 'تشجيع', 'ملتزم', 'التزام', 'متفوق', 'تفوق',
               'متميز', 'تميز', 'تميّز', 'مميز', 'إيجاب', 'إيجابي', 'إيجابية',
               'ميزة', 'مجد', 'متعاون', 'تعاون', 'نشيط', 'نشاط', 'مشارك',
               'مشاركة', 'تفاعل', 'منظم', 'نظيف', 'مؤدب', 'مهذب', 'أدب',
               'احترام', 'محترم', 'صادق', 'صدق', 'أمانة', 'تطوع', 'مساعدة',
               'إنجاز', 'اجتهاد', 'مجتهد', 'انضباط', 'منضبط', 'إبداع',
               'مبدع', 'ممتاز', 'شكر', 'إشادة', 'تكريم', 'قدوة', 'فائق'];

    // كلمات سلبية لها الأولوية (مثل «عدم التزام» لا يجب تصنيفه إيجابياً)
    var NEG_OVERRIDE = ['عدم', 'مخالف', 'تأخر', 'تأخير', 'غياب', 'غائب',
                        'إهمال', 'مهمل', 'شغب', 'عنف', 'إساءة', 'تخريب',
                        'غش', 'فوضى', 'إزعاج', 'هروب', 'تهرب', 'إنذار',
                        'خصم', 'سلبي', 'ضعف', 'رسوب', 'عصيان', 'شتم', 'ضرب'];

    function _isMerit(t) {
      var i;
      for (i = 0; i < NEG_OVERRIDE.length; i++) {
        if (t.indexOf(NEG_OVERRIDE[i]) !== -1) return false;
      }
      for (i = 0; i < POS.length; i++) {
        if (t.indexOf(POS[i]) !== -1) return true;
      }
      return false;
    }

    function _processSheet(sheet) {
      if (!sheet) return;
      var data = sheet.getDataRange().getValues();
      if (!data || data.length < 2) return;
      var headers = data[0].map(function(h) { return _safe(h); });
      var codeCol = headers.indexOf('الكود');
      var nameCol = headers.indexOf('الاسم');
      var typeCol = headers.indexOf('المخالفة');
      if (typeCol === -1) typeCol = headers.indexOf('النوع');
      if (typeCol === -1) typeCol = headers.indexOf('نوع السلوك');
      var dateCol = headers.indexOf('التاريخ');
      if (codeCol === -1 && nameCol === -1) return;

      for (var i = 1; i < data.length; i++) {
        var rowSid  = _safe(data[i][codeCol]);
        var rowName = nameCol > -1 ? _safe(data[i][nameCol]) : '';
        if ((rowSid !== sid) && !(sid && rowName && rowName === sname)) continue;

        var rowType = _srptClean(data[i][typeCol]);
        if (!rowType) continue;
        var rowDate = dateCol > -1 ? data[i][dateCol] : '';
        var dateStr = '';
        if (rowDate) {
          try { dateStr = Utilities.formatDate(new Date(rowDate), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
          catch (_) {}
        }

        if (_isMerit(rowType)) {
          result.meritCount++;
          result.merits.push({ type: rowType, date: dateStr });
        } else {
          result.violationCount++;
          result.violations.push({ type: rowType, date: dateStr });
        }
      }
    }

    // اقرأ من كلتا الورقتين (قد توجدان معاً أو إحداهما فقط)
    _processSheet(_getSheet('سلبيات ومميزات الطالب'));
    _processSheet(_getSheet('المخالفات'));

    result.violations.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    result.merits.sort(    function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
  } catch (e) { console.error('_srpt_violationsStats:', e); }
  return result;
}

// ══════════════════════════════════════════════════════
//  الحضور (إن توفّر)
// ══════════════════════════════════════════════════════

function _srpt_attendanceStats(student) {
  var result = { rate: 0, absent: 0, late: 0, present: 0, total: 0, bars: [] };
  try {
    var sheet = _getSheet('الغياب');
    if (!sheet) return result;
    var data = sheet.getDataRange().getValues();
    if (!data || data.length < 2) return result;

    var headers = data[0].map(function(h) { return _safe(h); });
    var codeCol = headers.indexOf('الكود');
    var statusCol = headers.indexOf('الحالة');
    if (codeCol === -1 || statusCol === -1) return result;

    var sid = _safe(student.code);
    for (var i = 1; i < data.length; i++) {
      if (_safe(data[i][codeCol]) !== sid) continue;
      var st = _safe(data[i][statusCol]);
      if (!st) continue;
      result.total++;
      if (st === 'حاضر')        result.present++;
      else if (st === 'متأخر')  result.late++;
      else if (st === 'غائب')   result.absent++;
    }

    if (result.total > 0) {
      result.rate = Math.round(((result.present + result.late) / result.total) * 1000) / 10;
    }
    result.bars = [
      { label: 'حاضر', value: result.present },
      { label: 'متأخر', value: result.late },
      { label: 'غائب',  value: result.absent }
    ];
  } catch (e) { console.error('_srpt_attendanceStats:', e); }
  return result;
}

// ══════════════════════════════════════════════════════
//  آخر الأحداث الخاصة بالطالب (واجبات + مخالفات + درجات)
// ══════════════════════════════════════════════════════

function _srpt_recentEventsForStudent(student, n) {
  var events = [];
  try {
    var hwSheet = _getSheet('الواجبات');
    if (hwSheet) {
      var hw = hwSheet.getDataRange().getValues();
      var headers = hw[0].map(function(h) { return _safe(h); });
      var clsCol  = headers.indexOf('الفصل');
      var secCol  = headers.indexOf('الشعبة');
      var subjCol = headers.indexOf('المادة');
      var hwCol   = headers.indexOf('الواجب');
      var dCol    = headers.indexOf('التاريخ');
      var myCls = _safe(student.class), mySec = _safe(student.section);

      for (var i = 1; i < hw.length; i++) {
        var rowCls = _safe(hw[i][clsCol]);
        var rowSec = _safe(hw[i][secCol]);
        if (rowCls === myCls && (rowSec === mySec || rowSec === 'جميع الشعب' || rowSec === '')) {
          var dt = hw[i][dCol];
          events.push({
            type: 'homework', icon: '📝',
            label: 'واجب • ' + _safe(hw[i][subjCol]),
            content: _safe(hw[i][hwCol]),
            date: dt ? Utilities.formatDate(new Date(dt),
                       Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
            ts  : dt ? new Date(dt).getTime() : 0
          });
        }
      }
    }

    var vioSheet = _getSheet('المخالفات') || _getSheet('سلبيات ومميزات الطالب');
    if (vioSheet) {
      var vio = vioSheet.getDataRange().getValues();
      var vh = vio[0].map(function(h) { return _safe(h); });
      var vCode = vh.indexOf('الكود'), vName = vh.indexOf('الاسم');
      var vType = vh.indexOf('المخالفة');
      if (vType === -1) vType = vh.indexOf('النوع');
      var vDate = vh.indexOf('التاريخ');
      var sid = _safe(student.code), sname = _safe(student.name);

      for (var j = 1; j < vio.length; j++) {
        var rowSid = _safe(vio[j][vCode]);
        var rowSnm = vName > -1 ? _safe(vio[j][vName]) : '';
        if (rowSid === sid || (sid && rowSnm === sname)) {
          var dt2 = vio[j][vDate];
          events.push({
            type: 'violation', icon: '⚠️',
            label: 'سلوك',
            content: _srptClean(vio[j][vType]),
            date: dt2 ? Utilities.formatDate(new Date(dt2),
                        Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
            ts  : dt2 ? new Date(dt2).getTime() : 0
          });
        }
      }
    }

    events.sort(function(a, b) { return b.ts - a.ts; });
    return events.slice(0, n || 5);
  } catch (e) { console.error('_srpt_recentEventsForStudent:', e); return events; }
}