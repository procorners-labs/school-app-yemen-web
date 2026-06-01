// ████████████████████████████████████████████████████████████
//  TeacherSchedule.gs — محرك توزيع الحصص الذكي v5.0
//  مدارس الإبداع والتميز الدولية
//  ES5 فقط — توزيع تلقائي + اقتراحات + تحقق متكامل
// ████████████████████████████████████████████████████████████

// ══════════════════════════════════════════════════════
//  الثوابت والإعدادات
// ══════════════════════════════════════════════════════
var DAYS_COUNT    = 5;
var PERIODS_COUNT = 7;
var DAY_NAMES     = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء'];
var MAX_PERIODS_PER_DAY_LIGHT  = 5;  // معلم ≤5 حصص/أسبوع
var MAX_PERIODS_PER_DAY_HEAVY  = 7;  // معلم >5 حصص/أسبوع
var PREFERRED_MORNING_PERIODS  = [0,1,2]; // الحصص المفضلة صباحاً
var AVOID_CONSECUTIVE_SAME_CLASS = true;  // تجنب نفس الفصل يومين متتاليين

// ══════════════════════════════════════════════════════
//  نقاط الدخول
// ══════════════════════════════════════════════════════
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('📚 جدول الحصص')
    .addItem('🖥️ فتح لوحة التوزيع', 'showSidebar')
    .addSeparator()
    .addItem('🤖 توزيع تلقائي كامل', 'autoDistributeAll')
    .addItem('✅ التحقق من التعارضات', 'checkAllConflicts')
    .addItem('📊 عرض إحصائيات الجدول', 'showStats')
    .addSeparator()
    .addItem('🔄 تعبئة ورقة الفصول', 'populateClassesSheet')
    .addItem('🗑️ مسح الجدول كاملاً', 'clearAllSchedule')
    .addToUi();
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('TeacherScheduleManager')
    .setTitle('🎓 لوحة توزيع الحصص الذكية')
    .setWidth(1000);
  SpreadsheetApp.getUi().showSidebar(html);
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('TeacherScheduleManager')
    .setTitle('توزيع الحصص — مدارس الإبداع والتميز الدولية')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function showStats() {
  var stats = getScheduleSystemStats();
  var msg = '📊 إحصائيات الجدول\n' +
    '══════════════════\n' +
    '👨‍🏫 المعلمون: ' + stats.totalTeachers + '\n' +
    '🏫 الفصول: ' + stats.totalClasses + '\n' +
    '📌 الحصص الموزعة: ' + stats.totalAssigned + '\n' +
    '⏳ المطلوبة: ' + stats.totalRequired + '\n' +
    '✅ النسبة: ' + stats.completionPct + '%\n' +
    '⚠️ التعارضات: ' + (stats.conflicts || 0);
  SpreadsheetApp.getUi().alert('إحصائيات الجدول', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

function clearAllSchedule() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert('تحذير', 'هل تريد مسح الجدول كاملاً؟ لا يمكن التراجع!', ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  var sheets = _tsGetSheets();
  if (!sheets.scheduleSheet) { ui.alert('ورقة الجدول غير موجودة'); return; }
  var lastRow = sheets.scheduleSheet.getLastRow();
  if (lastRow >= 3) {
    var range = sheets.scheduleSheet.getRange(3, 2, lastRow - 2, 35);
    range.clearContent();
    range.setBackground(null);
    range.setFontColor(null);
    range.setFontWeight('normal');
    SpreadsheetApp.flush();
  }
  populateClassesSheet();
  ui.alert('✅ تم مسح الجدول بالكامل');
}

// ══════════════════════════════════════════════════════
//  أدوات مساعدة (ES5)
// ══════════════════════════════════════════════════════
function _tsStr(v) {
  if (v === null || v === undefined) return '';
  return v.toString().trim();
}
function _tsNum(v) {
  var n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

// ✅ تم تعديل _tsGetSheets لاستخدام الملف النشط ديناميكيًا
function _tsGetSheets() {
  var ss = SpreadsheetApp.openById(_activeFileId());
  return {
    ss           : ss,
    scheduleSheet: ss.getSheetByName('الجدول'),
    teachersSheet: ss.getSheetByName('المدرسين'),
    classesSheet : ss.getSheetByName('الفصول')
  };
}
function _tsGetColIndex(dayIndex, periodIndex) {
  return 2 + (dayIndex * 7 + periodIndex);
}

// ══════════════════════════════════════════════════════
//  قراءة الجدول دفعةً واحدة (Batch Read)
// ══════════════════════════════════════════════════════
function _tsBuildFullMatrix() {
  var sheets = _tsGetSheets();
  if (!sheets.scheduleSheet) return { names: [], matrix: [], lastRow: 0 };
  var lastRow = sheets.scheduleSheet.getLastRow();
  if (lastRow < 3) return { names: [], matrix: [], lastRow: lastRow };
  var allData = sheets.scheduleSheet.getRange(3, 1, lastRow - 2, 36).getValues();
  var names = [], matrix = [];
  for (var r = 0; r < allData.length; r++) {
    names.push(_tsStr(allData[r][0]));
    matrix.push(allData[r].slice(1));
  }
  return { names: names, matrix: matrix, lastRow: lastRow };
}

// خريطة الإشغال: key="day_period" → {classCode: teacherName}
function _tsBuildOccupancy(matrixData) {
  var occ = {};
  for (var r = 0; r < matrixData.names.length; r++) {
    var tName = matrixData.names[r];
    if (!tName) continue;
    for (var day = 0; day < DAYS_COUNT; day++) {
      for (var p = 0; p < PERIODS_COUNT; p++) {
        var val = _tsStr(matrixData.matrix[r][day * PERIODS_COUNT + p]);
        if (!val) continue;
        var key = day + '_' + p;
        if (!occ[key]) occ[key] = {};
        occ[key][val] = tName;
      }
    }
  }
  return occ;
}

// حصص معلم محدد من المصفوفة
function _tsTeacherAssignments(teacherName, matrixData) {
  var out = [];
  for (var r = 0; r < matrixData.names.length; r++) {
    if (matrixData.names[r] !== teacherName) continue;
    for (var day = 0; day < DAYS_COUNT; day++) {
      for (var p = 0; p < PERIODS_COUNT; p++) {
        var val = _tsStr(matrixData.matrix[r][day * PERIODS_COUNT + p]);
        if (val) out.push({ day: day, period: p, classCode: val });
      }
    }
    break;
  }
  return out;
}

// فهرس المعلم في المصفوفة (إنشاء صف جديد إن لزم)
function _tsGetOrCreateTeacherRow(teacherName, sheets) {
  var lastRow = sheets.scheduleSheet.getLastRow();
  if (lastRow < 2) return -1;
  var names = sheets.scheduleSheet.getRange(3, 1, Math.max(1, lastRow - 2), 1).getValues();
  for (var ni = 0; ni < names.length; ni++) {
    if (_tsStr(names[ni][0]) === teacherName) return ni + 3;
  }
  var newRow = Math.max(3, lastRow + 1);
  sheets.scheduleSheet.getRange(newRow, 1).setValue(teacherName);
  return newRow;
}

// ══════════════════════════════════════════════════════
//  قراءة نصاب المعلمين الكامل
// ══════════════════════════════════════════════════════
function _tsGetAllTeacherQuotas() {
  var sheets = _tsGetSheets();
  if (!sheets.teachersSheet) return {};
  var data   = sheets.teachersSheet.getDataRange().getValues();
  var quotas = {}; // teacherName → [{ className, subject, required }]

  for (var i = 1; i < data.length; i++) {
    var name = _tsStr(data[i][0]);
    if (!name) continue;
    if (!quotas[name]) quotas[name] = [];

    var cls1  = _tsStr(data[i][2]);
    var subj1 = _tsStr(data[i][1]);
    var hrs1  = _tsNum(data[i][3]);
    if (cls1 && hrs1 > 0) {
      var found1 = false;
      for (var qi = 0; qi < quotas[name].length; qi++) {
        if (quotas[name][qi].className === cls1 && quotas[name][qi].subject === subj1) {
          quotas[name][qi].required += hrs1; found1 = true; break;
        }
      }
      if (!found1) quotas[name].push({ className: cls1, subject: subj1, required: hrs1 });
    }

    var cls2  = _tsStr(data[i][7]);
    var subj2 = _tsStr(data[i][6]);
    if (cls2 && subj2) {
      var found2 = false;
      for (var qj = 0; qj < quotas[name].length; qj++) {
        if (quotas[name][qj].className === cls2 && quotas[name][qj].subject === subj2) {
          found2 = true; break;
        }
      }
      if (!found2) quotas[name].push({ className: cls2, subject: subj2, required: 1 });
    }
  }
  return quotas;
}

// ══════════════════════════════════════════════════════
//  دوال google.script.run — القائمة الكاملة
// ══════════════════════════════════════════════════════

function getTeachersList() {
  var sheets = _tsGetSheets();
  if (!sheets.teachersSheet) return [];
  var data = sheets.teachersSheet.getDataRange().getValues();
  var seen = {}, result = [];
  for (var i = 1; i < data.length; i++) {
    var name = _tsStr(data[i][0]);
    if (name && !seen[name]) { seen[name] = true; result.push(name); }
  }
  result.sort();
  return result;
}

function getSubjectsAndClasses() {
  var sheets = _tsGetSheets();
  if (!sheets.teachersSheet) return { subjects: [], classes: [] };
  var data = sheets.teachersSheet.getDataRange().getValues();
  var subSeen = {}, clsSeen = {}, subjects = [], classes = [];
  for (var i = 1; i < data.length; i++) {
    var s1 = _tsStr(data[i][1]), c1 = _tsStr(data[i][2]);
    var s2 = _tsStr(data[i][6]), c2 = _tsStr(data[i][7]);
    if (s1 && !subSeen[s1]) { subSeen[s1] = true; subjects.push(s1); }
    if (c1 && !clsSeen[c1]) { clsSeen[c1] = true; classes.push(c1); }
    if (s2 && !subSeen[s2]) { subSeen[s2] = true; subjects.push(s2); }
    if (c2 && !clsSeen[c2]) { clsSeen[c2] = true; classes.push(c2); }
  }
  subjects.sort(); classes.sort();
  return { subjects: subjects, classes: classes };
}

function getUniqueClassesList() {
  return getSubjectsAndClasses().classes;
}

function getTeacherClassesRequired(teacherName) {
  var quotas = _tsGetAllTeacherQuotas();
  return quotas[teacherName] || [];
}

// ══════════════════════════════════════════════════════
//  getTeacherScheduleData — البيانات الكاملة للواجهة
// ══════════════════════════════════════════════════════
function getTeacherScheduleData(teacherName) {
  try {
    var matrixData  = _tsBuildFullMatrix();
    var occupancy   = _tsBuildOccupancy(matrixData);
    var classesReq  = getTeacherClassesRequired(teacherName);
    var assignments = _tsTeacherAssignments(teacherName, matrixData);

    var teacherTotal = 0;
    for (var ci = 0; ci < classesReq.length; ci++) teacherTotal += classesReq[ci].required;

    var assignedMap = {};
    for (var ai = 0; ai < assignments.length; ai++) {
      var cc = assignments[ai].classCode;
      assignedMap[cc] = (assignedMap[cc] || 0) + 1;
    }

    var classesList = [];
    for (var cj = 0; cj < classesReq.length; cj++) {
      var cn = classesReq[cj].className || classesReq[cj].name;
      var req = classesReq[cj].required;
      var asgn = assignedMap[cn] || 0;
      classesList.push({
        name     : cn,
        subject  : classesReq[cj].subject,
        required : req,
        assigned : asgn,
        remaining: Math.max(0, req - asgn),
        complete : asgn >= req
      });
    }

    var teacherRowCells = [];
    for (var k = 0; k < 35; k++) teacherRowCells.push('');
    for (var aj = 0; aj < assignments.length; aj++) {
      teacherRowCells[assignments[aj].day * PERIODS_COUNT + assignments[aj].period] = assignments[aj].classCode;
    }

    var dailyCount = [0, 0, 0, 0, 0];
    for (var ak = 0; ak < assignments.length; ak++) dailyCount[assignments[ak].day]++;

    var allowedPerDay = teacherTotal <= MAX_PERIODS_PER_DAY_LIGHT
      ? MAX_PERIODS_PER_DAY_LIGHT : MAX_PERIODS_PER_DAY_HEAVY;

    var suggestions   = _tsSuggestSlotsAdvanced(classesList, assignments, occupancy, dailyCount, allowedPerDay);
    var conflicts     = _tsDetectTeacherConflicts(teacherName, assignments, occupancy);
    var dayDistrib    = _tsDayDistribution(assignments);

    return {
      days               : DAY_NAMES,
      periods            : [1,2,3,4,5,6,7],
      occupancyMap       : occupancy,
      teacherRowCells    : teacherRowCells,
      teacherDailyCount  : dailyCount,
      allowedPerDay      : allowedPerDay,
      teacherTotalPeriods: teacherTotal,
      teacherAssignedTotal: assignments.length,
      classesList        : classesList,
      suggestions        : suggestions,
      conflicts          : conflicts,
      dayDistribution    : dayDistrib
    };
  } catch (e) {
    Logger.log('getTeacherScheduleData error: ' + e.toString());
    return { error: e.toString() };
  }
}

// ══════════════════════════════════════════════════════
//  محرك الاقتراحات المتقدم
// ══════════════════════════════════════════════════════
function _tsSuggestSlotsAdvanced(classesList, assignments, occupancy, dailyCount, allowedPerDay) {
  var suggestions = [];
  var classPerDay = {}; // className → [days]
  for (var ai = 0; ai < assignments.length; ai++) {
    var cn = assignments[ai].classCode;
    if (!classPerDay[cn]) classPerDay[cn] = [];
    if (classPerDay[cn].indexOf(assignments[ai].day) === -1) {
      classPerDay[cn].push(assignments[ai].day);
    }
  }

  for (var ci = 0; ci < classesList.length; ci++) {
    var cls = classesList[ci];
    if (cls.remaining <= 0) continue;

    for (var day = 0; day < DAYS_COUNT; day++) {
      if (dailyCount[day] >= allowedPerDay) continue;

      for (var p = 0; p < PERIODS_COUNT; p++) {
        var key = day + '_' + p;

        var teacherBusy = false;
        for (var ti = 0; ti < assignments.length; ti++) {
          if (assignments[ti].day === day && assignments[ti].period === p) { teacherBusy = true; break; }
        }
        if (teacherBusy) continue;

        if (occupancy[key] && occupancy[key][cls.name]) continue;

        var score = 100;
        if (p <= 2) score += 25;
        else if (p <= 4) score += 10;
        else score -= 15;
        score -= dailyCount[day] * 12;
        if (AVOID_CONSECUTIVE_SAME_CLASS && classPerDay[cls.name]) {
          var prevDayUsed = classPerDay[cls.name].indexOf(day - 1) !== -1;
          var nextDayUsed = classPerDay[cls.name].indexOf(day + 1) !== -1;
          if (prevDayUsed || nextDayUsed) score -= 20;
        }
        var minDay = 99;
        for (var di = 0; di < dailyCount.length; di++) {
          if (dailyCount[di] < minDay) minDay = dailyCount[di];
        }
        if (dailyCount[day] === minDay) score += 15;

        suggestions.push({
          className: cls.name,
          subject  : cls.subject,
          day      : day,
          period   : p,
          dayName  : DAY_NAMES[day],
          periodNum: p + 1,
          score    : score,
          quality  : score >= 110 ? 'ممتاز' : (score >= 90 ? 'جيد' : (score >= 70 ? 'مقبول' : 'ضعيف'))
        });
        if (suggestions.length >= 30) break;
      }
      if (suggestions.length >= 30) break;
    }
  }

  suggestions.sort(function(a, b) { return b.score - a.score; });
  return suggestions.slice(0, 15);
}

// ══════════════════════════════════════════════════════
//  كشف التعارضات
// ══════════════════════════════════════════════════════
function _tsDetectTeacherConflicts(teacherName, assignments, occupancy) {
  var conflicts = [];
  var slotCount = {};
  for (var ai = 0; ai < assignments.length; ai++) {
    var slotKey = assignments[ai].day + '_' + assignments[ai].period;
    slotCount[slotKey] = (slotCount[slotKey] || 0) + 1;
    if (slotCount[slotKey] > 1) {
      conflicts.push({
        type   : 'teacher_double',
        message: 'المعلم لديه حصتان في نفس التوقيت: ' + DAY_NAMES[assignments[ai].day] + ' الحصة ' + (assignments[ai].period + 1),
        day    : assignments[ai].day,
        period : assignments[ai].period
      });
    }
  }
  return conflicts;
}

function checkAllConflicts() {
  var result = getAllConflicts();
  var ui     = SpreadsheetApp.getUi();
  if (result.total === 0) {
    ui.alert('✅ لا تعارضات', 'الجدول خالٍ من التعارضات!', ui.ButtonSet.OK);
  } else {
    var msg = '⚠️ تم اكتشاف ' + result.total + ' تعارض:\n\n';
    for (var i = 0; i < Math.min(result.conflicts.length, 10); i++) {
      msg += '• ' + result.conflicts[i].message + '\n';
    }
    if (result.conflicts.length > 10) msg += '... و ' + (result.conflicts.length - 10) + ' تعارض إضافي';
    ui.alert('تعارضات الجدول', msg, ui.ButtonSet.OK);
  }
}

function getAllConflicts() {
  var matrixData = _tsBuildFullMatrix();
  var conflicts  = [];
  var classSlots = {}; // classCode_day_period → teacherName
  for (var r = 0; r < matrixData.names.length; r++) {
    var tName = matrixData.names[r];
    if (!tName) continue;
    for (var day = 0; day < DAYS_COUNT; day++) {
      for (var p = 0; p < PERIODS_COUNT; p++) {
        var val = _tsStr(matrixData.matrix[r][day * PERIODS_COUNT + p]);
        if (!val) continue;
        var slotKey = val + '_' + day + '_' + p;
        if (classSlots[slotKey] && classSlots[slotKey] !== tName) {
          conflicts.push({
            type   : 'class_conflict',
            message: 'تعارض: الفصل ' + val + ' في ' + DAY_NAMES[day] + ' الحصة ' + (p+1) + ' → ' + classSlots[slotKey] + ' و ' + tName,
            classCode: val, day: day, period: p
          });
        } else {
          classSlots[slotKey] = tName;
        }
      }
    }
    var teacherSlots = {};
    for (var day2 = 0; day2 < DAYS_COUNT; day2++) {
      for (var p2 = 0; p2 < PERIODS_COUNT; p2++) {
        var val2 = _tsStr(matrixData.matrix[r][day2 * PERIODS_COUNT + p2]);
        if (!val2) continue;
        var tSlotKey = day2 + '_' + p2;
        if (teacherSlots[tSlotKey]) {
          conflicts.push({
            type   : 'teacher_conflict',
            message: 'تعارض: المعلم ' + tName + ' في ' + DAY_NAMES[day2] + ' الحصة ' + (p2+1) + ' في فصلين: ' + teacherSlots[tSlotKey] + ' و ' + val2,
            teacher: tName, day: day2, period: p2
          });
        } else {
          teacherSlots[tSlotKey] = val2;
        }
      }
    }
  }
  return { total: conflicts.length, conflicts: conflicts };
}

// ══════════════════════════════════════════════════════
//  توزيع يومي للمعلم
// ══════════════════════════════════════════════════════
function _tsDayDistribution(assignments) {
  var dist = {};
  for (var di = 0; di < DAYS_COUNT; di++) dist[DAY_NAMES[di]] = 0;
  for (var ai = 0; ai < assignments.length; ai++) {
    var dn = DAY_NAMES[assignments[ai].day];
    dist[dn] = (dist[dn] || 0) + 1;
  }
  return dist;
}

// ══════════════════════════════════════════════════════
//  التوزيع التلقائي الذكي الكامل
// ══════════════════════════════════════════════════════
function autoDistributeAll() {
  var ui   = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '🤖 التوزيع التلقائي',
    'سيقوم النظام بتوزيع الحصص تلقائياً لجميع المعلمين.\n' +
    '⚠️ سيُكمل الحصص الناقصة فقط، ولن يمسح ما هو موجود.\n\n' +
    'هل تريد المتابعة؟',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.ButtonSet.YES) return;

  var result = autoDistributeProtected({});
  var msg = result.success
    ? '✅ تم التوزيع بنجاح!\n' +
      'حصص جديدة: ' + result.newAssignments + '\n' +
      'معلمون منجزون: ' + result.completedTeachers + '\n' +
      'حصص متعذرة: ' + result.skipped
    : '❌ خطأ: ' + result.error;
  ui.alert('نتيجة التوزيع', msg, ui.ButtonSet.OK);
}

// autoDistributeProtected — تُستدعى من الواجهة أيضاً
function autoDistributeProtected(params) {
  try {
    var sheets      = _tsGetSheets();
    if (!sheets.scheduleSheet) return { success: false, error: 'ورقة الجدول غير موجودة' };

    var quotas      = _tsGetAllTeacherQuotas();
    var matrixData  = _tsBuildFullMatrix();
    var occupancy   = _tsBuildOccupancy(matrixData);

    var teacherAssignments = {};
    for (var r = 0; r < matrixData.names.length; r++) {
      var tName = matrixData.names[r];
      if (!tName) continue;
      teacherAssignments[tName] = _tsTeacherAssignments(tName, matrixData);
    }

    var newAssignments   = 0;
    var skipped          = 0;
    var completedTeachers = 0;
    var writeOps         = [];

    var teacherNames = [];
    for (var tn in quotas) teacherNames.push(tn);
    teacherNames.sort(function(a, b) {
      var totalA = 0, totalB = 0;
      for (var qi = 0; qi < quotas[a].length; qi++) totalA += quotas[a][qi].required;
      for (var qj = 0; qj < quotas[b].length; qj++) totalB += quotas[b][qj].required;
      return totalB - totalA;
    });

    for (var ti = 0; ti < teacherNames.length; ti++) {
      var teacherName = teacherNames[ti];
      var classList   = quotas[teacherName];
      if (!classList || classList.length === 0) continue;

      var assignments = teacherAssignments[teacherName] || [];
      var teacherTotal = 0;
      for (var ci2 = 0; ci2 < classList.length; ci2++) teacherTotal += classList[ci2].required;
      var perDayLimit = teacherTotal <= MAX_PERIODS_PER_DAY_LIGHT
        ? MAX_PERIODS_PER_DAY_LIGHT : MAX_PERIODS_PER_DAY_HEAVY;

      var teacherComplete = true;

      for (var ci = 0; ci < classList.length; ci++) {
        var cls    = classList[ci];
        var cn     = cls.className || cls.name;
        var needed = cls.required;

        var done = 0;
        for (var ai2 = 0; ai2 < assignments.length; ai2++) {
          if (assignments[ai2].classCode === cn) done++;
        }
        var remaining = needed - done;
        if (remaining <= 0) continue;

        teacherComplete = false;

        var dailyCount = [0,0,0,0,0];
        for (var ai3 = 0; ai3 < assignments.length; ai3++) dailyCount[assignments[ai3].day]++;

        for (var toAssign = 0; toAssign < remaining; toAssign++) {
          var bestSlot = _tsFindBestSlot(cn, assignments, occupancy, dailyCount, perDayLimit, classList);
          if (!bestSlot) { skipped++; break; }

          assignments.push({ day: bestSlot.day, period: bestSlot.period, classCode: cn });
          var slotKey = bestSlot.day + '_' + bestSlot.period;
          if (!occupancy[slotKey]) occupancy[slotKey] = {};
          occupancy[slotKey][cn] = teacherName;
          dailyCount[bestSlot.day]++;
          newAssignments++;

          writeOps.push({ teacher: teacherName, day: bestSlot.day, period: bestSlot.period, className: cn });
        }
      }

      teacherAssignments[teacherName] = assignments;
      if (teacherComplete) completedTeachers++;
    }

    if (writeOps.length > 0) {
      _tsBatchWrite(writeOps, sheets);
    }

    SpreadsheetApp.flush();
    populateClassesSheet();

    return {
      success          : true,
      newAssignments   : newAssignments,
      completedTeachers: completedTeachers,
      skipped          : skipped,
      message          : 'تم توزيع ' + newAssignments + ' حصة جديدة بنجاح'
    };
  } catch (e) {
    Logger.log('autoDistributeProtected error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// إيجاد أفضل خانة متاحة لمعلم وفصل
function _tsFindBestSlot(className, assignments, occupancy, dailyCount, perDayLimit, classList) {
  var bestSlot  = null;
  var bestScore = -9999;

  var classPerDay = [];
  for (var ai = 0; ai < assignments.length; ai++) {
    if (assignments[ai].classCode === className) {
      classPerDay.push(assignments[ai].day);
    }
  }

  for (var day = 0; day < DAYS_COUNT; day++) {
    if (dailyCount[day] >= perDayLimit) continue;

    for (var p = 0; p < PERIODS_COUNT; p++) {
      var key = day + '_' + p;

      var teacherBusy = false;
      for (var ti = 0; ti < assignments.length; ti++) {
        if (assignments[ti].day === day && assignments[ti].period === p) { teacherBusy = true; break; }
      }
      if (teacherBusy) continue;

      if (occupancy[key] && occupancy[key][className]) continue;

      var score = 100;
      if (p <= 1) score += 30;
      else if (p <= 3) score += 15;
      else if (p >= 5) score -= 20;
      score -= dailyCount[day] * 15;

      var dayUsed = false;
      for (var di = 0; di < classPerDay.length; di++) {
        if (classPerDay[di] === day) { score -= 40; break; }
        if (Math.abs(classPerDay[di] - day) === 1) { score -= 20; }
      }

      var minLoad = 99;
      for (var dmi = 0; dmi < dailyCount.length; dmi++) {
        if (dailyCount[dmi] < minLoad) minLoad = dailyCount[dmi];
      }
      if (dailyCount[day] === minLoad) score += 20;

      if (score > bestScore) {
        bestScore = score;
        bestSlot  = { day: day, period: p, score: score };
      }
    }
  }
  return bestSlot;
}

// كتابة دفعية للتعيينات
function _tsBatchWrite(writeOps, sheets) {
  var lastRow  = sheets.scheduleSheet.getLastRow();
  var rowMap   = {};

  if (lastRow >= 3) {
    var namesData = sheets.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
    for (var ni = 0; ni < namesData.length; ni++) {
      var n = _tsStr(namesData[ni][0]);
      if (n) rowMap[n] = ni + 3;
    }
  }

  var teacherOps = {}; // teacherName → [{col, value}]
  for (var wi = 0; wi < writeOps.length; wi++) {
    var op  = writeOps[wi];
    var col = _tsGetColIndex(op.day, op.period);
    if (!teacherOps[op.teacher]) teacherOps[op.teacher] = [];
    teacherOps[op.teacher].push({ col: col, value: op.className });
  }

  for (var tName in teacherOps) {
    if (!rowMap[tName]) {
      var newRow = Math.max(3, sheets.scheduleSheet.getLastRow() + 1);
      sheets.scheduleSheet.getRange(newRow, 1).setValue(tName);
      rowMap[tName] = newRow;
    }
    var tRow = rowMap[tName];
    var ops  = teacherOps[tName];
    for (var oi = 0; oi < ops.length; oi++) {
      sheets.scheduleSheet.getRange(tRow, ops[oi].col)
        .setValue(ops[oi].value)
        .setBackground('#dbeafe')
        .setFontColor('#1e40af')
        .setFontWeight('bold');
    }
  }
}

// ══════════════════════════════════════════════════════
//  assignPeriod — تعيين حصة يدوياً
// ══════════════════════════════════════════════════════
function assignPeriod(teacherName, className, dayIdx, periodIdx) {
  try {
    var sheets      = _tsGetSheets();
    if (!sheets.scheduleSheet) return { success: false, error: 'ورقة الجدول غير موجودة' };
    var matrixData  = _tsBuildFullMatrix();
    var occupancy   = _tsBuildOccupancy(matrixData);
    var classesReq  = getTeacherClassesRequired(teacherName);
    var assignments = _tsTeacherAssignments(teacherName, matrixData);

    var classReq = null;
    for (var ci = 0; ci < classesReq.length; ci++) {
      var cn = classesReq[ci].className || classesReq[ci].name;
      if (cn === className) { classReq = classesReq[ci]; break; }
    }
    if (!classReq) return { success: false, error: 'الفصل "' + className + '" غير مُعيَّن لهذا المعلم' };

    var doneCount = 0;
    for (var ai = 0; ai < assignments.length; ai++) {
      if (assignments[ai].classCode === className) doneCount++;
    }
    if (doneCount >= classReq.required) {
      return { success: false, error: 'حصص الفصل "' + className + '" مكتملة (' + classReq.required + '/' + classReq.required + ')' };
    }

    var key = dayIdx + '_' + periodIdx;
    if (occupancy[key] && occupancy[key][className]) {
      return { success: false, error: 'تعارض: الفصل "' + className + '" مشغول مع "' + occupancy[key][className] + '"' };
    }

    for (var ak = 0; ak < assignments.length; ak++) {
      if (assignments[ak].day === dayIdx && assignments[ak].period === periodIdx) {
        return { success: false, error: 'تعارض: المعلم مشغول بحصة "' + assignments[ak].classCode + '" في هذا الوقت' };
      }
    }

    var dailyCount = [0,0,0,0,0];
    for (var aj = 0; aj < assignments.length; aj++) dailyCount[assignments[aj].day]++;
    var teacherTotal = 0;
    for (var cj = 0; cj < classesReq.length; cj++) teacherTotal += classesReq[cj].required;
    var perDayLimit = teacherTotal <= MAX_PERIODS_PER_DAY_LIGHT ? MAX_PERIODS_PER_DAY_LIGHT : MAX_PERIODS_PER_DAY_HEAVY;
    if (dailyCount[dayIdx] + 1 > perDayLimit) {
      return { success: false, error: 'تجاوز الحد اليومي (' + perDayLimit + ') في ' + DAY_NAMES[dayIdx] };
    }

    var teacherRow = _tsGetOrCreateTeacherRow(teacherName, sheets);
    if (teacherRow < 3) return { success: false, error: 'تعذر إيجاد صف المعلم' };
    var colIndex  = _tsGetColIndex(dayIdx, periodIdx);
    var prevValue = _tsStr(sheets.scheduleSheet.getRange(teacherRow, colIndex).getValue());

    sheets.scheduleSheet.getRange(teacherRow, colIndex)
      .setValue(className)
      .setBackground('#dbeafe')
      .setFontColor('#1e40af')
      .setFontWeight('bold');

    PropertiesService.getScriptProperties().setProperty('lastUndo', JSON.stringify({
      teacherName: teacherName, dayIdx: dayIdx, periodIdx: periodIdx,
      previousValue: prevValue, className: className, timestamp: new Date().getTime()
    }));

    SpreadsheetApp.flush();
    populateClassesSheet();
    return { success: true, message: 'تم توزيع "' + className + '" في ' + DAY_NAMES[dayIdx] + ' الحصة ' + (periodIdx + 1) };
  } catch (e) {
    Logger.log('assignPeriod error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ══════════════════════════════════════════════════════
//  التوزيع التلقائي لمعلم واحد
// ══════════════════════════════════════════════════════
function autoDistributeTeacher(params) {
  try {
    var teacherName = params && params.teacherName;
    if (!teacherName) return { success: false, error: 'اسم المعلم مطلوب' };

    var sheets     = _tsGetSheets();
    var quotas     = _tsGetAllTeacherQuotas();
    var classList  = quotas[teacherName];
    if (!classList || classList.length === 0) {
      return { success: false, error: 'لا توجد بيانات نصاب لهذا المعلم' };
    }

    var matrixData  = _tsBuildFullMatrix();
    var occupancy   = _tsBuildOccupancy(matrixData);
    var assignments = _tsTeacherAssignments(teacherName, matrixData);

    var teacherTotal = 0;
    for (var ci = 0; ci < classList.length; ci++) teacherTotal += classList[ci].required;
    var perDayLimit = teacherTotal <= MAX_PERIODS_PER_DAY_LIGHT ? MAX_PERIODS_PER_DAY_LIGHT : MAX_PERIODS_PER_DAY_HEAVY;

    var writeOps = [];
    var newCount  = 0, skipped = 0;

    for (var ci2 = 0; ci2 < classList.length; ci2++) {
      var cls = classList[ci2];
      var cn  = cls.className || cls.name;
      var done = 0;
      for (var ai = 0; ai < assignments.length; ai++) {
        if (assignments[ai].classCode === cn) done++;
      }
      var remaining = cls.required - done;
      if (remaining <= 0) continue;

      var dailyCount = [0,0,0,0,0];
      for (var ai2 = 0; ai2 < assignments.length; ai2++) dailyCount[assignments[ai2].day]++;

      for (var tr = 0; tr < remaining; tr++) {
        var bestSlot = _tsFindBestSlot(cn, assignments, occupancy, dailyCount, perDayLimit, classList);
        if (!bestSlot) { skipped++; continue; }
        assignments.push({ day: bestSlot.day, period: bestSlot.period, classCode: cn });
        var sk = bestSlot.day + '_' + bestSlot.period;
        if (!occupancy[sk]) occupancy[sk] = {};
        occupancy[sk][cn] = teacherName;
        dailyCount[bestSlot.day]++;
        newCount++;
        writeOps.push({ teacher: teacherName, day: bestSlot.day, period: bestSlot.period, className: cn });
      }
    }

    if (writeOps.length > 0) _tsBatchWrite(writeOps, sheets);
    SpreadsheetApp.flush();
    populateClassesSheet();

    return {
      success       : true,
      newAssignments: newCount,
      skipped       : skipped,
      message       : 'تم توزيع ' + newCount + ' حصة للمعلم "' + teacherName + '"' + (skipped > 0 ? ' (تعذر: ' + skipped + ')' : '')
    };
  } catch (e) {
    Logger.log('autoDistributeTeacher error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ══════════════════════════════════════════════════════
//  deleteAssignment، undoLastAssignment، resetTeacherSchedule
// ══════════════════════════════════════════════════════
function deleteAssignment(teacherName, dayIdx, periodIdx) {
  try {
    var sheets = _tsGetSheets();
    if (!sheets.scheduleSheet) return { success: false, error: 'ورقة الجدول غير موجودة' };
    var teacherRow = _tsGetOrCreateTeacherRow(teacherName, sheets);
    if (teacherRow < 3) return { success: false, error: 'لم يتم العثور على صف المعلم' };
    var colIndex = _tsGetColIndex(dayIdx, periodIdx);
    var curVal   = _tsStr(sheets.scheduleSheet.getRange(teacherRow, colIndex).getValue());
    if (!curVal) return { success: false, error: 'لا توجد حصة في هذا التوقيت' };
    sheets.scheduleSheet.getRange(teacherRow, colIndex)
      .setValue('').setBackground(null).setFontColor(null).setFontWeight('normal');
    SpreadsheetApp.flush();
    populateClassesSheet();
    return { success: true, message: 'تم حذف حصة "' + curVal + '"' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function undoLastAssignment() {
  try {
    var props = PropertiesService.getScriptProperties();
    var json  = props.getProperty('lastUndo');
    if (!json) return { success: false, error: 'لا توجد عملية للتراجع عنها' };
    var u      = JSON.parse(json);
    var sheets = _tsGetSheets();
    var tRow   = _tsGetOrCreateTeacherRow(u.teacherName, sheets);
    if (tRow < 3) return { success: false, error: 'لم يتم العثور على صف المعلم' };
    var colIndex = _tsGetColIndex(u.dayIdx, u.periodIdx);
    var curVal   = _tsStr(sheets.scheduleSheet.getRange(tRow, colIndex).getValue());
    if (curVal !== u.className) return { success: false, error: 'تعذر التراجع: تغيّرت البيانات' };
    var cell = sheets.scheduleSheet.getRange(tRow, colIndex);
    cell.setValue(u.previousValue || '');
    if (u.previousValue) {
      cell.setBackground('#dbeafe').setFontColor('#1e40af').setFontWeight('bold');
    } else {
      cell.setBackground(null).setFontColor(null).setFontWeight('normal');
    }
    props.deleteProperty('lastUndo');
    SpreadsheetApp.flush();
    populateClassesSheet();
    return { success: true, message: 'تم التراجع عن تعيين "' + u.className + '"' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function resetTeacherSchedule(teacherName) {
  try {
    var sheets = _tsGetSheets();
    var tRow   = _tsGetOrCreateTeacherRow(teacherName, sheets);
    if (tRow >= 3) {
      var range = sheets.scheduleSheet.getRange(tRow, 2, 1, 35);
      range.clearContent().setBackground(null).setFontColor(null).setFontWeight('normal');
      SpreadsheetApp.flush();
    }
    populateClassesSheet();
    return { success: true, message: 'تم مسح جدول "' + teacherName + '" بالكامل' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ══════════════════════════════════════════════════════
//  getClassSchedule — جدول فصل محدد
// ══════════════════════════════════════════════════════
function getClassSchedule(className) {
  try {
    var sheets       = _tsGetSheets();
    var matrixData   = _tsBuildFullMatrix();
    var teachersData = sheets.teachersSheet ? sheets.teachersSheet.getDataRange().getValues() : [];
    var tSubjMap = {}, subjReqs = {};
    for (var i = 1; i < teachersData.length; i++) {
      var t = _tsStr(teachersData[i][0]);
      var s1 = _tsStr(teachersData[i][1]), c1 = _tsStr(teachersData[i][2]), h1 = _tsNum(teachersData[i][3]);
      var s2 = _tsStr(teachersData[i][6]), c2 = _tsStr(teachersData[i][7]);
      if (c1 === className && t && s1) { tSubjMap[t] = s1; subjReqs[s1] = (subjReqs[s1] || 0) + h1; }
      if (c2 === className && t && s2) { tSubjMap[t] = s2; subjReqs[s2] = (subjReqs[s2] || 0) + 1; }
    }
    var grid = [], subjCounts = {};
    for (var d = 0; d < DAYS_COUNT; d++) grid.push(['','','','','','','']);
    for (var r = 0; r < matrixData.names.length; r++) {
      var tName = matrixData.names[r];
      if (!tName || !tSubjMap[tName]) continue;
      for (var day = 0; day < DAYS_COUNT; day++) {
        for (var p = 0; p < PERIODS_COUNT; p++) {
          var val = _tsStr(matrixData.matrix[r][day * PERIODS_COUNT + p]);
          if (val === className) {
            var subj = tSubjMap[tName];
            grid[day][p] = tName + ' / ' + subj;
            subjCounts[subj] = (subjCounts[subj] || 0) + 1;
          }
        }
      }
    }
    var requirements = [];
    for (var subj2 in subjReqs) {
      var req = subjReqs[subj2], done = subjCounts[subj2] || 0;
      requirements.push({ subject: subj2, required: req, actual: done, remaining: Math.max(0, req - done), complete: done >= req });
    }
    requirements.sort(function(a, b) { return b.remaining - a.remaining; });
    return { grid: grid, days: DAY_NAMES, periods: [1,2,3,4,5,6,7], requirements: requirements, className: className };
  } catch (e) {
    return { error: e.toString() };
  }
}

// ══════════════════════════════════════════════════════
//  populateClassesSheet — تعبئة ورقة الفصول (Batch)
// ══════════════════════════════════════════════════════
function populateClassesSheet() {
  try {
    var sheets = _tsGetSheets();
    if (!sheets.scheduleSheet || !sheets.teachersSheet || !sheets.classesSheet) {
      return { success: false, error: 'الأوراق المطلوبة غير موجودة' };
    }
    var teachersData = sheets.teachersSheet.getDataRange().getValues();
    var clsSeen = {}, allClasses = [];
    for (var i = 1; i < teachersData.length; i++) {
      var c1 = _tsStr(teachersData[i][2]), c2 = _tsStr(teachersData[i][7]);
      if (c1 && !clsSeen[c1]) { clsSeen[c1] = true; allClasses.push(c1); }
      if (c2 && !clsSeen[c2]) { clsSeen[c2] = true; allClasses.push(c2); }
    }
    allClasses.sort();
    var tSubjMap = {};
    for (var j = 1; j < teachersData.length; j++) {
      var t  = _tsStr(teachersData[j][0]);
      var s1 = _tsStr(teachersData[j][1]), c1 = _tsStr(teachersData[j][2]);
      var s2 = _tsStr(teachersData[j][6]), c2 = _tsStr(teachersData[j][7]);
      if (t && s1 && c1) tSubjMap[t + '_' + c1] = s1;
      if (t && s2 && c2) tSubjMap[t + '_' + c2] = s2;
    }
    var matrixData = _tsBuildFullMatrix();
    var slotMap = {};
    for (var r = 0; r < matrixData.names.length; r++) {
      var tName = matrixData.names[r];
      if (!tName) continue;
      for (var day = 0; day < DAYS_COUNT; day++) {
        for (var p = 0; p < PERIODS_COUNT; p++) {
          var val = _tsStr(matrixData.matrix[r][day * PERIODS_COUNT + p]);
          if (val) {
            var subj = tSubjMap[tName + '_' + val] || '';
            slotMap[val + '_' + day + '_' + p] = subj ? (tName + '/' + subj) : tName;
          }
        }
      }
    }
    var lastClassRow = sheets.classesSheet.getLastRow();
    if (lastClassRow >= 3) sheets.classesSheet.deleteRows(3, lastClassRow - 2);
    if (sheets.classesSheet.getLastRow() < 2) {
      sheets.classesSheet.getRange(1, 1).setValue('الايام');
      sheets.classesSheet.getRange(2, 1).setValue('اسماء الفصول');
      for (var d = 0; d < DAYS_COUNT; d++) {
        sheets.classesSheet.getRange(1, 2 + d * PERIODS_COUNT).setValue(DAY_NAMES[d]);
        for (var p2 = 0; p2 < PERIODS_COUNT; p2++) {
          sheets.classesSheet.getRange(2, 2 + d * PERIODS_COUNT + p2).setValue(p2 + 1);
        }
      }
    }
    if (allClasses.length > 0) {
      var writeData = [];
      for (var cIdx = 0; cIdx < allClasses.length; cIdx++) {
        var row = [allClasses[cIdx]];
        for (var dd = 0; dd < DAYS_COUNT; dd++) {
          for (var pp = 0; pp < PERIODS_COUNT; pp++) {
            row.push(slotMap[allClasses[cIdx] + '_' + dd + '_' + pp] || '');
          }
        }
        writeData.push(row);
      }
      sheets.classesSheet.getRange(3, 1, writeData.length, 36).setValues(writeData);
    }
    SpreadsheetApp.flush();
    return { success: true, classes: allClasses.length };
  } catch (e) {
    Logger.log('populateClassesSheet error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ══════════════════════════════════════════════════════
//  إدارة المعلمين (CRUD)
// ══════════════════════════════════════════════════════
function getTeachersData() {
  var sheets = _tsGetSheets();
  if (!sheets.teachersSheet) return [];
  var data = sheets.teachersSheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var name = _tsStr(data[i][0]);
    if (!name) continue;
    result.push({ rowIndex: i, teacher: name, subject: _tsStr(data[i][1]), className: _tsStr(data[i][2]), periods: _tsNum(data[i][3]) });
  }
  return result;
}
function addTeacherRow(teacher, subject, className, periods) {
  var sheets = _tsGetSheets();
  if (!sheets.teachersSheet) return { success: false, error: 'ورقة المدرسين غير موجودة' };
  if (!teacher || !subject || !className || !periods) return { success: false, error: 'جميع الحقول مطلوبة' };
  var n = _tsNum(periods);
  if (n <= 0) return { success: false, error: 'عدد الحصص يجب أن يكون موجباً' };
  sheets.teachersSheet.appendRow([teacher, subject, className, n]);
  populateClassesSheet();
  return { success: true, message: 'تمت الإضافة بنجاح' };
}
function updateTeacherRow(rowIndex, teacher, subject, className, periods) {
  var sheets = _tsGetSheets();
  if (!sheets.teachersSheet) return { success: false, error: 'ورقة المدرسين غير موجودة' };
  sheets.teachersSheet.getRange(_tsNum(rowIndex) + 1, 1, 1, 4).setValues([[teacher, subject, className, _tsNum(periods)]]);
  populateClassesSheet();
  return { success: true };
}
function deleteTeacherRow(rowIndex) {
  var sheets = _tsGetSheets();
  if (!sheets.teachersSheet) return { success: false, error: 'ورقة المدرسين غير موجودة' };
  sheets.teachersSheet.deleteRow(_tsNum(rowIndex) + 1);
  populateClassesSheet();
  return { success: true };
}

// ══════════════════════════════════════════════════════
//  إحصائيات النظام الكاملة
// ══════════════════════════════════════════════════════
function getScheduleSystemStats() {
  try {
    var sheets = _tsGetSheets();
    var teachersData = sheets.teachersSheet ? sheets.teachersSheet.getDataRange().getValues() : [];
    var matrixData   = _tsBuildFullMatrix();
    var quotas       = _tsGetAllTeacherQuotas();

    var totalRequired = 0, totalAssigned = 0;
    var uniqueTeachers = {}, uniqueClasses = {};

    for (var i = 1; i < teachersData.length; i++) {
      var t = _tsStr(teachersData[i][0]);
      var c1 = _tsStr(teachersData[i][2]), h = _tsNum(teachersData[i][3]);
      var c2 = _tsStr(teachersData[i][7]);
      if (t) uniqueTeachers[t] = true;
      if (c1) uniqueClasses[c1] = true;
      if (c2) uniqueClasses[c2] = true;
      totalRequired += h;
    }

    for (var r = 0; r < matrixData.matrix.length; r++) {
      for (var c = 0; c < 35; c++) {
        if (_tsStr(matrixData.matrix[r][c])) totalAssigned++;
      }
    }

    var tCount = 0; for (var k in uniqueTeachers) tCount++;
    var cCount = 0; for (var k2 in uniqueClasses) cCount++;

    var allProgress = [];
    for (var tn in quotas) {
      var tnQuotas = quotas[tn];
      var tnRequired = 0;
      for (var qi = 0; qi < tnQuotas.length; qi++) tnRequired += tnQuotas[qi].required;
      var tnAssigned = 0;
      for (var r2 = 0; r2 < matrixData.names.length; r2++) {
        if (matrixData.names[r2] !== tn) continue;
        for (var c3 = 0; c3 < 35; c3++) {
          if (_tsStr(matrixData.matrix[r2][c3])) tnAssigned++;
        }
        break;
      }
      allProgress.push({
        name     : tn,
        required : tnRequired,
        assigned : tnAssigned,
        remaining: Math.max(0, tnRequired - tnAssigned),
        pct      : tnRequired > 0 ? Math.round((tnAssigned / tnRequired) * 100) : 100,
        complete : tnAssigned >= tnRequired
      });
    }
    allProgress.sort(function(a, b) { return a.pct - b.pct; });

    var conflicts = getAllConflicts();

    return {
      totalTeachers : tCount,
      totalClasses  : cCount,
      totalRequired : totalRequired,
      totalAssigned : totalAssigned,
      totalRemaining: Math.max(0, totalRequired - totalAssigned),
      completionPct : totalRequired > 0 ? Math.round((totalAssigned / totalRequired) * 100) : 0,
      conflicts     : conflicts.total,
      allProgress   : allProgress
    };
  } catch (e) {
    Logger.log('getScheduleSystemStats error: ' + e.toString());
    return { error: e.toString() };
  }
}

// ══════════════════════════════════════════════════════
//  عرض HTML للجداول
// ══════════════════════════════════════════════════════
function getScheduleSheetAsHTML() {
  var sheets = _tsGetSheets();
  if (!sheets.scheduleSheet) return '<p>ورقة الجدول غير موجودة</p>';
  var teachersData = sheets.teachersSheet ? sheets.teachersSheet.getDataRange().getValues() : [];
  var tSubjMap = {};
  for (var i = 1; i < teachersData.length; i++) {
    var t = _tsStr(teachersData[i][0]), s = _tsStr(teachersData[i][1]), c = _tsStr(teachersData[i][2]);
    if (t && s && c) tSubjMap[t + '_' + c] = s;
  }
  var data = sheets.scheduleSheet.getDataRange().getValues();
  var html = '<table dir="rtl" style="border-collapse:collapse;width:100%;font-size:11px">';
  for (var r = 0; r < data.length; r++) {
    html += '<tr>';
    for (var c2 = 0; c2 < data[r].length; c2++) {
      var cell = _tsStr(data[r][c2]);
      var tag  = r < 2 ? 'th' : 'td';
      var bg   = r < 2 ? 'background:#4f46e5;color:#fff' : (cell ? 'background:#dbeafe;color:#1e40af' : (r%2===0?'background:#f8fafc':''));
      if (r >= 2 && c2 > 0 && cell) {
        var sj = tSubjMap[_tsStr(data[r][0]) + '_' + cell];
        if (sj) cell = cell + '\n' + sj;
      }
      html += '<' + tag + ' style="border:1px solid #e2e8f0;padding:5px;text-align:center;white-space:pre-line;' + bg + '">' + cell + '</' + tag + '>';
    }
    html += '</tr>';
  }
  return html + '</table>';
}

function getClassesSheetAsHTML() {
  populateClassesSheet();
  var sheets = _tsGetSheets();
  if (!sheets.classesSheet) return '<p>ورقة الفصول غير موجودة</p>';
  var data = sheets.classesSheet.getDataRange().getValues();
  var html = '<table dir="rtl" style="border-collapse:collapse;width:100%;font-size:11px">';
  for (var r = 0; r < data.length; r++) {
    html += '<tr>';
    for (var c = 0; c < data[r].length; c++) {
      var cell = _tsStr(data[r][c]);
      var tag  = r < 2 ? 'th' : 'td';
      var bg   = r < 2 ? 'background:#10b981;color:#fff' : (cell ? 'background:#d1fae5;color:#065f46' : (r%2===0?'background:#f0fdf4':''));
      html += '<' + tag + ' style="border:1px solid #e2e8f0;padding:5px;text-align:center;' + bg + '">' + cell + '</' + tag + '>';
    }
    html += '</tr>';
  }
  return html + '</table>';
}

// ── دالة التحقق ──
function testDalFunc() {
  var fns = ['getSubjectsAndClasses','getUniqueClassesList','getTeachersList','assignPeriod',
             'getTeacherScheduleData','populateClassesSheet','autoDistributeProtected',
             'autoDistributeTeacher','getAllConflicts','getScheduleSystemStats'];
  var allOk = true;
  for (var i = 0; i < fns.length; i++) {
    var t = typeof eval(fns[i]);
    Logger.log(fns[i] + ': ' + t);
    if (t !== 'function') allOk = false;
  }
  Logger.log(allOk ? '✅ جميع الدوال موجودة' : '❌ بعض الدوال مفقودة');
  return allOk ? 'OK' : 'FAIL';
}