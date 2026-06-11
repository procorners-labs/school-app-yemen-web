// ████████████████████████████████████████████████████████████
//  TeacherSchedule.gs — محرك توزيع الحصص الذكي v6.0
//  مدارس الإبداع والتميز الدولية
//  ES5 فقط — متعدد المدارس — التنسيق الجديد: "فصل (مادة)"
// ████████████████████████████████████████████████████████████

var DAYS_COUNT    = 5;
var PERIODS_COUNT = 7;
var DAY_NAMES     = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء'];

// ══════════════════════════════════════════════════════
//  نقاط الدخول
// ══════════════════════════════════════════════════════
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('📚 جدول الحصص')
    .addItem('🖥️ فتح لوحة التوزيع', 'showSidebar')
    .addSeparator()
    .addItem('🤖 توزيع تلقائي (استكمال)', 'autoDistributeAll')
    .addItem('📢 نشر الجدول للمنصتين', 'publishFromMenu')
    .addItem('📊 عرض الإحصائيات', 'showStats')
    .addToUi();
  safeExecute(function() {
    ensureScheduleSheetHas36Columns();
    populateClassesSheet();
    populateMaterialsAndClassesLists();
  });
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('TeacherScheduleManager')
    .setTitle('لوحة توزيع الحصص الذكية')
    .setWidth(1000);
  SpreadsheetApp.getUi().showSidebar(html);
}

