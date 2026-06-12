/**
 * Config.gs — الإعدادات المركزية لعُدّة الأتمتة (Google Apps Script)
 * مدارس الإبداع والتميز الدولية
 *
 * كل المفاتيح السرية (Claude / Facebook / Canva) تُخزَّن في
 * Project Settings → Script Properties — لا تُكتب داخل الكود إطلاقاً.
 * انظر automation/README.md للخطوات التفصيلية.
 */

// ===== أسماء أوراق جدول البيانات (Google Sheet) =====
const SHEET_POSTS    = 'المنشورات';   // مركز التحكم: صف لكل منشور
const SHEET_SETTINGS = 'الإعدادات';   // هوية المدرسة + نبرة المحتوى

// ===== أعمدة ورقة «المنشورات» (1 = العمود A) =====
const COL = {
  ID:        1,  // معرّف فريد يُنشأ تلقائياً
  DATE:      2,  // التاريخ/الوقت المطلوب للنشر
  TYPE:      3,  // النوع: إعلان | تهنئة | تحفيزي
  INPUT:     4,  // مدخلاتك: عمّا يدور المنشور (نقاط بسيطة)
  PLATFORMS: 5,  // المنصات: فيسبوك، إنستغرام (افصل بفاصلة)
  CAPTION:   6,  // النص المولّد آلياً (Claude)
  DESIGN:    7,  // رابط تصميم Canva (للتعديل)
  IMAGE:     8,  // رابط الصورة النهائية (للنشر)
  STATUS:    9,  // الحالة (انظر STATUS أدناه)
  LOG:       10, // ملاحظات/سجل آلي
  POST_ID:   11, // معرّف المنشور بعد النشر
};
const POSTS_HEADERS = [
  'المعرّف', 'تاريخ النشر', 'النوع', 'المدخلات', 'المنصات',
  'النص المولّد', 'رابط التصميم', 'رابط الصورة', 'الحالة', 'السجل', 'معرّف المنشور'
];

// ===== حالات المنشور (سير العمل: مراجعة ثم نشر) =====
const STATUS = {
  NEW:       'جديد',       // أنت تكتب المدخلات وتترك الحالة «جديد»
  DRAFTING:  'قيد التوليد', // أثناء عمل Claude/Canva
  REVIEW:    'للمراجعة',    // جاهز — راجع النص والصورة
  APPROVED:  'معتمد',       // أنت تغيّرها يدوياً لتأذن بالنشر
  PUBLISHED: 'منشور',       // تم النشر بنجاح
  FAILED:    'فشل',         // حدث خطأ — اقرأ عمود السجل
};

// ===== الأنواع المسموح بها =====
const POST_TYPES = ['إعلان', 'تهنئة', 'تحفيزي'];

/**
 * يقرأ خاصية من Script Properties ويعطي خطأً واضحاً إن كانت مفقودة.
 */
function getProp_(key, required) {
  const val = PropertiesService.getScriptProperties().getProperty(key);
  if (required && !val) {
    throw new Error('إعداد مفقود: ' + key + ' — أضِفه في Project Settings ▸ Script Properties (راجع README).');
  }
  return val || '';
}

// مفاتيح Script Properties المتوقّعة (تُضبط مرة واحدة):
const PROP = {
  CLAUDE_KEY:   'CLAUDE_API_KEY',      // مفتاح Claude API
  CLAUDE_MODEL: 'CLAUDE_MODEL',        // اختياري — الافتراضي claude-opus-4-8
  FB_PAGE_ID:   'FB_PAGE_ID',          // معرّف صفحة فيسبوك
  FB_TOKEN:     'FB_PAGE_TOKEN',       // توكن صفحة فيسبوك طويل الأمد
  IG_USER_ID:   'IG_USER_ID',          // معرّف حساب إنستغرام للأعمال
  CANVA_TOKEN:  'CANVA_TOKEN',         // توكن Canva Connect (اختياري)
  CANVA_TPL:    'CANVA_BRAND_TEMPLATE_ID', // قالب Canva للتعبئة التلقائية (اختياري)
};
