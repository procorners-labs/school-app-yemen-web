/* ═══════════════════════════════════════════════════════════════
 * SchemaDiagnosticV2.gs
 * تشخيص يدعم الخلايا المدمجة (Merged Cells)
 * قراءة فقط - لا يعدّل أي شيء
 * ═══════════════════════════════════════════════════════════════ */

var SCHEMA_V2_CONFIG = {
  SHEET_NAME       : 'النصفي',
  REGULAR_MONTHS   : ['محرم', 'صفر', 'جماد اول', 'جماد ثاني'],
  TERM_MONTHS      : ['نصف العام', 'نهاية العام'],
  EXPECTED_COLS_REG: 5,
  EXPECTED_COLS_TRM: 5
};

/**
 * 🔬 التشخيص V2 — يبني صفوف الترويسة بعد فك دمج المعلومات
 */
function diagnoseGradesSchemaV2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SCHEMA_V2_CONFIG.SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ ورقة "' + SCHEMA_V2_CONFIG.SHEET_NAME + '" غير موجودة');
    return { success: false };
  }

  var lastCol = sheet.getLastColumn();
  var report = {
    timestamp : new Date().toLocaleString('ar-SA'),
    sheet     : SCHEMA_V2_CONFIG.SHEET_NAME,
    dimensions: { rows: sheet.getLastRow(), cols: lastCol }
  };

  // ── خطوة 1: قراءة القيم الخام ──
  var rawHeaders = sheet.getRange(1, 1, 3, lastCol).getValues();
  var row1Raw = rawHeaders[0]; // الشهور (قد تحوي merged)
  var row2Raw = rawHeaders[1]; // المواد (قد تحوي merged)
  var row3Raw = rawHeaders[2]; // الأنواع (عادة مستقلة)

  // ── خطوة 2: فك دمج الصف 1 (الشهور) ──
  var row1Filled = _unmergeRowByValues(sheet, 1, lastCol, row1Raw);

  // ── خطوة 3: فك دمج الصف 2 (المواد) ──
  var row2Filled = _unmergeRowByValues(sheet, 2, lastCol, row2Raw);

  // ── خطوة 4: تشخيص أولي ──
  Logger.log('\n🔍 الترويسة بعد فك الدمج (أول 80 عمود):');
  Logger.log('────────────────────────────────────────────────────');
  for (var c = 0; c < Math.min(lastCol, 80); c++) {
    var m = row1Filled[c] || '·';
    var s = row2Filled[c] || '·';
    var t = String(row3Raw[c] || '·').trim();
    Logger.log('   عمود ' + _pad(c + 1, 3) + ' | ' +
               _pad(m, 14) + ' | ' + _pad(s, 22) + ' | ' + t);
  }
  if (lastCol > 80) {
    Logger.log('   ... و ' + (lastCol - 80) + ' عمود إضافي (راجع التقرير الكامل)');
  }

  // ── خطوة 5: كشف نطاقات الشهور بعد الفك ──
  var monthRanges = {};
  var VALID = SCHEMA_V2_CONFIG.REGULAR_MONTHS.concat(SCHEMA_V2_CONFIG.TERM_MONTHS);
  for (var c2 = 0; c2 < lastCol; c2++) {
    var mn = String(row1Filled[c2] || '').trim();
    if (VALID.indexOf(mn) === -1) continue;
    if (!monthRanges[mn]) monthRanges[mn] = { start: c2, end: c2 };
    else monthRanges[mn].end = c2;
  }

  // ── خطوة 6: عرض النطاقات المُكتشفة ──
  Logger.log('\n📅 نطاقات الشهور المُكتشفة:');
  Logger.log('────────────────────────────────────────────────────');
  for (var mr in monthRanges) {
    var rng = monthRanges[mr];
    Logger.log('   ' + _pad(mr, 14) + ' | أعمدة ' + (rng.start + 1) +
               '-' + (rng.end + 1) + ' (عرض: ' + (rng.end - rng.start + 1) + ')');
  }

  // ── خطوة 7: تشخيص المواد داخل كل شهر ──
  Logger.log('\n📚 المواد داخل كل شهر:');
  Logger.log('────────────────────────────────────────────────────');
  var perMonth = {};
  for (var mn2 in monthRanges) {
    var rg = monthRanges[mn2];
    var isTerm = SCHEMA_V2_CONFIG.TERM_MONTHS.indexOf(mn2) !== -1;
    var subjects = _extractSubjectsInRange(row2Filled, row3Raw, rg, isTerm);
    perMonth[mn2] = {
      startCol     : rg.start + 1,
      endCol       : rg.end + 1,
      width        : rg.end - rg.start + 1,
      isTerm       : isTerm,
      subjectCount : subjects.length,
      subjects     : subjects,
      irregular    : []
    };

    Logger.log('\n   📅 ' + mn2 + ' (' + subjects.length + ' مادة):');
    for (var si = 0; si < subjects.length; si++) {
      var sj = subjects[si];
      var marker = sj.complies ? '✅' : '⚠️';
      var typesStr = sj.labels.join(' | ') || '(بلا تسميات)';
      Logger.log('      ' + marker + ' ' + _pad(sj.name, 22) +
                 ' | أعمدة ' + sj.startCol + '-' + sj.endCol +
                 ' (' + sj.actualWidth + ') | الأنواع: ' + typesStr);
      if (!sj.complies) {
        perMonth[mn2].irregular.push({
          subject       : sj.name,
          expectedWidth : isTerm ? 5 : 5,
          actualWidth   : sj.actualWidth,
          startCol      : sj.startCol
        });
      }
    }
  }

  // ── خطوة 8: بناء مصفوفة Expected vs Actual ──
  Logger.log('\n📋 مصفوفة Expected vs Actual:');
  Logger.log('────────────────────────────────────────────────────');
  var allSubjects = {};
  var monthsList = [];
  for (var pm in perMonth) {
    monthsList.push(pm);
    for (var sj2 = 0; sj2 < perMonth[pm].subjects.length; sj2++) {
      var sn = perMonth[pm].subjects[sj2].name;
      if (!allSubjects[sn]) allSubjects[sn] = {};
      allSubjects[sn][pm] = perMonth[pm].subjects[sj2];
    }
  }
  // طباعة الترويسة
  var headerLine = '   ' + _pad('المادة', 22) + ' |';
  for (var ml = 0; ml < monthsList.length; ml++) {
    headerLine += ' ' + _pad(monthsList[ml].substring(0, 9), 9) + ' |';
  }
  Logger.log(headerLine);
  Logger.log('   ' + Array(headerLine.length).join('-'));
  for (var subN in allSubjects) {
    var line = '   ' + _pad(subN, 22) + ' |';
    for (var ml2 = 0; ml2 < monthsList.length; ml2++) {
      var cell = allSubjects[subN][monthsList[ml2]];
      if (!cell) line += '    ❌    |';
      else if (!cell.complies) line += '   ⚠️(' + cell.actualWidth + ')   |';
      else line += '    ✅    |';
    }
    Logger.log(line);
  }

  // ── خطوة 9: العمودان الاحتياطيان (+3، +4) ──
  Logger.log('\n🔬 العمودان الاحتياطيان (+3، +4) في شهور الفترات:');
  Logger.log('────────────────────────────────────────────────────');
  var dataRows = Math.min(sheet.getLastRow() - 3, 500);
  for (var rmn in perMonth) {
    if (!perMonth[rmn].isTerm) continue;
    Logger.log('\n   📅 ' + rmn + ':');
    var unsafeCount = 0;
    var subjs = perMonth[rmn].subjects;
    for (var rsi = 0; rsi < subjs.length; rsi++) {
      var rsj = subjs[rsi];
      if (rsj.actualWidth < 5) continue;
      var col4 = rsj.startCol + 3;
      var col5 = rsj.startCol + 4;
      var d4 = sheet.getRange(4, col4, dataRows, 1).getValues();
      var d5 = sheet.getRange(4, col5, dataRows, 1).getValues();
      var n4 = 0, n5 = 0;
      for (var di = 0; di < d4.length; di++) {
        if (d4[di][0] !== '' && d4[di][0] !== null) n4++;
        if (d5[di][0] !== '' && d5[di][0] !== null) n5++;
      }
      if (n4 > 0 || n5 > 0) {
        unsafeCount++;
        Logger.log('      ⚠️ ' + rsj.name + ' — +3: ' + n4 + '، +4: ' + n5);
      }
    }
    if (unsafeCount === 0) {
      Logger.log('      ✅ كل الأعمدة الاحتياطية فارغة وآمنة (' + dataRows + ' صف فُحص)');
    }
  }

  // ── خطوة 10: الملخص النهائي ──
  var totalSubjects = 0, totalIrregular = 0, uniqueSubjects = 0;
  for (var pm2 in perMonth) {
    totalSubjects += perMonth[pm2].subjectCount;
    totalIrregular += perMonth[pm2].irregular.length;
  }
  for (var aS in allSubjects) uniqueSubjects++;

  Logger.log('\n╔════════════════════════════════════════════════════╗');
  Logger.log('║              الملخص النهائي                       ║');
  Logger.log('╚════════════════════════════════════════════════════╝');
  Logger.log('   📅 الشهور المُكتشفة:    ' + Object.keys(monthRanges).length + '/6');
  Logger.log('   📚 المواد الفريدة:     ' + uniqueSubjects);
  Logger.log('   🔢 إجمالي الإدخالات:   ' + totalSubjects);
  Logger.log('   ⚠️ المواد غير المنتظمة: ' + totalIrregular);

  report.monthRanges = monthRanges;
  report.perMonth = perMonth;
  report.uniqueSubjects = uniqueSubjects;
  report.totalIrregular = totalIrregular;

  return report;
}

