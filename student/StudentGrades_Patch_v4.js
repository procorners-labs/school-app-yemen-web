/* ════════════════════════════════════════════════════════════════════
 *  StudentGrades_Patch_v4.gs  —  توحيد عرض درجات الطالب مع منصة المعلم
 *  المنصة: منصة الطالب (StudentLogic.gs)
 *
 *  ما الذي يفعله هذا الـ Patch:
 *    • يستبدل دالة getGrades() القديمة بنسخة موحّدة v4 تقرأ الدرجات
 *      عبر نفس الطبقة (GradeSchema.gs) التي تستخدمها منصة المعلم:
 *        - GS_findSubjectLocation  (تحديد أعمدة المادة/الشهر بدقة)
 *        - GS_computeTermMonthly   (الأعمال المستمرة — نفس قاعدة المعلم)
 *        - GS_computeTermTotal     (المحصلة الفصلية)
 *        - GS_computeRegularTotal  (إجمالي الشهر العادي)
 *        - GS_decorateGrade / GS_buildVirtualColumns / GS_isFieldLocked (v3)
 *    • ديناميكي: يكتشف الأشهر والمواد من الشيت (لا قوائم ثابتة).
 *    • يصلح بنية الإخراج لتطابق renderMonth في Student_Portal.html:
 *        - يضيف subj.total للشهور العادية (إصلاح عمود "المجموع").
 *        - يضيف subj.hasGrades (اختيار آخر شهر فيه درجات).
 *
 *  طريقة التركيب:
 *    1) في StudentLogic.gs: احذف دالة getGrades() القديمة بالكامل
 *       (من السطر "function getGrades(studentId, schoolId) {" حتى قوسها
 *        الختامي قبل تعليق "_analyzeMonths")، أو ببساطة أعِد تسميتها إلى
 *        getGrades_OLD لتعطيلها.
 *    2) الصق كامل محتوى هذا الملف في نهاية StudentLogic.gs.
 *    3) لا حاجة لحذف _processMonth / _analyzeMonths / _computeTermMonthly
 *       القديمة — تبقى غير مستخدمة وآمنة.
 *
 *  المتطلبات: GradeSchema.gs منسوخ في مشروع الطالب (موجود بالفعل — تأكيد:
 *    getGrades القديمة كانت تستدعي GS_V3_FLAG و GS_decorateMonth).
 *
 *  متوافق ES5 بالكامل (var فقط، function() {}، بلا template literals).
 * ════════════════════════════════════════════════════════════════════ */


/* ══════════════════════════════════════════════════════════════
 *  getGrades — النسخة الموحّدة v4 (متطابقة مع منطق منصة المعلم)
 *  المصدر: ورقة "النصفي" في ملف المدرسة النشط.
 * ══════════════════════════════════════════════════════════════ */
