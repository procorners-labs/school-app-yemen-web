/**
 * ═══════════════════════════════════════════════════════════════════
 *  School App Yemen — Social Media Command Center
 *  File: SocialMediaManager.gs
 *  يضاف إلى مشروع CMS Apps Script
 *  المرجع: ملف الموقع/CMS (الشيت الرئيسي)
 * ═══════════════════════════════════════════════════════════════════
 */

var SMM_SPREADSHEET_ID = '1J7DY-Z2PZU5y5HH-LR3vhuEhPAkjWz22vMu1rYLcse0';
var SMM_DRIVE_FOLDER_ID = '13A82NOATnZTuk5EtVfo2hplZih5NFSnT';

// أسماء الأوراق
var SMM_SHEETS = {
  CALENDAR    : 'التقويم_السنوي',
  PLAN        : 'خطة_المحتوى',
  SCHEDULE    : 'Schedule',
  PUBLISHERS  : 'المسؤولين',
  TEMPLATES   : 'قوالب_المحتوى',
  ACTIVITIES  : 'الأنشطة_المدرسية',
  PUBLISH_LOG : 'سجل_النشر',
  ANALYTICS   : 'إحصائيات_المنصات',
  SOCIAL_SET  : 'اعدادات_السوشل'
};

// المنصات المدعومة
var SMM_PLATFORMS = ['فيسبوك', 'إنستغرام', 'واتساب', 'يوتيوب'];

// أنواع المحتوى لكل منصة
var SMM_POST_TYPES = {
  'فيسبوك'   : ['بوست', 'صورة', 'ألبوم', 'فيديو', 'ريلز', 'قصة'],
  'إنستغرام' : ['بوست', 'كاروسيل', 'ريلز', 'قصة', 'IGTV'],
  'واتساب'   : ['حالة', 'رسالة قناة', 'بث للمجموعات'],
  'يوتيوب'   : ['فيديو طويل', 'شورتس', 'بث مباشر']
};

// فئات المحتوى
var SMM_CATEGORIES = [
  'تهنئة', 'إعلان', 'خبر', 'نشاط', 'إنجاز',
  'تثقيفي', 'ترفيهي', 'تحفيزي', 'ديني', 'وطني', 'إداري',
  'قرآني', 'رحلة', 'مسابقة', 'تزكية', 'تفاعل', 'إرشاد', 'تسجيل'
];

// حالات المنشور (Workflow)
var SMM_STATUS = {
  DRAFT    : 'مسودة',
  REVIEW   : 'قيد المراجعة',
  APPROVED : 'معتمد',
  SCHEDULED: 'مجدول',
  PUBLISHED: 'منشور',
  FAILED   : 'فشل',
  ARCHIVED : 'مؤرشف'
};

// ─── Singleton للملف — يدعم تعدد المدارس (Multi-Tenant) ──────────
// يستخدم _activeFileId() التي تُضبط عبر _setActiveTenant() في ApiEndpoint.doPost
// لكل طلب GAS جديد context مستقل → لا تسرّب بين المدارس

var _smm_ss_cache    = null;  // كاش الـ Spreadsheet للطلب الحالي
var _smm_ss_cache_id = '';    // معرّف الملف المخزَّن في الكاش (لإعادة الفتح عند التغيّر)

function _smmGetSS() {
  // الأولوية: ملف المدرسة النشط (_activeFileId) → ثم الثابت (SMM_SPREADSHEET_ID)
  var fid = '';
  try {
    if (typeof _activeFileId === 'function') fid = _activeFileId();
  } catch (e) {}
  if (!fid) fid = SMM_SPREADSHEET_ID;

  // أعِد فتح الملف إن تغيّر (ضمان التوافق عند تغيير المدرسة النشطة)
  if (!_smm_ss_cache || _smm_ss_cache_id !== fid) {
    _smm_ss_cache    = SpreadsheetApp.openById(fid);
    _smm_ss_cache_id = fid;
  }
  return _smm_ss_cache;
}

function _smmGetSheet(name) {
  var ss    = _smmGetSS();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

// ─── دوال آمنة (متوافقة مع باقي المنظومة) ────────
function _smmSafeStr(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function _smmSafeNum(v) {
  var n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

function _smmGenId(prefix) {
  return prefix + '-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
}
// ═══════════════════════════════════════════════════════════════════
//  تهيئة المنظومة – يُنفّذ مرة واحدة عند الإعداد
// ═══════════════════════════════════════════════════════════════════

function smmSetupSystem() {
  // ✅ ضمان وجود SMM_SHEETS حتى لو تم مسحه من ملف آخر
  if (typeof SMM_SHEETS === 'undefined' || !SMM_SHEETS) {
    var SMM_SHEETS = {
      CALENDAR    : 'التقويم_السنوي',
      PLAN        : 'خطة_المحتوى',
      SCHEDULE    : 'Schedule',
      PUBLISHERS  : 'المسؤولين',
      TEMPLATES   : 'قوالب_المحتوى',
      ACTIVITIES  : 'الأنشطة_المدرسية',
      PUBLISH_LOG : 'سجل_النشر',
      ANALYTICS   : 'إحصائيات_المنصات'
    };
  }

    smmCreateCalendarSheet();
  smmCreatePlanSheet();
  smmCreatePublishersSheet();
  smmCreateTemplatesSheet();
  smmCreateActivitiesSheet();
  smmCreatePublishLogSheet();
  smmCreateAnalyticsSheet();
  smmCreateSocialSettingsSheet();
  smmSeedYearCalendar();
  smmSeedTemplates();
  smmAddMissingTemplates();
  smmApplyListValidations();
  Logger.log('✅ تم إنشاء جميع الأوراق وتهيئة النظام');
  return { success: true, message: 'تم الإعداد الكامل' };
}
function smmCreateCalendarSheet() {
  var sheet = _smmGetSheet(SMM_SHEETS.CALENDAR);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'ID', 'الأسبوع', 'تاريخ_البداية', 'تاريخ_النهاية',
      'الشهر_الدراسي', 'المناسبة', 'النوع', 'الأولوية',
      'الفصول_المستهدفة', 'عدد_المنشورات_المطلوبة', 'الحالة', 'ملاحظات'
    ]);
    sheet.getRange(1, 1, 1, 12).setBackground('#1a73e8').setFontColor('white').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function smmCreatePlanSheet() {
  var sheet = _smmGetSheet(SMM_SHEETS.PLAN);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'ID', 'calendar_id', 'الأسبوع', 'تاريخ_النشر_المخطط',
      'المنصة', 'نوع_المحتوى', 'الفئة', 'العنوان', 'النص',
      'الهاشتاقات', 'الوسائط_URL', 'الفصل_المرتبط',
      'النشاط_المرتبط', 'المسؤول', 'الحالة', 'الموافق',
      'تاريخ_الإنشاء', 'ملاحظات'
    ]);
    sheet.getRange(1, 1, 1, 18).setBackground('#34a853').setFontColor('white').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function smmCreatePublishersSheet() {
  var sheet = _smmGetSheet(SMM_SHEETS.PUBLISHERS);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'البريد', 'الاسم', 'الدور', 'المنصات_المسموحة',
      'الفصول_المسؤول_عنها', 'الحد_اليومي', 'نشط'
    ]);
    sheet.getRange(1, 1, 1, 7).setBackground('#fbbc04').setFontColor('white').setFontWeight('bold');
    sheet.setFrozenRows(1);
    // إضافة مدير افتراضي
    sheet.appendRow([
      'info@ebdaa-tamayuz.edu', 'مدير المحتوى',
      'مدير سوشيال', 'فيسبوك,إنستغرام,واتساب,يوتيوب',
      'الكل', 20, 'نعم'
    ]);
  }
}

