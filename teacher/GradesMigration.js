/* ═══════════════════════════════════════════════════════════════
 * Schema Diagnostic Tool — قراءة فقط
 * يفحص ورقة "النصفي" ويُخرج تقرير اختلال هيكلي شامل
 * لا يعدّل ولا ينسخ ولا ينشئ أي شيء
 * ═══════════════════════════════════════════════════════════════ */

var SCHEMA_DIAG_CONFIG = {
  SHEET_NAME       : 'النصفي',
  REGULAR_MONTHS   : ['محرم', 'صفر', 'جماد اول', 'جماد ثاني'],
  TERM_MONTHS      : ['نصف العام', 'نهاية العام'],
  EXPECTED_COLS_REG: 5,   // السلوك | الواجبات | الشفوي | التحريري | الإجمالي
  EXPECTED_COLS_TRM: 5,   // 3 فعّالة + 2 احتياطي
  REGULAR_LABELS   : ['السلوك', 'الواجبات', 'الشفوي', 'التحريري', 'الاجمالي'],
  TERM_LABELS_MONTHLY: ['اعمال مستمرة', 'الاعمال المستمرة', 'الأعمال المستمرة',
                        'الدرجة الشهرية', 'الشهري', 'المحصلة1', 'محصلة1',
                        'المحصلة', 'محصلة'],
  TERM_LABELS_EXAM   : ['درجة الاختبار', 'الاختبار', 'النصفي', 'النهائي',
                        'اختبار نصفي', 'اختبار نهائي', 'اختبار'],
  TERM_LABELS_TOTAL  : ['الاجمالي', 'اجمالي', 'المجموع', 'الكلي',
                        'المجموع النهائي']
};

/**
 * 🔬 الدالة الرئيسية للتشخيص الهيكلي
 * شغّلها من محرر Apps Script وانسخ المخرجات
 */
function diagnoseGradesSchema() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SCHEMA_DIAG_CONFIG.SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ ورقة "' + SCHEMA_DIAG_CONFIG.SHEET_NAME + '" غير موجودة');
    return { success: false, error: 'sheet_not_found' };
  }

  var report = {
    timestamp     : new Date().toLocaleString('ar-SA'),
    sheet         : SCHEMA_DIAG_CONFIG.SHEET_NAME,
    dimensions    : { rows: sheet.getLastRow(), cols: sheet.getLastColumn() },
    monthsDetected: [],
    perMonth      : {},   // تفاصيل لكل شهر
    subjectMatrix : {},   // مصفوفة Expected vs Actual للمواد
    issues        : { critical: [], warning: [], info: [] },
    riskLevel     : 'unknown',
    summary       : {}
  };

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 3, lastCol).getValues();
  var row1 = headers[0]; // الشهور
  var row2 = headers[1]; // المواد
  var row3 = headers[2]; // الأنواع

  // ── 1) كشف نطاقات الشهور ──
  var monthRanges = _detectMonthRanges(row1);
  for (var m in monthRanges) {
    report.monthsDetected.push({
      name    : m,
      startCol: monthRanges[m].start + 1,
      endCol  : monthRanges[m].end + 1,
      width   : monthRanges[m].end - monthRanges[m].start + 1
    });
  }

  // ── 2) فحص كل شهر تفصيلياً ──
  var allMonths = SCHEMA_DIAG_CONFIG.REGULAR_MONTHS.concat(SCHEMA_DIAG_CONFIG.TERM_MONTHS);
  for (var i = 0; i < allMonths.length; i++) {
    var monthName = allMonths[i];
    var isTerm = SCHEMA_DIAG_CONFIG.TERM_MONTHS.indexOf(monthName) !== -1;
    if (!monthRanges[monthName]) {
      report.issues.critical.push('🔴 الشهر "' + monthName + '" غير موجود في الورقة');
      report.perMonth[monthName] = { exists: false };
      continue;
    }
    report.perMonth[monthName] = _analyzeMonth(
      sheet, monthName, monthRanges[monthName], row2, row3, isTerm
    );
  }

  // ── 3) بناء مصفوفة Expected vs Actual للمواد ──
  report.subjectMatrix = _buildSubjectMatrix(report.perMonth);

  // ── 4) كشف المشاكل البنيوية ──
  _detectStructuralIssues(report);

  // ── 5) فحص العمودين الاحتياطيين (+3، +4) في شهور الفترات ──
  report.reserveColumnsAnalysis = _analyzeReserveColumns(sheet, report.perMonth);

  // ── 6) تحديد مستوى المخاطر ──
  report.riskLevel = _computeRiskLevel(report);

  // ── 7) الملخص التنفيذي ──
  report.summary = _buildSummary(report);

  // ── طباعة منظمة ──
  _printDiagnosticReport(report);

  return report;
}

