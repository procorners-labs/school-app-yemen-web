// ═══════════════════════════════════════════════════════════════
//  _MasterScope.gs — طبقة العزل متعدّد المدارس + دور المالك
//  مدارس الإبداع والتميز الدولية — Master Admin — ES5 فقط
//  يُضاف كملف جديد بجانب Master_Admin.gs (يعتمد على دواله العامة)
// ═══════════════════════════════════════════════════════════════

// الملفات النشطة للطلب الحالي (تُضبط لكل استدعاء؛ تُعاد تهيئتها تلقائياً مع كل تنفيذ)
var _ACTIVE_SCHOOL = null;

// هل الجلسة لمالك النظام (يرى جميع المدارس)؟
function _isOwnerSession(session) {
  if (!session) return false;
  return session.role === 'owner' || session.isOwner === true;
}

function _objLen(o) {
  var c = 0, k;
  for (k in o) { if (o.hasOwnProperty(k)) c++; }
  return c;
}

// قراءة معرّفات ملفات مدرسة محددة من ورقة Schools
function _resolveSchoolFileIds(schoolId) {
  var out = {
    schoolId      : _safeStr(schoolId),
    name          : '',
    teacherFileId : '',
    studentFileId : '',
    cmsFileId     : '',
    scheduleFileId: ''
  };
  if (!out.schoolId) return out;
  var sheet = _getMasterSheet('Schools');
  if (!sheet) return out;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (_safeStr(data[i][0]) === out.schoolId) {
      out.name           = _safeStr(data[i][1]);
      out.teacherFileId  = _safeStr(data[i][4]);
      out.studentFileId  = _safeStr(data[i][5]);
      out.cmsFileId      = _safeStr(data[i][6]);
      out.scheduleFileId = _safeStr(data[i][7]);
      return out;
    }
  }
  return out;
}

// تفعيل مدرسة محددة كمصدر بيانات للطلب الحالي
function _useSchool(schoolId) {
  if (!schoolId) { _ACTIVE_SCHOOL = null; return; }
  var f = _resolveSchoolFileIds(schoolId);
  _ACTIVE_SCHOOL = {
    schoolId : f.schoolId,
    name     : f.name,
    teacher  : f.teacherFileId  || TEACHER_SS_ID,
    student  : f.studentFileId  || f.teacherFileId || STUDENT_SS_ID,
    cms      : f.cmsFileId      || CMS_SS_ID,
    schedule : f.scheduleFileId || SCHEDULE_SS_ID
  };
}

function _clearActiveSchool() { _ACTIVE_SCHOOL = null; }

// قائمة المدارس المفعّلة وغير المنتهية (للتجميع في وضع المالك)
function _listActiveSchools() {
  var out = [];
  var sheet = _getMasterSheet('Schools');
  if (!sheet) return out;
  var data  = sheet.getDataRange().getValues();
  var today = _todayString();
  for (var i = 1; i < data.length; i++) {
    var id = _safeStr(data[i][0]);
    if (!id) continue;
    var active = _safeStr(data[i][10]).toLowerCase();
    if (active !== 'true' && active !== '1') continue;
    var endDate = _safeStr(data[i][9]);
    if (endDate && endDate < today) continue;
    out.push({
      schoolId: id,
      name    : _safeStr(data[i][1]),
      teacher : _safeStr(data[i][4]),
      student : _safeStr(data[i][5]) || _safeStr(data[i][4]),
      cms     : _safeStr(data[i][6]),
      schedule: _safeStr(data[i][7])
    });
  }
  return out;
}

// تحديد نطاق الطلب: مالك (الكل / مدرسة مختارة) أو مدير مدرسة (مقفل على مدرسته)
function _resolveScope(session, params) {
  if (_isOwnerSession(session)) {
    var vid = _safeStr(params && params.viewSchoolId ? params.viewSchoolId : '');
    return { isOwner: true, schoolId: vid, all: (vid === '') };
  }
  return { isOwner: false, schoolId: _safeStr(session.schoolId), all: false };
}

// يضبط الملف النشط للتقارير المفردة (مالك بلا اختيار → مدرسته الافتراضية)
function _applyScope(session, params) {
  var scope = _resolveScope(session, params);
  var sid = scope.schoolId;
  if (!sid && _isOwnerSession(session)) sid = _safeStr(session.schoolId);
  _useSchool(sid);
  return scope;
}