function smmCreateTemplatesSheet() {
  var sheet = _smmGetSheet(SMM_SHEETS.TEMPLATES);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'ID', 'اسم_القالب', 'الفئة', 'المنصة',
      'النص_القالب', 'الهاشتاقات', 'عدد_الاستخدامات'
    ]);
    sheet.getRange(1, 1, 1, 7).setBackground('#9c27b0').setFontColor('white').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function smmCreateActivitiesSheet() {
  var sheet = _smmGetSheet(SMM_SHEETS.ACTIVITIES);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'ID', 'اسم_النشاط', 'النوع', 'الفصول_المشاركة',
      'المسؤول', 'تاريخ_البداية', 'تاريخ_النهاية',
      'المكان', 'الميزانية', 'الحالة', 'عدد_المنشورات_المرتبطة'
    ]);
    sheet.getRange(1, 1, 1, 11).setBackground('#ea4335').setFontColor('white').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function smmCreatePublishLogSheet() {
  var sheet = _smmGetSheet(SMM_SHEETS.PUBLISH_LOG);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Timestamp', 'plan_id', 'المنصة', 'post_id_خارجي',
      'الرابط', 'الحالة', 'السبب',
      'عدد_الإعجابات', 'عدد_التعليقات', 'عدد_المشاركات'
    ]);
    sheet.getRange(1, 1, 1, 10).setBackground('#5f6368').setFontColor('white').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function smmCreateAnalyticsSheet() {
  var sheet = _smmGetSheet(SMM_SHEETS.ANALYTICS);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'الشهر', 'المنصة', 'عدد_المنشورات', 'إجمالي_التفاعل',
      'متوسط_الإعجابات', 'أعلى_منشور', 'أقل_منشور', 'ملاحظات'
    ]);
    sheet.getRange(1, 1, 1, 8).setBackground('#00acc1').setFontColor('white').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  تعبئة التقويم السنوي – 40 أسبوع دراسي
// ═══════════════════════════════════════════════════════════════════

function smmSeedYearCalendar() {
  var sheet = _smmGetSheet(SMM_SHEETS.CALENDAR);
  if (sheet.getLastRow() > 1) {
    Logger.log('⚠️ التقويم معبأ مسبقاً — تم التخطي');
    return;
  }

  // ── المناسبات الثابتة في العام الدراسي ────────
  var occasions = [
    { week: 1,  occ: 'بداية العام الدراسي',          type: 'افتتاحية', prio: 'عالية',   posts: 5 },
    { week: 2,  occ: 'أسبوع التعريف بالمنهج',         type: 'أكاديمية', prio: 'متوسطة', posts: 3 },
    { week: 3,  occ: 'انتخابات المجلس الطلابي',       type: 'اجتماعية', prio: 'متوسطة', posts: 2 },
    { week: 4,  occ: 'اليوم العالمي للمعلم',          type: 'تكريمية', prio: 'عالية',   posts: 3 },
    { week: 6,  occ: 'احتفال المولد النبوي',          type: 'دينية',   prio: 'عالية',   posts: 4 },
    { week: 8,  occ: 'الأسبوع الثقافي',               type: 'ثقافية', prio: 'عالية',   posts: 5 },
    { week: 10, occ: 'اختبارات الشهر الأول',         type: 'أكاديمية', prio: 'متوسطة', posts: 2 },
    { week: 12, occ: 'اليوم الرياضي',                 type: 'رياضية', prio: 'عالية',   posts: 4 },
    { week: 14, occ: 'أسبوع الصحة المدرسية',          type: 'صحية',   prio: 'متوسطة', posts: 3 },
    { week: 16, occ: 'اختبارات نصف العام',            type: 'أكاديمية', prio: 'عالية',   posts: 3 },
    { week: 18, occ: 'الإجازة النصفية',               type: 'إجازة', prio: 'منخفضة', posts: 1 },
    { week: 20, occ: 'انطلاقة الفصل الثاني',          type: 'افتتاحية', prio: 'عالية',   posts: 3 },
    { week: 22, occ: 'الأسبوع العلمي',                type: 'علمية',   prio: 'عالية',   posts: 5 },
    { week: 24, occ: 'يوم اللغة العربية',             type: 'ثقافية', prio: 'متوسطة', posts: 3 },
    { week: 26, occ: 'مسابقة القرآن الكريم',          type: 'دينية',   prio: 'عالية',   posts: 4 },
    { week: 28, occ: 'معرض الفن والإبداع',            type: 'فنية',   prio: 'عالية',   posts: 5 },
    { week: 30, occ: 'اليوم المفتوح للأسرة',          type: 'اجتماعية', prio: 'عالية',   posts: 4 },
    { week: 32, occ: 'استعدادات الاختبارات النهائية', type: 'أكاديمية', prio: 'متوسطة', posts: 2 },
    { week: 34, occ: 'الاختبارات النهائية',           type: 'أكاديمية', prio: 'عالية',   posts: 3 },
    { week: 36, occ: 'حفل تكريم المتفوقين',           type: 'تكريمية', prio: 'عالية',   posts: 5 },
    { week: 38, occ: 'حفل التخرج',                    type: 'تكريمية', prio: 'عالية',   posts: 6 },
    { week: 40, occ: 'ختام العام الدراسي',            type: 'افتتاحية', prio: 'عالية',   posts: 4 }
  ];

  // ── ابدأ من السبت الأول من سبتمبر (افتراضياً) ──
  var startDate = new Date(new Date().getFullYear(), 8, 6);
  // إذا بدأ العام بالفعل، عُد إلى أقرب سبت
  while (startDate.getDay() !== 6) {
    startDate.setDate(startDate.getDate() + 1);
  }

  var monthMap = function(w) {
    if (w <= 8)  return 'محرم';
    if (w <= 16) return 'صفر';
    if (w <= 18) return 'نصف العام';
    if (w <= 26) return 'جماد اول';
    if (w <= 34) return 'جماد ثاني';
    return 'نهاية العام';
  };

  for (var w = 1; w <= 40; w++) {
    var weekStart = new Date(startDate.getTime() + (w - 1) * 7 * 86400000);
    var weekEnd   = new Date(weekStart.getTime() + 6 * 86400000);

    var occ = '';
    var type = 'عادي';
    var prio = 'منخفضة';
    var posts = 2;

    for (var k = 0; k < occasions.length; k++) {
      if (occasions[k].week === w) {
        occ   = occasions[k].occ;
        type  = occasions[k].type;
        prio  = occasions[k].prio;
        posts = occasions[k].posts;
        break;
      }
    }

    sheet.appendRow([
      'CAL-W' + (w < 10 ? '0' + w : w),
      w,
      Utilities.formatDate(weekStart, 'GMT+3', 'yyyy-MM-dd'),
      Utilities.formatDate(weekEnd,   'GMT+3', 'yyyy-MM-dd'),
      monthMap(w),
      occ,
      type,
      prio,
      'الكل',
      posts,
      'مخطط',
      ''
    ]);
  }
  Logger.log('✅ تم تعبئة 40 أسبوع');
}

