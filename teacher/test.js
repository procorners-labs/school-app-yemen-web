function testDriveAccess() {
  try {
    var blob = Utilities.newBlob('اختبار', 'text/plain', 'test.txt');
    var file = DriveApp.createFile(blob);
    Logger.log('Drive يعمل! File ID: ' + file.getId());
    file.setTrashed(true); // تنظيف
  } catch (e) {
    Logger.log('❌ خطأ في Drive: ' + e.message);
    throw new Error('صلاحية Drive غير مفعلة. اذهب إلى المحرر > التشغيل > مراجعة الأذونات واسمح بالوصول إلى Drive.');
  }
}
function giveDrivePermission() {
  // مجرد محاولة فتح مجلد Drive، ستظهر نافذة الأذونات
  DriveApp.getRootFolder();
}
/**
 * تدقيق عميق ومُفصَّل لملف الشيت الحالي.
 * الخرج: سجل التنفيذ (Logger) + ورقة "تقرير التدقيق" إن لم تكن موجودة.
 * متوافق مع ES5 – يستخدم var فقط.
 */
function deepAudit() {
  var ss = _getSS();
  var allSheets = ss.getSheets();
  var namedRanges = ss.getNamedRanges();
  var devMetadata = [];
  try { devMetadata = ss.getDeveloperMetadata(); } catch(e) {}

  // ───── افتتاحية التقرير ─────
  Logger.log("╔══════════════════════════════════════════════════════════╗");
  Logger.log("║  تدقيق شامل – ملف المعلمين | School App Yemen          ║");
  Logger.log("║  التاريخ: " + _nowString() + "                         ║");
  Logger.log("║  عدد الأوراق: " + allSheets.length + "                               ║");
  Logger.log("╚══════════════════════════════════════════════════════════╝");

  // ① بيانات المطوّر
  if (devMetadata.length) {
    Logger.log("\n🔧 بيانات المطور (Developer Metadata):");
    for (var dm = 0; dm < devMetadata.length; dm++) {
      var meta = devMetadata[dm];
      Logger.log("   • المفتاح: " + meta.getKey() +
                 " | القيمة: " + (meta.getValue() || '') +
                 " | الموقع: " + (meta.getLocation() ? meta.getLocation().getA1Notation() : 'عام'));
    }
  }

  // ② النطاقات المعنونة
  if (namedRanges.length) {
    Logger.log("\n🔖 النطاقات المعنونة (Named Ranges):");
    for (var nr = 0; nr < namedRanges.length; nr++) {
      var rng = namedRanges[nr];
      Logger.log("   • " + rng.getName() + " → " + rng.getRange().getA1Notation() +
                 " | الورقة: " + rng.getRange().getSheet().getName());
    }
  } else {
    Logger.log("\n🔖 لا توجد نطاقات معنونة.");
  }

  // ③ الأوراق – فحص عميق لكل ورقة
  for (var s = 0; s < allSheets.length; s++) {
    var sheet = allSheets[s];
    auditOneSheetDeep(sheet, s);
  }

  Logger.log("\n══════════════════════════════════════");
  Logger.log("  ✅ انتهى التدقيق العميق");

  // إضافة التقرير إلى ورقة خاصة (اختياري)
  writeAuditToSheet(ss, allSheets, namedRanges, devMetadata);
}

/**
 * فحص عميق لورقة واحدة
 */