/* ──────────────────────────────────────────────────────────────
 * فك دمج صف باستخدام getMergedRanges + forward-fill احتياطي
 * ────────────────────────────────────────────────────────────── */
function _unmergeRowByValues(sheet, rowNum, lastCol, rawValues) {
  var filled = new Array(lastCol);

  // الطريقة الأساسية: getMergedRanges
  try {
    var fullRow = sheet.getRange(rowNum, 1, 1, lastCol);
    var mergedRanges = fullRow.getMergedRanges();

    // ابدأ بالقيم الخام
    for (var i = 0; i < lastCol; i++) {
      filled[i] = String(rawValues[i] || '').replace(/\s+/g, ' ').trim();
    }

    // طبّق نطاقات الدمج
    for (var m = 0; m < mergedRanges.length; m++) {
      var mr = mergedRanges[m];
      var startCol = mr.getColumn();
      var endCol = mr.getLastColumn();
      var topLeftValue = String(mr.getValue() || '').replace(/\s+/g, ' ').trim();
      for (var c = startCol; c <= endCol; c++) {
        filled[c - 1] = topLeftValue;
      }
    }
  } catch (e) {
    Logger.log('⚠️ فشل getMergedRanges، استخدام forward-fill: ' + e.message);
    // طريقة احتياطية: forward-fill
    var lastVal = '';
    for (var j = 0; j < lastCol; j++) {
      var v = String(rawValues[j] || '').replace(/\s+/g, ' ').trim();
      if (v) { filled[j] = v; lastVal = v; }
      else   { filled[j] = lastVal; }
    }
  }

  return filled;
}

