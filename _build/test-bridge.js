// محاكاة بيئة المتصفح لاختبار gas-bridge.js (يستخدم XMLHttpRequest)
var fs = require('fs');
var captured = [];

global.window = { GAS_ENDPOINT: 'https://example/exec', SCHOOL_ID: '777' };
global.URLSearchParams = require('url').URLSearchParams;

// محاكاة XMLHttpRequest مطابقة لما يستخدمه gas-bridge.js
function MockXHR() {
  this.readyState = 0;
  this.status = 0;
  this.responseText = '';
  this._headers = {};
  this.onreadystatechange = null;
  this.ontimeout = null;
  this.onerror = null;
  this.timeout = 0;
}
MockXHR.prototype.open = function (method, url) {
  this._method = method;
  this._url = url;
};
MockXHR.prototype.setRequestHeader = function (name, value) {
  this._headers[name] = value;
};
MockXHR.prototype.send = function (payload) {
  var self = this;
  var body = JSON.parse(payload);
  captured.push({
    method: self._method,
    url: self._url,
    ctype: self._headers['Content-Type'],
    body: body
  });
  // محاكاة رد ناجح غير متزامن يعكس اسم الدالة
  setTimeout(function () {
    self.readyState = 4;
    self.status = 200;
    self.responseText = JSON.stringify({ ok: true, result: { echo: body.fn } });
    if (self.onreadystatechange) self.onreadystatechange();
  }, 0);
};
global.XMLHttpRequest = MockXHR;

// حمّل الجسر
eval(fs.readFileSync('frontend/assets/gas-bridge.js', 'utf8'));
var google = global.window.google;

var results = [];
// 1) النمط السلسلي العادي
google.script.run
  .withSuccessHandler(function (r) { results.push('success:' + r.echo); })
  .withFailureHandler(function (e) { results.push('fail:' + e.message); })
  .getHomeData(6, 'x');

// 2) النمط الديناميكي مثل schedule: runner[fn].apply(runner, params)
var runner = google.script.run
  .withSuccessHandler(function (r) { results.push('dyn:' + r.echo); })
  .withFailureHandler(function (e) { results.push('dynfail:' + e.message); });
var fn = 'getClassSchedule';
runner[fn].apply(runner, ['class-3', '777']);

setTimeout(function () {
  console.log('--- الطلبات الملتقطة ---');
  captured.forEach(function (c) {
    console.log(c.method, c.ctype, '| fn=', c.body.fn, '| args=', JSON.stringify(c.body.args), '| schoolId=', c.body.schoolId);
  });
  console.log('--- النتائج (معالجات النجاح) ---');
  console.log(results.join('\n'));

  // تأكيدات بسيطة
  var ok = true;
  if (captured.length !== 2) { ok = false; console.log('✗ عدد الطلبات المتوقع 2'); }
  if (captured[0] && captured[0].ctype.indexOf('text/plain') === -1) { ok = false; console.log('✗ نوع المحتوى يجب أن يكون text/plain'); }
  if (captured[0] && captured[0].method !== 'POST') { ok = false; console.log('✗ الطريقة يجب أن تكون POST'); }
  if (captured[0] && captured[0].body.schoolId !== '777') { ok = false; console.log('✗ schoolId يجب أن يُرسَل'); }
  if (results.join(',') !== 'success:getHomeData,dyn:getClassSchedule') { ok = false; console.log('✗ معالجات النجاح غير متطابقة'); }
  console.log(ok ? '\n✅ نجح الاختبار (XHR)' : '\n❌ فشل الاختبار');
  if (!ok) process.exit(1);
}, 50);