/* ────────────────────────────────────────────────────────────── */
function _detectMonthRanges(row1) {
  var VALID = SCHEMA_DIAG_CONFIG.REGULAR_MONTHS.concat(SCHEMA_DIAG_CONFIG.TERM_MONTHS);
  var ranges = {};
  var currentMonth = '';
  var startIdx = -1;
  for (var i = 0; i < row1.length; i++) {
    var v = String(row1[i] || '').replace(/\s+/g, ' ').trim();
    var isValid = (VALID.indexOf(v) !== -1);
    if (isValid) {
      if (currentMonth && currentMonth !== v) {
        ranges[currentMonth] = { start: startIdx, end: i - 1 };
      }
      currentMonth = v;
      startIdx = i;
    } else if (v === '' && currentMonth) {
      // امتداد الشهر
    } else {
      if (currentMonth) {
        ranges[currentMonth] = { start: startIdx, end: i - 1 };
        currentMonth = '';
        startIdx = -1;
      }
    }
  }
  if (currentMonth) {
    ranges[currentMonth] = { start: startIdx, end: row1.length - 1 };
  }
  return ranges;
}

/* ────────────────────────────────────────────────────────────── */
function _analyzeMonth(sheet, monthName, range, row2, row3, isTerm) {
  var info = {
    exists      : true,
    startCol    : range.start + 1,
    endCol      : range.end + 1,
    width       : range.end - range.start + 1,
    isTerm      : isTerm,
    expectedColsPerSubject: isTerm
      ? SCHEMA_DIAG_CONFIG.EXPECTED_COLS_TRM
      : SCHEMA_DIAG_CONFIG.EXPECTED_COLS_REG,
    subjects    : [],
    irregular   : []
  };

  // تجميع المواد ضمن نطاق الشهر
  var i = range.start;
  while (i <= range.end) {
    var subjectName = String(row2[i] || '').replace(/\s+/g, ' ').trim();
    if (!subjectName) { i++; continue; }

    // عرض المادة = حتى اسم مادة جديد أو نهاية النطاق
    var subjectStart = i;
    var subjectEnd = i;
    for (var j = i + 1; j <= range.end; j++) {
      var nextSubject = String(row2[j] || '').replace(/\s+/g, ' ').trim();
      if (nextSubject && nextSubject !== subjectName) break;
      subjectEnd = j;
    }
    var width = subjectEnd - subjectStart + 1;

    // قراءة تسميات الصف 3 لهذه المادة
    var labels = [];
    for (var k = subjectStart; k <= subjectEnd; k++) {
      labels.push(String(row3[k] || '').replace(/\s+/g, ' ').trim());
    }

    var subjectEntry = {
      name        : subjectName,
      startCol    : subjectStart + 1,
      endCol      : subjectEnd + 1,
      actualWidth : width,
      expectedWidth: info.expectedColsPerSubject,
      labels      : labels,
      labelsAnalysis: _analyzeLabels(labels, isTerm),
      complies    : width === info.expectedColsPerSubject
    };

    if (!subjectEntry.complies) {
      info.irregular.push({
        subject       : subjectName,
        expectedWidth : info.expectedColsPerSubject,
        actualWidth   : width,
        startCol      : subjectStart + 1
      });
    }

    info.subjects.push(subjectEntry);
    i = subjectEnd + 1;
  }

  info.subjectCount = info.subjects.length;
  info.irregularCount = info.irregular.length;
  return info;
}