function doGet(e) {
  var schoolId = (e && e.parameter && (e.parameter.schoolId || e.parameter.school)) || '';
  if (schoolId) { try { _setActiveTenant(schoolId); } catch (er) {} }
  return HtmlService.createHtmlOutputFromFile('TeacherScheduleManager')
    .setTitle('توزيع الحصص — مدارس الإبداع والتميز الدولية')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function safeExecute(func) {
  try { func(); } catch (e) { Logger.log('خطأ في safeExecute: ' + e.toString()); }
}

function publishFromMenu() {
  var props = PropertiesService.getScriptProperties();
  var schoolId = props.getProperty('SCHOOL_ID') || '';
  if (!schoolId) {
    SpreadsheetApp.getUi().alert('خطأ: لم يُعيَّن SCHOOL_ID في إعدادات النص البرمجي.');
    return;
  }
  try {
    var result = publishScheduleToPortals(schoolId);
    SpreadsheetApp.getUi().alert(result.message || 'تم النشر');
  } catch (e) {
    SpreadsheetApp.getUi().alert('خطأ في النشر: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════
//  الوصول إلى الأوراق
// ══════════════════════════════════════════════════════
function getSheetData() {
  var ss = SpreadsheetApp.openById(_activeFileId());
  var scheduleSheet = ss.getSheetByName('الجدول');
  var teachersSheet = ss.getSheetByName('المدرسين');
  var classesSheet  = ss.getSheetByName('الفصول');

  if (!scheduleSheet) scheduleSheet = ss.insertSheet('الجدول');
  if (!teachersSheet) teachersSheet = ss.insertSheet('المدرسين');
  if (!classesSheet)  classesSheet  = ss.insertSheet('الفصول');

  safeExecute(function() { ensureScheduleSheetHas36Columns(scheduleSheet); });

  if (scheduleSheet.getLastRow() === 0) {
    safeExecute(function() {
      var headers = ['المدرس'];
      var dn = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء'];
      for (var d = 0; d < 5; d++) {
        for (var p = 1; p <= 7; p++) headers.push(dn[d] + '-' + p);
      }
      scheduleSheet.getRange(1, 1, 1, 36).setValues([headers]);
      scheduleSheet.getRange(2, 1).setValue('--- صف المدرسين ---');
    });
  }

  if (teachersSheet.getLastColumn() < 8) {
    safeExecute(function() {
      teachersSheet.getRange(1, 7).setValue('قائمة المواد');
      teachersSheet.getRange(1, 8).setValue('قائمة الفصول');
    });
  }

  return {
    ss: ss,
    scheduleSheet: scheduleSheet,
    teachersSheet: teachersSheet,
    classesSheet: classesSheet
  };
}

function ensureScheduleSheetHas36Columns(sheet) {
  if (!sheet) sheet = getSheetData().scheduleSheet;
  var maxCols = sheet.getMaxColumns();
  if (maxCols < 36) sheet.insertColumns(maxCols + 1, 36 - maxCols);
}

function getColumnIndexForDayPeriod(dayIndex, periodIndex) {
  return 2 + (dayIndex * 7 + periodIndex);
}

// يحلّل قيمة الخلية: "9أ (رياضيات)" أو "9أ"
function parseCellValue(cellValue) {
  if (!cellValue || typeof cellValue !== 'string') return { className: null, subject: null };
  var match = cellValue.match(/^(.*?)\s*\((.*)\)$/);
  if (match) return { className: match[1].trim(), subject: match[2].trim() };
  return { className: cellValue.trim(), subject: null };
}

// ══════════════════════════════════════════════════════
//  إدارة قوائم المواد والفصول الرئيسية
// ══════════════════════════════════════════════════════
function getMaterialsListWithIds() {
  var data = getSheetData();
  var lastRow = data.teachersSheet.getLastRow();
  if (lastRow < 2) return [];
  try {
    var values = data.teachersSheet.getRange(2, 7, lastRow - 1, 1).getValues();
    var result = [], seen = {};
    for (var i = 0; i < values.length; i++) {
      var val = (values[i][0] || '').toString().trim();
      if (val && !seen[val]) { seen[val] = true; result.push({ id: i, name: val }); }
    }
    return result;
  } catch (e) { return []; }
}

function getClassesMasterListWithIds() {
  var data = getSheetData();
  var lastRow = data.teachersSheet.getLastRow();
  if (lastRow < 2) return [];
  try {
    var values = data.teachersSheet.getRange(2, 8, lastRow - 1, 1).getValues();
    var result = [], seen = {};
    for (var i = 0; i < values.length; i++) {
      var val = (values[i][0] || '').toString().trim();
      if (val && !seen[val]) { seen[val] = true; result.push({ id: i, name: val }); }
    }
    return result;
  } catch (e) { return []; }
}

function addMaterial(materialName) {
  var data = getSheetData();
  var material = materialName.toString().trim();
  if (!material) throw new Error('اسم المادة مطلوب');
  var existing = getMaterialsListWithIds().map(function(m) { return m.name; });
  for (var i = 0; i < existing.length; i++) {
    if (existing[i] === material) throw new Error('المادة موجودة بالفعل: ' + material);
  }
  var nextRow = data.teachersSheet.getLastRow() + 1;
  data.teachersSheet.getRange(nextRow, 7).setValue(material);
  return { success: true, message: 'تمت إضافة المادة: ' + material };
}

function updateMaterial(oldName, newName) {
  var data = getSheetData();
  var old = oldName.toString().trim();
  var newVal = newName.toString().trim();
  if (!old || !newVal) throw new Error('البيانات غير صالحة');
  var sheetData = data.teachersSheet.getDataRange().getValues();
  for (var i = 1; i < sheetData.length; i++) {
    if ((sheetData[i][6] || '').toString().trim() === old)
      data.teachersSheet.getRange(i + 1, 7).setValue(newVal);
    if ((sheetData[i][1] || '').toString().trim() === old)
      data.teachersSheet.getRange(i + 1, 2).setValue(newVal);
  }
  return { success: true, message: 'تم تحديث المادة: ' + old + ' → ' + newVal };
}

function deleteMaterial(materialName) {
  var data = getSheetData();
  var target = materialName.toString().trim();
  var sheetData = data.teachersSheet.getDataRange().getValues();
  for (var i = sheetData.length - 1; i >= 1; i--) {
    if ((sheetData[i][6] || '').toString().trim() === target)
      data.teachersSheet.deleteRow(i + 1);
  }
  return { success: true, message: 'تم حذف المادة: ' + target };
}

function addClassMaster(className) {
  var data = getSheetData();
  var newClass = className.toString().trim();
  if (!newClass) throw new Error('اسم الفصل مطلوب');
  var existing = getClassesMasterListWithIds().map(function(c) { return c.name; });
  for (var i = 0; i < existing.length; i++) {
    if (existing[i] === newClass) throw new Error('الفصل موجود بالفعل: ' + newClass);
  }
  var nextRow = data.teachersSheet.getLastRow() + 1;
  data.teachersSheet.getRange(nextRow, 8).setValue(newClass);
  return { success: true, message: 'تمت إضافة الفصل: ' + newClass };
}

function updateClassMaster(oldName, newName) {
  var data = getSheetData();
  var old = oldName.toString().trim();
  var newVal = newName.toString().trim();
  if (!old || !newVal) throw new Error('البيانات غير صالحة');
  var sheetData = data.teachersSheet.getDataRange().getValues();
  for (var i = 1; i < sheetData.length; i++) {
    if ((sheetData[i][7] || '').toString().trim() === old)
      data.teachersSheet.getRange(i + 1, 8).setValue(newVal);
    if ((sheetData[i][2] || '').toString().trim() === old)
      data.teachersSheet.getRange(i + 1, 3).setValue(newVal);
  }
  safeExecute(function() { populateClassesSheet(); });
  return { success: true, message: 'تم تحديث الفصل: ' + old + ' → ' + newVal };
}

function deleteClassMaster(className) {
  var data = getSheetData();
  var target = className.toString().trim();
  var sheetData = data.teachersSheet.getDataRange().getValues();
  for (var i = sheetData.length - 1; i >= 1; i--) {
    if ((sheetData[i][7] || '').toString().trim() === target)
      data.teachersSheet.deleteRow(i + 1);
  }
  safeExecute(function() { populateClassesSheet(); });
  return { success: true, message: 'تم حذف الفصل: ' + target };
}

function clearAllScheduleData() {
  var data = getSheetData();
  var lastRow = data.scheduleSheet.getLastRow();
  if (lastRow >= 3) data.scheduleSheet.getRange(3, 1, lastRow - 2, 36).clearContent();
  data.scheduleSheet.getRange(2, 1).setValue('--- صف المدرسين ---');
  safeExecute(function() { populateClassesSheet(); });
  return { success: true, message: 'تم حذف جميع بيانات الجدول' };
}

function populateMaterialsAndClassesLists() {
  var data = getSheetData();
  try {
    var sheetData = data.teachersSheet.getDataRange().getValues();
    var materialsSet = {}, classesSet = {};
    for (var i = 1; i < sheetData.length; i++) {
      var subject = (sheetData[i][1] || '').toString().trim();
      var className = (sheetData[i][2] || '').toString().trim();
      if (subject) materialsSet[subject] = true;
      if (className) classesSet[className] = true;
    }
    var materials = [], classes = [];
    for (var m in materialsSet) materials.push(m);
    for (var c in classesSet) classes.push(c);
    materials.sort(); classes.sort();

    var lastRow = Math.max(data.teachersSheet.getLastRow(), 2);
    if (lastRow >= 2) data.teachersSheet.getRange(2, 7, lastRow - 1, 2).clearContent();
    for (var mi = 0; mi < materials.length; mi++) data.teachersSheet.getRange(mi + 2, 7).setValue(materials[mi]);
    for (var ci = 0; ci < classes.length; ci++) data.teachersSheet.getRange(ci + 2, 8).setValue(classes[ci]);
  } catch (e) { Logger.log('populateMaterialsAndClassesLists: ' + e); }
}

// ══════════════════════════════════════════════════════
//  قراءة بيانات المدرسين والفصول
// ══════════════════════════════════════════════════════
function getTeachersList() {
  var data = getSheetData();
  try {
    var sheetData = data.teachersSheet.getDataRange().getValues();
    var teachers = {}, result = [];
    for (var i = 1; i < sheetData.length; i++) {
      var name = (sheetData[i][0] || '').toString().trim();
      if (name && !teachers[name]) { teachers[name] = true; result.push(name); }
    }
    return result;
  } catch (e) { return []; }
}

function getSubjectsAndClasses() {
  return {
    subjects: getMaterialsListWithIds().map(function(m) { return m.name; }),
    classes:  getClassesMasterListWithIds().map(function(c) { return c.name; })
  };
}

function getUniqueClassesList() {
  return getClassesMasterListWithIds().map(function(c) { return c.name; });
}

function getTeacherClassesRequired(teacherName) {
  var data = getSheetData();
  try {
    var sheetData = data.teachersSheet.getDataRange().getValues();
    var result = [];
    for (var i = 1; i < sheetData.length; i++) {
      var name     = (sheetData[i][0] || '').toString().trim();
      var subject  = (sheetData[i][1] || '').toString().trim();
      var className = (sheetData[i][2] || '').toString().trim();
      var hours    = Number(sheetData[i][3]);
      if (name === teacherName && className && hours) {
        result.push({
          name: className, subject: subject, required: hours,
          assigned: 0, key: className + '|' + subject
        });
      }
    }
    return result;
  } catch (e) { return []; }
}

function getTeacherAssignments(teacherName) {
  var data = getSheetData();
  try {
    var lastRow = data.scheduleSheet.getLastRow();
    if (lastRow < 3) return [];
    var allNames = data.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
    var teacherRow = -1;
    for (var i = 0; i < allNames.length; i++) {
      if (allNames[i][0] === teacherName) { teacherRow = i + 3; break; }
    }
    if (teacherRow === -1) return [];
    var rowData = data.scheduleSheet.getRange(teacherRow, 2, 1, 35).getValues()[0];
    var assignments = [];
    for (var day = 0; day < 5; day++) {
      for (var period = 0; period < 7; period++) {
        var cellVal = (rowData[day * 7 + period] || '').toString().trim();
        if (!cellVal) continue;
        var parsed = parseCellValue(cellVal);
        assignments.push({
          day: day, period: period,
          classCode: parsed.className,
          subject: parsed.subject,
          fullValue: cellVal
        });
      }
    }
    return assignments;
  } catch (e) { return []; }
}

function getTeacherDailyCount(assignments) {
  var daily = [0, 0, 0, 0, 0];
  for (var i = 0; i < assignments.length; i++) daily[assignments[i].day]++;
  return daily;
}

function getAllowedPerDay(teacherTotalPeriods) {
  return teacherTotalPeriods <= 5 ? 5 : 7;
}

function getTeacherScheduleData(teacherName) {
  try {
    var classesReq = getTeacherClassesRequired(teacherName);
    var existingAssignments = getTeacherAssignments(teacherName);
    var teacherTotal = 0;
    for (var ci = 0; ci < classesReq.length; ci++) teacherTotal += classesReq[ci].required;

    var assignedMap = {};
    for (var ai = 0; ai < existingAssignments.length; ai++) {
      var key = existingAssignments[ai].classCode + '|' + (existingAssignments[ai].subject || '');
      assignedMap[key] = (assignedMap[key] || 0) + 1;
    }

    var classesList = [];
    for (var cj = 0; cj < classesReq.length; cj++) {
      var r = classesReq[cj];
      var asgn = assignedMap[r.key] || 0;
      classesList.push({
        name: r.name, subject: r.subject, required: r.required,
        assigned: asgn, remaining: Math.max(0, r.required - asgn), key: r.key
      });
    }

    var teacherRowCells = [];
    for (var fi = 0; fi < 35; fi++) teacherRowCells.push('');
    for (var ej = 0; ej < existingAssignments.length; ej++) {
      var ea = existingAssignments[ej];
      teacherRowCells[ea.day * 7 + ea.period] = ea.fullValue;
    }

    return {
      days: DAY_NAMES,
      periods: [1, 2, 3, 4, 5, 6, 7],
      teacherRowCells: teacherRowCells,
      teacherDailyCount: getTeacherDailyCount(existingAssignments),
      allowedPerDay: getAllowedPerDay(teacherTotal),
      teacherTotalPeriods: teacherTotal,
      teacherAssignedTotal: existingAssignments.length,
      classesList: classesList
    };
  } catch (e) { return { error: e.toString() }; }
}

// ══════════════════════════════════════════════════════
//  نواقص الفصل
// ══════════════════════════════════════════════════════
function getDeficitDataForClass(className) {
  var data = getSheetData();
  var targetClass = className.toString().trim();
  try {
    var teachersData = data.teachersSheet.getDataRange().getValues();

    // بناء خريطة ما تم توزيعه فعلاً
    var distributionMap = {};
    var lastRow = data.scheduleSheet.getLastRow();
    if (lastRow >= 3) {
      var teacherNames = data.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
      for (var r = 0; r < teacherNames.length; r++) {
        var teacher = (teacherNames[r][0] || '').toString().trim();
        if (!teacher) continue;
        var rowValues = data.scheduleSheet.getRange(r + 3, 2, 1, 35).getValues()[0];
        for (var day = 0; day < 5; day++) {
          for (var period = 0; period < 7; period++) {
            var cellVal = (rowValues[day * 7 + period] || '').toString().trim();
            if (!cellVal) continue;
            var parsed = parseCellValue(cellVal);
            if (parsed.className === targetClass) {
              var mapKey = teacher + '|' + parsed.className + '|' + (parsed.subject || '');
              distributionMap[mapKey] = (distributionMap[mapKey] || 0) + 1;
            }
          }
        }
      }
    }

    var result = [];
    for (var i = 1; i < teachersData.length; i++) {
      var tName     = (teachersData[i][0] || '').toString().trim();
      var tSubject  = (teachersData[i][1] || '').toString().trim();
      var tClass    = (teachersData[i][2] || '').toString().trim();
      var required  = Number(teachersData[i][3]);
      if (!tName || !tSubject || !tClass || isNaN(required)) continue;
      if (tClass !== targetClass) continue;
      var dKey = tName + '|' + tClass + '|' + tSubject;
      var assigned = distributionMap[dKey] || 0;
      result.push({
        teacher: tName, subject: tSubject, className: tClass,
        required: required, assigned: assigned, remaining: required - assigned
      });
    }
    return result;
  } catch (e) { return []; }
}

// ══════════════════════════════════════════════════════
//  توزيع حصة يدوياً
// ══════════════════════════════════════════════════════
function assignPeriod(teacherName, className, subject, dayIdx, periodIdx) {
  var data = getSheetData();
  safeExecute(function() { ensureScheduleSheetHas36Columns(data.scheduleSheet); });

  var classKey   = className.toString().trim();
  var subjectKey = subject.toString().trim();
  var fullStoredValue = classKey + ' (' + subjectKey + ')';

  // تحقق من تعارض الفصل
  var classCheck = getClassScheduleInternal(className);
  var cellValue = classCheck.grid[dayIdx][periodIdx];
  if (cellValue && cellValue !== '-') {
    var parsed = parseCellValue(cellValue);
    if (parsed.className && parsed.className !== teacherName) {
      throw new Error('التعارض: الفصل ' + classKey + ' مشغول بمدرس آخر في هذا التوقيت');
    }
  }

  // تحقق من النصاب
  var classReqData = getTeacherClassesRequired(teacherName);
  var classReq = null;
  for (var ri = 0; ri < classReqData.length; ri++) {
    if (classReqData[ri].name === classKey && classReqData[ri].subject === subjectKey) {
      classReq = classReqData[ri]; break;
    }
  }
  if (!classReq) throw new Error('الفصل والمادة غير موجودين في جدول المدرس');

  var currentAssignments = getTeacherAssignments(teacherName);
  var assignedCount = 0;
  for (var ai = 0; ai < currentAssignments.length; ai++) {
    if (currentAssignments[ai].classCode === classKey && currentAssignments[ai].subject === subjectKey)
      assignedCount++;
  }
  if (assignedCount >= classReq.required)
    throw new Error('لا توجد حصص متبقية للمادة ' + subjectKey + ' في الفصل ' + classKey);

  // تعارض المدرس
  for (var bi = 0; bi < currentAssignments.length; bi++) {
    if (currentAssignments[bi].day === dayIdx && currentAssignments[bi].period === periodIdx)
      throw new Error('المدرس مشغول بحصة أخرى في نفس اليوم والحصة');
  }

  // الحد اليومي
  var teacherTotal = 0;
  for (var ci = 0; ci < classReqData.length; ci++) teacherTotal += classReqData[ci].required;
  var dailyCount = getTeacherDailyCount(currentAssignments);
  if (dailyCount[dayIdx] + 1 > getAllowedPerDay(teacherTotal))
    throw new Error('لا يمكن تجاوز الحد اليومي للمدرس');

  var teacherRow = getTeacherRowIndex(data.scheduleSheet, teacherName);
  if (teacherRow === -1) {
    var newRow = Math.max(3, data.scheduleSheet.getLastRow() + 1);
    data.scheduleSheet.getRange(newRow, 1).setValue(teacherName);
    teacherRow = newRow;
  }
  var colIndex = getColumnIndexForDayPeriod(dayIdx, periodIdx);
  var previousValue = data.scheduleSheet.getRange(teacherRow, colIndex).getValue();
  data.scheduleSheet.getRange(teacherRow, colIndex).setValue(fullStoredValue);

  try {
    PropertiesService.getScriptProperties().setProperty('lastUndo', JSON.stringify({
      teacherName: teacherName, dayIdx: dayIdx, periodIdx: periodIdx,
      previousValue: previousValue, fullValue: fullStoredValue
    }));
  } catch (e) {}

  safeExecute(function() { populateClassesSheet(); });
  return { success: true, message: 'تم توزيع ' + fullStoredValue + ' بنجاح' };
}

function getTeacherRowIndex(sheet, teacherName) {
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return -1;
    var names = sheet.getRange(3, 1, lastRow - 2, 1).getValues();
    for (var i = 0; i < names.length; i++) {
      if (names[i][0] === teacherName) return i + 3;
    }
    return -1;
  } catch (e) { return -1; }
}

// ══════════════════════════════════════════════════════
//  جدول الفصل
// ══════════════════════════════════════════════════════
function getClassScheduleInternal(className) {
  var data = getSheetData();
  var targetClass = className.toString().trim();
  var grid = [];
  for (var d = 0; d < 5; d++) {
    var row = [];
    for (var p = 0; p < 7; p++) row.push('-');
    grid.push(row);
  }
  try {
    var teacherSubjectForClass = {};
    var teachersData = data.teachersSheet.getDataRange().getValues();
    for (var i = 1; i < teachersData.length; i++) {
      var tName = (teachersData[i][0] || '').toString().trim();
      var tSubj = (teachersData[i][1] || '').toString().trim();
      var tCls  = (teachersData[i][2] || '').toString().trim();
      if (tName && tSubj && tCls) teacherSubjectForClass[tName + '_' + tCls] = tSubj;
    }
    var lastRow = data.scheduleSheet.getLastRow();
    if (lastRow >= 3) {
      var teacherNames = data.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
      for (var r = 0; r < teacherNames.length; r++) {
        var teacher = (teacherNames[r][0] || '').toString().trim();
        if (!teacher) continue;
        var rowValues = data.scheduleSheet.getRange(r + 3, 2, 1, 35).getValues()[0];
        for (var day = 0; day < 5; day++) {
          for (var period = 0; period < 7; period++) {
            var cellVal = (rowValues[day * 7 + period] || '').toString().trim();
            if (!cellVal) continue;
            var parsed = parseCellValue(cellVal);
            if (parsed.className === targetClass) {
              var subj = parsed.subject ||
                         teacherSubjectForClass[teacher + '_' + targetClass] ||
                         'مادة';
              grid[day][period] = teacher + ' (' + subj + ')';
            }
          }
        }
      }
    }
  } catch (e) {}
  return { grid: grid };
}

function getClassSchedule(className) {
  var result = getClassScheduleInternal(className);
  return { grid: result.grid, days: DAY_NAMES, periods: [1, 2, 3, 4, 5, 6, 7] };
}

// ══════════════════════════════════════════════════════
//  حذف وتراجع
// ══════════════════════════════════════════════════════
function findTeacherForClassSlot(className, dayIdx, periodIdx) {
  var data = getSheetData();
  var targetClass = className.toString().trim();
  try {
    var lastRow = data.scheduleSheet.getLastRow();
    if (lastRow < 3) return null;
    var teacherNames = data.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
    for (var r = 0; r < teacherNames.length; r++) {
      var teacher = (teacherNames[r][0] || '').toString().trim();
      if (!teacher) continue;
      var rowValues = data.scheduleSheet.getRange(r + 3, 2, 1, 35).getValues()[0];
      var cellVal = (rowValues[dayIdx * 7 + periodIdx] || '').toString().trim();
      if (!cellVal) continue;
      var parsed = parseCellValue(cellVal);
      if (parsed.className === targetClass) return teacher;
    }
  } catch (e) {}
  return null;
}

function deleteClassSession(className, dayIdx, periodIdx) {
  var teacherName = findTeacherForClassSlot(className, dayIdx, periodIdx);
  if (!teacherName) throw new Error('لم يتم العثور على المدرس المسؤول عن هذه الحصة');
  return deleteAssignment(teacherName, dayIdx, periodIdx);
}

function undoLastAssignment() {
  var props = PropertiesService.getScriptProperties();
  var lastUndoJson = props.getProperty('lastUndo');
  if (!lastUndoJson) throw new Error('لا توجد عملية سابقة للتراجع');
  var undoData = JSON.parse(lastUndoJson);
  var data = getSheetData();
  var teacherRow = getTeacherRowIndex(data.scheduleSheet, undoData.teacherName);
  if (teacherRow === -1) throw new Error('لم نجد صف المدرس');
  var colIndex = getColumnIndexForDayPeriod(undoData.dayIdx, undoData.periodIdx);
  var currentVal = data.scheduleSheet.getRange(teacherRow, colIndex).getValue();
  if (currentVal !== undoData.fullValue) throw new Error('تعذر التراجع: تغيرت البيانات');
  data.scheduleSheet.getRange(teacherRow, colIndex).setValue(undoData.previousValue || '');
  props.deleteProperty('lastUndo');
  safeExecute(function() { populateClassesSheet(); });
  return { success: true, message: 'تم التراجع عن حصة ' + undoData.fullValue };
}

function deleteAssignment(teacherName, dayIdx, periodIdx) {
  var data = getSheetData();
  var teacherRow = getTeacherRowIndex(data.scheduleSheet, teacherName);
  if (teacherRow === -1) throw new Error('لم نجد صف المدرس: ' + teacherName);
  var colIndex = getColumnIndexForDayPeriod(dayIdx, periodIdx);
  var currentVal = data.scheduleSheet.getRange(teacherRow, colIndex).getValue();
  if (!currentVal) throw new Error('لا توجد حصة في هذا التوقيت');
  data.scheduleSheet.getRange(teacherRow, colIndex).setValue('');
  safeExecute(function() { populateClassesSheet(); });
  return { success: true, message: 'تم حذف الحصة: ' + currentVal };
}

function resetTeacherSchedule(teacherName) {
  var data = getSheetData();
  var teacherRow = getTeacherRowIndex(data.scheduleSheet, teacherName);
  if (teacherRow !== -1) data.scheduleSheet.getRange(teacherRow, 2, 1, 35).clearContent();
  safeExecute(function() { populateClassesSheet(); });
  return { done: true };
}

function addTeacherRecord(teacherName, subject, className, periods) {
  var data = getSheetData();
  if (!teacherName || !subject || !className || !periods) throw new Error('جميع الحقول مطلوبة');
  var periodsNum = Number(periods);
  if (isNaN(periodsNum) || periodsNum <= 0) throw new Error('عدد الحصص يجب أن يكون رقماً موجباً');
  data.teachersSheet.appendRow([
    teacherName.toString().trim(), subject.toString().trim(),
    className.toString().trim(), periodsNum
  ]);
  safeExecute(function() { populateClassesSheet(); });
  return { success: true, message: 'تمت إضافة ' + teacherName + ' - ' + className + ' - ' + subject };
}

// ══════════════════════════════════════════════════════
//  ورقة الفصول
// ══════════════════════════════════════════════════════
function populateClassesSheet() {
  var data = getSheetData();
  try {
    var classesSet = {};
    var teachersData = data.teachersSheet.getDataRange().getValues();
    for (var i = 1; i < teachersData.length; i++) {
      var className = (teachersData[i][2] || '').toString().trim();
      if (className) classesSet[className] = true;
    }
    var allClasses = [];
    for (var c in classesSet) allClasses.push(c);
    allClasses.sort();

    // بناء خريطة الحصص
    var slotMap = {};
    var lastRow = data.scheduleSheet.getLastRow();
    if (lastRow >= 3) {
      var teacherNames = data.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
      for (var r = 0; r < teacherNames.length; r++) {
        var teacher = (teacherNames[r][0] || '').toString().trim();
        if (!teacher) continue;
        var rowValues = data.scheduleSheet.getRange(r + 3, 2, 1, 35).getValues()[0];
        for (var day = 0; day < 5; day++) {
          for (var period = 0; period < 7; period++) {
            var cellVal = (rowValues[day * 7 + period] || '').toString().trim();
            if (!cellVal) continue;
            var parsed = parseCellValue(cellVal);
            if (parsed.className) {
              slotMap[parsed.className + '_' + day + '_' + period] = {
                teacher: teacher, subject: parsed.subject
              };
            }
          }
        }
      }
    }

    var lastClassRow = data.classesSheet.getLastRow();
    if (lastClassRow >= 3) data.classesSheet.deleteRows(3, lastClassRow - 2);

    if (data.classesSheet.getLastRow() < 2) {
      data.classesSheet.getRange(1, 1).setValue('الايام');
      data.classesSheet.getRange(2, 1).setValue('اسماء الفصول');
      for (var dd = 0; dd < 5; dd++) {
        data.classesSheet.getRange(1, 2 + dd * 7).setValue(DAY_NAMES[dd]);
        for (var pp = 0; pp < 7; pp++) data.classesSheet.getRange(2, 2 + dd * 7 + pp).setValue(pp + 1);
      }
    }

    for (var cIdx = 0; cIdx < allClasses.length; cIdx++) {
      var clsName = allClasses[cIdx];
      var rowIndex = cIdx + 3;
      data.classesSheet.getRange(rowIndex, 1).setValue(clsName);
      for (var d2 = 0; d2 < 5; d2++) {
        for (var p2 = 0; p2 < 7; p2++) {
          var sKey = clsName + '_' + d2 + '_' + p2;
          var slotInfo = slotMap[sKey];
          var cellValue = '';
          if (slotInfo) {
            cellValue = slotInfo.subject
              ? slotInfo.teacher + '/' + slotInfo.subject
              : slotInfo.teacher;
          }
          data.classesSheet.getRange(rowIndex, 2 + (d2 * 7 + p2)).setValue(cellValue);
        }
      }
    }
    if (data.classesSheet.getLastRow() >= 1 && data.classesSheet.getLastColumn() >= 1) {
      data.classesSheet.getRange(1, 1, data.classesSheet.getLastRow(), 36)
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    }
  } catch (e) { Logger.log('populateClassesSheet error: ' + e); }
}

// ══════════════════════════════════════════════════════
//  إدارة سجلات المدرسين
// ══════════════════════════════════════════════════════
function getTeachersData() {
  var data = getSheetData();
  try {
    var sheetData = data.teachersSheet.getDataRange().getValues();
    var result = [];
    for (var i = 1; i < sheetData.length; i++) {
      result.push({
        rowIndex: i + 1,
        teacher: sheetData[i][0],
        subject: sheetData[i][1],
        className: sheetData[i][2],
        periods: sheetData[i][3]
      });
    }
    return result;
  } catch (e) { return []; }
}

function updateTeacherRow(rowIndex, teacher, subject, className, periods) {
  var data = getSheetData();
  data.teachersSheet.getRange(rowIndex, 1).setValue(teacher.toString().trim());
  data.teachersSheet.getRange(rowIndex, 2).setValue(subject.toString().trim());
  data.teachersSheet.getRange(rowIndex, 3).setValue(className.toString().trim());
  data.teachersSheet.getRange(rowIndex, 4).setValue(periods);
  safeExecute(function() { populateClassesSheet(); });
  return { success: true };
}

function deleteTeacherRow(rowIndex) {
  var data = getSheetData();
  data.teachersSheet.deleteRow(rowIndex);
  safeExecute(function() { populateClassesSheet(); });
  return { success: true };
}

function addTeacherRow(teacher, subject, className, periods) {
  var data = getSheetData();
  data.teachersSheet.appendRow([
    teacher.toString().trim(), subject.toString().trim(),
    className.toString().trim(), periods
  ]);
  safeExecute(function() { populateClassesSheet(); });
  return { success: true };
}

// ══════════════════════════════════════════════════════
//  تصدير الجداول بصيغة HTML
// ══════════════════════════════════════════════════════
function getScheduleSheetAsHTML() {
  var data = getSheetData();
  try {
    var sheetData = data.scheduleSheet.getDataRange().getValues();
    var html = '<table dir="rtl" style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:12px;">';
    for (var i = 0; i < sheetData.length; i++) {
      html += '<tr>';
      for (var j = 0; j < sheetData[i].length; j++) {
        var cell = sheetData[i][j] === undefined ? '' : sheetData[i][j];
        var tag = i === 0 ? 'th' : 'td';
        html += '<' + tag + ' style="border:1px solid #ccc;padding:6px;text-align:center;">' + cell + '</' + tag + '>';
      }
      html += '</tr>';
    }
    html += '</table>';
    return html;
  } catch (e) { return '<p>خطأ في إنشاء الجدول</p>'; }
}

function getClassesSheetAsHTML() {
  safeExecute(function() { populateClassesSheet(); });
  var data = getSheetData();
  try {
    var sheetData = data.classesSheet.getDataRange().getValues();
    var html = '<table dir="rtl" style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:12px;">';
    for (var i = 0; i < sheetData.length; i++) {
      html += '<tr>';
      for (var j = 0; j < sheetData[i].length; j++) {
        var cell = sheetData[i][j] === undefined ? '' : sheetData[i][j];
        var tag = (i === 0 || i === 1) ? 'th' : 'td';
        html += '<' + tag + ' style="border:1px solid #ccc;padding:6px;text-align:center;">' + cell + '</' + tag + '>';
      }
      html += '</tr>';
    }
    html += '</table>';
    return html;
  } catch (e) { return '<p>خطأ في إنشاء جدول الفصول</p>'; }
}

// ══════════════════════════════════════════════════════
//  الإحصائيات
// ══════════════════════════════════════════════════════
function getScheduleSystemStats() {
  var data = getSheetData();
  var totalTeachers = 0, totalClasses = 0, totalRequired = 0, totalAssigned = 0;
  try {
    if (data.teachersSheet) {
      var td = data.teachersSheet.getDataRange().getValues();
      var teacherSet = {}, classSet = {};
      for (var i = 1; i < td.length; i++) {
        if (td[i][0]) teacherSet[(td[i][0] || '').toString().trim()] = true;
        if (td[i][2]) classSet[(td[i][2] || '').toString().trim()] = true;
        totalRequired += Number(td[i][3]) || 0;
      }
      totalTeachers = Object.keys(teacherSet).length;
      totalClasses  = Object.keys(classSet).length;
    }
    if (data.scheduleSheet) {
      var lastRow = data.scheduleSheet.getLastRow();
      if (lastRow >= 3) {
        var tNames = data.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
        for (var r = 0; r < tNames.length; r++) {
          if (!tNames[r][0]) continue;
          var rv = data.scheduleSheet.getRange(r + 3, 2, 1, 35).getValues()[0];
          for (var c = 0; c < rv.length; c++) { if (rv[c] && rv[c].toString().trim()) totalAssigned++; }
        }
      }
    }
  } catch (e) {}
  var pct = totalRequired > 0 ? Math.round((totalAssigned / totalRequired) * 100) : 0;
  return {
    totalTeachers: totalTeachers, totalClasses: totalClasses,
    totalRequired: totalRequired, totalAssigned: totalAssigned, completionPct: pct
  };
}

function showStats() {
  var stats = getScheduleSystemStats();
  var msg = '📊 إحصائيات الجدول\n══════════════════\n' +
    '👨‍🏫 المعلمون: ' + stats.totalTeachers + '\n' +
    '🏫 الفصول: ' + stats.totalClasses + '\n' +
    '📌 الحصص الموزعة: ' + stats.totalAssigned + '\n' +
    '⏳ المطلوبة: ' + stats.totalRequired + '\n' +
    '✅ النسبة: ' + stats.completionPct + '%';
  SpreadsheetApp.getUi().alert('إحصائيات الجدول', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

function checkAllConflicts() {
  var data = getSheetData();
  var conflicts = [];
  try {
    var lastRow = data.scheduleSheet.getLastRow();
    if (lastRow < 3) return { ok: true, conflicts: [], count: 0 };
    var slotMap = {};
    var tNames = data.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
    for (var r = 0; r < tNames.length; r++) {
      var teacher = (tNames[r][0] || '').toString().trim();
      if (!teacher) continue;
      var rv = data.scheduleSheet.getRange(r + 3, 2, 1, 35).getValues()[0];
      for (var day = 0; day < 5; day++) {
        for (var period = 0; period < 7; period++) {
          var val = (rv[day * 7 + period] || '').toString().trim();
          if (!val) continue;
          var parsed = parseCellValue(val);
          if (!parsed.className) continue;
          var key = parsed.className + '_' + day + '_' + period;
          if (slotMap[key]) {
            conflicts.push({
              className: parsed.className, day: day, period: period,
              teacher1: slotMap[key], teacher2: teacher
            });
          } else slotMap[key] = teacher;
        }
      }
    }
  } catch (e) {}
  return { ok: conflicts.length === 0, conflicts: conflicts, count: conflicts.length };
}

// ══════════════════════════════════════════════════════
//  التوزيع التلقائي (استكمال — لا يمسح ما هو موزّع)
// ══════════════════════════════════════════════════════
function autoDistributeAll() {
  var data = getSheetData();
  if (!data.scheduleSheet || !data.teachersSheet) throw new Error('الأوراق المطلوبة غير موجودة');

  var teachersData = data.teachersSheet.getDataRange().getValues();
  var allRequests = [];
  for (var i = 1; i < teachersData.length; i++) {
    var teacher  = (teachersData[i][0] || '').toString().trim();
    var subject  = (teachersData[i][1] || '').toString().trim();
    var className = (teachersData[i][2] || '').toString().trim();
    var required = Number(teachersData[i][3]);
    if (teacher && subject && className && !isNaN(required) && required > 0)
      allRequests.push({ teacher: teacher, className: className, subject: subject, required: required });
  }

  // الحصص الموزّعة حالياً
  var assignedCountMap = {};
  var lastRow = data.scheduleSheet.getLastRow();
  if (lastRow >= 3) {
    var teacherNames = data.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
    for (var r = 0; r < teacherNames.length; r++) {
      var tName = (teacherNames[r][0] || '').toString().trim();
      if (!tName) continue;
      var rowValues = data.scheduleSheet.getRange(r + 3, 2, 1, 35).getValues()[0];
      for (var day = 0; day < 5; day++) {
        for (var period = 0; period < 7; period++) {
          var cellVal = (rowValues[day * 7 + period] || '').toString().trim();
          if (!cellVal) continue;
          var parsed = parseCellValue(cellVal);
          if (parsed.className && parsed.subject) {
            var aKey = tName + '|' + parsed.className + '|' + parsed.subject;
            assignedCountMap[aKey] = (assignedCountMap[aKey] || 0) + 1;
          }
        }
      }
    }
  }

  // الطلبات المتبقية فقط
  var requests = [];
  for (var ri = 0; ri < allRequests.length; ri++) {
    var req = allRequests[ri];
    var rKey = req.teacher + '|' + req.className + '|' + req.subject;
    var assigned = assignedCountMap[rKey] || 0;
    var remaining = req.required - assigned;
    if (remaining > 0)
      requests.push({ teacher: req.teacher, className: req.className, subject: req.subject, required: remaining });
  }

  if (requests.length === 0)
    return { success: true, message: 'لا توجد حصص متبقية لتوزيعها. جميع الحصص مكتملة.' };

  // إنشاء صفوف للمدرسين الجدد
  var uniqueTeachers = {};
  for (var ui = 0; ui < requests.length; ui++) uniqueTeachers[requests[ui].teacher] = true;
  for (var ut in uniqueTeachers) {
    if (getTeacherRowIndex(data.scheduleSheet, ut) === -1) {
      var newRow = Math.max(3, data.scheduleSheet.getLastRow() + 1);
      data.scheduleSheet.getRange(newRow, 1).setValue(ut);
    }
  }

  // هياكل بيانات التعارض
  var teacherBusy = {}, classBusy = {}, teacherDailyCount = {}, classPeriodUsage = {};
  for (var ti in uniqueTeachers) {
    var tBusy = [], tDaily = [];
    for (var d = 0; d < 5; d++) {
      tBusy.push([]); tDaily.push(0);
      for (var p = 0; p < 7; p++) tBusy[d].push(false);
    }
    teacherBusy[ti] = tBusy;
    teacherDailyCount[ti] = tDaily;
  }
  var allClasses = {};
  for (var qi = 0; qi < requests.length; qi++) allClasses[requests[qi].className] = true;
  for (var cls in allClasses) {
    var cBusy = [], cPeriod = [];
    for (var d2 = 0; d2 < 5; d2++) {
      cBusy.push([]);
      for (var p2 = 0; p2 < 7; p2++) cBusy[d2].push(false);
    }
    for (var p3 = 0; p3 < 7; p3++) cPeriod.push(0);
    classBusy[cls] = cBusy;
    classPeriodUsage[cls] = cPeriod;
  }

  // تعبئة الحجوزات الحالية (للمدرسين والفصول الموجودين)
  if (lastRow >= 3) {
    var tn2 = data.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
    for (var rr = 0; rr < tn2.length; rr++) {
      var tname2 = (tn2[rr][0] || '').toString().trim();
      if (!tname2) continue;
      var rv = data.scheduleSheet.getRange(rr + 3, 2, 1, 35).getValues()[0];
      for (var dd2 = 0; dd2 < 5; dd2++) {
        for (var pp2 = 0; pp2 < 7; pp2++) {
          var cv = (rv[dd2 * 7 + pp2] || '').toString().trim();
          if (!cv) continue;
          var pv = parseCellValue(cv);
          if (!pv.className) continue;
          if (teacherBusy[tname2]) { teacherBusy[tname2][dd2][pp2] = true; teacherDailyCount[tname2][dd2]++; }
          if (classBusy[pv.className]) { classBusy[pv.className][dd2][pp2] = true; classPeriodUsage[pv.className][pp2]++; }
        }
      }
    }
  }

  function canPlace(teacher, className, day, period) {
    if (!teacherBusy[teacher] || !classBusy[className]) return false;
    if (teacherBusy[teacher][day][period]) return false;
    if (classBusy[className][day][period]) return false;
    var origTotal = 0;
    for (var oi = 0; oi < allRequests.length; oi++) {
      if (allRequests[oi].teacher === teacher) origTotal += allRequests[oi].required;
    }
    if (teacherDailyCount[teacher][day] + 1 > getAllowedPerDay(origTotal)) return false;
    return true;
  }

  function place(teacher, className, subject, day, period) {
    teacherBusy[teacher][day][period] = true;
    classBusy[className][day][period] = true;
    teacherDailyCount[teacher][day]++;
    classPeriodUsage[className][period]++;
    var teacherRowNum = getTeacherRowIndex(data.scheduleSheet, teacher);
    if (teacherRowNum !== -1) {
      var colIdx = getColumnIndexForDayPeriod(day, period);
      data.scheduleSheet.getRange(teacherRowNum, colIdx).setValue(className + ' (' + subject + ')');
    }
  }

  requests.sort(function(a, b) { return b.required - a.required; });

  var totalDistributed = 0, failed = [];
  for (var rqi = 0; rqi < requests.length; rqi++) {
    var req2 = requests[rqi];
    for (var n = 0; n < req2.required; n++) {
      var possibleSlots = [];
      for (var sd = 0; sd < 5; sd++) {
        for (var sp = 0; sp < 7; sp++) {
          if (canPlace(req2.teacher, req2.className, sd, sp))
            possibleSlots.push({ day: sd, period: sp });
        }
      }
      if (possibleSlots.length === 0) {
        failed.push({ teacher: req2.teacher, className: req2.className, subject: req2.subject, remaining: req2.required - n });
        break;
      }
      var bestSlot = null, bestScore = -Infinity;
      for (var si = 0; si < possibleSlots.length; si++) {
        var sl = possibleSlots[si];
        var teacherDailyNow = teacherDailyCount[req2.teacher][sl.day];
        var classDailyNow = 0;
        for (var cd = 0; cd < 7; cd++) if (classBusy[req2.className][sl.day][cd]) classDailyNow++;
        var score = -teacherDailyNow * 10 - classDailyNow * 5 - classPeriodUsage[req2.className][sl.period] * 20;
        if (score > bestScore) { bestScore = score; bestSlot = sl; }
      }
      if (bestSlot) { place(req2.teacher, req2.className, req2.subject, bestSlot.day, bestSlot.period); totalDistributed++; }
      else { failed.push({ teacher: req2.teacher, className: req2.className, subject: req2.subject, remaining: req2.required - n }); break; }
    }
  }

  safeExecute(function() { populateClassesSheet(); });

  var message = 'تم توزيع ' + totalDistributed + ' حصة إضافية بنجاح.';
  if (failed.length > 0) {
    message += '\n⚠️ لم يتم توزيع ' + failed.length + ' طلب:\n';
    for (var fi = 0; fi < failed.length; fi++) {
      message += '• ' + failed[fi].teacher + ' / ' + failed[fi].className + ' / ' + failed[fi].subject +
                 ' : متبقي ' + failed[fi].remaining + '\n';
    }
  } else { message += '\n✅ تم توزيع جميع الحصص المتبقية بنجاح.'; }

  return { success: true, message: message, distributed: totalDistributed, failed: failed };
}

// للتوافق مع استدعاءات الواجهة القديمة
function autoDistributeProtected(params) {
  return autoDistributeAll();
}

// توزيع تلقائي لمعلم واحد فقط
function autoDistributeTeacher(params) {
  var teacherName = (params && (params.teacherName || params[0])) ? (params.teacherName || params[0]).toString().trim() : '';
  if (!teacherName) throw new Error('اسم المعلم مطلوب');

  var data = getSheetData();
  var teachersData = data.teachersSheet.getDataRange().getValues();
  var allRequests = [];
  for (var i = 1; i < teachersData.length; i++) {
    var t = (teachersData[i][0] || '').toString().trim();
    var s = (teachersData[i][1] || '').toString().trim();
    var c = (teachersData[i][2] || '').toString().trim();
    var req = Number(teachersData[i][3]);
    if (t === teacherName && s && c && !isNaN(req) && req > 0)
      allRequests.push({ teacher: t, className: c, subject: s, required: req });
  }
  if (allRequests.length === 0) return { success: false, message: 'لم يتم العثور على بيانات للمعلم: ' + teacherName };

  var assignedCountMap = {};
  var lastRow = data.scheduleSheet.getLastRow();
  if (lastRow >= 3) {
    var teacherNames = data.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
    for (var r = 0; r < teacherNames.length; r++) {
      var tName = (teacherNames[r][0] || '').toString().trim();
      if (!tName) continue;
      var rowValues = data.scheduleSheet.getRange(r + 3, 2, 1, 35).getValues()[0];
      for (var day = 0; day < 5; day++) {
        for (var period = 0; period < 7; period++) {
          var cellVal = (rowValues[day * 7 + period] || '').toString().trim();
          if (!cellVal) continue;
          var parsed = parseCellValue(cellVal);
          if (parsed.className && parsed.subject) {
            var aKey = tName + '|' + parsed.className + '|' + parsed.subject;
            assignedCountMap[aKey] = (assignedCountMap[aKey] || 0) + 1;
          }
        }
      }
    }
  }

  var requests = [];
  for (var ri = 0; ri < allRequests.length; ri++) {
    var req2 = allRequests[ri];
    var rKey = req2.teacher + '|' + req2.className + '|' + req2.subject;
    var remaining = req2.required - (assignedCountMap[rKey] || 0);
    if (remaining > 0) requests.push({ teacher: req2.teacher, className: req2.className, subject: req2.subject, required: remaining });
  }
  if (requests.length === 0) return { success: true, message: 'لا توجد حصص متبقية للمعلم ' + teacherName };

  if (getTeacherRowIndex(data.scheduleSheet, teacherName) === -1) {
    var newRow = Math.max(3, data.scheduleSheet.getLastRow() + 1);
    data.scheduleSheet.getRange(newRow, 1).setValue(teacherName);
  }

  // بناء خرائط التعارض
  var teacherBusy = [], teacherDailyCount = [];
  for (var d = 0; d < 5; d++) {
    teacherBusy.push([]); teacherDailyCount.push(0);
    for (var p = 0; p < 7; p++) teacherBusy[d].push(false);
  }
  var classBusy = {}, classPeriodUsage = {};
  for (var qi = 0; qi < requests.length; qi++) {
    var cls = requests[qi].className;
    if (!classBusy[cls]) {
      classBusy[cls] = [];
      classPeriodUsage[cls] = [0,0,0,0,0,0,0];
      for (var d2 = 0; d2 < 5; d2++) { classBusy[cls].push([]); for (var p2 = 0; p2 < 7; p2++) classBusy[cls][d2].push(false); }
    }
  }

  // تعبئة الحجوزات الحالية
  if (lastRow >= 3) {
    var tn2 = data.scheduleSheet.getRange(3, 1, lastRow - 2, 1).getValues();
    for (var rr = 0; rr < tn2.length; rr++) {
      var tname2 = (tn2[rr][0] || '').toString().trim();
      if (!tname2) continue;
      var rv = data.scheduleSheet.getRange(rr + 3, 2, 1, 35).getValues()[0];
      for (var dd2 = 0; dd2 < 5; dd2++) {
        for (var pp2 = 0; pp2 < 7; pp2++) {
          var cv = (rv[dd2 * 7 + pp2] || '').toString().trim();
          if (!cv) continue;
          var pv = parseCellValue(cv);
          if (tname2 === teacherName) { teacherBusy[dd2][pp2] = true; teacherDailyCount[dd2]++; }
          if (pv.className && classBusy[pv.className]) { classBusy[pv.className][dd2][pp2] = true; classPeriodUsage[pv.className][pp2]++; }
        }
      }
    }
  }

  var teacherTotal = 0;
  for (var oi = 0; oi < allRequests.length; oi++) teacherTotal += allRequests[oi].required;
  var maxPerDay = getAllowedPerDay(teacherTotal);

  function canPlace(className, day, period) {
    if (teacherBusy[day][period]) return false;
    if (classBusy[className] && classBusy[className][day][period]) return false;
    if (teacherDailyCount[day] + 1 > maxPerDay) return false;
    return true;
  }

  var totalDistributed = 0, failed = [];
  for (var rqi = 0; rqi < requests.length; rqi++) {
    var req3 = requests[rqi];
    for (var n = 0; n < req3.required; n++) {
      var bestSlot = null, bestScore = -Infinity;
      for (var sd = 0; sd < 5; sd++) {
        for (var sp = 0; sp < 7; sp++) {
          if (!canPlace(req3.className, sd, sp)) continue;
          var score = -teacherDailyCount[sd] * 10 - (classPeriodUsage[req3.className] ? classPeriodUsage[req3.className][sp] * 20 : 0);
          if (score > bestScore) { bestScore = score; bestSlot = { day: sd, period: sp }; }
        }
      }
      if (!bestSlot) { failed.push(req3); break; }
      teacherBusy[bestSlot.day][bestSlot.period] = true;
      teacherDailyCount[bestSlot.day]++;
      if (classBusy[req3.className]) classBusy[req3.className][bestSlot.day][bestSlot.period] = true;
      if (classPeriodUsage[req3.className]) classPeriodUsage[req3.className][bestSlot.period]++;
      var teacherRowNum = getTeacherRowIndex(data.scheduleSheet, teacherName);
      if (teacherRowNum !== -1) {
        data.scheduleSheet.getRange(teacherRowNum, getColumnIndexForDayPeriod(bestSlot.day, bestSlot.period))
          .setValue(req3.className + ' (' + req3.subject + ')');
        totalDistributed++;
      }
    }
  }

  safeExecute(function() { populateClassesSheet(); });
  var message = 'تم توزيع ' + totalDistributed + ' حصة للمعلم ' + teacherName;
  if (failed.length > 0) message += '\n⚠️ تعذّر توزيع ' + failed.length + ' طلب.';
  else message += '\n✅ جميع الحصص وُزِّعت بنجاح.';
  return { success: true, message: message };
}

// تُرجع نتيجة فحص التعارضات (اسم بديل مطلوب من الواجهة)
function getAllConflicts() {
  return checkAllConflicts();
}
