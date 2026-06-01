// Extracts the set of backend function names invoked via google.script.run
// across each app's HTML files. Walks balanced parens so handler bodies
// (which themselves contain calls) don't confuse the terminal method name.
var fs = require('fs');
var path = require('path');

var APPS = {
  home:     ['Index.html', 'Privacy.html', 'Diagnostics.html'],
  student:  ['Student Portal.html', 'Student_Reports.html'],
  teacher:  ['Teacher Dashboard.html', 'Teacher_Reports.html'],
  cms:      ['Dashboard.html', 'AddForm.html', 'ViewContent.html', 'AuditLog.html', 'README.html'],
  schedule: ['TeacherScheduleManager.html']
};

var ROOT = path.resolve(__dirname, '..');

// Given source and an index pointing just after a '(', return index of the
// matching ')'. Handles strings and nested parens crudely but adequately.
function matchParen(src, i) {
  var depth = 1;
  var inStr = null;
  while (i < src.length) {
    var c = src[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
    } else {
      if (c === '"' || c === "'" || c === '`') inStr = c;
      else if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return i; }
    }
    i++;
  }
  return -1;
}

var WITH = { withSuccessHandler: 1, withFailureHandler: 1, withUserObject: 1 };

function extractFromSource(src) {
  var names = {};
  var re = /google\s*\.\s*script\s*\.\s*run/g;
  var m;
  while ((m = re.exec(src)) !== null) {
    var i = m.index + m[0].length;
    // Walk the chain: sequence of .ident( ... )
    while (true) {
      // skip whitespace
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] !== '.') break;
      i++;
      while (i < src.length && /\s/.test(src[i])) i++;
      var idm = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
      if (!idm) break;
      var ident = idm[0];
      i += ident.length;
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] !== '(') { break; }
      var close = matchParen(src, i + 1);
      if (close < 0) break;
      i = close + 1;
      if (!WITH[ident]) { names[ident] = true; break; } // terminal call
      // else it's a with* handler; continue chain
    }
  }
  return Object.keys(names);
}

var out = {};
Object.keys(APPS).forEach(function (app) {
  var set = {};
  APPS[app].forEach(function (file) {
    var p = path.join(ROOT, app, file);
    if (!fs.existsSync(p)) return;
    var src = fs.readFileSync(p, 'utf8');
    extractFromSource(src).forEach(function (n) { set[n] = true; });
  });
  out[app] = Object.keys(set).sort();
});

fs.writeFileSync(path.join(__dirname, 'whitelist.json'), JSON.stringify(out, null, 2));
Object.keys(out).forEach(function (app) {
  console.log(app + ' (' + out[app].length + '): ' + out[app].join(', '));
});
