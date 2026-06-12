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

var CACHE = 'creativity-shell-v2';

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

  // التنقّل بين الصفحات: شبكة أولاً ثم الكاش ثم صفحة بديلة.
  var isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isNavigation) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      })['catch'](function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('/offline.html') || caches.match('/index.html');
        });
      })
    );
    return;
  }

  // الأصول الثابتة: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then(function (hit) {
      var fetchPromise = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })['catch'](function () { return hit; });
      return hit || fetchPromise;
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
