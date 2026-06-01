// محاكاة بيئة المتصفح لاختبار gas-bridge.js
var fs = require('fs');
var captured = [];
global.window = { GAS_ENDPOINT: 'https://example/exec', SCHOOL_ID: '777' };
global.fetch = function(url, opts){
  captured.push({ url: url, body: JSON.parse(opts.body), ctype: opts.headers['Content-Type'] });
  // نحاكي رداً ناجحاً يعكس fn
  return Promise.resolve({ text: function(){ return Promise.resolve(JSON.stringify({ ok:true, result:{ echo: JSON.parse(opts.body).fn } })); } });
};
global.URLSearchParams = require('url').URLSearchParams;

// حمّل الجسر
eval(fs.readFileSync('frontend/assets/gas-bridge.js','utf8'));
var google = global.window.google;

var results = [];
// 1) النمط السلسلي العادي
google.script.run
  .withSuccessHandler(function(r){ results.push('success:'+r.echo); })
  .withFailureHandler(function(e){ results.push('fail:'+e.message); })
  .getHomeData(6, 'x');

// 2) النمط الديناميكي مثل schedule: runner[fn].apply(runner, params)
var runner = google.script.run
  .withSuccessHandler(function(r){ results.push('dyn:'+r.echo); })
  .withFailureHandler(function(e){ results.push('dynfail:'+e.message); });
var fn = 'getClassSchedule';
runner[fn].apply(runner, ['class-3', '777']);

setTimeout(function(){
  console.log('--- الطلبات الملتقطة ---');
  captured.forEach(function(c){ console.log(c.ctype, '| fn=', c.body.fn, '| args=', JSON.stringify(c.body.args), '| schoolId=', c.body.schoolId); });
  console.log('--- النتائج (معالجات النجاح) ---');
  console.log(results.join('\n'));
}, 50);