// ═══════════════════════════════════════════════════════════════════
//  تعبئة قوالب المحتوى الافتراضية
// ═══════════════════════════════════════════════════════════════════

function smmSeedTemplates() {
  var sheet = _smmGetSheet(SMM_SHEETS.TEMPLATES);
  if (sheet.getLastRow() > 1) return;

  var templates = [
    ['TPL-001', 'تهنئة بالمولود الجديد', 'تهنئة', 'فيسبوك',
      '🎉 تتقدم إدارة مدارس الإبداع والتميز الدولية بأحرّ التهاني للأستاذ/ة {{اسم_المعلم}} بمناسبة المولود {{المولود}}. ألف مبروك! 🌟',
      '#مدارس_الابداع_والتميز #تهنئة', 0],
    ['TPL-002', 'تهنئة بالنجاح', 'تهنئة', 'فيسبوك',
      '🌟 مبروك للطالب/ة {{اسم_الطالب}} من فصل {{الفصل}} على حصوله/ها على المركز {{المركز}}. نفخر بكم! 🏆',
      '#متفوقي_الابداع #نفخر_بكم', 0],
    ['TPL-003', 'إعلان فعالية', 'إعلان', 'فيسبوك',
      '📢 يسر مدارس الإبداع والتميز الدولية دعوتكم لحضور {{اسم_الفعالية}} يوم {{التاريخ}} الساعة {{الوقت}} في {{المكان}}.',
      '#فعاليات_الابداع', 0],
    ['TPL-004', 'خبر إنجاز', 'إنجاز', 'إنستغرام',
      '🏆 إنجاز جديد يضاف لسجل مدارس الإبداع والتميز! حصد فصل {{الفصل}} على {{الإنجاز}} ✨',
      '#انجازات_الابداع #نفخر_بطلابنا', 0],
    ['TPL-005', 'بداية الأسبوع', 'تحفيزي', 'واتساب',
      '🌅 صباح الإبداع! نتمنى لطلابنا الأعزاء أسبوعاً مليئاً بالتفوق والإنجاز. 📚',
      '', 0],
    ['TPL-006', 'تذكير اختبار', 'إداري', 'واتساب',
      '📌 تذكير: اختبار مادة {{المادة}} للصف {{الصف}} يوم {{التاريخ}}. نتمنى التوفيق للجميع.',
      '', 0],
    ['TPL-007', 'مولد نبوي', 'ديني', 'فيسبوك',
      '🌙 بمناسبة ذكرى المولد النبوي الشريف، تتقدم إدارة المدرسة بأطيب التهاني. اللهم صلِّ وسلم على نبينا محمد.',
      '#المولد_النبوي', 0],
    ['TPL-008', 'يوم المعلم', 'تكريمية', 'فيسبوك',
      '👨‍🏫 شكراً لكل معلم ومعلمة في مدارس الإبداع والتميز. أنتم بناة الأجيال وصُنّاع المستقبل. 🌹',
      '#يوم_المعلم #شكرا_معلمي', 0],
    ['TPL-009', 'يوم وطني', 'وطني', 'فيسبوك',
      '🇾🇪 كل عام واليمن بألف خير. ترفع مدارس الإبداع والتميز أسمى آيات التهنئة بمناسبة {{المناسبة_الوطنية}}.',
      '#اليمن', 0],
    ['TPL-010', 'ريلز نشاط', 'نشاط', 'إنستغرام',
      '🎬 لقطات من {{اسم_النشاط}} مع طلاب {{الفصل}}. شاهدوا الإبداع! ✨',
      '#ريلز #نشاط_مدرسي', 0]
  ];

  for (var i = 0; i < templates.length; i++) {
    sheet.appendRow(templates[i]);
  }
  Logger.log('✅ تم إضافة ' + templates.length + ' قالب');
}

// ═══════════════════════════════════════════════════════════════════
//  قوالب إضافية (TPL-011..022) لتغطية محاور الخطة المعزّزة
//  idempotent: تُضيف الناقص فقط دون تكرار، وتعمل على ورقة موجودة أو جديدة.
//  نفس بنية الأعمدة السبعة ونمط الترقيم TPL-0xx.
// ═══════════════════════════════════════════════════════════════════
function smmAddMissingTemplates() {
  var sheet = _smmGetSheet(SMM_SHEETS.TEMPLATES);
  if (sheet.getLastRow() === 0) { smmCreateTemplatesSheet(); }

  var extra = [
    ['TPL-011', 'تكريم حافظ القرآن', 'قرآني', 'فيسبوك',
      '📖 تُبارك مدارس الإبداع والتميز الدولية للطالب/ة {{اسم_الطالب}} من {{الفصل}} إتمام حفظ {{المقدار}} من كتاب الله. جعله الله نوراً لكم ولوالديكم. 🌟',
      '#مدارس_الإبداع_والتميز #حفظة_القرآن', 0],
    ['TPL-012', 'من قلب الصف', 'نشاط', 'فيسبوك',
      '🏫 من قلب الصف | حصة مميزة للأستاذ/ة {{اسم_المعلم}} مع طلاب {{الفصل}}/{{الشعبة}}، حيث {{وصف_النشاط}}. هكذا نتعلّم بإبداع! ✨',
      '#مدارس_الإبداع_والتميز #من_قلب_الصف', 0],
    ['TPL-013', 'رحلة علمية', 'رحلة', 'إنستغرام',
      '🚌 رحلة علمية ممتعة لطلاب {{الفصل}} إلى {{الوجهة}}، جمعت بين المتعة والفائدة وترسيخ المعرفة بالتجربة المباشرة. 🌿',
      '#مدارس_الإبداع_والتميز #رحلات_تعليمية', 0],
    ['TPL-014', 'مسابقة طلابية', 'مسابقة', 'فيسبوك',
      '🏅 على هامش {{اسم_المسابقة}}، تألّق طلابنا وأثبتوا أن الإبداع عنوانهم. ألف مبروك للفائزين، ولكل مشاركٍ تحيةُ تقدير. 🎉',
      '#مدارس_الإبداع_والتميز #مسابقات_الإبداع', 0],
    ['TPL-015', 'تزكية ولي أمر', 'تزكية', 'فيسبوك',
      '💬 يقول وليّ أمر الطالب/ة {{اسم_الطالب}}: «{{نص_التزكية}}». شكراً لثقتكم التي نعتزّ بها، ونَعِدُكم بأن نكون عند حسن ظنّكم دائماً. 🤝',
      '#مدارس_الإبداع_والتميز #ثقة_تليق_بكم', 0],
    ['TPL-016', 'يوم مفتوح وجولة', 'إعلان', 'فيسبوك',
      '🚪 ندعوكم لزيارة مدارس الإبداع والتميز يوم {{التاريخ}} للاطّلاع على بيئتنا التعليمية وأنشطتنا عن قرب. أبوابنا مفتوحةٌ لأبنائكم ولثقتكم. 🌟',
      '#مدارس_الإبداع_والتميز #يوم_مفتوح', 0],
    ['TPL-017', 'إرشاد طلابي', 'إرشاد', 'إنستغرام',
      '🧭 ركن الإرشاد | {{عنوان_النصيحة}}: {{نص_النصيحة}}. نرافق أبناءنا تربوياً ونفسياً نحو شخصيةٍ متوازنةٍ وواثقة. 💙',
      '#مدارس_الإبداع_والتميز #إرشاد_طلابي', 0],
    ['TPL-018', 'تطبيق عملي للعبادات', 'ديني', 'فيسبوك',
      '🕌 تطبيق عملي | تدرّب طلاب {{الفصل}} على {{العبادة}} بإشراف معلميهم، لنربط العلم بالعمل والقيمة بالسلوك. 🤲',
      '#مدارس_الإبداع_والتميز #تربية_بالقدوة', 0],
    ['TPL-019', 'تفاعل مباشر', 'تفاعل', 'إنستغرام',
      '❓ سؤال اليوم: {{السؤال}} — شاركونا إجابتكم في التعليقات، ولنرَ أجمل المشاركات! ✍️',
      '#مدارس_الإبداع_والتميز #شاركنا_رأيك', 0],
    ['TPL-020', 'المنظومة الرقمية', 'إعلان', 'فيسبوك',
      '📲 في مدارس الإبداع والتميز، يتابع وليّ الأمر درجات ابنه وحضوره وواجباته لحظةً بلحظة عبر منصاتنا الرقمية. تعليمٌ شفّافٌ ومتابعةٌ دقيقة. ✅',
      '#مدارس_الإبداع_والتميز #تعليم_رقمي', 0],
    ['TPL-021', 'ريلز أسبوعي', 'نشاط', 'إنستغرام',
      '🎬 ريلز الأسبوع | لقطاتٌ من {{اسم_النشاط}} مع طلاب {{الفصل}}. الإبداع يُرى ولا يوصف! ✨',
      '#مدارس_الإبداع_والتميز #ريلز_الإبداع', 0],
    ['TPL-022', 'تسجيل مثبّت', 'تسجيل', 'فيسبوك',
      '📌 سجّل أبناءك في مدارس الإبداع والتميز الدولية — صنعاء، السنينة، حي الطيران. المقاعد محدودة لكل فصل ضماناً للجودة. للحجز والاستفسار واتساب: 775189922. 🌟',
      '#مدارس_الإبداع_والتميز #سجل_الآن', 0]
  ];

  var existing = {};
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { existing[_smmSafeStr(data[i][0])] = true; }

  var added = 0;
  for (var j = 0; j < extra.length; j++) {
    if (!existing[extra[j][0]]) { sheet.appendRow(extra[j]); added++; }
  }
  Logger.log('✅ أُضيف ' + added + ' قالب جديد (TPL-011..022)');
  return { success: true, added: added };
}