function getGrades(studentId, schoolId, noCache) {
  try {
    _resolveTenant(schoolId);                       /* عزل المدرسة + توحيد schoolId/school */

    var sid = _safe(studentId);
    if (!sid) return { ok: false, error: 'كود الطالب مفقود' };

    var cKey   = _ck('grades', sid);                /* كاش معزول لكل مدرسة */
    if (!noCache) {                                 /* زر التحديث يتجاوز الكاش */
      var cached = _cacheGet(cKey);
      if (cached) return cached;
    }

    var activeId = _activeFileId();
    var ss       = _getSSById(activeId);
    var sheet    = ss.getSheetByName('النصفي');     /* نفس مصدر منصة المعلم */
    if (!sheet) return { ok: false, error: 'ورقة "النصفي" غير موجودة في ملف المعلمين' };

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 4 || lastCol < 5) {
      return { ok: false, error: 'بيانات الدرجات غير مكتملة' };
    }

    /* الرؤوس الثلاثة دفعة واحدة: صف1=الشهر | صف2=المادة | صف3=نوع الحقل */
    var headers    = sheet.getRange(1, 1, 3, lastCol).getValues();
    var monthRow   = headers[0];
    var subjectRow = headers[1];
    var typeRow    = headers[2];

    /* العثور على صف الطالب (قراءة عمود الأكواد فقط) */
    var codeCol = sheet.getRange(4, 1, lastRow - 3, 1).getValues();
    var studentRowNum = -1;
    for (var r = 0; r < codeCol.length; r++) {
      if (_safe(codeCol[r][0]) === sid) { studentRowNum = r + 4; break; }
    }
    if (studentRowNum === -1) {
      return { ok: false, error: 'لم يتم العثور على درجات للطالب بالكود: ' + sid };
    }

    /* صف الطالب كاملاً (قراءة واحدة — تقليل استدعاءات الشيت) */
    var studentRow = sheet.getRange(studentRowNum, 1, 1, lastCol).getValues()[0];

    var studentInfo = {
      id      : sid,
      name    : _safe(studentRow[1]),
      class   : _safe(studentRow[2]),
      section : _safe(studentRow[3])
    };
    if (!studentInfo.name) {
      return { ok: false, error: 'بيانات الطالب غير مكتملة في ورقة الدرجات' };
    }

    /* اكتشاف الأشهر الفعلية من الشيت (ديناميكي + ترتيب دراسي) */
    var monthsFound = _gradesDetectMonths(monthRow);
    if (monthsFound.length === 0) {
      return { ok: false, error: 'لم يتم العثور على أشهر دراسية في الشيت' };
    }

    var requiredSubjects = getSubjectsByClass(studentInfo.class);
    var monthsData = [];

    for (var mi = 0; mi < monthsFound.length; mi++) {
      var mData = _gradesReadMonthUnified(
        monthRow, subjectRow, typeRow, studentRow, monthsFound[mi]
      );
      if (mData && mData.subjects.length > 0) monthsData.push(mData);
    }

    if (monthsData.length === 0) {
      return { ok: false, error: 'لا توجد درجات مسجلة بعد لهذا الطالب' };
    }

    var result = {
      ok               : true,
      student          : studentInfo,
      months           : monthsData,
      requiredSubjects : requiredSubjects,
      v4Unified        : true,
      generatedAt      : _nowString()
    };

    _cacheSet(cKey, result, 30);    /* كاش قصير 30ث — تظهر الدرجات الجديدة بسرعة */
    return result;

  } catch (e) {
    console.error('getGrades error:', e);
    return { ok: false, error: 'خطأ أثناء جلب الدرجات: ' + (e.message || e) };
  }
}


/* ══════════════════════════════════════════════════════════════
 *  _gradesReadMonthUnified — قلب التوحيد
 *  يقرأ كل مواد شهر واحد لطالب واحد بنفس آلية المعلم بالضبط.
 * ══════════════════════════════════════════════════════════════ */
