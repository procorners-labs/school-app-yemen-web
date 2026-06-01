// ============================================================
// fixViolationsSheetHeader — إصلاح فوري لصف الرأس
// شغّله مرة واحدة فقط
// ============================================================
function fixViolationsSheetHeader() {
  try {
    var studentFile = SpreadsheetApp.openById('1BPtHUMB8kdi2exbfPVaKoSOcjGGZrnbJANXPHnWTD_A');
    var sheet = studentFile.getSheetByName('سلبيات ومميزات الطالب');
    
    if (!sheet) {
      // إنشاء الورقة من جديد
      sheet = studentFile.insertSheet('سلبيات ومميزات الطالب');
      Logger.log('✅ تم إنشاء ورقة "سلبيات ومميزات الطالب" من جديد');
    }
    
    // مسح الصف الأول كاملاً (إزالة أي صيغ IMPORTRANGE معطلة)
    sheet.getRange(1, 1, 1, 8).clearContent();
    sheet.getRange(1, 1, 1, 8).clearFormat();
    
    // كتابة رأس نظيف بالقيم الصريحة (لا صيغ)
    sheet.getRange(1, 1, 1, 8).setValues([[
      'الكود', 'الاسم', 'الفصل', 'الشعبة', 'المخالفة', 'المدرس', 'التاريخ', 'الرد'
    ]]);
    
    SpreadsheetApp.flush();
    Logger.log('✅ تم إصلاح رأس "سلبيات ومميزات الطالب" بنجاح');
    return { ok: true, message: 'تم الإصلاح بنجاح' };
  } catch (e) {
    Logger.log('❌ fixViolationsSheetHeader error: ' + e.toString());
    return { ok: false, error: e.message };
  }
}

// ============================================================
// fixNotesSheetHeader — إصلاح رأس ورقة الملاحظات في ملف المعلمين
// شغّله في مشروع TeacherCore
// ============================================================
function fixNotesSheetHeader() {
  try {
    var masterFile = SpreadsheetApp.openById('1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM');
    var sheet = masterFile.getSheetByName('الملاحظات');
    
    if (!sheet) {
      sheet = masterFile.insertSheet('الملاحظات');
      Logger.log('✅ تم إنشاء ورقة "الملاحظات" في ملف المعلمين');
    }
    
    // مسح الصف الأول
    sheet.getRange(1, 1, 1, 7).clearContent();
    
    // كتابة رأس نظيف
    sheet.getRange(1, 1, 1, 7).setValues([[
      'الاسم', 'الفصل', 'الشعبة', 'اسم المدرس', 'الرسالة', 'التاريخ', 'الرد'
    ]]);
    
    SpreadsheetApp.flush();
    Logger.log('✅ تم إصلاح رأس "الملاحظات" في ملف المعلمين');
    return { ok: true, message: 'تم الإصلاح بنجاح' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}