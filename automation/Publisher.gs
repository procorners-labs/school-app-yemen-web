/**
 * Publisher.gs — النشر على فيسبوك وإنستغرام عبر Meta Graph API.
 *
 * فيسبوك: صورة + نص في خطوة واحدة (/{page-id}/photos).
 * إنستغرام: إنشاء حاوية ثم نشرها (يتطلّب رابط صورة عام).
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * ينشر منشوراً على المنصات المطلوبة.
 * @return {{ok:boolean, ids:Object, errors:Array}}
 */
function publishPost_(caption, imageUrl, platforms) {
  const list = String(platforms || '').split(/[,،]/).map(function (s) { return s.trim(); });
  const wantFB = list.indexOf('فيسبوك') !== -1 || list.indexOf('Facebook') !== -1;
  const wantIG = list.indexOf('إنستغرام') !== -1 || list.indexOf('Instagram') !== -1;

  const ids = {};
  const errors = [];

  if (wantFB) {
    try { ids.facebook = publishFacebook_(caption, imageUrl); }
    catch (e) { errors.push('فيسبوك: ' + e.message); }
  }
  if (wantIG) {
    if (!imageUrl) errors.push('إنستغرام: يتطلّب صورة — لا يمكن النشر دون تصميم.');
    else {
      try { ids.instagram = publishInstagram_(caption, imageUrl); }
      catch (e) { errors.push('إنستغرام: ' + e.message); }
    }
  }
  if (!wantFB && !wantIG) errors.push('لم تُحدَّد منصّة معروفة (فيسبوك/إنستغرام).');

  return { ok: errors.length === 0 && Object.keys(ids).length > 0, ids: ids, errors: errors };
}

/** نشر على صفحة فيسبوك. مع صورة → /photos، بدونها → /feed. */
function publishFacebook_(caption, imageUrl) {
  const pageId = getProp_(PROP.FB_PAGE_ID, true);
  const token  = getProp_(PROP.FB_TOKEN, true);

  let url, params;
  if (imageUrl) {
    url = GRAPH + '/' + pageId + '/photos';
    params = { url: imageUrl, caption: caption, access_token: token };
  } else {
    url = GRAPH + '/' + pageId + '/feed';
    params = { message: caption, access_token: token };
  }
  const json = graphPost_(url, params);
  return json.post_id || json.id || '';
}

/** نشر على إنستغرام (حاوية ثم نشر). */
function publishInstagram_(caption, imageUrl) {
  const igId  = getProp_(PROP.IG_USER_ID, true);
  const token = getProp_(PROP.FB_TOKEN, true); // نفس توكن صفحة فيسبوك المربوطة

  // 1) أنشئ الحاوية
  const container = graphPost_(GRAPH + '/' + igId + '/media', {
    image_url: imageUrl, caption: caption, access_token: token,
  });
  const creationId = container.id;
  if (!creationId) throw new Error('فشل إنشاء حاوية إنستغرام.');

  // 2) انتظر جهوزية الحاوية ثم انشر
  for (let i = 0; i < 10; i++) {
    Utilities.sleep(2000);
    const st = graphGet_(GRAPH + '/' + creationId, { fields: 'status_code', access_token: token });
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR') throw new Error('تعذّر تجهيز صورة إنستغرام.');
  }
  const pub = graphPost_(GRAPH + '/' + igId + '/media_publish', {
    creation_id: creationId, access_token: token,
  });
  return pub.id || '';
}

function graphPost_(url, params) {
  const res = UrlFetchApp.fetch(url, {
    method: 'post', payload: params, muteHttpExceptions: true,
  });
  return parseGraph_(res);
}

function graphGet_(url, params) {
  const qs = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  const res = UrlFetchApp.fetch(url + '?' + qs, { muteHttpExceptions: true });
  return parseGraph_(res);
}

function parseGraph_(res) {
  const code = res.getResponseCode();
  const txt = res.getContentText();
  const json = JSON.parse(txt || '{}');
  if (code < 200 || code >= 300 || json.error) {
    const msg = json.error ? (json.error.message || JSON.stringify(json.error)) : txt.slice(0, 300);
    throw new Error('Graph ' + code + ': ' + msg);
  }
  return json;
}
