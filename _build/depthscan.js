// يحسب عمق الأقواس {} (خارج النصوص والتعليقات) عند بداية أسطر دوال محددة،
// لتحديد ما إذا كانت الدالة عامّة (عمق 0) أم متداخلة.
var fs = require('fs');
var src = fs.readFileSync(process.argv[2], 'utf8');
var targets = {}; // lineNo -> name
process.argv.slice(3).forEach(function (a) {
  var p = a.split(':'); targets[parseInt(p[0], 10)] = p[1];
});

var depth = 0, line = 1;
var i = 0, n = src.length;
var inLine = false, inBlock = false, inStr = null;
var lineStartDepth = { 1: 0 };
while (i < n) {
  var c = src[i], c2 = src[i + 1];
  if (c === '\n') {
    line++; inLine = false; lineStartDepth[line] = depth; i++; continue;
  }
  if (inLine) { i++; continue; }
  if (inBlock) { if (c === '*' && c2 === '/') { inBlock = false; i += 2; continue; } i++; continue; }
  if (inStr) {
    if (c === '\\') { i += 2; continue; }
    if (c === inStr) inStr = null;
    i++; continue;
  }
  if (c === '/' && c2 === '/') { inLine = true; i += 2; continue; }
  if (c === '/' && c2 === '*') { inBlock = true; i += 2; continue; }
  if (c === '"' || c === "'" || c === '`') { inStr = c; i++; continue; }
  if (c === '{') depth++;
  else if (c === '}') depth--;
  i++;
}

Object.keys(targets).forEach(function (ln) {
  var d = lineStartDepth[parseInt(ln, 10)];
  console.log('line ' + ln + ' (' + targets[ln] + '): depth=' + (d === undefined ? '?' : d) + (d === 0 ? '  ← عامّة ✓' : '  ← متداخلة ⚠'));
});