// حساب إحصاءات مدرسة واحدة من ملفاتها النشطة (نقي — لا يكتب Dashboard)
function _computeStatsActive() {
  var stats = {
    totalStudents:0, totalTeachers:0, totalViolations:0, totalHomework:0, totalNews:0,
    todayAbsent:0, todayLate:0, todayPresent:0, attendanceRate:0,
    blockPercentage:0, blockedCount:0,
    totalFees:0, totalPaid:0, totalRemaining:0,
    cmsNews:0, cmsVideos:0, cmsImages:0, cmsScheduled:0, totalPeriods:0,
    teacherFileOk:false, studentFileOk:false, cmsFileOk:false, scheduleFileOk:false
  };
  var today = _todayString();

  // ── ملف المعلمين (الطلاب/المعلمين/المخالفات/الواجبات/الأخبار/الغياب/الرسوم) ──
  try {
    var tSS = _getTeacherSS();

    // نسبة الحجب من ملف الطالب
    var blockPct = 0;
    try {
      var setSh = _getStudentSS().getSheetByName('الاعدادات');
      if (setSh) {
        var setD = setSh.getDataRange().getValues();
        if (setD.length > 1) blockPct = _safeFloat(setD[1][0], 0);
      }
    } catch (se) {}
    stats.blockPercentage = blockPct;

    var studSheet = tSS.getSheetByName('الطلاب');
    if (studSheet) {
      var sd = studSheet.getDataRange().getValues();
      var cnt = 0, tf = 0, tp = 0, bc = 0;
      for (var i = 1; i < sd.length; i++) {
        var code = _safeStr(sd[i][0]);
        var nm   = _safeStr(sd[i][1]);
        if (!code && !nm) continue;
        cnt++;
        var fees = _safeFloat(sd[i][4]);
        var paid = _safeFloat(sd[i][5]);
        tf += fees; tp += paid;
        var pct = fees > 0 ? Math.round((paid / fees) * 100) : 100;
        if (blockPct > 0 && pct <= blockPct) bc++;
      }
      stats.totalStudents  = cnt;
      stats.totalFees      = tf;
      stats.totalPaid      = tp;
      stats.totalRemaining = tf - tp;
      stats.blockedCount   = bc;
      stats.studentFileOk  = true;
    }

    var tchSheet = tSS.getSheetByName('المدرسين');
    if (tchSheet) {
      var td = tchSheet.getDataRange().getValues();
      var uniq = {};
      for (var t = 1; t < td.length; t++) {
        var tn = _safeStr(td[t][0]);
        if (tn) uniq[tn] = true;
      }
      stats.totalTeachers = _objLen(uniq);
    }

    var vioSheet  = tSS.getSheetByName('المخالفات');
    stats.totalViolations = vioSheet  ? Math.max(0, vioSheet.getLastRow()  - 1) : 0;
    var hwSheet   = tSS.getSheetByName('الواجبات');
    stats.totalHomework   = hwSheet   ? Math.max(0, hwSheet.getLastRow()   - 1) : 0;
    var newsSheet = tSS.getSheetByName('الاخبار');
    stats.totalNews       = newsSheet ? Math.max(0, newsSheet.getLastRow() - 1) : 0;

    var attSheet = tSS.getSheetByName('الغياب');
    if (attSheet) {
      var ad = attSheet.getDataRange().getValues();
      for (var a = 1; a < ad.length; a++) {
        if (_safeStr(ad[a][4]) === today) {
          var stt = _safeStr(ad[a][5]);
          if (stt === 'غائب')      stats.todayAbsent++;
          else if (stt === 'متأخر') stats.todayLate++;
          else if (stt === 'حاضر')  stats.todayPresent++;
        }
      }
      var tot = stats.todayAbsent + stats.todayLate + stats.todayPresent;
      stats.attendanceRate = tot > 0 ? Math.round((stats.todayPresent / tot) * 100) : 0;
    }
    stats.teacherFileOk = true;
  } catch (e) { Logger.log('_computeStatsActive teacher: ' + e.message); }

  // ── ملف CMS ──
  try {
    var cSS = _getCmsSS();
    var n  = cSS.getSheetByName('News');
    var v  = cSS.getSheetByName('Videos');
    var im = cSS.getSheetByName('Images');
    var sc = cSS.getSheetByName('Schedule');
    stats.cmsNews      = n  ? Math.max(0, n.getLastRow()  - 1) : 0;
    stats.cmsVideos    = v  ? Math.max(0, v.getLastRow()  - 1) : 0;
    stats.cmsImages    = im ? Math.max(0, im.getLastRow() - 1) : 0;
    stats.cmsScheduled = sc ? Math.max(0, sc.getLastRow() - 1) : 0;
    stats.cmsFileOk    = true;
  } catch (e) { Logger.log('_computeStatsActive cms: ' + e.message); }

  // ── ملف الحصص ──
  try {
    var sh = _getScheduleSS().getSheetByName('الجدول');
    stats.totalPeriods   = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
    stats.scheduleFileOk = true;
  } catch (e) { Logger.log('_computeStatsActive schedule: ' + e.message); }

  stats.lastUpdated = _nowString();
  return stats;
}

