/**
 * تشخيص عميق لمشكلة "Access denied: DriveApp"
 * Run → deepDiagnoseDriveAccess
 */
function deepDiagnoseDriveAccess() {
  Logger.log('══════════════════════════════════════');
  Logger.log('🔍 بدء تشخيص عميق لصلاحية Drive');
  Logger.log('══════════════════════════════════════');

  // ───────── 1. معلومات البيئة ─────────
  Logger.log('📌 Spreadsheet ID: ' + SPREADSHEET_ID);
  Logger.log('📌 Drive Folder ID: ' + DRIVE_FOLDER_ID);
  Logger.log('📌 وقت التشغيل: ' + new Date().toISOString());

  // ───────── 2. فحص صلاحية Drive ─────────
  Logger.log('--- الخطوة 1: DriveApp.getRootFolder() ---');
  try {
    var root = DriveApp.getRootFolder();
    Logger.log('✅ تم الوصول إلى جذر Drive. اسم الجذر: ' + (root.getName() || '-'));
  } catch (e) {
    Logger.log('❌ فشل: ' + e.message);
    Logger.log('➡️ السبب: صلاحية Drive غير مفعّلة.');
    Logger.log('➡️ الحل: أضف النطاق "https://www.googleapis.com/auth/drive.file" في appsscript.json وأعد النشر.');
    return; // لا داعي للمتابعة
  }

  // ───────── 3. فحص المجلد الفرعي ─────────
  Logger.log('--- الخطوة 2: DriveApp.getFolderById(DRIVE_FOLDER_ID) ---');
  var folder = null;
  try {
    folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    Logger.log('✅ تم العثور على المجلد: ' + folder.getName());
  } catch (e) {
    Logger.log('❌ فشل: ' + e.message);
    Logger.log('➡️ السبب: المعرف ' + DRIVE_FOLDER_ID + ' غير صحيح أو المجلد محذوف أو لا تملك صلاحية الوصول إليه.');
    Logger.log('➡️ الحل: تحقق من DRIVE_FOLDER_ID في الكود، وتأكد أن المجلد موجود في Drive الخاص بك.');
    return;
  }

  // ───────── 4. فحص إمكانية إنشاء ملف في المجلد ─────────
  Logger.log('--- الخطوة 3: إنشاء ملف تجريبي في المجلد ---');
  var testFileId = null;
  try {
    var testBlob = Utilities.newBlob('diagnostic', 'text/plain', 'diag_test.txt');
    var testFile = folder.createFile(testBlob);
    testFileId   = testFile.getId();
    Logger.log('✅ تم إنشاء ملف تجريبي: ' + testFileId);

    // تعيين المشاركة
    try {
      testFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      Logger.log('✅ تم تعيين المشاركة (ANYONE_WITH_LINK)');
    } catch (e) {
      Logger.log('⚠️ فشل تعيين المشاركة: ' + e.message);
    }

    // حذف الملف التجريبي فوراً
    testFile.setTrashed(true);
    Logger.log('🗑️ تم حذف الملف التجريبي.');
  } catch (e) {
    Logger.log('❌ فشل: ' + e.message);
    Logger.log('➡️ السبب: لا يمكن إنشاء ملفات في هذا المجلد. ربما الصلاحية هي "read only" أو المجلد ممتلئ.');
    if (testFileId) {
      try { DriveApp.getFileById(testFileId).setTrashed(true); } catch (ee) {}
    }
    return;
  }

  // ───────── 5. محاكاة uploadFileToDrive بصورة وهمية ─────────
  Logger.log('--- الخطوة 4: محاكاة uploadFileToDrive ---');
  var fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  var uploadResult = null;
  try {
    uploadResult = uploadFileToDrive(fakeBase64, 'test_pixel.png', 'image/png');
    Logger.log('✅ نجح الرفع. الرابط: ' + uploadResult.directLink);
  } catch (e) {
    Logger.log('❌ فشل: ' + e.message);
    Logger.log('➡️ السبب: فشل داخل uploadFileToDrive نفسها بعد تجاوز كل الفحوصات.');
    Logger.log('➡️ تفاصيل إضافية: تأكد من أن base64 نظيف وأن نوع MIME صحيح.');
  }

  // ───────── 6. فحص صلاحية Drive للمستخدم الحالي ─────────
  Logger.log('--- الخطوة 5: معلومات إضافية ---');
  try {
    var effectiveUser = Session.getEffectiveUser().getEmail();
    Logger.log('👤 المستخدم الفعّال: ' + effectiveUser);
  } catch (e) {
    Logger.log('⚠️ تعذر جلب المستخدم: ' + e.message);
  }

  Logger.log('══════════════════════════════════════');
  Logger.log('✅ انتهى التشخيص العميق');
}