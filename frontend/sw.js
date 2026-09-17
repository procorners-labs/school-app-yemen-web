/*!
 * sw.js — Service Worker لقشرة التطبيق (Offline-First)
 * مدارس الإبداع والتميز الدولية
 *
 * - يخزّن قشرة التطبيق ليُفتح ويعمل دون اتصال.
 * - التنقّل (الصفحات): شبكة أولاً ثم الكاش (تظهر التحديثات متصلاً، ويعمل دون نت).
 * - الأصول الثابتة (assets): stale-while-revalidate.
 * - نداءات الخادم /gas/* (POST): تمرير فقط بلا تخزين (المعالجة دون اتصال في الجسر).
 */
'use strict';

/* 🔄 v5 → v6 (2026-08-04) — إبطال مقصود لقشرة العملاء العالقين، لا تغيير سلوكي.
   السبب مقيس لا مُفترَض: ‏PR#815 حوّل تسجيل مشاهدات الأخبار من نداء لكل خبر إلى نداء دفعي
   واحد، والمصدر والنشر الحيّ كلاهما مُتحقَّق منهما (الصفحة المخدومة تنادي
   `recordPublicNewsViewBatch` حصراً، وصفر HTML ينادي المفردة). ومع ذلك أظهر قياس ٢٤ ساعة:
     recordPublicNewsView (القديمة) = 2,365   ·   recordPublicNewsViewBatch = 49
   ونافذة 07-31 قبل الإصلاح = 2,629 / صفر ⇒ تدهور ١٠٪ فقط في أربعة أيام، بينما الهجرة
   الكاملة كانت ستُنتج ~394 نداءً دفعياً (كل دفعة تحلّ محلّ ٦) ⇒ نسبة وصول ~١١٪.
   أي أن الإصلاح صحيح ومنشور، لكن قشرة `sw.js` المخبَّأة تُبقي العملاء على النداء القديم
   إلى ما لا نهاية عملياً — وكل نداء منها تنفيذ GAS كامل من حصّة «٣٠ تنفيذاً متزامناً».
   معالج `activate` أدناه يحذف كل كاش لا يطابق هذه السلسلة، و`skipWaiting()` يُفعّله فوراً
   ⇒ تغيير السلسلة وحده يُجبر إعادة الجلب. **لا تُرجِعها إلى v5.** */
/* 🔴 رفعُ الاسم **إلزامي** مع أيّ تغيير في `PRECACHE`: الكاش القديم يبقى حيّاً باسمه
   وإلّا، فيُخدَم `/home/index.html` المخزَّن سابقاً دون اتصال بعد إسقاطه من القائمة —
   أي أن الإسقاط وحده أثرٌ صفريّ على كل جهازٍ زار الموقع مرّة. (‏`activate` يحذف كل
   كاشٍ لا يطابق `CACHE` الحالي.) */
/* 🔄 v8 → v9 (2026-09-17): إبطالُ نسخةٍ بائتةٍ من صفحة الخبر مخزَّنةٍ قبل 2026-09-11 كانت
   تُخدَم فترمي «google is not defined» (قِيس على هاتف المالك عبر USB)، ومعه إسقاطُ
   `/offline.html` من `PRECACHE` — **يردّ 404 حيّاً ولا مصدرَ له**. */
var CACHE = 'creativity-shell-v9';

/* ⏱️ مهلتان لا مهلة — والفرقُ هو العطل (2026-09-17).
   🔴 **ما كان:** بعد `NAV_TIMEOUT_MS` تُرفَض الشبكةُ نهائياً ويُخدَم أيُّ احتياط، حتى جذرُ
   الموقع. والمقيسُ على هاتف المالك: `responseStart = 3766ms` ⇒ الشبكةُ **كانت ستنجح** بعد
   ٢٦٦ms، فخُدمت بوّابةُ الجذر بدل الخبر.
   🟢 **الآن:** بعد `NAV_TIMEOUT_MS` يُخدَم **الكاشُ المطابقُ للطلب نفسِه** إن وُجد، وإلّا
   **يستمرّ انتظارُ الشبكة** حتى `NAV_HARD_TIMEOUT_MS`. ولا صفحةَ بديلةَ إلّا عند فشلٍ فعليّ. */
var NAV_TIMEOUT_MS = 3500;        // بعدها: الكاشُ المطابقُ للطلب وحده (لا بديل)
var NAV_HARD_TIMEOUT_MS = 25000;  // بلا مطابق: ننتظر الشبكة حتى هذا الحدّ (> ميزانية الوسيط 23.7ث)
var ASSET_TIMEOUT_MS = 6000;      // الأصول الثابتة

/* صفحةُ «غير متصل» صريحةٌ داخل العامل — لا ملفٌّ يُخزَّن (كان `/offline.html` 404 فلم
   يُخزَّن قطّ، فسقط الاحتياطُ إلى الجذر). و503 كي لا يُقرأ ردّاً ناجحاً. */
var OFFLINE_HTML =
  '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>غير متصل</title></head>' +
  '<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 16px">' +
  '<h1>تعذّر الاتصال</h1><p>تحقّق من الإنترنت ثمّ أعد المحاولة.</p>' +
  '<p><button onclick="location.reload()">إعادة المحاولة</button></p></body></html>';

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 503, statusText: 'offline',
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// fetch مع مهلة: يرفض الوعد إذا تجاوز الزمن المحدّد.
function fetchWithTimeout(req, ms) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
    fetch(req).then(function (res) {
      if (done) return; done = true; clearTimeout(t); resolve(res);
    })['catch'](function (e) {
      if (done) return; done = true; clearTimeout(t); reject(e);
    });
  });
}

