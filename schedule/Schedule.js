// ============================================================
// Schedule.gs — مزامنة الجدول إلى منصة الطالب والمعلم
// ES5 فقط — متعدد المدارس
// ============================================================

// يدعم تنسيقَي التخزين:
//   "9أ"             → { className: "9أ",  subject: null }
//   "9أ (رياضيات)"  → { className: "9أ",  subject: "رياضيات" }
function _parseCellValue(cellValue) {
  if (!cellValue || typeof cellValue !== 'string') return { className: null, subject: null };
  var match = cellValue.trim().match(/^(.*?)\s*\((.*)\)$/);
  if (match) return { className: match[1].trim(), subject: match[2].trim() };
  return { className: cellValue.trim(), subject: null };
}

function _resolveClassName(raw) {
  if (!raw) return '';
  var classMap = {
    '12': 'الثالث ثانوي', '11': 'الثاني ثانوي', '10': 'الأول ثانوي',
    '9': 'التاسع', '8': 'الثامن', '7': 'السابع', '6': 'السادس',
    '5': 'الخامس', '4': 'الرابع', '3': 'الثالث', '2': 'الثاني',
    '1': 'الأول', 'KG2': 'KG2', 'KG1': 'KG1'
  };
  var cleaned = String(raw).trim();
  var match = cleaned.match(/^(\d{1,2}|KG[12])\s*([أ-يA-Ca-c]?)$/i);
  if (match) {
    var base = match[1].toUpperCase().replace(/\s/g, '');
    var mapped = classMap[base];
    if (mapped) return mapped;
  }
  return cleaned;
}

function _getSectionFromCode(raw) {
  if (!raw) return 'أ';
  var cleaned = String(raw).trim();
  var match = cleaned.match(/([أ-يA-Ca-c])$/);
  if (!match) return 'أ';
  var letter = match[1].toUpperCase();
  if (letter === 'A' || letter === 'أ') return 'أ';
  if (letter === 'B' || letter === 'ب') return 'ب';
  if (letter === 'C' || letter === 'ج') return 'ج';
  return 'أ';
}

/**
 * يحوّل بيانات ورقة الجدول إلى صفوف مسطّحة
 * [الفصل, الشعبة, اليوم, الحصة, المادة, المعلم, القاعة]
 */
function _extractScheduleRows() {
  var ss = SpreadsheetApp.openById(_activeFileId());
  var scheduleSheet = ss.getSheetByName('الجدول');
  var teachersSheet = ss.getSheetByName('المدرسين');
  if (!scheduleSheet || !teachersSheet) {
    throw new Error('ورقة "الجدول" أو "المدرسين" غير موجودة في ملف الجدول');
  }

  var tData = teachersSheet.getDataRange().getValues();

  // (معلم|فصل) → مادة — يُغطي تنسيقَي التخزين
  var subjectMap = {};
  for (var i = 1; i < tData.length; i++) {
    var t0 = (tData[i][0] || '').toString().trim();
    var t1 = (tData[i][1] || '').toString().trim();
    var t2 = (tData[i][2] || '').toString().trim();
    if (t0 && t1 && t2) subjectMap[t0 + '|' + t2] = t1;
    // دعم الأعمدة 7–8 (التنسيق القديم ذو عمودَي مادة/فصل)
    var t6 = (tData[i][6] || '').toString().trim();
    var t7 = (tData[i][7] || '').toString().trim();
    if (t0 && t6 && t7) subjectMap[t0 + '|' + t7] = t6;
  }

  // بناء قائمة الأسماء الرسمية لمطابقة الأسماء المختصرة
  var officialNames = [];
  var seenNames = {};
  for (var oi = 1; oi < tData.length; oi++) {
    var offName = (tData[oi][0] || '').toString().trim().replace(/\.$/, '');
    if (!offName || seenNames[offName]) continue;
    seenNames[offName] = true;
    var entry = { name: offName, keys: [offName] };
    var words = offName.split(/\s+/);
    for (var w = 0; w < words.length; w++) {
      if (words[w].length >= 2) entry.keys.push(words[w]);
    }
    officialNames.push(entry);
  }

  function resolveTeacherName(shortName) {
    if (!shortName) return '';
    var clean = shortName.replace(/\s+/g, ' ').trim();
    var searchWords = clean.split(/\s+/).filter(function(ww) { return ww.length >= 2; });
    if (searchWords.length === 0) return clean;
    var bestEntry = null, bestScore = 0;
    for (var ei = 0; ei < officialNames.length; ei++) {
      var entry = officialNames[ei], score = 0;
      for (var sw = 0; sw < searchWords.length; sw++) {
        var swl = searchWords[sw].toLowerCase();
        for (var ki = 0; ki < entry.keys.length; ki++) {
          var kl = entry.keys[ki].toLowerCase();
          if (kl === swl) score += 3;
          else if (kl.indexOf(swl) === 0) score += 2;
          else if (kl.indexOf(swl) !== -1) score += 1;
        }
      }
      if (score > bestScore) { bestScore = score; bestEntry = entry; }
    }
    if (bestEntry && bestScore >= 2) return bestEntry.name;
    return shortName;
  }

  var sData = scheduleSheet.getDataRange().getValues();
  var days = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء'];
  var rows = [];

  for (var r = 2; r < sData.length; r++) {
    var teacherShort = (sData[r][0] || '').toString().trim();
    if (!teacherShort) continue;
    var teacherOfficial = resolveTeacherName(teacherShort);

    for (var day = 0; day < 5; day++) {
      for (var period = 0; period < 7; period++) {
        var colIndex = 1 + (day * 7 + period);
        var rawCell = (sData[r][colIndex] || '').toString().trim();
        if (!rawCell) continue;

        var parsed = _parseCellValue(rawCell);
        var classCode = parsed.className;
        if (!classCode) continue;

        // المادة: من الخلية (التنسيق الجديد) أو من القاموس (التنسيق القديم)
        var subject = parsed.subject ||
                      subjectMap[teacherShort + '|' + classCode] ||
                      subjectMap[teacherOfficial + '|' + classCode] ||
                      'مادة غير محددة';

        rows.push([
          _resolveClassName(classCode),
          _getSectionFromCode(classCode),
          days[day],
          period + 1,
          subject,
          teacherOfficial,
          ''
        ]);
      }
    }
  }
  return rows;
}

