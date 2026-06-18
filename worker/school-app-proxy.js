/**
 * school-app-proxy — Cloudflare Worker
 * مدارس الإبداع والتميز الدولية
 *
 * الغرض: تشغيل الموقع بدون VPN في المناطق التي يُحجب فيها github.io.
 *  - يخدم صفحات الواجهة الثابتة بجلبها من GitHub Pages نيابةً عن المتصفّح
 *    (Cloudflare تصل إلى github.io حتى لو كان محجوباً لدى المستخدم).
 *  - يمرّر نداءات الـ API على المسار /gas/<app> إلى روابط Google Apps Script.
 *
 * النتيجة: المتصفّح يتكلّم فقط مع نطاق Cloudflare (workers.dev) — لا github.io
 * ولا google مباشرةً — فلا حجب ولا مشاكل CORS.
 *
 * كيفية النشر:
 *  1) Cloudflare Dashboard → Workers & Pages → Create → Worker.
 *  2) الصق هذا الملف بالكامل في المحرّر ثم Deploy.
 *  3) افتح رابط الـ Worker الناتج (مثل https://school-app.<حسابك>.workers.dev/).
 */

var GITHUB_BASE = 'https://procorners-labs.github.io/school-app-yemen-web';

var GAS = {
  home:     'https://script.google.com/macros/s/AKfycbzDfGEK6IpChVNl9k8xbt_iv5p6bLOktt-TvEzDp8yBpH3Ga3yNMen_0S2ZyuuvGtKFCA/exec',
  cms:      'https://script.google.com/macros/s/AKfycbz-iAj9L3ROOn4CAjmwkVBUqpWuxIx1LkgPLwKnHu7kHLWKCy3GVJNo1vZbnekop0VlMA/exec',
  teacher:  'https://script.google.com/macros/s/AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND/exec',
  student:  'https://script.google.com/macros/s/AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq/exec',
  schedule: 'https://script.google.com/macros/s/AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag/exec',
  'master-admin': 'https://script.google.com/macros/s/AKfycbx5H6uYXb-6iVt_nT4YkdnYMhl6eZJSDxsULsKa2eyblZQcwzRo4CXR3Mh_ecRSZd4M/exec',
  pricing:  'https://script.google.com/macros/s/AKfycbz11yUbrix4F1lE_GbiAFqE3EClGpoRvAb19LoLoABQX_Xo3i2U25jlQpOFcN9S_yLC/exec'
};

function withCors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'content-type, x-requested-with');
  return resp;
}

function jsonResponse(obj, status) {
  return withCors(new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  }));
}

