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
  ANALYTICS   : 'إحصائيات_المنصات'
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

// ─── Singleton للملف ─────────────────────────────
var _smm_ss_cache = null;
function _smmGetSS() {
  if (!_smm_ss_cache) {
    _smm_ss_cache = SpreadsheetApp.openById(SMM_SPREADSHEET_ID);
  }
  return _smm_ss_cache;
}

function _smmGetSheet(name) {
  var ss = _smmGetSS();
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
  smmSeedYearCalendar();
  smmSeedTemplates();
  smmAddMissingTemplates();
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

    scheduleSheet.appendRow([
      new Date(),
      item['المنصة'],
      item['نوع_المحتوى'],
      fullContent,
      item['الوسائط_URL'],
      item['تاريخ_النشر_المخطط'],
      'مجدول',
      Session.getActiveUser().getEmail() || '',
      item['المسؤول'],
      'مرحَّل من الخطة: ' + planId
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

function publishToYouTube(title, description, videoFileId) {
  // YouTube API يتطلب OAuth منفصل + رفع فيديو
  // الحل العملي: نسجل في سجل النشر ونعطي المستخدم رابط الرفع
  var sheet = _smmGetSheet(SMM_SHEETS.PUBLISH_LOG);
  sheet.appendRow([
    new Date(), '', 'يوتيوب', '',
    'https://studio.youtube.com/channel/UC.../videos/upload',
    'يتطلب رفع يدوي', 'YouTube API يحتاج OAuth منفصل',
    0, 0, 0
  ]);
  return {
    success: true,
    manual: true,
    message: 'يرجى رفع الفيديو يدوياً على YouTube Studio',
    uploadUrl: 'https://studio.youtube.com/'
  };
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
    var platform = _smmSafeStr(row[1]);
    var content = _smmSafeStr(row[3]);
    var mediaUrl = _smmSafeStr(row[4]);
    var scheduledDate = row[5];
    var status = _smmSafeStr(row[6]);

    if (status !== 'مجدول' && status !== 'scheduled') continue;
    if (!scheduledDate) continue;

    var scheduleTime = (Object.prototype.toString.call(scheduledDate) === '[object Date]')
      ? scheduledDate.getTime() : new Date(scheduledDate).getTime();
    if (isNaN(scheduleTime) || scheduleTime > now) continue;

    var result;
    if (platform === 'فيسبوك' || platform.toLowerCase() === 'facebook') {
      result = publishToFacebook(content, mediaUrl);
    } else if (platform === 'إنستغرام' || platform.toLowerCase() === 'instagram') {
      result = publishToInstagram(content, mediaUrl);
    } else if (platform === 'واتساب' || platform.toLowerCase() === 'whatsapp') {
      result = publishToWhatsApp(content, mediaUrl);
    } else if (platform === 'يوتيوب' || platform.toLowerCase() === 'youtube') {
      result = publishToYouTube('منشور من المنظومة', content, mediaUrl);
    } else {
      continue;
    }

    if (result.success) {
      sheet.getRange(i + 1, 7).setValue('✅ تم النشر — ' + (result.postId || result.message || ''));
      logSheet.appendRow([
        new Date(), '', platform, _smmSafeStr(result.postId),
        '', 'نجح', '', 0, 0, 0
      ]);
    } else {
      sheet.getRange(i + 1, 7).setValue('❌ فشل: ' + result.error);
      logSheet.appendRow([
        new Date(), '', platform, '',
        '', 'فشل', result.error, 0, 0, 0
      ]);
    }
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