/* ────────────────────────────────────────────────────────────── */
function _analyzeLabels(labels, isTerm) {
  var result = {
    monthlyFound: -1,
    examFound   : -1,
    totalFound  : -1,
    regularFound: { behavior: -1, homework: -1, oral: -1, written: -1, total: -1 },
    unknownLabels: []
  };
  for (var i = 0; i < labels.length; i++) {
    var lbl = labels[i];
    if (!lbl) continue;
    if (isTerm) {
      if (SCHEMA_DIAG_CONFIG.TERM_LABELS_MONTHLY.indexOf(lbl) !== -1) {
        if (result.monthlyFound === -1) result.monthlyFound = i;
      } else if (SCHEMA_DIAG_CONFIG.TERM_LABELS_EXAM.indexOf(lbl) !== -1) {
        if (result.examFound === -1) result.examFound = i;
      } else if (SCHEMA_DIAG_CONFIG.TERM_LABELS_TOTAL.indexOf(lbl) !== -1) {
        if (result.totalFound === -1) result.totalFound = i;
      } else {
        result.unknownLabels.push({ index: i, label: lbl });
      }
    } else {
      if      (lbl === 'السلوك')   result.regularFound.behavior = i;
      else if (lbl === 'الواجبات') result.regularFound.homework = i;
      else if (lbl === 'الشفوي')   result.regularFound.oral = i;
      else if (lbl === 'التحريري') result.regularFound.written = i;
      else if (lbl === 'الاجمالي' || lbl === 'اجمالي') result.regularFound.total = i;
      else result.unknownLabels.push({ index: i, label: lbl });
    }
  }
  return result;
}

/* ────────────────────────────────────────────────────────────── */
function _buildSubjectMatrix(perMonth) {
  var matrix = {};
  var allMonths = [];
  for (var m in perMonth) {
    if (perMonth[m].exists && perMonth[m].subjects) {
      allMonths.push(m);
      for (var s = 0; s < perMonth[m].subjects.length; s++) {
        var sn = perMonth[m].subjects[s].name;
        if (!matrix[sn]) matrix[sn] = {};
        matrix[sn][m] = {
          present : true,
          width   : perMonth[m].subjects[s].actualWidth,
          complies: perMonth[m].subjects[s].complies
        };
      }
    }
  }
  // ملء الفجوات
  var allSubjects = [];
  for (var sub in matrix) allSubjects.push(sub);
  for (var a = 0; a < allSubjects.length; a++) {
    for (var b = 0; b < allMonths.length; b++) {
      if (!matrix[allSubjects[a]][allMonths[b]]) {
        matrix[allSubjects[a]][allMonths[b]] = { present: false };
      }
    }
  }
  return { months: allMonths, matrix: matrix };
}

/* ────────────────────────────────────────────────────────────── */
function _detectStructuralIssues(report) {
  for (var m in report.perMonth) {
    var info = report.perMonth[m];
    if (!info.exists) continue;

    // مواد لا تتبع 5 أعمدة
    if (info.irregularCount > 0) {
      for (var i = 0; i < info.irregular.length; i++) {
        var ir = info.irregular[i];
        report.issues.critical.push(
          '🔴 [' + m + '] المادة "' + ir.subject +
          '" عرضها ' + ir.actualWidth +
          ' بدل ' + ir.expectedWidth + ' (عمود ' + ir.startCol + ')'
        );
      }
    }

    // تسميات غير معروفة في الصف 3
    for (var s = 0; s < info.subjects.length; s++) {
      var subj = info.subjects[s];
      var unk = subj.labelsAnalysis.unknownLabels;
      for (var u = 0; u < unk.length; u++) {
        if (unk[u].label) {
          report.issues.warning.push(
            '🟡 [' + m + '/' + subj.name + '] تسمية غير معروفة: "' +
            unk[u].label + '" (موضع +' + unk[u].index + ')'
          );
        }
      }
    }

    // فحص اكتمال تسميات الفترات
    if (info.isTerm) {
      for (var t = 0; t < info.subjects.length; t++) {
        var ts = info.subjects[t];
        var la = ts.labelsAnalysis;
        if (la.monthlyFound === -1 && la.examFound === -1 && la.totalFound === -1) {
          report.issues.warning.push(
            '🟡 [' + m + '/' + ts.name + '] لا توجد أي تسمية معتمدة في الصف 3 — يعتمد على الترتيب الافتراضي'
          );
        }
      }
    }
  }

  // فحص المواد المفقودة عبر الشهور
  var matrix = report.subjectMatrix.matrix;
  var months = report.subjectMatrix.months;
  for (var sub in matrix) {
    var missingIn = [];
    for (var mi = 0; mi < months.length; mi++) {
      if (!matrix[sub][months[mi]].present) missingIn.push(months[mi]);
    }
    if (missingIn.length > 0 && missingIn.length < months.length) {
      report.issues.warning.push(
        '🟡 المادة "' + sub + '" مفقودة في: ' + missingIn.join('، ')
      );
    }
  }
}