/* ──────────────────────────────────────────────────────────────
 * استخراج المواد ضمن نطاق شهر معين
 * ────────────────────────────────────────────────────────────── */
function _extractSubjectsInRange(row2Filled, row3Raw, range, isTerm) {
  var subjects = [];
  var expectedWidth = isTerm
    ? SCHEMA_V2_CONFIG.EXPECTED_COLS_TRM
    : SCHEMA_V2_CONFIG.EXPECTED_COLS_REG;

  var i = range.start;
  while (i <= range.end) {
    var subjectName = String(row2Filled[i] || '').trim();
    if (!subjectName) { i++; continue; }

    // ابحث عن حدود هذه المادة (نفس الاسم في الأعمدة المتتالية)
    var startCol = i;
    var endCol = i;
    for (var j = i + 1; j <= range.end; j++) {
      var nextName = String(row2Filled[j] || '').trim();
      if (nextName !== subjectName) break;
      endCol = j;
    }
    var actualWidth = endCol - startCol + 1;

    // اقرأ تسميات الصف 3
    var labels = [];
    for (var k = startCol; k <= endCol; k++) {
      var lbl = String(row3Raw[k] || '').trim();
      labels.push(lbl);
    }

    subjects.push({
      name        : subjectName,
      startCol    : startCol + 1,
      endCol      : endCol + 1,
      actualWidth : actualWidth,
      expectedWidth: expectedWidth,
      labels      : labels,
      complies    : (actualWidth === expectedWidth)
    });

    i = endCol + 1;
  }

  return subjects;
}

/* ──────────────────────────────────────────────────────────────
 * مساعد لتنسيق الطباعة
 * ────────────────────────────────────────────────────────────── */
function _pad(str, len) {
  str = String(str || '');
  while (str.length < len) str += ' ';
  if (str.length > len) str = str.substring(0, len);
  return str;
}