// تجميع إحصاءات كل المدارس (وضع المالك بلا اختيار مدرسة)
function _aggregateAllSchoolsStats() {
  var agg = {
    totalStudents:0, totalTeachers:0, totalViolations:0, totalHomework:0, totalNews:0,
    todayAbsent:0, todayLate:0, todayPresent:0, attendanceRate:0,
    blockPercentage:0, blockedCount:0,
    totalFees:0, totalPaid:0, totalRemaining:0,
    cmsNews:0, cmsVideos:0, cmsImages:0, cmsScheduled:0, totalPeriods:0,
    schoolsCount:0,
    teacherFileOk:true, studentFileOk:true, cmsFileOk:true, scheduleFileOk:true,
    lastUpdated:_nowString()
  };
  var schools = _listActiveSchools();
  agg.schoolsCount = schools.length;
  for (var i = 0; i < schools.length; i++) {
    _useSchool(schools[i].schoolId);
    var s = _computeStatsActive();
    agg.totalStudents   += s.totalStudents;
    agg.totalTeachers   += s.totalTeachers;
    agg.totalViolations += s.totalViolations;
    agg.totalHomework   += s.totalHomework;
    agg.totalNews       += s.totalNews;
    agg.todayAbsent     += s.todayAbsent;
    agg.todayLate       += s.todayLate;
    agg.todayPresent    += s.todayPresent;
    agg.blockedCount    += s.blockedCount;
    agg.totalFees       += s.totalFees;
    agg.totalPaid       += s.totalPaid;
    agg.totalRemaining  += s.totalRemaining;
    agg.cmsNews         += s.cmsNews;
    agg.cmsVideos       += s.cmsVideos;
    agg.cmsImages       += s.cmsImages;
    agg.cmsScheduled    += s.cmsScheduled;
    agg.totalPeriods    += s.totalPeriods;
  }
  _clearActiveSchool();
  var totAtt = agg.todayAbsent + agg.todayLate + agg.todayPresent;
  agg.attendanceRate = totAtt > 0 ? Math.round((agg.todayPresent / totAtt) * 100) : 0;
  return agg;
}

function _scopeMeta(scope) {
  return { isOwner: scope.isOwner, all: scope.all, schoolId: scope.schoolId };
}

// ── ترقية حساب المالك (يُنفَّذ مرة واحدة من المحرر بعد لصق الكود) ──
function upgradeDefaultAdminToOwner() {
  var sheet = _getMasterSheet('Users_Master');
  if (!sheet) return { ok:false, error:'Users_Master غير موجودة' };
  var data = sheet.getDataRange().getValues();
  var done = 0;
  for (var i = 1; i < data.length; i++) {
    if (_safeStr(data[i][4]).toLowerCase() === 'info@ebdaa-tamayuz.edu') {
      sheet.getRange(i + 1, 3).setValue('owner'); // عمود role
      done++;
    }
  }
  SpreadsheetApp.flush();
  Logger.log('تمت ترقية ' + done + ' حساب إلى owner');
  return { ok:true, upgraded:done };
}

// ── بوابات مدرسة محددة (للمرحلة 3 — صفحة "منصاتي") ──
function getMyPortalsProtected(params) {
  var session = validateMasterToken(_safeStr(params.token));
  if (!session) return { success:false, error:'غير مصرح' };

  var scope = _resolveScope(session, params);
  var sid = scope.schoolId || _safeStr(session.schoolId);
  if (!sid) return { success:false, error:'لم يتم تحديد مدرسة' };

  var f = _resolveSchoolFileIds(sid);
  if (!f.schoolId) return { success:false, error:'المدرسة غير موجودة' };

  var urls = {};
  try { urls = getDeploymentUrls(); } catch (e) { urls = {}; }
  var sep = '?school=' + encodeURIComponent(sid);

  return {
    success   : true,
    schoolId  : sid,
    schoolName: f.name,
    portals   : {
      teacher : (urls.teacher  && f.teacherFileId)                       ? urls.teacher  + sep : '',
      student : (urls.student  && (f.studentFileId || f.teacherFileId))  ? urls.student  + sep : '',
      cms     : (urls.cms      && f.cmsFileId)                           ? urls.cms      + sep : '',
      schedule: (urls.schedule && f.scheduleFileId)                      ? urls.schedule + sep : ''
    }
  };
}