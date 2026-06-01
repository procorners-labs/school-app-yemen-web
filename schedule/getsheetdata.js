function deepAudit() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();

  Logger.log('═══════════════════════════════════');
  Logger.log(' تدقيق أداة توزيع الحصص الذكية');
  Logger.log('═══════════════════════════════════');

  sheets.forEach(function(sheet) {
    var name = sheet.getName();
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    Logger.log('\n📄 الورقة: ' + name + ' | صفوف: ' + lastRow + ' | أعمدة: ' + lastCol);

    if (lastRow > 0) {
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      Logger.log('🏷️ الرؤوس: ' + headers.join(' | '));
    }

    // عرض أول 3 صفوف من البيانات
    if (lastRow > 1) {
      var sample = sheet.getRange(2, 1, Math.min(3, lastRow - 1), lastCol).getValues();
      for (var i = 0; i < sample.length; i++) {
        Logger.log('  صف ' + (i+2) + ': ' + sample[i].join(' | '));
      }
    }
  });

  // سرد الدوال المنشورة
  Logger.log('\n🔧 الدوال المتاحة:');
  Logger.log('  onOpen, showSidebar, getTeachersList, getTeacherScheduleData');
  Logger.log('  assignPeriod, deleteAssignment, resetTeacherSchedule');
  Logger.log('  getClassSchedule, populateClassesSheet');
  Logger.log('  syncScheduleToStudentFile ← أضيفت يدوياً');
}