// قشرة أساسية تُخزَّن مسبقاً (مسارات مطلقة من الجذر).
var PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/gas-bridge.js',
  '/assets/offline-db.js',
  '/assets/offline-sync.js',
  // 🔴 `/home/index.html` **أُسقِط 2026-08-14**: صار الرابط العاري يُحوَّل إلى الجذر
  //    (302)، فتخزينه مسبقاً يُبقي نسخةً بائتة تُخدَم دون اتصال بهوية المنصّة ثمّ تنادي
  //    `getHomePageBundle` بمعرّف فارغ — أي بالضبط السلوك الذي أُغلق. والجذر `/` أدناه
  //    هو البديل الصحيح: هو ما يُحوَّل إليه، وهو مخزَّن أصلاً.
  //    ⚠️ ولا علامة اقتباس مفردة في هذا التعليق عمداً: حارس `PRECACHE` يستخرج المداخل
  //    برجيكس على النصوص المقتبسة، فزوجٌ فارغ داخل تعليق يبتلع المدخل التالي بصمت.
  '/home/schools.html',
  '/student/index.html',
  '/teacher/index.html',
  '/cms/index.html',
  '/schedule/index.html',
  '/master-admin/index.html',
  '/master-admin/register.html'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // addAll يفشل كلّه إن فشل أيّ مورد؛ نخزّن كلاً على حدة بتساهل.
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(url)['catch'](function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isApiRequest(url) {
  return /\/gas\//.test(url.pathname);
}

// رابطُ خبرٍ مشارَك (`?news=<id>`) — صفحةٌ بعينها لا تُستبدَل بأيّ قشرة.
function hasNewsParam(url) {
  return /(^|[?&])news=/.test(url.search || '');
}

/* التنقّل: الشبكة أولاً. بعد `NAV_TIMEOUT_MS` يُخدَم **المطابقُ للطلب** إن وُجد وإلّا يستمرّ
   الانتظار؛ والبديلُ (قشرةُ القسم أو صفحةُ «غير متصل») عند **فشلٍ فعليّ** وحده. */
function navigateResponse(req, url) {
  var network = fetchWithTimeout(req, NAV_HARD_TIMEOUT_MS).then(function (res) {
    /* 🔴 `res.ok` شرطٌ لا تجميل: `fetch` **لا يرفض** على 502/504، فصفحةُ خطأِ الوسيط كانت
       تُخزَّن قشرةً وتُخدَم دون اتصال (سلوكٌ قائمٌ قبل هذه الدفعة، ونافذتُه اتّسعت من
       3.5ث إلى 25ث بالمهلة الصلبة) — رصدَته المراجعةُ المستقلّة قبل الدمج. */
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  });
  return new Promise(function (resolve) {
    var settled = false;
    function finish(r) { if (!settled) { settled = true; resolve(r); } }
    var t = setTimeout(function () {
      caches.match(req).then(function (hit) { if (hit) finish(hit); })['catch'](function () {});
    }, NAV_TIMEOUT_MS);
    network.then(function (res) {
      clearTimeout(t); finish(res);
    })['catch'](function () {
      clearTimeout(t);
      navigateFallback(req, url).then(finish, function () { finish(offlineResponse()); });
    });
  });
}

/* 🔴 **لا جذرَ الموقع بديلاً أبداً** — كان آخرَ الاحتياطات فخُدمت بوّابةُ الجذر مكانَ الخبر
   (عنوانُ الصفحة كان الجذر على هاتف المالك). وسلسلةُ `.then` صريحة لأن `caches.match`
   تُرجع وعداً صادقاً دائماً فلا يعمل `||` بين الوعود. */
function navigateFallback(req, url) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    if (hasNewsParam(url)) return offlineResponse();   // الخبرُ لا يُستبدَل بقشرةٍ أخرى
    var seg = url.pathname.split('/')[1] || '';
    if (!seg) return offlineResponse();
    return caches.match('/' + seg + '/index.html').then(function (h2) {
      return h2 || offlineResponse();
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);

  // نداءات الخادم: تمرير فقط (لا نخزّن POST؛ المعالجة دون اتصال في الجسر).
  if (req.method !== 'GET' || isApiRequest(url)) {
    return; // اترك المتصفّح يتعامل معه افتراضياً
  }

  // طلبات عابرة للأصل (صور Drive، خطوط/CDN، GTM...) — لا علاقة لها بمنطق تخزين هذا
  // الموقع؛ تُترَك للمتصفّح مباشرة بدل اعتراضها هنا (يمنع أخطاء استجابة مبهمة/فاشلة
  // على موارد خارجية بحتة).
  if (url.origin !== self.location.origin) {
    return;
  }

  // التنقّل بين الصفحات: شبكة أولاً ثم الكاش ثم صفحة بديلة.
  var isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isNavigation) {
    event.respondWith(navigateResponse(req, url));
    return;
  }

  // الأصول الثابتة: من الكاش فوراً إن وُجد (cache-first) مع تحديث بالخلفية بمهلة.
  event.respondWith(
    caches.match(req).then(function (hit) {
      var revalidate = fetchWithTimeout(req, ASSET_TIMEOUT_MS).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })['catch'](function () {
        // hit نفسها قد تكون undefined (لا كاش سابق) — بدونها event.respondWith يستلم
        // undefined فيرمي "Failed to convert value to 'Response'"؛ اضمن Response دوماً.
        return hit || new Response('', { status: 504, statusText: 'offline' });
      });
      return hit || revalidate;
    })
  );
});

// Background Sync: ننبّه الصفحات لتفريغ الطابور.
self.addEventListener('sync', function (event) {
  if (event.tag === 'creativity-outbox-sync') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then(function (clients) {
        clients.forEach(function (c) { c.postMessage({ type: 'creativity-sync' }); });
      })
    );
  }
});
