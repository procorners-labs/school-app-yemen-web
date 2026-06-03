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
  'master-admin': 'https://script.google.com/macros/s/AKfycbx5H6uYXb-6iVt_nT4YkdnYMhl6eZJSDxsULsKa2eyblZQcwzRo4CXR3Mh_ecRSZd4M/exec'
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
    // منع تخزين الواجهة في المتصفّح حتى تظهر التحديثات فوراً (لا نسخة قديمة)
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.delete('etag');
    headers.delete('last-modified');
    headers.delete('expires');

    return new Response(ghResp.body, {
      status: ghResp.status,
      statusText: ghResp.statusText,
      headers: headers
    });
  }
};
