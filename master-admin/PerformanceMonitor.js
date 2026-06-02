// ══════════════════════════════════════════════════════
// مراقب الأداء — تسجيل زمن تنفيذ كل دالة حساسة
//  PerformanceMonitor.gs
// ══════════════════════════════════════════════════════

function _perf_log(fnName, durationMs, success) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Performance');
    if (!sheet) {
      sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('Performance');
      sheet.appendRow(['Timestamp', 'Function', 'Duration (ms)', 'Success']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), fnName, durationMs, success ? 'TRUE' : 'FALSE']);

    // قص الأقدم إذا تجاوز 5000 صف
    var maxRows = 5000;
    if (sheet.getLastRow() > maxRows) {
      sheet.deleteRows(2, sheet.getLastRow() - maxRows);
    }
  } catch (e) { /* تجاهل */ }
}

function withPerfTracking(fnName, callback) {
  var start = new Date().getTime();
  var success = false;
  try {
    var result = callback();
    success = true;
    return result;
  } finally {
    var duration = new Date().getTime() - start;
    if (duration > 500) { // سجّل فقط ما يتجاوز 500ms
      _perf_log(fnName, duration, success);
    }
  }
}

// استخدام:
// function saveGradesProtected(params) {
//   return withPerfTracking('saveGradesProtected', function() {
//     return withAuthAndClass(params, ...);
//   });
// }
function getPerformanceReport(days) {
  days = days || 7;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Performance');
  if (!sheet) return { ok: false, error: 'لا توجد بيانات' };

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: true, summary: [] };

  var cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  var byFunction = {};

  for (var i = 1; i < data.length; i++) {
    var ts = new Date(data[i][0]).getTime();
    if (ts < cutoff) continue;
    var fn = data[i][1];
    var dur = parseInt(data[i][2]);
    if (!byFunction[fn]) {
      byFunction[fn] = { count: 0, total: 0, max: 0, min: 9999999 };
    }
    byFunction[fn].count++;
    byFunction[fn].total += dur;
    if (dur > byFunction[fn].max) byFunction[fn].max = dur;
    if (dur < byFunction[fn].min) byFunction[fn].min = dur;
  }

  var summary = [];
  for (var fnName in byFunction) {
    if (!byFunction.hasOwnProperty(fnName)) continue;
    var s = byFunction[fnName];
    summary.push({
      function: fnName,
      count: s.count,
      avgMs: Math.round(s.total / s.count),
      maxMs: s.max,
      minMs: s.min
    });
  }
  summary.sort(function(a, b) { return b.avgMs - a.avgMs; });
  return { ok: true, summary: summary };
}