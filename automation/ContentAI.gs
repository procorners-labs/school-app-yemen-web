/**
 * ContentAI.gs — توليد نص المنشور آلياً عبر Claude API.
 *
 * يأخذ نوع المنشور + مدخلاتك البسيطة + هوية المدرسة،
 * ويُعيد نصاً عربياً جاهزاً للنشر (مع وسوم وإيموجي مناسبة).
 */

const CLAUDE_URL     = 'https://api.anthropic.com/v1/messages';
const CLAUDE_VERSION = '2023-06-01';
const CLAUDE_DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * يولّد نص منشور واحد.
 * @param {string} type   نوع المنشور (إعلان | تهنئة | تحفيزي)
 * @param {string} input  مدخلاتك (نقاط بسيطة عمّا يدور المنشور)
 * @param {Object} settings  ناتج readSettings_()
 * @return {string} النص الجاهز
 */
function generateCaption_(type, input, settings) {
  const model = getProp_(PROP.CLAUDE_MODEL, false) || CLAUDE_DEFAULT_MODEL;
  const apiKey = getProp_(PROP.CLAUDE_KEY, true);

  const school = settings['اسم المدرسة'] || 'مدرستنا';
  const slogan = settings['الشعار/الرسالة'] || '';
  const tone   = settings['نبرة المحتوى'] || 'راقية، محفّزة، مختصرة، عربية فصيحة مبسّطة';
  const tags   = settings['وسوم ثابتة'] || '';
  const city   = settings['المدينة'] || '';

  const system =
    'أنت مسؤول التواصل الاجتماعي لـ«' + school + '»' + (city ? ' في ' + city : '') + '. ' +
    (slogan ? 'شعار المدرسة: «' + slogan + '». ' : '') +
    'اكتب منشوراً واحداً جاهزاً للنشر على فيسبوك وإنستغرام بنبرة ' + tone + '. ' +
    'قواعد صارمة: (1) عربية فصيحة سليمة دون أخطاء. ' +
    '(2) مختصر ومناسب لوسائل التواصل (٣٠–٦٠ كلمة عادةً). ' +
    '(3) استخدم ٢–٤ إيموجي مناسبة وغير مبالَغ فيها. ' +
    '(4) أضِف في النهاية الوسوم: ' + (tags || 'وسوم تعليمية مناسبة') + '. ' +
    '(5) لا تخترع أسماءً أو أرقاماً أو تواريخ غير موجودة في المدخلات. ' +
    '(6) أعِد النص النهائي فقط دون مقدمات أو شروح أو علامات اقتباس.';

  const typeHint = {
    'إعلان':  'هذا منشور إعلاني/خبري للمدرسة (فعالية، موعد، تعميم، تذكير).',
    'تهنئة':  'هذا منشور تهنئة/تكريم لإنجاز طالب أو فريق أو مناسبة — احتفائي ودافئ.',
    'تحفيزي': 'هذا منشور تعليمي/تحفيزي يومي (حكمة، نصيحة، اقتباس قصير ملهم).',
  }[type] || 'منشور عام للمدرسة.';

  const userMsg =
    typeHint + '\n\nمدخلات المسؤول:\n' + (input || '(لا توجد مدخلات — اكتب محتوى عاماً مناسباً للنوع)');

  const payload = {
    model: model,
    max_tokens: 1024,
    system: system,
    messages: [{ role: 'user', content: userMsg }],
  };

  const res = UrlFetchApp.fetch(CLAUDE_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': CLAUDE_VERSION },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    throw new Error('Claude API ' + code + ': ' + body.slice(0, 300));
  }
  const json = JSON.parse(body);
  const text = (json.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('\n')
    .trim();
  if (!text) throw new Error('Claude لم يُعِد نصاً.');
  return text;
}