// ═══════════════════════════════════════════════════════════════════
//  قوائم التحقق المنسدلة على ورقة «خطة_المحتوى»
//  الأعمدة: المنصة(5) ← SMM_PLATFORMS، الفئة(7) ← SMM_CATEGORIES، الحالة(15) ← SMM_STATUS
//  idempotent: آمنة لإعادة التشغيل؛ setAllowInvalid(true) كي لا تُرفض القيم القائمة.
// ═══════════════════════════════════════════════════════════════════
function smmApplyListValidations() {
  var sheet = _smmGetSheet(SMM_SHEETS.PLAN);
  if (sheet.getLastRow() === 0) { smmCreatePlanSheet(); }
  var rows = sheet.getMaxRows() - 1;
  if (rows < 1) rows = 1;

  var statusVals = [
    SMM_STATUS.DRAFT, SMM_STATUS.REVIEW, SMM_STATUS.APPROVED, SMM_STATUS.SCHEDULED,
    SMM_STATUS.PUBLISHED, SMM_STATUS.FAILED, SMM_STATUS.ARCHIVED
  ];

  sheet.getRange(2, 5, rows, 1).setDataValidation(_smmListRule(SMM_PLATFORMS));
  sheet.getRange(2, 7, rows, 1).setDataValidation(_smmListRule(SMM_CATEGORIES));
  sheet.getRange(2, 15, rows, 1).setDataValidation(_smmListRule(statusVals));

  Logger.log('✅ طُبّقت قوائم التحقق على خطة المحتوى');
  return { success: true };
}

function _smmListRule(values) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(true)
    .build();
}

// ═══════════════════════════════════════════════════════════════════
//  بيانات حسابات السوشل لكل مدرسة (ورقة «اعدادات_السوشل»)
//  الأعمدة: school_id|fb_page_id|fb_page_token|ig_business_id|wa_phone_id|
//           wa_token|wa_recipients|yt_channel_url|updated_at
//  أمان: لا تُعاد التوكنات الخام للعميل (تُقنَّع)؛ الحفظ يحدّث الحقول غير الفارغة فقط.
// ═══════════════════════════════════════════════════════════════════
var _SMM_SET_COLS = ['school_id', 'fb_page_id', 'fb_page_token', 'ig_business_id', 'wa_phone_id', 'wa_token', 'wa_recipients', 'yt_channel_url', 'updated_at'];

function smmCreateSocialSettingsSheet() {
  var sheet = _smmGetSheet(SMM_SHEETS.SOCIAL_SET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(_SMM_SET_COLS);
    sheet.getRange(1, 1, 1, _SMM_SET_COLS.length).setBackground('#0f3b5c').setFontColor('white').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function _smmSetRowIndex(sheet, schoolId) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (_smmSafeStr(data[i][0]) === _smmSafeStr(schoolId)) return i + 1;
  }
  return -1;
}

// حفظ/تحديث بيانات مدرسة (الحقول غير الفارغة فقط) — عام (من واجهة CMS)
function smmSaveSocialSettings(schoolId, obj) {
  try {
    obj = obj || {};
    schoolId = _smmSafeStr(schoolId) || 'default';
    smmCreateSocialSettingsSheet();
    var sheet = _smmGetSheet(SMM_SHEETS.SOCIAL_SET);
    var idx = _smmSetRowIndex(sheet, schoolId);
    if (idx === -1) { sheet.appendRow([schoolId, '', '', '', '', '', '', '', '']); idx = sheet.getLastRow(); }
    var map = { fb_page_id: 2, fb_page_token: 3, ig_business_id: 4, wa_phone_id: 5, wa_token: 6, wa_recipients: 7, yt_channel_url: 8 };
    for (var key in map) {
      if (map.hasOwnProperty(key)) {
        var v = _smmSafeStr(obj[key]);
        if (v) sheet.getRange(idx, map[key]).setValue(v);
      }
    }
    sheet.getRange(idx, 9).setValue(new Date());
    return { success: true, message: 'تم حفظ بيانات حسابات المدرسة: ' + schoolId };
  } catch (e) {
    return { success: false, error: String((e && e.message) || e) };
  }
}

