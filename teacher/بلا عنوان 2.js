/**
 * فحص جميع أوراق الملف واستخراج:
 * 1. القيم الظاهرة (Display Values)
 * 2. الصيغ (Formulas) إن وُجدت
 * 3. عدد الصيغ في كل ورقة
 */
function inspectAllSheetsWithFormulas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  
  Logger.log("============================================================");
  Logger.log("تقرير فحص الملف: " + ss.getName());
  Logger.log("عدد الأوراق: " + sheets.length);
  Logger.log("وقت الفحص: " + new Date().toLocaleString());
  Logger.log("============================================================");
  
  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var sheetName = sheet.getName();
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    
    Logger.log("\n📄 الورقة: " + sheetName);
    Logger.log("   الصفوف: " + lastRow + " | الأعمدة: " + lastCol);
    
    if (lastRow > 0 && lastCol > 0) {
      
      // --- رؤوس الأعمدة (القيم الظاهرة) ---
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      Logger.log("   🔤 رؤوس الأعمدة: " + JSON.stringify(headers));
      
      // --- عينة من البيانات مع كشف الصيغ ---
      var dataStartRow = lastRow > 1 ? 2 : 1;
      var numRowsToRead = Math.min(10, lastRow - dataStartRow + 1);
      
      if (numRowsToRead > 0) {
        // قراءة القيم الظاهرة
        var displayValues = sheet.getRange(dataStartRow, 1, numRowsToRead, lastCol).getDisplayValues();
        // قراءة الصيغ
        var formulas = sheet.getRange(dataStartRow, 1, numRowsToRead, lastCol).getFormulas();
        
        Logger.log("   📊 عينة من البيانات (أول " + numRowsToRead + " صفوف):");
        
        for (var r = 0; r < displayValues.length; r++) {
          var rowNum = dataStartRow + r;
          var displayRow = displayValues[r];
          var formulaRow = formulas[r];
          
          // تسجيل القيم الظاهرة
          Logger.log("      صف " + rowNum + " (قيم): " + JSON.stringify(displayRow));
          
          // البحث عن صيغ في هذا الصف
          var formulasFound = [];
          for (var c = 0; c < formulaRow.length; c++) {
            if (formulaRow[c] && formulaRow[c].toString().indexOf('=') === 0) {
              // الحصول على عنوان العمود (A, B, C, ...)
              var colLetter = columnToLetter(c + 1);
              formulasFound.push("  ⚡ " + colLetter + rowNum + " = " + formulaRow[c]);
            }
          }
          
          if (formulasFound.length > 0) {
            Logger.log("         >>> صيغ مكتشفة في هذا الصف:");
            for (var fi = 0; fi < formulasFound.length; fi++) {
              Logger.log(formulasFound[fi]);
            }
          }
        }
      } else {
        Logger.log("   ℹ️ لا توجد بيانات (فقط صف الرأس).");
      }
      
      // --- إحصاء سريع: إجمالي الصيغ في الورقة ---
      if (lastRow > 1 && lastCol > 0) {
        var allFormulas = sheet.getRange(2, 1, Math.min(lastRow - 1, 50), lastCol).getFormulas();
        var formulaCount = 0;
        for (var rf = 0; rf < allFormulas.length; rf++) {
          for (var cf = 0; cf < allFormulas[rf].length; cf++) {
            if (allFormulas[rf][cf] && allFormulas[rf][cf].toString().indexOf('=') === 0) {
              formulaCount++;
            }
          }
        }
        if (formulaCount > 0) {
          Logger.log("   📝 إجمالي الصيغ في أول 50 صفاً: " + formulaCount);
        } else {
          Logger.log("   ✅ لا توجد صيغ في أول 50 صفاً (بيانات نقية).");
        }
      }
      
    } else {
      Logger.log("   ⚠️ الورقة فارغة.");
    }
  }
  
  Logger.log("\n✅ انتهى الفحص.");
}

/**
 * تحويل رقم العمود إلى حرف (مثلاً 1 → A, 27 → AA)
 */
function columnToLetter(column) {
  var temp, letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}