function auditOneSheetDeep(sheet, idx) {
  var name = sheet.getName();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var maxScanRows = Math.min(lastRow, 6); // نفحص حتى الصف 6

  Logger.log("\n──────────────────────────────────────────────");
  Logger.log("📄 [" + (idx+1) + "] الورقة: " + name);
  Logger.log("   الصفوف: " + lastRow + " | الأعمدة: " + lastCol);
  try {
    var color = sheet.getTabColor();
    if (color) Logger.log("   لون التبويب: " + color);
  } catch(e) {}
  try {
    var prot = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (prot.length) Logger.log("   🔒 الورقة محمية (" + prot.length + " إعدادات حماية)");
  } catch(e) {}

  if (lastRow === 0) { Logger.log("   (ورقة فارغة)"); return; }

  // ── 1. رؤوس الأعمدة (الصف الأول) ──
  var headers = [];
  if (lastRow >= 1) {
    var hData = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var c = 0; c < hData.length; c++) {
      headers.push(_safeStr(hData[c]) || ("عمود_" + (c+1)));
    }
    Logger.log("   🏷️ الرؤوس: " + headers.join(" | "));
  }

  // ── 2. أول 5 صفوف (مع تنبيه للصيغ) ──
  var showRows = Math.min(5, lastRow - 1);
  if (showRows > 0) {
    Logger.log("   📊 أول " + showRows + " صفوف من البيانات:");
    var dataRange = sheet.getRange(2, 1, showRows, lastCol);
    var values = dataRange.getValues();
    var formulas = dataRange.getFormulas();
    for (var r = 0; r < values.length; r++) {
      var rowParts = [];
      for (var c = 0; c < lastCol; c++) {
        var val = _safeStr(values[r][c]);
        if (val.length > 60) val = val.substring(0, 57) + "...";
        var f = formulas[r][c] || '';
        var isFormula = (f && f.trim() !== '');
        var display = (headers[c] || ("عمود_"+(c+1))) + ": ";
        if (isFormula) {
          display += "⚡صيغة " + val; // علامة أن القيمة ناتجة عن صيغة
        } else {
          display += (val || "فارغ");
        }
        rowParts.push(display);
      }
      Logger.log("      صف " + (r+2) + ": " + rowParts.join(" | "));
    }
  }

  // ── 3. قواعد التحقق من الصحة (القوائم المنسدلة) ──
  try {
    var dvRange = sheet.getRange(1, 1, Math.min(lastRow, 100), lastCol); // نطاق أوسع قليلاً
    var validations = dvRange.getDataValidations();
    var dvList = [];
    for (var rv = 0; rv < validations.length; rv++) {
      for (var cv = 0; cv < validations[rv].length; cv++) {
        var rule = validations[rv][cv];
        if (rule) {
          var rowNum = rv + 1;
          var colNum = cv + 1;
          var criteria = rule.getCriteriaType();
          var vals = [];
          try {
            var args = rule.getCriteriaValues();
            if (args.length) vals = args[0];
          } catch(e) {}
          dvList.push({
            cell: colNumToLetter(colNum) + rowNum,
            criteria: criteria,
            values: vals,
            msg: rule.getHelpText() || ''
          });
        }
      }
    }
    if (dvList.length) {
      Logger.log("   🔽 قواعد التحقق من الصحة (Data Validation): " + dvList.length + " خلية");
      for (var dv = 0; dv < dvList.length; dv++) {
        var item = dvList[dv];
        var valsStr = Array.isArray(item.values) ? item.values.join(', ') : item.values;
        Logger.log("      • " + item.cell + " | النوع: " + item.criteria +
                   " | القيم: " + (valsStr || 'لا شيء') +
                   (item.msg ? " | وصف: " + item.msg : ""));
      }
    }
  } catch(e) {
    Logger.log("   ⚠️ تعذر فحص التحقق من الصحة: " + e.message);
  }

  // ── 4. التنسيق الشرطي ──
  try {
    var rules = sheet.getConditionalFormatRules();
    if (rules.length) {
      Logger.log("   🎨 قواعد التنسيق الشرطي: " + rules.length);
      for (var cr = 0; cr < rules.length; cr++) {
        var rule = rules[cr];
        var ranges = rule.getRanges();
        var rangeStr = '';
        for (var ir = 0; ir < ranges.length; ir++) {
          if (ir) rangeStr += ', ';
          rangeStr += ranges[ir].getA1Notation();
        }
        Logger.log("      • النطاق: " + rangeStr + " | وصف: " + (rule.getBooleanCondition() ? rule.getBooleanCondition().getCriteriaType() : 'تدرج لوني'));
      }
    }
  } catch(e) { Logger.log("   ⚠️ فشل فحص التنسيق الشرطي: " + e.message); }

  // ── 5. النطاقات المحمية ──
  try {
    var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    if (protections.length) {
      Logger.log("   🔒 نطاقات محمية: " + protections.length);
      for (var p = 0; p < protections.length; p++) {
        var prot = protections[p];
        var desc = prot.getDescription() || 'بدون وصف';
        var pRange = prot.getRange().getA1Notation();
        Logger.log("      • " + desc + " | النطاق: " + pRange);
      }
    }
  } catch(e) {}

  // ── 6. تفريغ كامل لورقة القوائم ──
  if (name === "القوائم") {
    Logger.log("\n   🔍 ** تفريغ كامل لورقة القوائم **");
    if (lastRow > 1) {
      var fullData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
      for (var dr = 0; dr < fullData.length; dr++) {
        var row = fullData[dr];
        var disp = [];
        for (var c = 0; c < row.length; c++) {
          var val = _safeStr(row[c]);
          var hdr = headers[c] || ("عمود_"+(c+1));
          disp.push(hdr + "=" + (val || "فارغ"));
        }
        Logger.log("      سجل " + (dr+2) + ": " + disp.join(" | "));
      }
      Logger.log("   📌 إجمالي السجلات: " + (lastRow - 1));
    }
  }
}

/**
 * كتابة ملخص التدقيق في ورقة جديدة
 */
function writeAuditToSheet(ss, sheets, namedRanges, devMetadata) {
  var reportSheet = ss.getSheetByName("تقرير التدقيق");
  if (!reportSheet) {
    reportSheet = ss.insertSheet("تقرير التدقيق");
  } else {
    reportSheet.clear();
  }
  var output = [];
  output.push(["بند", "التفاصيل"]);
  output.push(["عدد الأوراق", sheets.length]);
  output.push(["نطاقات معنونة", namedRanges.length]);
  for (var nr = 0; nr < namedRanges.length; nr++) {
    output.push(["نطاق معنون", namedRanges[nr].getName() + ": " + namedRanges[nr].getRange().getA1Notation()]);
  }
  output.push(["", ""]);
  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    output.push(["ورقة: " + sheet.getName(), "صفوف: " + sheet.getLastRow() + " أعمدة: " + sheet.getLastColumn()]);
    if (sheet.getName() === "القوائم") {
      var d = sheet.getDataRange().getValues();
      for (var r = 1; r < d.length; r++) {
        var row = d[r];
        output.push(["   صف " + (r+1), row.join(" | ")]);
      }
    }
  }
  reportSheet.getRange(1,1,output.length,2).setValues(output);
}

// دالة مساعدة: تحويل رقم عمود إلى حرف
function colNumToLetter(col) {
  var s = '';
  while (col > 0) { var rem = (col-1) % 26; s = String.fromCharCode(65 + rem) + s; col = Math.floor((col-1)/26); }
  return s;
}
function testTeacherCoreNow() {
  // اختبار استخراج ID
  Logger.log(extractDriveFileId("https://drive.google.com/file/d/xyz789/view"));
  // اختبار إضافة خبر بدون مرفق (للتأكد من عدم وجود أخطاء)
  var result = _addNewsInternal({
    teacher: 'اختبار',
    grade: 'الأول',
    section: 'أ',
    news: 'خبر تجريبي',
    date: '2025-01-01'
  });
  Logger.log(result.success);
}
function giveDrivePermission() {
  DriveApp.getRootFolder();
}