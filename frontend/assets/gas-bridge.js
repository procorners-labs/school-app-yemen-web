/*!
 * gas-bridge.js — Drop-in replacement for google.script.run (ES5)
 * متوافق مع Cloudflare Workers / CORS proxies
 * يستخدم XMLHttpRequest لتجنب تداخل إضافات المتصفح
 */
(function () {
  'use strict';

  var WITH_HANDLERS = {
    withSuccessHandler: true,
    withFailureHandler: true,
    withUserObject: true
  };

  // علامة على أخطاء الشبكة (تعذّر الوصول للخادم) لتمييزها عن أخطاء الخادم المنطقية.
  function netError(msg) { var e = new Error(msg); e.__network = true; return e; }

  // النقل الخام: نفس سلوك google.script.run الأصلي عبر XHR.
  // أخطاء الشبكة (status 0/مهلة/onerror/رد غير صالح/خطأ بوابة) تُعلَّم __network=true.
  function rawCall(fnName, args, onSuccess, onFailure, userObject) {
    var endpoint = window.GAS_ENDPOINT;
    if (!endpoint) {
      if (onFailure) onFailure(new Error('GAS_ENDPOINT غير مُعرّف'), userObject);
      return;
    }

    var payload = JSON.stringify({
      fn: fnName,
      args: args,
      schoolId: window.SCHOOL_ID || null
    });

    // استخدام XMLHttpRequest بدلاً من fetch لضمان التوافق وتجنب تداخل الإضافات
    var xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint, true);
    xhr.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    xhr.timeout = 25000; // 25 ثانية

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;

      if (xhr.status === 0 || xhr.status >= 400) {
        // الخادم غير قابل للوصول (شبكة/بوابة): خطأ شبكة.
        if (onFailure) onFailure(netError('فشل الاتصال (status ' + xhr.status + ')'), userObject);
        return;
      }

      var text = xhr.responseText;
      var data = null;
      try { data = JSON.parse(text); } catch (e) {
        // رد غير JSON (بوابة أسر/صفحة خطأ) — نعدّه خطأ شبكة ليعمل التراجع للكاش.
        if (onFailure) onFailure(netError('رد غير صالح'), userObject);
        return;
      }

      if (data && data.ok) {
        if (onSuccess) onSuccess(data.result, userObject);
      } else {
        // الخادم رد بنجاح اتصال لكن بخطأ منطقي — ليس خطأ شبكة.
        if (onFailure) onFailure(new Error((data && data.error) || 'خطأ في الخادم'), userObject);
      }
    };

    xhr.ontimeout = function () {
      if (onFailure) onFailure(netError('انتهت مهلة الاتصال'), userObject);
    };

    xhr.onerror = function () {
      if (onFailure) onFailure(netError('فشل الاتصال بالشبكة'), userObject);
    };

    xhr.send(payload);
  }

  // يكشف النقل الخام لمحرّك المزامنة (offline-sync.js) لإعادة تشغيل عمليات الطابور.
  window.__gasRawCall = rawCall;

  function optimisticWrite() {
    return { success: true, queued: true, offline: true,
             message: '✅ حُفظ محلياً — سيُزامن تلقائياً عند عودة الاتصال' };
  }

  // طبقة العمل دون اتصال فوق النقل الخام (تستشير window.OfflineSync).
  function callServer(fnName, args, onSuccess, onFailure, userObject) {
    var OS = window.OfflineSync;
    if (!OS) { rawCall(fnName, args, onSuccess, onFailure, userObject); return; }

    var app = OS.appName();
    var schoolId = window.SCHOOL_ID || null;
    var kind = OS.classify(fnName);

    if (kind === 'read') {
      // نتتبّع القراءة لإعادة التحقّق منها وتحديثها تلقائياً عند عودة الاتصال.
      if (OS.trackRead) OS.trackRead(app, fnName, args, schoolId);
      if (OS.isOnline()) {
        rawCall(fnName, args, function (result, uo) {
          OS.cacheRead(app, fnName, args, schoolId, result);
          if (onSuccess) onSuccess(result, uo);
        }, function (err, uo) {
          if (err && err.__network) {
            // تعذّر الوصول: اخدم آخر نتيجة مخزّنة إن وُجدت.
            OS.getCachedRead(app, fnName, args, schoolId).then(function (rec) {
              if (rec && typeof rec.result !== 'undefined') {
                if (onSuccess) onSuccess(rec.result, uo);
              } else if (onFailure) { onFailure(err, uo); }
            });
          } else if (onFailure) { onFailure(err, uo); }
        }, userObject);
      } else {
        OS.getCachedRead(app, fnName, args, schoolId).then(function (rec) {
          if (rec && typeof rec.result !== 'undefined') {
            if (onSuccess) onSuccess(rec.result, userObject);
          } else if (onFailure) {
            onFailure(netError('لا توجد بيانات محفوظة لعرضها دون اتصال'), userObject);
          }
        });
      }
      return;
    }

    if (kind === 'write') {
      if (OS.isOnline()) {
        rawCall(fnName, args, function (result, uo) {
          OS.refreshUI();
          if (onSuccess) onSuccess(result, uo);
        }, function (err, uo) {
          if (err && err.__network) {
            // فشل الإرسال: ضعها في الطابور وأكمل تفاؤلياً.
            OS.enqueue(app, fnName, args, schoolId).then(function () {
              if (onSuccess) onSuccess(optimisticWrite(), uo);
            });
          } else if (onFailure) { onFailure(err, uo); } // خطأ خادم منطقي: أظهره
        }, userObject);
      } else {
        OS.enqueue(app, fnName, args, schoolId).then(function () {
          if (onSuccess) onSuccess(optimisticWrite(), userObject);
        });
      }
      return;
    }

    // online-only (مصادقة/رفع/خارج النطاق): سلوك أصلي + حفظ الجلسة عند النجاح.
    rawCall(fnName, args, function (result, uo) {
      OS.persistSession(fnName, result);
      if (onSuccess) onSuccess(result, uo);
    }, onFailure, userObject);
  }

  function makeRunner() {
    var state = { success: null, failure: null, userObject: undefined };
    var base = {
      withSuccessHandler: function (fn) { state.success = fn; return runner; },
      withFailureHandler: function (fn) { state.failure = fn; return runner; },
      withUserObject: function (obj) { state.userObject = obj; return runner; }
    };
    var runner = new Proxy(base, {
      get: function (target, prop) {
        if (typeof prop !== 'string') return target[prop];
        if (WITH_HANDLERS[prop]) return target[prop];
        return function () {
          var args = Array.prototype.slice.call(arguments);
          callServer(prop, args, state.success, state.failure, state.userObject);
        };
      }
    });
    return runner;
  }

  var google = window.google = window.google || {};
  google.script = google.script || {};
  Object.defineProperty(google.script, 'run', {
    configurable: true,
    get: function () { return makeRunner(); }
  });
  google.script.host = google.script.host || {
    close: function () {}, setHeight: function () {}, setWidth: function () {}, origin: '', editor: { focus: function () {} }
  };
  google.script.url = google.script.url || {
    getLocation: function (cb) { if (cb) cb({ parameter: {}, parameters: {}, hash: '' }); }
  };
  google.script.history = google.script.history || {
    push: function () {}, replace: function () {}, setChangeHandler: function () {}
  };
})();
