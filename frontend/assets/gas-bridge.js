/*!
 * gas-bridge.js — Drop-in replacement for google.script.run
 * مدارس الإبداع والتميز الدولية
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
      if (onFailure) onFailure(new Error('GAS_ENDPOINT غير مُعرّف'), userObject);
      return;
    }
    var payload = JSON.stringify({
      fn: fnName,
      args: args,
      schoolId: window.SCHOOL_ID || null
    });

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload,
      redirect: 'follow'
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      var data = null;
      try { data = JSON.parse(text); } catch (e) {
        if (onFailure) onFailure(new Error('رد غير صالح'), userObject);
        return;
      }
      if (data && data.ok) {
        if (onSuccess) onSuccess(data.result, userObject);
      } else {
        if (onFailure) onFailure(new Error((data && data.error) || 'خطأ'), userObject);
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