function _smmMask(v) {
  v = _smmSafeStr(v);
  if (!v) return '';
  if (v.length <= 6) return '••••';
  return '••••' + v.substring(v.length - 4);
}

// جلب البيانات للعرض (التوكنات مُقنَّعة) — عام
function smmGetSocialSettings(schoolId) {
  try {
    schoolId = _smmSafeStr(schoolId) || 'default';
    var sheet = _smmGetSheet(SMM_SHEETS.SOCIAL_SET);
    if (!sheet || sheet.getLastRow() === 0) return { success: true, settings: { school_id: schoolId } };
    var idx = _smmSetRowIndex(sheet, schoolId);
    if (idx === -1) return { success: true, settings: { school_id: schoolId } };
    var r = sheet.getRange(idx, 1, 1, _SMM_SET_COLS.length).getValues()[0];
    return {
      success: true,
      settings: {
        school_id: _smmSafeStr(r[0]),
        fb_page_id: _smmSafeStr(r[1]),
        fb_page_token_mask: _smmMask(r[2]), has_fb_token: !!_smmSafeStr(r[2]),
        ig_business_id: _smmSafeStr(r[3]),
        wa_phone_id: _smmSafeStr(r[4]),
        wa_token_mask: _smmMask(r[5]), has_wa_token: !!_smmSafeStr(r[5]),
        wa_recipients: _smmSafeStr(r[6]),
        yt_channel_url: _smmSafeStr(r[7]),
        updated_at: r[8] ? String(r[8]) : ''
      }
    };
  } catch (e) {
    return { success: false, error: String((e && e.message) || e) };
  }
}

// محلّل التوكنات: بيانات المدرسة → الافتراضي 'default' → ScriptProperties (توافق رجعي)
function _smmTokens(schoolId) {
  var out = { fbPageId: '', fbPageToken: '', igBusinessId: '', waPhoneId: '', waToken: '', waRecipients: '', ytChannel: '' };
  function fromRow(r) {
    if (!r) return;
    if (!out.fbPageId)     out.fbPageId     = _smmSafeStr(r[1]);
    if (!out.fbPageToken)  out.fbPageToken  = _smmSafeStr(r[2]);
    if (!out.igBusinessId) out.igBusinessId = _smmSafeStr(r[3]);
    if (!out.waPhoneId)    out.waPhoneId    = _smmSafeStr(r[4]);
    if (!out.waToken)      out.waToken      = _smmSafeStr(r[5]);
    if (!out.waRecipients) out.waRecipients = _smmSafeStr(r[6]);
    if (!out.ytChannel)    out.ytChannel    = _smmSafeStr(r[7]);
  }
  try {
    var sheet = _smmGetSheet(SMM_SHEETS.SOCIAL_SET);
    if (sheet && sheet.getLastRow() > 1) {
      var data = sheet.getDataRange().getValues();
      var want = _smmSafeStr(schoolId);
      if (want) { for (var i = 1; i < data.length; i++) { if (_smmSafeStr(data[i][0]) === want) { fromRow(data[i]); break; } } }
      for (var j = 1; j < data.length; j++) { if (_smmSafeStr(data[j][0]) === 'default') { fromRow(data[j]); break; } }
    }
  } catch (e) {}
  try {
    var p = PropertiesService.getScriptProperties();
    if (!out.fbPageId)     out.fbPageId     = p.getProperty('FB_PAGE_ID') || '';
    if (!out.fbPageToken)  out.fbPageToken  = p.getProperty('FB_PAGE_TOKEN') || '';
    if (!out.igBusinessId) out.igBusinessId = p.getProperty('IG_BUSINESS_ID') || '';
    if (!out.waPhoneId)    out.waPhoneId    = p.getProperty('WA_PHONE_ID') || '';
    if (!out.waToken)      out.waToken      = p.getProperty('WA_TOKEN') || '';
    if (!out.waRecipients) out.waRecipients = p.getProperty('WA_RECIPIENTS') || '';
    if (!out.ytChannel)    out.ytChannel    = p.getProperty('YT_CHANNEL_URL') || '';
  } catch (e) {}
  return out;
}
// ═══════════════════════════════════════════════════════════════════
//  إنشاء منشور جديد ضمن خطة المحتوى
// ═══════════════════════════════════════════════════════════════════

