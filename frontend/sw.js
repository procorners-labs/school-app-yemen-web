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
var CACHE = 'creativity-shell-v7';

// مهلة قصوى لانتظار الشبكة قبل الرجوع للكاش (يمنع «الشاشة البيضاء» على
// الشبكات التي تتجمّد دون أن تفشل — الاتصال يبقى معلّقاً بلا رد).
var NAV_TIMEOUT_MS = 3500;   // التنقّل (الصفحات)
var ASSET_TIMEOUT_MS = 6000; // الأصول الثابتة

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
  '/offline.html',
  '/manifest.webmanifest',
  '/assets/gas-bridge.js',
  '/assets/offline-db.js',
  '/assets/offline-sync.js',
  '/home/index.html',
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
    // الشبكة أولاً بمهلة → عند البطء/الفشل ارجع لقشرة الكاش فوراً (لا شاشة بيضاء).
    event.respondWith(
      fetchWithTimeout(req, NAV_TIMEOUT_MS).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      })['catch'](function () {
        // سلسلة احتياطات متتابعة فعلياً (caches.match ترجع وعداً "صادقاً" دوماً، فـ||
        // بين وعود لا يجرّب الاحتياط التالي عند فشل الأول — يجب سلسلة .then صريحة)،
        // مع ضمان نهائي: Response صريحة بدل undefined إن فشلت كل المحاولات.
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          return caches.match('/' + ((url.pathname.split('/')[1]) || '') + '/index.html').then(function (h2) {
            if (h2) return h2;
            return caches.match('/offline.html').then(function (h3) {
              return h3 || caches.match('/index.html');
            });
          });
        }).then(function (finalHit) {
          return finalHit || new Response(
            '<h1>غير متصل بالإنترنت</h1>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        });
      })
    );
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
