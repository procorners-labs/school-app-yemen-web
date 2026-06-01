/*!
 * gas-bridge.js — Drop-in replacement for google.script.run
 * مدارس الإبداع والتميز الدولية
 *
 * يعيد تعريف google.script.run ليوجّه كل الاستدعاءات إلى نقطة doPost في
 * تطبيق Google Apps Script عبر fetch()، بدل عميل HtmlService. هكذا يمكن
 * استضافة الواجهة على GitHub Pages دون رسالة تحذير Google.
 *
 * ملاحظات CORS المهمة:
 *  - لا يمكن لـ GAS ضبط ترويسة Access-Control-Allow-Origin بنفسه، لكن رابط
 *    /exec المنشور يُرجِع ACAO:* تلقائياً.
 *  - نُرسل الطلب بنوع محتوى text/plain ليبقى "طلباً بسيطاً" (simple request)
 *    فلا يُطلَب preflight (OPTIONS) الذي لا يستطيع GAS الرد عليه.
 *
 * الإعداد لكل صفحة: عرّف window.GAS_ENDPOINT قبل تحميل هذا الملف.
 * صياغة ES5 فقط (var، دوال عادية، بلا قوالب نصية). يُستخدم Proxy لاعتراض
 * أسماء الدوال الديناميكية مثل runner[fn](...) — وهو مدعوم في كل المتصفحات.
 */
(function () {
  'use strict';

  var WITH_HANDLERS = {
    withSuccessHandler: true,
    withFailureHandler: true,
    withUserObject: true
  };

  function callServer(fnName, args, onSuccess, onFailure, userObject) {
    var endpoint = window.GAS_ENDPOINT;
    if (!endpoint) {
      if (onFailure) onFailure(new Error('GAS_ENDPOINT غير مُعرّف في هذه الصفحة'), userObject);
      return;
    }
    var payload = JSON.stringify({
      fn: fnName,
      args: args,
      schoolId: window.SCHOOL_ID || null
    });

    fetch(endpoint, {
      method: 'POST',
      // text/plain = طلب بسيط بلا preflight (لا doOptions في GAS)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload,
      redirect: 'follow'
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      var data = null;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        if (onFailure) onFailure(new Error('رد غير صالح من الخادم: ' + String(text).slice(0, 200)), userObject);
        return;
      }
      if (data && data.ok) {
        if (onSuccess) onSuccess(data.result, userObject);
      } else {
        if (onFailure) onFailure(new Error((data && data.error) || 'خطأ في الخادم'), userObject);
      }
    })['catch'](function (err) {
      if (onFailure) onFailure(err, userObject);
    });
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
        // أي اسم آخر يُعامَل كاسم دالة خادمية تُستدعى عبر fetch.
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

  // كل وصول إلى google.script.run يُعيد عدّاءً جديداً، لأن المستدعي يربط
  // المعالجات ثم يستدعي الدالة في كل مرة على حدة.
  Object.defineProperty(google.script, 'run', {
    configurable: true,
    get: function () { return makeRunner(); }
  });

  // أطراف بديلة بسيطة لبقية واجهات google.script المستخدمة في صفحات GAS.
  google.script.host = google.script.host || {
    close: function () {},
    setHeight: function () {},
    setWidth: function () {},
    origin: '',
    editor: { focus: function () {} }
  };
  google.script.url = google.script.url || {
    getLocation: function (cb) {
      if (cb) cb({ parameter: {}, parameters: {}, hash: '' });
    }
  };
  google.script.history = google.script.history || {
    push: function () {},
    replace: function () {},
    setChangeHandler: function () {}
  };
})();