function _gradesReadMonthUnified(monthRow, subjectRow, typeRow, studentRow, monthName) {
  var isTermMonth = GS_isTermMonth(monthName);

  var mData = {
    name        : monthName,
    isFinal     : isTermMonth,
    isTermMonth : isTermMonth,
    subjects    : []
  };

  /* اكتشاف مواد هذا الشهر فعلياً من صف 2 ضمن نطاق الشهر */
  var subjectsList = _gradesDetectSubjects(monthRow, subjectRow, monthName);
  if (subjectsList.length === 0) return mData;

  for (var si = 0; si < subjectsList.length; si++) {
    var subject = subjectsList[si];

    /* ✅ نهاية العام: هيكل 5 أعمدة (محصلة1 + نصفي + محصلة2 + نهائي + إجمالي/100)
       يُقرأ بالاسم مباشرةً (لأن الطبقة الموحّدة تعرف 3 أعمدة فقط) */
    if (monthName === 'نهاية العام') {
      var yend = _gradesReadFinalSubject(monthRow, subjectRow, typeRow, studentRow, subject);
      if (yend && yend.hasGrades) {
        mData.subjects.push({ name: subject, grades: yend.gradesArr, hasGrades: true });
      }
      continue;
    }

    /* نفس الطبقة الموحّدة التي يستخدمها المعلم */
    var loc = GS_findSubjectLocation(monthRow, subjectRow, typeRow, monthName, subject);
    if (!loc.success) continue;

    var cols       = loc.columns;
    var gradesArr  = [];
    var hasGrades  = false;
    var regularTotal = '';

    if (isTermMonth) {
      /* ── الفترات الفصلية (نصف/نهاية العام) ── */
      var rawMonthly = _gradesCell(studentRow, cols.monthly_score);
      var rawExam    = _gradesCell(studentRow, cols.exam_score);
      var rawTotal   = _gradesCell(studentRow, cols.total_score);

      /* الأعمال المستمرة: تُحسب تلقائياً فقط إذا كانت الخلية فارغة فعلاً */
      var monthlyOut;
      if (rawMonthly !== '') {
        monthlyOut = rawMonthly;
      } else {
        var calc = _gradesCalcTermMonthly(
          monthRow, subjectRow, typeRow, studentRow, subject, monthName
        );
        monthlyOut = (calc !== null && calc !== undefined) ? String(calc) : '';
      }

      var examOut = rawExam;

      /* المحصلة: تُحسب إذا لم تُخزَّن (الأعمال المستمرة + درجة الاختبار) */
      var totalOut;
      if (rawTotal !== '') {
        totalOut = rawTotal;
      } else {
        var mn = _gradesNumOrNull(monthlyOut);
        var en = _gradesNumOrNull(examOut);
        var tc = GS_computeTermTotal(mn, en);
        totalOut = (tc === null) ? '' : String(tc);
      }

      gradesArr.push({ key: 'monthly_score', type: 'الأعمال المستمرة', value: monthlyOut, max: 20 });
      gradesArr.push({ key: 'exam_score',    type: 'درجة الاختبار',    value: examOut,    max: 30 });
      gradesArr.push({ key: 'total_score',   type: 'المحصلة',          value: totalOut,   max: 50, isTotal: true });

      if (monthlyOut !== '' || examOut !== '' || totalOut !== '') hasGrades = true;

    } else {
      /* ── الشهور العادية ── */
      var bV = _gradesCell(studentRow, cols.behavior);
      var hV = _gradesCell(studentRow, cols.homework);
      var oV = _gradesCell(studentRow, cols.oral);
      var wV = _gradesCell(studentRow, cols.written);
      var tV = _gradesCell(studentRow, cols.total);

      /* إذا لم يُخزَّن الإجمالي، احسبه (نفس قاعدة المعلم) */
      if (tV === '' && (bV !== '' || hV !== '' || oV !== '' || wV !== '')) {
        tV = String(GS_computeRegularTotal(bV, hV, oV, wV));
      }
      regularTotal = tV;

      gradesArr.push({ key: 'behavior', type: 'السلوك',   value: bV, max: 20 });
      gradesArr.push({ key: 'homework', type: 'الواجبات',  value: hV, max: 20 });
      gradesArr.push({ key: 'oral',     type: 'الشفوي',    value: oV, max: 20 });
      gradesArr.push({ key: 'written',  type: 'التحريري', value: wV, max: 40 });
      gradesArr.push({ key: 'total',    type: 'الإجمالي', value: tV, max: 100, isTotal: true });

      if (bV !== '' || hV !== '' || oV !== '' || wV !== '' || tV !== '') hasGrades = true;
    }

    if (!hasGrades) continue;   /* لا نعرض مادة بلا أي درجة */

    /* v3 Decorator — نفس مسار المعلم (تسميات + أعمدة افتراضية لنهاية العام) */
    if (typeof GS_V3_FLAG !== 'undefined' && GS_V3_FLAG) {
      var decorated = [];
      for (var di = 0; di < gradesArr.length; di++) {
        decorated.push(GS_decorateGrade(monthName, gradesArr[di]));
      }
      decorated = GS_buildVirtualColumns(monthName, decorated);
      gradesArr = decorated;
    }

    /* إثراء القفل (وضع العرض فقط للطالب) */
    for (var li = 0; li < gradesArr.length; li++) {
      if (typeof GS_isFieldLocked === 'function') {
        gradesArr[li].locked =
          GS_isFieldLocked(monthName, gradesArr[li].key) || gradesArr[li].locked;
      }
    }

    var subjObj = { name: subject, grades: gradesArr, hasGrades: true };
    if (!isTermMonth) subjObj.total = regularTotal;   /* إصلاح عمود "المجموع" في الواجهة */

    mData.subjects.push(subjObj);
  }

  return mData;
}