/* ────────────────────────────────────────────────────────────── */
function _analyzeReserveColumns(sheet, perMonth) {
  var result = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 4) return result;

  var dataRows = lastRow - 3;
  var sampleRows = Math.min(dataRows, 500); // عينة 500 طالب كافية

  for (var m in perMonth) {
    var info = perMonth[m];
    if (!info.exists || !info.isTerm) continue;

    result[m] = { subjects: [] };
    for (var s = 0; s < info.subjects.length; s++) {
      var subj = info.subjects[s];
      if (subj.actualWidth < 5) continue;

      var col4 = subj.startCol + 3; // العمود الاحتياطي +3
      var col5 = subj.startCol + 4; // العمود الاحتياطي +4

      var data4 = sheet.getRange(4, col4, sampleRows, 1).getValues();
      var data5 = sheet.getRange(4, col5, sampleRows, 1).getValues();

      var nonEmpty4 = 0, nonEmpty5 = 0;
      for (var r = 0; r < data4.length; r++) {
        if (data4[r][0] !== '' && data4[r][0] !== null) nonEmpty4++;
        if (data5[r][0] !== '' && data5[r][0] !== null) nonEmpty5++;
      }

      result[m].subjects.push({
        subject  : subj.name,
        col4Used : nonEmpty4,
        col5Used : nonEmpty5,
        sampleSize: sampleRows,
        safe     : (nonEmpty4 === 0 && nonEmpty5 === 0)
      });
    }
  }
  return result;
}

/* ────────────────────────────────────────────────────────────── */
function _computeRiskLevel(report) {
  var c = report.issues.critical.length;
  var w = report.issues.warning.length;

  // فحص أمان الأعمدة الاحتياطية
  var reserveUnsafe = 0;
  for (var m in report.reserveColumnsAnalysis) {
    var subs = report.reserveColumnsAnalysis[m].subjects;
    for (var i = 0; i < subs.length; i++) {
      if (!subs[i].safe) reserveUnsafe++;
    }
  }

  if (c > 0 || reserveUnsafe > 0) return 'HIGH';
  if (w > 5) return 'MEDIUM';
  if (w > 0) return 'LOW';
  return 'NONE';
}

/* ────────────────────────────────────────────────────────────── */
function _buildSummary(report) {
  var totalSubjects = 0, irregularCount = 0;
  var monthsExisting = 0;
  for (var m in report.perMonth) {
    if (report.perMonth[m].exists) {
      monthsExisting++;
      totalSubjects += report.perMonth[m].subjectCount || 0;
      irregularCount += report.perMonth[m].irregularCount || 0;
    }
  }
  var uniqueSubjects = 0;
  for (var s in report.subjectMatrix.matrix) uniqueSubjects++;

  return {
    monthsExpected     : 6,
    monthsFound        : monthsExisting,
    uniqueSubjects     : uniqueSubjects,
    totalSubjectEntries: totalSubjects,
    irregularEntries   : irregularCount,
    criticalIssues     : report.issues.critical.length,
    warnings           : report.issues.warning.length
  };
}

