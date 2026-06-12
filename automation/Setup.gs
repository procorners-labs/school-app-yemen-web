/**
 * Setup.gs — تجهيز جدول البيانات تلقائياً + قائمة التشغيل + المؤقّت.
 *
 * شغّل setupAll() مرة واحدة من المحرّر، أو من القائمة «أتمتة المنشورات».
 */

/** يبني الأوراق والأعمدة والقوائم المنسدلة والتنسيق — آمن لإعادة التشغيل. */
function setupAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupPostsSheet_(ss);
  setupSettingsSheet_(ss);
  SpreadsheetApp.getUi().alert('تم التجهيز ✅\nاكتب مدخلاتك في ورقة «' + SHEET_POSTS + '» واترك الحالة «' + STATUS.NEW + '».');
}

function setupPostsSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_POSTS);
  if (!sh) sh = ss.insertSheet(SHEET_POSTS, 0);

  // ترويسة
  sh.getRange(1, 1, 1, POSTS_HEADERS.length)
    .setValues([POSTS_HEADERS])
    .setFontWeight('bold')
    .setBackground('#1a73e8')
    .setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.getRange(1, 1, sh.getMaxRows(), POSTS_HEADERS.length).setHorizontalAlignment('right');

  // قائمة منسدلة للنوع
  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(POST_TYPES, true).setAllowInvalid(false).build();
  sh.getRange(2, COL.TYPE, sh.getMaxRows() - 1).setDataValidation(typeRule);

  // قائمة منسدلة للحالة
  const statusList = Object.keys(STATUS).map(function (k) { return STATUS[k]; });
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(statusList, true).setAllowInvalid(false).build();
  sh.getRange(2, COL.STATUS, sh.getMaxRows() - 1).setDataValidation(statusRule);

  // عرض الأعمدة
  sh.setColumnWidth(COL.INPUT, 280);
  sh.setColumnWidth(COL.CAPTION, 360);
  sh.setColumnWidth(COL.LOG, 220);

  // تلوين شرطي للحالات
  const rules = [];
  function colorRule(text, bg) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(text).setBackground(bg)
      .setRanges([sh.getRange(2, COL.STATUS, sh.getMaxRows() - 1)]).build();
  }
  rules.push(colorRule(STATUS.REVIEW,    '#fff3cd'));
  rules.push(colorRule(STATUS.APPROVED,  '#d1e7dd'));
  rules.push(colorRule(STATUS.PUBLISHED, '#c8e6c9'));
  rules.push(colorRule(STATUS.FAILED,    '#f8d7da'));
  sh.setConditionalFormatRules(rules);
}

function setupSettingsSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_SETTINGS);
  if (sh) return; // لا نكتب فوق إعدادات موجودة
  sh = ss.insertSheet(SHEET_SETTINGS);
  const rows = [
    ['المفتاح', 'القيمة'],
    ['اسم المدرسة', 'مدارس الإبداع والتميز الدولية'],
    ['الشعار/الرسالة', 'نبني جيلاً مبدعاً متميّزاً'],
    ['المدينة', 'صنعاء — اليمن'],
    ['نبرة المحتوى', 'راقية، محفّزة، مختصرة، عربية فصيحة مبسّطة'],
    ['وسوم ثابتة', '#مدارس_الإبداع_والتميز #تعليم #اليمن'],
    ['رقم التواصل', ''],
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  sh.getRange(1, 1, sh.getMaxRows(), 2).setHorizontalAlignment('right');
  sh.setColumnWidth(2, 360);
}

/** يقرأ ورقة الإعدادات كـ كائن {المفتاح: القيمة}. */
function readSettings_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS);
  const out = {};
  if (!sh) return out;
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  data.forEach(function (r) { if (r[0]) out[String(r[0]).trim()] = String(r[1]).trim(); });
  return out;
}

/** قائمة مخصّصة تظهر عند فتح الجدول. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('أتمتة المنشورات')
    .addItem('① تجهيز الجدول', 'setupAll')
    .addSeparator()
    .addItem('② توليد المسودّات (نص + تصميم)', 'generateDrafts')
    .addItem('③ نشر المعتمد', 'publishApproved')
    .addSeparator()
    .addItem('تشغيل المعالجة الآن (الكل)', 'runPipeline')
    .addItem('تفعيل التشغيل التلقائي (كل ساعة)', 'installHourlyTrigger')
    .addItem('إيقاف التشغيل التلقائي', 'removeTriggers')
    .addToUi();
}

/** يثبّت مؤقّتاً يشغّل runPipeline كل ساعة. */
function installHourlyTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('runPipeline').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('تم تفعيل التشغيل التلقائي كل ساعة ⏱️\nسيولّد المسودّات وينشر المعتمد دون تدخّل.');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runPipeline') ScriptApp.deleteTrigger(t);
  });
}

/** المعالجة الكاملة: توليد المسودّات ثم نشر المعتمد. */
function runPipeline() {
  generateDrafts();
  publishApproved();
}