/* ══════════════════════════════════════════════════════════════
 *  _gradesCalcTermMonthly — الأعمال المستمرة عبر الطبقة الموحّدة
 *  يستدعي GS_computeTermMonthly بنفس قاعدة المعلم بالضبط
 *  (لكل شهر مصدر: round(مجموع الأعمدة الأربعة / 10) مع clamp).
 * ══════════════════════════════════════════════════════════════ */
function _gradesCalcTermMonthly(monthRow, subjectRow, typeRow, studentRow, subject, termMonth) {
  if (!GS_isTermMonth(termMonth)) return null;

  var readMonthTotal = function(monthName, subj) {
    var loc = GS_findSubjectLocation(monthRow, subjectRow, typeRow, monthName, subj);
    if (!loc.success || loc.isTermMonth) return null;
    var cols = loc.columns;

    var b = _gradesNumOrNull(_gradesCell(studentRow, cols.behavior));
    var h = _gradesNumOrNull(_gradesCell(studentRow, cols.homework));
    var o = _gradesNumOrNull(_gradesCell(studentRow, cols.oral));
    var w = _gradesNumOrNull(_gradesCell(studentRow, cols.written));

    var hasAny = (b !== null) || (h !== null) || (o !== null) || (w !== null);
    if (!hasAny) return null;

    return (b || 0) + (h || 0) + (o || 0) + (w || 0);
  };

  return GS_computeTermMonthly(termMonth, subject, readMonthTotal);
}


/* ══════════════════════════════════════════════════════════════
 *  دوال مساعدة محلية (بادئة _grades* لتفادي أي تعارض)
 * ══════════════════════════════════════════════════════════════ */

/* قراءة خلية من صف الطالب حسب فهرس العمود (0-based) — تُرجع نصاً أو '' */
function _gradesCell(row, colIdx) {
  if (colIdx === undefined || colIdx === null || colIdx < 0 || colIdx >= row.length) return '';
  var v = row[colIdx];
  if (v === '' || v === null || v === undefined) return '';
  return String(v).trim();
}

/* يُرجع رقماً أو null — يميّز الفارغ عن الصفر (بخلاف _safeFloat) */
function _gradesNumOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/* اكتشاف الأشهر الفعلية من صف 1 — بدون تكرار + ترتيب دراسي */
function _gradesDetectMonths(monthRow) {
  var seen  = {};
  var found = [];
  var lastM = '';
  for (var c = 4; c < monthRow.length; c++) {   /* تخطّي A:D */
    var cell = _safe(monthRow[c] || '');
    if (GS_VALID_MONTHS.indexOf(cell) !== -1)      { lastM = cell; }
    else if (cell !== '')                          { lastM = '';   }
    var m = (cell !== '' && GS_VALID_MONTHS.indexOf(cell) !== -1) ? cell : lastM;
    if (m && !seen[m]) { seen[m] = true; found.push(m); }
  }

  found.sort(function(a, b) {
    var ai = GS_ORDERED_MONTHS.indexOf(a); if (ai === -1) ai = GS_VALID_MONTHS.indexOf(a);
    var bi = GS_ORDERED_MONTHS.indexOf(b); if (bi === -1) bi = GS_VALID_MONTHS.indexOf(b);
    if (ai === -1) ai = 999;
    if (bi === -1) bi = 999;
    return ai - bi;
  });

  return found;
}