/* ────────────────────────────────────────────────────────────── */
function _printDiagnosticReport(report) {
  Logger.log('\n╔════════════════════════════════════════════════════╗');
  Logger.log('║       📋 تقرير تشخيص Schema — قراءة فقط          ║');
  Logger.log('╚════════════════════════════════════════════════════╝');
  Logger.log('⏰ ' + report.timestamp);
  Logger.log('📁 الورقة: ' + report.sheet + ' (' + report.dimensions.rows + ' × ' + report.dimensions.cols + ')');

  Logger.log('\n📊 الملخص التنفيذي:');
  Logger.log('   - الشهور الموجودة: ' + report.summary.monthsFound + '/' + report.summary.monthsExpected);
  Logger.log('   - المواد الفريدة:   ' + report.summary.uniqueSubjects);
  Logger.log('   - إجمالي المواد ×الشهور: ' + report.summary.totalSubjectEntries);
  Logger.log('   - مواد غير منتظمة: ' + report.summary.irregularEntries);
  Logger.log('   - مشاكل حرجة:     ' + report.summary.criticalIssues);
  Logger.log('   - تحذيرات:        ' + report.summary.warnings);
  Logger.log('   - مستوى المخاطر:  ' + report.riskLevel);

  Logger.log('\n🗓️ تفاصيل الشهور:');
  for (var m in report.perMonth) {
    var info = report.perMonth[m];
    if (!info.exists) {
      Logger.log('   ❌ ' + m + ' — غير موجود');
      continue;
    }
    Logger.log('   📅 ' + m + ' (أعمدة ' + info.startCol + '–' + info.endCol +
               '، ' + info.subjectCount + ' مادة، شاذ: ' + info.irregularCount + ')');
  }

  Logger.log('\n🔬 العمودان الاحتياطيان (+3، +4) لشهور الفترات:');
  for (var rm in report.reserveColumnsAnalysis) {
    Logger.log('   📅 ' + rm + ':');
    var rsubs = report.reserveColumnsAnalysis[rm].subjects;
    var totalUnsafe = 0;
    for (var ri = 0; ri < rsubs.length; ri++) {
      if (!rsubs[ri].safe) {
        totalUnsafe++;
        Logger.log('      ⚠️ ' + rsubs[ri].subject +
                   ' — +3: ' + rsubs[ri].col4Used + ' خلية، +4: ' + rsubs[ri].col5Used + ' خلية');
      }
    }
    if (totalUnsafe === 0) {
      Logger.log('      ✅ كل الأعمدة الاحتياطية فارغة وآمنة للاستخدام');
    }
  }

  Logger.log('\n🔴 مشاكل حرجة (' + report.issues.critical.length + '):');
  for (var ci = 0; ci < report.issues.critical.length; ci++) {
    Logger.log('   ' + report.issues.critical[ci]);
  }
  if (report.issues.critical.length === 0) Logger.log('   ✅ لا توجد');

  Logger.log('\n🟡 تحذيرات (' + report.issues.warning.length + '):');
  var maxShow = Math.min(report.issues.warning.length, 20);
  for (var wi = 0; wi < maxShow; wi++) {
    Logger.log('   ' + report.issues.warning[wi]);
  }
  if (report.issues.warning.length > maxShow) {
    Logger.log('   ... و ' + (report.issues.warning.length - maxShow) + ' تحذير إضافي');
  }

  Logger.log('\n📋 مصفوفة المواد (Expected vs Actual):');
  var matrix = report.subjectMatrix.matrix;
  var monthsList = report.subjectMatrix.months;
  var header = '   المادة                          | ';
  for (var mh = 0; mh < monthsList.length; mh++) {
    header += monthsList[mh].substring(0, 8) + ' | ';
  }
  Logger.log(header);
  Logger.log('   ' + Array(header.length).join('-'));
  for (var sub in matrix) {
    var line = '   ' + (sub + '                              ').substring(0, 32) + '| ';
    for (var mm = 0; mm < monthsList.length; mm++) {
      var cell = matrix[sub][monthsList[mm]];
      if (!cell.present) line += '  ❌    | ';
      else if (!cell.complies) line += ' ⚠️(' + cell.width + ')  | ';
      else line += '  ✅    | ';
    }
    Logger.log(line);
  }

  Logger.log('\n╔════════════════════════════════════════════════════╗');
  Logger.log('║              نهاية التقرير                        ║');
  Logger.log('╚════════════════════════════════════════════════════╝');
}