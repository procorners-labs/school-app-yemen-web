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

var CACHE = 'creativity-shell-v3';

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
    // الشبكة أولاً بمهلة → عند البطء/الفشل ارجع لقشرة الكاش فوراً (لا شاشة بيضاء).
    event.respondWith(
      fetchWithTimeout(req, NAV_TIMEOUT_MS).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      })['catch'](function () {
        return caches.match(req).then(function (hit) {
          return hit ||
                 caches.match('/' + ((url.pathname.split('/')[1]) || '') + '/index.html') ||
                 caches.match('/offline.html') ||
                 caches.match('/index.html');
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
      })['catch'](function () { return hit; });
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