/* اكتشاف مواد شهر معيّن من صف 2 ضمن نطاق الشهر — بدون تكرار */
function _gradesDetectSubjects(monthRow, subjectRow, monthName) {
  var seen = {};
  var list = [];
  var lastM = '';
  for (var c = 4; c < monthRow.length; c++) {
    var cell = _safe(monthRow[c] || '');
    if (GS_VALID_MONTHS.indexOf(cell) !== -1)  { lastM = cell; }
    else if (cell !== '')                      { lastM = '';   }

    var m = (cell !== '' && GS_VALID_MONTHS.indexOf(cell) !== -1) ? cell : lastM;
    if (m === monthName) {
      var s = _safe(subjectRow[c] || '');
      if (s && !seen[s]) { seen[s] = true; list.push(s); }
    }
  }
  return list;
}


/* ══════════════════════════════════════════════════════════════
 *  دعم «نهاية العام» — هيكل 5 أعمدة (نتيجة العام الكامل /100):
 *    محصلة الفصل الأول (تلقائي محرم+صفر /20)
 *  + اختبار نصف العام (يُسحب من بلوك نصف العام /30)
 *  + محصلة الفصل الثاني (تلقائي جماد اول+ثاني /20)
 *  + الاختبار النهائي (يُدخله المعلم /30)
 *  = الإجمالي (تلقائي /100)
 * ══════════════════════════════════════════════════════════════ */
function _gradesReadFinalSubject(monthRow, subjectRow, typeRow, studentRow, subject) {
  var LAB = {
    m1:      ['المحصلة1', 'محصلة1'],
    midterm: ['النصفي'],
    m2:      ['المحصلة2', 'محصلة2'],
    finalEx: ['النهائي', 'الاختبار النهائي'],
    total:   ['الاجمالي', 'الإجمالي', 'المجموع']
  };
  var cols = _gradesFindColsByLabel(monthRow, subjectRow, typeRow, 'نهاية العام', subject, LAB);
  if (!cols) return null;

  var v_m1  = _gradesCell(studentRow, cols.m1);
  var v_mid = _gradesCell(studentRow, cols.midterm);
  var v_m2  = _gradesCell(studentRow, cols.m2);
  var v_fin = _gradesCell(studentRow, cols.finalEx);
  var v_tot = _gradesCell(studentRow, cols.total);

  /* محصلة الفصل الأول (تلقائي من محرم + صفر) */
  if (v_m1 === '') {
    var a = _gradesSumMonths(monthRow, subjectRow, typeRow, studentRow, subject, ['محرم', 'صفر']);
    if (a !== null) v_m1 = String(a);
  }
  /* محصلة الفصل الثاني (تلقائي من جماد اول + جماد ثاني) */
  if (v_m2 === '') {
    var b = _gradesSumMonths(monthRow, subjectRow, typeRow, studentRow, subject, ['جماد اول', 'جماد ثاني']);
    if (b !== null) v_m2 = String(b);
  }
  /* اختبار النصفي: إن كان فارغاً هنا، اسحبه من بلوك «نصف العام» */
  if (v_mid === '') {
    var nm = _gradesFindColsByLabel(monthRow, subjectRow, typeRow, 'نصف العام', subject,
      { midterm: ['النصفي', 'درجة الاختبار', 'الاختبار'] });
    if (nm && nm.midterm !== undefined) v_mid = _gradesCell(studentRow, nm.midterm);
  }
  /* الإجمالي (تلقائي = محصلة1 + نصفي + محصلة2 + نهائي) */
  if (v_tot === '') {
    var parts = [v_m1, v_mid, v_m2, v_fin];
    var sum = 0, any = false;
    for (var pi = 0; pi < parts.length; pi++) {
      var nn = _gradesNumOrNull(parts[pi]);
      if (nn !== null) { sum += nn; any = true; }
    }
    if (any) { if (sum > 100) sum = 100; v_tot = String(Math.round(sum * 10) / 10); }
  }

  var arr = [
    { key: 'monthly_score',   type: 'محصلة الفصل الأول',  value: v_m1,  max: 20,  locked: true,  auto: true },
    { key: 'midterm_exam',    type: 'اختبار نصف العام',   value: v_mid, max: 30,  locked: true,  auto: true },
    { key: 'monthly_score_2', type: 'محصلة الفصل الثاني', value: v_m2,  max: 20,  locked: true,  auto: true },
    { key: 'final_exam',      type: 'الاختبار النهائي',    value: v_fin, max: 30,  locked: false, auto: false },
    { key: 'grand_total',     type: 'الإجمالي',            value: v_tot, max: 100, locked: true,  auto: true, isTotal: true }
  ];
  var hasGrades = (v_m1 !== '' || v_mid !== '' || v_m2 !== '' || v_fin !== '' || v_tot !== '');
  return { gradesArr: arr, hasGrades: hasGrades };
}

