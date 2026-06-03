/*!
 * offline-sync.js — محرك العمل دون اتصال + المزامنة التلقائية + واجهة الحالة
 * مدارس الإبداع والتميز الدولية
 *
 * يعمل بالتعاون مع gas-bridge.js (الذي يستشير window.OfflineSync لكل نداء):
 *   - تصنيف الدوال: قراءة (تُخزَّن وتُخدَم دون اتصال) / كتابة قابلة للطابور / online-only.
 *   - طابور كتابة دائم (outbox) يُزامَن تلقائياً عند عودة الإنترنت (FIFO + إعادة محاولة).
 *   - كاش قراءة دائم لعرض آخر بيانات دون اتصال.
 *   - جلسة دائمة: حفظ/استعادة توكن المعلّم والطالب ليعمل التطبيق بعد إعادة الفتح دون نت.
 *   - شارة عائمة عربية تُظهر حالة الاتصال وعدد العمليات المعلّقة + إشعارات المزامنة.
 *
 * يعتمد على window.OfflineDB (offline-db.js).
 */
(function () {
  'use strict';

  if (!window.OfflineDB) {
    // بلا تخزين دائم لا نستطيع العمل دون اتصال — نترك السلوك الأصلي للجسر.
    return;
  }

  var OUTBOX = 'outbox';
  var READCACHE = 'readcache';
  var KV = 'kv';

  // ── تصنيف الدوال ─────────────────────────────────────────────
  // كتابات المعلّم القابلة للطابور (النطاق المتفق عليه).
  var WRITE_QUEUEABLE = {
    saveAttendanceSingleProtected: true,
    addListItemProtected: true,
    updateListItemProtected: true,
    deleteListItemProtected: true,
    adminSaveTeacherGrouped: true,
    adminDeleteTeacherByName: true
  };

  // دوال يجب أن تصل الشبكة فوراً (تفشل بلطف دون اتصال): مصادقة/رفع ملفات/كتابات خارج النطاق.
  var ONLINE_ONLY = {
    handleTeacherLogin: true,
    loginStudent: true,
    handleTeacherLogout: true,
    changePassword: true,
    uploadFileToDrive: true
  };

  // دوال تُحفظ جلستها بشكل دائم بعد نجاحها.
  var SESSION_FNS = {
    handleTeacherLogin: 'teacher',
    loginStudent: 'student'
  };

  function classify(fn) {
    if (!fn || typeof fn !== 'string') return 'online-only';
    if (ONLINE_ONLY[fn]) return 'online-only';
    if (WRITE_QUEUEABLE[fn]) return 'write';
    // قاعدة عامّة: الدوال التي تبدأ بـ get أو check/login (قراءة) تُخزَّن.
    if (/^get/i.test(fn) || /^check/i.test(fn) || /^login/i.test(fn)) return 'read';
    // مجموعة قراءة صريحة لا تبدأ بـ get.
    if (fn === 'getTeachersForClass' || fn === 'getV3Config' || fn === 'adminGetAllTeachersGrouped') return 'read';
    // أي شيء آخر: لا نخاطر بالطابور — اتركه online-only (سلوك أصلي).
    return 'online-only';
  }

  // ── أدوات ────────────────────────────────────────────────────
  function nowISO() { return new Date().toISOString(); }

  function clientId() {
    try {
      var id = localStorage.getItem('teacherClientId') ||
               localStorage.getItem('stu_clientId') ||
               localStorage.getItem('offlineClientId');
      if (!id) {
        id = 'cid_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('offlineClientId', id);
      }
      return id;
    } catch (e) {
      return 'cid_anon';
    }
  }

  function newOpId() {
    return clientId() + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // تجزئة بسيطة ومستقرّة للوسائط (لمفتاح الكاش).
  function hashArgs(args) {
    var s;
    try { s = JSON.stringify(args || []); } catch (e) { s = String(args); }
    var h = 5381, i = s.length;
    while (i) { h = (h * 33) ^ s.charCodeAt(--i); }
    return (h >>> 0).toString(36);
  }

  function readKey(app, fn, args, schoolId) {
    return (app || '?') + ':' + fn + ':' + hashArgs(args) + ':' + (schoolId || '');
  }

  function appName() {
    // /gas/teacher → teacher
    var ep = window.GAS_ENDPOINT || '';
    var m = ep.match(/\/gas\/([a-zA-Z]+)/);
    return m ? m[1] : (ep || 'app');
  }

  function isOnline() {
    return (typeof navigator === 'undefined') ? true : (navigator.onLine !== false);
  }

  // ── كاش القراءة ──────────────────────────────────────────────
  function cacheRead(app, fn, args, schoolId, result) {
    return OfflineDB.set(READCACHE, readKey(app, fn, args, schoolId), {
      result: result, savedAt: nowISO()
    });
  }

  function getCachedRead(app, fn, args, schoolId) {
    return OfflineDB.get(READCACHE, readKey(app, fn, args, schoolId));
  }

  // ── طابور الكتابة ────────────────────────────────────────────
  function enqueue(app, fn, args, schoolId) {
    var op = {
      key: newOpId(),
      app: app,
      fn: fn,
      args: args,
      schoolId: schoolId,
      createdAt: nowISO(),
      tries: 0,
      status: 'pending'
    };
    return OfflineDB.set(OUTBOX, op.key, op).then(function () {
      UI.refresh();
      requestBackgroundSync();
      return op;
    });
  }

  function pendingOps() {
    return OfflineDB.all(OUTBOX).then(function (ops) {
      ops = ops || [];
      // FIFO حسب وقت الإنشاء.
      ops.sort(function (a, b) { return (a.createdAt < b.createdAt) ? -1 : 1; });
      return ops;
    });
  }

  function pendingCount() {
    return pendingOps().then(function (ops) {
      var n = 0;
      for (var i = 0; i < ops.length; i++) if (ops[i].status !== 'failed') n++;
      return n;
    });
  }

  // ── المزامنة ─────────────────────────────────────────────────
  var _flushing = false;
  var _retryTimer = null;
  var _retryDelay = 2000; // يبدأ 2s ثم يتضاعف حتى 60s

  function scheduleRetry() {
    if (_retryTimer) return;
    _retryTimer = setTimeout(function () {
      _retryTimer = null;
      flush();
    }, _retryDelay);
    _retryDelay = Math.min(_retryDelay * 2, 60000);
  }

  function resetRetry() { _retryDelay = 2000; if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; } }

  // ينفّذ عملية واحدة عبر النقل الخام في الجسر، ويعيد Promise.
  function runOp(op) {
    return new Promise(function (resolve) {
      if (!window.__gasRawCall) { resolve({ kind: 'network' }); return; }
      window.__gasRawCall(op.fn, op.args, function () {
        resolve({ kind: 'ok' });
      }, function (err) {
        // نميّز خطأ الشبكة عن خطأ الخادم المنطقي عبر علامة يضبطها الجسر.
        var net = err && err.__network === true;
        resolve({ kind: net ? 'network' : 'server', error: (err && err.message) || 'خطأ' });
      });
    });
  }

  function flush() {
    if (_flushing) return Promise.resolve();
    if (!isOnline()) return Promise.resolve();
    _flushing = true;
    var synced = 0, failed = 0;

    return pendingOps().then(function (ops) {
      var queue = ops.filter(function (o) { return o.status !== 'failed'; });
      if (queue.length === 0) { return; }
      UI.setSyncing(true);

      // تسلسلي: لا نحذف عملية قبل تأكيد نجاحها (يقلّل التكرار وفقدان البيانات).
      var chain = Promise.resolve();
      queue.forEach(function (op) {
        chain = chain.then(function (stop) {
          if (stop) return stop; // توقّفنا بسبب خطأ شبكة
          op.tries++;
          op.status = 'syncing';
          return OfflineDB.set(OUTBOX, op.key, op).then(function () {
            return runOp(op);
          }).then(function (r) {
            if (r.kind === 'ok') {
              synced++;
              return OfflineDB.del(OUTBOX, op.key).then(function () { UI.refresh(); return false; });
            }
            if (r.kind === 'server') {
              // خطأ منطقي من الخادم: لن تنجح بالإعادة — نعلّمها فاشلة ونُبقيها للمراجعة.
              failed++;
              op.status = 'failed';
              op.lastError = r.error;
              return OfflineDB.set(OUTBOX, op.key, op).then(function () { UI.refresh(); return false; });
            }
            // خطأ شبكة: نتوقّف ونعيد المحاولة لاحقاً (نُبقي الترتيب).
            op.status = 'pending';
            return OfflineDB.set(OUTBOX, op.key, op).then(function () { return true; });
          });
        });
      });
      return chain;
    }).then(function () {
      UI.setSyncing(false);
      _flushing = false;
      return pendingCount().then(function (n) {
        if (synced > 0) UI.toast('✅ تمت مزامنة ' + synced + ' عملية', 'ok');
        if (failed > 0) UI.toast('⚠️ تعذّرت مزامنة ' + failed + ' عملية — راجعها', 'warn');
        if (n > 0) { scheduleRetry(); } else { resetRetry(); }
        UI.refresh();
      });
    })['catch'](function () {
      UI.setSyncing(false);
      _flushing = false;
      scheduleRetry();
    });
  }

  function requestBackgroundSync() {
    try {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg.sync) reg.sync.register('creativity-outbox-sync')['catch'](function () {});
        })['catch'](function () {});
      }
    } catch (e) {}
  }

  // ── الجلسة الدائمة ───────────────────────────────────────────
  // تُستدعى من الجسر بعد نجاح دالة مصادقة، لحفظ الجلسة بشكل دائم.
  function persistSession(fn, result) {
    var which = SESSION_FNS[fn];
    if (!which || !result) return;
    OfflineDB.set(KV, 'session:' + which, { result: result, savedAt: nowISO() });
  }

  // تُستعاد الجلسة المخزّنة (إن وُجدت) — يستدعيها كود التطبيق عند الإقلاع إن لزم.
  function getPersistedSession(which) {
    return OfflineDB.get(KV, 'session:' + which);
  }

  // ── الواجهة (شارة + إشعارات) ─────────────────────────────────
  var UI = (function () {
    var pill, countEl, dot, label, toastWrap, syncing = false;

    function ensure() {
      if (pill || typeof document === 'undefined' || !document.body) return;
      var style = document.createElement('style');
      style.textContent =
        '#ofl-pill{position:fixed;z-index:2147483000;bottom:16px;inset-inline-start:16px;' +
        'display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;' +
        'font:600 13px/1 "Segoe UI",Tahoma,system-ui,sans-serif;color:#fff;direction:rtl;' +
        'background:#1b6fd6;box-shadow:0 8px 24px rgba(0,0,0,.3);cursor:default;' +
        'transition:background .3s,opacity .3s;opacity:.96}' +
        '#ofl-pill .d{width:9px;height:9px;border-radius:50%;background:#fff;flex:0 0 auto}' +
        '#ofl-pill.off{background:#c0392b}#ofl-pill.sync{background:#e67e22}' +
        '#ofl-pill.ok{background:#2e7d32}' +
        '#ofl-pill .c{background:rgba(255,255,255,.25);border-radius:999px;padding:1px 8px;font-weight:800}' +
        '#ofl-toasts{position:fixed;z-index:2147483000;bottom:64px;inset-inline-start:16px;' +
        'display:flex;flex-direction:column;gap:8px;direction:rtl}' +
        '#ofl-toasts .t{padding:10px 14px;border-radius:12px;color:#fff;font:600 13px "Segoe UI",Tahoma,sans-serif;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.3);background:#333;opacity:0;transform:translateY(8px);' +
        'transition:opacity .25s,transform .25s}' +
        '#ofl-toasts .t.show{opacity:1;transform:none}' +
        '#ofl-toasts .t.ok{background:#2e7d32}#ofl-toasts .t.warn{background:#e67e22}#ofl-toasts .t.err{background:#c0392b}';
      document.head.appendChild(style);

      pill = document.createElement('div');
      pill.id = 'ofl-pill';
      dot = document.createElement('span'); dot.className = 'd';
      label = document.createElement('span');
      countEl = document.createElement('span'); countEl.className = 'c'; countEl.style.display = 'none';
      pill.appendChild(dot); pill.appendChild(label); pill.appendChild(countEl);
      document.body.appendChild(pill);

      toastWrap = document.createElement('div');
      toastWrap.id = 'ofl-toasts';
      document.body.appendChild(toastWrap);

      refresh();
    }

    function setSyncing(v) { syncing = v; refresh(); }

    function refresh() {
      if (!pill) { ensure(); if (!pill) return; }
      pendingCount().then(function (n) {
        if (n > 0) { countEl.style.display = ''; countEl.textContent = n; }
        else { countEl.style.display = 'none'; }

        pill.className = '';
        if (!isOnline()) {
          pill.classList.add('off');
          label.textContent = n > 0 ? 'دون اتصال — بانتظار المزامنة' : 'يعمل دون اتصال';
        } else if (syncing) {
          pill.classList.add('sync');
          label.textContent = 'جارٍ المزامنة…';
        } else if (n > 0) {
          pill.classList.add('sync');
          label.textContent = 'بانتظار المزامنة';
        } else {
          pill.classList.add('ok');
          label.textContent = 'متصل';
          // إخفاء لطيف عند الاستقرار.
          setTimeout(function () {
            if (pill && pill.classList.contains('ok')) pill.style.opacity = '0';
          }, 2500);
          return;
        }
        pill.style.opacity = '.96';
      });
    }

    function toast(msg, kind) {
      ensure();
      if (!toastWrap) return;
      var t = document.createElement('div');
      t.className = 't ' + (kind || '');
      t.textContent = msg;
      toastWrap.appendChild(t);
      requestAnimationFrame(function () { t.classList.add('show'); });
      setTimeout(function () {
        t.classList.remove('show');
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
      }, 4000);
    }

    return { ensure: ensure, refresh: refresh, setSyncing: setSyncing, toast: toast };
  })();

  // ── الواجهة العامّة المستهلَكة من gas-bridge.js ───────────────
  window.OfflineSync = {
    classify: classify,
    appName: appName,
    isOnline: isOnline,
    cacheRead: cacheRead,
    getCachedRead: getCachedRead,
    enqueue: enqueue,
    flush: flush,
    persistSession: persistSession,
    getPersistedSession: getPersistedSession,
    pendingCount: pendingCount,
    refreshUI: function () { UI.refresh(); },
    toast: function (m, k) { UI.toast(m, k); }
  };

  // ── المشغّلات ────────────────────────────────────────────────
  function init() {
    UI.ensure();
    if (isOnline()) flush();

    window.addEventListener('online', function () {
      UI.refresh();
      UI.toast('🔄 عاد الاتصال — جارٍ المزامنة', 'ok');
      resetRetry();
      flush();
    });
    window.addEventListener('offline', function () {
      UI.refresh();
      UI.toast('📴 انقطع الاتصال — يعمل التطبيق محلياً', 'warn');
    });

    // مزامنة دورية احتياطية (كل 30 ثانية) عند وجود عمليات معلّقة.
    setInterval(function () {
      if (isOnline()) {
        pendingCount().then(function (n) { if (n > 0) flush(); });
      }
    }, 30000);

    // رسالة من Service Worker (Background Sync).
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', function (ev) {
        if (ev.data && ev.data.type === 'creativity-sync') flush();
      });
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
