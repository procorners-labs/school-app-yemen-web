/**
 * CanvaDesign.gs — توليد تصميم آلي عبر Canva Connect API (اختياري).
 *
 * الفكرة: تنشئ في Canva «Brand Template» فيه حقول نصية باسم محدّد
 * (مثل {{title}} و {{body}})، ونملؤها آلياً بنص المنشور، ثم نُصدِّر صورة.
 *
 * إن لم تضبط توكن Canva، تتخطّى العُدّة هذه الخطوة بسلام
 * وتترك المنشور «للمراجعة» لتصمّمه يدوياً — فلا يتعطّل سير العمل.
 */

const CANVA_API = 'https://api.canva.com/rest/v1';

/** هل Canva مُهيّأ؟ */
function canvaEnabled_() {
  return !!getProp_(PROP.CANVA_TOKEN, false) && !!getProp_(PROP.CANVA_TPL, false);
}

/**
 * ينشئ تصميماً ويُصدِّر صورته.
 * @return {{designUrl:string, imageUrl:string}}
 */
function makeDesign_(type, caption) {
  const token = getProp_(PROP.CANVA_TOKEN, true);
  const tplId = getProp_(PROP.CANVA_TPL, true);

  // العنوان = أول سطر/جملة، النص = الباقي (عدّل أسماء الحقول حسب قالبك)
  const firstBreak = caption.indexOf('\n');
  const title = firstBreak > 0 ? caption.slice(0, firstBreak).trim() : type;
  const body  = firstBreak > 0 ? caption.slice(firstBreak).trim() : caption;

  const autofill = {
    brand_template_id: tplId,
    data: {
      title: { type: 'text', text: title },
      body:  { type: 'text', text: body },
    },
  };

  // 1) أنشئ مهمة التعبئة التلقائية
  const job = canvaFetch_('POST', '/autofills', token, autofill);
  let jobId = job.job && job.job.id;
  let designId, designUrl;

  // 2) استطلِع حتى تكتمل
  for (let i = 0; i < 20; i++) {
    Utilities.sleep(1500);
    const st = canvaFetch_('GET', '/autofills/' + jobId, token);
    const status = st.job && st.job.status;
    if (status === 'success') {
      designId  = st.job.result.design.id;
      designUrl = st.job.result.design.url;
      break;
    }
    if (status === 'failed') throw new Error('Canva autofill فشل: ' + JSON.stringify(st.job.error || {}));
  }
  if (!designId) throw new Error('Canva autofill لم يكتمل في الوقت المتاح.');

  // 3) صدّر صورة PNG
  const exp = canvaFetch_('POST', '/exports', token, {
    design_id: designId,
    format: { type: 'png' },
  });
  let expId = exp.job && exp.job.id;
  let imageUrl;
  for (let i = 0; i < 20; i++) {
    Utilities.sleep(1500);
    const st = canvaFetch_('GET', '/exports/' + expId, token);
    const status = st.job && st.job.status;
    if (status === 'success') {
      imageUrl = st.job.urls && st.job.urls[0]; // رابط مؤقّت — نستخدمه فوراً للنشر
      break;
    }
    if (status === 'failed') throw new Error('Canva export فشل: ' + JSON.stringify(st.job.error || {}));
  }
  if (!imageUrl) throw new Error('Canva export لم يكتمل في الوقت المتاح.');

  return { designUrl: designUrl || '', imageUrl: imageUrl };
}

/** غلاف نداء Canva REST. */
function canvaFetch_(method, path, token, body) {
  const opt = {
    method: method.toLowerCase(),
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(CANVA_API + path, opt);
  const code = res.getResponseCode();
  const txt = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('Canva ' + code + ' @' + path + ': ' + txt.slice(0, 300));
  return JSON.parse(txt || '{}');
}
