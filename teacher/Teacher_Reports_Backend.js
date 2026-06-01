/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  School App Yemen — منصة المعلمين / لوحة التقارير المتقدمة
 *  File: Teacher_Reports_Backend.gs
 *  هذه الدوال تُضاف في نهاية ملف TeacherCore.gs (داخل نفس المشروع).
 *
 *  المتطلبات (موجودة فعلياً في TeacherCore.gs):
 *    - SPREADSHEET_ID, _getSS(), _getSheet()
 *    - withAuth() من TeacherAuth.gs
 *    - _safeStr(), _safeNum(), _safeFloat()
 *    - _tcCacheGet(), _tcCacheSet()
 *
 *  الأوراق المستخدمة:
 *    - الطلاب  | الواجبات | الاخبار | المخالفات | الملاحظات
 *    - الدرجات (شيت كبير 290 عمود)
 *    - الغياب (إن وُجدت)
 *
 *  المخرجات: object موحد فيه scope, summary, charts, lists
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ══════════════════════════════════════════════════════
//  الدالة الرئيسية المحمية — نقطة الدخول الوحيدة
// ══════════════════════════════════════════════════════

function getTeacherReportsProtected(params) {
  return withAuth(params, function(session) {
    try {
      var role = session.role || 'teacher';
      var cacheKey = 'rpt_t_' + role + '_' +
        (session.teacherName || '').replace(/\s+/g, '_') + '_' +
        ((session.classes || []).join('|'));

      var cached = _tcCacheGet(cacheKey);
      if (cached) {
        cached.fromCache = true;
        return { success: true, data: cached };
      }

      var data;
      if (role === 'admin' || role === 'deputy') {
        data = _reports_buildAdminScope(session);
      } else if (role === 'supervisor') {
        data = _reports_buildSupervisorScope(session);
      } else {
        data = _reports_buildTeacherScope(session);
      }

      data.generatedAt = _nowString();
      data.role        = role;
      data.scopeLabel  = _reports_scopeLabel(session);

      // كاش 3 دقائق فقط (التقارير حساسة للتحديث)
      _tcCacheSet(cacheKey, data, 180);
      return { success: true, data: data };
    } catch (e) {
      Logger.log('getTeacherReportsProtected error: ' + e.toString());
      return { success: false, error: 'تعذّر توليد التقرير: ' + e.message };
    }
  });
}

// ══════════════════════════════════════════════════════
//  Scope: Admin / Deputy — رؤية شاملة للمنظومة
// ══════════════════════════════════════════════════════

function _reports_buildAdminScope(session) {
  var students   = _reports_loadAllStudents();
  var teachers   = _reports_loadAllTeachers();
  var news       = _reports_loadSheet('الاخبار');
  var homework   = _reports_loadSheet('الواجبات');
  var violations = _reports_loadSheet('المخالفات');
  var notes      = _reports_loadSheet('الملاحظات');

  // إحصائيات أساسية
  var classes  = _reports_uniqueField(students, 'الفصل');
  var sections = _reports_uniqueField(students, 'الشعبة');

  // أعلى 5 معلمين تفاعلاً (مجموع: واجبات + أخبار + مخالفات)
  var teacherActivity = _reports_aggregateByTeacher(homework, news, violations);
  var topTeachers = _reports_top(teacherActivity, 5);

  // أكثر 5 طلاب مخالفات
  var studentViolations = _reports_aggregateStudentViolations(violations);
  var topViolatedStudents = _reports_top(studentViolations, 5);

  // توزيع المحتوى على الفصول
  var contentByClass = _reports_aggregateByClass(homework, news, violations);

  // النشاط خلال آخر 7 أيام
  var weeklyActivity = _reports_weeklyTimeline(homework, news, violations);

  // متوسط نسبة الحضور (إن توفرت ورقة الغياب)
  var attendanceRate = _reports_calcOverallAttendance();

  return {
    scope: 'admin',
    summary: {
      totalStudents : students.length,
      totalTeachers : teachers.length,
      totalClasses  : classes.length,
      totalSections : sections.length,
      totalNews     : news.rows.length,
      totalHomework : homework.rows.length,
      totalViolations: violations.rows.length,
      totalNotes    : notes.rows.length,
      attendanceRate: attendanceRate
    },
    charts: {
      contentByClass : contentByClass,
      weeklyActivity : weeklyActivity,
      attendanceBars : _reports_attendanceByClass()
    },
    lists: {
      topTeachers         : topTeachers,
      topViolatedStudents : topViolatedStudents,
      latestNews          : _reports_latestRows(news, 5, 'التاريخ'),
      latestHomework      : _reports_latestRows(homework, 5, 'التاريخ'),
      latestViolations    : _reports_latestRows(violations, 5, 'التاريخ')
    }
  };
}

