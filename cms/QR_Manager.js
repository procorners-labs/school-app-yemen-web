/**
 * ═══════════════════════════════════════════════════════════════════
 *  QR_Manager.js — نظام إدارة QR Codes
 *  منظومة مدارس الإبداع والتميز الدولية — وحدة CMS
 *
 *  الاستخدام:
 *   • كل الدوال العامة قابلة للاستدعاء من الواجهة عبر google.script.run
 *     أو عبر ApiEndpoint.js (دالة doPost) عند التشغيل من الـ Worker.
 *   • يستخدم SPREADSHEET_ID المُعرَّف في CMS.js (نفس ملف الشيت).
 *   • يدعم التعدد المؤسسي (Multi-Tenant) عبر _setActiveTenant / _activeFileId.
 *
 *  ES5 صارم: var فقط، function(){} فقط، تسلسل نصوص فقط.
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── ثوابت الوحدة ────────────────────────────────────────────────
var QR_SHEET_NAME = 'QR_Codes';
var QR_CACHE_ALL  = 'qr_codes_all';
var QR_CACHE_TTL  = 300; // 5 دقائق

var QR_HEADERS = [
  'ID', 'Title', 'URL', 'Description', 'ImageURL',
  'QRImageURL', 'CreatedAt', 'CreatedBy', 'Status', 'Category'
];

var QR_CATEGORIES = ['عام', 'أخبار', 'جدول', 'تواصل اجتماعي', 'نشاط', 'إعلان'];

// ═══════════════════════════════════════════════════════════════════
//  دوال مساعدة داخلية
// ═══════════════════════════════════════════════════════════════════

/**
 * يُعيد ورقة QR_Codes — ينشئها مع الرؤوس إن لم تكن موجودة.
 * يستخدم ملف المستأجر النشط (_activeFileId) لدعم التعدد المؤسسي.
 */
function _getQRSheet() {
  var ss;
  try {
    var fid = (typeof _activeFileId === 'function') ? _activeFileId() : SPREADSHEET_ID;
    ss = SpreadsheetApp.openById(fid || SPREADSHEET_ID);
  } catch (e) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  var sheet = ss.getSheetByName(QR_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(QR_SHEET_NAME);
    sheet.appendRow(QR_HEADERS);
    var hdr = sheet.getRange(1, 1, 1, QR_HEADERS.length);
    hdr.setBackground('#0F2C5C').setFontColor('#D4A537').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    // عروض الأعمدة
    sheet.setColumnWidth(1, 130);  // ID
    sheet.setColumnWidth(2, 200);  // Title
    sheet.setColumnWidth(3, 280);  // URL
    sheet.setColumnWidth(4, 180);  // Description
    sheet.setColumnWidth(5, 200);  // ImageURL
    sheet.setColumnWidth(6, 300);  // QRImageURL
    sheet.setColumnWidth(7, 160);  // CreatedAt
    sheet.setColumnWidth(8, 120);  // CreatedBy
    sheet.setColumnWidth(9, 80);   // Status
    sheet.setColumnWidth(10, 120); // Category
  }
  return sheet;
}

/** يبني رابط QR من Google Charts API */
function _generateQRUrl(url) {
  return 'https://chart.googleapis.com/chart?cht=qr&chs=400x400&chl=' +
    encodeURIComponent(url) + '&choe=UTF-8';
}

/** يمسح كاش QR الكلي وكاش المفرد */
function _clearQRCache(id) {
  try {
    var c = CacheService.getScriptCache();
    c.remove(QR_CACHE_ALL);
    if (id) c.remove('qr_' + id);
  } catch (e) {
    Logger.log('_clearQRCache: ' + String(e.message || e));
  }
}

/** يحوّل صف شيت إلى كائن JS */
function _qrRowToObj(row) {
  return {
    id:          String(row[0] || ''),
    title:       String(row[1] || ''),
    url:         String(row[2] || ''),
    description: String(row[3] || ''),
    imageUrl:    String(row[4] || ''),
    qrImageUrl:  String(row[5] || ''),
    createdAt:   String(row[6] || ''),
    createdBy:   String(row[7] || ''),
    status:      String(row[8] || 'active'),
    category:    String(row[9] || 'عام')
  };
}

/** يتحقق من صحة الـ URL */
function _isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  var t = url.trim();
  return t.indexOf('http://') === 0 || t.indexOf('https://') === 0;
}