// ────────────────────────────────────────────────────────────
//  تحديد ملفات المنصتين (يدعم الوضعين: مع schoolId أو بدونه)
// ────────────────────────────────────────────────────────────
// عند تمرير schoolId: متعدد المدارس عبر Master.
// بدون schoolId (وضع المدرسة الواحدة/الشريط الجانبي): يطابق ملف الجدول
//   النشط (المرتبط) مع صف المدرسة في Master لاستخراج ملفَي الطالب/المعلم.
function _resolvePortalTargets(schoolId) {
  if (schoolId) {
    _setActiveTenant(schoolId);
    return {
      studentFileId: _resolveTenantFileId(schoolId, 'student_file_id'),
      teacherFileId: _resolveTenantFileId(schoolId, 'teacher_file_id')
    };
  }

  // لا schoolId: طابق الملف النشط مع صف المدرسة في Master
  var activeId = _activeFileId();
  var ss = SpreadsheetApp.openById(MASTER_SS_ID);
  var sh = ss.getSheetByName('Schools');
  if (!sh) throw new Error('ورقة Schools غير موجودة في Master');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var scheduleId = (data[i][_SCHOOLS_COL.schedule_file_id] || '').toString().trim();
    if (scheduleId && scheduleId === activeId) {
      return {
        studentFileId: (data[i][_SCHOOLS_COL.student_file_id] || '').toString().trim(),
        teacherFileId: (data[i][_SCHOOLS_COL.teacher_file_id] || '').toString().trim()
      };
    }
  }
  throw new Error('تعذّر تحديد ملفات المنصتين تلقائياً. مرّر schoolId أو سجّل المدرسة في Master بنفس ملف الجدول.');
}

function _writeRowsToScheduleSheet(fileId, rows) {
  var file = SpreadsheetApp.openById(fileId);
  var sheet = file.getSheetByName('الجدول');
  if (!sheet) sheet = file.insertSheet('الجدول');
  else sheet.clearContents();
  sheet.getRange(1, 1, 1, 7).setValues([['الفصل','الشعبة','اليوم','الحصة','المادة','المعلم','القاعة']]);
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  SpreadsheetApp.flush();
}

// ────────────────────────────────────────────────────────────
//  مزامنة إلى ملف الطالب
// ────────────────────────────────────────────────────────────
function syncScheduleToStudentFile(schoolId) {
  var targets = _resolvePortalTargets(schoolId);
  if (!targets.studentFileId) throw new Error('ملف الطالب غير مُهيّأ في Master');
  var rows = _extractScheduleRows();
  _writeRowsToScheduleSheet(targets.studentFileId, rows);
  Logger.log('✅ منصة الطالب: مزامنة ' + rows.length + ' حصة → ' + targets.studentFileId);
  return { ok: true, count: rows.length };
}

// ────────────────────────────────────────────────────────────
//  مزامنة إلى ملف المعلم
// ────────────────────────────────────────────────────────────
function syncScheduleToTeacherFile(schoolId) {
  var targets = _resolvePortalTargets(schoolId);
  if (!targets.teacherFileId) throw new Error('ملف المعلم غير مُهيّأ في Master');
  var rows = _extractScheduleRows();
  _writeRowsToScheduleSheet(targets.teacherFileId, rows);
  Logger.log('✅ منصة المعلم: مزامنة ' + rows.length + ' حصة → ' + targets.teacherFileId);
  return { ok: true, count: rows.length };
}

// ────────────────────────────────────────────────────────────
//  نشر الجدول للمنصتين (يُستدعى من الواجهة + من autoDistributeAll)
// ────────────────────────────────────────────────────────────
function publishScheduleToPortals(schoolId) {
  var targets = _resolvePortalTargets(schoolId);  // يُحدِّد الملفات + يضبط التينانت إن لزم
  var rows = _extractScheduleRows();

  var errors = [], studentCount = 0, teacherCount = 0;

  if (targets.studentFileId) {
    try { _writeRowsToScheduleSheet(targets.studentFileId, rows); studentCount = rows.length; }
    catch (e) { errors.push('منصة الطالب: ' + e.message); }
  } else {
    errors.push('منصة الطالب: الملف غير مُهيّأ في Master');
  }

  if (targets.teacherFileId) {
    try { _writeRowsToScheduleSheet(targets.teacherFileId, rows); teacherCount = rows.length; }
    catch (e) { errors.push('منصة المعلم: ' + e.message); }
  } else {
    errors.push('منصة المعلم: الملف غير مُهيّأ في Master');
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));

  return {
    ok: true,
    message: 'تم نشر الجدول بنجاح!\n' +
             '• منصة الطالب: ' + studentCount + ' حصة\n' +
             '• منصة المعلم: ' + teacherCount + ' حصة',
    studentCount: studentCount,
    teacherCount: teacherCount
  };
}
