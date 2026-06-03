/*!
 * offline-db.js — غلاف IndexedDB مبسّط للعمل دون اتصال
 * مدارس الإبداع والتميز الدولية
 *
 * يوفّر تخزيناً دائماً (يبقى بعد إغلاق التطبيق) لثلاثة أغراض:
 *   - readcache : كاش نتائج القراءة لعرضها دون اتصال.
 *   - outbox    : طابور عمليات الكتابة المعلّقة (للمزامنة لاحقاً).
 *   - kv        : تخزين عام (الجلسة الدائمة، الأعلام).
 *
 * يكشف واجهة وعود (Promise) بسيطة عبر window.OfflineDB.
 * عند غياب IndexedDB يتراجع تلقائياً إلى localStorage حتى لا ينكسر شيء.
 */
(function () {
  'use strict';

  var DB_NAME = 'creativity_offline';
  var DB_VERSION = 1;
  var STORES = ['readcache', 'outbox', 'kv'];

  var _dbPromise = null;
  var _hasIDB = (function () {
    try { return typeof indexedDB !== 'undefined' && indexedDB !== null; }
    catch (e) { return false; }
  })();

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        STORES.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'key' });
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function tx(store, mode) {
    return openDB().then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }

  function reqToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  // ── تراجع localStorage (عند غياب IndexedDB) ──────────────────
  function lsKey(store, key) { return 'odb:' + store + ':' + key; }

  var lsImpl = {
    get: function (store, key) {
      try {
        var raw = localStorage.getItem(lsKey(store, key));
        return Promise.resolve(raw ? JSON.parse(raw).value : null);
      } catch (e) { return Promise.resolve(null); }
    },
    set: function (store, key, value) {
      try { localStorage.setItem(lsKey(store, key), JSON.stringify({ key: key, value: value })); }
      catch (e) {}
      return Promise.resolve();
    },
    del: function (store, key) {
      try { localStorage.removeItem(lsKey(store, key)); } catch (e) {}
      return Promise.resolve();
    },
    all: function (store) {
      var out = [];
      try {
        var prefix = 'odb:' + store + ':';
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(prefix) === 0) {
            try { out.push(JSON.parse(localStorage.getItem(k)).value); } catch (e2) {}
          }
        }
      } catch (e) {}
      return Promise.resolve(out);
    },
    clear: function (store) {
      try {
        var prefix = 'odb:' + store + ':';
        var toRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(prefix) === 0) toRemove.push(k);
        }
        for (var j = 0; j < toRemove.length; j++) localStorage.removeItem(toRemove[j]);
      } catch (e) {}
      return Promise.resolve();
    }
  };

  // ── تطبيق IndexedDB ──────────────────────────────────────────
  var idbImpl = {
    get: function (store, key) {
      return tx(store, 'readonly').then(function (os) {
        return reqToPromise(os.get(key));
      }).then(function (rec) { return rec ? rec.value : null; });
    },
    set: function (store, key, value) {
      return tx(store, 'readwrite').then(function (os) {
        return reqToPromise(os.put({ key: key, value: value }));
      });
    },
    del: function (store, key) {
      return tx(store, 'readwrite').then(function (os) {
        return reqToPromise(os.delete(key));
      });
    },
    all: function (store) {
      return tx(store, 'readonly').then(function (os) {
        return reqToPromise(os.getAll());
      }).then(function (recs) {
        return (recs || []).map(function (r) { return r.value; });
      });
    },
    clear: function (store) {
      return tx(store, 'readwrite').then(function (os) {
        return reqToPromise(os.clear());
      });
    }
  };

  var impl = _hasIDB ? idbImpl : lsImpl;

  // غلاف آمن: أي فشل في IndexedDB يتراجع بهدوء إلى localStorage.
  function safe(method, store, key, value) {
    try {
      return impl[method](store, key, value)['catch'](function () {
        return lsImpl[method](store, key, value);
      });
    } catch (e) {
      return lsImpl[method](store, key, value);
    }
  }

  window.OfflineDB = {
    get: function (store, key) { return safe('get', store, key); },
    set: function (store, key, value) { return safe('set', store, key, value); },
    del: function (store, key) { return safe('del', store, key); },
    all: function (store) { return safe('all', store); },
    clear: function (store) { return safe('clear', store); },
    hasIndexedDB: _hasIDB
  };
})();