/** ينظّف المدخلات من HTML والمسافات */
function _qrSanitize(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/<[^>]*>/g, '').trim();
}

// ═══════════════════════════════════════════════════════════════════
//  1) إنشاء QR Code جديد
// ═══════════════════════════════════════════════════════════════════
/**
 * createQRCode(data)
 * @param {{title,url,description,imageUrl,category,createdBy}} data
 * @return {{success, id?, qrUrl?, title?, url?, createdAt?, error?}}
 */
function createQRCode(data) {
  try {
    data = data || {};
    var title       = _qrSanitize(data.title);
    var url         = _qrSanitize(data.url);
    var description = _qrSanitize(data.description);
    var imageUrl    = _qrSanitize(data.imageUrl);
    var category    = _qrSanitize(data.category) || 'عام';
    var createdBy   = _qrSanitize(data.createdBy) || 'نظام QR';

    if (!title)               return { success: false, error: 'العنوان مطلوب' };
    if (!url)                 return { success: false, error: 'الرابط مطلوب' };
    if (!_isValidUrl(url))    return { success: false, error: 'الرابط غير صالح — يجب أن يبدأ بـ http أو https' };
    if (imageUrl && !_isValidUrl(imageUrl)) imageUrl = ''; // تجاهل رابط الصورة لو غير صالح

    var id    = 'QR_' + new Date().getTime();
    var qrUrl = _generateQRUrl(url);
    var now   = new Date().toISOString();

    var sheet = _getQRSheet();
    sheet.appendRow([id, title, url, description, imageUrl, qrUrl, now, createdBy, 'active', category]);

    _clearQRCache(null);

    // سجّل التدقيق (إن توفّر logAudit في مشروع CMS)
    try {
      if (typeof logAudit === 'function') {
        logAudit(createdBy, createdBy, 'إنشاء_QR', 'أنشأ QR: ' + title, QR_SHEET_NAME, sheet.getLastRow());
      }
    } catch (e) {}

    return { success: true, id: id, qrUrl: qrUrl, title: title, url: url, createdAt: now, category: category };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  2) جلب كل QR الـ active (مع كاش 5 دقائق)
// ═══════════════════════════════════════════════════════════════════
/**
 * getAllQRCodes(schoolId?)
 * @return {{success, data:Array, fromCache?}}
 */
function getAllQRCodes(schoolId) {
  try {
    if (schoolId && typeof _setActiveTenant === 'function') _setActiveTenant(schoolId);

    var cacheKey = QR_CACHE_ALL + (schoolId ? '_' + schoolId : '');
    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) {
      try { return { success: true, data: JSON.parse(cached), fromCache: true }; } catch (e) {}
    }

    var sheet   = _getQRSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, data: [] };

    var rows   = sheet.getRange(2, 1, lastRow - 1, QR_HEADERS.length).getValues();
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      var obj = _qrRowToObj(rows[i]);
      if (obj.id && obj.status !== 'deleted') result.push(obj);
    }

    // ترتيب: الأحدث أولاً
    result.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

    try { cache.put(cacheKey, JSON.stringify(result), QR_CACHE_TTL); } catch (e) {}

    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  3) حذف QR (soft delete)
// ═══════════════════════════════════════════════════════════════════
/**
 * deleteQRCode(id, schoolId?)
 * @return {{success, message?, error?}}
 */
function deleteQRCode(id, schoolId) {
  try {
    if (!id) return { success: false, error: 'المعرف مطلوب' };
    if (schoolId && typeof _setActiveTenant === 'function') _setActiveTenant(schoolId);

    var sheet   = _getQRSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, error: 'لا توجد بيانات' };

    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        sheet.getRange(i + 2, 9).setValue('deleted');
        _clearQRCache(id);
        try {
          if (typeof logAudit === 'function') logAudit('', '', 'حذف_QR', 'حذف QR: ' + id, QR_SHEET_NAME, i + 2);
        } catch (e) {}
        return { success: true, message: 'تم حذف QR بنجاح' };
      }
    }
    return { success: false, error: 'لم يُعثر على QR بهذا المعرف' };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  4) تحديث QR (مع إعادة توليد QR إن تغيّر الرابط)
// ═══════════════════════════════════════════════════════════════════
/**
 * updateQRCode(id, data, schoolId?)
 * @return {{success, message?, qrUrl?, error?}}
 */