/* يحدّد أعمدة مادة في شهر معيّن حسب تطابق اسم النوع (typeRow) مع خريطة التسميات */
function _gradesFindColsByLabel(monthRow, subjectRow, typeRow, monthName, subject, labelMap) {
  var filled = [], lastM = '';
  for (var i = 0; i < monthRow.length; i++) {
    var mc = _safe(monthRow[i] || '');
    if (GS_VALID_MONTHS.indexOf(mc) !== -1) { lastM = mc; filled.push(mc); }
    else if (mc === '' && lastM) { filled.push(lastM); }
    else { filled.push(''); lastM = ''; }
  }
  var start = -1, end = -1;
  for (var j = 0; j < filled.length; j++) {
    if (filled[j] === monthName) { if (start === -1) start = j; end = j; }
  }
  if (start === -1) return null;
  var cols = {};
  for (var c = start; c <= end; c++) {
    if (_safe(subjectRow[c] || '') !== subject) continue;
    var lab = _safe(typeRow[c] || '');
    for (var key in labelMap) {
      if (labelMap.hasOwnProperty(key) && cols[key] === undefined && labelMap[key].indexOf(lab) !== -1) {
        cols[key] = c;
      }
    }
  }
  return cols;
}

/* مجموع الأعمال المستمرة عبر أشهر مصدر: لكل شهر round(مجموع الأعمدة الأربعة/10) ثم clamp /20 */
function _gradesSumMonths(monthRow, subjectRow, typeRow, studentRow, subject, monthsArr) {
  var total = 0, foundAny = false;
  for (var mi = 0; mi < monthsArr.length; mi++) {
    var cols = _gradesFindColsByLabel(monthRow, subjectRow, typeRow, monthsArr[mi], subject,
      { behavior: ['السلوك'], homework: ['الواجبات'], oral: ['الشفوي'], written: ['التحريري'] });
    if (!cols) continue;
    var b = _gradesNumOrNull(_gradesCell(studentRow, cols.behavior));
    var h = _gradesNumOrNull(_gradesCell(studentRow, cols.homework));
    var o = _gradesNumOrNull(_gradesCell(studentRow, cols.oral));
    var w = _gradesNumOrNull(_gradesCell(studentRow, cols.written));
    if (b !== null || h !== null || o !== null || w !== null) {
      var mt = (b || 0) + (h || 0) + (o || 0) + (w || 0);
      var sc = Math.round(mt / 10);
      if (sc > 10) sc = 10;
      total += sc;
      foundAny = true;
    }
  }
  if (total > 20) total = 20;
  return foundAny ? total : null;
}