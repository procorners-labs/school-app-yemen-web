/**
 * school-app-proxy — Cloudflare Worker
 * إتقان — نظام إدارة المدارس
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
  'home-all-school': 'https://script.google.com/macros/s/AKfycbx21N0YQAqby2TV0q3lrxPHjGHo19y6_6ez0xeB4rvsncmSbRlyLh4iiNvrbtP6-ng2/exec',
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

// معالج HTMLRewriter: يضبط قيمة سمة على عنصر (لحقن وسوم OG لكل خبر)
function _AttrSet(attr, val) { this.attr = attr; this.val = val; }
_AttrSet.prototype.element = function (el) { if (this.val) el.setAttribute(this.attr, this.val); };

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

      // تطبيقات GAS تُرجع أحيانًا 404 أو صفحة HTML اعتراضية بشكل متقطّع (~6%) بدل تنفيذ الدالة.
      // نعيد المحاولة حتى 3 مرّات: نعدّ 404 (أو جسمًا HTML في طلبات POST التي تتوقّع JSON) قابلًا
      // لإعادة المحاولة، فلا يظهر خلل GAS العابر للمستخدم كفشل. طلبات GET (مثل الصفحة) يُقبل HTML فيها.
      var isPost = request.method !== 'GET';
      var fullTarget = target + url.search;
      var lastText = '', lastStatus = 502, attempt;
      for (attempt = 0; attempt < 3; attempt++) {
        try {
          var gasResp = await fetch(fullTarget, init);
          lastText = await gasResp.text();
          lastStatus = gasResp.status;
          var looksHtml = lastText.charAt(0) === '<';
          var good = gasResp.status >= 200 && gasResp.status < 400 && !(isPost && looksHtml);
          if (good) break;
        } catch (err) {
          lastStatus = 502;
          lastText = JSON.stringify({ ok: false, error: 'تعذّر الوصول إلى الخادم: ' + String(err) });
        }
        if (attempt < 2) { await new Promise(function (r) { setTimeout(r, 200); }); }
      }
      return withCors(new Response(lastText, {
        status: lastStatus,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }));
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

    // ── 1د) بثّ فيديو Google Drive عبر الوكيل: /media/drive/<fileId> ──
    //   يجلب بايتات الفيديو من Drive ويبثّها كـ video/mp4 مع دعم Range،
    //   ليُشغّل في وسم <video> الأصلي بدل مشغّل Drive المتعثّر
    //   ("تعذّر تحميل الفيديو. يُرجى إعادة المحاولة"). خفيف: بثّ مباشر بلا تخزين.
    var mediaMatch = path.match(/^\/media\/drive\/([a-zA-Z0-9_-]+)\/?$/);
    if (mediaMatch) {
      var fileId = mediaMatch[1];
      if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
      try {
        var range = request.headers.get('Range');
        var fInit = { method: 'GET', redirect: 'follow', headers: {} };
        if (range) fInit.headers['Range'] = range;
        // نقطة التنزيل المباشر الحديثة (تتجاوز صفحة فحص الفيروسات بـ confirm=t)
        var driveUrl = 'https://drive.usercontent.google.com/download?id=' + fileId + '&export=download&confirm=t';
        var dResp = await fetch(driveUrl, fInit);
        var ct = dResp.headers.get('Content-Type') || '';
        // لو رجعت صفحة HTML (تأكيد/خطأ) جرّب نقطة uc التقليدية
        if (ct.indexOf('text/html') !== -1) {
          dResp = await fetch('https://drive.google.com/uc?export=download&id=' + fileId + '&confirm=t', fInit);
          ct = dResp.headers.get('Content-Type') || '';
        }
        var outHeaders = new Headers();
        outHeaders.set('Content-Type', (ct && ct.indexOf('text/html') === -1) ? ct : 'video/mp4');
        outHeaders.set('Accept-Ranges', 'bytes');
        outHeaders.set('Access-Control-Allow-Origin', '*');
        // محتوى الفيديو ثابت لكل fileId (لا يتغيّر) → كاش طويل على حافة Cloudflare لتسريع
        // إعادة التشغيل والتموضع (seek)؛ immutable يمنع إعادة التحقّق غير الضرورية.
        outHeaders.set('Cache-Control', 'public, max-age=86400, immutable');
        var cr = dResp.headers.get('Content-Range'); if (cr) outHeaders.set('Content-Range', cr);
        var cl = dResp.headers.get('Content-Length'); if (cl) outHeaders.set('Content-Length', cl);
        return new Response(dResp.body, { status: dResp.status, headers: outHeaders });
      } catch (mErr) {
        return withCors(new Response('video proxy error: ' + String(mErr), { status: 502 }));
      }
    }

    // ── 1هـ) وسيط رفع الملفات إلى جلسة Drive القابلة للاستئناف: /drive-upload ──
    //   يستقبل من المتصفّح طلب PUT يحمل جسم الملف (أو شريحةً منه) مع ?sessionUri=...
    //   ويمرّره كما هو — بثّاً، بلا تحميله كاملاً في الذاكرة — إلى جلسة Drive
    //   resumable (uploadType=resumable). الفائدة: المتصفّح يتكلّم مع نطاق
    //   Cloudflare فقط، فيعمل الرفع داخل اليمن (تجاوز الحجب) وبلا مشاكل CORS.
    //   أمان (منع SSRF): نقبل فقط وجهةً نطاقها ينتهي بـ .googleapis.com عبر https.
    if (path === '/drive-upload' || path === '/drive-upload/') {
      // CORS: نعكس أصل الموقع (بلا اعتماد على كوكيز → آمن)، ونسمح بـ PUT وترويسات الرفع.
      var duOrigin = request.headers.get('Origin') || '*';
      var duCors = function (resp) {
        resp.headers.set('Access-Control-Allow-Origin', duOrigin);
        resp.headers.set('Access-Control-Allow-Methods', 'PUT, OPTIONS');
        resp.headers.set('Access-Control-Allow-Headers', 'content-type, content-range, content-length');
        resp.headers.set('Access-Control-Expose-Headers', 'Range, Location, Content-Range');
        resp.headers.set('Access-Control-Max-Age', '86400');
        if (duOrigin !== '*') resp.headers.set('Vary', 'Origin');
        return resp;
      };

      // معالجة الـ preflight
      if (request.method === 'OPTIONS') {
        return duCors(new Response(null, { status: 204 }));
      }
      if (request.method !== 'PUT') {
        return duCors(jsonResponse({ ok: false, error: 'استخدم PUT لرفع الملف' }, 405));
      }

      // التحقق الصارم من وجهة الرفع وحصرها في نطاق Google (منع SSRF)
      var sessionUri = url.searchParams.get('sessionUri') || '';
      if (!sessionUri) {
        return duCors(jsonResponse({ ok: false, error: 'sessionUri مفقود' }, 400));
      }
      var target;
      try {
        target = new URL(sessionUri);
      } catch (e) {
        return duCors(jsonResponse({ ok: false, error: 'sessionUri غير صالح' }, 400));
      }
      if (target.protocol !== 'https:' ||
          !(target.hostname === 'googleapis.com' || target.hostname.endsWith('.googleapis.com'))) {
        return duCors(jsonResponse({ ok: false, error: 'وجهة الرفع غير مسموحة' }, 400));
      }

      // تمرير الجسم بثّاً مع الحفاظ الحرفي على ترويسات الرفع.
      var upHeaders = new Headers();
      var ctH = request.headers.get('Content-Type');   if (ctH) upHeaders.set('Content-Type', ctH);
      var crH = request.headers.get('Content-Range');  if (crH) upHeaders.set('Content-Range', crH);
      var clH = request.headers.get('Content-Length'); if (clH) upHeaders.set('Content-Length', clH);

      try {
        var upResp = await fetch(sessionUri, {
          method: 'PUT',
          headers: upHeaders,
          body: request.body,
          duplex: 'half',
          redirect: 'manual'  // 308 (Resume Incomplete) ليست إعادة توجيه فعلية — نُمرّرها كما هي
        });

        // إعادة حالة Drive وجسمه كما هما: 308 أثناء التقطيع (مع Range)،
        // و200/201 + JSON فيه id عند الاكتمال.
        var duOut = new Headers();
        var rngH = upResp.headers.get('Range');    if (rngH) duOut.set('Range', rngH);
        var locH = upResp.headers.get('Location'); if (locH) duOut.set('Location', locH);
        duOut.set('Content-Type', upResp.headers.get('Content-Type') || 'application/json; charset=utf-8');
        return duCors(new Response(upResp.body, { status: upResp.status, headers: duOut }));
      } catch (upErr) {
        return duCors(jsonResponse({ ok: false, error: 'تعذّر رفع الملف إلى Drive: ' + String(upErr) }, 502));
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

    // حقن وسوم OG لكل خبر (?news=<id>) كي تُظهر تطبيقات المشاركة (واتساب/فيسبوك) صورة الخبر وعنوانه
    var _newsId = url.searchParams.get('news');
    if (_newsId && isHtml) {
      try {
        var _ogRes = await fetch(GAS.home, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ fn: 'getNewsOg', args: [_newsId, url.searchParams.get('school') || ''] })
        });
        var _ogJson = await _ogRes.json();
        var _og = (_ogJson && _ogJson.result) ? _ogJson.result : _ogJson;
        if (_og && _og.ok && (_og.image || _og.title)) {
          return new HTMLRewriter()
            .on('meta[property="og:title"]', new _AttrSet('content', _og.title))
            .on('meta[property="og:description"]', new _AttrSet('content', _og.description))
            .on('meta[property="og:image"]', new _AttrSet('content', _og.image))
            .on('meta[name="twitter:image"]', new _AttrSet('content', _og.image))
            .transform(new Response(ghResp.body, { status: ghResp.status, headers: headers }));
        }
      } catch (_ogErr) { /* تجاهل — نُعيد الصفحة بوسوم الهوية العامة */ }
    }

    return new Response(ghResp.body, {
      status: ghResp.status,
      statusText: ghResp.statusText,
      headers: headers
    });
  }
};

// build: re-trigger v2