function updateQRCode(id, data, schoolId) {
  try {
    if (!id) return { success: false, error: 'المعرف مطلوب' };
    data = data || {};
    if (schoolId && typeof _setActiveTenant === 'function') _setActiveTenant(schoolId);

    var sheet   = _getQRSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, error: 'لا توجد بيانات' };

    var allRows = sheet.getRange(2, 1, lastRow - 1, QR_HEADERS.length).getValues();
    for (var i = 0; i < allRows.length; i++) {
      if (String(allRows[i][0]) !== String(id)) continue;

      var row    = allRows[i];
      var newUrl = data.url ? _qrSanitize(data.url) : String(row[2]);

      if (data.url && !_isValidUrl(newUrl)) return { success: false, error: 'الرابط الجديد غير صالح' };

      // أعِد توليد QR إن تغيّر الرابط
      var newQr = (newUrl !== String(row[2])) ? _generateQRUrl(newUrl) : String(row[5]);

      sheet.getRange(i + 2, 1, 1, QR_HEADERS.length).setValues([[
        String(row[0]),
        data.title       !== undefined ? _qrSanitize(data.title)       : String(row[1]),
        newUrl,
        data.description !== undefined ? _qrSanitize(data.description) : String(row[3]),
        data.imageUrl    !== undefined ? _qrSanitize(data.imageUrl)     : String(row[4]),
        newQr,
        String(row[6]),  // CreatedAt لا يتغيّر
        String(row[7]),  // CreatedBy لا يتغيّر
        String(row[8]),
        data.category    !== undefined ? _qrSanitize(data.category)     : String(row[9])
      ]]);

      _clearQRCache(id);
      return { success: true, message: 'تم تحديث QR بنجاح', qrUrl: newQr };
    }
    return { success: false, error: 'لم يُعثر على QR بهذا المعرف' };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  5) جلب QR واحد بالمعرف
// ═══════════════════════════════════════════════════════════════════
/**
 * getQRById(id, schoolId?)
 * @return {{success, data?, fromCache?, error?}}
 */
function getQRById(id, schoolId) {
  try {
    if (!id) return { success: false, error: 'المعرف مطلوب' };
    if (schoolId && typeof _setActiveTenant === 'function') _setActiveTenant(schoolId);

    var cacheKey = 'qr_' + id;
    var cache    = CacheService.getScriptCache();
    var cached   = cache.get(cacheKey);
    if (cached) {
      try { return { success: true, data: JSON.parse(cached), fromCache: true }; } catch (e) {}
    }

    var sheet   = _getQRSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, error: 'لا توجد بيانات' };

    var allRows = sheet.getRange(2, 1, lastRow - 1, QR_HEADERS.length).getValues();
    for (var i = 0; i < allRows.length; i++) {
      if (String(allRows[i][0]) === String(id)) {
        var obj = _qrRowToObj(allRows[i]);
        try { cache.put(cacheKey, JSON.stringify(obj), QR_CACHE_TTL); } catch (e) {}
        return { success: true, data: obj };
      }
    }
    return { success: false, error: 'لم يُعثر على QR' };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  6) إحصائيات QR Codes
// ═══════════════════════════════════════════════════════════════════
/**
 * getQRStats(schoolId?)
 * @return {{success, total, byCategory, error?}}
 */
function getQRStats(schoolId) {
  try {
    var all    = getAllQRCodes(schoolId);
    var data   = (all.success && all.data) ? all.data : [];
    var bycat  = {};
    var total  = 0;
    for (var i = 0; i < data.length; i++) {
      total++;
      var cat = data[i].category || 'عام';
      bycat[cat] = (bycat[cat] || 0) + 1;
    }
    return { success: true, total: total, byCategory: bycat };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  7) إرجاع قوائم الفئات والإعدادات
// ═══════════════════════════════════════════════════════════════════
function getQRCategories() {
  return { success: true, categories: QR_CATEGORIES };
}

// ═══════════════════════════════════════════════════════════════════
//  ملاحظة: doGet و doPost معرَّفان في CMS.js و ApiEndpoint.js
//  — جميع الدوال أعلاه تُوجَّه تلقائياً عبر ApiEndpoint.js الموجود.
//  — أضِف في doGet (CMS.js):
//      if (page === 'qr') return HtmlService
//        .createHtmlOutputFromFile('QR_Dashboard')
//        .setTitle('مدير QR Codes')
//        .addMetaTag('viewport','width=device-width,initial-scale=1');
// ═══════════════════════════════════════════════════════════════════
