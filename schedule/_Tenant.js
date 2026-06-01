// ═══════════════════════════════════════════════════════════
//  _Tenant.gs — وحدة تعدّد المدارس (Multi-Tenant) — ES5
//  المشروع: أداة توزيع الحصص
// ═══════════════════════════════════════════════════════════

// ① معرّف ملف Master_Admin_School (مصدر خريطة المدارس)
var MASTER_SS_ID = '10Zk0vwjrHagydYlU0kyjB6X9uoyVCN6sl5nSet1_c7w';

// ② نوع الملف الذي تخدمه هذه المنصة:
//    مشروع الحصص → 'schedule_file_id'
var TENANT_FILE_TYPE = 'schedule_file_id';

// الملف النشط للطلب الحالي
var _ACTIVE_TENANT_FILE = '';

// أعمدة ورقة Schools (0-based)
var _SCHOOLS_COL = {
  school_id        : 0,
  teacher_file_id  : 4,
  student_file_id  : 5,
  cms_file_id      : 6,
  schedule_file_id : 7,
  subscription_end : 9,
  is_active        : 10
};

// يُرجع معرّف ملف المدرسة النشطة، أو الملف الافتراضي (للتوافق الرجعي)
function _activeFileId() {
  return _ACTIVE_TENANT_FILE || SPREADSHEET_ID;
}

// يُضبط مرة واحدة عند الدخول
function _setActiveTenant(schoolId) {
  if (!schoolId) { _ACTIVE_TENANT_FILE = ''; return SPREADSHEET_ID; }
  _ACTIVE_TENANT_FILE = _resolveTenantFileId(schoolId, TENANT_FILE_TYPE);
  return _ACTIVE_TENANT_FILE;
}

// يقرأ معرّف ملف المدرسة من ورقة Schools في Master
function _resolveTenantFileId(schoolId, fileType) {
  schoolId = (schoolId === null || schoolId === undefined) ? '' : schoolId.toString().trim();
  if (!schoolId) return SPREADSHEET_ID;
  fileType = fileType || TENANT_FILE_TYPE;

  var ckey = 'tenant_' + schoolId + '_' + fileType;
  try {
    var cached = CacheService.getScriptCache().get(ckey);
    if (cached) return cached;
  } catch (e) {}

  var ss = SpreadsheetApp.openById(MASTER_SS_ID);
  var sh = ss.getSheetByName('Schools');
  if (!sh) throw new Error('ورقة Schools غير موجودة في Master');

  var data  = sh.getDataRange().getValues();
  var col   = _SCHOOLS_COL[fileType];
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  for (var i = 1; i < data.length; i++) {
    if (data[i][_SCHOOLS_COL.school_id].toString().trim() === schoolId) {
      var active  = data[i][_SCHOOLS_COL.is_active].toString().toLowerCase();
      var endDate = data[i][_SCHOOLS_COL.subscription_end].toString().trim();

      if (active !== 'true' && active !== '1') {
        throw new Error('المدرسة غير مفعّلة. تواصل مع الإدارة.');
      }
      if (endDate && endDate < today) {
        throw new Error('انتهى اشتراك المدرسة. يرجى التجديد.');
      }
      var fid = data[i][col].toString().trim();
      if (!fid) throw new Error('ملف المدرسة غير مُهيّأ بعد');

      try { CacheService.getScriptCache().put(ckey, fid, 600); } catch (e) {}
      return fid;
    }
  }
  throw new Error('المدرسة غير موجودة في النظام');
}