// ══════════════════════════════════════════════════════
//  Scope: Supervisor — مقصور على فصوله
// ══════════════════════════════════════════════════════

function _reports_buildSupervisorScope(session) {
  var allowedClasses = session.classes || [];
  var allowAll = (allowedClasses.indexOf('جميع الفصول') !== -1);

  var students   = _reports_loadAllStudents();
  var news       = _reports_loadSheet('الاخبار');
  var homework   = _reports_loadSheet('الواجبات');
  var violations = _reports_loadSheet('المخالفات');

  if (!allowAll) {
    students        = _reports_filterByClasses(students,        allowedClasses, 'الفصل');
    news.rows       = _reports_filterRowsByClasses(news,       allowedClasses);
    homework.rows   = _reports_filterRowsByClasses(homework,   allowedClasses);
    violations.rows = _reports_filterRowsByClasses(violations, allowedClasses);
  }

  var sections = _reports_uniqueField(students, 'الشعبة');
  var teacherActivity = _reports_aggregateByTeacher(homework, news, violations);
  var topTeachers = _reports_top(teacherActivity, 5);

  var studentViolations = _reports_aggregateStudentViolations(violations);
  var topViolatedStudents = _reports_top(studentViolations, 5);

  var contentByClass = _reports_aggregateByClass(homework, news, violations);
  var weeklyActivity = _reports_weeklyTimeline(homework, news, violations);

  return {
    scope: 'supervisor',
    supervisedClasses: allowedClasses,
    summary: {
      supervisedStudents: students.length,
      supervisedClasses : allowedClasses.length,
      sectionsInScope   : sections.length,
      totalNews         : news.rows.length,
      totalHomework     : homework.rows.length,
      totalViolations   : violations.rows.length
    },
    charts: {
      contentByClass : contentByClass,
      weeklyActivity : weeklyActivity
    },
    lists: {
      topTeachers         : topTeachers,
      topViolatedStudents : topViolatedStudents,
      latestNews          : _reports_latestRows(news, 5, 'التاريخ'),
      latestHomework      : _reports_latestRows(homework, 5, 'التاريخ'),
      latestViolations    : _reports_latestRows(violations, 5, 'التاريخ')
    }
  };
}

// ══════════════════════════════════════════════════════
//  Scope: Teacher — تقارير المعلم الشخصية
// ══════════════════════════════════════════════════════

