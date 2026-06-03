/**
 * test-offline.js — اختبارات سلوك طبقة العمل دون اتصال + المزامنة
 * مدارس الإبداع والتميز الدولية
 *
 * يحمّل offline-sync.js + gas-bridge.js داخل بيئة متصفّح محاكاة (vm sandbox)
 * بمخزون OfflineDB في الذاكرة، ويتحقّق من: التصنيف، حفظ الكتابة دون اتصال،
 * خدمة القراءة من الكاش، تفريغ الطابور عند الاتصال، وتعليم أخطاء الخادم.
 *
 * يعمل بـ Node المدمج فقط (vm/fs/path) — بلا تبعيات. يُرجع رمز خروج غير صفري عند الفشل.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var ASSETS = path.join(ROOT, 'frontend', 'assets');

// ── مخزون OfflineDB في الذاكرة ──
function makeDB() {
  var s = { readcache: {}, outbox: {}, kv: {} };
  return {
    _s: s, hasIndexedDB: true,
    get: function (st, k) { return Promise.resolve((k in s[st]) ? s[st][k] : null); },
    set: function (st, k, v) { s[st][k] = v; return Promise.resolve(); },
    del: function (st, k) { delete s[st][k]; return Promise.resolve(); },
    all: function (st) { return Promise.resolve(Object.keys(s[st]).map(function (k) { return s[st][k]; })); },
    clear: function (st) { s[st] = {}; return Promise.resolve(); }
  };
}

// ── بيئة window/document مبسّطة ──
function makeSandbox(online) {
  var listeners = {};
  function el() {
    return {
      classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
      style: {}, appendChild: function () {}, setAttribute: function () {},
      set textContent(v) {}, get textContent() { return ''; }, id: ''
    };
  }
  var win = {};
  Object.assign(win, {
    OfflineDB: makeDB(),
    navigator: { onLine: online },
    localStorage: {
      _m: {},
      getItem: function (k) { return this._m[k] || null; },
      setItem: function (k, v) { this._m[k] = String(v); },
      removeItem: function (k) { delete this._m[k]; }
    },
    addEventListener: function (t, f) { (listeners[t] = listeners[t] || []).push(f); },
    setTimeout: function (f) { return setTimeout(f, 0); }, clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, requestAnimationFrame: function (f) { f(); },
    Math: Math, Date: Date, JSON: JSON, console: console, Promise: Promise,
    Error: Error, String: String, Number: Number,
    _fire: function (t) { (listeners[t] || []).forEach(function (f) { f(); }); }
  });
  win.window = win;
  win.document = {
    readyState: 'complete', createElement: el, head: el(), body: el(),
    addEventListener: function (t, f) { (listeners[t] = listeners[t] || []).push(f); }
  };
  return win;
}

function run(win) {
  var ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ASSETS, 'offline-sync.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ASSETS, 'gas-bridge.js'), 'utf8'), ctx);
  return ctx;
}

var wait = function () { return new Promise(function (r) { setTimeout(r, 30); }); };
var pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } }

(async function () {
  // 1) التصنيف
  {
    var win = makeSandbox(true); win.GAS_ENDPOINT = '/gas/teacher'; run(win);
    var OS = win.OfflineSync;
    console.log('classify:');
    ok(OS.classify('saveAttendanceSingleProtected') === 'write', 'attendance = write');
    ok(OS.classify('getGrades') === 'read', 'getGrades = read');
    ok(OS.classify('handleTeacherLogin') === 'online-only', 'login = online-only');
    ok(OS.classify('toggleStudentNewsLike') === 'online-only', 'student write out-of-scope = online-only');
    ok(OS.classify('adminGetAllTeachersGrouped') === 'read', 'admin get = read');
  }

  // 2) كتابة دون اتصال → طابور + نجاح تفاؤلي
  {
    var win = makeSandbox(false); win.GAS_ENDPOINT = '/gas/teacher'; win.SCHOOL_ID = 'S1'; run(win);
    var got = null;
    win.google.script.run
      .withSuccessHandler(function (r) { got = r; })
      .withFailureHandler(function (e) { got = { err: e.message }; })
      .saveAttendanceSingleProtected({ token: 't', code: '1', status: 'حاضر' });
    await wait();
    console.log('offline write:');
    ok(got && got.success && got.queued, 'optimistic success returned');
    var ob = await win.OfflineDB.all('outbox');
    ok(ob.length === 1 && ob[0].fn === 'saveAttendanceSingleProtected', 'op enqueued in outbox');
  }

  // 3) قراءة دون اتصال → من الكاش
  {
    var win = makeSandbox(false); win.GAS_ENDPOINT = '/gas/teacher'; run(win);
    var OS = win.OfflineSync;
    await OS.cacheRead('teacher', 'getListsDataProtected', [{ token: 't' }], null, { lists: ['x'] });
    var got = null;
    win.google.script.run.withSuccessHandler(function (r) { got = r; }).withFailureHandler(function () { got = { err: 1 }; })
      .getListsDataProtected({ token: 't' });
    await wait();
    console.log('offline read:');
    ok(got && got.lists && got.lists[0] === 'x', 'served cached read offline');
  }

  // 4) المزامنة عند الاتصال تفرّغ الطابور
  {
    var win = makeSandbox(true); win.GAS_ENDPOINT = '/gas/teacher'; run(win);
    var OS = win.OfflineSync;
    await OS.enqueue('teacher', 'addListItemProtected', [{ token: 't', value: 'a' }], null);
    var n0 = (await win.OfflineDB.all('outbox')).length;
    var calls = 0;
    win.__gasRawCall = function (fn, args, onS) { calls++; onS({ success: true }); };
    await OS.flush(); await wait(); await wait();
    var n1 = (await win.OfflineDB.all('outbox')).length;
    console.log('online flush:');
    ok(n0 === 1, 'one op queued before flush');
    ok(calls === 1, 'rawCall invoked during flush');
    ok(n1 === 0, 'outbox drained after successful sync');
  }

  // 5) خطأ خادم منطقي → يُعلَّم failed (لا فقدان، لا إعادة لا نهائية)
  {
    var win = makeSandbox(true); win.GAS_ENDPOINT = '/gas/teacher'; run(win);
    var OS = win.OfflineSync;
    await OS.enqueue('teacher', 'addListItemProtected', [{ token: 'bad' }], null);
    win.__gasRawCall = function (fn, args, onS, onF) { onF(new Error('توكن غير صالح')); };
    await OS.flush(); await wait(); await wait();
    var ob = await win.OfflineDB.all('outbox');
    console.log('server-error flush:');
    ok(ob.length === 1 && ob[0].status === 'failed', 'op marked failed (kept for review, not lost)');
  }

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