function smmAddPlanItem(data) {
  try {
    var sheet = _smmGetSheet(SMM_SHEETS.PLAN);
    var id = _smmGenId('PLAN');
    var user = Session.getActiveUser().getEmail() || 'admin@ebdaa-tamayuz.edu';

    sheet.appendRow([
      id,
      _smmSafeStr(data.calendar_id),
      _smmSafeNum(data.week),
      _smmSafeStr(data.scheduled_date),
      _smmSafeStr(data.platform),
      _smmSafeStr(data.post_type),
      _smmSafeStr(data.category),
      _smmSafeStr(data.title),
      _smmSafeStr(data.content),
      _smmSafeStr(data.hashtags),
      _smmSafeStr(data.media_url),
      _smmSafeStr(data.related_class),
      _smmSafeStr(data.related_activity),
      _smmSafeStr(data.responsible),
      SMM_STATUS.DRAFT,
      '',
      new Date(),
      _smmSafeStr(data.notes)
    ]);

    return { success: true, id: id, message: 'تم إضافة المنشور إلى الخطة' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  جلب خطة المحتوى مع فلاتر
// ═══════════════════════════════════════════════════════════════════

function smmGetPlan(filters) {
  filters = filters || {};
  var sheet = _smmGetSheet(SMM_SHEETS.PLAN);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var headers = data[0];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var item = {};
    for (var c = 0; c < headers.length; c++) {
      item[headers[c]] = row[c];
    }
    item.row_index = i + 1;

    // فلترة
    if (filters.week && _smmSafeNum(item['الأسبوع']) !== _smmSafeNum(filters.week)) continue;
    if (filters.platform && item['المنصة'] !== filters.platform) continue;
    if (filters.status && item['الحالة'] !== filters.status) continue;
    if (filters.responsible && item['المسؤول'] !== filters.responsible) continue;
    if (filters.category && item['الفئة'] !== filters.category) continue;

    result.push(item);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
//  تغيير حالة منشور (Workflow)
// ═══════════════════════════════════════════════════════════════════

function smmUpdateStatus(planId, newStatus, approverEmail) {
  var validStatuses = [
    SMM_STATUS.DRAFT, SMM_STATUS.REVIEW, SMM_STATUS.APPROVED,
    SMM_STATUS.SCHEDULED, SMM_STATUS.PUBLISHED,
    SMM_STATUS.FAILED, SMM_STATUS.ARCHIVED
  ];
  if (validStatuses.indexOf(newStatus) === -1) {
    return { success: false, error: 'حالة غير صحيحة' };
  }

  var sheet = _smmGetSheet(SMM_SHEETS.PLAN);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (_smmSafeStr(data[i][0]) === _smmSafeStr(planId)) {
      sheet.getRange(i + 1, 15).setValue(newStatus); // عمود الحالة
      if (newStatus === SMM_STATUS.APPROVED) {
        sheet.getRange(i + 1, 16).setValue(approverEmail || ''); // الموافق
        // ربط تلقائي: ترحيل المعتمد إلى الجدولة فوراً ليُنشره الـ Trigger
        try { smmPromoteToSchedule(planId); } catch (e) { Logger.log('auto-promote: ' + e.message); }
      }
      return { success: true, message: 'تم تحديث الحالة إلى: ' + newStatus };
    }
  }
  return { success: false, error: 'منشور غير موجود' };
}

// ═══════════════════════════════════════════════════════════════════
//  ترحيل منشور معتمد إلى ورقة Schedule (للنشر التلقائي)
// ═══════════════════════════════════════════════════════════════════

function smmPromoteToSchedule(planId) {
  var planSheet = _smmGetSheet(SMM_SHEETS.PLAN);
  var planData = planSheet.getDataRange().getValues();
  var headers = planData[0];

  for (var i = 1; i < planData.length; i++) {
    if (_smmSafeStr(planData[i][0]) !== _smmSafeStr(planId)) continue;

    var item = {};
    for (var c = 0; c < headers.length; c++) {
      item[headers[c]] = planData[i][c];
    }

    if (item['الحالة'] !== SMM_STATUS.APPROVED) {
      return { success: false, error: 'لا يمكن جدولة منشور غير معتمد' };
    }

    // إضافة إلى Schedule
    var scheduleSheet = _smmGetSheet(SMM_SHEETS.SCHEDULE);
    var fullContent = item['العنوان'] + '\n\n' + item['النص'];
    if (item['الهاشتاقات']) fullContent += '\n\n' + item['الهاشتاقات'];

    var promoteSchoolId = _smmSafeStr(item['school_id'] || item['معرف_المدرسة'] || '');
    scheduleSheet.appendRow([
      new Date(),
      item['المنصة'],
      item['نوع_المحتوى'],
      fullContent,
      item['الوسائط_URL'],
      (item['تاريخ_النشر_المخطط'] || new Date()), // بلا موعد محدد → الآن (يُنشر بالتشغيل التالي)
      'مجدول',
      Session.getActiveUser().getEmail() || '',
      item['المسؤول'],
      'مرحَّل من الخطة: ' + planId,
      promoteSchoolId             // [10] school_id للتوكنات لكل مدرسة
    ]);

    // تحديث حالة المنشور
    planSheet.getRange(i + 1, 15).setValue(SMM_STATUS.SCHEDULED);

    return { success: true, message: 'تم ترحيل المنشور للجدولة' };
  }
  return { success: false, error: 'منشور غير موجود' };
}

// ═══════════════════════════════════════════════════════════════════
//  بناء منشور من قالب مع استبدال المتغيرات
// ═══════════════════════════════════════════════════════════════════

function smmBuildFromTemplate(templateId, variables) {
  var sheet = _smmGetSheet(SMM_SHEETS.TEMPLATES);
  var data = sheet.getDataRange().getValues();
  variables = variables || {};

  for (var i = 1; i < data.length; i++) {
    if (_smmSafeStr(data[i][0]) === _smmSafeStr(templateId)) {
      var text = _smmSafeStr(data[i][4]);
      var hashtags = _smmSafeStr(data[i][5]);

      // استبدال المتغيرات {{key}}
      for (var key in variables) {
        if (variables.hasOwnProperty(key)) {
          var re = new RegExp('{{' + key + '}}', 'g');
          text = text.replace(re, variables[key]);
        }
      }

      // زيادة عداد الاستخدامات
      sheet.getRange(i + 1, 7).setValue(_smmSafeNum(data[i][6]) + 1);

      return {
        success: true,
        content: text,
        hashtags: hashtags,
        category: _smmSafeStr(data[i][2]),
        platform: _smmSafeStr(data[i][3])
      };
    }
  }
  return { success: false, error: 'قالب غير موجود' };
}

// ═══════════════════════════════════════════════════════════════════
//  النشر إلى واتساب (Cloud Business API)
//  يتطلب: WA_PHONE_ID, WA_TOKEN, WA_RECIPIENT في ScriptProperties
// ═══════════════════════════════════════════════════════════════════

function publishToWhatsApp(message, mediaUrl) {
  var props = PropertiesService.getScriptProperties();
  var phoneId = props.getProperty('WA_PHONE_ID');
  var token = props.getProperty('WA_TOKEN');
  var recipients = props.getProperty('WA_RECIPIENTS'); // مفصولة بفواصل

  if (!phoneId || !token || !recipients) {
    return { success: false, error: 'لم يتم إعداد WhatsApp API' };
  }

  var endpoint = 'https://graph.facebook.com/v18.0/' + phoneId + '/messages';
  var nums = recipients.split(',');
  var sent = 0, failed = 0;

  for (var i = 0; i < nums.length; i++) {
    var num = nums[i].replace(/\s/g, '');
    if (!num) continue;
    var payload;
    if (mediaUrl) {
      payload = {
        messaging_product: 'whatsapp',
        to: num,
        type: 'image',
        image: { link: mediaUrl, caption: message }
      };
    } else {
      payload = {
        messaging_product: 'whatsapp',
        to: num,
        type: 'text',
        text: { body: message }
      };
    }

    try {
      var resp = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      var result = JSON.parse(resp.getContentText());
      if (result.messages && result.messages[0].id) sent++;
      else failed++;
    } catch (e) {
      failed++;
    }
  }
  return {
    success: sent > 0,
    sent: sent,
    failed: failed,
    message: 'تم الإرسال إلى ' + sent + ' من ' + nums.length
  };
}

// ═══════════════════════════════════════════════════════════════════
//  النشر إلى يوتيوب (يفتح رابط الرفع — لا يدعم API مباشرة بسهولة)
//  استراتيجية: حفظ المنشور كـ "جاهز" ويفتح رابط الرفع للمستخدم
// ═══════════════════════════════════════════════════════════════════

// استخراج معرّف ملف Drive من رابط/معرّف
function _smmExtractDriveId(u) {
  u = _smmSafeStr(u);
  if (!u) return '';
  var m = u.match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

// رفع تلقائي على يوتيوب — يتطلب تفعيل «YouTube Data API v3» المتقدمة + موافقة OAuth.
// إن لم تُفعّل الخدمة، يسجّل تذكيراً بالرفع اليدوي (سلوك آمن لا يكسر الجدولة).
function publishToYouTube(title, description, videoFileId) {
  try {
    if (typeof YouTube === 'undefined' || !YouTube.Videos) {
      _smmGetSheet(SMM_SHEETS.PUBLISH_LOG).appendRow([
        new Date(), '', 'يوتيوب', '', 'https://studio.youtube.com/',
        'يتطلب رفع يدوي', 'فعّل خدمة YouTube Data API المتقدمة للرفع التلقائي', 0, 0, 0
      ]);
      return { success: true, manual: true, message: 'فعّل خدمة YouTube المتقدمة للرفع التلقائي، أو ارفع يدوياً', uploadUrl: 'https://studio.youtube.com/' };
    }
    var fileId = _smmExtractDriveId(videoFileId);
    if (!fileId) return { success: false, error: 'لا يوجد ملف فيديو في Drive للرفع على يوتيوب' };

    var blob = DriveApp.getFileById(fileId).getBlob();
    var resource = {
      snippet: { title: _smmSafeStr(title) || 'فيديو مدرسي', description: _smmSafeStr(description) || '' },
      status: { privacyStatus: 'public' }
    };
    var res = YouTube.Videos.insert(resource, 'snippet,status', blob);
    if (res && res.id) {
      return { success: true, postId: res.id, message: 'تم الرفع على يوتيوب', url: 'https://youtu.be/' + res.id };
    }
    return { success: false, error: 'فشل الرفع على يوتيوب' };
  } catch (e) {
    return { success: false, error: 'يوتيوب: ' + ((e && e.message) ? e.message : String(e)) };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  معالج موسّع — يدعم 4 منصات (يستبدل processScheduledPosts)
// ═══════════════════════════════════════════════════════════════════

function smmProcessScheduled() {
  var sheet = _smmGetSheet(SMM_SHEETS.SCHEDULE);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return;

  var now = new Date().getTime();
  var logSheet = _smmGetSheet(SMM_SHEETS.PUBLISH_LOG);

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var platform   = _smmSafeStr(row[1]);
    var content    = _smmSafeStr(row[3]);
    var mediaUrl   = _smmSafeStr(row[4]);
    var scheduledDate = row[5];
    var status     = _smmSafeStr(row[6]);
    var schoolId   = _smmSafeStr(row[10]); // [10] school_id (يُحفظ من addSchedule/smmPromoteToSchedule)

    // تجاوز الصفوف غير المجدولة أو سبق نشرها
    if (status !== 'مجدول' && status !== 'scheduled' && status !== SMM_STATUS.SCHEDULED) continue;
    if (!content && !mediaUrl) continue;

    // التحقق من الوقت
    if (!scheduledDate) continue;
    var scheduleTime = (Object.prototype.toString.call(scheduledDate) === '[object Date]')
      ? scheduledDate.getTime() : new Date(scheduledDate).getTime();
    if (isNaN(scheduleTime) || scheduleTime > now) continue;

    // ✅ تفعيل بيانات المدرسة الصحيحة (Tenant) للحصول على التوكنات
    if (typeof _setActiveTenant === 'function' && schoolId) {
      try { _setActiveTenant(schoolId); } catch (e) {}
    }

    var result;
    var platformLc = platform.toLowerCase();
    try {
      if (platform === 'فيسبوك' || platformLc === 'facebook') {
        result = publishToFacebook(content, mediaUrl, schoolId);
      } else if (platform === 'إنستغرام' || platformLc === 'instagram') {
        result = publishToInstagram(content, mediaUrl, schoolId);
      } else if (platform === 'واتساب' || platformLc === 'whatsapp') {
        result = publishToWhatsApp(content, mediaUrl);
      } else if (platform === 'يوتيوب' || platformLc === 'youtube') {
        result = publishToYouTube('منشور من المنظومة', content, mediaUrl);
      } else {
        Logger.log('smmProcessScheduled: منصة غير معروفة «' + platform + '» (صف ' + (i + 1) + ')');
        continue;
      }
    } catch (pubErr) {
      result = { success: false, error: String((pubErr && pubErr.message) || pubErr) };
    }

    if (result && result.success) {
      sheet.getRange(i + 1, 7).setValue(SMM_STATUS.PUBLISHED + ' — ' + (result.postId || result.message || ''));
      logSheet.appendRow([
        new Date(), schoolId, platform, _smmSafeStr(result.postId),
        mediaUrl, 'نجح', '', 0, 0, 0
      ]);
    } else {
      var errMsg = result ? _smmSafeStr(result.error) : 'خطأ غير معروف';
      sheet.getRange(i + 1, 7).setValue('❌ فشل: ' + errMsg);
      logSheet.appendRow([
        new Date(), schoolId, platform, '',
        mediaUrl, 'فشل', errMsg, 0, 0, 0
      ]);
      Logger.log('smmProcessScheduled: فشل النشر على «' + platform + '»: ' + errMsg);
    }
  }
  Logger.log('smmProcessScheduled: اكتمل المسح — ' + (data.length - 1) + ' صف');
}

// ═══════════════════════════════════════════════════════════════════
//  نشر فوري (بدون انتظار Trigger) — يُستدعى من الواجهة أو يدوياً
//  @param {string} schoolId
//  @return {{success:boolean, published:number, failed:number, details:Array}}
// ═══════════════════════════════════════════════════════════════════
function smmPublishNow(schoolId) {
  schoolId = _smmSafeStr(schoolId);
  smmProcessScheduled(); // يعالج كل الصفوف المجدولة فوراً
  return { success: true, message: 'تم تشغيل معالج النشر — راجع ورقة Schedule وسجل_النشر للنتائج' };
}

// اختبار توكن الاتصال بفيسبوك لمدرسة — يُستدعى من الواجهة
function smmTestFbConnection(schoolId) {
  var tk = _smmTokens(_smmSafeStr(schoolId));
  if (!tk || !tk.fbPageToken) {
    return { success: false, error: 'لا يوجد توكن فيسبوك. أضِفه عبر تبويب «⚙️ حسابات السوشل» أو زر «اتصل بفيسبوك».' };
  }
  try {
    var resp = UrlFetchApp.fetch(
      'https://graph.facebook.com/v18.0/me?access_token=' + encodeURIComponent(tk.fbPageToken),
      { method: 'get', muteHttpExceptions: true }
    );
    var json = JSON.parse(resp.getContentText());
    if (json.id) {
      return { success: true, message: 'الاتصال صحيح ✅ — صفحة: ' + (json.name || json.id) };
    }
    return { success: false, error: 'التوكن غير صالح: ' + (json.error ? json.error.message : JSON.stringify(json)) };
  } catch (e) {
    return { success: false, error: String((e && e.message) || e) };
  }
}

// تثبيت Trigger الموحد
function smmInstallTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'smmProcessScheduled' ||
        triggers[i].getHandlerFunction() === 'processScheduledPosts') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('smmProcessScheduled')
    .timeBased().everyMinutes(5).create();
  return { success: true, message: 'تم تثبيت Trigger كل 5 دقائق' };
}
// ═══════════════════════════════════════════════════════════════════
//  لوحة معلومات شاملة للسوشيال
// ═══════════════════════════════════════════════════════════════════

function smmGetDashboard() {
  var planSheet = _smmGetSheet(SMM_SHEETS.PLAN);
  var calSheet = _smmGetSheet(SMM_SHEETS.CALENDAR);
  var logSheet = _smmGetSheet(SMM_SHEETS.PUBLISH_LOG);

  var planData = planSheet.getDataRange().getValues();
  var calData = calSheet.getDataRange().getValues();
  var logData = logSheet.getDataRange().getValues();

  var stats = {
    total_planned: planData.length - 1,
    draft: 0, review: 0, approved: 0, scheduled: 0,
    published: 0, failed: 0,
    by_platform: { 'فيسبوك': 0, 'إنستغرام': 0, 'واتساب': 0, 'يوتيوب': 0 },
    current_week: null,
    upcoming_week: null,
    success_rate: 0
  };

  for (var i = 1; i < planData.length; i++) {
    var status = _smmSafeStr(planData[i][14]);
    var platform = _smmSafeStr(planData[i][4]);

    if (status === SMM_STATUS.DRAFT) stats.draft++;
    else if (status === SMM_STATUS.REVIEW) stats.review++;
    else if (status === SMM_STATUS.APPROVED) stats.approved++;
    else if (status === SMM_STATUS.SCHEDULED) stats.scheduled++;
    else if (status === SMM_STATUS.PUBLISHED) stats.published++;
    else if (status === SMM_STATUS.FAILED) stats.failed++;

    if (stats.by_platform.hasOwnProperty(platform)) {
      stats.by_platform[platform]++;
    }
  }

  // الأسبوع الحالي والقادم
  var today = new Date();
  for (var j = 1; j < calData.length; j++) {
    var start = new Date(calData[j][2]);
    var end = new Date(calData[j][3]);
    if (today >= start && today <= end) {
      stats.current_week = {
        id: calData[j][0], week: calData[j][1],
        occasion: calData[j][5], type: calData[j][6]
      };
    }
    if (today < start && !stats.upcoming_week) {
      stats.upcoming_week = {
        id: calData[j][0], week: calData[j][1],
        occasion: calData[j][5], date: calData[j][2]
      };
    }
  }

  // نسبة النجاح
  var totalAttempts = 0, totalSuccess = 0;
  for (var k = 1; k < logData.length; k++) {
    totalAttempts++;
    if (_smmSafeStr(logData[k][5]) === 'نجح') totalSuccess++;
  }
  stats.success_rate = totalAttempts > 0
    ? Math.round((totalSuccess / totalAttempts) * 100) : 0;

  // ✅ حقول إضافية للتوافق مع لوحة التحكم في منصة المعلم
  stats.total       = stats.total_planned;
  stats.statusCounts = {};
  stats.statusCounts[SMM_STATUS.DRAFT]     = stats.draft;
  stats.statusCounts[SMM_STATUS.REVIEW]    = stats.review;
  stats.statusCounts[SMM_STATUS.APPROVED]  = stats.approved;
  stats.statusCounts[SMM_STATUS.SCHEDULED] = stats.scheduled;
  stats.statusCounts[SMM_STATUS.PUBLISHED] = stats.published;
  stats.statusCounts[SMM_STATUS.FAILED]    = stats.failed;

  // آخر 5 منشورات (من خطة المحتوى — الأحدث أولاً)
  var recent = [];
  for (var r = planData.length - 1; r >= 1 && recent.length < 5; r--) {
    var pHeaders = planData[0];
    var rItem = {};
    for (var rc = 0; rc < pHeaders.length; rc++) {
      rItem[pHeaders[rc]] = planData[r][rc];
    }
    recent.push({
      id:          _smmSafeStr(rItem['معرف_المنشور'] || ''),
      title:       _smmSafeStr(rItem['العنوان'] || rItem['النص'] || ''),
      content:     _smmSafeStr(rItem['النص'] || ''),
      status:      _smmSafeStr(rItem['الحالة'] || ''),
      platform:    _smmSafeStr(rItem['المنصة'] || ''),
      scheduledAt: _smmSafeStr(rItem['تاريخ_النشر_المخطط'] || ''),
      createdAt:   _smmSafeStr(rItem['تاريخ_الإنشاء'] || '')
    });
  }
  stats.recentPosts = recent;

  return stats;
}

// ═══════════════════════════════════════════════════════════════════
//  جلب التقويم السنوي
// ═══════════════════════════════════════════════════════════════════

function smmGetCalendar() {
  var sheet = _smmGetSheet(SMM_SHEETS.CALENDAR);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var c = 0; c < headers.length; c++) {
      row[headers[c]] = data[i][c];
    }
    result.push(row);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
//  جلب القوالب
// ═══════════════════════════════════════════════════════════════════

function smmGetTemplates(platform) {
  var sheet = _smmGetSheet(SMM_SHEETS.TEMPLATES);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    if (platform && _smmSafeStr(data[i][3]) !== platform) continue;
    result.push({
      id: data[i][0], name: data[i][1], category: data[i][2],
      platform: data[i][3], text: data[i][4],
      hashtags: data[i][5], uses: data[i][6]
    });
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
//  إضافة نشاط مدرسي مع توليد منشورات تلقائية
// ═══════════════════════════════════════════════════════════════════

function smmAddActivity(data) {
  var sheet = _smmGetSheet(SMM_SHEETS.ACTIVITIES);
  var id = _smmGenId('ACT');
  sheet.appendRow([
    id, _smmSafeStr(data.name), _smmSafeStr(data.type),
    _smmSafeStr(data.classes), _smmSafeStr(data.responsible),
    _smmSafeStr(data.start_date), _smmSafeStr(data.end_date),
    _smmSafeStr(data.location), _smmSafeNum(data.budget),
    'مخطط', 0
  ]);

  // توليد منشورات تلقائية: قبل + خلال + بعد
  if (data.auto_generate_posts) {
    var posts = [
      { offset: -3, cat: 'إعلان', title: 'قريباً: ' + data.name },
      { offset: 0,  cat: 'نشاط',  title: 'انطلاق: ' + data.name },
      { offset: 1,  cat: 'إنجاز', title: 'ختام: ' + data.name }
    ];
    var startDate = new Date(data.start_date);
    for (var p = 0; p < posts.length; p++) {
      var postDate = new Date(startDate.getTime() + posts[p].offset * 86400000);
      smmAddPlanItem({
        calendar_id: '',
        week: 0,
        scheduled_date: postDate,
        platform: 'فيسبوك',
        post_type: 'بوست',
        category: posts[p].cat,
        title: posts[p].title,
        content: 'تفاصيل قادمة عن ' + data.name,
        hashtags: '#الابداع_والتميز',
        related_class: data.classes,
        related_activity: id,
        responsible: data.responsible,
        notes: 'تم توليده تلقائياً مع النشاط'
      });
    }
  }
  return { success: true, id: id };
}
function smmMonthlyReport(month, year) {
  var planSheet = _smmGetSheet(SMM_SHEETS.PLAN);
  var data = planSheet.getDataRange().getValues();
  var stats = {
    total: 0, published: 0, failed: 0,
    by_category: {}, by_platform: {}, by_responsible: {}
  };

  var targetMonth = month + '-' + year;
  for (var i = 1; i < data.length; i++) {
    var date = data[i][3];
    if (!date) continue;
    var d = new Date(date);
    var key = (d.getMonth() + 1) + '-' + d.getFullYear();
    if (key !== targetMonth) continue;

    stats.total++;
    var status = _smmSafeStr(data[i][14]);
    var cat = _smmSafeStr(data[i][6]);
    var plat = _smmSafeStr(data[i][4]);
    var resp = _smmSafeStr(data[i][13]);

    if (status === SMM_STATUS.PUBLISHED) stats.published++;
    if (status === SMM_STATUS.FAILED) stats.failed++;
    stats.by_category[cat] = (stats.by_category[cat] || 0) + 1;
    stats.by_platform[plat] = (stats.by_platform[plat] || 0) + 1;
    stats.by_responsible[resp] = (stats.by_responsible[resp] || 0) + 1;
  }
  return stats;
}
function setupEverything() {
  smmSetupSystem();
  Logger.log('تم إنشاء جميع الأوراق وتهيئة النظام');
}