function _reports_buildTeacherScope(session) {
  var teacherName = session.teacherName || '';
  var allowedClasses  = session.classes  || [];
  var allowedSubjects = session.subjects || [];

  var students   = _reports_loadAllStudents();
  var homework   = _reports_loadSheet('الواجبات');
  var news       = _reports_loadSheet('الاخبار');
  var violations = _reports_loadSheet('المخالفات');

  // فلترة الطلاب: ضمن فصول المعلم فقط
  var allowAll = (allowedClasses.indexOf('جميع الفصول') !== -1);
  var myStudents = allowAll ? students :
    _reports_filterByClasses(students, allowedClasses, 'الفصل');

  // أنشطة المعلم نفسه (حسب اسم المدرس)
  var myHomework   = _reports_filterByTeacherName(homework,   teacherName);
  var myNews       = _reports_filterByTeacherName(news,       teacherName);
  var myViolations = _reports_filterByTeacherName(violations, teacherName);

  // متوسط الدرجات للمواد التي يدرّسها (إن أمكن)
  var gradesAvg = _reports_avgGradesForTeacher(myStudents, allowedSubjects);

  // توزيع المخالفات على الفصول
  var violationsByClass = {};
  for (var i = 0; i < myViolations.length; i++) {
    var cls = _safeStr(myViolations[i].rowMap['الفصل']);
    if (cls) violationsByClass[cls] = (violationsByClass[cls] || 0) + 1;
  }

  // آخر 5 أنشطة
  var recent = _reports_recentActivities(myHomework, myNews, myViolations, 5);

  // عدد الحصص الأسبوعية (إن أمكن قراءتها من الجدول)
  var weeklyPeriods = _reports_countWeeklyPeriods(teacherName);

  return {
    scope: 'teacher',
    teacherName: teacherName,
    mySubjects : allowedSubjects,
    myClasses  : allowedClasses,
    summary: {
      myStudents     : myStudents.length,
      myHomework     : myHomework.length,
      myNews         : myNews.length,
      myViolations   : myViolations.length,
      weeklyPeriods  : weeklyPeriods,
      avgGrade       : gradesAvg.overall
    },
    charts: {
      gradesBySubject  : gradesAvg.bySubject,
      violationsByClass: _reports_objectToBars(violationsByClass),
      activityTimeline : _reports_weeklyTimeline(
        { rows: myHomework, headers: homework.headers },
        { rows: myNews,     headers: news.headers     },
        { rows: myViolations, headers: violations.headers }
      )
    },
    lists: {
      recentActivities: recent
    }
  };
}

// ══════════════════════════════════════════════════════
//  دوال مساعدة — قراءة البيانات
// ══════════════════════════════════════════════════════

/**
 * يحمّل ورقة كاملة ويعيد headers + rows (مع rowMap لكل صف)
 */
