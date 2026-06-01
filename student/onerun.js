function migrateStudentPasswordsToMaster() {
  var oldId    = '1BPtHUMB8kdi2exbfPVaKoSOcjGGZrnbJANXPHnWTD_A';
  var masterId = '1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM';

  var oldSheet = SpreadsheetApp.openById(oldId).getSheetByName('الطلاب');
  var mSheet   = SpreadsheetApp.openById(masterId).getSheetByName('الطلاب');

  // بناء خريطة: الكود → كلمة المرور من الملف القديم (العمود 5 = index 4)
  var oldData = oldSheet.getDataRange().getDisplayValues();
  var passMap = {};
  for (var i = 1; i < oldData.length; i++) {
    var code = String(oldData[i][0]).trim();
    if (code) passMap[code] = String(oldData[i][4]).trim();
  }

  var mData = mSheet.getDataRange().getDisplayValues();
  var lastCol = mSheet.getLastColumn();

  // تحديد عمود كلمة المرور: ابحث عنه، وإن لم يوجد أنشئه بعد آخر عمود
  var header = mData[0];
  var passCol = -1;
  for (var c = 0; c < header.length; c++) {
    if (String(header[c]).trim() === 'كلمة المرور') { passCol = c; break; }
  }
  if (passCol === -1) {
    passCol = lastCol;                       // عمود جديد (index = lastCol صفري)
    mSheet.getRange(1, passCol + 1).setValue('كلمة المرور');
  }

  var written = 0, missing = 0;
  for (var r = 1; r < mData.length; r++) {
    var mcode = String(mData[r][0]).trim();
    if (!mcode) continue;
    if (passMap.hasOwnProperty(mcode)) {
      mSheet.getRange(r + 1, passCol + 1).setValue(passMap[mcode]);
      written++;
    } else {
      missing++;
    }
  }

  var msg = 'عمود كلمة المرور = ' + (passCol + 1) + ' | كُتب: ' + written + ' | مفقود: ' + missing;
  Logger.log(msg);
  return msg;
}