export default {
  async fetch(request) {
    var url = new URL(request.url);
    var path = url.pathname;

    // ── 1) وكيل الـ API: /gas/<app> ─────────────────────────────
    var match = path.match(/^\/gas\/([a-zA-Z-]+)\/?$/);
    if (match) {
      var app = match[1];
      var target = GAS[app];
      if (!target) return jsonResponse({ ok: false, error: 'تطبيق غير معروف: ' + app }, 404);

      if (request.method === 'OPTIONS') {
        return withCors(new Response(null, { status: 204 }));
      }

      var init = {
        method: request.method === 'GET' ? 'GET' : 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow'
      };
      if (request.method !== 'GET') {
        init.body = await request.text();
      }

      try {
        var gasResp = await fetch(target + url.search, init);
        var text = await gasResp.text();
        return withCors(new Response(text, {
          status: gasResp.status,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }));
      } catch (err) {
        return jsonResponse({ ok: false, error: 'تعذّر الوصول إلى الخادم: ' + String(err) }, 502);
      }
    }

    // ── 1ب) عرض صورة QR عبر Proxy (inline): /qr-img?url=... ──────
    //   يجلب الصورة من api.qrserver.com ويُعيدها مباشرةً (بلا attachment)
    //   يُستخدم كـ fallback في <img onerror> عندما يكون qrserver.com محجوباً
    if (path === '/qr-img') {
      var qiUrl = url.searchParams.get('url') || '';
      if (!qiUrl || !qiUrl.startsWith('https://api.qrserver.com/')) {
        return jsonResponse({ error: 'رابط QR غير مقبول' }, 400);
      }
      try {
        var qiFetch = await fetch(qiUrl, { method: 'GET' });
        var qiBuf = await qiFetch.arrayBuffer();
        var qiHeaders = new Headers();
        qiHeaders.set('Content-Type', 'image/png');
        qiHeaders.set('Access-Control-Allow-Origin', '*');
        qiHeaders.set('Cache-Control', 'public, max-age=86400');
        return new Response(qiBuf, { status: 200, headers: qiHeaders });
      } catch (qiErr) {
        return new Response('', { status: 502 });
      }
    }

    // ── 1ب) تحميل QR عبر Proxy: /qr-download?url=...&name=... ────
    //   يجلب الصورة من api.qrserver.com ويُضيف Content-Disposition:attachment
    //   حل مثالي: نفس النطاق → لا مشكلة CORS عند التحميل
    if (path === '/qr-download') {
      var qrUrl = url.searchParams.get('url') || '';
      var qrName = url.searchParams.get('name') || 'QR-Code';
      // أمان: نسمح فقط بروابط api.qrserver.com
      if (!qrUrl || !qrUrl.startsWith('https://api.qrserver.com/')) {
        return jsonResponse({ error: 'رابط QR غير مقبول' }, 400);
      }
      try {
        var qrFetch = await fetch(qrUrl, { method: 'GET' });
        var qrBuf = await qrFetch.arrayBuffer();
        var dlHeaders = new Headers();
        dlHeaders.set('Content-Type', 'image/png');
        dlHeaders.set('Content-Disposition', 'attachment; filename="' + qrName.replace(/"/g,'') + '.png"');
        dlHeaders.set('Access-Control-Allow-Origin', '*');
        dlHeaders.set('Cache-Control', 'no-cache');
        return new Response(qrBuf, { status: 200, headers: dlHeaders });
      } catch (qrErr) {
        return jsonResponse({ error: 'تعذّر جلب صورة QR: ' + String(qrErr) }, 502);
      }
    }

    // ── 1ب) عودة OAuth من فيسبوك/إنستغرام: /oauth ───────────────
    //   Meta يعيد التوجيه إلى /oauth?code=...&state=schoolId
    //   نمرّرها إلى doGet في مشروع CMS (action=fb_oauth) مع الحفاظ على HTML.
    if (path === '/oauth' || path === '/oauth/') {
      var qs = url.search ? url.search.replace(/^\?/, '') : '';
      var oauthTarget = GAS.cms + '?action=fb_oauth' + (qs ? '&' + qs : '');
      try {
        var oResp = await fetch(oauthTarget, { method: 'GET', redirect: 'follow' });
        var oBody = await oResp.text();
        var oCt = oResp.headers.get('Content-Type') || 'text/html; charset=utf-8';
        return withCors(new Response(oBody, { status: oResp.status, headers: { 'Content-Type': oCt } }));
      } catch (oErr) {
        return withCors(new Response('<h3>تعذّر إتمام الاتصال: ' + String(oErr) + '</h3>', {
          status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }));
      }
    }

    // ── 1ج) صفحة التسعيرة (HTML من GAS) عبر الوكيل: /pricing ─────
    //   تخدم صفحة doGet الخاصة بمشروع التسعيرة كـ HTML نظيف (لا JSON).
    //   مناسبة للمناطق المحجوبة: المتصفّح يتكلّم مع Cloudflare فقط.
    if (path === '/pricing' || path === '/pricing/') {
      try {
        var prResp = await fetch(GAS.pricing + url.search, { method: 'GET', redirect: 'follow' });
        var prBody = await prResp.text();
        var prCt = prResp.headers.get('Content-Type') || 'text/html; charset=utf-8';
        var prHeaders = new Headers();
        prHeaders.set('Content-Type', prCt);
        prHeaders.set('Access-Control-Allow-Origin', '*');
        return new Response(prBody, { status: prResp.status, headers: prHeaders });
      } catch (prErr) {
        return withCors(new Response('<h3>تعذّر فتح صفحة التسعيرة: ' + String(prErr) + '</h3>', {
          status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }));
      }
    }

    // ── 2) خدمة الموقع الثابت من GitHub Pages ───────────────────
    if (path === '/' || path === '') path = '/index.html';
    var ghUrl = GITHUB_BASE + path + url.search;
    var ghResp = await fetch(ghUrl, {
      headers: { 'User-Agent': 'cf-worker-proxy', 'Accept': request.headers.get('Accept') || '*/*' },
      redirect: 'follow'
    });

    var headers = new Headers(ghResp.headers);
    // إزالة قيود قد تمنع التضمين/التشغيل عبر نطاق آخر
    headers.delete('content-security-policy');
    headers.delete('x-frame-options');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.delete('etag');
    headers.delete('last-modified');
    headers.delete('expires');

    // سياسة تخزين ذكية حسب نوع الملف:
    //  - HTML / sw.js / manifest: لا تخزين (تظهر التحديثات فوراً، ويتحدّث الـ SW).
    //  - الأصول الثابتة (js/css/صور/خطوط): تخزين يوم + stale-while-revalidate أسبوع
    //    → على الشبكات الضعيفة تُعاد من كاش المتصفّح فوراً بدل جولة شبكة لكل ملف.
    var lowerPath = path.toLowerCase();
    var isHtml = lowerPath === '/' || /\.html?$/.test(lowerPath) || !/\.[a-z0-9]+$/.test(lowerPath);
    var isNoCache = isHtml || /\/sw\.js$/.test(lowerPath) || /manifest\.webmanifest$/.test(lowerPath);
    if (isNoCache) {
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }

    return new Response(ghResp.body, {
      status: ghResp.status,
      statusText: ghResp.statusText,
      headers: headers
    });
  }
};