function _reports_loadSheet(sheetName) {
  var sheet = _getSheet(sheetName);
  if (!sheet) return { headers: [], rows: [] };

  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return { headers: [], rows: [] };

  var headers = values[0].map(function(h) { return _safeStr(h); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var hasData = false;
    var map = {};
    for (var c = 0; c < headers.length; c++) {
      map[headers[c]] = row[c];
      if (row[c] !== '' && row[c] !== null && row[c] !== undefined) hasData = true;
    }
    if (hasData) rows.push({ idx: r + 1, raw: row, rowMap: map });
  }
  return { headers: headers, rows: rows };
}

/**
 * يحمّل قائمة الطلاب من ورقة الطلاب
 */
function _reports_loadAllStudents() {
  var data = _reports_loadSheet('الطلاب');
  var students = [];
  for (var i = 0; i < data.rows.length; i++) {
    var m = data.rows[i].rowMap;
    var name = _safeStr(m['الاسم']);
    if (!name) continue;
    students.push({
      code   : _safeStr(m['الكود']),
      name   : name,
      class  : _safeStr(m['الفصل']),
      section: _safeStr(m['الشعبة']),
      rowMap : m
    });
  }
  return students;
}

/**
 * يحمّل قائمة المعلمين من ورقة المدرسين
 */
function _reports_loadAllTeachers() {
  var data = _reports_loadSheet('المدرسين');
  var seen = {};
  var list = [];
  for (var i = 0; i < data.rows.length; i++) {
    var m = data.rows[i].rowMap;
    var name = _safeStr(m['اسم المدرس']);
    if (!name || seen[name]) continue;
    seen[name] = true;
    list.push({
      name   : name,
      subject: _safeStr(m['المادة']),
      class  : _safeStr(m['الفصل'])
    });
  }
  return list;
}

// ══════════════════════════════════════════════════════
//  دوال التجميع والفلترة
// ══════════════════════════════════════════════════════

function _reports_uniqueField(rowsOrStudents, field) {
  var seen = {};
  var out = [];
  for (var i = 0; i < rowsOrStudents.length; i++) {
    var v = '';
    if (rowsOrStudents[i].rowMap) v = _safeStr(rowsOrStudents[i].rowMap[field]);
    else if (rowsOrStudents[i][field]) v = _safeStr(rowsOrStudents[i][field]);
    else if (rowsOrStudents[i].class && field === 'الفصل')   v = rowsOrStudents[i].class;
    else if (rowsOrStudents[i].section && field === 'الشعبة') v = rowsOrStudents[i].section;
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  }
  return out;
}

function _reports_filterByClasses(students, allowedClasses, fieldName) {
  var allowed = {};
  for (var i = 0; i < allowedClasses.length; i++) allowed[allowedClasses[i]] = true;
  var out = [];
  for (var j = 0; j < students.length; j++) {
    var cls = students[j].class || (students[j].rowMap && students[j].rowMap[fieldName]) || '';
    if (allowed[_safeStr(cls)]) out.push(students[j]);
  }
  return out;
}

function _reports_filterRowsByClasses(sheetData, allowedClasses) {
  var allowed = {};
  for (var i = 0; i < allowedClasses.length; i++) allowed[allowedClasses[i]] = true;
  var out = [];
  for (var j = 0; j < sheetData.rows.length; j++) {
    var cls = _safeStr(sheetData.rows[j].rowMap['الفصل']);
    if (allowed[cls]) out.push(sheetData.rows[j]);
  }
  return out;
}

function _reports_filterByTeacherName(sheetData, teacherName) {
  var t = _safeStr(teacherName);
  if (!t) return [];
  var out = [];
  for (var i = 0; i < sheetData.rows.length; i++) {
    var name = _safeStr(sheetData.rows[i].rowMap['اسم المدرس']);
    if (name === t) out.push(sheetData.rows[i]);
  }
  return out;
}

/**
 * يجمّع نشاط كل معلم: واجبات + أخبار + مخالفات
 */
function _reports_aggregateByTeacher(homework, news, violations) {
  var agg = {};
  function add(rows, label) {
    for (var i = 0; i < rows.length; i++) {
      var t = _safeStr(rows[i].rowMap['اسم المدرس']);
      if (!t) continue;
      if (!agg[t]) agg[t] = { name: t, total: 0, homework: 0, news: 0, violations: 0 };
      agg[t][label]++;
      agg[t].total++;
    }
  }
  add(homework.rows,   'homework');
  add(news.rows,       'news');
  add(violations.rows, 'violations');
  return agg;
}

function _reports_aggregateStudentViolations(violations) {
  var agg = {};
  for (var i = 0; i < violations.rows.length; i++) {
    var name = _safeStr(violations.rows[i].rowMap['الاسم']);
    var code = _safeStr(violations.rows[i].rowMap['الكود']);
    var cls  = _safeStr(violations.rows[i].rowMap['الفصل']);
    var sec  = _safeStr(violations.rows[i].rowMap['الشعبة']);
    if (!name) continue;
    var key = code || name;
    if (!agg[key]) agg[key] = { name: name, code: code, class: cls, section: sec, total: 0 };
    agg[key].total++;
  }
  return agg;
}

function _reports_aggregateByClass(homework, news, violations) {
  var agg = {};
  function add(rows, label) {
    for (var i = 0; i < rows.length; i++) {
      var cls = _safeStr(rows[i].rowMap['الفصل']);
      if (!cls) continue;
      if (!agg[cls]) agg[cls] = { label: cls, value: 0, homework: 0, news: 0, violations: 0 };
      agg[cls][label]++;
      agg[cls].value++;
    }
  }
  add(homework.rows,   'homework');
  add(news.rows,       'news');
  add(violations.rows, 'violations');

  // تحويل إلى مصفوفة + فرز تنازلي
  var arr = [];
  for (var k in agg) if (agg.hasOwnProperty(k)) arr.push(agg[k]);
  arr.sort(function(a, b) { return b.value - a.value; });
  return arr;
}

function _reports_top(aggMap, limit) {
  var arr = [];
  for (var k in aggMap) if (aggMap.hasOwnProperty(k)) arr.push(aggMap[k]);
  arr.sort(function(a, b) { return b.total - a.total; });
  return arr.slice(0, limit || 5);
}

function _reports_latestRows(sheetData, limit, dateField) {
  var rows = sheetData.rows.slice();
  rows.sort(function(a, b) {
    var da = a.rowMap[dateField] ? new Date(a.rowMap[dateField]).getTime() : 0;
    var db = b.rowMap[dateField] ? new Date(b.rowMap[dateField]).getTime() : 0;
    return db - da;
  });
  var out = [];
  var max = Math.min(rows.length, limit || 5);
  for (var i = 0; i < max; i++) {
    var m = rows[i].rowMap;
    out.push({
      teacher: _safeStr(m['اسم المدرس']),
      class  : _safeStr(m['الفصل']),
      section: _safeStr(m['الشعبة']),
      content: _safeStr(m['الخبر'] || m['الواجب'] || m['المخالفة'] || ''),
      date   : m[dateField] ? Utilities.formatDate(new Date(m[dateField]),
                Session.getScriptTimeZone(), 'yyyy-MM-dd') : ''
    });
  }
  return out;
}

function _reports_recentActivities(homework, news, violations, limit) {
  var all = [];
  for (var i = 0; i < homework.length; i++) {
    var h = homework[i].rowMap;
    all.push({
      type: 'homework', icon: '📝',
      label: 'واجب • ' + _safeStr(h['المادة']),
      content: _safeStr(h['الواجب']),
      class: _safeStr(h['الفصل']) + ' ' + _safeStr(h['الشعبة']),
      date: h['التاريخ']
    });
  }
  for (var j = 0; j < news.length; j++) {
    var n = news[j].rowMap;
    all.push({
      type: 'news', icon: '📢',
      label: 'خبر',
      content: _safeStr(n['الخبر']),
      class: _safeStr(n['الفصل']) + ' ' + _safeStr(n['الشعبة']),
      date: n['التاريخ']
    });
  }
  for (var k = 0; k < violations.length; k++) {
    var v = violations[k].rowMap;
    all.push({
      type: 'violation', icon: '⚠️',
      label: 'مخالفة',
      content: _safeStr(v['الاسم']) + ' — ' + _safeStr(v['المخالفة']),
      class: _safeStr(v['الفصل']) + ' ' + _safeStr(v['الشعبة']),
      date: v['التاريخ']
    });
  }
  all.sort(function(a, b) {
    var da = a.date ? new Date(a.date).getTime() : 0;
    var db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });
  // تنسيق التاريخ
  var max = Math.min(all.length, limit || 5);
  var out = [];
  for (var x = 0; x < max; x++) {
    var item = all[x];
    item.date = item.date ? Utilities.formatDate(new Date(item.date),
                Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
    out.push(item);
  }
  return out;
}

/**
 * نشاط آخر 7 أيام مقسوماً يومياً
 */
function _reports_weeklyTimeline(homework, news, violations) {
  var days = [];
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  for (var i = 6; i >= 0; i--) {
    var d = new Date(now.getTime() - i * 86400000);
    days.push({
      label: Utilities.formatDate(d, tz, 'MM-dd'),
      key  : Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
      homework: 0, news: 0, violations: 0, total: 0
    });
  }
  var idx = {};
  for (var k = 0; k < days.length; k++) idx[days[k].key] = days[k];

  function bucket(rows, type) {
    for (var r = 0; r < rows.length; r++) {
      var dt = rows[r].rowMap['التاريخ'];
      if (!dt) continue;
      try {
        var key = Utilities.formatDate(new Date(dt), tz, 'yyyy-MM-dd');
        if (idx[key]) { idx[key][type]++; idx[key].total++; }
      } catch (e) {}
    }
  }
  bucket(homework.rows,   'homework');
  bucket(news.rows,       'news');
  bucket(violations.rows, 'violations');
  return days;
}

function _reports_objectToBars(obj) {
  var arr = [];
  for (var k in obj) if (obj.hasOwnProperty(k)) {
    arr.push({ label: k, value: obj[k] });
  }
  arr.sort(function(a, b) { return b.value - a.value; });
  return arr;
}

// ══════════════════════════════════════════════════════
//  متوسط الدرجات لمعلم (يقرأ ورقة الدرجات)
// ══════════════════════════════════════════════════════

function _reports_avgGradesForTeacher(myStudents, mySubjects) {
  var result = { overall: 0, bySubject: [] };
  try {
    if (!myStudents.length) return result;

    var sheet = _getSheet('النصفي') || _getSheet('الدرجات');
    if (!sheet) return result;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 4 || lastCol < 5) return result;

    // الصف 2 = أسماء المواد، الصف 3 = هيدر (الكود/الاسم/الصف/الشعبة)، البيانات تبدأ من الصف 4
    var monthRow   = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var subjectRow = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
    var data       = sheet.getRange(4, 1, lastRow - 3, lastCol).getValues();

    // بناء فهرس الطلاب (الكود => row index)
    var studentIdx = {};
    for (var s = 0; s < myStudents.length; s++) {
      studentIdx[_safeStr(myStudents[s].code)] = true;
    }

    // أعمدة المواد التي يدرّسها المعلم
    var allowAllSubj = (mySubjects.indexOf('جميع المواد') !== -1);
    var subjectCols = {};
    for (var c = 4; c < lastCol; c++) {
      var subj = _safeStr(subjectRow[c]);
      if (!subj) continue;
      if (allowAllSubj || mySubjects.indexOf(subj) !== -1) {
        if (!subjectCols[subj]) subjectCols[subj] = [];
        subjectCols[subj].push(c);
      }
    }

    var subjStats = {};
    var totalSum = 0, totalCount = 0;

    for (var r = 0; r < data.length; r++) {
      var code = _safeStr(data[r][0]);
      if (!studentIdx[code]) continue;

      for (var subj in subjectCols) if (subjectCols.hasOwnProperty(subj)) {
        var cols = subjectCols[subj];
        var rowSum = 0, rowCount = 0;
        for (var ci = 0; ci < cols.length; ci++) {
          var v = data[r][cols[ci]];
          var n = _safeNum(v);
          if (n !== null && n >= 0) { rowSum += n; rowCount++; }
        }
        if (rowCount > 0) {
          if (!subjStats[subj]) subjStats[subj] = { sum: 0, count: 0 };
          subjStats[subj].sum   += rowSum;
          subjStats[subj].count += rowCount;
          totalSum   += rowSum;
          totalCount += rowCount;
        }
      }
    }

    var bars = [];
    for (var sk in subjStats) if (subjStats.hasOwnProperty(sk)) {
      var avg = subjStats[sk].count > 0 ? subjStats[sk].sum / subjStats[sk].count : 0;
      bars.push({ label: sk, value: Math.round(avg * 10) / 10 });
    }
    bars.sort(function(a, b) { return b.value - a.value; });

    result.bySubject = bars;
    result.overall = totalCount > 0 ? Math.round((totalSum / totalCount) * 10) / 10 : 0;
  } catch (e) {
    Logger.log('_reports_avgGradesForTeacher error: ' + e.toString());
  }
  return result;
}

// ══════════════════════════════════════════════════════
//  عدد الحصص الأسبوعية للمعلم (إن وُجدت ورقة جدول)
// ══════════════════════════════════════════════════════

function _reports_countWeeklyPeriods(teacherName) {
  try {
    var t = _safeStr(teacherName);
    if (!t) return 0;
    // محاولة قراءة من ورقة "الجدول" إن وُجدت في نفس الملف
    var sheet = _getSheet('الجدول');
    if (!sheet) return 0;
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) return 0;
    var headers = values[0].map(function(h) { return _safeStr(h); });
    var teacherCol = headers.indexOf('المعلم');
    if (teacherCol === -1) teacherCol = headers.indexOf('اسم المدرس');
    if (teacherCol === -1) return 0;

    var count = 0;
    for (var r = 1; r < values.length; r++) {
      if (_safeStr(values[r][teacherCol]) === t) count++;
    }
    return count;
  } catch (e) { return 0; }
}

// ══════════════════════════════════════════════════════
//  حضور — تقديري (إن لم تتوفر ورقة فالقيم 0)
// ══════════════════════════════════════════════════════

function _reports_calcOverallAttendance() {
  try {
    var sheet = _getSheet('الغياب');
    if (!sheet) return 0;
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) return 0;
    var headers = values[0].map(function(h) { return _safeStr(h); });
    var statusCol = headers.indexOf('الحالة');
    if (statusCol === -1) return 0;
    var present = 0, total = 0;
    for (var i = 1; i < values.length; i++) {
      var st = _safeStr(values[i][statusCol]);
      if (!st) continue;
      total++;
      if (st === 'حاضر' || st === 'متأخر') present++;
    }
    return total > 0 ? Math.round((present / total) * 1000) / 10 : 0; // %
  } catch (e) { return 0; }
}

function _reports_attendanceByClass() {
  try {
    var sheet = _getSheet('الغياب');
    if (!sheet) return [];
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) return [];
    var headers = values[0].map(function(h) { return _safeStr(h); });
    var classCol  = headers.indexOf('الفصل');
    var statusCol = headers.indexOf('الحالة');
    if (classCol === -1 || statusCol === -1) return [];

    var agg = {};
    for (var i = 1; i < values.length; i++) {
      var cls = _safeStr(values[i][classCol]);
      var st  = _safeStr(values[i][statusCol]);
      if (!cls || !st) continue;
      if (!agg[cls]) agg[cls] = { present: 0, total: 0 };
      agg[cls].total++;
      if (st === 'حاضر' || st === 'متأخر') agg[cls].present++;
    }
    var bars = [];
    for (var k in agg) if (agg.hasOwnProperty(k)) {
      var pct = agg[k].total > 0 ? (agg[k].present / agg[k].total) * 100 : 0;
      bars.push({ label: k, value: Math.round(pct * 10) / 10 });
    }
    bars.sort(function(a, b) { return b.value - a.value; });
    return bars;
  } catch (e) { return []; }
}

// ══════════════════════════════════════════════════════
//  وصف نطاق الجلسة للعرض
// ══════════════════════════════════════════════════════

function _reports_scopeLabel(session) {
  var role = session.role || 'teacher';
  if (role === 'admin')      return 'مدير النظام — رؤية شاملة لكل المنظومة';
  if (role === 'deputy')     return 'وكيل المدير — رؤية شاملة';
  if (role === 'supervisor') {
    var cls = (session.classes || []).join('، ');
    return 'مشرف — ' + (cls || 'فصول مخصصة');
  }
  // معلم
  var subj = (session.subjects || []).join('، ');
  var grd  = (session.classes  || []).join('، ');
  return 'معلم — ' + (subj || '') + ' • ' + (grd || '');
}