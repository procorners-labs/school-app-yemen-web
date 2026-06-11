/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  School App Yemen — منصة المعلمين / المدرسين
 *  File: TeacherCore.gs  (Google Apps Script — Teacher Platform)
 *
 *  الأوراق المستخدمة في ملف الشيت:
 *    - المدرسين     : اسم المدرس | المادة | الفصل | الشعبة | كلمة المرور
 *    - الطلاب       : الكود | الاسم | الفصل | الشعبة | اجمالي الرسوم
 *    - الدرجات      : صف1=الشهر | صف2=المادة | صف3=(الكود,الاسم,الصف,الشعبة,درجات...)
 *    - الواجبات     : رقم الحركة | اسم المدرس | المادة | الفصل | الشعبة | الواجب | التاريخ
 *    - الاخبار      : رقم الخبر | اسم المدرس | الفصل | الشعبة | الخبر | الملحقات | التاريخ
 *    - المخالفات    : الكود | الاسم | الفصل | الشعبة | المخالفة | المدرس | التاريخ | الرد
 *    - القوائم      : الفصل | (فارغ) | المادة | الشعبة | (فارغ) | نوع المخالفة
 *
 *  SPREADSHEET_ID  : معرف ملف الشيت الخاص بمنصة المدرسين
 *  DRIVE_FOLDER_ID : معرف مجلد Drive لرفع مرفقات الأخبار
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ══════════════════════════════════════════════════════
//  الإعدادات الأساسية — غيّر هذه القيم حسب مشروعك
// ══════════════════════════════════════════════════════
var SPREADSHEET_ID   = '1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM'; // ← ملف شيت منصة المدرسين
var DRIVE_FOLDER_ID  = '17KtwtRIsk0I96fl5UakRKhfoSk0ZjUQF'; // ← مجلد Drive لمرفقات الأخبار

// قائمة الشهور بالترتيب الدراسي
var ALL_MONTHS_ORDERED = ['محرم', 'صفر', 'نصف العام', 'جماد اول', 'جماد ثاني', 'نهاية العام'];

// قائمة المواد بالترتيب
var ALL_SUBJECTS_ORDERED = [
  'قران كريم', 'تربية اسلامية', 'اللغة العربية', 'اللغة الانجليزية',
  'الرياضيات', 'العلوم', 'الاجتماعيات',
  'الفيزياء', 'الكيمياء', 'الاحياء', 'الجغرافيا', 'التاريخ', 'المجتمع'
];

// ═══════════════════════════════════════════════════════════
// ⭐ PATCH #1 — Feature Flag لنظام الدرجات الموحّد
//    true  = استخدام GradeSchema.gs (الطبقة الجديدة)
//    false = استخدام المنطق القديم (الاحتياطي)
//    لتغيير السلوك: عدّل القيمة واحفظ الملف — لا حاجة لإعادة النشر
// ═══════════════════════════════════════════════════════════
var USE_UNIFIED_SCHEMA = false;

// ══════════════════════════════════════════════════════
// Singleton لتجنّب فتح الملف مرات متعددة (P-OPT-03)
// ══════════════════════════════════════════════════════
var _ss_cache = {};

function _getSSById(id) {
  if (!_ss_cache[id]) {
    _ss_cache[id] = SpreadsheetApp.openById(id);
  }
  return _ss_cache[id];
}

// ══════════════════════════════════════════════════════
// كاش الرؤوس الثلاثة (الشهر/المادة/النوع) لكل تنفيذ — يمنع إعادة قراءتها
// عشرات المرات داخل الحلقات (تسريع كبير لقراءة/حفظ الدرجات).
// ══════════════════════════════════════════════════════
var __HDR_CACHE = {};
function _getGradeHeaders(sheet) {
  var key;
  try { key = (typeof _activeFileId === 'function') ? _activeFileId() : 'default'; }
  catch (e) { key = 'default'; }
  if (__HDR_CACHE[key]) return __HDR_CACHE[key];
  var lastCol = sheet.getLastColumn();
  var h = sheet.getRange(1, 1, 3, lastCol).getValues();
  var obj = { headers: h, monthRow: h[0], subjectRow: h[1], typeRow: h[2], lastCol: lastCol };
  __HDR_CACHE[key] = obj;
  return obj;
}

// ══════════════════════════════════════════════════════
// TTL مخصص للكاش حسب نوع البيانات (P-OPT-05)
// ══════════════════════════════════════════════════════
var TC_CACHE_TTL = {
  LISTS      : 1800,  // القوائم (30 دقيقة)
  STUDENTS   : 600,   // قائمة الطلاب (10 دقائق)
  GRADES     : 180,   // الدرجات (3 دقائق)
  ACTIVITIES : 90,    // الأنشطة (دقيقة ونصف)
  SCHEDULE   : 600,   // الجدول (10 دقائق)
  NEWS       : 300,   // الأخبار (5 دقائق)
  SETTINGS   : 1800   // الإعدادات (30 دقيقة)
};
  // ══════════════════════════════════════════════════════
  //  دوال مساعدة أساسية
  // ══════════════════════════════════════════════════════

  /**
   * يفتح ملف الشيت الرئيسي
   */
  function _getSS() {
    try {
      return _getSSById(_activeFileId());
    } catch (e) {
      throw new Error('لا يمكن الوصول إلى ملف البيانات: ' + e.message);
    }
  }

  /**
   * يجلب ورقة بالاسم، يعيد null إذا لم تُوجد
   */
  function _getSheet(name) {
    var ss = _getSS();
    return ss.getSheetByName(name);
  }

  /**
   * يجلب ورقة بالاسم، يُنشئها بصف رأس إذا لم تُوجد
   */
  function _getOrCreateSheet(name, headerRow) {
    var ss = _getSS();
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      if (headerRow && headerRow.length > 0) {
        sheet.appendRow(headerRow);
      }
    }
    return sheet;
  }

  /**
   * تنسيق التاريخ والوقت الحالي
   */
  function _nowString() {
    return Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );
  }

  /**
   * تحويل قيمة إلى نص آمن
   */
  function _safeStr(val) {
    if (val === null || val === undefined) return '';
    return val.toString().trim();
  }

  /**
   * تحويل قيمة إلى رقم آمن، يعيد null إذا لم تكن رقمًا
   */
  function _safeNum(val) {
    if (val === '' || val === null || val === undefined) return null;
    var n = Number(val);
    return isNaN(n) ? null : n;
  }

  /**
   * بناء استجابة JSON للـ doGet
   */
  function _jsonResponse(data) {
    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  /**
   * تحويل قيمة إلى رقم عشري آمن
   */
  function _safeFloat(v, def) {
    var n = parseFloat(v);
    return isNaN(n) ? (def || 0) : n;
  }

// ══════════════════════════════════════════════════════
// أضف هذه الدوال في TeacherCore.gs مباشرةً بعد _safeFloat
// ══════════════════════════════════════════════════════

var _TC_CACHE_TTL = 300; // 5 دقائق للبيانات الثابتة

function _tcCacheGet(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function _tcCacheSet(key, data, ttl) {
  try {
    CacheService.getScriptCache().put(
      key, JSON.stringify(data), ttl || _TC_CACHE_TTL
    );
  } catch (e) {
    Logger.log('_tcCacheSet error: ' + e.toString());
  }
}

function _tcCacheDel(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) {}
}

  // ══════════════════════════════════════════════════════
  //  نقطة الدخول الرئيسية — doGet
  //  تُستخدم لعرض صفحة HTML الرئيسية للمنصة
  // ══════════════════════════════════════════════════════

 function doGet(e) {
  try {
    var schoolId = (e && e.parameter && e.parameter.school)
                   ? e.parameter.school.toString().trim() : '';
    var t = HtmlService.createTemplateFromFile('Teacher Dashboard');
    t.schoolId = schoolId;   // ✅ سيصبح متاحاً في HTML كـ <?= schoolId ?>
    return t.evaluate()
      .setTitle('Teacher Dashboard — مدارس الإبداع والتميز الدولية')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<h2 style="color:red;font-family:Arial">خطأ: ' + err.message + '</h2>'
    );
  }
}

  // ══════════════════════════════════════════════════════
  //  مصادقة المدرسين
  // ══════════════════════════════════════════════════════



  /**
   * تغيير كلمة مرور المدرس
   *
   * @param {string} teacherName  - اسم المدرس
   * @param {string} oldPassword  - كلمة المرور القديمة
   * @param {string} newPassword  - كلمة المرور الجديدة
   */
  function _changePasswordInternal(teacherName, oldPassword, newPassword) {
    try {
      teacherName = _safeStr(teacherName);
      oldPassword = _safeStr(oldPassword);
      newPassword = _safeStr(newPassword);

      if (!teacherName || !oldPassword || !newPassword) {
        return { success: false, error: 'جميع الحقول مطلوبة' };
      }
      if (newPassword.length < 4) {
        return { success: false, error: 'كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل' };
      }

      var sheet = _getSheet('المدرسين');
      if (!sheet) return { success: false, error: 'ورقة المدرسين غير موجودة' };

      var data   = sheet.getDataRange().getValues();
      var changed = false;

      for (var i = 1; i < data.length; i++) {
        var rowName = _safeStr(data[i][0]);
        var rowPass = _safeStr(data[i][4]);

        if (rowName === teacherName && rowPass === oldPassword) {
          sheet.getRange(i + 1, 5).setValue(newPassword);
          changed = true;
        }
      }

      if (!changed) {
        return { success: false, error: 'كلمة المرور القديمة غير صحيحة أو الاسم غير مطابق' };
      }

      SpreadsheetApp.flush();
      return { success: true, message: 'تم تغيير كلمة المرور بنجاح' };
    } catch (e) {
      Logger.log('_changePasswordInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
  function changePasswordProtected(params) {
    return withAuth(params, function(session) {
      // المعلم يغير كلمة مروره فقط، والمدير يمكنه تغيير أي كلمة
      if (!session.isAdmin && session.teacherName !== params.teacherName) {
        return { success: false, error: 'يمكنك تغيير كلمة مرورك فقط' };
      }
      return _changePasswordInternal(params.teacherName, params.oldPassword, params.newPassword);
    });
  }
  function changePassword(teacherName, oldPassword, newPassword) {
    throw new Error('استخدم changePasswordProtected مع token.');
  }
  // ══════════════════════════════════════════════════════
  //  القوائم (الفصول / المواد / الشعب / المخالفات)
  // ══════════════════════════════════════════════════════

  /**
   * جلب القوائم من ورقة "القوائم"
   * أعمدة القوائم: [0]=الفصل | [1]=فارغ | [2]=المادة | [3]=الشعبة | [4]=فارغ | [5]=نوع المخالفة
   */
  /**
   * جلب القوائم (الفصول / المواد / الشعب / المخالفات)
   * نسخة محسّنة: تبني القوائم من مصادر متعددة حتى لو لم توجد ورقة "القوائم"
   */
  function getLists() {
  var cKey = 'tc_lists_v1';
  var cached = _tcCacheGet(cKey);
  if (cached) return cached;

  try {
    var ss = _getSS();
    var grades = [], subjects = [], sections = [], violations = [];

    var listsSheet = ss.getSheetByName('القوائم');
    if (listsSheet) {
      var data = listsSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var g = _safeStr(data[i][0]);
        var s = _safeStr(data[i][2]);
        var sec = _safeStr(data[i][3]);
        var v = _safeStr(data[i][5]);
        if (g && grades.indexOf(g) === -1) grades.push(g);
        if (s && subjects.indexOf(s) === -1) subjects.push(s);
        if (sec && sections.indexOf(sec) === -1) sections.push(sec);
        if (v && violations.indexOf(v) === -1) violations.push(v);
      }
    }

    var studentsSheet = ss.getSheetByName('الطلاب');
    if (studentsSheet) {
      // نقرأ عمودَي الفصل والشعبة فقط (C:D) بدلاً من getDataRange
      var lastRow = studentsSheet.getLastRow();
      if (lastRow > 1) {
        var gradeSecData = studentsSheet.getRange(2, 3, lastRow - 1, 2).getValues();
        for (var r = 0; r < gradeSecData.length; r++) {
          var g2  = _safeStr(gradeSecData[r][0]);
          var sec2 = _safeStr(gradeSecData[r][1]);
          if (g2  && grades.indexOf(g2)    === -1) grades.push(g2);
          if (sec2 && sections.indexOf(sec2) === -1) sections.push(sec2);
        }
      }
    }

    var teachersSheet = ss.getSheetByName('المدرسين');
    if (teachersSheet) {
      var lastRowT = teachersSheet.getLastRow();
      if (lastRowT > 1) {
        // نقرأ عمود المادة فقط (B)
        var subData = teachersSheet.getRange(2, 2, lastRowT - 1, 1).getValues();
        for (var t = 0; t < subData.length; t++) {
          var sub = _safeStr(subData[t][0]);
          if (sub && sub !== 'جميع المواد' && subjects.indexOf(sub) === -1) {
            subjects.push(sub);
          }
        }
      }
    }

    if (violations.length === 0) {
      violations = [
        'تأخر عن الدوام', 'عدم التزام بالزي المدرسي', 'إهمال الواجبات',
        'سلوك غير لائق', 'استخدام الجوال', 'غياب بدون عذر', 'إزعاج الفصل'
      ];
    }

    var orderedSubjects = [
      'قران كريم', 'تربية اسلامية', 'اللغة العربية', 'اللغة الانجليزية',
      'الرياضيات', 'العلوم', 'الاجتماعيات',
      'الفيزياء', 'الكيمياء', 'الاحياء', 'الجغرافيا', 'التاريخ', 'المجتمع',
      'جميع المواد'
    ];
    var sortedSubjects = [];
    for (var oi = 0; oi < orderedSubjects.length; oi++) {
      if (subjects.indexOf(orderedSubjects[oi]) !== -1) {
        sortedSubjects.push(orderedSubjects[oi]);
      }
    }
    for (var si = 0; si < subjects.length; si++) {
      if (sortedSubjects.indexOf(subjects[si]) === -1) sortedSubjects.push(subjects[si]);
    }

    sections = sections.filter(function(s) { return s && s !== 'جميع الشعب'; });
    if (sections.length === 0) sections = ['أ', 'ب', 'ج'];

    var result = {
      success   : true,
      grades    : grades,
      subjects  : sortedSubjects,
      sections  : sections,
      violations: violations
    };

    _tcCacheSet(cKey, result, _TC_CACHE_TTL);
    return result;

  } catch (e) {
    Logger.log('getLists error: ' + e.toString());
    return {
      success   : true,
      grades    : [],
      subjects  : ['قران كريم', 'تربية اسلامية', 'اللغة العربية', 'اللغة الانجليزية', 'الرياضيات', 'العلوم', 'الاجتماعيات'],
      sections  : ['أ', 'ب', 'ج'],
      violations: ['تأخر عن الدوام', 'عدم التزام بالزي المدرسي', 'إهمال الواجبات']
    };
  }
}

  // ══════════════════════════════════════════════════════
  //  هيكل ورقة الدرجات
  // ══════════════════════════════════════════════════════

  /**
   * جلب هيكل ورقة الدرجات مع تصفية حسب صلاحية المدرس
   *
   * بنية الأوراق:
   *   صف 1 : الشهر (مدمج أو مكرر عبر أعمدة)
   *   صف 2 : اسم المادة
   *   صف 3 : الكود | الاسم | الفصل | الشعبة | نوع الدرجة...
   *   صف 4+ : بيانات الطلاب
   *
   * @param {Object} user - { isAdmin, subject, subjects }
   */

  function _getGradesStructureInternal(filter) {
    try {
      var sheet = (_getSheet('النصفي') || _getSheet('الدرجات'));
      if (!sheet) {
        sheet = _createGradesSheetTemplate();
      }

      var lastRow    = sheet.getLastRow();
      var lastColumn = sheet.getLastColumn();

      if (lastRow < 3 || lastColumn < 4) {
        return _buildDefaultGradesStructure(filter);
      }

      var headerData = _getGradeHeaders(sheet).headers;
      var firstRow   = headerData[0];
      var secondRow  = headerData[1];

      var months          = _extractMonths(firstRow);
      var subjectsByMonth = _extractSubjectsByMonth(headerData, months);
      var allSubjects     = _extractAllSubjects(secondRow);
      var grades          = _extractUniqueColumnValues(sheet, 3);
      var sections        = _extractUniqueColumnValues(sheet, 4);

      // تصفية حسب صلاحيات المعلم
      if (filter && !filter.isAdmin) {
        var allowedSubjects = filter.subjects;
        if (allowedSubjects.indexOf('جميع المواد') === -1) {
          allSubjects = allSubjects.filter(function(s) {
            return allowedSubjects.indexOf(s) !== -1;
          });
          for (var month in subjectsByMonth) {
            subjectsByMonth[month] = subjectsByMonth[month].filter(function(s) {
              return allowedSubjects.indexOf(s) !== -1;
            });
          }
        }
        if (filter.classes && filter.classes.indexOf('جميع الفصول') === -1) {
          grades = grades.filter(function(g) { return filter.classes.indexOf(g) !== -1; });
        }
        if (filter.sections && filter.sections.indexOf('جميع الشعب') === -1) {
          sections = sections.filter(function(s) { return filter.sections.indexOf(s) !== -1; });
        }
      }

      return {
        success         : true,
        months          : months,
        subjectsByMonth : subjectsByMonth,
        grades          : grades,
        sections        : sections,
        allSubjects     : allSubjects,
        totalRows       : lastRow,
        totalColumns    : lastColumn
      };
    } catch (e) {
      Logger.log('_getGradesStructureInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
  function getGradesStructureProtected(params) {
    return withAuth(params, function(session) {
      var filter = {
        isAdmin  : session.isAdmin,
        subjects : session.subjects,
        classes  : session.classes,
        sections : session.sections
      };
      return _getGradesStructureInternal(filter);
    });
  }
  function getGradesStructure(user) {
    throw new Error('استخدم getGradesStructureProtected مع token.');
  }
  /**
   * استخراج الشهور من الصف الأول
   */
  function _extractMonths(firstRow) {
    var months = [];
    var seen   = {};
    for (var i = 0; i < firstRow.length; i++) {
      var val = _safeStr(firstRow[i]);
      if (val && ALL_MONTHS_ORDERED.indexOf(val) !== -1 && !seen[val]) {
        months.push(val);
        seen[val] = true;
      }
    }
    return months;
  }

  /**
   * استخراج المواد لكل شهر
   */
  function _extractSubjectsByMonth(headerData, months) {
    var firstRow  = headerData[0];
    var secondRow = headerData[1];
    var result    = {};

    months.forEach(function(month) {
      var seen   = {};
      var subs   = [];
      for (var i = 0; i < firstRow.length; i++) {
        if (_safeStr(firstRow[i]) === month) {
          var sub = _safeStr(secondRow[i]);
          if (sub && !seen[sub]) {
            subs.push(sub);
            seen[sub] = true;
          }
        }
      }
      result[month] = subs;
    });

    return result;
  }

  /**
   * استخراج كل المواد الفريدة من الصف الثاني بالترتيب المحدد مسبقًا
   */
  function _extractAllSubjects(secondRow) {
    var subjectsSet = {};
    for (var i = 0; i < secondRow.length; i++) {
      var sub = _safeStr(secondRow[i]);
      if (sub) subjectsSet[sub] = true;
    }
    return ALL_SUBJECTS_ORDERED.filter(function(s) { return subjectsSet[s]; });
  }

  /**
   * استخراج قيم فريدة من عمود معين (بدءًا من صف 4)
   * @param {Sheet} sheet
   * @param {number} colNumber - رقم العمود (1-indexed)
   */
  function _extractUniqueColumnValues(sheet, colNumber) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 4) return [];
    var values = sheet.getRange(4, colNumber, lastRow - 3, 1).getValues();
    var seen   = {};
    var result = [];
    for (var i = 0; i < values.length; i++) {
      var val = _safeStr(values[i][0]);
      if (val && !seen[val]) {
        result.push(val);
        seen[val] = true;
      }
    }
    return result;
  }

  /**
   * بناء بنية افتراضية لورقة الدرجات الفارغة
   */
  function _buildDefaultGradesStructure(user) {
    return {
      success         : true,
      months          : ALL_MONTHS_ORDERED,
      subjectsByMonth : ALL_MONTHS_ORDERED.reduce(function(acc, m) {
        acc[m] = (m === 'نصف العام' || m === 'نهاية العام')
          ? ALL_SUBJECTS_ORDERED
          : ALL_SUBJECTS_ORDERED;
        return acc;
      }, {}),
      grades          : [],
      sections        : [],
      allSubjects     : ALL_SUBJECTS_ORDERED,
      totalRows       : 0,
      totalColumns    : 0
    };
  }

  /**
   * إنشاء ورقة الدرجات بهيكل أساسي
   */
  function _createGradesSheetTemplate() {
    var ss    = _getSS();
    var sheet = ss.insertSheet('الدرجات');
    sheet.getRange(1, 1).setValue('الشهر');
    sheet.getRange(2, 1).setValue('المادة');
    sheet.getRange(3, 1).setValue('الكود');
    sheet.getRange(3, 2).setValue('الاسم');
    sheet.getRange(3, 3).setValue('الفصل');
    sheet.getRange(3, 4).setValue('الشعبة');
    sheet.getRange(1, 1, 3, 4)
      .setBackground('#4A235A')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
    return sheet;
  }

  // ══════════════════════════════════════════════════════
  //  جلب الطلاب مع درجاتهم
  // ══════════════════════════════════════════════════════
  function getStudents(grade, section, month, subject) {
    throw new Error('الدالة getStudents غير آمنة. استخدم getStudentsProtected مع token.');
  }
  /**
   * جلب الطلاب مع درجاتهم لشهر ومادة معينين
   *
   * @param {string} grade   - الفصل (مثال: الأول الأساسي)
   * @param {string} section - الشعبة (مثال: أ)
   * @param {string} month   - الشهر (مثال: محرم)
   * @param {string} subject - المادة (مثال: الرياضيات)
   */
  /**
 * قراءة قيمة خلية مع التفريق بين الفارغ والصفر
 * @param {Array} row     صف البيانات
 * @param {number} colIdx فهرس العمود (يجب أن يكون >= 0)
 * @return {number|string} رقم إذا كانت موجودة، '' إذا كانت فارغة
 */
function _readCellValue(row, colIdx) {
  if (colIdx === undefined || colIdx === null || colIdx < 0) return '';
  var v = row[colIdx];
  if (v === '' || v === null || v === undefined) return '';
  var n = parseFloat(v);
  return isNaN(n) ? '' : n;
}
function _getStudentsInternal(grade, section, month, subject) {
  try {
    grade   = _safeStr(grade);
    section = _safeStr(section);
    month   = _safeStr(month);
    subject = _safeStr(subject);

    var sheet = _getSheet('النصفي');
    if (!sheet) throw new Error('ورقة "النصفي" غير موجودة');

    var lastRow    = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    if (lastRow < 4) return { success: true, students: [] };

    var locationResult = null;
    if (month && subject) {
      locationResult = _findSubjectLocation(month, subject);
    }

    // ✅ نهاية العام: تحضير أعمدة الخمسة + مواقع الأشهر المصدر مرة واحدة
    var isYearEnd = (month === 'نهاية العام');
    var yeCols = null, yeNisfExam = -1, yeSrc = null;
    if (isYearEnd && subject) {
      yeCols = _teacherYearEndCols(sheet, subject);
      var _nf = _findSubjectLocation('نصف العام', subject);
      yeNisfExam = (_nf.success && _nf.columns.exam_score >= 0) ? _nf.columns.exam_score : -1;
      yeSrc = {
        t1: [_findSubjectLocation('محرم', subject), _findSubjectLocation('صفر', subject)],
        t2: [_findSubjectLocation('جماد اول', subject), _findSubjectLocation('جماد ثاني', subject)]
      };
    }

    var data     = sheet.getRange(4, 1, lastRow - 3, lastColumn).getValues();
    var students = [];

    for (var i = 0; i < data.length; i++) {
      var row          = data[i];
      var studentCode  = _safeStr(row[0]);
      var studentName  = _safeStr(row[1]);
      var studentGrade = _safeStr(row[2]);
      var studentSec   = _safeStr(row[3]);

      if (!studentCode || !studentName) continue;
      if (grade   && studentGrade !== grade)   continue;
      if (section && section !== 'جميع الشعب' && studentSec !== section) continue;

      var studentObj = {
        code    : studentCode,
        name    : studentName.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''),
        grade   : studentGrade,
        section : studentSec
      };

      // ✅ نهاية العام: بناء الأعمدة الخمسة (محصلة1 + نصفي محمول + محصلة2 + نهائي + إجمالي/100)
      if (isYearEnd && yeCols) {
        var ye = _yeComputeFromRow(row, yeCols, yeNisfExam, yeSrc);
        studentObj.isTermMonth = true;
        studentObj.ye_m1      = (ye.m1    === null) ? '' : ye.m1;
        studentObj.ye_midterm = (ye.mid   === null) ? '' : ye.mid;
        studentObj.ye_m2      = (ye.m2    === null) ? '' : ye.m2;
        studentObj.ye_final   = (ye.fin   === null) ? '' : ye.fin;
        studentObj.ye_total   = (ye.total === null) ? '' : ye.total;
        studentObj.grades = [
          { key: 'monthly_score',   type: 'محصلة الفصل الأول',  value: String(studentObj.ye_m1),      max: 20,  locked: true },
          { key: 'midterm_exam',    type: 'اختبار نصف العام',   value: String(studentObj.ye_midterm), max: 30,  locked: true },
          { key: 'monthly_score_2', type: 'محصلة الفصل الثاني', value: String(studentObj.ye_m2),      max: 20,  locked: true },
          { key: 'final_exam',      type: 'الاختبار النهائي',    value: String(studentObj.ye_final),   max: 30,  locked: false },
          { key: 'grand_total',     type: 'الإجمالي',            value: String(studentObj.ye_total),   max: 100, locked: true, isTotal: true }
        ];
        students.push(studentObj);
        continue;
      }

      if (locationResult && locationResult.success) {
        var cols = locationResult.columns;
        if (locationResult.isTermMonth) {
          // قراءة القيم الخام – التفريق بين "فارغ" و"صفر"
          var rawMonthly = (cols.monthly_score >= 0) ? row[cols.monthly_score] : '';
          var rawExam    = (cols.exam_score    >= 0) ? row[cols.exam_score]    : '';
          var rawTotal   = (cols.total_score   >= 0) ? row[cols.total_score]   : '';

          var hasMonthly = (rawMonthly !== '' && rawMonthly !== null && rawMonthly !== undefined);
          var hasExam    = (rawExam    !== '' && rawExam    !== null && rawExam    !== undefined);
          var hasTotal   = (rawTotal   !== '' && rawTotal   !== null && rawTotal   !== undefined);

          // الأعمال المستمرة: نحسب تلقائياً فقط إذا كانت الخلية فارغة فعلاً
          if (!hasMonthly) {
            var calc = _calcTermMonthlyScore(sheet, studentCode, subject, month);
            studentObj.monthly_score = (calc !== null && calc !== undefined) ? calc : '';
            studentObj.monthly_auto  = true;
          } else {
            studentObj.monthly_score = _safeNum(rawMonthly);
            studentObj.monthly_auto  = false;
          }

          studentObj.exam_score  = hasExam  ? _safeNum(rawExam)  : '';
          studentObj.total_score = hasTotal ? _safeNum(rawTotal) : '';

        } else {
          // شهور عادية: قراءة دقيقة دون استبدال الصفر
          studentObj.behavior = _readCellValue(row, cols.behavior);
          studentObj.homework = _readCellValue(row, cols.homework);
          studentObj.oral     = _readCellValue(row, cols.oral);
          studentObj.written  = _readCellValue(row, cols.written);
          studentObj.total    = _readCellValue(row, cols.total);
        }
        studentObj.isTermMonth = locationResult.isTermMonth;
      }

      // ═══════════════════════════════════════════════════
      //  ⭐ v3 Decorator: تحويل الخواص إلى مصفوفة grades
      //  (يُضاف تلقائياً عند تفعيل GS_V3_FLAG في GradeSchema.gs)
      // ═══════════════════════════════════════════════════
      if (locationResult && locationResult.success && month) {
        var gradesArr = [];
        if (locationResult.isTermMonth) {
          gradesArr.push({
            key: 'monthly_score',
            type: 'الأعمال المستمرة',
            value: (studentObj.monthly_score !== undefined && studentObj.monthly_score !== '')
                   ? String(studentObj.monthly_score) : '',
            max: 20
          });
          gradesArr.push({
            key: 'exam_score',
            type: 'درجة الاختبار',
            value: (studentObj.exam_score !== undefined && studentObj.exam_score !== '')
                   ? String(studentObj.exam_score) : '',
            max: 30
          });
          gradesArr.push({
            key: 'total_score',
            type: 'المحصلة',
            value: (studentObj.total_score !== undefined && studentObj.total_score !== '')
                   ? String(studentObj.total_score) : '',
            max: 50,
            isTotal: true
          });
        } else {
          gradesArr.push({
            key: 'behavior',
            type: 'السلوك',
            value: (studentObj.behavior !== undefined && studentObj.behavior !== '')
                   ? String(studentObj.behavior) : '',
            max: 20
          });
          gradesArr.push({
            key: 'homework',
            type: 'الواجبات',
            value: (studentObj.homework !== undefined && studentObj.homework !== '')
                   ? String(studentObj.homework) : '',
            max: 20
          });
          gradesArr.push({
            key: 'oral',
            type: 'الشفوي',
            value: (studentObj.oral !== undefined && studentObj.oral !== '')
                   ? String(studentObj.oral) : '',
            max: 20
          });
          gradesArr.push({
            key: 'written',
            type: 'التحريري',
            value: (studentObj.written !== undefined && studentObj.written !== '')
                   ? String(studentObj.written) : '',
            max: 40
          });
          gradesArr.push({
            key: 'total',
            type: 'الإجمالي',
            value: (studentObj.total !== undefined && studentObj.total !== '')
                   ? String(studentObj.total) : '',
            max: 100,
            isTotal: true
          });
        }

        // تطبيق v3 Decorator (تسميات جديدة + أعمدة افتراضية)
        gradesArr = _applyV3OnGradesResponse(month, gradesArr);

        // حفظ المصفوفة المعدلة داخل كائن الطالب
        studentObj.grades = gradesArr;
      }

      students.push(studentObj);
    }

    // ترتيب الطلاب أبجدياً بالعربية لعرض ثابت ومنطقي
    students.sort(function(a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });

    return {
      success      : true,
      students     : students,
      isTermMonth  : (locationResult && locationResult.success) ? locationResult.isTermMonth : false,
      totalFound   : students.length
    };
  } catch (e) {
    Logger.log('_getStudentsInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * ═══════════════════════════════════════════════════════════
 *  v3 Decorator — يُطبَّق قبل إرجاع البيانات للواجهة
 *  يستدعي v2 ثم يضيف labels جديدة + الأعمدة الافتراضية.
 * ═══════════════════════════════════════════════════════════
 */
function _applyV3OnGradesResponse(monthName, gradesArr) {
  if (typeof GS_V3_FLAG === 'undefined' || !GS_V3_FLAG) {
    return gradesArr;  /* v3 معطّل → ارجع كما هو */
  }

  if (!gradesArr || !gradesArr.length) return gradesArr;

  /* 1) تطبيق labels جديدة */
  var decorated = [];
  for (var i = 0; i < gradesArr.length; i++) {
    decorated.push(GS_decorateGrade(monthName, gradesArr[i]));
  }

  /* 2) إضافة الأعمدة الافتراضية لنهاية العام */
  decorated = GS_buildVirtualColumns(monthName, decorated);

  return decorated;
}

/**
 * تُعيد إعدادات v3 للواجهة الأمامية
 */
function getV3Config() {
  if (typeof GS_getV3Config === 'function') return GS_getV3Config();
  return { enabled: false, features: {}, labels: {}, version: '0' };
}
  // ══════════════════════════════════════════════════════
// دالة مساعدة جديدة: قراءة الدرجات بكفاءة
// أضفها في TeacherCore.gs (قبل getStudentsProtected)
// ══════════════════════════════════════════════════════
function _readGradesSheetEfficient(grade, section, subjectFilter, monthFilter) {
  var cKey = 'tc_grades_' + grade + '_' + section + '_' + (subjectFilter||'all') + '_' + (monthFilter||'all');
  var cached = _tcCacheGet(cKey);
  if (cached) return cached;

  var sheet = (_getSheet('النصفي') || _getSheet('الدرجات'));
  if (!sheet) return null;

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 4 || lastCol < 4) return null;

  // قراءة 3 صفوف الرأس كاملة (ضرورية لتحديد الأعمدة)
  var headers = _getGradeHeaders(sheet).headers;
  // قراءة بيانات الطلاب (عمود A:D فقط أولاً للفلترة)
  var colData = sheet.getRange(4, 1, lastRow - 3, 4).getValues();

  // تحديد الصفوف المطلوبة (فصل + شعبة)
  var targetRows = [];
  for (var i = 0; i < colData.length; i++) {
    var g = _safeStr(colData[i][2]);
    var s = _safeStr(colData[i][3]);
    var matchGrade   = !grade   || g === grade;
    var matchSection = !section || s === section || section === 'جميع الشعب';
    if (matchGrade && matchSection) {
      targetRows.push(i + 4); // رقم الصف الفعلي في الشيت
    }
  }

  // إذا لم يوجد طلاب
  if (targetRows.length === 0) {
    var empty = { headers: headers, rows: [], rowNumbers: [] };
    _tcCacheSet(cKey, empty, 60);
    return empty;
  }

  // قراءة بيانات الطلاب المطلوبين فقط (Batch read)
  var allRowsData = [];
  var BATCH_SIZE = 50; // قراءة 50 صفاً في كل مرة
  for (var b = 0; b < targetRows.length; b += BATCH_SIZE) {
    var batch = targetRows.slice(b, b + BATCH_SIZE);
    var firstRow = batch[0];
    var lastBatchRow = batch[batch.length - 1];
    var batchData = sheet.getRange(firstRow, 1, lastBatchRow - firstRow + 1, lastCol).getValues();
    // تصفية الصفوف المطلوبة فقط
    for (var bi = 0; bi < batch.length; bi++) {
      var relativeIndex = batch[bi] - firstRow;
      allRowsData.push(batchData[relativeIndex]);
    }
  }

  var result = { headers: headers, rows: allRowsData, rowNumbers: targetRows };
  _tcCacheSet(cKey, result, 60);
  return result;
}
  /**
   * جلب الطلاب مع درجاتهم (نسخة محمية)
   * @param {Object} params - { token, grade, section, month, subject }
   */
  function getStudentsProtected(params) {
    return withAuthAndClass(params, params.grade, params.section, function(session) {
      // التحقق من صلاحية المادة
      if (!session.isAdmin) {
        var allowedSubjects = session.subjects;
        if (allowedSubjects.indexOf('جميع المواد') === -1 &&
            allowedSubjects.indexOf(params.subject) === -1) {
          return { success: false, error: 'غير مصرح لك بتدريس مادة ' + params.subject };
        }
      }
      // استدعاء الدالة الداخلية
      return _getStudentsInternal(params.grade, params.section, params.month, params.subject);
    });
  }

  // ══════════════════════════════════════════════════════
  //  تحديد موقع أعمدة المادة / الشهر في ورقة الدرجات
  // ══════════════════════════════════════════════════════

  /**
   * يحدد أعمدة درجات مادة معينة في شهر معين
   *
   * @param {string} month   - اسم الشهر
   * @param {string} subject - اسم المادة
   * @returns {Object} { success, columns: { behavior, homework, oral, written } | { final_grade }, isTermMonth }
   */
 /**
 * _findSubjectLocation — Wrapper موحّد على GS_findSubjectLocation
 * يحافظ على نفس التوقيع القديم للتوافق العكسي (backward compatibility)
 */
/**
 * _findSubjectLocation — Wrapper موحّد على GS_findSubjectLocation
 * يحافظ على نفس التوقيع القديم للتوافق العكسي (backward compatibility)
 */
function _findSubjectLocation(month, subject) {
  // ═══════════════════════════════════════════════════
  //  Feature Flag: USE_UNIFIED_SCHEMA
  //  false = الكود القديم (الاحتياطي)
  //  true  = الكود الجديد (GradeSchema.gs)
  // ═══════════════════════════════════════════════════

  if (USE_UNIFIED_SCHEMA) {

    /* ═══════════════════════════════════════════════════
       ✨ الكود الجديد — يستدعي الطبقة الموحّدة
    ═══════════════════════════════════════════════════ */
    try {
      var sheet = (_getSheet('النصفي') || _getSheet('الدرجات'));  // أو 'النصفي' حسب اسم الورقة الفعلي
      if (!sheet) throw new Error('ورقة الدرجات غير موجودة');

      var lastColumn = sheet.getLastColumn();
      var lastRow    = sheet.getLastRow();
      if (lastRow < 3 || lastColumn < 5) {
        throw new Error('لا توجد بيانات كافية في ورقة الدرجات');
      }

      var headers    = _getGradeHeaders(sheet).headers;
      var monthRow   = headers[0];
      var subjectRow = headers[1];
      var typeRow    = headers[2];

      // استدعاء الطبقة الموحّدة من GradeSchema.gs
      var result = GS_findSubjectLocation(monthRow, subjectRow, typeRow, month, subject);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // بناء كائن columns بالأسماء التي تستخدمها بقية دوال TeacherCore
      var legacyColumns = {};
      if (result.isTermMonth) {
        legacyColumns.monthly_score = result.columns.monthly_score;
        legacyColumns.exam_score    = result.columns.exam_score;
        legacyColumns.total_score   = result.columns.total_score;
      } else {
        legacyColumns.behavior = result.columns.behavior;
        legacyColumns.homework = result.columns.homework;
        legacyColumns.oral     = result.columns.oral;
        legacyColumns.written  = result.columns.written;
        legacyColumns.total    = result.columns.total;
      }

      return {
        success: true,
        columns: legacyColumns,
        isTermMonth: result.isTermMonth
      };

    } catch (e) {
      Logger.log('_findSubjectLocation (new) error: ' + e.toString());
      return { success: false, error: e.toString() };
    }

  } else {

    /* ═══════════════════════════════════════════════════
       🔒 الكود القديم — احتفظ به كما هو بالضبط
    ═══════════════════════════════════════════════════ */
    try {
      var sheet = _getSheet('النصفي');
      if (!sheet) throw new Error('ورقة النصفي غير موجودة');

      var lastColumn = sheet.getLastColumn();
      var lastRow    = sheet.getLastRow();
      if (lastRow < 3 || lastColumn < 5) {
        throw new Error('لا توجد بيانات كافية في ورقة الدرجات');
      }

      var headers    = _getGradeHeaders(sheet).headers;
      var monthRow   = headers[0]; // صف 1: الشهور
      var subjectRow = headers[1]; // صف 2: المواد
      var typeRow    = headers[2]; // صف 3: أنواع الدرجات

      var VALID_MONTHS = [
        'محرم', 'صفر', 'ربيع اول', 'ربيع ثاني',
        'جماد اول', 'جماد ثاني', 'رجب', 'شعبان',
        'نصف العام', 'نهاية العام'
      ];

      // forward-fill لصف الشهور
      var filledMonths = [];
      var lastM = '';
      for (var fi = 0; fi < monthRow.length; fi++) {
        var mc = _safeStr(monthRow[fi]);
        if (VALID_MONTHS.indexOf(mc) !== -1) { lastM = mc; filledMonths.push(mc); }
        else if (mc === '' && lastM)          { filledMonths.push(lastM); }
        else                                  { filledMonths.push(''); lastM = ''; }
      }

      // نطاق الشهر
      var startCol = -1, endCol = -1;
      for (var i = 0; i < filledMonths.length; i++) {
        if (filledMonths[i] === month) {
          if (startCol === -1) startCol = i;
          endCol = i;
        }
      }
      if (startCol === -1) throw new Error('لم يتم العثور على الشهر "' + month + '"');

      var isTermMonth = (month === 'نصف العام' || month === 'نهاية العام');

      // البحث عن عمود المادة
      var subjectCol = -1;
      for (var j = startCol; j <= endCol; j++) {
        if (_safeStr(subjectRow[j]) === subject) { subjectCol = j; break; }
      }
      if (subjectCol === -1) throw new Error('المادة "' + subject + '" غير موجودة في ' + month);

      var columns = {};

      if (isTermMonth) {
        var MONTHLY_NAMES = ['المحصلة1', 'محصلة1', 'اعمال مستمرة', 'الشهري', 'الدرجة الشهرية'];
        var EXAM_NAMES    = ['النصفي', 'النهائي', 'درجة الاختبار', 'الاختبار'];
        var TOTAL_NAMES   = ['الاجمالي', 'اجمالي', 'المجموع', 'الكلي'];

        columns.monthly_score = -1;
        columns.exam_score    = -1;
        columns.total_score   = -1;

        for (var ti = 0; ti < 5 && (subjectCol + ti) <= endCol && _safeStr(subjectRow[subjectCol + ti]) === subject; ti++) {
          var label = _safeStr(typeRow[subjectCol + ti] || '');
          if (MONTHLY_NAMES.indexOf(label) !== -1) {
            columns.monthly_score = subjectCol + ti;
          } else if (EXAM_NAMES.indexOf(label) !== -1) {
            columns.exam_score = subjectCol + ti;
          } else if (TOTAL_NAMES.indexOf(label) !== -1) {
            columns.total_score = subjectCol + ti;
          }
        }

        if (columns.monthly_score === -1) columns.monthly_score = subjectCol;
        if (columns.exam_score    === -1) columns.exam_score    = subjectCol + 1;
        if (columns.total_score   === -1) columns.total_score   = subjectCol + 2;

      } else {
        var GRADE_TYPES = ['السلوك', 'الواجبات', 'الشفوي', 'التحريري', 'الاجمالي'];
        columns.behavior = -1; columns.homework = -1;
        columns.oral     = -1; columns.written  = -1; columns.total = -1;

        for (var gi = 0; gi < 5 && (subjectCol + gi) <= endCol && _safeStr(subjectRow[subjectCol + gi]) === subject; gi++) {
          var glabel = _safeStr(typeRow[subjectCol + gi] || '');
          if      (glabel === 'السلوك')   columns.behavior = subjectCol + gi;
          else if (glabel === 'الواجبات') columns.homework = subjectCol + gi;
          else if (glabel === 'الشفوي')   columns.oral     = subjectCol + gi;
          else if (glabel === 'التحريري') columns.written  = subjectCol + gi;
          else if (glabel === 'الاجمالي') columns.total    = subjectCol + gi;
        }

        if (columns.behavior === -1) columns.behavior = subjectCol + 0;
        if (columns.homework === -1) columns.homework = subjectCol + 1;
        if (columns.oral     === -1) columns.oral     = subjectCol + 2;
        if (columns.written  === -1) columns.written  = subjectCol + 3;
        if (columns.total    === -1) columns.total    = subjectCol + 4;
      }

      return { success: true, columns: columns, isTermMonth: isTermMonth };
    } catch (e) {
      Logger.log('_findSubjectLocation (old) error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
}
  /**
   * دالة عامة يمكن استدعاؤها من الواجهة
   */
  function findSubjectLocation(month, subject) {
    return _findSubjectLocation(month, subject);
  }

  // ══════════════════════════════════════════════════════
  //  حفظ الدرجات
  // ══════════════════════════════════════════════════════
/**
 * ═══════════════════════════════════════════════════════════
 *  v3.1 — حارس الكتابة على الحقول المقفلة
 *  يمنع أي محاولة كتابة على عمود مقفل، حتى لو جاءت من API
 *  مباشرة أو من frontend متلاعب به.
 * ═══════════════════════════════════════════════════════════
 */
function _isWriteAllowed(month, fieldKey) {
  /* إذا v3 معطّل، نعود للسلوك القديم (كل الحقول مفتوحة) */
  if (typeof GS_V3_FLAG === 'undefined' || !GS_V3_FLAG) {
    return true;
  }

  /* إذا ميزة القفل معطّلة صراحةً */
  if (!GS_V3_FEATURES.lockMonthlyScore) return true;

  /* استخدم الطبقة الموحّدة من GradeSchema.gs */
  if (typeof GS_isFieldLocked === 'function') {
    return !GS_isFieldLocked(month, fieldKey);
  }

  /* fallback احتياطي في حال لم توجد GS_isFieldLocked */
  if ((month === 'نصف العام' || month === 'نهاية العام') &&
      fieldKey === 'monthly_score') {
    return false;
  }

  return true;
}

/**
 * v3.1 — تحويل اسم العمود (كما يظهر في الواجهة أو gradeType)
 *        إلى المفتاح التقني (monthly_score, exam_score ...)
 *        لتتمكن _isWriteAllowed من التحقق منه.
 */
function _resolveColumnKey(month, columnLabel) {
  if (typeof GS_resolveFieldKey === 'function') {
    var k = GS_resolveFieldKey(columnLabel);
    if (k) return k;
  }

  /* fallback يدوي */
  if (columnLabel === 'الأعمال المستمرة' || columnLabel === 'اعمال مستمرة' ||
      columnLabel === 'المحصلة' || columnLabel === 'الدرجة الشهرية') {
    return 'monthly_score';
  }
  if (columnLabel === 'درجة الاختبار' || columnLabel === 'الاختبار') {
    return 'exam_score';
  }
  return columnLabel;
}
  /**
   * حفظ درجات مجموعة طلاب دفعة واحدة (batch save)
   *
   * @param {string} month          - الشهر
   * @param {string} subject        - المادة
   * @param {string} grade          - الفصل (للتوثيق فقط)
   * @param {string} section        - الشعبة (للتوثيق فقط)
   * @param {Array}  studentGrades  - مصفوفة من { code, behavior, homework, oral, written } أو { code, final_grade }
   */
  function saveGrades(month, subject, grade, section, studentGrades) {
    throw new Error('الدالة saveGrades غير آمنة. استخدم saveGradesProtected مع token.');
  }
  function _saveGradesInternal(month, subject, grade, section, studentGrades) {
  try {
    if (!month)   throw new Error('الشهر مطلوب');
    if (!subject) throw new Error('المادة مطلوبة');
    if (!studentGrades || !Array.isArray(studentGrades) || studentGrades.length === 0) {
      return { success: false, error: 'لا توجد درجات لحفظها' };
    }

    var sheet = _getSheet('النصفي');
    if (!sheet)  throw new Error('ورقة "النصفي" غير موجودة');

    var location = _findSubjectLocation(month, subject);
    if (!location.success) throw new Error(location.error);

    var columns     = location.columns;
    var isTermMonth = location.isTermMonth;
    var studentMap  = _getStudentRowMap();
    var savedCount  = 0;
    var notFound    = [];

    for (var i = 0; i < studentGrades.length; i++) {
      var s    = studentGrades[i];
      var code = _safeStr(s.code);
      if (!code) continue;

      var rowIndex = studentMap[code];
      if (!rowIndex) {
        notFound.push(code);
        continue;
      }

      if (isTermMonth) {
        if (month === 'نهاية العام') {
          /* ✅ نهاية العام (5 أعمدة): يكتب النهائي + يحسب محصلة1/محصلة2/النصفي/الإجمالي(100) */
          _saveYearEndGrade(sheet, rowIndex, subject, s.exam_score);
          savedCount++;
        } else {
        // ═══════════════════════════════════════════════════════
        // ★ نصف العام: نحفظ فقط درجة الاختبار. المحصلة والمجموع تلقائياً.
        // ═══════════════════════════════════════════════════════
        var es = _safeStr(s.exam_score);

        if (es !== '' && columns.exam_score >= 0) {
          var esNum = _safeNum(es);
          if (esNum !== null && esNum >= 0 && esNum <= 30) {
            // حفظ درجة الاختبار
            sheet.getRange(rowIndex, columns.exam_score + 1).setValue(esNum);

            // إعادة حساب المحصلة تلقائياً من الشهور السابقة
            var autoMonthly = _calcTermMonthlyScore(sheet, code, subject, month);
            if (autoMonthly !== null && columns.monthly_score >= 0) {
              // حفظ المحصلة المحسوبة (كتابة داخلية من السيرفر)
              sheet.getRange(rowIndex, columns.monthly_score + 1).setValue(autoMonthly);

              // حساب وحفظ المجموع = المحصلة + درجة الاختبار
              if (columns.total_score >= 0) {
                var totalVal = autoMonthly + esNum;
                if (totalVal > 50) totalVal = 50;
                totalVal = Math.round(totalVal * 10) / 10;
                sheet.getRange(rowIndex, columns.total_score + 1).setValue(totalVal);
              }
            }
            savedCount++;
          }
        }
        }
      } else {
        // ★ حفظ الأعمدة الأربعة للشهر العادي (بدون تغيير)
        var bh = _safeStr(s.behavior);
        var hw = _safeStr(s.homework);
        var or = _safeStr(s.oral);
        var wr = _safeStr(s.written);

        if (bh !== '' || hw !== '' || or !== '' || wr !== '') {
          if (bh !== '' && columns.behavior >= 0) sheet.getRange(rowIndex, columns.behavior + 1).setValue(bh);
          if (hw !== '' && columns.homework >= 0) sheet.getRange(rowIndex, columns.homework + 1).setValue(hw);
          if (or !== '' && columns.oral     >= 0) sheet.getRange(rowIndex, columns.oral     + 1).setValue(or);
          if (wr !== '' && columns.written  >= 0) sheet.getRange(rowIndex, columns.written  + 1).setValue(wr);
          savedCount++;
        }
      }
    }

    SpreadsheetApp.flush();

    return {
      success    : true,
      savedCount : savedCount,
      notFound   : notFound,
      message    : '✅ تم حفظ ' + savedCount + ' درجة بنجاح' +
                  (notFound.length > 0 ? ' | ⚠️ ' + notFound.length + ' طالب غير موجود' : '')
    };
  } catch (e) {
    Logger.log('_saveGradesInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}
  /**
   * حفظ الدرجات (نسخة محمية)
   * @param {Object} params - { token, month, subject, grade, section, studentGrades }
   */
  function saveGradesProtected(params) {
    return withAuthAndClass(params, params.grade, params.section, function(session) {
      if (!session.isAdmin) {
        var allowedSubjects = session.subjects;
        if (allowedSubjects.indexOf('جميع المواد') === -1 &&
            allowedSubjects.indexOf(params.subject) === -1) {
          return { success: false, error: 'غير مصرح بتدريس هذه المادة' };
        }
      }
      return _saveGradesInternal(params.month, params.subject, params.grade, params.section, params.studentGrades);
    });
  }

  /**
   * حفظ درجة طالب واحد فورًا (auto-save)
   *
   * @param {string} month       - الشهر
   * @param {string} subject     - المادة
   * @param {string} studentCode - كود الطالب
   * @param {string} gradeType   - نوع الدرجة: behavior|homework|oral|written|final_grade
   * @param {number|string} value - القيمة
   */
  function autoSaveSingleGrade(month, subject, studentCode, gradeType, value) {
    throw new Error('الدالة autoSaveSingleGrade غير آمنة. استخدم autoSaveSingleGradeProtected مع token.');
  }
  function _autoSaveSingleGradeInternal(month, subject, studentCode, gradeType, value) {
  try {
    month       = _safeStr(month);
    subject     = _safeStr(subject);
    studentCode = _safeStr(studentCode);
    gradeType   = _safeStr(gradeType);

    if (!month || !subject || !studentCode || !gradeType) {
      return { success: false, error: 'جميع المعاملات مطلوبة' };
    }

    // ═══════════════════════════════════════════════════════
    // ⭐ v3.1: حماية الكتابة على الحقول المقفلة
    // ═══════════════════════════════════════════════════════
    var fieldKey = _resolveColumnKey(month, gradeType);
    if (fieldKey && !_isWriteAllowed(month, fieldKey)) {
      return {
        success: false,
        locked: true,
        message: 'هذا الحقل محسوب تلقائياً ولا يمكن التعديل عليه يدوياً'
      };
    }

    var sheet = _getSheet('النصفي');
    if (!sheet) throw new Error('ورقة "النصفي" غير موجودة');

    var location = _findSubjectLocation(month, subject);
    if (!location.success) throw new Error(location.error);

    var columns     = location.columns;
    var isTermMonth = location.isTermMonth;
    var studentMap  = _getStudentRowMap();
    var rowIndex    = studentMap[studentCode];

    if (!rowIndex) {
      return { success: false, error: 'الطالب ذو الكود "' + studentCode + '" غير موجود' };
    }

    var numValue = _safeNum(value);
    if (numValue === null) {
      return { success: false, error: 'القيمة المدخلة غير صالحة' };
    }

    // ✅ نهاية العام: مسار مخصّص (يكتب النهائي + يحسب الأعمدة الخمسة /100)
    if (isTermMonth && month === 'نهاية العام' && gradeType === 'exam_score') {
      var yres = _saveYearEndGrade(sheet, rowIndex, subject, value);
      SpreadsheetApp.flush();
      return { success: true, message: 'تم الحفظ', calculated: { monthly: yres.m1, total: yres.total } };
    }

    // ★ التحقق من الحدود
    var maxLimits = {
      monthly_score: 20,
      exam_score   : 30,
      total_score  : 50,
      behavior     : 20,
      homework     : 20,
      oral         : 20,
      written      : 40
    };
    if (maxLimits[gradeType] && numValue > maxLimits[gradeType]) {
      return { success: false, error: 'الدرجة تتجاوز الحد الأقصى (' + maxLimits[gradeType] + ')' };
    }

    var colIndex = null;

    if (isTermMonth) {
      // المسموح فقط: exam_score
      if (gradeType === 'exam_score' && columns.exam_score >= 0) {
        colIndex = columns.exam_score + 1;
      }
    } else {
      if      (gradeType === 'behavior') colIndex = columns.behavior + 1;
      else if (gradeType === 'homework') colIndex = columns.homework + 1;
      else if (gradeType === 'oral')     colIndex = columns.oral     + 1;
      else if (gradeType === 'written')  colIndex = columns.written  + 1;
    }

    if (!colIndex) {
      return { success: false, error: 'نوع الدرجة "' + gradeType + '" غير صالح لهذا الشهر' };
    }

    // حفظ القيمة المُدخلة
    sheet.getRange(rowIndex, colIndex).setValue(numValue);

    // ★★★ إعادة حساب المحصلة والمجموع تلقائياً (داخلي بحت)
    var calcResult = { monthly: null, total: null };

    if (isTermMonth && gradeType === 'exam_score') {
      var autoMonthly = _calcTermMonthlyScore(sheet, studentCode, subject, month);
      if (autoMonthly !== null && columns.monthly_score >= 0) {
        sheet.getRange(rowIndex, columns.monthly_score + 1).setValue(autoMonthly);
        calcResult.monthly = autoMonthly;

        if (columns.total_score >= 0) {
          var totalVal = autoMonthly + numValue;
          if (totalVal > 50) totalVal = 50;
          totalVal = Math.round(totalVal * 10) / 10;
          sheet.getRange(rowIndex, columns.total_score + 1).setValue(totalVal);
          calcResult.total = totalVal;
        }
      }
    } else if (!isTermMonth) {
      // تحديث الشهور الفصلية المرتبطة (كتابة داخلية)
      _recalcLinkedTermMonth(sheet, studentCode, subject, month);
    }

    SpreadsheetApp.flush();
    return {
      success: true,
      message: 'تم الحفظ',
      calculated: calcResult
    };

  } catch (e) {
    Logger.log('_autoSaveSingleGradeInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}
  /**
   * حفظ درجة مفردة تلقائيًا (نسخة محمية)
   * @param {Object} params - { token, month, subject, grade, section, studentCode, gradeType, value }
   */
  function autoSaveSingleGradeProtected(params) {
    return withAuthAndClass(params, params.grade, params.section, function(session) {
      if (!session.isAdmin) {
        var allowedSubjects = session.subjects;
        if (allowedSubjects.indexOf('جميع المواد') === -1 &&
            allowedSubjects.indexOf(params.subject) === -1) {
          return { success: false, error: 'غير مصرح' };
        }
      }
      return _autoSaveSingleGradeInternal(params.month, params.subject, params.studentCode, params.gradeType, params.value);
    });
  }
  /**
   * بناء خريطة كود الطالب → رقم الصف في ورقة الدرجات
   * الطلاب يبدأون من الصف 4
   */
function _getStudentRowMap() {
  var sheet = _getSheet('النصفي');
  if (!sheet) return {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 4) return {};

  var codes = sheet.getRange(4, 1, lastRow - 3, 1).getValues();
  var map = {};
  for (var i = 0; i < codes.length; i++) {
    var code = _safeStr(codes[i][0]);
    if (code) map[code] = i + 4;
  }
  return map;
}

  // ══════════════════════════════════════════════════════
  //  تصدير / استيراد بيانات الدرجات
  // ══════════════════════════════════════════════════════

  /**
   * تصدير الدرجات لشهر ومادة معينين
   */
  function _exportGradesDataInternal(month, subject, grade, section) {
    try {
      var studentsResult = _getStudentsInternal(grade, section, month, subject);
      if (!studentsResult.success) throw new Error(studentsResult.error);

      var students    = studentsResult.students;
      var isTermMonth = studentsResult.isTermMonth;

      var headerRow = isTermMonth
        ? ['الكود', 'الاسم', 'الفصل', 'الشعبة', 'الدرجة الكلية']
        : ['الكود', 'الاسم', 'الفصل', 'الشعبة', 'السلوك', 'الواجبات', 'الشفوي', 'التحريري'];

      var data = [headerRow];
      students.forEach(function(s) {
        if (isTermMonth) {
          data.push([s.code, s.name, s.grade, s.section, s.final_grade !== undefined ? s.final_grade : '']);
        } else {
          data.push([
            s.code, s.name, s.grade, s.section,
            s.behavior !== undefined ? s.behavior : '',
            s.homework !== undefined ? s.homework : '',
            s.oral     !== undefined ? s.oral     : '',
            s.written  !== undefined ? s.written  : ''
          ]);
        }
      });

      var dateStr  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      var fileName = 'درجات_' + month + '_' + subject +
                    '_الصف' + (grade   || 'الكل') +
                    '_'     + (section || 'الكل') +
                    '_'     + dateStr + '.xlsx';

      return { success: true, data: data, fileName: fileName };
    } catch (e) {
      Logger.log('_exportGradesDataInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  function exportGradesDataProtected(params) {
    return withAuthAndClass(params, params.grade, params.section, function(session) {
      if (!session.isAdmin) {
        var allowedSubjects = session.subjects;
        if (allowedSubjects.indexOf('جميع المواد') === -1 &&
            allowedSubjects.indexOf(params.subject) === -1) {
          return { success: false, error: 'غير مصرح' };
        }
      }
      return _exportGradesDataInternal(params.month, params.subject, params.grade, params.section);
    });
  }
  function exportGradesData(month, subject, grade, section) {
    throw new Error('استخدم exportGradesDataProtected مع token.');
  }
  /**
   * استيراد الدرجات من بيانات Excel (مصفوفة ثنائية الأبعاد)
   *
   * @param {string} month      - الشهر
   * @param {string} subject    - المادة
   * @param {string} grade      - الفصل
   * @param {string} section    - الشعبة
   * @param {Array}  excelData  - بيانات الملف من XLSX.utils.sheet_to_json(sheet,{header:1})
   */
  function _importGradesDataInternal(month, subject, grade, section, excelData) {
    try {
      if (!excelData || !Array.isArray(excelData) || excelData.length < 2) {
        throw new Error('بيانات Excel غير صالحة أو فارغة');
      }

      var sheet = (_getSheet('النصفي') || _getSheet('الدرجات'));
      if (!sheet) throw new Error('ورقة "الدرجات" غير موجودة');

      var location = _findSubjectLocation(month, subject);
      if (!location.success) throw new Error(location.error);

      var columns     = location.columns;
      var isTermMonth = location.isTermMonth;
      var studentMap  = _getStudentRowMap();

      var dataStartRow = 1;
      for (var i = 0; i < Math.min(10, excelData.length); i++) {
        var firstCell = _safeStr(excelData[i][0]);
        if (firstCell === 'الكود' || firstCell.indexOf('كود') !== -1) {
          dataStartRow = i + 1;
          break;
        }
      }

      var updatedCount = 0;
      var notFound     = [];

      for (var r = dataStartRow; r < excelData.length; r++) {
        var row         = excelData[r];
        if (!row || row.length < 2) continue;

        var studentCode = _safeStr(row[0]);
        if (!studentCode) continue;

        var rowIndex = studentMap[studentCode];
        if (!rowIndex) {
          notFound.push(studentCode);
          continue;
        }

        if (isTermMonth) {
          var fg = _safeNum(row[4]);
          if (fg !== null) {
            sheet.getRange(rowIndex, columns.final_grade + 1).setValue(fg);
            updatedCount++;
          }
        } else {
          var bh = _safeNum(row[4]);
          var hw = _safeNum(row[5]);
          var or = _safeNum(row[6]);
          var wr = _safeNum(row[7]);
          if (bh !== null) sheet.getRange(rowIndex, columns.behavior + 1).setValue(bh);
          if (hw !== null) sheet.getRange(rowIndex, columns.homework + 1).setValue(hw);
          if (or !== null) sheet.getRange(rowIndex, columns.oral     + 1).setValue(or);
          if (wr !== null) sheet.getRange(rowIndex, columns.written  + 1).setValue(wr);
          updatedCount++;
        }
      }

      SpreadsheetApp.flush();

      return {
        success      : true,
        updatedCount : updatedCount,
        notFound     : notFound,
        message      : '✅ تم استيراد ' + updatedCount + ' درجة بنجاح' +
                      (notFound.length > 0 ? ' | ⚠️ ' + notFound.length + ' كود غير موجود' : '')
      };
    } catch (e) {
      Logger.log('_importGradesDataInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
  function importGradesDataProtected(params) {
    return withAuthAndClass(params, params.grade, params.section, function(session) {
      if (!session.isAdmin) {
        var allowedSubjects = session.subjects;
        if (allowedSubjects.indexOf('جميع المواد') === -1 &&
            allowedSubjects.indexOf(params.subject) === -1) {
          return { success: false, error: 'غير مصرح' };
        }
      }
      return _importGradesDataInternal(params.month, params.subject, params.grade, params.section, params.excelData);
    });
  }
  function importGradesData(month, subject, grade, section, excelData) {
    throw new Error('استخدم importGradesDataProtected مع token.');
  }
  // ══════════════════════════════════════════════════════
  //  إدارة الطلاب
  // ══════════════════════════════════════════════════════

  /**
   * جلب كل الطلاب
   * أعمدة الطلاب: الكود | الاسم | الفصل | الشعبة | اجمالي الرسوم
   */
  // ==================== دوال إدارة الطلاب ====================

  /**
   * جلب كل الطلاب (دالة داخلية - المنطق فقط)
   */
  // ══════════════════════════════════════════════════════
// _getAllStudentsInternal — نسخة محسَّنة مع كاش 60 ثانية
// استبدل _getAllStudentsInternal في TeacherCore.gs
// ══════════════════════════════════════════════════════
function _getAllStudentsInternal() {
  var cKey = 'tc_all_students_v1';
  var cached = _tcCacheGet(cKey);
  if (cached) return cached;

  try {
    var ss    = _getSS();
    var sheet = ss.getSheetByName('الطلاب');
    if (!sheet) throw new Error('ورقة الطلاب غير موجودة');

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, students: [] };

    // نقرأ الأعمدة A:E فقط (كود، اسم، فصل، شعبة، رسوم إجمالية)
    var data = sheet.getRange(1, 1, lastRow, 5).getValues();

    // جلب بيانات الرسوم من ملف الطالب
    var studentFile = _getSSById(_activeFileId());
    var feesSheet   = studentFile.getSheetByName('الرسوم');
    var feesData    = {};

    if (feesSheet) {
      var lastFeeRow = feesSheet.getLastRow();
      if (lastFeeRow > 1) {
        // نقرأ عمودَي الكود والمسدد فقط (A, D)
        var feesRows = feesSheet.getRange(2, 1, lastFeeRow - 1, 4).getValues();
        for (var j = 0; j < feesRows.length; j++) {
          var fCode = _safeStr(feesRows[j][0]);
          var fPaid = _safeFloat(feesRows[j][3]);
          if (fCode) feesData[fCode] = fPaid;
        }
      }
    }

    var students = [];
    for (var i = 1; i < data.length; i++) {
      var code = _safeStr(data[i][0]);
      var name = _safeStr(data[i][1]);
      if (!code && !name) continue;

      var totalFees = _safeFloat(data[i][4]);
      var paid      = feesData[code] || 0;
      var paymentPercentage = totalFees > 0 ? Math.round((paid / totalFees) * 100) : 100;

      students.push({
        rowIndex         : i + 1,
        code             : code,
        name             : name,
        grade            : _safeStr(data[i][2]),
        section          : _safeStr(data[i][3]),
        fees             : totalFees,
        paid             : paid,
        paymentPercentage: paymentPercentage
      });
    }

    // ✅ ترتيب أبجدي تصاعدي حسب اسم الطالب (دعم اللغة العربية)
    students.sort(function(a, b) {
      return (a.name || '').localeCompare(b.name || '', 'ar');
    });

    var result = { success: true, students: students };
    _tcCacheSet(cKey, result, 60); // كاش 60 ثانية (بيانات مالية تتغير)
    return result;

  } catch (e) {
    Logger.log('_getAllStudentsInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}
  /**
   * جلب كل الطلاب (نسخة محمية - للمدير فقط)
   * @param {Object} params - { token }
   */
 function adminGetAllStudents(params) {
  return withAuth(params, function(session) {
    if (session.role !== 'admin') {
      return { success: false, error: 'هذه العملية متاحة للمدير فقط' };
    }
    return _getAllStudentsInternal();
  });
}

  // الدالة القديمة ترمي خطأ
  function getAllStudents() {
    throw new Error('استخدم adminGetAllStudents مع token.');
  }

  /**
   * البحث عن طلاب بالاسم أو الكود مع فلترة اختيارية
   *
   * @param {string} query   - نص البحث
   * @param {Object} filters - { grade, section, allSections }
   */
  /**
   * البحث عن طلاب (دالة داخلية)
   * @param {string} query   - نص البحث
   * @param {Object} filters - { grade, section, allSections }
   */
  function _searchStudentsInternal(query, filters) {
    try {
      query   = _safeStr(query).toLowerCase();
      filters = filters || {};

      var sheet = _getSheet('الطلاب');
      if (!sheet) throw new Error('ورقة الطلاب غير موجودة');

      var data    = sheet.getDataRange().getValues();
      var results = [];

      for (var i = 1; i < data.length; i++) {
        var code    = _safeStr(data[i][0]);
        var name    = _safeStr(data[i][1]);
        var grade   = _safeStr(data[i][2]);
        var section = _safeStr(data[i][3]);

        if (!code && !name) continue;

        // تطبيق الفلاتر
        if (filters.grade   && grade   !== filters.grade)                                 continue;
        if (filters.section && !filters.allSections && section !== filters.section) continue;

        // البحث في الاسم أو الكود
        if (query) {
          var nameMatch = name.toLowerCase().indexOf(query)  !== -1;
          var codeMatch = code.toLowerCase().indexOf(query)  !== -1;
          if (!nameMatch && !codeMatch) continue;
        }

        results.push({
          rowIndex : i + 1,
          code     : code,
          name     : name,
          grade    : grade,
          section  : section
        });
      }

      return results;
    } catch (e) {
      Logger.log('_searchStudentsInternal error: ' + e.toString());
      return [];
    }
  }

  /**
   * البحث عن طلاب (نسخة محمية - للمدير فقط)
   * @param {Object} params - { token, query, filters }
   */
  function adminSearchStudents(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) {
        return { success: false, error: 'غير مصرح - للمدير فقط' };
      }
      return _searchStudentsInternal(params.query, params.filters);
    });
  }

  // ══════════════════════════════════════════════════════
  //  البحث عن طلاب للمعلم (مع مراعاة صلاحية الفصل)
  //  يُستخدم في نافذة تسجيل المخالفة
  // ══════════════════════════════════════════════════════
  function searchStudentsForTeacher(params) {
    return withAuth(params, function(session) {
      try {
        var query   = _safeStr(params.query).toLowerCase().trim();
        var filters = params.filters || {};

        if (!query) return { success: true, data: [] };

        // كاش مؤقت لقائمة الطلاب (مفيد عند بحث متعدد)
        var cacheKey  = 'students_list_cache';
        var cachedRaw = CacheService.getScriptCache().get(cacheKey);
        var allData;

        if (cachedRaw) {
          try { allData = JSON.parse(cachedRaw); } catch(e) { allData = null; }
        }

        if (!allData) {
          var sheet = _getSheet('الطلاب');
          if (!sheet) return { success: false, error: 'ورقة الطلاب غير موجودة' };
          var rawData = sheet.getDataRange().getValues();
          allData = [];
          for (var ri = 1; ri < rawData.length; ri++) {
            var rCode    = _safeStr(rawData[ri][0]);
            var rName    = _safeStr(rawData[ri][1]);
            var rGrade   = _safeStr(rawData[ri][2]);
            var rSection = _safeStr(rawData[ri][3]);
            if (rCode || rName) {
              allData.push({ rowIndex: ri + 1, code: rCode, name: rName, grade: rGrade, section: rSection });
            }
          }
          // تخزين 2 دقيقة
          try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(allData), 120); } catch(e) {}
        }

        var results       = [];
        var hasAllClasses = session.isAdmin ||
          (session.classes && session.classes.indexOf('جميع الفصول') !== -1);
        var allowedClasses = session.classes || [];
        var MAX_RESULTS    = 20;

        for (var i = 0; i < allData.length; i++) {
          var s = allData[i];

          // فلتر الفصل
          if (!hasAllClasses) {
            if (allowedClasses.indexOf(s.grade) === -1) continue;
          }

          // فلتر الشعبة
          if (filters.section && s.section !== filters.section) continue;

          // البحث النصي
          var nm = s.name.toLowerCase().indexOf(query) !== -1;
          var cm = s.code.toLowerCase().indexOf(query) !== -1;
          if (!nm && !cm) continue;

          results.push(s);
          if (results.length >= MAX_RESULTS) break;
        }

        return { success: true, data: results };
      } catch (e) {
        Logger.log('searchStudentsForTeacher error: ' + e.toString());
        return { success: false, error: e.toString() };
      }
    });
  }
  // الدالة القديمة ترمي خطأ
  function searchStudents(query, filters) {
    throw new Error('استخدم adminSearchStudents مع token.');
  }
  /**
   * إضافة أو تحديث طالب
   */
  /**
   * إضافة أو تحديث طالب (دالة داخلية)
   */
  function _saveStudentInternal(data) {
    try {
      if (!data) throw new Error('بيانات الطالب غير موجودة');

      var sheet = _getOrCreateSheet('الطلاب', ['الكود', 'الاسم', 'الفصل', 'الشعبة', 'اجمالي الرسوم']);
      var row   = [
        _safeStr(data.code),
        _safeStr(data.name),
        _safeStr(data.grade),
        _safeStr(data.section),
        _safeStr(data.fees)
      ];

      if (data.rowIndex) {
        var ri = parseInt(data.rowIndex);
        sheet.getRange(ri, 1, 1, 5).setValues([row]);
        return { success: true, message: 'تم تحديث بيانات الطالب' };
      } else {
        sheet.appendRow(row);
        return { success: true, message: 'تم إضافة الطالب بنجاح' };
      }
    } catch (e) {
      Logger.log('_saveStudentInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  /**
   * إضافة أو تحديث طالب (نسخة محمية - للمدير فقط)
   * @param {Object} params - { token, data }
   */
  function adminSaveStudent(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) {
        return { success: false, error: 'غير مصرح - للمدير فقط' };
      }
      return _saveStudentInternal(params.data);
    });
  }

  // الدالة القديمة ترمي خطأ
  function saveStudent(data) {
    throw new Error('استخدم adminSaveStudent مع token.');
  }
  /**
   * حذف طالب بالرقم التسلسلي للصف
   */
  /**
   * حذف طالب (دالة داخلية)
   */
  function _deleteStudentInternal(rowIndex) {
    try {
      rowIndex = parseInt(rowIndex);
      if (isNaN(rowIndex) || rowIndex < 2) throw new Error('رقم الصف غير صالح');

      var sheet = _getSheet('الطلاب');
      if (!sheet) throw new Error('ورقة الطلاب غير موجودة');

      sheet.deleteRow(rowIndex);
      return { success: true, message: 'تم حذف الطالب بنجاح' };
    } catch (e) {
      Logger.log('_deleteStudentInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  /**
   * حذف طالب (نسخة محمية - للمدير فقط)
   * @param {Object} params - { token, rowIndex }
   */
  function adminDeleteStudent(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) {
        return { success: false, error: 'غير مصرح - للمدير فقط' };
      }
      return _deleteStudentInternal(params.rowIndex);
    });
  }

  // الدالة القديمة ترمي خطأ
  function deleteStudent(rowIndex) {
    throw new Error('استخدم adminDeleteStudent مع token.');
  }

  /**
   * استيراد الطلاب من Excel (يمسح القديم ويستبدله)
   */
  function _importStudentsInternal(excelData) {
    try {
      if (!excelData || excelData.length < 2) throw new Error('بيانات غير صالحة');
      var sheet = _getOrCreateSheet('الطلاب', ['الكود', 'الاسم', 'الفصل', 'الشعبة', 'اجمالي الرسوم']);
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
      var dataStartRow = 0;
      for (var i = 0; i < Math.min(5, excelData.length); i++) {
        var cell = _safeStr(excelData[i][0]);
        if (cell === 'الكود' || cell === 'كود' || cell.indexOf('كود') !== -1) {
          dataStartRow = i + 1;
          break;
        }
      }
      var imported = 0;
      var rows = [];
      for (var r = dataStartRow; r < excelData.length; r++) {
        var row = excelData[r];
        if (!row || row.length < 2) continue;
        var code = _safeStr(row[0]);
        var name = _safeStr(row[1]);
        if (!code && !name) continue;
        rows.push([code, name, _safeStr(row[2]), _safeStr(row[3]), row[4] !== undefined ? _safeStr(row[4]) : '']);
        imported++;
      }
      if (rows.length > 0) sheet.getRange(2, 1, rows.length, 5).setValues(rows);
      return { success: true, message: 'تم استيراد ' + imported + ' طالب بنجاح' };
    } catch (e) {
      Logger.log('_importStudentsInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
  function importStudents(excelData) {
    throw new Error('استخدم adminImportStudents مع token.');
  }
  /**
   * تصدير الطلاب للتحميل
   */
  /**
   * تصدير الطلاب للتحميل (دالة داخلية)
   */
  function _exportStudentsInternal() {
    try {
      var sheet = _getSheet('الطلاب');
      if (!sheet) throw new Error('ورقة الطلاب غير موجودة');

      var data       = sheet.getDataRange().getValues();
      var exportData = [['الكود', 'الاسم', 'الفصل', 'الشعبة', 'اجمالي الرسوم']];

      for (var i = 1; i < data.length; i++) {
        exportData.push([
          _safeStr(data[i][0]),
          _safeStr(data[i][1]),
          _safeStr(data[i][2]),
          _safeStr(data[i][3]),
          _safeStr(data[i][4])
        ]);
      }

      var dateStr  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      return {
        success  : true,
        data     : exportData,
        fileName : 'الطلاب_' + dateStr + '.xlsx'
      };
    } catch (e) {
      Logger.log('_exportStudentsInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  /**
   * تصدير الطلاب (نسخة محمية - للمدير فقط)
   * @param {Object} params - { token }
   */
  function adminExportStudents(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) {
        return { success: false, error: 'غير مصرح - للمدير فقط' };
      }
      return _exportStudentsInternal();
    });
  }

  // الدالة القديمة ترمي خطأ
  function exportStudents() {
    throw new Error('استخدم adminExportStudents مع token.');
  }

  // ══════════════════════════════════════════════════════
  //  إدارة المدرسين (للمدير فقط)
  // ══════════════════════════════════════════════════════

  /**
   * جلب كل المدرسين
   */
  function adminGetAllTeachers(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) return { success: false, error: 'غير مصرح' };
      return _getAllTeachersInternal();
    });
  }
  function _getAllTeachersInternal() {
    try {
      var sheet = _getOrCreateSheet('المدرسين',
        ['اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'كلمة المرور']);
      var data     = sheet.getDataRange().getValues();
      var teachers = [];

      for (var i = 1; i < data.length; i++) {
        if (!_safeStr(data[i][0])) continue;
        teachers.push({
          rowIndex  : i + 1,
          name      : _safeStr(data[i][0]),
          subject   : _safeStr(data[i][1]),
          grade     : _safeStr(data[i][2]),
          section   : _safeStr(data[i][3]),
          password  : _safeStr(data[i][4])
        });
      }

      return { success: true, teachers: teachers };
    } catch (e) {
      Logger.log('_getAllTeachersInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
  function getAllTeachers() {
    throw new Error('استخدم adminGetAllTeachers مع token.');
  }
  /**
   * جلب بيانات مدرس واحد
   */
  // ==================== دوال إدارة المعلمين ====================

  /**
   * جلب بيانات مدرس واحد (دالة داخلية)
   */
  function _getTeacherInternal(rowIndex) {
    try {
      rowIndex = parseInt(rowIndex);
      if (isNaN(rowIndex)) throw new Error('رقم صف غير صالح');

      var sheet = _getSheet('المدرسين');
      if (!sheet) throw new Error('ورقة المدرسين غير موجودة');

      var row = sheet.getRange(rowIndex, 1, 1, 5).getValues()[0];
      return {
        name     : _safeStr(row[0]),
        subject  : _safeStr(row[1]),
        grade    : _safeStr(row[2]),
        section  : _safeStr(row[3]),
        password : _safeStr(row[4])
      };
    } catch (e) {
      Logger.log('_getTeacherInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  /**
   * جلب بيانات مدرس واحد (نسخة محمية - للمدير فقط)
   * @param {Object} params - { token, rowIndex }
   */
  function adminGetTeacher(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) {
        return { success: false, error: 'غير مصرح - للمدير فقط' };
      }
      return _getTeacherInternal(params.rowIndex);
    });
  }

  // الدالة القديمة ترمي خطأ
  function getTeacher(rowIndex) {
    throw new Error('استخدم adminGetTeacher مع token.');
  }

  /**
   * إضافة أو تحديث مدرس
   */
  /**
   * إضافة أو تحديث مدرس (دالة داخلية)
   */
  function _saveTeacherInternal(data) {
    try {
      if (!data || !data.name) throw new Error('اسم المدرس مطلوب');

      var sheet = _getOrCreateSheet('المدرسين',
        ['اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'كلمة المرور']);
      var row = [
        _safeStr(data.name),
        _safeStr(data.subject),
        _safeStr(data.grade),
        _safeStr(data.section),
        _safeStr(data.password)
      ];

      if (data.rowIndex) {
        var ri = parseInt(data.rowIndex);
        sheet.getRange(ri, 1, 1, 5).setValues([row]);
        return { success: true, message: 'تم تحديث بيانات المدرس بنجاح' };
      } else {
        sheet.appendRow(row);
        return { success: true, message: 'تم إضافة المدرس بنجاح' };
      }
    } catch (e) {
      Logger.log('_saveTeacherInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  /**
   * إضافة أو تحديث مدرس (نسخة محمية - للمدير فقط)
   * @param {Object} params - { token, data }
   */
  function adminSaveTeacher(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) {
        return { success: false, error: 'غير مصرح - للمدير فقط' };
      }
      return _saveTeacherInternal(params.data);
    });
  }

  // الدالة القديمة ترمي خطأ
  function saveTeacher(data) {
    throw new Error('استخدم adminSaveTeacher مع token.');
  }

  /**
   * حذف مدرس
   */
  /**
   * حذف مدرس (دالة داخلية)
   */
  function _deleteTeacherInternal(rowIndex) {
    try {
      rowIndex = parseInt(rowIndex);
      if (isNaN(rowIndex) || rowIndex < 2) throw new Error('رقم الصف غير صالح');

      var sheet = _getSheet('المدرسين');
      if (!sheet) throw new Error('ورقة المدرسين غير موجودة');

      sheet.deleteRow(rowIndex);
      return { success: true, message: 'تم حذف المدرس بنجاح' };
    } catch (e) {
      Logger.log('_deleteTeacherInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  /**
   * حذف مدرس (نسخة محمية - للمدير فقط)
   * @param {Object} params - { token, rowIndex }
   */
  function adminDeleteTeacher(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) {
        return { success: false, error: 'غير مصرح - للمدير فقط' };
      }
      return _deleteTeacherInternal(params.rowIndex);
    });
  }

  // الدالة القديمة ترمي خطأ
  function deleteTeacher(rowIndex) {
    throw new Error('استخدم adminDeleteTeacher مع token.');
  }

  /**
   * استيراد المدرسين من Excel
   */
  /**
   * استيراد المدرسين من Excel (دالة داخلية)
   */
  function _importTeachersInternal(excelData) {
    try {
      if (!excelData || excelData.length < 2) throw new Error('بيانات غير صالحة');

      var sheet = _getOrCreateSheet('المدرسين',
        ['اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'كلمة المرور']);

      var lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

      var dataStartRow = 0;
      for (var i = 0; i < Math.min(5, excelData.length); i++) {
        var cell = _safeStr(excelData[i][0]);
        if (cell.indexOf('اسم') !== -1 || cell.indexOf('مدرس') !== -1) {
          dataStartRow = i + 1;
          break;
        }
      }

      var imported = 0;
      var rows     = [];

      for (var r = dataStartRow; r < excelData.length; r++) {
        var row = excelData[r];
        if (!row || row.length < 1 || !_safeStr(row[0])) continue;
        rows.push([
          _safeStr(row[0]),
          _safeStr(row[1]),
          _safeStr(row[2]),
          _safeStr(row[3]),
          _safeStr(row[4])
        ]);
        imported++;
      }

      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, 5).setValues(rows);
      }

      return { success: true, message: 'تم استيراد ' + imported + ' مدرس بنجاح' };
    } catch (e) {
      Logger.log('_importTeachersInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  /**
   * استيراد المدرسين من Excel (نسخة محمية - للمدير فقط)
   * @param {Object} params - { token, excelData }
   */
  function adminImportTeachers(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) {
        return { success: false, error: 'غير مصرح - للمدير فقط' };
      }
      return _importTeachersInternal(params.excelData);
    });
  }

  // الدالة القديمة ترمي خطأ
  function importTeachers(excelData) {
    throw new Error('استخدم adminImportTeachers مع token.');
  }
  /**
   * تصدير المدرسين
   */
  /**
   * تصدير المدرسين (دالة داخلية)
   */
  function _exportTeachersInternal() {
    try {
      var sheet = _getSheet('المدرسين');
      if (!sheet) throw new Error('ورقة المدرسين غير موجودة');

      var data       = sheet.getDataRange().getValues();
      var exportData = [['اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'كلمة المرور']];

      for (var i = 1; i < data.length; i++) {
        exportData.push([
          _safeStr(data[i][0]),
          _safeStr(data[i][1]),
          _safeStr(data[i][2]),
          _safeStr(data[i][3]),
          _safeStr(data[i][4])
        ]);
      }

      var dateStr  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      return {
        success  : true,
        data     : exportData,
        fileName : 'المدرسين_' + dateStr + '.xlsx'
      };
    } catch (e) {
      Logger.log('_exportTeachersInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  /**
   * تصدير المدرسين (نسخة محمية - للمدير فقط)
   * @param {Object} params - { token }
   */
  function adminExportTeachers(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) {
        return { success: false, error: 'غير مصرح - للمدير فقط' };
      }
      return _exportTeachersInternal();
    });
  }

  // الدالة القديمة ترمي خطأ
  function exportTeachers() {
    throw new Error('استخدم adminExportTeachers مع token.');
  }
  // ══════════════════════════════════════════════════════
  //  الواجبات
  // ══════════════════════════════════════════════════════

  /**
   * الحصول على رقم الحركة التالي للواجبات
   */
  /**
   * إضافة واجب جديد
   * أعمدة الواجبات: رقم الحركة | اسم المدرس | المادة | الفصل | الشعبة | الواجب | التاريخ
   */
 /**
 * ═══════════════════════════════════════════════════════════════
 *  إدارة الواجبات – نسخة مُعاد هيكلتها بالكامل
 *  إصلاح مشكلة اسم المعلم، تحسين الصلاحيات، دعم الأدوار
 *  TeacherCore.gs – يُستبدل القسم الحالي بالكامل
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * جلب واجب بمعرفه (دالة داخلية غير محمية)
 * @param {string|number} id
 * @returns {object} بيانات الواجب أو {success: false, error: ...}
 */
function getHomework(id) {
  try {
    var sheet = _getSheet('الواجبات');
    if (!sheet) throw new Error('ورقة الواجبات غير موجودة');

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][0]) === _safeStr(id)) {
        return {
          id      : _safeStr(data[i][0]),
          teacher : _safeStr(data[i][1]),
          subject : _safeStr(data[i][2]),
          grade   : _safeStr(data[i][3]),
          section : _safeStr(data[i][4]),
          homework: _safeStr(data[i][5]),
          date    : _safeStr(data[i][6])
        };
      }
    }
    throw new Error('لم يتم العثور على الواجب بالمعرف: ' + id);
  } catch (e) {
    Logger.log('getHomework error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * جلب واجب بمعرفه – نسخة محمية بـ token (للـ API)
 * @param {object} params - { token, id }
 * @returns {object} { success: true, data: {...} } أو خطأ
 */
// ═══════════════════════════════════════════════════════════════
//  إضافة واجب جديد
// ═══════════════════════════════════════════════════════════════

/**
 * إضافة واجب جديد (دالة داخلية – المنطق فقط)
 * @param {object} data - { teacher, subject, grade, section, homework, date }
 * @returns {object} نتيجة الإضافة
 */
function _addHomeworkInternal(data) {
  try {
    if (!data)                throw new Error('بيانات الواجب غير موجودة');
    if (!data.teacher)        throw new Error('اسم المدرس مطلوب');
    if (!data.homework)       throw new Error('نص الواجب مطلوب');
    if (!data.grade)          throw new Error('الفصل مطلوب');
    if (!data.section)        throw new Error('الشعبة مطلوبة');
    if (!data.subject)        throw new Error('المادة مطلوبة');

    var sheet = _getOrCreateSheet('الواجبات',
      ['رقم الحركة', 'اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'الواجب', 'التاريخ']);

    var newId   = _getNextHomeworkId();
    var dateStr = data.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    sheet.appendRow([
      newId,
      _safeStr(data.teacher),
      _safeStr(data.subject),
      _safeStr(data.grade),
      _safeStr(data.section),
      _safeStr(data.homework),
      dateStr
    ]);

    Logger.log('_addHomeworkInternal: تم إضافة واجب #' + newId + ' للمعلم ' + data.teacher);
    return { success: true, message: 'تم إضافة الواجب بنجاح', id: newId };
  } catch (e) {
    Logger.log('_addHomeworkInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * إضافة واجب – نسخة محمية (تُستدعى من الواجهة)
 * @param {object} params - { token, grade, section, subject, homework, date }
 */
function addHomeworkProtected(params) {
  return withAuthAndClass(params, params.grade, params.section, function(session) {
    // التحقق من صلاحية المادة (المدير والوكيل والمشرف معفيون)
    if (!session.isAdmin && session.role !== 'deputy' && session.role !== 'supervisor') {
      var allowedSubjects = session.subjects || [];
      if (allowedSubjects.indexOf('جميع المواد') === -1 && allowedSubjects.indexOf(params.subject) === -1) {
        return { success: false, error: 'غير مصرح لك بتدريس مادة: ' + params.subject };
      }
    }

    // بناء كائن البيانات (نضيف teacher من الجلسة تلقائياً)
    var homeworkData = {
      teacher : session.teacherName,           // ← الإصلاح الأساسي
      subject : _safeStr(params.subject),
      grade   : _safeStr(params.grade),
      section : _safeStr(params.section),
      homework: _safeStr(params.homework),
      date    : _safeStr(params.date)
    };

    var result = _addHomeworkInternal(homeworkData);

    // إبطال كاش الأنشطة بعد الإضافة
    if (result && result.success) {
      try {
        _tcInvalidateActivitiesCache(session.teacherName);
      } catch(e) {
        Logger.log('⚠️ فشل إبطال كاش الأنشطة: ' + e.message);
      }
    }

    return result;
  });
}

// الدالة القديمة غير المحمية ترمي خطأ
function addHomework(data) {
  throw new Error('استخدم addHomeworkProtected مع token.');
}


// ═══════════════════════════════════════════════════════════════
//  تحديث واجب
// ═══════════════════════════════════════════════════════════════

/**
 * تحديث واجب (دالة داخلية)
 * @param {object} data - { id, teacher, subject, grade, section, homework, date }
 * @returns {object} نتيجة التحديث
 */
function _updateHomeworkInternal(data) {
  try {
    if (!data || !data.id) throw new Error('معرف الواجب مطلوب');

    var sheet = _getSheet('الواجبات');
    if (!sheet) throw new Error('ورقة الواجبات غير موجودة');

    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (_safeStr(values[i][0]) === _safeStr(data.id)) {
        var rowIndex = i + 1;
        sheet.getRange(rowIndex, 2).setValue(_safeStr(data.teacher));
        sheet.getRange(rowIndex, 3).setValue(_safeStr(data.subject));
        sheet.getRange(rowIndex, 4).setValue(_safeStr(data.grade));
        sheet.getRange(rowIndex, 5).setValue(_safeStr(data.section));
        sheet.getRange(rowIndex, 6).setValue(_safeStr(data.homework));
        sheet.getRange(rowIndex, 7).setValue(_safeStr(data.date || ''));

        Logger.log('_updateHomeworkInternal: تم تحديث واجب #' + data.id);
        return { success: true, message: 'تم تحديث الواجب بنجاح' };
      }
    }
    throw new Error('لم يتم العثور على الواجب بالمعرف: ' + data.id);
  } catch (e) {
    Logger.log('_updateHomeworkInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * تحديث واجب – نسخة محمية
 * @param {object} params - { token, id, grade, section, subject, homework, date }
 */
function updateHomeworkProtected(params) {
  return withAuthAndClass(params, params.grade, params.section, function(session) {
    var id = params.id;
    if (!id) return { success: false, error: 'معرّف الواجب مطلوب' };

    // جلب الواجب للتحقق من المالك والمادة
    var existingHomework = getHomework(id);
    if (!existingHomework || existingHomework.success === false) {
      return { success: false, error: 'الواجب غير موجود' };
    }

    var isOwner = (existingHomework.teacher === session.teacherName);
    var isAdmin = (session.role === 'admin');
    var isDeputyOrSupervisor = (session.role === 'deputy' || session.role === 'supervisor');

    // صلاحية التحديث: المدير والوكيل والمشرف والمالك
    if (!isAdmin && !isOwner && !isDeputyOrSupervisor) {
      return { success: false, error: 'غير مصرح لك بتعديل هذا الواجب' };
    }

    // التحقق من صلاحية المادة (لغير المدير/الوكيل/المشرف)
    if (!isAdmin && !isDeputyOrSupervisor) {
      var allowedSubjects = session.subjects || [];
      if (allowedSubjects.indexOf('جميع المواد') === -1 && allowedSubjects.indexOf(params.subject) === -1) {
        return { success: false, error: 'غير مصرح لك بتدريس مادة: ' + params.subject };
      }
    }

    // بناء كائن البيانات
    var updateData = {
      id      : id,
      teacher : session.teacherName,         // استخدم اسم الجلسة الحالي (لتوثيق من قام بالتعديل)
      subject : _safeStr(params.subject),
      grade   : _safeStr(params.grade),
      section : _safeStr(params.section),
      homework: _safeStr(params.homework),
      date    : _safeStr(params.date)
    };

    var result = _updateHomeworkInternal(updateData);

    // إبطال الكاش
    if (result && result.success) {
      try { _tcInvalidateActivitiesCache(session.teacherName); } catch(e) {}
    }

    return result;
  });
}

function updateHomework(data) {
  throw new Error('استخدم updateHomeworkProtected مع token.');
}


// ═══════════════════════════════════════════════════════════════
//  حذف واجب
// ═══════════════════════════════════════════════════════════════

/**
 * حذف واجب (دالة داخلية)
 * @param {string|number} id
 * @returns {object} نتيجة الحذف
 */
function _deleteHomeworkInternal(id) {
  try {
    var sheet = _getSheet('الواجبات');
    if (!sheet) throw new Error('ورقة الواجبات غير موجودة');

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][0]) === _safeStr(id)) {
        sheet.deleteRow(i + 1);
        Logger.log('_deleteHomeworkInternal: تم حذف واجب #' + id);
        return { success: true, message: 'تم حذف الواجب بنجاح' };
      }
    }
    throw new Error('لم يتم العثور على الواجب: ' + id);
  } catch (e) {
    Logger.log('_deleteHomeworkInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * حذف واجب – نسخة محمية
 * @param {object} params - { token, id }
 */
function deleteHomeworkProtected(params) {
  return withAuth(params, function(session) {
    var id = params.id;
    if (!id) return { success: false, error: 'معرّف الواجب مطلوب' };

    // جلب الواجب للتحقق من المالك
    var existingHomework = getHomework(id);
    if (!existingHomework || existingHomework.success === false) {
      return { success: false, error: 'الواجب غير موجود' };
    }

    var isOwner = (existingHomework.teacher === session.teacherName);
    var isAdmin = (session.role === 'admin');
    var isDeputyOrSupervisor = (session.role === 'deputy' || session.role === 'supervisor');

    // صلاحية الحذف: المدير والوكيل والمشرف والمالك
    if (!isAdmin && !isOwner && !isDeputyOrSupervisor) {
      return { success: false, error: 'غير مصرح لك بحذف هذا الواجب' };
    }

    var result = _deleteHomeworkInternal(id);

    // إبطال الكاش
    if (result && result.success) {
      try {
        _tcInvalidateActivitiesCache(session.teacherName);
      } catch(e) {
        Logger.log('⚠️ فشل إبطال الكاش: ' + e.message);
      }
    }

    return result;
  });
}

function deleteHomework(id) {
  throw new Error('استخدم deleteHomeworkProtected مع token.');
}


// ═══════════════════════════════════════════════════════════════
//  دوال مساعدة لرقم الواجب التالي
// ═══════════════════════════════════════════════════════════════

function _getNextHomeworkId() {
  try {
    var sheet = _getSheet('الواجبات');
    if (!sheet) return 1;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return 1;
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues()
      .map(function(r) { return Number(r[0]); })
      .filter(function(n) { return !isNaN(n); });
    var max = ids.length > 0 ? Math.max.apply(null, ids) : 0;
    return isFinite(max) ? max + 1 : 1;
  } catch (e) {
    return 1;
  }
}
  // ══════════════════════════════════════════════════════
  //  الأخبار
  // ══════════════════════════════════════════════════════

  /**
   * الحصول على رقم خبر التالي
   */
  function _getNextNewsId() {
    try {
      var sheet = _getSheet('الاخبار');
      if (!sheet) return 1;
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return 1;
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r) { return Number(r[0]); });
      var max = Math.max.apply(null, ids.filter(function(n) { return !isNaN(n); }));
      return isFinite(max) ? max + 1 : 1;
    } catch (e) {
      return 1;
    }
  }

  /**
   * رفع ملف مرفق إلى Google Drive
   *
   * @param {string} base64Data - بيانات الملف base64
   * @param {string} fileName   - اسم الملف
   * @param {string} mimeType   - نوع الملف
   * @returns {string} رابط الملف أو رسالة خطأ
   */
function uploadFileToDrive(base64Data, fileName, mimeType) {
  try {
    if (!mimeType || mimeType === '') mimeType = 'image/png';
    if (!fileName || fileName === '') fileName = 'attachment_' + new Date().getTime() + '.png';
    if (!base64Data) throw new Error('بيانات الملف غير مكتملة: لا يوجد base64');

    var cleanBase64 = base64Data.indexOf('base64,') !== -1 ? base64Data.split('base64,')[1] : base64Data;
    var blob = Utilities.newBlob(Utilities.base64Decode(cleanBase64), mimeType, fileName);
    var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    var file = folder.createFile(blob);
    var fileId = file.getId();

    // ✅ بدون Drive.Permissions.insert – المجلد العام كافٍ
    Logger.log('✅ تم رفع الملف: ' + file.getUrl());

    return {
      webViewLink: file.getUrl(),
      directLink: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000',
      fileId: fileId
    };
  } catch (e) {
    Logger.log('uploadFileToDrive error: ' + e.toString());
    throw new Error('فشل رفع الملف: ' + e.message);
  }
}
  function convertOldAttachmentsToThumbnailLink() {
    var sheet = _getSheet('الاخبار');
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    var updated = 0;
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var attachment = _safeStr(row[5]);
      if (!attachment) continue;
      var fileId = extractDriveFileId(attachment);
      if (fileId) {
        var newLink = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000';
        sheet.getRange(i + 1, 6).setValue(newLink);
        updated++;
      }
    }
    Logger.log('تم تحديث ' + updated + ' رابط(ات) إلى صيغة thumbnail.');
  }

  /**
   * إضافة خبر جديد
   * أعمدة الاخبار: رقم الخبر | اسم المدرس | الفصل | الشعبة | الخبر | الملحقات | التاريخ
   */
  function _addNewsInternal(data) {
    try {
      if (!data)      throw new Error('بيانات الخبر غير موجودة');
      if (!data.news) throw new Error('نص الخبر مطلوب');

      var sheet = _getOrCreateSheet('الاخبار',
        ['رقم الخبر','اسم المدرس','الفصل','الشعبة','الخبر','الملحقات','التاريخ']);

      var attachmentUrl = '';

      // ① الأولوية: ملف جديد مُرفق (base64)
      if (data.attachment &&
          data.attachment.base64 &&
          data.attachment.fileName &&
          data.attachment.mimeType) {
        try {
          var uploadResult = uploadFileToDrive(
            data.attachment.base64,
            data.attachment.fileName,
            data.attachment.mimeType
          );
          // directLink = thumbnail?id=...&sz=w1000 ← يُحفظ مباشرة في الشيت
          attachmentUrl = uploadResult.directLink || '';
          Logger.log('News attachment uploaded: ' + attachmentUrl);
        } catch (uploadErr) {
          Logger.log('News attachment upload failed: ' + uploadErr.message);
          attachmentUrl = '';
        }
      }
      // ② إذا لم يكن هناك ملف لكن يوجد رابط موجود (تعديل خبر)
      else if (data.attachments && data.attachments.indexOf('http') === 0) {
        var existId = extractDriveFileId(data.attachments);  // من DriveUrlUtils.gs
        if (existId) {
          attachmentUrl = 'https://drive.google.com/thumbnail?id=' + existId + '&sz=w1000';
        } else {
          attachmentUrl = data.attachments;
        }
      }

      var newId   = _getNextNewsId();
      var dateStr = _safeStr(data.date) ||
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

      Logger.log('Saving news row: id=' + newId +
                ' | teacher=' + _safeStr(data.teacher) +
                ' | grade=' + _safeStr(data.grade) +
                ' | attachmentUrl=' + attachmentUrl);

      sheet.appendRow([
        newId,
        _safeStr(data.teacher),
        _safeStr(data.grade),
        _safeStr(data.section),
        _safeStr(data.news),
        attachmentUrl,   // ← العمود 6: الملحقات
        dateStr
      ]);

      return { success: true, message: 'تم إضافة الخبر بنجاح', id: newId };
    } catch (e) {
      Logger.log('_addNewsInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
  function addNewsProtected(params) {
  return withAuthAndClass(params, params.grade, params.section, function(session) {
    var newsData = {
      teacher    : session.teacherName,
      grade      : _safeStr(params.grade),
      section    : _safeStr(params.section),
      news       : _safeStr(params.news),
      date       : _safeStr(params.date),
      attachment : params.attachment || null,
      attachments: _safeStr(params.attachments)
    };

    if (!newsData.news)    return { success: false, error: 'نص الخبر مطلوب' };
    if (!newsData.grade)   return { success: false, error: 'الفصل مطلوب' };
    if (!newsData.section) return { success: false, error: 'الشعبة مطلوبة' };

    var result = _addNewsInternal(newsData);
    
    // ✅ إبطال كاش الأنشطة بعد إضافة خبر جديد
    if (result && result.success) {
      try {
        _tcInvalidateActivitiesCache(session.teacherName);
      } catch(e) {
        Logger.log('⚠️ فشل إبطال كاش الأنشطة: ' + e.message);
      }
    }
    
    return result;
  });
}
  function addNews(data) {
    throw new Error('استخدم addNewsProtected مع token.');
  }
  /**
   * جلب خبر بمعرفه
   */
  function getNews(id) {
    try {
      var sheet = _getSheet('الاخبار');
      if (!sheet) throw new Error('ورقة الاخبار غير موجودة');

      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (_safeStr(data[i][0]) == _safeStr(id)) {
          return {
            id          : _safeStr(data[i][0]),
            teacher     : _safeStr(data[i][1]),
            grade       : _safeStr(data[i][2]),
            section     : _safeStr(data[i][3]),
            news        : _safeStr(data[i][4]),
            attachments : _safeStr(data[i][5]),
            date        : _safeStr(data[i][6])
          };
        }
      }
      throw new Error('لم يتم العثور على الخبر بالمعرف: ' + id);
    } catch (e) {
      Logger.log('getNews error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  /**
   * تحديث خبر
   */
  function _updateNewsInternal(data) {
    try {
      var sheet = _getSheet('الاخبار');
      if (!sheet) return { success: false, error: 'ورقة الاخبار غير موجودة' };

      var rows = sheet.getDataRange().getValues();
      var targetRow = -1;
      for (var i = 1; i < rows.length; i++) {
        if (_safeStr(rows[i][0]) === _safeStr(data.id)) { targetRow = i + 1; break; }
      }
      if (targetRow === -1) return { success: false, error: 'الخبر غير موجود' };

      // الرابط الحالي في الشيت
      var currentAttach = _safeStr(rows[targetRow - 1][5]);
      var attachmentUrl = currentAttach;

      // رفع ملف جديد إن وُجد
      if (data.attachment &&
          data.attachment.base64 &&
          data.attachment.fileName &&
          data.attachment.mimeType) {
        try {
          var up = uploadFileToDrive(
            data.attachment.base64,
            data.attachment.fileName,
            data.attachment.mimeType
          );
          attachmentUrl = up.directLink || currentAttach;
        } catch (ue) {
          Logger.log('updateNews upload failed: ' + ue.message);
        }
      }
      // إذا أُرسل رابط بدون ملف جديد → تحويله لـ thumbnail
      else if (data.attachments && data.attachments.indexOf('http') === 0) {
        var eid = extractDriveFileId(data.attachments);
        attachmentUrl = eid
          ? 'https://drive.google.com/thumbnail?id=' + eid + '&sz=w1000'
          : data.attachments;
      }

      var dateStr = _safeStr(data.date) ||
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

      sheet.getRange(targetRow, 2, 1, 6).setValues([[
        _safeStr(data.teacher),
        _safeStr(data.grade),
        _safeStr(data.section),
        _safeStr(data.news),
        attachmentUrl,
        dateStr
      ]]);

      return { success: true, message: 'تم تحديث الخبر بنجاح' };
    } catch (e) {
      Logger.log('_updateNewsInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
  function updateNewsProtected(params) {
  return withAuth(params, function(session) {
    var id = params.id;
    var grade = params.grade;
    var section = params.section;

    if (!id) return { success: false, error: 'معرّف الخبر مطلوب' };
    if (!grade) return { success: false, error: 'الفصل مطلوب' };
    if (!section) return { success: false, error: 'الشعبة مطلوبة' };

    // جلب الخبر للتحقق من المالك
    var news = getNews(id);
    if (!news || news.success === false) {
      return { success: false, error: 'الخبر غير موجود' };
    }

    var isOwner = (news.teacher === session.teacherName);
    var isAdmin = (session.role === 'admin');
    var isDeputyOrSupervisor = (session.role === 'deputy' || session.role === 'supervisor');

    // التحقق من الوصول إلى الفصل إذا لم يكن مديراً / وكيلاً / مشرفاً
    if (!isAdmin && !isDeputyOrSupervisor) {
      var hasAll = session.classes && session.classes.indexOf('جميع الفصول') !== -1;
      if (!hasAll && session.classes && session.classes.indexOf(grade) === -1) {
        return { success: false, error: 'ليس لديك صلاحية تعديل هذا الخبر' };
      }
    }

    if (!isAdmin && !isOwner && !isDeputyOrSupervisor) {
      return { success: false, error: 'غير مصرح لك بتعديل هذا الخبر' };
    }

    var result = _updateNewsInternal({
      id: id,
      teacher: session.teacherName,
      grade: grade,
      section: section,
      news: params.news,
      date: params.date,
      attachment: params.attachment || null,
      attachments: params.attachments
    });

    if (result && result.success) {
      try {
        _tcInvalidateActivitiesCache(session.teacherName);
      } catch(e) {}
    }
    return result;
  });
}
  function updateNews(data) {
    throw new Error('استخدم updateNewsProtected مع token.');
  }

  /**
   * حذف خبر
   */
  function _deleteNewsInternal(id) {
    try {
      var sheet = _getSheet('الاخبار');
      if (!sheet) throw new Error('ورقة الاخبار غير موجودة');
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (_safeStr(data[i][0]) == _safeStr(id)) {
          sheet.deleteRow(i + 1);
          return { success: true, message: 'تم حذف الخبر بنجاح' };
        }
      }
      throw new Error('لم يتم العثور على الخبر');
    } catch (e) {
      Logger.log('_deleteNewsInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
 function deleteNewsProtected(params) {
  return withAuth(params, function(session) {
    var id = params.id;
    if (!id) return { success: false, error: 'معرّف الخبر مطلوب' };

    var news = getNews(id);
    if (!news || news.success === false) {
      return { success: false, error: 'الخبر غير موجود' };
    }

    var isOwner = (news.teacher === session.teacherName);
    var isAdmin = (session.role === 'admin');
    var isDeputyOrSupervisor = (session.role === 'deputy' || session.role === 'supervisor');

    if (!isAdmin && !isOwner && !isDeputyOrSupervisor) {
      return { success: false, error: 'غير مصرح لك بحذف هذا الخبر' };
    }

    var result = _deleteNewsInternal(id);
    if (result && result.success) {
      try {
        _tcInvalidateActivitiesCache(session.teacherName);
      } catch(e) {}
    }
    return result;
  });
}
  function deleteNews(id) {
    throw new Error('استخدم deleteNewsProtected مع token.');
  }

  // ══════════════════════════════════════════════════════
  //  المخالفات
  // ══════════════════════════════════════════════════════

  /**
   * التأكد من وجود ورقة المخالفات أو إنشاؤها
   */
  function _ensureViolationsSheet() {
    return _getOrCreateSheet('المخالفات',
      ['الكود', 'الاسم', 'الفصل', 'الشعبة', 'المخالفة', 'المدرس', 'التاريخ', 'الرد']);
  }
function _addViolationInternal(data) {
  try {
    if (!data) throw new Error('بيانات المخالفة غير موجودة');

    var studentRow = parseInt(data.studentRow);
    if (isNaN(studentRow) || studentRow < 2) {
      throw new Error('رقم صف الطالب غير صحيح');
    }
    if (!data.violation)   throw new Error('نوع المخالفة غير محدد');
    if (!data.teacherName) throw new Error('اسم المدرس غير محدد');

    var studentSheet = _getSheet('الطلاب');
    if (!studentSheet) throw new Error('ورقة الطلاب غير موجودة');

    var sData       = studentSheet.getRange(studentRow, 1, 1, 4).getValues()[0];
    var studentCode = _safeStr(sData[0]);
    var studentName = _safeStr(sData[1]);
    var grade       = _safeStr(sData[2]);
    var section     = _safeStr(sData[3]);

    if (!studentCode || !studentName) {
      throw new Error('بيانات الطالب غير صالحة في الصف المحدد');
    }

    var vSheet  = _ensureViolationsSheet();
    var dateStr = _nowString();
    var reply   = _safeStr(data.reply);

    // ★ بعد التوحيد: نكتب في ورقة المخالفات فقط (المصدر الوحيد للطالب)
    vSheet.appendRow([
      studentCode, studentName, grade, section,
      _safeStr(data.violation), _safeStr(data.teacherName),
      dateStr, reply
    ]);

    return { success: true, message: 'تم تسجيل المخالفة بنجاح' };
  } catch (e) {
    Logger.log('_addViolationInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}
  function addViolationProtected(params) {
    // نحتاج لمعرفة الفصل للتحقق
    var studentRow = parseInt(params.studentRow);
    var studentSheet = _getSheet('الطلاب');
    var studentGrade = '';
    var studentSection = '';
    if (studentSheet) {
      var studentData = studentSheet.getRange(studentRow, 1, 1, 4).getValues()[0];
      studentGrade = _safeStr(studentData[2]);
      studentSection = _safeStr(studentData[3]);
    }

    return withAuthAndClass({ token: params.token }, studentGrade, studentSection, function(session) {
      var result = _addViolationInternal(params);
      
      // ✅ إبطال كاش الأنشطة بعد إضافة مخالفة جديدة
      if (result && result.success) {
        try {
          _tcInvalidateActivitiesCache(session.teacherName);
        } catch(e) {
          Logger.log('⚠️ فشل إبطال كاش الأنشطة: ' + e.message);
        }
      }
      
      return result;
    });
  }
  function addViolation(data) {
    throw new Error('استخدم addViolationProtected مع token.');
  }
  /**
   * جلب كل المخالفات
   */
  // دالة داخلية
  function _getAllViolationsInternal() {
    try {
      var sheet = _getSheet('المخالفات');
      if (!sheet) return { success: true, violations: [] };

      var data       = sheet.getDataRange().getValues();
      var violations = [];

      for (var i = 1; i < data.length; i++) {
        var code = _safeStr(data[i][0]);
        var name = _safeStr(data[i][1]);
        if (!code && !name) continue;

        violations.push({
          rowIndex  : i + 1,
          code      : code,
          name      : name,
          grade     : _safeStr(data[i][2]),
          section   : _safeStr(data[i][3]),
          violation : _safeStr(data[i][4]),
          teacher   : _safeStr(data[i][5]),
          date      : _safeStr(data[i][6]),
          reply     : _safeStr(data[i][7])
        });
      }

      return { success: true, violations: violations };
    } catch (e) {
      Logger.log('_getAllViolationsInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  // دالة محمية للمدير
  function adminGetAllViolations(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) return { success: false, error: 'غير مصرح' };
      return _getAllViolationsInternal();
    });
  }

  // الدالة القديمة ترمي خطأ
  function getAllViolations() {
    throw new Error('استخدم adminGetAllViolations مع token.');
  }
  /**
   * جلب مخالفة واحدة برقم صفها
   */
  function getViolation(rowIndex) {
    try {
      rowIndex = parseInt(rowIndex);
      if (isNaN(rowIndex)) throw new Error('رقم الصف غير صالح');

      var sheet = _getSheet('المخالفات');
      if (!sheet) throw new Error('ورقة المخالفات غير موجودة');

      var row = sheet.getRange(rowIndex, 1, 1, 8).getValues()[0];
      return {
        code      : _safeStr(row[0]),
        name      : _safeStr(row[1]),
        grade     : _safeStr(row[2]),
        section   : _safeStr(row[3]),
        violation : _safeStr(row[4]),
        teacher   : _safeStr(row[5]),
        date      : _safeStr(row[6]),
        reply     : _safeStr(row[7])
      };
    } catch (e) {
      Logger.log('getViolation error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  /**
   * تحديث مخالفة
   */
  function _updateViolationInternal(data) {
    try {
      if (!data || !data.rowIndex) throw new Error('رقم الصف مطلوب');
      var ri = parseInt(data.rowIndex);
      var sheet = _getSheet('المخالفات');
      if (!sheet) throw new Error('ورقة المخالفات غير موجودة');
      sheet.getRange(ri, 1).setValue(_safeStr(data.code));
      sheet.getRange(ri, 2).setValue(_safeStr(data.name));
      sheet.getRange(ri, 3).setValue(_safeStr(data.grade));
      sheet.getRange(ri, 4).setValue(_safeStr(data.section));
      sheet.getRange(ri, 5).setValue(_safeStr(data.violation));
      sheet.getRange(ri, 6).setValue(_safeStr(data.teacher));
      sheet.getRange(ri, 7).setValue(_safeStr(data.date));
      sheet.getRange(ri, 8).setValue(_safeStr(data.reply));
      return { success: true, message: 'تم تحديث المخالفة بنجاح' };
    } catch (e) {
      Logger.log('_updateViolationInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
 function updateViolationProtected(params) {
  return withAuth(params, function(session) {
    var rowIndex = params.rowIndex;
    if (!rowIndex) return { success: false, error: 'رقم الصف مطلوب' };

    var violation = getViolation(rowIndex);
    if (!violation || violation.success === false) {
      return { success: false, error: 'المخالفة غير موجودة' };
    }

    var isOwner = (violation.teacher === session.teacherName);
    var isAdmin = (session.role === 'admin');
    var isDeputyOrSupervisor = (session.role === 'deputy' || session.role === 'supervisor');

    if (!isAdmin && !isOwner && !isDeputyOrSupervisor) {
      return { success: false, error: 'غير مصرح لك بتعديل هذه المخالفة' };
    }

    var result = _updateViolationInternal(params);
    if (result && result.success) {
      try {
        _tcInvalidateActivitiesCache(session.teacherName);
      } catch(e) {}
    }
    return result;
  });
}
  function updateViolation(data) {
    throw new Error('استخدم updateViolationProtected مع token.');
  }
  /**
   * حذف مخالفة
   */
  function _deleteViolationInternal(rowIndex) {
    try {
      rowIndex = parseInt(rowIndex);
      if (isNaN(rowIndex) || rowIndex < 2) throw new Error('رقم الصف غير صالح');
      var sheet = _getSheet('المخالفات');
      if (!sheet) throw new Error('ورقة المخالفات غير موجودة');
      sheet.deleteRow(rowIndex);
      return { success: true, message: 'تم حذف المخالفة بنجاح' };
    } catch (e) {
      Logger.log('_deleteViolationInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }

  function deleteViolationProtected(params) {
  return withAuth(params, function(session) {
    var rowIndex = params.rowIndex;
    if (!rowIndex) return { success: false, error: 'رقم الصف مطلوب' };

    var violation = getViolation(rowIndex);
    if (!violation || violation.success === false) {
      return { success: false, error: 'المخالفة غير موجودة' };
    }

    var isOwner = (violation.teacher === session.teacherName);
    var isAdmin = (session.role === 'admin');
    var isDeputyOrSupervisor = (session.role === 'deputy' || session.role === 'supervisor');

    if (!isAdmin && !isOwner && !isDeputyOrSupervisor) {
      return { success: false, error: 'غير مصرح لك بحذف هذه المخالفة' };
    }

    var result = _deleteViolationInternal(rowIndex);
    if (result && result.success) {
      try {
        _tcInvalidateActivitiesCache(session.teacherName);
      } catch(e) {}
    }
    return result;
  });
}
  function deleteViolation(rowIndex) {
    throw new Error('استخدم deleteViolationProtected مع token.');
  }
  // ═══════════════════════════════════════════════════════════════════════════
//  ملاحظات أولياء الأمور (تكامل مع منصة الطلاب)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * التأكد من وجود ورقة "الملاحظات" بالهيكل الصحيح (متوافقة مع منصة الطلاب)
 */
function _ensureParentNotesSheet() {
  return _getOrCreateSheet('الملاحظات', 
    ['الاسم', 'الفصل', 'الشعبة', 'اسم المدرس', 'الرسالة', 'التاريخ', 'الرد']);
}

/**
 * جلب ملاحظات أولياء الأمور (نسخة محمية)
 * تقرأ من ورقة "الملاحظات" التي تُستورد من ملف الطلاب
 */
function getParentNotesProtected(params) {
  return withAuth(params, function(session) {
    try {
      var sheet = _ensureParentNotesSheet();
      var data  = sheet.getDataRange().getValues();
      var notes = [];

      for (var i = 1; i < data.length; i++) {
        var row         = data[i];
        var studentName = _safeStr(row[0]);
        var grade       = _safeStr(row[1]);
        var section     = _safeStr(row[2]);
        var teacher     = _safeStr(row[3]);
        var message     = _safeStr(row[4]);
        var date        = _safeStr(row[5]);
        var reply       = _safeStr(row[6] || '');

        if (!studentName) continue;

        // تصفية حسب الصلاحيات
        if (!session.isAdmin) {
          var hasAllGrades = session.classes &&
            session.classes.indexOf('جميع الفصول') !== -1;
          if (!hasAllGrades) {
            if (!session.classes ||
                session.classes.indexOf(grade) === -1) continue;
          }
        }

        notes.push({
          id         : i + 1, // رقم الصف الحقيقي
          studentName: studentName,
          grade      : grade,
          section    : section,
          teacher    : teacher,
          message    : message,
          date       : date,
          reply      : reply
        });
      }

      notes.sort(function(a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });

      return { success: true, notes: notes };
    } catch (e) {
      Logger.log('getParentNotesProtected error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  });
}

/**
 * جلب ملاحظات أولياء الأمور للمعلم الحالي (تُستخدم في لوحة التحكم)
 * بدلاً من إعادة مصفوفة فارغة، تقرأ الورقة بالكامل وتُطبق فلاتر الصلاحيات
 */
/**
 * إضافة رد من المعلم على ملاحظة (اختياري)
 * @param {Object} params - { token, noteId, reply }
 */
function addNoteReplyProtected(params) {
  return withAuth(params, function(session) {
    try {
      var noteRowIndex = parseInt(params.noteId);
      if (isNaN(noteRowIndex) || noteRowIndex < 2) {
        return { success: false, error: 'معرّف الملاحظة غير صالح' };
      }

      var sheet = _getSheet('الملاحظات');
      if (!sheet) {
        return { success: false, error: 'ورقة الملاحظات غير موجودة' };
      }

      var reply = _safeStr(params.reply).trim();
      if (!reply) return { success: false, error: 'نص الرد مطلوب' };

      var lastRow = sheet.getLastRow();
      if (noteRowIndex > lastRow) {
        return { success: false, error: 'رقم الصف خارج النطاق' };
      }

      // التحقق من صلاحية المعلم
      if (!session.isAdmin) {
        var rowData  = sheet.getRange(noteRowIndex, 1, 1, 4).getValues()[0];
        var noteGrade = _safeStr(rowData[1]);
        var hasAll    = session.classes &&
          session.classes.indexOf('جميع الفصول') !== -1;
        if (!hasAll && session.classes &&
            session.classes.indexOf(noteGrade) === -1) {
          return { success: false, error: 'ليس لديك صلاحية الرد على هذه الملاحظة' };
        }
      }

      sheet.getRange(noteRowIndex, 7).setValue(reply);
      return { success: true, message: 'تم حفظ الرد بنجاح' };
    } catch (e) {
      Logger.log('addNoteReplyProtected error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  });
}

  // ══════════════════════════════════════════════════════
  //  جلب كل الأنشطة (للمدير)
  // ══════════════════════════════════════════════════════

  /**
   * جلب جميع الواجبات والأخبار والمخالفات دفعة واحدة للمدير
   */
  function _getAllActivitiesInternal() {
    try {
      var ss     = _getSS();
      var result = { homework: [], news: [], violations: [] };

      // الواجبات
      try {
        var hwSheet = ss.getSheetByName('الواجبات');
        if (hwSheet) {
          var hwData = hwSheet.getDataRange().getValues();
          for (var i = 1; i < hwData.length; i++) {
            if (!_safeStr(hwData[i][0])) continue;
            result.homework.push({
              id      : _safeStr(hwData[i][0]),
              teacher : _safeStr(hwData[i][1]),
              subject : _safeStr(hwData[i][2]),
              grade   : _safeStr(hwData[i][3]),
              section : _safeStr(hwData[i][4]),
              homework: _safeStr(hwData[i][5]),
              date    : _safeStr(hwData[i][6])
            });
          }
        }
      } catch (e) { Logger.log('_getAllActivitiesInternal homework error: ' + e); }

      // الأخبار
      try {
        var newsSheet = ss.getSheetByName('الاخبار');
        if (newsSheet) {
          var newsData = newsSheet.getDataRange().getValues();
          for (var j = 1; j < newsData.length; j++) {
            if (!_safeStr(newsData[j][0])) continue;
            result.news.push({
              id          : _safeStr(newsData[j][0]),
              teacher     : _safeStr(newsData[j][1]),
              grade       : _safeStr(newsData[j][2]),
              section     : _safeStr(newsData[j][3]),
              news        : _safeStr(newsData[j][4]),
              attachments : _safeStr(newsData[j][5]),
              date        : _safeStr(newsData[j][6])
            });
          }
        }
      } catch (e) { Logger.log('_getAllActivitiesInternal news error: ' + e); }

      // المخالفات
      try {
        var vioSheet = ss.getSheetByName('المخالفات');
        if (vioSheet) {
          var vioData = vioSheet.getDataRange().getValues();
          for (var k = 1; k < vioData.length; k++) {
            if (!_safeStr(vioData[k][0]) && !_safeStr(vioData[k][1])) continue;
            result.violations.push({
              rowIndex  : k + 1,
              code      : _safeStr(vioData[k][0]),
              name      : _safeStr(vioData[k][1]),
              grade     : _safeStr(vioData[k][2]),
              section   : _safeStr(vioData[k][3]),
              violation : _safeStr(vioData[k][4]),
              teacher   : _safeStr(vioData[k][5]),
              date      : _safeStr(vioData[k][6]),
              reply     : _safeStr(vioData[k][7])
            });
          }
        }
      } catch (e) { Logger.log('_getAllActivitiesInternal violations error: ' + e); }

      return { success: true, data: result };
    } catch (e) {
      Logger.log('_getAllActivitiesInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
  /**
   * جلب جميع الأنشطة (للمدير فقط)
   * @param {Object} params - { token }
   */
  function getAllActivitiesProtected(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) {
        return { success: false, error: 'غير مصرح - للمدير فقط' };
      }
      return _getAllActivitiesInternal();
    });
  }
  function getAllActivities() {
    throw new Error('استخدم getAllActivitiesProtected مع token.');
  }

  // ══════════════════════════════════════════════════════
  //  خدمات مساعدة إضافية
  // ══════════════════════════════════════════════════════

  /**
   * التحقق من صحة اتصال الملف (ping)
   */
  function pingServer() {
    try {
      _getSS();
      return { success: true, message: 'الخادم يعمل بشكل صحيح', timestamp: _nowString() };
    } catch (e) {
      return { success: false, error: e.toString() };
    }
  }

  /**
   * جلب إحصائيات سريعة للمدير
   */
  function getDashboardStats() {
    try {
      var ss          = _getSS();
      var studentsCount   = 0;
      var teachersCount   = 0;
      var homeworkCount   = 0;
      var violationsCount = 0;

      var studentsSheet = ss.getSheetByName('الطلاب');
      if (studentsSheet) {
        var lr = studentsSheet.getLastRow();
        studentsCount = lr > 1 ? lr - 1 : 0;
      }

      var teachersSheet = ss.getSheetByName('المدرسين');
      if (teachersSheet) {
        var tlr = teachersSheet.getLastRow();
        teachersCount = tlr > 1 ? tlr - 1 : 0;
      }

      var hwSheet = ss.getSheetByName('الواجبات');
      if (hwSheet) {
        var hlr = hwSheet.getLastRow();
        homeworkCount = hlr > 1 ? hlr - 1 : 0;
      }

      var vioSheet = ss.getSheetByName('المخالفات');
      if (vioSheet) {
        var vlr = vioSheet.getLastRow();
        violationsCount = vlr > 1 ? vlr - 1 : 0;
      }

      return {
        success         : true,
        studentsCount   : studentsCount,
        teachersCount   : teachersCount,
        homeworkCount   : homeworkCount,
        violationsCount : violationsCount
      };
    } catch (e) {
      Logger.log('getDashboardStats error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
  function _getDashboardStatsInternal() {
    try {
      var ss          = _getSS();
      var studentsCount   = 0;
      var teachersCount   = 0;
      var homeworkCount   = 0;
      var violationsCount = 0;

      var studentsSheet = ss.getSheetByName('الطلاب');
      if (studentsSheet) {
        var lr = studentsSheet.getLastRow();
        studentsCount = lr > 1 ? lr - 1 : 0;
      }

      var teachersSheet = ss.getSheetByName('المدرسين');
      if (teachersSheet) {
        var tlr = teachersSheet.getLastRow();
        teachersCount = tlr > 1 ? tlr - 1 : 0;
      }

      var hwSheet = ss.getSheetByName('الواجبات');
      if (hwSheet) {
        var hlr = hwSheet.getLastRow();
        homeworkCount = hlr > 1 ? hlr - 1 : 0;
      }

      var vioSheet = ss.getSheetByName('المخالفات');
      if (vioSheet) {
        var vlr = vioSheet.getLastRow();
        violationsCount = vlr > 1 ? vlr - 1 : 0;
      }

      return {
        success         : true,
        studentsCount   : studentsCount,
        teachersCount   : teachersCount,
        homeworkCount   : homeworkCount,
        violationsCount : violationsCount
      };
    } catch (e) {
      Logger.log('_getDashboardStatsInternal error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  }
  function getDashboardStatsProtected(params) {
    return withAuth(params, function(session) {
      if (!session.isAdmin) return { success: false, error: 'غير مصرح' };
      return _getDashboardStatsInternal();
    });
  }

  function _getMyActivitiesInternal(teacherName, classes, sections, subjects, isAdmin) {
    var homework   = [];
    var news       = [];
    var violations = [];

    var hasAllGrades = isAdmin ||
      (classes && classes.indexOf('جميع الفصول') !== -1);

    // --- الواجبات ---
    var hwSheet = _getSheet('الواجبات');
    if (hwSheet) {
      var hwData = hwSheet.getDataRange().getValues();
      for (var i = 1; i < hwData.length; i++) {
        var row       = hwData[i];
        var hwTeacher = _safeStr(row[1]);
        var hwGrade   = _safeStr(row[3]);
        var isOwner   = isAdmin || hwTeacher === teacherName;
        var gradeOk   = hasAllGrades ||
          (classes && classes.indexOf(hwGrade) !== -1);
        if (!isOwner && !gradeOk) continue;
        homework.push({
          id      : _safeStr(row[0]),
          teacher : hwTeacher,
          subject : _safeStr(row[2]),
          grade   : hwGrade,
          section : _safeStr(row[4]),
          homework: _safeStr(row[5]),
          date    : _safeStr(row[6])
        });
      }
    }

    // --- الأخبار ---
    var newsSheet = _getSheet('الاخبار');
    if (newsSheet) {
      var newsData = newsSheet.getDataRange().getValues();
      for (var j = 1; j < newsData.length; j++) {
        var row    = newsData[j];
        var nTeach = _safeStr(row[1]);
        var nGrade = _safeStr(row[2]);
        var isOwn  = isAdmin || nTeach === teacherName;
        var gOk    = hasAllGrades ||
          (classes && classes.indexOf(nGrade) !== -1);
        if (!isOwn && !gOk) continue;

        // تحويل رابط المرفق إلى thumbnail (اختياري، لا يؤثر على الترتيب)
        var rawAttach = _safeStr(row[5]);
        var thumbUrl  = '';
        if (rawAttach) {
          var fid = extractDriveFileId(rawAttach);
          if (fid) {
            thumbUrl = 'https://drive.google.com/thumbnail?id=' + fid + '&sz=w1000';
          } else {
            thumbUrl = rawAttach;
          }
        }

        news.push({
          id         : _safeStr(row[0]),
          teacher    : nTeach,
          grade      : nGrade,
          section    : _safeStr(row[3]),
          news       : _safeStr(row[4]),
          attachments: thumbUrl,
          date       : _safeStr(row[6])
        });
      }
    }

    // --- المخالفات ---
    var vioSheet = _getSheet('المخالفات');
    if (vioSheet) {
      var vioData = vioSheet.getDataRange().getValues();
      for (var k = 1; k < vioData.length; k++) {
        var row    = vioData[k];
        var vTeach = _safeStr(row[5]);
        var vGrade = _safeStr(row[2]);
        var isOwn2 = isAdmin || vTeach === teacherName;
        var gOk2   = hasAllGrades ||
          (classes && classes.indexOf(vGrade) !== -1);
        if (!isOwn2 && !gOk2) continue;
        violations.push({
          rowIndex  : k + 1,
          code      : _safeStr(row[0]),
          name      : _safeStr(row[1]),
          grade     : vGrade,
          section   : _safeStr(row[3]),
          violation : _safeStr(row[4]),
          teacher   : vTeach,
          date      : _safeStr(row[6]),
          reply     : _safeStr(row[7])
        });
      }
    }

    // ✅ ترتيب تنازلي حسب التاريخ (الأحدث أولاً)
    homework.sort(function(a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    news.sort(function(a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    violations.sort(function(a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });

    return { homework: homework, news: news, violations: violations };
}
function getMyActivitiesProtected(params) {
  return withAuth(params, function(session) {
    try {
      // مفتاح كاش فريد لكل معلم (المدير له مفتاح موحّد)
      var cacheKey = 'tc_activities_' + (session.role === 'admin' ? '__admin__' :
                     (session.teacherName || 'unknown').replace(/\s+/g, '_'));

      var cached = _tcCacheGet(cacheKey);
      if (cached) {
        return { success: true, data: cached, fromCache: true };
      }

      var result = _getMyActivitiesInternal(
        session.teacherName,
        session.classes  || [],
        session.sections || [],
        session.subjects || [],
        session.isAdmin  || false
      );

      // كاش 90 ثانية فقط (لأن المخالفات والواجبات تتغير كثيراً)
      _tcCacheSet(cacheKey, result, 90);
      return { success: true, data: result, fromCache: false };
    } catch (e) {
      Logger.log('getMyActivitiesProtected error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  });
}

// ── دالة مساعدة لإبطال الكاش بعد أي تعديل (واجب/مخالفة/خبر) ──
function _tcInvalidateActivitiesCache(teacherName) {
  try {
    if (teacherName) {
      _tcCacheDel('tc_activities_' + teacherName.replace(/\s+/g, '_'));
    }
    _tcCacheDel('tc_activities___admin__');
  } catch (e) {}
}
  function getTeacherNotesProtected(params) {
    return withAuth(params, function(session) {
      // مؤقتاً: لا توجد ورقة ملاحظات
      return { success: true, notes: [] };
    });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  //  إدارة الحجب المالي (للمدير فقط)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * جلب إعدادات الحجب الحالية
   * @param {Object} params - { token }
   */
  function getBlockSettings(params) {
    return withAuth(params, function(session) {
      if (session.role !== 'admin') return { success: false, error: 'غير مصرح — للمدير فقط' };
      
      var studentFile = _getSSById(_activeFileId());
      var sheet = studentFile.getSheetByName('الاعدادات');
      if (!sheet) {
        // إنشاء الورقة بالإعدادات الافتراضية
        sheet = studentFile.insertSheet('الاعدادات');
        sheet.getRange('A1:B1').setValues([['نسبة الحجب (%)', 'الاستثناءات (كود الطالب)']]);
        sheet.getRange('A2').setValue(0); // افتراضي: لا حجب
      }
      
      var data = sheet.getDataRange().getValues();
      var blockPercentage = data.length > 1 ? _safeFloat(data[1][0]) : 0;
      var exceptions = [];
      for (var i = 1; i < data.length; i++) {
        var ex = _safeStr(data[i][1]);
        if (ex) exceptions.push(ex);
      }
      
      return { success: true, blockPercentage: blockPercentage, exceptions: exceptions };
    });
  }

  /**
   * حفظ إعدادات الحجب
   * @param {Object} params - { token, blockPercentage, exceptions (مصفوفة) }
   */
  function saveBlockSettings(params) {
    return withAuth(params, function(session) {
      if (session.role !== 'admin') return { success: false, error: 'غير مصرح — للمدير فقط' };
      
      var percentage = _safeFloat(params.blockPercentage, 0);
      var exceptions = params.exceptions || [];
      
      Logger.log('saveBlockSettings: percentage=' + percentage + ', exceptions=' + JSON.stringify(exceptions));
      
      var studentFile = _getSSById(_activeFileId());
      var sheet = studentFile.getSheetByName('الاعدادات');
      if (!sheet) {
        sheet = studentFile.insertSheet('الاعدادات');
        sheet.getRange('A1:B1').setValues([['نسبة الحجب (%)', 'الاستثناءات (كود الطالب)']]);
      }
      
      // مسح البيانات القديمة (عدا الصف الأول)
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
      
      // كتابة النسبة
      sheet.getRange('A2').setValue(percentage);
      Logger.log('كتبت النسبة في A2: ' + percentage);
      
      // كتابة الاستثناءات
      for (var i = 0; i < exceptions.length; i++) {
        sheet.getRange(i + 2, 2).setValue(_safeStr(exceptions[i]));
      }
      
      return { success: true, message: 'تم حفظ إعدادات الحجب بنجاح' };
    });
  }
  /**
   * جلب ملخص مالي لجميع الطلاب (للمدير)
   * @param {Object} params - { token }
   */
  function getFinancialSummary(params) {
    return withAuth(params, function(session) {
      if (session.role !== 'admin') return { success: false, error: 'غير مصرح — للمدير فقط' };
      
      var studentFile = _getSSById(_activeFileId());
      var feesSheet = studentFile.getSheetByName('الرسوم');
      if (!feesSheet) return { success: false, error: 'ورقة الرسوم غير موجودة' };
      
      var data = feesSheet.getDataRange().getValues();
      var summary = [];
      for (var i = 1; i < data.length; i++) {
        var code = _safeStr(data[i][0]);
        var name = _safeStr(data[i][1]);
        var total = _safeFloat(data[i][2]);
        var paid = _safeFloat(data[i][3]);
        var pct = total > 0 ? (paid / total) * 100 : 100;
        summary.push({
          code: code, name: name, totalFees: total, paid: paid,
          percentage: Math.round(pct),
          isBelowThreshold: false // سيتم تحديثه لاحقاً
        });
      }
      return { success: true, summary: summary };
    });
  }
  /**
   * إلغاء حجب طالب (إضافته إلى قائمة الاستثناءات)
   * @param {Object} params - { token, studentCode }
   */
  function adminUnblockStudent(params) {
    return withAuth(params, function(session) {
      if (session.role !== 'admin') return { success: false, error: 'غير مصرح — للمدير فقط' };
      
      var studentCode = _safeStr(params.studentCode);
      if (!studentCode) return { success: false, error: 'كود الطالب مطلوب' };
      
      var studentFile = _getSSById(_activeFileId());
      var sheet = studentFile.getSheetByName('الاعدادات');
      
      if (!sheet) {
        sheet = studentFile.insertSheet('الاعدادات');
        sheet.getRange('A1:B1').setValues([['نسبة الحجب (%)', 'الاستثناءات (كود الطالب)']]);
        sheet.getRange('A2').setValue(0);
      }
      
      var data = sheet.getDataRange().getValues();
      var exceptions = [];
      for (var i = 1; i < data.length; i++) {
        var ex = _safeStr(data[i][1]);
        if (ex) exceptions.push(ex);
      }
      
      // إذا كان الطالب موجودًا بالفعل، لا نضيفه مرة أخرى
      if (exceptions.indexOf(studentCode) !== -1) {
        return { success: true, message: 'الطالب مستثنى بالفعل', alreadyExempt: true };
      }
      
      // إضافة الطالب إلى أول صف فارغ في العمود B
      var lastRow = sheet.getLastRow();
      var emptyRow = 2;
      for (var i = 2; i <= lastRow; i++) {
        if (!sheet.getRange(i, 2).getValue()) {
          emptyRow = i;
          break;
        }
      }
      if (emptyRow > lastRow) emptyRow = lastRow + 1;
      
      sheet.getRange(emptyRow, 2).setValue(studentCode);
      
      return { success: true, message: 'تم إلغاء حجب الطالب بنجاح', studentCode: studentCode };
    });
  }
  
  
  // ══════════════════════════════════════════════════════
  //  جدول المعلم الشخصي — يجلب حصصه من ورقة "الجدول" في ملف الطالب
  //  الورقة: الفصل | الشعبة | اليوم | الحصة | المادة | المعلم | القاعة
  // ══════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════
// getMyScheduleProtected — نسخة مُصلَحة (ES5)
// الإصلاح: المعلم العادي يرى حصصه فقط (حسب اسمه في عمود المعلم)
//           الوكيل/المدير/المشرف يرى الكل
// ══════════════════════════════════════════════════════
function getMyScheduleProtected(params) {
  return withAuth(params, function(session) {
    try {
      var studentFile = _getSSById(
        '1BPtHUMB8kdi2exbfPVaKoSOcjGGZrnbJANXPHnWTD_A'
      );
      var sheet = studentFile.getSheetByName('الجدول');

      if (!sheet || sheet.getLastRow() < 2) {
        return {
          success: false,
          error  : 'لم يتم رفع الجدول الدراسي بعد. ' +
                  'يرجى تشغيل مزامنة الجدول من أداة الحصص أولاً.'
        };
      }

      var data    = sheet.getDataRange().getValues();
      var results = [];
      var daySort = {
        'السبت': 1, 'الأحد': 2, 'الاثنين': 3, 'الثلاثاء': 4, 'الأربعاء': 5
      };

      // ──────────────────────────────────────────
      // تحديد وضع المستخدم
      // ──────────────────────────────────────────
      var isAdmin   = session.isAdmin || false;
      var role      = session.role    || 'teacher';

      // المدير والوكيل يرون الكل
      var viewAll = isAdmin || role === 'admin' || role === 'deputy';

      // اسم المعلم النظيف (بدون نقاط، مُقطَّع)
      var teacherName      = _safeStr(session.teacherName).trim();
      var teacherNameClean = teacherName.replace(/\./g, '').toLowerCase().trim();

      // فصول وشعب المعلم المسموح بها (للتحقق الإضافي)
      var allowedClasses   = session.classes   || [];
      var allowedSections  = session.sections  || [];
      var allowedSubjects  = session.subjects  || [];

      var hasAllClasses  = allowedClasses.indexOf('جميع الفصول') !== -1;
      var hasAllSections = allowedSections.indexOf('جميع الشعب') !== -1;
      var hasAllSubjects = allowedSubjects.indexOf('جميع المواد') !== -1;

      for (var i = 1; i < data.length; i++) {
        var grade   = _safeStr(data[i][0]);
        var section = _safeStr(data[i][1]);
        var day     = _safeStr(data[i][2]);
        var period  = _safeStr(data[i][3]);
        var subject = _safeStr(data[i][4]);
        var teacher = _safeStr(data[i][5]).trim();
        var room    = _safeStr(data[i][6]);

        // تجاهل الصفوف غير المكتملة
        if (!grade || !day || !subject) continue;

        var teacherClean = teacher.replace(/\./g, '').toLowerCase().trim();

        var showRow = false;

        if (viewAll) {
          // ── المدير والوكيل: يرون كل الجدول ──
          showRow = true;

        } else {
          // ── المعلم العادي والمشرف: الشرط الأساسي هو تطابق الاسم ──
          // المبدأ: إذا كان اسمك في عمود المعلم → هذه حصتك
          var nameMatch = (teacherClean !== '' && teacherClean === teacherNameClean);

          if (nameMatch) {
            showRow = true;
          } else if (!nameMatch && !hasAllClasses) {
            // المعلم لا يرى حصص معلمين آخرين
            showRow = false;
          } else if (hasAllClasses && !hasAllSubjects) {
            // مشرف بصلاحية "جميع الفصول" لكن مواد محددة
            // يرى فقط حصص مادته في أي فصل
            showRow = hasAllSubjects || allowedSubjects.indexOf(subject) !== -1;
          }
        }

        // ── تحقق إضافي من الشعبة (للمعلم العادي فقط) ──
        if (showRow && !viewAll && !hasAllSections) {
          if (allowedSections.length > 0 &&
              allowedSections.indexOf(section) === -1 &&
              section !== 'جميع الشعب') {
            showRow = false;
          }
        }

        if (showRow) {
          results.push({
            grade  : grade,
            section: section,
            day    : day,
            period : period,
            subject: subject,
            teacher: teacher,
            room   : room
          });
        }
      }

      // ترتيب: اليوم ثم رقم الحصة
      results.sort(function(a, b) {
        var da = daySort[a.day] || 9;
        var db = daySort[b.day] || 9;
        if (da !== db) return da - db;
        return parseInt(a.period || 0, 10) - parseInt(b.period || 0, 10);
      });

      Logger.log('getMyScheduleProtected: ' + session.teacherName +
                 ' | role=' + role + ' | viewAll=' + viewAll +
                 ' | نتيجة=' + results.length + ' حصة');

      return { success: true, schedule: results, total: results.length };

    } catch (e) {
      Logger.log('getMyScheduleProtected error: ' + e.toString());
      return { success: false, error: 'خطأ في جلب الجدول: ' + e.message };
    }
  });
}

// ════════════════════════════════════════════════════════════════════
//  ⏰ المرحلة 1: إعدادات تواقيت الجدول + الجدول اليومي اللحظي  (ES5, append)
// ════════════════════════════════════════════════════════════════════

var SCHED_SETTINGS_SHEET = 'اعدادات_الجدول';
var SCHED_BREAKS_SHEET   = 'استراحات_الصفوف';
var SCHED_DEFAULTS = {
  day_start: '07:00', assembly_minutes: 15, period_minutes: 45,
  break_minutes: 25, periods_count: 7
};
var SCHED_DAY_BY_ISO = { 1: 'الاثنين', 2: 'الثلاثاء', 3: 'الأربعاء', 4: 'الخميس', 5: 'الجمعة', 6: 'السبت', 7: 'الأحد' };

// "HH:MM" → دقائق منذ منتصف الليل
function _tcParseHHMM(s) {
  s = _safeStr(s);
  var m = s.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return 0;
  var h = parseInt(m[1], 10) || 0, mn = parseInt(m[2], 10) || 0;
  return (h * 60 + mn);
}
// دقائق → "HH:MM" (24h)
function _tcFmtMin(min) {
  min = Math.max(0, Math.round(min));
  var h = Math.floor(min / 60) % 24, mn = min % 60;
  return (h < 10 ? '0' + h : '' + h) + ':' + (mn < 10 ? '0' + mn : '' + mn);
}
// دقائق → عرض عربي 12 ساعة (مثال: 1:05 م)
function _tcMinToDisplay(min) {
  min = Math.max(0, Math.round(min));
  var h = Math.floor(min / 60) % 24, mn = min % 60;
  var ampm = (h < 12) ? 'ص' : 'م';
  var h12 = ((h + 11) % 12) + 1;
  return h12 + ':' + (mn < 10 ? '0' + mn : '' + mn) + ' ' + ampm;
}

// وقت الخادم الحالي: اسم اليوم + الدقائق + HH:MM
function _tcNowInfo() {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var iso = parseInt(Utilities.formatDate(now, tz, 'u'), 10); // 1=الاثنين..7=الأحد
  var hhmm = Utilities.formatDate(now, tz, 'HH:mm');
  return { dayName: SCHED_DAY_BY_ISO[iso] || '', minutes: _tcParseHHMM(hhmm), hhmm: hhmm };
}

// قراءة الإعدادات (تنشئ الأوراق بقيم افتراضية إن غابت)
function getScheduleSettingsProtected(params) {
  return withAuth(params, function (session) {
    return _tcGetScheduleSettings();
  });
}
function _tcGetScheduleSettings() {
  var cached = _tcCacheGet('tc_sched_settings');
  if (cached) return cached;
  try {
    var ss = _getSS();
    // الإعدادات العامة (مفتاح/قيمة)
    var setSheet = ss.getSheetByName(SCHED_SETTINGS_SHEET);
    if (!setSheet) {
      setSheet = ss.insertSheet(SCHED_SETTINGS_SHEET);
      setSheet.appendRow(['المفتاح', 'القيمة']);
      var keys = ['day_start', 'assembly_minutes', 'period_minutes', 'break_minutes', 'periods_count'];
      for (var k = 0; k < keys.length; k++) setSheet.appendRow([keys[k], SCHED_DEFAULTS[keys[k]]]);
      setSheet.setFrozenRows(1);
    }
    var sv = {};
    var sd = setSheet.getDataRange().getValues();
    for (var i = 1; i < sd.length; i++) {
      var key = _safeStr(sd[i][0]); if (key) sv[key] = _safeStr(sd[i][1]);
    }
    var settings = {
      dayStart:       sv.day_start || SCHED_DEFAULTS.day_start,
      assemblyMinutes: _safeFloat(sv.assembly_minutes) || SCHED_DEFAULTS.assembly_minutes,
      periodMinutes:  _safeFloat(sv.period_minutes) || SCHED_DEFAULTS.period_minutes,
      breakMinutes:   _safeFloat(sv.break_minutes) || SCHED_DEFAULTS.break_minutes,
      periodsCount:   _safeFloat(sv.periods_count) || SCHED_DEFAULTS.periods_count
    };
    // استراحات الصفوف
    var brSheet = ss.getSheetByName(SCHED_BREAKS_SHEET);
    if (!brSheet) {
      brSheet = ss.insertSheet(SCHED_BREAKS_SHEET);
      brSheet.appendRow(['الصف', 'بعد_الحصة']);
      brSheet.setFrozenRows(1);
    }
    var breaksByGrade = {};
    var bd = brSheet.getDataRange().getValues();
    for (var j = 1; j < bd.length; j++) {
      var g = _safeStr(bd[j][0]); if (g) breaksByGrade[g] = _safeFloat(bd[j][1]) || 2;
    }
    var result = { success: true, settings: settings, breaksByGrade: breaksByGrade };
    _tcCacheSet('tc_sched_settings', result, 300);
    return result;
  } catch (e) {
    return { success: true, settings: {
      dayStart: SCHED_DEFAULTS.day_start, assemblyMinutes: SCHED_DEFAULTS.assembly_minutes,
      periodMinutes: SCHED_DEFAULTS.period_minutes, breakMinutes: SCHED_DEFAULTS.break_minutes,
      periodsCount: SCHED_DEFAULTS.periods_count
    }, breaksByGrade: {} };
  }
}

// حفظ الإعدادات — للمدير/الوكيل فقط
function saveScheduleSettingsProtected(params) {
  return withAuth(params, function (session) {
    var role = _safeStr(session.role);
    // المدير/الوكيل/المحاسب فقط (المشرف لديه isAdmin=true لكنه لا يضبط الإعدادات)
    if (!(role === 'admin' || role === 'deputy' || role === 'accountant')) {
      return { success: false, error: 'غير مصرح — للمدير أو الوكيل فقط' };
    }
    try {
      var ss = _getSS();
      var st = params.settings || {};
      var setSheet = ss.getSheetByName(SCHED_SETTINGS_SHEET) || ss.insertSheet(SCHED_SETTINGS_SHEET);
      setSheet.clear();
      setSheet.appendRow(['المفتاح', 'القيمة']);
      setSheet.appendRow(['day_start', _safeStr(st.dayStart) || SCHED_DEFAULTS.day_start]);
      setSheet.appendRow(['assembly_minutes', _safeFloat(st.assemblyMinutes) || SCHED_DEFAULTS.assembly_minutes]);
      setSheet.appendRow(['period_minutes', _safeFloat(st.periodMinutes) || SCHED_DEFAULTS.period_minutes]);
      setSheet.appendRow(['break_minutes', (st.breakMinutes === 0 || st.breakMinutes) ? _safeFloat(st.breakMinutes) : SCHED_DEFAULTS.break_minutes]);
      setSheet.appendRow(['periods_count', _safeFloat(st.periodsCount) || SCHED_DEFAULTS.periods_count]);
      setSheet.setFrozenRows(1);

      var breaks = params.breaksByGrade || {};
      var brSheet = ss.getSheetByName(SCHED_BREAKS_SHEET) || ss.insertSheet(SCHED_BREAKS_SHEET);
      brSheet.clear();
      brSheet.appendRow(['الصف', 'بعد_الحصة']);
      for (var g in breaks) {
        if (breaks.hasOwnProperty(g) && g) brSheet.appendRow([g, _safeFloat(breaks[g]) || 2]);
      }
      brSheet.setFrozenRows(1);

      SpreadsheetApp.flush();
      _tcCacheDel('tc_sched_settings');
      return { success: true, message: 'تم حفظ إعدادات الجدول بنجاح' };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  });
}

// يبني مواقيت الحصص لصف معيّن: {assembly:{start,end}, slots:[{period,start,end,startMin,endMin,isBreak}]}
function _tcComputePeriodTimes(settings, grade, breaksByGrade) {
  var startMin = _tcParseHHMM(settings.dayStart);
  var cursor = startMin;
  var assembly = null;
  if (settings.assemblyMinutes > 0) {
    assembly = { startMin: cursor, endMin: cursor + settings.assemblyMinutes };
    cursor += settings.assemblyMinutes;
  }
  var breakAfter = (breaksByGrade && breaksByGrade[grade]) ? breaksByGrade[grade] : 0;
  var slots = [];
  for (var p = 1; p <= settings.periodsCount; p++) {
    var s = cursor, e = cursor + settings.periodMinutes;
    slots.push({ period: p, startMin: s, endMin: e, isBreak: false });
    cursor = e;
    if (breakAfter && p === breakAfter && settings.breakMinutes > 0) {
      slots.push({ period: 0, startMin: cursor, endMin: cursor + settings.breakMinutes, isBreak: true });
      cursor += settings.breakMinutes;
    }
  }
  return { assembly: assembly, slots: slots };
}

// الجدول اليومي اللحظي للمعلم الحالي
function getMyDayScheduleProtected(params) {
  return withAuth(params, function (session) {
    try {
      var info = _tcNowInfo();
      var isWeekend = (info.dayName === 'الخميس' || info.dayName === 'الجمعة');

      var setRes = _tcGetScheduleSettings();
      var settings = setRes.settings;
      var breaksByGrade = setRes.breaksByGrade || {};

      var assemblyOut = null;
      // الطابور يُحسب من إعدادات صف عام (نفس لكل الصفوف)
      if (settings.assemblyMinutes > 0) {
        var aStart = _tcParseHHMM(settings.dayStart);
        assemblyOut = { startMin: aStart, endMin: aStart + settings.assemblyMinutes,
                        start: _tcMinToDisplay(aStart), end: _tcMinToDisplay(aStart + settings.assemblyMinutes) };
      }

      if (isWeekend) {
        return { success: true, today: info.dayName, isWeekend: true, serverTime: info.hhmm,
                 serverMinutes: info.minutes, assembly: assemblyOut, periods: [] };
      }

      // إعادة استخدام منطق الفلترة الكامل
      var sch = getMyScheduleProtected(params);
      var rows = [];
      var allRows = (sch && sch.success && sch.schedule) ? sch.schedule : [];
      for (var ri = 0; ri < allRows.length; ri++) {
        if (_safeStr(allRows[ri].day) === info.dayName) rows.push(allRows[ri]);
      }

      function _statusOf(startMin, endMin) {
        if (startMin < 0) return 'upcoming';
        if (info.minutes >= endMin) return 'past';
        if (info.minutes >= startMin && info.minutes < endMin) return 'current';
        return 'upcoming';
      }

      // تحديد الصفوف التي يدرّس فيها المعلم الحصة الأولى (للطابور) أو السابعة (للنزول)
      var hasFirstByClass = {};
      for (var li = 0; li < rows.length; li++) {
        var pn = parseInt(rows[li].period, 10) || 0;
        if (pn === 1) {
          var key = _safeStr(rows[li].grade) + '|' + _safeStr(rows[li].section);
          hasFirstByClass[key] = true;
        }
      }

      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var pNum = parseInt(r.period, 10) || 0;
        var times = _tcComputePeriodTimes(settings, r.grade, breaksByGrade);
        var slot = null;
        for (var sI = 0; sI < times.slots.length; sI++) {
          if (!times.slots[sI].isBreak && times.slots[sI].period === pNum) { slot = times.slots[sI]; break; }
        }
        var startMin = slot ? slot.startMin : -1;
        var endMin = slot ? slot.endMin : -1;
        out.push({
          kind: 'period', period: pNum, title: _safeStr(r.subject), subject: r.subject,
          grade: r.grade, section: r.section, room: r.room,
          startMin: startMin, endMin: endMin,
          start: (startMin >= 0 ? _tcMinToDisplay(startMin) : ''),
          end: (endMin >= 0 ? _tcMinToDisplay(endMin) : ''),
          status: _statusOf(startMin, endMin)
        });
      }

      // ── المهام الروتينية التلقائية (مشتقة من الجدول، بلا حفظ) ──
      var duties = [];
      var assemblyStart = assemblyOut ? assemblyOut.startMin : _tcParseHHMM(settings.dayStart);
      var assemblyEnd = assemblyOut ? assemblyOut.endMin : assemblyStart;
      var firstClasses = [];
      for (var fk in hasFirstByClass) { if (hasFirstByClass.hasOwnProperty(fk)) firstClasses.push(fk.replace('|', ' ')); }
      if (firstClasses.length) {
        duties.push({
          kind: 'duty', dutyType: 'assembly', title: 'إشراف طابور الصباح',
          grade: firstClasses.join('، '), section: '',
          startMin: assemblyStart, endMin: assemblyEnd,
          start: _tcMinToDisplay(assemblyStart), end: _tcMinToDisplay(assemblyEnd),
          status: _statusOf(assemblyStart, assemblyEnd), auto: true
        });
      }
      // إشراف نزول الطلاب: للمعلم الذي يدرّس الحصة السابعة فقط
      for (var di = 0; di < rows.length; di++) {
        var rr = rows[di];
        var pnn = parseInt(rr.period, 10) || 0;
        if (pnn === 7) {
          var t2 = _tcComputePeriodTimes(settings, rr.grade, breaksByGrade);
          var sl2 = null;
          for (var s2 = 0; s2 < t2.slots.length; s2++) { if (!t2.slots[s2].isBreak && t2.slots[s2].period === 7) { sl2 = t2.slots[s2]; break; } }
          if (sl2) {
            duties.push({
              kind: 'duty', dutyType: 'dismissal', title: 'إشراف نزول الطلاب',
              grade: rr.grade, section: rr.section,
              startMin: sl2.endMin, endMin: sl2.endMin + 10,
              start: _tcMinToDisplay(sl2.endMin), end: _tcMinToDisplay(sl2.endMin + 10),
              status: _statusOf(sl2.endMin, sl2.endMin + 10), auto: true
            });
          }
        }
      }

      // ── مهام اليوم الفعلية المسندة (من ورقة المهام) ──
      var todayTasks = [];
      try {
        var tSheet = _tcTasksSheet();
        var tlr = tSheet.getLastRow();
        if (tlr >= 2) {
          var tdata = tSheet.getRange(2, 1, tlr - 1, TASK_HEADERS.length).getValues();
          var meName = _safeStr(session.teacherName);
          var todayISO = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
          for (var ti = 0; ti < tdata.length; ti++) {
            var to = _tcTaskRowToObj(tdata[ti]);
            if (!to.id || to.teacher !== meName) continue;
            if (to.date && to.date !== todayISO) continue;
            var tmin = to.time ? _tcParseHHMM(to.time) : -1;
            todayTasks.push({
              kind: 'task', id: to.id, title: to.type, description: to.description,
              grade: to.grade, section: to.section, status: to.status,
              startMin: tmin, endMin: (tmin >= 0 ? tmin + 30 : -1),
              start: (tmin >= 0 ? _tcMinToDisplay(tmin) : ''), end: ''
            });
          }
        }
      } catch (eT) {}

      // الخط الزمني الموحّد مرتّب بالوقت
      var timeline = out.concat(duties).concat(todayTasks);
      timeline.sort(function (a, b) {
        var av = (a.startMin < 0) ? 99999 : a.startMin, bv = (b.startMin < 0) ? 99999 : b.startMin;
        return av - bv;
      });

      return { success: true, today: info.dayName, isWeekend: false, serverTime: info.hhmm,
               serverMinutes: info.minutes, assembly: assemblyOut, periods: out,
               duties: duties, tasks: todayTasks, timeline: timeline };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  });
}

// ════════════════════════════════════════════════════════════════════
//  📌 المرحلة 2: المهام والإشراف + المتابعة والتأكيد + الخصومات (ES5, append)
//  ورقة «المهام»: id|المعلم|النوع|الصف|الشعبة|التاريخ|الوقت|الوصف|الحالة|
//                 الرسم|الخصم|المكلّف_بواسطة|المؤكّد_بواسطة|تاريخ_الإنشاء|ملاحظات
//  تعيين: مدير/وكيل/مشرف/أنشطة — قيمة الرسوم: محاسب (والمدير) — التأكيد/الخصم: مدير/وكيل/مشرف
// ════════════════════════════════════════════════════════════════════

var TASKS_SHEET = 'المهام';
var TASK_HEADERS = ['id', 'المعلم', 'النوع', 'الصف', 'الشعبة', 'التاريخ', 'الوقت', 'الوصف',
                    'الحالة', 'الرسم', 'الخصم', 'المكلّف_بواسطة', 'المؤكّد_بواسطة', 'تاريخ_الإنشاء', 'ملاحظات'];
var TASK_TYPES = ['إشراف طابور', 'إشراف ساحة', 'الطلوع مع الطلاب للصف', 'دوري كرة قدم',
                  'حصة ريادة', 'حصة تقوية', 'تغطية حصة غياب', 'مهمة أخرى'];
var TASK_STATUS = { ASSIGNED: 'مكلّف', DONE: 'منفّذ', CONFIRMED: 'مؤكّد', LATE: 'متأخر', MISSED: 'لم يُنفّذ' };

function _tcTasksSheet() {
  return _getOrCreateSheet(TASKS_SHEET, TASK_HEADERS);
}
function _tcIsActivities(session) {
  var subs = session.subjects || [];
  for (var i = 0; i < subs.length; i++) {
    var s = _safeStr(subs[i]);
    if (s === 'الأنشطة' || s === 'نشاط' || s.indexOf('نشاط') > -1 || s.indexOf('الأنشطة') > -1) return true;
  }
  return false;
}
function _tcCanManageTasks(session) {
  var r = _safeStr(session.role);
  return (r === 'admin' || r === 'deputy' || r === 'supervisor' || r === 'accountant' || _tcIsActivities(session));
}
function _tcCanSetFee(session) {
  var r = _safeStr(session.role);
  return (r === 'admin' || r === 'accountant');
}
// يحوّل قيمة خلية وقت إلى "HH:mm" — يعالج كائنات Date (يمنع "00:00:00 GMT")
function _tcTimeCell(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  }
  var s = _safeStr(v).trim();
  var hm = s.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (hm) { var h = ('0' + hm[1]).slice(-2); return h + ':' + hm[2]; }
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'HH:mm');
  return s;
}

function _tcTaskRowToObj(row) {
  return {
    id: _safeStr(row[0]), teacher: _safeStr(row[1]), type: _safeStr(row[2]),
    grade: _safeStr(row[3]), section: _safeStr(row[4]), date: _tcDateCell(row[5]),
    time: _tcTimeCell(row[6]), description: _safeStr(row[7]), status: _safeStr(row[8]) || TASK_STATUS.ASSIGNED,
    fee: _safeFloat(row[9]), deduction: _safeFloat(row[10]), createdBy: _safeStr(row[11]),
    confirmedBy: _safeStr(row[12]), createdAt: _tcDateCell(row[13]), notes: _safeStr(row[14])
  };
}
function _tcFindTaskRow(sheet, id) {
  var lr = sheet.getLastRow();
  if (lr < 2) return -1;
  var ids = sheet.getRange(2, 1, lr - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) { if (_safeStr(ids[i][0]) === _safeStr(id)) return i + 2; }
  return -1;
}

function getTaskTypesProtected(params) {
  return withAuth(params, function () { return { success: true, types: TASK_TYPES }; });
}

// إضافة مهمة (تعيين) — مدير/وكيل/مشرف/أنشطة
function addTaskProtected(params) {
  return withAuth(params, function (session) {
    if (!_tcCanManageTasks(session)) return { success: false, error: 'غير مصرح بتعيين المهام' };
    var teacher = _safeStr(params.teacher);
    var type = _safeStr(params.type);
    if (!teacher) return { success: false, error: 'اسم المعلم مطلوب' };
    if (!type) return { success: false, error: 'نوع المهمة مطلوب' };
    var sheet = _tcTasksSheet();
    var id = 'T' + (new Date().getTime());
    var now = new Date().toISOString();
    sheet.appendRow([
      id, teacher, type, _safeStr(params.grade), _safeStr(params.section),
      _safeStr(params.date), _safeStr(params.time), _safeStr(params.description),
      TASK_STATUS.ASSIGNED, _safeFloat(params.fee), 0, _safeStr(session.teacherName), '',
      now, _safeStr(params.notes)
    ]);
    SpreadsheetApp.flush();
    _tcCacheDel('tc_tasks_all');
    return { success: true, id: id, message: 'تم تعيين المهمة بنجاح' };
  });
}

// مهام المعلم الحالي
function getMyTasksProtected(params) {
  return withAuth(params, function (session) {
    try {
      var sheet = _tcTasksSheet();
      var lr = sheet.getLastRow();
      if (lr < 2) return { success: true, tasks: [] };
      var data = sheet.getRange(2, 1, lr - 1, TASK_HEADERS.length).getValues();
      var me = _safeStr(session.teacherName);
      var tz = Session.getScriptTimeZone();
      var nowD = new Date();
      var todayISO = Utilities.formatDate(nowD, tz, 'yyyy-MM-dd');
      var nowMin = _tcParseHHMM(Utilities.formatDate(nowD, tz, 'HH:mm'));
      var out = [];
      for (var i = 0; i < data.length; i++) {
        var o = _tcTaskRowToObj(data[i]);
        if (!o.id || o.teacher !== me) continue;
        // ── إنجاز تلقائي: مهمة «مكلّف» انتهى وقتها بلا تدخّل من المشرف → «منفّذ» تلقائياً ──
        if (o.status === TASK_STATUS.ASSIGNED && o.date) {
          var passed = (o.date < todayISO) || (o.date === todayISO && o.time && _tcParseHHMM(o.time) + 40 < nowMin);
          if (passed) {
            try {
              sheet.getRange(i + 2, 9).setValue(TASK_STATUS.DONE);
              var prevNote = o.notes ? (o.notes + ' • ') : '';
              sheet.getRange(i + 2, 15).setValue(prevNote + 'إنجاز تلقائي (انتهى الوقت بلا ملاحظة)');
              o.status = TASK_STATUS.DONE; o.notes = prevNote + 'إنجاز تلقائي (انتهى الوقت بلا ملاحظة)'; o.auto = true;
            } catch (eA) {}
          }
        }
        out.push(o);
      }
      out.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      return { success: true, tasks: out };
    } catch (e) { return { success: false, error: String((e && e.message) || e) }; }
  });
}

// كل المهام (للإدارة) مع فلاتر اختيارية
function getTasksProtected(params) {
  return withAuth(params, function (session) {
    if (!_tcCanManageTasks(session)) return { success: false, error: 'غير مصرح' };
    try {
      var sheet = _tcTasksSheet();
      var lr = sheet.getLastRow();
      if (lr < 2) return { success: true, tasks: [], canSetFee: _tcCanSetFee(session) };
      var data = sheet.getRange(2, 1, lr - 1, TASK_HEADERS.length).getValues();
      var fT = _safeStr(params.teacher), fS = _safeStr(params.status), fG = _safeStr(params.grade);
      var out = [];
      for (var i = 0; i < data.length; i++) {
        var o = _tcTaskRowToObj(data[i]);
        if (!o.id) continue;
        if (fT && o.teacher !== fT) continue;
        if (fS && o.status !== fS) continue;
        if (fG && o.grade !== fG) continue;
        out.push(o);
      }
      out.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
      return { success: true, tasks: out, canSetFee: _tcCanSetFee(session) };
    } catch (e) { return { success: false, error: String((e && e.message) || e) }; }
  });
}

// تحديث حالة المهمة (تنفيذ/تأكيد/تأخر/عدم تنفيذ) + خصم اختياري
function updateTaskStatusProtected(params) {
  return withAuth(params, function (session) {
    var id = _safeStr(params.id);
    var status = _safeStr(params.status);
    if (!id || !status) return { success: false, error: 'بيانات ناقصة' };
    var sheet = _tcTasksSheet();
    var row = _tcFindTaskRow(sheet, id);
    if (row === -1) return { success: false, error: 'المهمة غير موجودة' };

    var cur = _tcTaskRowToObj(sheet.getRange(row, 1, 1, TASK_HEADERS.length).getValues()[0]);
    var isManager = _tcCanManageTasks(session);
    var isOwner = (cur.teacher === _safeStr(session.teacherName));

    // المعلم: يضع «منفّذ» على مهمته فقط
    if (status === TASK_STATUS.DONE) {
      if (!isOwner && !isManager) return { success: false, error: 'غير مصرح' };
    } else {
      // باقي الحالات (تأكيد/تأخر/عدم تنفيذ): للإدارة فقط
      if (!isManager) return { success: false, error: 'غير مصرح — للإدارة فقط' };
    }

    sheet.getRange(row, 9).setValue(status); // الحالة
    // الخصم (اختياري، للإدارة فقط)
    if (isManager && (params.deduction === 0 || params.deduction)) {
      sheet.getRange(row, 11).setValue(_safeFloat(params.deduction));
    }
    if (isManager && status !== TASK_STATUS.DONE) {
      sheet.getRange(row, 13).setValue(_safeStr(session.teacherName)); // المؤكّد بواسطة
    }
    if (params.notes !== undefined) sheet.getRange(row, 15).setValue(_safeStr(params.notes));
    SpreadsheetApp.flush();
    _tcCacheDel('tc_tasks_all');
    return { success: true, message: 'تم تحديث حالة المهمة' };
  });
}

// تحديد قيمة الرسم — المدير/المحاسب فقط
function setTaskFeeProtected(params) {
  return withAuth(params, function (session) {
    if (!_tcCanSetFee(session)) return { success: false, error: 'غير مصرح — للمحاسب أو المدير فقط' };
    var id = _safeStr(params.id);
    var sheet = _tcTasksSheet();
    var row = _tcFindTaskRow(sheet, id);
    if (row === -1) return { success: false, error: 'المهمة غير موجودة' };
    sheet.getRange(row, 10).setValue(_safeFloat(params.fee));        // الرسم
    if (params.deduction === 0 || params.deduction) sheet.getRange(row, 11).setValue(_safeFloat(params.deduction));
    SpreadsheetApp.flush();
    _tcCacheDel('tc_tasks_all');
    return { success: true, message: 'تم تحديث القيمة المالية' };
  });
}

// حذف مهمة — للإدارة
function deleteTaskProtected(params) {
  return withAuth(params, function (session) {
    if (!_tcCanManageTasks(session)) return { success: false, error: 'غير مصرح' };
    var sheet = _tcTasksSheet();
    var row = _tcFindTaskRow(sheet, _safeStr(params.id));
    if (row === -1) return { success: false, error: 'المهمة غير موجودة' };
    sheet.deleteRow(row);
    SpreadsheetApp.flush();
    _tcCacheDel('tc_tasks_all');
    return { success: true, message: 'تم حذف المهمة' };
  });
}

// ملخّص أداء معلم في المهام (للتقارير / بيان حالة المعلم)
function getTeacherTaskSummaryProtected(params) {
  return withAuth(params, function (session) {
    var teacher = _safeStr(params.teacherName) || _safeStr(session.teacherName);
    if (teacher !== _safeStr(session.teacherName) && !_tcCanManageTasks(session)) {
      return { success: false, error: 'غير مصرح' };
    }
    try {
      var sheet = _tcTasksSheet();
      var lr = sheet.getLastRow();
      var sum = { teacher: teacher, total: 0, assigned: 0, done: 0, confirmed: 0, late: 0, missed: 0, totalFee: 0, totalDeduction: 0, net: 0, tasks: [] };
      if (lr < 2) return { success: true, summary: sum };
      var data = sheet.getRange(2, 1, lr - 1, TASK_HEADERS.length).getValues();
      for (var i = 0; i < data.length; i++) {
        var o = _tcTaskRowToObj(data[i]);
        if (!o.id || o.teacher !== teacher) continue;
        sum.total++;
        if (o.status === TASK_STATUS.ASSIGNED) sum.assigned++;
        else if (o.status === TASK_STATUS.DONE) sum.done++;
        else if (o.status === TASK_STATUS.CONFIRMED) sum.confirmed++;
        else if (o.status === TASK_STATUS.LATE) sum.late++;
        else if (o.status === TASK_STATUS.MISSED) sum.missed++;
        sum.totalFee += o.fee; sum.totalDeduction += o.deduction;
        sum.tasks.push(o);
      }
      sum.net = sum.totalFee - sum.totalDeduction;
      sum.tasks.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      return { success: true, summary: sum };
    } catch (e) { return { success: false, error: String((e && e.message) || e) }; }
  });
}

// ملخّص أداء المهام لكل المعلمين (للإدارة) — لتقارير الأداء
function getAllTaskSummariesProtected(params) {
  return withAuth(params, function (session) {
    if (!_tcCanManageTasks(session)) return { success: false, error: 'غير مصرح' };
    try {
      var sheet = _tcTasksSheet();
      var lr = sheet.getLastRow();
      var byT = {}, order = [];
      var grand = { total: 0, done: 0, confirmed: 0, late: 0, missed: 0, assigned: 0, totalFee: 0, totalDeduction: 0 };
      if (lr >= 2) {
        var data = sheet.getRange(2, 1, lr - 1, TASK_HEADERS.length).getValues();
        for (var i = 0; i < data.length; i++) {
          var o = _tcTaskRowToObj(data[i]);
          if (!o.id || !o.teacher) continue;
          if (!byT[o.teacher]) {
            byT[o.teacher] = { teacher: o.teacher, total: 0, assigned: 0, done: 0, confirmed: 0, late: 0, missed: 0, totalFee: 0, totalDeduction: 0, net: 0, commitment: 0 };
            order.push(o.teacher);
          }
          var t = byT[o.teacher];
          t.total++; grand.total++;
          if (o.status === TASK_STATUS.ASSIGNED) { t.assigned++; grand.assigned++; }
          else if (o.status === TASK_STATUS.DONE) { t.done++; grand.done++; }
          else if (o.status === TASK_STATUS.CONFIRMED) { t.confirmed++; grand.confirmed++; }
          else if (o.status === TASK_STATUS.LATE) { t.late++; grand.late++; }
          else if (o.status === TASK_STATUS.MISSED) { t.missed++; grand.missed++; }
          t.totalFee += o.fee; t.totalDeduction += o.deduction;
          grand.totalFee += o.fee; grand.totalDeduction += o.deduction;
        }
      }
      var list = [];
      for (var k = 0; k < order.length; k++) {
        var s = byT[order[k]];
        s.net = s.totalFee - s.totalDeduction;
        // نسبة الالتزام: (منفّذ+مؤكّد) ÷ الإجمالي
        s.commitment = s.total > 0 ? Math.round(((s.done + s.confirmed) / s.total) * 100) : 0;
        list.push(s);
      }
      list.sort(function (a, b) { return b.commitment - a.commitment; });
      grand.net = grand.totalFee - grand.totalDeduction;
      return { success: true, teachers: list, grand: grand };
    } catch (e) { return { success: false, error: String((e && e.message) || e) }; }
  });
}

// ════════════════════════════════════════════════════════════════════
//  🗓️ المرحلة 3: التقويم المدرسي 1447-1448هـ (بذر تلقائي + عرض ديناميكي)
//  ورقة «التقويم_المدرسي»: id|النوع|العنوان|اليوم|التاريخ_الهجري|البداية|النهاية|ملاحظات
//  الأنواع: فصل | اختبار | إجازة | مناسبة
// ════════════════════════════════════════════════════════════════════

var CALENDAR_SHEET = 'التقويم_المدرسي';
var CAL_HEADERS = ['id', 'النوع', 'العنوان', 'اليوم', 'التاريخ_الهجري', 'البداية', 'النهاية', 'ملاحظات'];

// بيانات البذر (التاريخ الميلادي بصيغة ISO؛ المفرد: النهاية=البداية)
var CALENDAR_SEED = [
  ['مناسبة', 'انتظام الإدارات المدرسية وبدء القيد والتسجيل', 'السبت', '20 ذو الحجة 1447هـ', '2026-06-06', '2026-06-06'],
  ['مناسبة', 'انتظام هيئة التدريس', 'السبت', '27 ذو الحجة 1447هـ', '2026-06-13', '2026-06-13'],
  ['فصل', 'بداية الدراسة الفعلية (الفصل الأول)', 'السبت', '5 محرم 1448هـ', '2026-06-20', '2026-06-20'],
  ['فصل', 'انتهاء الدراسة للفصل الأول', 'الاثنين', '17 ربيع الأول 1448هـ', '2026-09-28', '2026-09-28'],
  ['اختبار', 'بداية الاختبارات النهائية للفصل الأول', 'الثلاثاء', '18 ربيع الأول 1448هـ', '2026-09-29', '2026-10-09'],
  ['إجازة', 'إجازة منتصف العام', 'السبت', '29 ربيع الأول 1448هـ', '2026-10-10', '2026-10-16'],
  ['فصل', 'بداية الدراسة للفصل الثاني', 'السبت', '6 جمادى الأولى 1448هـ', '2026-10-17', '2026-10-17'],
  ['فصل', 'انتهاء الدراسة للفصل الثاني', 'الاثنين', '17 شعبان 1448هـ', '2027-01-25', '2027-01-25'],
  ['اختبار', 'بداية الاختبارات النهائية للفصل الثاني', 'الثلاثاء', '18 شعبان 1448هـ', '2027-01-26', '2027-02-05'],
  ['اختبار', 'اختبارات الشهادة الثانوية العامة', 'السبت', '11 رمضان 1448هـ', '2027-03-20', '2027-03-20'],
  ['اختبار', 'اختبارات الشهادة الأساسية العامة (التاسع)', 'الأحد', '12 شوال 1448هـ', '2027-04-21', '2027-04-21'],
  ['إجازة', 'عيد الوحدة اليمنية', 'الخميس', '5 ذو الحجة 1447هـ', '2026-05-22', '2026-05-22'],
  ['إجازة', 'رأس السنة الهجرية', 'الثلاثاء', '1 محرم 1448هـ', '2026-06-16', '2026-06-16'],
  ['إجازة', 'المولد النبوي الشريف', 'الخميس', '12 ربيع الأول 1448هـ', '2026-09-25', '2026-09-25'],
  ['إجازة', 'ثورة 21 سبتمبر', 'الاثنين', '10 ربيع الآخر 1448هـ', '2026-09-21', '2026-09-21'],
  ['إجازة', 'ثورة 26 سبتمبر', 'السبت', '15 ربيع الآخر 1448هـ', '2026-09-26', '2026-09-26'],
  ['إجازة', 'ثورة 14 أكتوبر', 'الأربعاء', '3 جمادى الأولى 1448هـ', '2026-10-14', '2026-10-14'],
  ['إجازة', 'عيد الجلاء', 'الاثنين', '20 جمادى الآخرة 1448هـ', '2026-11-30', '2026-11-30']
];
// حدود الفصول لحساب الحالة
var CAL_TERM1 = { start: '2026-06-20', end: '2026-09-28' };
var CAL_MIDBREAK = { start: '2026-10-10', end: '2026-10-16' };
var CAL_TERM2 = { start: '2026-10-17', end: '2027-01-25' };

function _tcCalendarSheet(autoSeed) {
  var sheet = _getOrCreateSheet(CALENDAR_SHEET, CAL_HEADERS);
  if (autoSeed && sheet.getLastRow() < 2) {
    for (var i = 0; i < CALENDAR_SEED.length; i++) {
      var s = CALENDAR_SEED[i];
      sheet.appendRow(['C' + (i + 1), s[0], s[1], s[2], s[3], s[4], s[5], '']);
    }
    SpreadsheetApp.flush();
  }
  return sheet;
}

// بذر يدوي (مدير/وكيل) — يُعيد البذر حتى لو وُجدت بيانات عند force
function seedSchoolCalendarProtected(params) {
  return withAuth(params, function (session) {
    var role = _safeStr(session.role);
    if (!(role === 'admin' || role === 'deputy' || role === 'accountant')) {
      return { success: false, error: 'غير مصرح — للمدير أو الوكيل فقط' };
    }
    var sheet = _getOrCreateSheet(CALENDAR_SHEET, CAL_HEADERS);
    if (params.force) { sheet.clear(); sheet.appendRow(CAL_HEADERS); }
    if (sheet.getLastRow() < 2) {
      for (var i = 0; i < CALENDAR_SEED.length; i++) {
        var s = CALENDAR_SEED[i];
        sheet.appendRow(['C' + (i + 1), s[0], s[1], s[2], s[3], s[4], s[5], '']);
      }
    }
    SpreadsheetApp.flush();
    _tcCacheDel('tc_calendar');
    return { success: true, message: 'تم تهيئة التقويم المدرسي', count: CALENDAR_SEED.length };
  });
}

// يحوّل قيمة خلية تاريخ إلى "yyyy-MM-dd" — يعالج كائنات Date (يمنع "00:00:00 GMT")
function _tcDateCell(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = _safeStr(v).trim();
  // نص ISO جاهز
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  // نص بصيغة Date.toString() (مثل: Sat Jun 06 2026 00:00:00 GMT+0300)
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return s;
}

function _tcCalRowToObj(row) {
  return {
    id: _safeStr(row[0]), type: _safeStr(row[1]), title: _safeStr(row[2]),
    day: _safeStr(row[3]), hijri: _safeStr(row[4]),
    start: _tcDateCell(row[5]), end: _tcDateCell(row[6]) || _tcDateCell(row[5]), notes: _safeStr(row[7])
  };
}

// قراءة التقويم + حساب حالة اليوم (لأي مستخدم)
function getSchoolCalendarProtected(params) {
  return withAuth(params, function (session) {
    try {
      var tz = Session.getScriptTimeZone();
      var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
      var info = _tcNowInfo();

      var sheet = _tcCalendarSheet(true);
      var events = [];
      var lr = sheet.getLastRow();
      if (lr >= 2) {
        var data = sheet.getRange(2, 1, lr - 1, CAL_HEADERS.length).getValues();
        for (var i = 0; i < data.length; i++) {
          var o = _tcCalRowToObj(data[i]);
          if (o.id || o.title) events.push(o);
        }
      }
      events.sort(function (a, b) { return (a.start || '').localeCompare(b.start || ''); });

      // حالة اليوم
      var holidayToday = null, examToday = null;
      for (var j = 0; j < events.length; j++) {
        var e = events[j];
        if (e.start <= todayStr && todayStr <= e.end) {
          if (e.type === 'إجازة' && !holidayToday) holidayToday = e;
          if (e.type === 'اختبار' && !examToday) examToday = e;
        }
      }
      var status = { kind: 'inSession', label: 'يوم دراسي' };
      var isWeekend = (info.dayName === 'الخميس' || info.dayName === 'الجمعة');
      if (holidayToday) status = { kind: 'holiday', label: 'إجازة: ' + holidayToday.title };
      else if (examToday) status = { kind: 'exam', label: 'فترة اختبارات: ' + examToday.title };
      else if (isWeekend) status = { kind: 'weekend', label: 'عطلة نهاية الأسبوع' };
      else if (todayStr < CAL_TERM1.start) status = { kind: 'beforeStart', label: 'قبل بدء العام الدراسي' };
      else if (todayStr >= CAL_TERM1.start && todayStr <= CAL_TERM1.end) status = { kind: 'inSession', label: 'الفصل الدراسي الأول' };
      else if (todayStr >= CAL_MIDBREAK.start && todayStr <= CAL_MIDBREAK.end) status = { kind: 'break', label: 'إجازة منتصف العام' };
      else if (todayStr >= CAL_TERM2.start && todayStr <= CAL_TERM2.end) status = { kind: 'inSession', label: 'الفصل الدراسي الثاني' };
      else if (todayStr > CAL_TERM2.end) status = { kind: 'afterEnd', label: 'فترة الاختبارات/نهاية العام' };

      // الحدث القادم
      var next = null;
      for (var k = 0; k < events.length; k++) { if (events[k].start >= todayStr) { next = events[k]; break; } }

      // العدّ التنازلي لبدء الدراسة (إن كنا قبل الفصل الأول أو في إجازة منتصف العام)
      var daysToStart = 0, studyStart = '';
      if (todayStr < CAL_TERM1.start) { studyStart = CAL_TERM1.start; }
      else if (todayStr >= CAL_MIDBREAK.start && todayStr < CAL_TERM2.start) { studyStart = CAL_TERM2.start; }
      if (studyStart) {
        var d1 = new Date(todayStr + 'T00:00:00'), d2 = new Date(studyStart + 'T00:00:00');
        daysToStart = Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86400000));
      }

      return { success: true, serverDate: todayStr, today: info.dayName, isWeekend: isWeekend,
               status: status, events: events, nextEvent: next,
               daysToStart: daysToStart, studyStart: studyStart };
    } catch (e) { return { success: false, error: String((e && e.message) || e) }; }
  });
}

// إضافة حدث — مدير/وكيل
function addCalendarEventProtected(params) {
  return withAuth(params, function (session) {
    var role = _safeStr(session.role);
    if (!(role === 'admin' || role === 'deputy' || role === 'accountant')) {
      return { success: false, error: 'غير مصرح — للمدير أو الوكيل فقط' };
    }
    if (!_safeStr(params.title)) return { success: false, error: 'العنوان مطلوب' };
    if (!_safeStr(params.start)) return { success: false, error: 'تاريخ البداية مطلوب' };
    var sheet = _tcCalendarSheet(false);
    var id = 'C' + (new Date().getTime());
    sheet.appendRow([id, _safeStr(params.type) || 'مناسبة', _safeStr(params.title),
      _safeStr(params.day), _safeStr(params.hijri), _safeStr(params.start),
      _safeStr(params.end) || _safeStr(params.start), _safeStr(params.notes)]);
    SpreadsheetApp.flush();
    _tcCacheDel('tc_calendar');
    return { success: true, id: id, message: 'تمت إضافة الحدث' };
  });
}

// حذف حدث — مدير/وكيل
function deleteCalendarEventProtected(params) {
  return withAuth(params, function (session) {
    var role = _safeStr(session.role);
    if (!(role === 'admin' || role === 'deputy' || role === 'accountant')) {
      return { success: false, error: 'غير مصرح' };
    }
    var sheet = _tcCalendarSheet(false);
    var lr = sheet.getLastRow();
    if (lr < 2) return { success: false, error: 'لا توجد بيانات' };
    var ids = sheet.getRange(2, 1, lr - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (_safeStr(ids[i][0]) === _safeStr(params.id)) {
        sheet.deleteRow(i + 2); SpreadsheetApp.flush(); _tcCacheDel('tc_calendar');
        return { success: true, message: 'تم الحذف' };
      }
    }
    return { success: false, error: 'الحدث غير موجود' };
  });
}
// ============================================================
// initBlockSettings — تهيئة الحجب المالي بقيمة مناسبة
// شغّله من TeacherCore.gs مرة واحدة (أو من لوحة المعلم)
// القيمة المقترحة: 20% (أي: إذا دفع الطالب أقل من 20% يُحجب)
// ============================================================
function initBlockSettings() {
  try {
    var studentFile = _getSSById(_activeFileId());
    var sheet = studentFile.getSheetByName('الاعدادات');
    
    if (!sheet) {
      sheet = studentFile.insertSheet('الاعدادات');
    }
    
    // التأكد من وجود رأس الأعمدة
    var firstRow = sheet.getRange('A1:B1').getValues()[0];
    if (!firstRow[0] || firstRow[0] === '') {
      sheet.getRange('A1:B1').setValues([['نسبة الحجب (%)', 'الاستثناءات (كود الطالب)']]);
    }
    
    // تعيين نسبة الحجب في A2 (20%)
    var currentVal = sheet.getRange('A2').getValue();
    if (!currentVal || currentVal === '' || currentVal === 0) {
      sheet.getRange('A2').setValue(20);
      Logger.log('✅ تم تعيين نسبة الحجب: 20%');
    } else {
      Logger.log('ℹ️ نسبة الحجب موجودة بالفعل: ' + currentVal + '%');
    }
    
    SpreadsheetApp.flush();
    return { ok: true, message: 'نسبة الحجب: 20%. يمكن تعديلها من لوحة الإدارة.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
// ============================================================
// نظام تسجيل الغياب اليومي
// الملف: TeacherCore.gs
// ============================================================

/**
 * جلب سجل الغياب لطالب محدد (لمنصة الطالب)
 * @param {string} studentCode - كود الطالب
 */
/**
 * بناء رابط واتساب Click-to-Chat
 * يُستدعى من الواجهة JavaScript مباشرة (لا يحتاج Apps Script)
 * لكنها موجودة هنا كمرجع للبنية
 */
function buildWhatsAppLink(phone, studentName, date, status) {
  phone      = _safeStr(phone).replace(/[^0-9]/g, '');
  studentName = _safeStr(studentName);
  date       = _safeStr(date);
  status     = _safeStr(status);

  // تحويل الرقم اليمني إلى صيغة دولية
  if (phone.charAt(0) === '0') {
    phone = '967' + phone.substring(1);
  } else if (phone.indexOf('967') !== 0 && phone.length >= 9) {
    phone = '967' + phone;
  }

  var greeting = (status === 'متأخر') ? 'تأخر عن الحضور' : 'غائب';
  var msg = 'السيد/ة ولي أمر الطالب ' + studentName + '،\n' +
            'نود إعلامكم بأن الطالب/ة تغيب اليوم ' + date + '.\n' +
            'للاستفسار يرجى التواصل مع إدارة المدرسة.\n' +
            'مدارس الإبداع والتميز الدولية — 775189922';

  return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg);
}
// ══════════════════════════════════════════════════════
// clearTeacherCoreCache — مسح كاش TeacherCore
// شغّله مرة واحدة بعد تطبيق الإصلاحات
// ══════════════════════════════════════════════════════
function clearTeacherCoreCache() {
  var keys = ['tc_lists_v1', 'tc_all_students_v1'];
  var cache = CacheService.getScriptCache();
  for (var i = 0; i < keys.length; i++) {
    try { cache.remove(keys[i]); } catch (e) {}
  }
  Logger.log('✅ تم مسح كاش TeacherCore');
  return { ok: true };
}
// أضف هذه الدالة في Code.gs أو TeacherCore.gs
function getDiagnostics() {
  return HtmlService.createHtmlOutputFromFile('Diagnostics')
    .setTitle('تشخيص المنظومة')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
// ══════════════════════════════════════════════════════════════
//  نظام الغياب اليومي — TeacherCore.gs
//  النسخة النهائية المندمجة مع البنية الموجودة
//  تاريخ: 2026-04-27
// ══════════════════════════════════════════════════════════════

/**
 * قراءة رأس ورقة الطلاب وإيجاد فهرس عمود الجوال ديناميكياً
 * يتعامل مع أي ترتيب للأعمدة
 */
function _getStudentSheetColumnMap() {
  try {
    var sheet = _getSheet('الطلاب');
    if (!sheet) return null;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var map = {
      code   : -1, // الكود
      name   : -1, // الاسم
      grade  : -1, // الفصل
      section: -1, // الشعبة
      fees   : -1, // اجمالي الرسوم
      paid   : -1, // المبالغ المسددة
      phone  : -1, // رقم الجوال
      pass   : -1  // كلمة المرور
    };
    for (var i = 0; i < headers.length; i++) {
      var h = _safeStr(headers[i]).trim();
      if (h === 'الكود')                                            map.code    = i;
      else if (h === 'الاسم')                                       map.name    = i;
      else if (h === 'الفصل')                                       map.grade   = i;
      else if (h === 'الشعبة')                                      map.section = i;
      else if (h === 'اجمالي الرسوم' || h === 'الرسوم')            map.fees    = i;
      else if (h === 'المبالغ المسدده' || h === 'المسدد')          map.paid    = i;
      else if (h === 'رقم الجوال' || h === 'الجوال' || h === 'رقم الهاتف') map.phone   = i;
      else if (h === 'كلمة المرور' || h === 'كلمة السر')           map.pass    = i;
    }
    // Fallback: إذا لم يوجد رأس، نستخدم الفهارس الافتراضية
    if (map.code === -1)    map.code    = 0;
    if (map.name === -1)    map.name    = 1;
    if (map.grade === -1)   map.grade   = 2;
    if (map.section === -1) map.section = 3;
    if (map.fees === -1)    map.fees    = 4;
    if (map.paid === -1)    map.paid    = 5;
    if (map.phone === -1)   map.phone   = 6; // العمود الجديد المضاف
    // ملاحظة: pass قد يبقى -1 إن لم يوجد عمود كلمة مرور؛ المستدعي يتعامل مع ذلك
    return map;
  } catch (e) {
    Logger.log('_getStudentSheetColumnMap error: ' + e.toString());
    return { code:0, name:1, grade:2, section:3, fees:4, paid:5, phone:6, pass:-1 };
  }
}

/**
 * جلب قائمة الطلاب مع حالة حضورهم لتاريخ محدد
 * @param {object} params - {token, grade, section, date}
 */
function getAttendanceListProtected(params) {
  return withAuthAndClass(params, params.grade, params.section, function(session) {
    try {
      var grade   = _safeStr(params.grade);
      var section = _safeStr(params.section);
      var date    = _safeStr(params.date) ||
                   Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

      if (!grade)   return { success: false, error: 'الفصل مطلوب' };
      if (!section) return { success: false, error: 'الشعبة مطلوبة' };

      // قراءة خريطة الأعمدة ديناميكياً
      var colMap = _getStudentSheetColumnMap();
      var studentsSheet = _getSheet('الطلاب');
      if (!studentsSheet) return { success: false, error: 'ورقة الطلاب غير موجودة' };

      var studData = studentsSheet.getDataRange().getValues();
      var students = [];

      for (var i = 1; i < studData.length; i++) {
        var row    = studData[i];
        var rCode  = _safeStr(row[colMap.code]);
        var rName  = _safeStr(row[colMap.name]);
        var rGrade = _safeStr(row[colMap.grade]);
        var rSec   = _safeStr(row[colMap.section]);
        var rPhone = colMap.phone >= 0 && colMap.phone < row.length
                     ? _safeStr(row[colMap.phone]) : '';

        if (!rCode || !rName) continue;

        // فلترة الفصل
        if (rGrade !== grade) continue;
        // فلترة الشعبة مع دعم "جميع الشعب"
        if (section !== 'جميع الشعب' && rSec !== section) continue;

        students.push({
          code   : rCode,
          name   : rName,
          phone  : rPhone,
          grade  : rGrade,
          section: rSec,
          status : 'حاضر' // الافتراضي
        });
      }

      // ترتيب أبجدي بالاسم
      students.sort(function(a, b) { return a.name.localeCompare(b.name, 'ar'); });

      // جلب سجلات الغياب الموجودة لهذا اليوم من ورقة "الغياب"
      var attSheet = _getOrCreateSheet('الغياب', [
        'الكود','اسم الطالب','الفصل','الشعبة',
        'التاريخ','الحالة','رقم الجوال','المسجّل','وقت التسجيل'
      ]);

      var attData = attSheet.getDataRange().getValues();
      var absMap  = {};
      for (var ai = 1; ai < attData.length; ai++) {
        var aCode = _safeStr(attData[ai][0]);
        var aDate = _safeStr(attData[ai][4]);
        if (aDate === date && aCode) absMap[aCode] = _safeStr(attData[ai][5]);
      }

      // دمج الحالة الفعلية
      for (var si = 0; si < students.length; si++) {
        if (absMap[students[si].code]) students[si].status = absMap[students[si].code];
      }

      return {
        success     : true,
        students    : students,
        date        : date,
        grade       : grade,
        section     : section,
        totalCount  : students.length,
        absentCount : students.filter(function(s) { return s.status !== 'حاضر'; }).length
      };
    } catch (e) {
      Logger.log('getAttendanceListProtected error: ' + e.toString());
      return { success: false, error: e.message };
    }
  });
}

/**
 * حفظ سجلات الغياب (طالب واحد أو دفعة)
 * @param {object} params - {token, records:[{code,name,phone,grade,section,status}], grade, section, date}
 */
function saveAttendanceProtected(params) {
  return withAuthAndClass(params, params.grade, params.section, function(session) {
    try {
      var records = params.records;
      var grade   = _safeStr(params.grade);
      var section = _safeStr(params.section);
      var date    = _safeStr(params.date) ||
                   Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

      if (!records || !records.length) {
        return { success: false, error: 'لا توجد سجلات للحفظ' };
      }

      var attSheet = _getOrCreateSheet('الغياب', [
        'الكود','اسم الطالب','الفصل','الشعبة',
        'التاريخ','الحالة','رقم الجوال','المسجّل','وقت التسجيل'
      ]);

      // بناء خريطة السجلات الموجودة لتجنب التكرار
      var existingData = attSheet.getDataRange().getValues();
      var existingMap  = {}; // key = "code_date" → rowNumber
      for (var ei = 1; ei < existingData.length; ei++) {
        var eCode = _safeStr(existingData[ei][0]);
        var eDate = _safeStr(existingData[ei][4]);
        if (eCode && eDate) existingMap[eCode + '_' + eDate] = ei + 1;
      }

      var now      = _nowString();
      var recorder = session.teacherName;
      var newRows  = [];

      for (var ri = 0; ri < records.length; ri++) {
        var rec    = records[ri];
        var code   = _safeStr(rec.code);
        var name   = _safeStr(rec.name);
        var phone  = _safeStr(rec.phone  || '');
        var rGrade = _safeStr(rec.grade  || grade);
        var rSec   = _safeStr(rec.section || section);
        var status = _safeStr(rec.status || 'حاضر');

        if (!code) continue;

        var mapKey = code + '_' + date;
        if (existingMap[mapKey]) {
          // تحديث السجل الموجود
          var rowNum = existingMap[mapKey];
          attSheet.getRange(rowNum, 6).setValue(status);  // الحالة
          attSheet.getRange(rowNum, 9).setValue(now);     // وقت التسجيل
        } else {
          // إضافة سجل جديد مجمّع
          newRows.push([code, name, rGrade, rSec, date, status, phone, recorder, now]);
        }
      }

      // إضافة كل السجلات الجديدة دفعة واحدة لتحسين الأداء
      if (newRows.length > 0) {
        attSheet.getRange(
          attSheet.getLastRow() + 1, 1, newRows.length, 9
        ).setValues(newRows);
      }

      SpreadsheetApp.flush();

      // جمع الغائبين والمتأخرين للواجهة
      var absent = [];
      for (var ri2 = 0; ri2 < records.length; ri2++) {
        var r2 = records[ri2];
        if (_safeStr(r2.status) === 'غائب' || _safeStr(r2.status) === 'متأخر') {
          absent.push({
            code  : _safeStr(r2.code),
            name  : _safeStr(r2.name),
            phone : _safeStr(r2.phone  || ''),
            status: _safeStr(r2.status)
          });
        }
      }

      Logger.log('saveAttendanceProtected: حُفظ ' + records.length +
                ' سجل | بواسطة: ' + recorder + ' | تاريخ: ' + date);

      return {
        success    : true,
        saved      : records.length,
        absentList : absent,
        absentCount: absent.length,
        message    : 'تم حفظ ' + records.length + ' سجل بنجاح'
      };
    } catch (e) {
      Logger.log('saveAttendanceProtected error: ' + e.toString());
      return { success: false, error: e.message };
    }
  });
}

/**
 * جلب سجل غياب طالب واحد (يُستدعى من StudentLogic.gs)
 * @param {string} studentCode
 */
function getStudentAttendanceRecord(studentCode) {
  try {
    studentCode = _safeStr(studentCode);
    if (!studentCode) return { success: false, error: 'كود الطالب مطلوب' };

    var attSheet = _getSheet('الغياب');
    if (!attSheet) return { success: true, records: [], total: 0 };

    var data = attSheet.getDataRange().getValues();
    var out  = [];

    for (var i = 1; i < data.length; i++) {
      var code   = _safeStr(data[i][0]);
      var status = _safeStr(data[i][5]);
      if (code !== studentCode) continue;
      if (status === 'حاضر') continue;
      out.push({
        date    : _safeStr(data[i][4]),
        status  : status,
        recorder: _safeStr(data[i][7])
      });
    }

    out.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    return { success: true, records: out, total: out.length };
  } catch (e) {
    Logger.log('getStudentAttendanceRecord error: ' + e.toString());
    return { success: false, error: e.message };
  }
}

/**
 * إحصاءات الغياب (للمدير والمشرف)
 * @param {object} params - {token, grade?, section?, startDate?, endDate?}
 */
function getAttendanceStatsProtected(params) {
  return withAuth(params, function(session) {
    try {
      var grade     = _safeStr(params.grade || '');
      var section   = _safeStr(params.section || '');
      var startDate = _safeStr(params.startDate || '');
      var endDate   = _safeStr(params.endDate   || '');

      var attSheet = _getSheet('الغياب');
      if (!attSheet) return { success: true, stats: [], total: 0 };

      var data  = attSheet.getDataRange().getValues();
      var stats = {}; // key = studentCode

      for (var i = 1; i < data.length; i++) {
        var code   = _safeStr(data[i][0]);
        var name   = _safeStr(data[i][1]);
        var rGrade = _safeStr(data[i][2]);
        var rSec   = _safeStr(data[i][3]);
        var date   = _safeStr(data[i][4]);
        var status = _safeStr(data[i][5]);

        if (!code || status === 'حاضر') continue;
        if (grade   && rGrade !== grade)   continue;
        if (section && rSec   !== section) continue;
        if (startDate && date < startDate) continue;
        if (endDate   && date > endDate)   continue;

        // تصفية حسب صلاحية المعلم (غير المدير)
        if (!session.isAdmin) {
          var hasAll = session.classes &&
            session.classes.indexOf('جميع الفصول') !== -1;
          if (!hasAll && session.classes &&
              session.classes.indexOf(rGrade) === -1) continue;
        }

        if (!stats[code]) {
          stats[code] = { code: code, name: name, grade: rGrade,
                         section: rSec, absent: 0, late: 0 };
        }
        if (status === 'غائب')   stats[code].absent++;
        if (status === 'متأخر') stats[code].late++;
      }

      var out = [];
      for (var k in stats) out.push(stats[k]);
      out.sort(function(a, b) { return (b.absent + b.late) - (a.absent + a.late); });

      return { success: true, stats: out, total: out.length };
    } catch (e) {
      Logger.log('getAttendanceStatsProtected error: ' + e.toString());
      return { success: false, error: e.message };
    }
  });
}

/**
 * تحديث رقم الجوال للطالب من منصة الطالب
 * يُستدعى من StudentLogic.gs
 * @param {string} studentCode
 * @param {string} newPhone
 */
function updateStudentPhoneNumber(studentCode, newPhone) {
  try {
    studentCode = _safeStr(studentCode);
    newPhone    = _safeStr(newPhone).replace(/[^0-9+]/g, '');

    if (!studentCode) return { success: false, error: 'كود الطالب مطلوب' };
    if (newPhone.length < 9) return { success: false, error: 'رقم الجوال غير صحيح (9 أرقام على الأقل)' };

    var colMap = _getStudentSheetColumnMap();
    if (colMap.phone < 0) return { success: false, error: 'عمود رقم الجوال غير موجود في الشيت' };

    var sheet = _getSheet('الطلاب');
    if (!sheet) return { success: false, error: 'ورقة الطلاب غير موجودة' };

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][colMap.code]) === studentCode) {
        sheet.getRange(i + 1, colMap.phone + 1).setValue(newPhone);
        SpreadsheetApp.flush();
        Logger.log('updateStudentPhoneNumber: تم تحديث جوال الطالب ' + studentCode);
        return { success: true, message: 'تم تحديث رقم الجوال بنجاح' };
      }
    }
    return { success: false, error: 'الطالب غير موجود' };
  } catch (e) {
    Logger.log('updateStudentPhoneNumber error: ' + e.toString());
    return { success: false, error: e.message };
  }
}
// ══════════════════════════════════════════════════════════════
//  إدارة المعلمين — النسخة المُعاد هيكلتها
//  تجمع صفوف المعلم المتعددة في كيان واحد
//  TeacherCore.gs
// ══════════════════════════════════════════════════════════════

/**
 * جلب كل المعلمين مجمّعين (صف واحد لكل معلم)
 * يقرأ جميع الصفوف ويجمع المواد/الفصول/الشعب لكل معلم
 */
function adminGetAllTeachersGrouped(params) {
  return withAuth(params, function(session) {
    if (!session.isAdmin) {
      return { success: false, error: 'غير مصرح — للمدير والمشرف والوكيل فقط' };
    }
    return _getAllTeachersGroupedInternal();
  });
}

function _getAllTeachersGroupedInternal() {
  try {
    var sheet = _getOrCreateSheet('المدرسين',
      ['اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'كلمة المرور']);
    var data  = sheet.getDataRange().getValues();

    // خريطة: اسم المعلم → بيانات مجمّعة
    var map   = {};
    var order = []; // للحفاظ على الترتيب

    for (var i = 1; i < data.length; i++) {
      var name    = _safeStr(data[i][0]);
      var subject = _safeStr(data[i][1]);
      var grade   = _safeStr(data[i][2]);
      var section = _safeStr(data[i][3]);
      var pass    = _safeStr(data[i][4]);

      if (!name) continue;

      if (!map[name]) {
        map[name] = {
          name       : name,
          password   : pass,
          rows       : [],   // أرقام الصفوف في الشيت
          subjects   : [],
          grades     : [],
          sections   : [],
          assignments: []    // [{subject, grade, section}]
        };
        order.push(name);
      }

      map[name].rows.push(i + 1);
      if (pass && !map[name].password) map[name].password = pass;

      // إضافة المادة/الفصل/الشعبة إن لم تكن مكررة
      if (subject && map[name].subjects.indexOf(subject) === -1) {
        map[name].subjects.push(subject);
      }
      if (grade && map[name].grades.indexOf(grade) === -1) {
        map[name].grades.push(grade);
      }
      if (section && map[name].sections.indexOf(section) === -1) {
        map[name].sections.push(section);
      }

      // كل مجموعة (مادة+فصل+شعبة) = تعيين واحد
      if (subject || grade || section) {
        map[name].assignments.push({
          subject : subject,
          grade   : grade,
          section : section
        });
      }
    }

    // تحويل الخريطة إلى مصفوفة مرتبة
    var teachers = [];
    for (var ni = 0; ni < order.length; ni++) {
      var t = map[order[ni]];

      // تحديد الدور
      var role = 'teacher';
      if (t.subjects.indexOf('المدير') !== -1)  role = 'admin';
      else if (t.subjects.indexOf('الوكيل') !== -1) role = 'deputy';
      else if (t.subjects.indexOf('محاسب') !== -1)  role = 'accountant';
      else if (t.subjects.indexOf('مشرف') !== -1)  role = 'supervisor';

      teachers.push({
        name       : t.name,
        password   : t.password,
        subjects   : t.subjects,
        grades     : t.grades,
        sections   : t.sections,
        assignments: t.assignments,
        rows       : t.rows,
        role       : role,
        rowCount   : t.rows.length
      });
    }

    return { success: true, teachers: teachers, total: teachers.length };
  } catch (e) {
    Logger.log('_getAllTeachersGroupedInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * حفظ معلم كامل (إضافة أو تعديل)
 * يكتب صفاً لكل تعيين (مادة+فصل+شعبة)
 * @param {object} params - {token, teacher: {name, password, assignments:[{subject,grade,section}]}}
 */
function adminSaveTeacherGrouped(params) {
  return withAuth(params, function(session) {
    if (!session.isAdmin) {
      return { success: false, error: 'غير مصرح' };
    }
    return _saveTeacherGroupedInternal(params.teacher, params.isNew);
  });
}

function _saveTeacherGroupedInternal(teacher, isNew) {
  try {
    if (!teacher || !teacher.name) {
      return { success: false, error: 'اسم المعلم مطلوب' };
    }

    var name     = _safeStr(teacher.name).trim();
    var password = _safeStr(teacher.password).trim();
    var assignments = teacher.assignments || [];

    if (assignments.length === 0) {
      return { success: false, error: 'يجب إضافة تعيين واحد على الأقل (مادة + فصل + شعبة)' };
    }

    var sheet = _getOrCreateSheet('المدرسين',
      ['اسم المدرس', 'المادة', 'الفصل', 'الشعبة', 'كلمة المرور']);

    // إذا كان تعديلاً: احذف الصفوف القديمة أولاً
    if (!isNew) {
      var data     = sheet.getDataRange().getValues();
      var toDelete = [];
      for (var i = data.length - 1; i >= 1; i--) {
        if (_safeStr(data[i][0]) === name) toDelete.push(i + 1);
      }
      // الحذف من الأسفل للأعلى لتجنب إزاحة الصفوف
      for (var di = 0; di < toDelete.length; di++) {
        sheet.deleteRow(toDelete[di]);
      }
    }

    // كتابة صف لكل تعيين
    var writtenCount = 0;
    for (var ai = 0; ai < assignments.length; ai++) {
      var asgn = assignments[ai];
      var subj = _safeStr(asgn.subject);
      var grd  = _safeStr(asgn.grade);
      var sec  = _safeStr(asgn.section);

      // كلمة المرور تُكتب في الصف الأول فقط (باقي الصفوف تتركها فارغة)
      var rowPass = (ai === 0) ? password : '';

      sheet.appendRow([name, subj, grd, sec, rowPass]);
      writtenCount++;
    }

    // إذا كان الدور خاصاً (مدير/وكيل/مشرف) وليس له تعيينات حقيقية
    if (teacher.role && teacher.role !== 'teacher' && assignments.length === 1) {
      var roleMap = { admin: 'المدير', deputy: 'الوكيل', supervisor: 'مشرف' };
      var roleName = roleMap[teacher.role];
      if (roleName) {
        // التأكد أن التعيين الأول يعكس الدور
        var lastRow = sheet.getLastRow();
        var firstRow = lastRow - writtenCount + 1;
        sheet.getRange(firstRow, 2).setValue(roleName);
        sheet.getRange(firstRow, 3).setValue(roleName);
        sheet.getRange(firstRow, 4).setValue(roleName);
      }
    }

    SpreadsheetApp.flush();

    // مسح كاش المصادقة (لتحديث صلاحيات المعلم)
    try {
      CacheService.getScriptCache().remove('students_list_cache');
    } catch(ce) {}

    Logger.log('_saveTeacherGroupedInternal: حُفظ ' + name +
              ' | ' + writtenCount + ' صف | isNew=' + isNew);

    return {
      success : true,
      message : (isNew ? 'تم إضافة المعلم' : 'تم تحديث بيانات المعلم') +
                ' "' + name + '" بنجاح (' + writtenCount + ' تعيين)',
      rowsWritten: writtenCount
    };
  } catch (e) {
    Logger.log('_saveTeacherGroupedInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * حذف معلم بالكامل (جميع صفوفه)
 */
function adminDeleteTeacherByName(params) {
  return withAuth(params, function(session) {
    if (!session.isAdmin) {
      return { success: false, error: 'غير مصرح' };
    }
    return _deleteTeacherByNameInternal(_safeStr(params.name));
  });
}

function _deleteTeacherByNameInternal(name) {
  try {
    if (!name) return { success: false, error: 'اسم المعلم مطلوب' };

    var sheet = _getSheet('المدرسين');
    if (!sheet) return { success: false, error: 'ورقة المدرسين غير موجودة' };

    var data     = sheet.getDataRange().getValues();
    var toDelete = [];
    for (var i = data.length - 1; i >= 1; i--) {
      if (_safeStr(data[i][0]) === name) toDelete.push(i + 1);
    }

    if (toDelete.length === 0) {
      return { success: false, error: 'المعلم "' + name + '" غير موجود' };
    }

    for (var di = 0; di < toDelete.length; di++) {
      sheet.deleteRow(toDelete[di]);
    }

    SpreadsheetApp.flush();
    Logger.log('_deleteTeacherByNameInternal: حُذف ' + name + ' (' + toDelete.length + ' صف)');

    return {
      success : true,
      message : 'تم حذف المعلم "' + name + '" بنجاح (' + toDelete.length + ' صف)',
      deleted : toDelete.length
    };
  } catch (e) {
    Logger.log('_deleteTeacherByNameInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ══════════════════════════════════════════════════════════════
//  إدارة ورقة القوائم ديناميكياً
//  أعمدة: الفصل | (فارغ) | المادة | الشعبة | (فارغ) | نوع المخالفة
// ══════════════════════════════════════════════════════════════

/**
 * جلب بيانات القوائم كاملة
 */
/**
 * جلب القوائم (الفصول، المواد، الشعب، المخالفات) – نسخة محمية
 * تُستخدم من قبل جميع المستخدمين عند تحميل المنصة
 * @param {object} params - { token }
 * @returns {object} { success, grades, subjects, sections, violations }
 */
function getListsDataProtected(params) {
  return withAuth(params, function(session) {
    try {
      // استدعاء دالة getLists الداخلية (غير المحمية)
      var result = getLists();
      if (result.success) {
        return result;
      } else {
        // في حال الفشل، نُعيد القوائم الافتراضية حتى لا تتعطل المنصة
        return {
          success    : true,
          grades     : [],
          subjects   : ['قران كريم','تربية اسلامية','اللغة العربية','اللغة الانجليزية','الرياضيات','العلوم','الاجتماعيات'],
          sections   : ['أ','ب','ج'],
          violations : ['تأخر عن الدوام','عدم التزام بالزي المدرسي','إهمال الواجبات']
        };
      }
    } catch (e) {
      Logger.log('getListsDataProtected error: ' + e.toString());
      // حتى في حالة الخطأ، نُعيد بيانات افتراضية لتجنب توقف الواجهة
      return {
        success    : true,
        grades     : [],
        subjects   : ['قران كريم','تربية اسلامية','اللغة العربية','اللغة الانجليزية','الرياضيات','العلوم','الاجتماعيات'],
        sections   : ['أ','ب','ج'],
        violations : ['تأخر عن الدوام','عدم التزام بالزي المدرسي','إهمال الواجبات']
      };
    }
  });
}

function _getListsDataInternal() {
  try {
    var sheet = _getOrCreateSheet('القوائم',
      ['الفصول', '', 'المواد', 'الشعب', '', 'المخالفات']);
    var data  = sheet.getDataRange().getValues();

    var grades     = [];
    var subjects   = [];
    var sections   = [];
    var violations = [];

    for (var i = 1; i < data.length; i++) {
      var g = _safeStr(data[i][0]);
      var s = _safeStr(data[i][2]);
      var sec = _safeStr(data[i][3]);
      var v = _safeStr(data[i][5]);

      if (g && grades.indexOf(g) === -1)         grades.push(g);
      if (s && subjects.indexOf(s) === -1)       subjects.push(s);
      if (sec && sections.indexOf(sec) === -1)   sections.push(sec);
      if (v && violations.indexOf(v) === -1)     violations.push(v);
    }

    return {
      success   : true,
      grades    : grades,
      subjects  : subjects,
      sections  : sections,
      violations: violations,
      rawRows   : data.slice(1).map(function(r, idx) {
        return {
          rowIndex : idx + 2,
          grade    : _safeStr(r[0]),
          subject  : _safeStr(r[2]),
          section  : _safeStr(r[3]),
          violation: _safeStr(r[5])
        };
      })
    };
  } catch (e) {
    Logger.log('_getListsDataInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * إضافة عنصر إلى قائمة محددة
 * @param {object} params - {token, listType: 'grade'|'subject'|'section'|'violation', value}
 */
function addListItemProtected(params) {
  return withAuth(params, function(session) {
    if (!session.isAdmin) {
      return { success: false, error: 'غير مصرح' };
    }
    return _addListItemInternal(params.listType, _safeStr(params.value));
  });
}

function _addListItemInternal(listType, value) {
  try {
    if (!listType || !value) {
      return { success: false, error: 'نوع القائمة والقيمة مطلوبان' };
    }

    var colMap = { grade: 1, subject: 3, section: 4, violation: 6 };
    var col = colMap[listType];
    if (!col) {
      return { success: false, error: 'نوع قائمة غير صالح: ' + listType };
    }

    var sheet = _getOrCreateSheet('القوائم',
      ['الفصول', '', 'المواد', 'الشعب', '', 'المخالفات']);
    var data  = sheet.getDataRange().getValues();

    // التحقق من عدم التكرار في نفس العمود
    for (var i = 1; i < data.length; i++) {
      if (_safeStr(data[i][col - 1]) === value) {
        return { success: false, error: '"' + value + '" موجود بالفعل في القائمة' };
      }
    }

    // البحث عن أول صف فارغ في هذا العمود
    var targetRow = -1;
    for (var j = 1; j < data.length; j++) {
      if (!_safeStr(data[j][col - 1])) {
        targetRow = j + 1;
        break;
      }
    }

    if (targetRow === -1) {
      // إضافة صف جديد في النهاية
      var newRow = ['', '', '', '', '', ''];
      newRow[col - 1] = value;
      sheet.appendRow(newRow);
    } else {
      sheet.getRange(targetRow, col).setValue(value);
    }

    SpreadsheetApp.flush();
    return { success: true, message: 'تم إضافة "' + value + '" بنجاح' };
  } catch (e) {
    Logger.log('_addListItemInternal error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * حذف عنصر من قائمة
 * @param {object} params - {token, listType, rowIndex}
 */
function deleteListItemProtected(params) {
  return withAuth(params, function(session) {
    if (!session.isAdmin) {
      return { success: false, error: 'غير مصرح' };
    }
    var col = { grade:1, subject:3, section:4, violation:6 }[params.listType];
    if (!col) return { success: false, error: 'نوع قائمة غير صالح' };

    try {
      var sheet = _getSheet('القوائم');
      if (!sheet) return { success: false, error: 'ورقة القوائم غير موجودة' };

      var ri = parseInt(params.rowIndex);
      if (isNaN(ri) || ri < 2) return { success: false, error: 'رقم الصف غير صالح' };

      // مسح الخلية المحددة فقط (لا نحذف الصف كله لأن كل عمود مستقل)
      var cell = sheet.getRange(ri, col);
      var oldVal = cell.getValue();
      cell.clearContent();
      SpreadsheetApp.flush();

      return { success: true, message: 'تم حذف "' + oldVal + '" بنجاح' };
    } catch (e) {
      Logger.log('deleteListItemProtected error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  });
}

/**
 * تعديل عنصر في قائمة
 */
function updateListItemProtected(params) {
  return withAuth(params, function(session) {
    if (!session.isAdmin) {
      return { success: false, error: 'غير مصرح' };
    }
    var col = { grade:1, subject:3, section:4, violation:6 }[params.listType];
    if (!col) return { success: false, error: 'نوع قائمة غير صالح' };

    try {
      var sheet = _getSheet('القوائم');
      if (!sheet) return { success: false, error: 'ورقة القوائم غير موجودة' };

      var ri    = parseInt(params.rowIndex);
      var newVal = _safeStr(params.newValue);
      if (!newVal) return { success: false, error: 'القيمة الجديدة مطلوبة' };

      sheet.getRange(ri, col).setValue(newVal);
      SpreadsheetApp.flush();

      return { success: true, message: 'تم التعديل بنجاح' };
    } catch (e) {
      Logger.log('updateListItemProtected error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  });
}

/**
 * جلب بيانات القوائم للواجهة (فصول + مواد + شعب + مخالفات)
 * يدمج القوائم مع البيانات الحقيقية من الطلاب
 */
function getEnhancedListsProtected(params) {
  return withAuth(params, function(session) {
    try {
      // القوائم المعرّفة يدوياً
      var manualLists = _getListsDataInternal();

      // الفصول والشعب الحقيقية من ورقة الطلاب
      var studSheet = _getSheet('الطلاب');
      var realGrades   = [];
      var realSections = [];

      if (studSheet) {
        var studData = studSheet.getDataRange().getValues();
        for (var i = 1; i < studData.length; i++) {
          var g = _safeStr(studData[i][2]);
          var s = _safeStr(studData[i][3]);
          if (g && realGrades.indexOf(g) === -1)   realGrades.push(g);
          if (s && realSections.indexOf(s) === -1) realSections.push(s);
        }
      }

      // دمج القوائم اليدوية مع الحقيقية
      var allGrades   = manualLists.success ? manualLists.grades   : [];
      var allSections = manualLists.success ? manualLists.sections : [];

      for (var gi = 0; gi < realGrades.length; gi++) {
        if (allGrades.indexOf(realGrades[gi]) === -1) allGrades.push(realGrades[gi]);
      }
      for (var si = 0; si < realSections.length; si++) {
        if (allSections.indexOf(realSections[si]) === -1) allSections.push(realSections[si]);
      }

      // المواد من ورقة المدرسين
      var allSubjects = manualLists.success ? manualLists.subjects : [];
      var tchSheet = _getSheet('المدرسين');
      if (tchSheet) {
        var tchData = tchSheet.getDataRange().getValues();
        for (var ti = 1; ti < tchData.length; ti++) {
          var sub = _safeStr(tchData[ti][1]);
          var specialRoles = ['المدير', 'الوكيل', 'مشرف', 'جميع المواد', ''];
          if (sub && specialRoles.indexOf(sub) === -1 &&
              allSubjects.indexOf(sub) === -1) {
            allSubjects.push(sub);
          }
        }
      }

      return {
        success   : true,
        grades    : allGrades,
        sections  : allSections,
        subjects  : allSubjects,
        violations: manualLists.success ? manualLists.violations : [],
        rawRows   : manualLists.success ? manualLists.rawRows    : []
      };
    } catch (e) {
      Logger.log('getEnhancedListsProtected error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  });
}
// ══════════════════════════════════════════════════════════════
//  saveAttendanceSingleProtected
//  حفظ غياب طالب واحد منفرد بدون إرسال باقي الفصل
//  يُضاف في نهاية TeacherCore.gs (بعد السطر 4386)
//
//  المدخلات (params):
//    token   : string  — توكن الجلسة
//    code    : string  — كود الطالب
//    name    : string  — اسم الطالب
//    status  : string  — 'حاضر' | 'غائب' | 'متأخر'
//    grade   : string  — الفصل
//    section : string  — الشعبة
//    date    : string  — yyyy-MM-dd (اختياري، يُستخدم اليوم إن غاب)
//    phone   : string  — رقم الجوال (اختياري)
//
//  المخرجات:
//    { success, saved, status, message }
// ══════════════════════════════════════════════════════════════
function saveAttendanceSingleProtected(params) {
  return withAuthAndClass(params, params.grade, params.section, function(session) {
    try {
      var code    = _safeStr(params.code);
      var name    = _safeStr(params.name);
      var status  = _safeStr(params.status  || 'حاضر');
      var grade   = _safeStr(params.grade   || '');
      var section = _safeStr(params.section || '');
      var phone   = _safeStr(params.phone   || '');
      var date    = _safeStr(params.date    || '');

      if (!code) {
        return { success: false, error: 'كود الطالب مطلوب' };
      }

      var validStatuses = ['حاضر', 'غائب', 'متأخر'];
      var statusOk = false;
      for (var vi = 0; vi < validStatuses.length; vi++) {
        if (validStatuses[vi] === status) { statusOk = true; break; }
      }
      if (!statusOk) {
        return { success: false, error: 'حالة غير صالحة: ' + status };
      }

      if (!date) {
        date = Utilities.formatDate(
          new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'
        );
      }

      var attSheet = _getOrCreateSheet('الغياب', [
        'الكود', 'اسم الطالب', 'الفصل', 'الشعبة',
        'التاريخ', 'الحالة', 'رقم الجوال', 'المسجّل', 'وقت التسجيل'
      ]);

      // ── البحث عن سجل موجود بنفس الكود والتاريخ ──
      var existingData = attSheet.getDataRange().getValues();
      var foundRow     = -1;
      var mapKey       = code + '_' + date;

      for (var ei = 1; ei < existingData.length; ei++) {
        var eCode = _safeStr(existingData[ei][0]);
        var eDate = _safeStr(existingData[ei][4]);
        if (eCode + '_' + eDate === mapKey) {
          foundRow = ei + 1; // رقم الصف الفعلي (1-based)
          break;
        }
      }

      var now      = _nowString();
      var recorder = _safeStr(session.teacherName);

      if (foundRow > 0) {
        // ── تحديث السجل الموجود ──
        attSheet.getRange(foundRow, 6).setValue(status);   // الحالة
        attSheet.getRange(foundRow, 9).setValue(now);      // وقت التسجيل
      } else {
        // ── إضافة سجل جديد ──
        attSheet.appendRow([
          code, name, grade, section,
          date, status, phone, recorder, now
        ]);
      }

      SpreadsheetApp.flush();

      Logger.log('saveAttendanceSingleProtected: ' + code +
                 ' | ' + status + ' | ' + date +
                 ' | بواسطة: ' + recorder);

      return {
        success : true,
        saved   : 1,
        status  : status,
        code    : code,
        message : 'تم حفظ حالة ' + name + ' كـ «' + status + '» بنجاح'
      };

    } catch (e) {
      Logger.log('saveAttendanceSingleProtected error: ' + e.toString());
      return { success: false, error: e.message };
    }
  });
}

function getUnreadNotesCountProtected(params) {
return withAuth(params, function(session) {
try {
var sheet = _getSheet('الملاحظات');
if (!sheet) return { success: true, unread: 0 };
var data    = sheet.getDataRange().getValues();
var unread  = 0;
var rdCol   = -1; // عمود "مقروء"
// البحث عن عمود "مقروء" في الرأس
if (data.length > 0) {
for (var ci = 0; ci < data[0].length; ci++) {
if (_safeStr(data[0][ci]) === 'مقروء') { rdCol = ci; break; }
}
}
// إذا لا يوجد عمود "مقروء"، اعتبر كل الملاحظات غير مقروءة
if (rdCol === -1) {
return { success: true, unread: Math.max(0, data.length - 1) };
}
for (var ri = 1; ri < data.length; ri++) {
var rd = _safeStr(data[ri][rdCol]).toLowerCase();
if (rd !== 'نعم' && rd !== 'yes' && rd !== '1') unread++;
}
return { success: true, unread: unread };
} catch (e) {
return { success: true, unread: 0 };
}
});
}

// ══════════════════════════════════════════════════════════════════
// ① getAllNewsProtected — المُحدَّثة بفلتر الأدوار الكامل
// ══════════════════════════════════════════════════════════════════
function getAllNewsProtected(params) {
  return withAuth(params, function(session) {
    try {
      var grade     = _safeStr(params.grade     || '');
      var section   = _safeStr(params.section   || '');
      var teacher   = _safeStr(params.teacher   || '');
      var dateFrom  = _safeStr(params.dateFrom  || '');
      var dateTo    = _safeStr(params.dateTo    || '');
      var sortOrder = _safeStr(params.sortOrder || 'newest');
      var pageNum   = parseInt(params.page     || 1,  10);
      var pageSize  = parseInt(params.pageSize || 20, 10);
 
      var role        = _safeStr(session.role        || 'teacher');
      var myName      = _safeStr(session.teacherName || '');
      var myClasses   = session.classes || [];
      var isAdminRole = session.isAdmin ||
                        role === 'admin' ||
                        role === 'deputy';
 
      var sheet = _getSheet('الاخبار');
      if (!sheet) return { success: true, news: [], total: 0 };
 
      var data     = sheet.getDataRange().getValues();
      var viewsMap = _getViewsMap();
      var likesMap = _getLikesMap();
      var out      = [];
 
      for (var i = 1; i < data.length; i++) {
        var r        = data[i];
        var newsId   = _safeStr(r[0]);
        if (!newsId) continue;
 
        var rTeacher = _safeStr(r[1]);
        var rGrade   = _safeStr(r[2]);
        var rSection = _safeStr(r[3]);
        var rText    = _safeStr(r[4]);
        var rAttach  = _safeStr(r[5]);
        var rDate    = _safeStr(r[6]);
 
        if (!rText) continue;
 
        // ── فلتر الصلاحية حسب الدور ──────────────────────────────
        if (!isAdminRole) {
 
          if (role === 'teacher') {
            // المعلم العادي: أخباره هو + الأخبار العامة فقط
            var isMyNews     = (rTeacher === myName);
            var isGeneralNews = (rGrade === 'جميع الفصول' &&
                                 rSection === 'جميع الشعب');
            if (!isMyNews && !isGeneralNews) continue;
 
          } else if (role === 'supervisor') {
            // المشرف: فصوله فقط + الأخبار العامة
            var hasAllClasses = (myClasses.indexOf('جميع الفصول') !== -1);
            if (!hasAllClasses) {
              var inMyClasses   = (myClasses.indexOf(rGrade) !== -1);
              var isGeneral     = (rGrade === 'جميع الفصول');
              if (!inMyClasses && !isGeneral) continue;
            }
 
          } else {
            // أي دور آخر غير معروف: عامل كمعلم
            var _isMyNews     = (rTeacher === myName);
            var _isGeneral    = (rGrade === 'جميع الفصول' &&
                                 rSection === 'جميع الشعب');
            if (!_isMyNews && !_isGeneral) continue;
          }
        }
        // admin و deputy: لا فلتر — يرون الكل
 
        // ── فلاتر المستخدم (الفصل/الشعبة/المعلم/التاريخ) ──────────
        if (grade && grade !== 'الكل') {
          if (rGrade !== grade && rGrade !== 'جميع الفصول') continue;
        }
        if (section && section !== 'الكل') {
          if (rSection !== section && rSection !== 'جميع الشعب') continue;
        }
        if (teacher && rTeacher.indexOf(teacher) === -1) continue;
        if (dateFrom && rDate < dateFrom) continue;
        if (dateTo   && rDate > dateTo)   continue;
 
        // ── إحصاءات المشاهدات والإعجابات ──────────────────────────
        var viewsArr = viewsMap[newsId] || [];
        var likesArr = likesMap[newsId] || [];
 
        var firstLikes = [];
        for (var li = 0; li < likesArr.length && li < 3; li++) {
          firstLikes.push(likesArr[li].userName);
        }
 
        // هل هذا الخبر يخص المعلم الحالي؟ (لتفعيل زر المشاهدين له)
        var isOwner = (rTeacher === myName) || isAdminRole;
 
        out.push({
          id          : newsId,
          teacher     : rTeacher,
          grade       : rGrade   || 'الجميع',
          section     : rSection || 'الجميع',
          news        : rText,
          attachments : rAttach,
          date        : rDate,
          rowIndex    : i + 1,
          viewsCount  : viewsArr.length,
          likesCount  : likesArr.length,
          firstLikers : firstLikes,
          isOwner     : isOwner       // ← جديد: للواجهة الأمامية
        });
      }
 
      // ── الترتيب — الأحدث افتراضياً ─────────────────────────────
      if (sortOrder === 'oldest') {
        out.sort(function(a, b) {
          return (a.date || '').localeCompare(b.date || '');
        });
      } else if (sortOrder === 'mostLiked') {
        out.sort(function(a, b) { return b.likesCount - a.likesCount; });
      } else {
        // newest — بالرقم التسلسلي (الأحدث أولاً دائماً)
        out.sort(function(a, b) {
          return parseInt(b.id || 0, 10) - parseInt(a.id || 0, 10);
        });
      }
 
      var total    = out.length;
      var startIdx = (pageNum - 1) * pageSize;
      var pageItems = out.slice(startIdx, startIdx + pageSize);
 
      return {
        success  : true,
        news     : pageItems,
        total    : total,
        page     : pageNum,
        pageSize : pageSize,
        hasMore  : (startIdx + pageSize) < total
      };
    } catch (e) {
      Logger.log('getAllNewsProtected error: ' + e.toString());
      return { success: false, error: e.message };
    }
  });
}
 
// ══════════════════════════════════════════════════════════════════
// ② recordNewsViewProtected — تسجيل مشاهدة خبر (مرة واحدة لكل مستخدم)
// ══════════════════════════════════════════════════════════════════
function recordNewsViewProtected(params) {
  return withAuth(params, function(session) {
    try {
      var newsId   = _safeStr(params.newsId);
      var userId   = _safeStr(session.teacherName);
      var userType = _safeStr(session.role || 'teacher');

      if (!newsId) return { success: false, error: 'newsId مطلوب' };

      var sheet = _getOrCreateSheet('اخبار_مشاهدات', [
        'newsId', 'userId', 'userType', 'timestamp'
      ]);

      // التحقق من عدم التكرار
      var data    = sheet.getDataRange().getValues();
      var already = false;
      for (var i = 1; i < data.length; i++) {
        if (_safeStr(data[i][0]) === newsId &&
            _safeStr(data[i][1]) === userId) {
          already = true; break;
        }
      }

      if (!already) {
        sheet.appendRow([newsId, userId, userType, _nowString()]);
        SpreadsheetApp.flush();
      }

      // ★ إبطال كاش الأخبار بعد التسجيل
      clearNewsCache();

      return { success: true, alreadyViewed: already };
    } catch (e) {
      Logger.log('recordNewsViewProtected error: ' + e.toString());
      return { success: false, error: e.message };
    }
  });
}
// ══════════════════════════════════════════════════════════════════
// ③ getNewsViewersProtected — قائمة المشاهدين (للمدير والمعلم)
// ══════════════════════════════════════════════════════════════════
function getNewsViewersProtected(params) {
  return withAuth(params, function(session) {
    try {
      var newsId = _safeStr(params.newsId);
      if (!newsId) return { success: false, error: 'newsId مطلوب' };

      var sheet = _getSheet('اخبار_مشاهدات');
      if (!sheet) return { success: true, viewers: [], count: 0 };

      var data    = sheet.getDataRange().getValues();
      var viewers = [];
      for (var i = 1; i < data.length; i++) {
        if (_safeStr(data[i][0]) === newsId) {
          viewers.push({
            userId    : _safeStr(data[i][1]),
            userType  : _safeStr(data[i][2]),
            timestamp : _safeStr(data[i][3])
          });
        }
      }

      return { success: true, viewers: viewers, count: viewers.length };
    } catch (e) {
      Logger.log('getNewsViewersProtected error: ' + e.toString());
      return { success: false, error: e.message };
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// ④ toggleNewsLikeProtected — إعجاب / إلغاء إعجاب
// ══════════════════════════════════════════════════════════════════
function toggleNewsLikeProtected(params) {
  return withAuth(params, function(session) {
    try {
      var newsId   = _safeStr(params.newsId);
      var userId   = _safeStr(session.teacherName);
      var userName = _safeStr(session.teacherName);
      var userType = _safeStr(session.role || 'teacher');

      if (!newsId) return { success: false, error: 'newsId مطلوب' };

      var sheet = _getOrCreateSheet('اخبار_اعجابات', [
        'newsId', 'userId', 'userName', 'userType', 'timestamp'
      ]);

      var data      = sheet.getDataRange().getValues();
      var foundRow  = -1;
      for (var i = 1; i < data.length; i++) {
        if (_safeStr(data[i][0]) === newsId &&
            _safeStr(data[i][1]) === userId) {
          foundRow = i + 1; break;
        }
      }

      var liked;
      if (foundRow > 0) {
        // إلغاء الإعجاب
        sheet.deleteRow(foundRow);
        liked = false;
      } else {
        // إضافة إعجاب
        sheet.appendRow([newsId, userId, userName, userType, _nowString()]);
        liked = true;
      }
      SpreadsheetApp.flush();

      // ★ إبطال كاش الأخبار بعد التعديل
      clearNewsCache();

      // إعادة الإحصاء
      var allLikes = _getLikesForNews(newsId);
      return {
        success    : true,
        liked      : liked,
        likesCount : allLikes.length,
        firstLikers: _firstN(allLikes, 3, 'userName')
      };
    } catch (e) {
      Logger.log('toggleNewsLikeProtected error: ' + e.toString());
      return { success: false, error: e.message };
    }
  });
}
// ══════════════════════════════════════════════════════════════════
// ⑤ دوال مساعدة داخلية لنظام الأخبار
// ══════════════════════════════════════════════════════════════════

// يُعيد map: { newsId: [{userId, userName, userType, timestamp}, ...] }
function _getLikesMap() {
  var map   = {};
  var sheet = _getSheet('اخبار_اعجابات');
  if (!sheet) return map;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var nid = _safeStr(data[i][0]);
    if (!nid) continue;
    if (!map[nid]) map[nid] = [];
    map[nid].push({
      userId    : _safeStr(data[i][1]),
      userName  : _safeStr(data[i][2]),
      userType  : _safeStr(data[i][3]),
      timestamp : _safeStr(data[i][4])
    });
  }
  return map;
}

// يُعيد map: { newsId: [{userId, userType, timestamp}, ...] }
function _getViewsMap() {
  var map   = {};
  var sheet = _getSheet('اخبار_مشاهدات');
  if (!sheet) return map;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var nid = _safeStr(data[i][0]);
    if (!nid) continue;
    if (!map[nid]) map[nid] = [];
    map[nid].push({
      userId    : _safeStr(data[i][1]),
      userType  : _safeStr(data[i][2]),
      timestamp : _safeStr(data[i][3])
    });
  }
  return map;
}

// إعجابات خبر محدد فقط (أسرع من getLikesMap كله)
function _getLikesForNews(newsId) {
  var out   = [];
  var sheet = _getSheet('اخبار_اعجابات');
  if (!sheet) return out;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (_safeStr(data[i][0]) === newsId) {
      out.push({
        userId    : _safeStr(data[i][1]),
        userName  : _safeStr(data[i][2]),
        userType  : _safeStr(data[i][3]),
        timestamp : _safeStr(data[i][4])
      });
    }
  }
  return out;
}

// أول N عنصر من مصفوفة مع استخراج حقل معين
function _firstN(arr, n, field) {
  var out = [];
  for (var i = 0; i < arr.length && i < n; i++) {
    out.push(field ? arr[i][field] : arr[i]);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
// ⑥ getNewsStatsProtected — إحصائيات كل خبر (للمدير)
// ══════════════════════════════════════════════════════════════════
function getNewsStatsProtected(params) {
  return withAuth(params, function(session) {
    try {
      var newsId  = _safeStr(params.newsId);
      var role    = _safeStr(session.role || 'teacher');
      var myName  = _safeStr(session.teacherName || '');
      var isAdminRole = session.isAdmin ||
                        role === 'admin' ||
                        role === 'deputy';

      if (!newsId) return { success: false, error: 'newsId مطلوب' };

      // ── التحقق من الصلاحية ────────────────────────────────────
      // المدير/الوكيل: يرون كل شيء
      // المعلم/المشرف: يرون فقط إحصاءات أخبارهم
      if (!isAdminRole) {
        var newsSheet = _getSheet('الاخبار');
        var canView   = false;

        if (newsSheet) {
          var newsData = newsSheet.getDataRange().getValues();
          for (var ni = 1; ni < newsData.length; ni++) {
            if (_safeStr(newsData[ni][0]) === newsId) {
              var newsTeacher = _safeStr(newsData[ni][1]);
              if (newsTeacher === myName) { canView = true; }
              break;
            }
          }
        }

        if (!canView) {
          return { success: false, error: 'لا تملك صلاحية رؤية إحصاءات هذا الخبر' };
        }
      }

      // ── جلب المشاهدات مع userType ────────────────────────────
      var views  = [];
      var vSheet = _getSheet('اخبار_مشاهدات');
      if (vSheet) {
        var vData = vSheet.getDataRange().getValues();
        for (var vi = 1; vi < vData.length; vi++) {
          if (_safeStr(vData[vi][0]) === newsId) {
            views.push({
              userId   : _safeStr(vData[vi][1]),
              userType : _safeStr(vData[vi][2]),
              ts       : _safeStr(vData[vi][3])
            });
          }
        }
      }

      // ── جلب الإعجابات مع userType ────────────────────────────
      var allLikes = _getLikesForNews(newsId);

      // ── جلب مشاهدات وإعجابات الطلاب من ملف الطالب ──────────────
      try {
        var studentFile   = _getSSById(_activeFileId());
        var studentVSheet = studentFile.getSheetByName('اخبار_مشاهدات');
        if (studentVSheet) {
          var svData = studentVSheet.getDataRange().getValues();
          for (var svi = 1; svi < svData.length; svi++) {
            if (_safeStr(svData[svi][0]) === newsId) {
              views.push({
                userId   : _safeStr(svData[svi][1]),
                userType : 'student',
                ts       : _safeStr(svData[svi][3])
              });
            }
          }
        }

        var studentLSheet = studentFile.getSheetByName('اخبار_اعجابات');
        if (studentLSheet) {
          var slData = studentLSheet.getDataRange().getValues();
          for (var sli2 = 1; sli2 < slData.length; sli2++) {
            if (_safeStr(slData[sli2][0]) === newsId) {
              allLikes.push({
                userId   : _safeStr(slData[sli2][1]),
                userName : _safeStr(slData[sli2][2]),
                userType : 'student',
                timestamp: _safeStr(slData[sli2][4])
              });
            }
          }
        }
      } catch (stErr) {
        Logger.log('getNewsStatsProtected: تعذر جلب بيانات الطلاب: ' + stErr.message);
      }

      // ── الإحصاء والتصنيف ─────────────────────────────────────
      var teacherViews  = [];
      var studentViews  = [];
      var teacherLikers = [];
      var studentLikers = [];

      for (var tvi = 0; tvi < views.length; tvi++) {
        if (views[tvi].userType === 'student') {
          studentViews.push(views[tvi]);
        } else {
          teacherViews.push(views[tvi]);
        }
      }

      for (var tli = 0; tli < allLikes.length; tli++) {
        if (allLikes[tli].userType === 'student') {
          studentLikers.push(allLikes[tli]);
        } else {
          teacherLikers.push(allLikes[tli]);
        }
      }

      return {
        success       : true,
        newsId        : newsId,
        viewsCount    : views.length,
        likesCount    : allLikes.length,
        viewers       : views,
        likers        : allLikes,
        teacherViews  : teacherViews,
        studentViews  : studentViews,
        teacherLikers : teacherLikers,
        studentLikers : studentLikers
      };
    } catch (e) {
      Logger.log('getNewsStatsProtected error: ' + e.toString());
      return { success: false, error: e.message };
    }
  });
}
// ══════════════════════════════════════════════════════════════════
//  تغليف آمن لجلب خبر/واجب بمعرفه — يضمن التحقق من الجلسة
//  أُضيفت في إصلاح أبريل 2026 (Patch #1)
// ══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ✦ Patch #1 — أبريل 2026
// ✦ تأمين دوال جلب الواجب والخبر بـ token + التحقق من صلاحية المعلم
// ✦ هذه الدوال top-level (يجب ألا تكون مزاحة) ومكشوفة لـ google.script.run
// ✦ تعتمد على: withAuth() في TeacherAuth.gs، و getHomework()/getNews() الموجودتين أعلاه
// ═══════════════════════════════════════════════════════════════════════════

/**
 * جلب واجب بمعرفه — نسخة محميّة بـ token
 *
 * @param {Object} params - { token: String, id: String|Number }
 * @returns {Object} { success: true, data: {...} } | { success: false, error: String }
 *
 * صلاحيات الوصول:
 *   - admin / deputy / supervisor → يصل لكل الواجبات
 *   - teacher → يصل فقط للواجبات في فصوله ومادته
 */
function getHomeworkProtected(params) {
  return withAuth(params, function(session) {
    try {
      var id = (params && params.id != null) ? String(params.id).trim() : '';
      if (!id) return { success: false, error: 'معرّف الواجب مفقود' };

      // استدعاء الدالة الأصلية الموجودة في TeacherCore.gs
      var hw = getHomework(id);

      // معالجة شكلَي الإرجاع: كائن خبر صحيح، أو { success:false, error }
      if (!hw || hw.success === false) {
        var errMsg = (hw && hw.error) ? hw.error : 'لم يتم العثور على الواجب';
        return { success: false, error: errMsg };
      }

      // تحقق صلاحية المعلم (المدير/الوكيل/المشرف معفون)
      if (!session.isAdmin && session.role !== 'deputy' && session.role !== 'supervisor') {
        var allowedClasses  = session.classes  || [];
        var allowedSubjects = session.subjects || [];
        var hasAllClasses   = (allowedClasses.indexOf('جميع الفصول') !== -1);
        var hasAllSubjects  = (allowedSubjects.indexOf('جميع المواد') !== -1);

        if (!hasAllClasses && allowedClasses.indexOf(hw.grade) === -1) {
          Logger.log('getHomeworkProtected: blocked teacher=' + session.teacherName +
                     ' from grade=' + hw.grade + ' (id=' + id + ')');
          return { success: false, error: 'غير مصرح لك بهذا الواجب (فصل خارج صلاحياتك)' };
        }
        if (!hasAllSubjects && allowedSubjects.indexOf(hw.subject) === -1) {
          Logger.log('getHomeworkProtected: blocked teacher=' + session.teacherName +
                     ' from subject=' + hw.subject + ' (id=' + id + ')');
          return { success: false, error: 'غير مصرح لك بهذا الواجب (مادة خارج صلاحياتك)' };
        }
      }

      return { success: true, data: hw };

    } catch (e) {
      Logger.log('getHomeworkProtected error: ' + e.toString());
      return { success: false, error: 'getHomeworkProtected: ' + e.message };
    }
  });
}

/**
 * جلب خبر بمعرفه — نسخة محميّة بـ token
 *
 * @param {Object} params - { token: String, id: String|Number }
 * @returns {Object} { success: true, data: {...} } | { success: false, error: String }
 *
 * صلاحيات الوصول:
 *   - admin / deputy / supervisor → يصل لكل الأخبار
 *   - teacher → يصل فقط لأخباره أو الأخبار الموجهة لفصوله
 */
function getNewsByIdProtected(params) {
  return withAuth(params, function(session) {
    try {
      var id = (params && params.id != null) ? String(params.id).trim() : '';
      if (!id) return { success: false, error: 'معرّف الخبر مفقود' };

      // استدعاء الدالة الأصلية الموجودة في TeacherCore.gs
      var n = getNews(id);

      if (!n || n.success === false) {
        var errMsg = (n && n.error) ? n.error : 'لم يتم العثور على الخبر';
        return { success: false, error: errMsg };
      }

      // تحقق صلاحية المعلم (المدير/الوكيل/المشرف معفون)
      if (!session.isAdmin && session.role !== 'deputy' && session.role !== 'supervisor') {
        var isOwner        = (n.teacher === session.teacherName);
        var allowedClasses = session.classes || [];
        var hasAllClasses  = (allowedClasses.indexOf('جميع الفصول') !== -1);
        var inMyClasses    = hasAllClasses || (allowedClasses.indexOf(n.grade) !== -1);

        if (!isOwner && !inMyClasses) {
          Logger.log('getNewsByIdProtected: blocked teacher=' + session.teacherName +
                     ' from news id=' + id + ' (owner=' + n.teacher + ', grade=' + n.grade + ')');
          return { success: false, error: 'غير مصرح لك بهذا الخبر' };
        }
      }

      return { success: true, data: n };

    } catch (e) {
      Logger.log('getNewsByIdProtected error: ' + e.toString());
      return { success: false, error: 'getNewsByIdProtected: ' + e.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// نهاية Patch #1
// ═══════════════════════════════════════════════════════════════════════════
/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  PATCH-03 : تسريع جلب الأخبار + توحيد روابط الصور               ║
 * ║  ملف الهدف: TeacherCore.gs                                       ║
 * ║                                                                    ║
 * ║  ⚙️ طريقة التطبيق:                                                ║
 * ║  افتح TeacherCore.gs → الصق هذه الدوال في نهاية الملف             ║
 * ║  (ليست استبدالاً، بل إضافة)                                       ║
 * ║                                                                    ║
 * ║  ✅ الفوائد:                                                       ║
 * ║  - الأخبار تُجلب بكاش 60 ثانية (من 3-5 ثوان إلى أقل من 200ms)    ║
 * ║  - migrateNewsImagesToThumbnail يصلح أي رابط قديم في الشيت        ║
 * ║  - validateNewsImages تتحقق من صحة الروابط (تشخيص)                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

// ══════════════════════════════════════════════════════════════════
// ① ترحيل كل روابط الأخبار القديمة إلى صيغة thumbnail الموحّدة
//    شغّلها مرة واحدة من المحرر بعد التحديث
// ══════════════════════════════════════════════════════════════════
function migrateNewsImagesToThumbnail() {
  try {
    var sheet = _getSheet('الاخبار');
    if (!sheet) {
      Logger.log('❌ ورقة الاخبار غير موجودة');
      return { success: false, error: 'ورقة الاخبار غير موجودة' };
    }

    var data    = sheet.getDataRange().getValues();
    var updated = 0;
    var skipped = 0;
    var errors  = 0;

    for (var i = 1; i < data.length; i++) {
      var row        = data[i];
      var attachment = _safeStr(row[5]);   // العمود F = الملحقات
      if (!attachment || attachment.indexOf('http') !== 0) {
        skipped++;
        continue;
      }

      try {
        // إذا كان رابط YouTube أو فيديو خارجي → اتركه
        var lower = attachment.toLowerCase();
        if (lower.indexOf('youtube.com') !== -1 ||
            lower.indexOf('youtu.be')   !== -1 ||
            lower.indexOf('vimeo.com')  !== -1 ||
            /\.(mp4|webm|mov|avi)(\?.*)?$/.test(lower)) {
          skipped++;
          continue;
        }

        // إذا كان PDF → اتركه
        if (lower.indexOf('.pdf') !== -1) {
          skipped++;
          continue;
        }

        // استخراج fileId
        var fileId = _extractDriveIdFromUrl(attachment);
        if (!fileId) {
          // ليس رابط Drive — نتركه
          skipped++;
          continue;
        }

        // الصيغة المستهدفة الموحّدة
        var newUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000';

        // إذا كان الرابط مطابقاً مسبقاً، تخطى
        if (attachment === newUrl) {
          skipped++;
          continue;
        }

        sheet.getRange(i + 1, 6).setValue(newUrl);
        updated++;
      } catch (rowErr) {
        Logger.log('خطأ في الصف ' + (i + 1) + ': ' + rowErr.toString());
        errors++;
      }
    }

    // تنظيف كاش الأخبار بعد الترحيل
    _tcCacheDel('news_all_v2');

    var msg = '✅ تم ترحيل ' + updated + ' رابط | تم تخطي ' + skipped +
              ' | أخطاء: ' + errors;
    Logger.log(msg);
    return { success: true, updated: updated, skipped: skipped, errors: errors, message: msg };
  } catch (e) {
    Logger.log('migrateNewsImagesToThumbnail error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ══════════════════════════════════════════════════════════════════
// ② _extractDriveIdFromUrl — استخراج موحّد لأي رابط Drive
// ══════════════════════════════════════════════════════════════════
function _extractDriveIdFromUrl(url) {
  if (!url) return '';
  var s = '' + url;

  var patterns = [
    /\/d\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /thumbnail\?id=([a-zA-Z0-9_-]{20,})/,
    /open\?id=([a-zA-Z0-9_-]{20,})/,
    /uc\?export=[a-z]+&id=([a-zA-Z0-9_-]{20,})/
  ];

  for (var i = 0; i < patterns.length; i++) {
    var m = s.match(patterns[i]);
    if (m && m[1]) return m[1];
  }
  return '';
}

// ══════════════════════════════════════════════════════════════════
// ③ validateNewsImages — تشخيص: ما هي الروابط الكسورة؟
// ══════════════════════════════════════════════════════════════════
function validateNewsImages() {
  var sheet = _getSheet('الاخبار');
  if (!sheet) return { success: false, error: 'ورقة الاخبار غير موجودة' };

  var data    = sheet.getDataRange().getValues();
  var report  = {
    total       : data.length - 1,
    withImage   : 0,
    thumbnail   : 0,
    legacyDrive : 0,
    youtube     : 0,
    pdf         : 0,
    direct      : 0,
    broken      : 0,
    samples     : []
  };

  for (var i = 1; i < data.length; i++) {
    var url = _safeStr(data[i][5]);
    if (!url) continue;
    report.withImage++;

    var lower = url.toLowerCase();
    var category = 'broken';

    if (url.indexOf('thumbnail?id=') !== -1) {
      report.thumbnail++; category = 'thumbnail';
    } else if (lower.indexOf('youtube') !== -1 || lower.indexOf('youtu.be') !== -1) {
      report.youtube++; category = 'youtube';
    } else if (lower.indexOf('.pdf') !== -1) {
      report.pdf++; category = 'pdf';
    } else if (_extractDriveIdFromUrl(url)) {
      report.legacyDrive++; category = 'legacyDrive';
    } else if (/\.(jpg|jpeg|png|gif|webp)/i.test(lower)) {
      report.direct++; category = 'direct';
    } else {
      report.broken++;
    }

    if (report.samples.length < 8) {
      report.samples.push({ row: i + 1, type: category, url: url });
    }
  }

  Logger.log('📊 تقرير الأخبار: ' + JSON.stringify(report, null, 2));
  return { success: true, report: report };
}

// ══════════════════════════════════════════════════════════════════
// ④ getAllNewsCached — نسخة سريعة بكاش 60 ثانية
//    تستدعى من Teacher Dashboard كبديل لـ getAllNewsProtected
//    عند عدم الحاجة لفلاتر معقدة
// ══════════════════════════════════════════════════════════════════
function getAllNewsCached(params) {
  return withAuth(params, function(session) {
    try {
      var grade   = _safeStr(params.grade   || '');
      var section = _safeStr(params.section || '');
      var page    = parseInt(params.page     || 1, 10);
      var pageSize= parseInt(params.pageSize || 20, 10);

      var cacheKey = 'news_v3_' + grade + '_' + section + '_' + page + '_' + pageSize;
      var cached   = _tcCacheGet(cacheKey);
      if (cached) {
        cached.fromCache = true;
        return { success: true, news: cached.news, total: cached.total, fromCache: true };
      }

      var sheet = _getSheet('الاخبار');
      if (!sheet) return { success: true, news: [], total: 0 };

      // خرائط المشاهدات والإعجابات الموحدة
      var viewsMap = _getCombinedViewsMap();
      var likesMap = _getCombinedLikesMap();

      var data = sheet.getDataRange().getValues();
      var out  = [];

      for (var i = 1; i < data.length; i++) {
        var r = data[i];
        var newsId = _safeStr(r[0]);
        if (!newsId) continue;

        var rGrade   = _safeStr(r[2]);
        var rSection = _safeStr(r[3]);

        // فلترة الفصل والشعبة
        if (grade && rGrade !== grade && rGrade !== 'الكل' && rGrade !== 'جميع الفصول') continue;
        if (section && rSection !== section && rSection !== 'الكل' && rSection !== 'جميع الشعب') continue;

        // توحيد رابط الصورة
        var attUrl = _safeStr(r[5]);
        if (attUrl) {
          var fid = _extractDriveIdFromUrl(attUrl);
          var lower = attUrl.toLowerCase();
          if (fid && lower.indexOf('youtube') === -1 && lower.indexOf('.pdf') === -1) {
            attUrl = 'https://drive.google.com/thumbnail?id=' + fid + '&sz=w1000';
          }
        }

        // إحصائيات هذا الخبر
        var vArr = viewsMap[newsId] || [];
        var lArr = likesMap[newsId] || [];

        out.push({
          id          : newsId,
          teacher     : _safeStr(r[1]),
          grade       : rGrade,
          section     : rSection,
          news        : _safeStr(r[4]),
          attachments : attUrl,
          date        : _safeStr(r[6]),
          isOwner     : (_safeStr(r[1]) === session.teacherName),
          viewsCount  : vArr.length,
          likesCount  : lArr.length,
          firstLikers : lArr.slice(0, 3).map(function(like) { return like.userName; })
        });
      }

      // ترتيب من الأحدث للأقدم
      out.sort(function(a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });

      var total      = out.length;
      var startIdx   = (page - 1) * pageSize;
      var pagedNews  = out.slice(startIdx, startIdx + pageSize);

      var result = { news: pagedNews, total: total };
      _tcCacheSet(cacheKey, result, 60);   // كاش 60 ثانية فقط

      return { success: true, news: pagedNews, total: total, fromCache: false };
    } catch (e) {
      Logger.log('getAllNewsCached error: ' + e.toString());
      return { success: false, error: e.toString() };
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// ⑤ مسح كاش الأخبار يدوياً (يُستدعى بعد إضافة/تعديل/حذف خبر)
// ══════════════════════════════════════════════════════════════════
function clearNewsCache() {
  try {
    var cache = CacheService.getScriptCache();
    // لا توجد طريقة لحذف بكل المفاتيح المطابقة لنمط، لذا نمسح الأكثر شيوعاً
    var commonKeys = [
      'news_all_v2',
      'news_v2___1_20', 'news_v2___2_20', 'news_v2___3_20',
      'news_v2___1_50', 'news_v2___2_50',
      'news_all_protected_v1'
    ];
    cache.removeAll(commonKeys);
    Logger.log('✅ تم مسح كاش الأخبار');
    return { success: true };
  } catch (e) {
    Logger.log('clearNewsCache error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ══════════════════════════════════════════════════════════════════
// ⑥ تشخيص شامل لمنصة المعلم — يُستدعى من المحرر فقط
// ══════════════════════════════════════════════════════════════════
function teacherDashboardHealthCheck() {
  var report = {
    timestamp : _nowString(),
    sheets    : {},
    drive     : { folderAccessible: false, folderName: '' },
    cache     : { working: false },
    issues    : []
  };

  // فحص الأوراق الأساسية
  var requiredSheets = [
    'الاخبار', 'الطلاب', 'الواجبات', 'المخالفات',
    'الملاحظات', 'المدرسين', 'الدرجات', 'الاعدادات'
  ];
  for (var i = 0; i < requiredSheets.length; i++) {
    var name = requiredSheets[i];
    var sh   = _getSheet(name);
    if (sh) {
      report.sheets[name] = { exists: true, rows: sh.getLastRow(), cols: sh.getLastColumn() };
    } else {
      report.sheets[name] = { exists: false };
      report.issues.push('⚠️ ورقة "' + name + '" غير موجودة');
    }
  }

  // فحص مجلد Drive
  try {
    var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    report.drive.folderAccessible = true;
    report.drive.folderName       = folder.getName();
  } catch (e) {
    report.issues.push('⚠️ تعذّر الوصول إلى مجلد Drive: ' + e.message);
  }

  // فحص الكاش
  try {
    _tcCacheSet('healthcheck_test', { ok: true }, 10);
    var v = _tcCacheGet('healthcheck_test');
    report.cache.working = !!(v && v.ok);
    _tcCacheDel('healthcheck_test');
  } catch (e) {
    report.issues.push('⚠️ مشكلة في الكاش: ' + e.message);
  }

  Logger.log('🏥 تقرير صحة المنصة: ' + JSON.stringify(report, null, 2));
  return report;
}
function quickReport() {
  var h = teacherDashboardHealthCheck();
  var v = validateNewsImages();
  Logger.log('🏥 الصحة: ' + JSON.stringify(h.issues));
  Logger.log('📰 الأخبار: ' + JSON.stringify(v.report));
}
function testDriveUpload() {
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var blob = Utilities.newBlob("اختبار", "text/plain", "test.txt");
  var file = folder.createFile(blob);
  var fileId = file.getId();
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    Logger.log("✅ نجح: الرابط العام هو " + file.getUrl());
  } catch(e) {
    Logger.log("❌ فشل: " + e.message);
  }
}
function testUploadOnly() {
  var testBlob = Utilities.newBlob("اختبار", "text/plain", "test.txt");
  var result = uploadFileToDrive(
    Utilities.base64Encode(testBlob.getBytes()),
    "test.txt",
    "text/plain"
  );
  Logger.log("نتيجة الرفع: " + JSON.stringify(result));
  if (result && result.webViewLink) {
    Logger.log("✅ الرابط: " + result.webViewLink);
  } else {
    Logger.log("❌ فشل في الحصول على الرابط");
  }
}
/**
 * حساب درجة الأعمال المستمرة (من 20) للشهور النهائية
 * القاعدة: round(إجمالي الشهر السابق ÷ 10)
 * نصف العام  : round(محرم/10) + round(صفر/10)
 * نهاية العام: round(جماد اول/10) + round(جماد ثاني/10)
 * 
 * @param {Sheet}  sheet        - ورقة النصفي
 * @param {string} studentCode  - كود الطالب
 * @param {string} subject      - اسم المادة
 * @param {string} termMonth    - 'نصف العام' أو 'نهاية العام'
 * @returns {number|null} درجة الأعمال المستمرة من 20، أو null إذا لم توجد بيانات
 */
/**
 * حساب درجة الأعمال المستمرة (من 20) للشهور الفصلية
 * القاعدة الإلزامية:
 *   نصف العام   = round(إجمالي محرم ÷ 10) + round(إجمالي صفر ÷ 10)
 *   نهاية العام = round(إجمالي جماد أول ÷ 10) + round(إجمالي جماد ثاني ÷ 10)
 * النتيجة من 20 (10 + 10 كحد أقصى)
 *
 * @param {Sheet}  sheet        - ورقة النصفي
 * @param {string} studentCode  - كود الطالب
 * @param {string} subject      - اسم المادة
 * @param {string} termMonth    - 'نصف العام' أو 'نهاية العام'
 * @returns {number|null} درجة من 20، أو null إذا لم توجد بيانات سابقة
 */
/**
 * _calcTermMonthlyScore — يستدعي الطبقة الموحدة GS_computeTermMonthly
 * يحافظ على نفس التوقيع القديم.
 */
function _calcTermMonthlyScore(sheet, studentCode, subject, termMonth) {
  var studentMap = _getStudentRowMap();
  var rowIndex = studentMap[studentCode];
  if (!rowIndex) return null;

  /* قارئ إجمالي الشهر العادي — Closure على الشيت والطالب */
  var readMonthTotal = function(monthName, subj) {
    var loc = _findSubjectLocation(monthName, subj);
    if (!loc.success || loc.isTermMonth) return null;
    var cols = loc.columns;

    var behavior = _safeNum(sheet.getRange(rowIndex, cols.behavior + 1).getValue());
    var homework = _safeNum(sheet.getRange(rowIndex, cols.homework + 1).getValue());
    var oral     = _safeNum(sheet.getRange(rowIndex, cols.oral + 1).getValue());
    var written  = _safeNum(sheet.getRange(rowIndex, cols.written + 1).getValue());

    var hasAny = (behavior !== null) || (homework !== null)
              || (oral !== null)     || (written !== null);
    if (!hasAny) return null;

    return (behavior || 0) + (homework || 0) + (oral || 0) + (written || 0);
  };

  return GS_computeTermMonthly(termMonth, subject, readMonthTotal);
}

/* ════════════════════════════════════════════════════════════════
 *  حفظ «نهاية العام» — هيكل 5 أعمدة (نتيجة العام /100):
 *    المحصلة1 (تلقائي محرم+صفر /20) | النصفي (محمول من نصف العام /30)
 *    المحصلة2 (تلقائي جماد اول+ثاني /20) | النهائي (يُدخله المعلم /30)
 *    الاجمالي (تلقائي = المجموع /100)
 *  examValue = درجة الاختبار النهائي القادمة من واجهة المعلم.
 * ════════════════════════════════════════════════════════════════ */
function _saveYearEndGrade(sheet, rowIndex, subject, examValue) {
  var yc = _teacherYearEndCols(sheet, subject);
  var lastCol = _getGradeHeaders(sheet).lastCol;
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

  /* النهائي (يُدخله المعلم) */
  var fxn = _safeNum(examValue);
  if (fxn !== null && fxn >= 0 && fxn <= 30 && yc.finalEx !== undefined) {
    sheet.getRange(rowIndex, yc.finalEx + 1).setValue(fxn);
  }
  /* محصلة الفصل الأول (محرم + صفر) */
  var m1 = _yeSumLocs(row, [_findSubjectLocation('محرم', subject), _findSubjectLocation('صفر', subject)]);
  if (m1 !== null && yc.m1 !== undefined) sheet.getRange(rowIndex, yc.m1 + 1).setValue(m1);
  /* محصلة الفصل الثاني (جماد اول + جماد ثاني) */
  var m2 = _yeSumLocs(row, [_findSubjectLocation('جماد اول', subject), _findSubjectLocation('جماد ثاني', subject)]);
  if (m2 !== null && yc.m2 !== undefined) sheet.getRange(rowIndex, yc.m2 + 1).setValue(m2);
  /* النصفي محمول من بلوك «نصف العام» */
  var midV = null;
  var nf = _findSubjectLocation('نصف العام', subject);
  if (nf.success && nf.columns.exam_score >= 0) {
    var mv = row[nf.columns.exam_score];
    midV = (mv === '' || mv === null || mv === undefined) ? null : _safeNum(mv);
    if (midV !== null && yc.midterm !== undefined) sheet.getRange(rowIndex, yc.midterm + 1).setValue(midV);
  }
  /* الاجمالي /100 = محصلة1 + نصفي + محصلة2 + نهائي */
  var finalForTotal = (fxn !== null) ? fxn
                      : ((yc.finalEx !== undefined) ? _safeNum(row[yc.finalEx]) : null);
  var gt = (m1 || 0) + (midV || 0) + (m2 || 0) + (finalForTotal || 0);
  if (gt > 100) gt = 100;
  gt = Math.round(gt * 10) / 10;
  if (yc.total !== undefined) sheet.getRange(rowIndex, yc.total + 1).setValue(gt);

  return { m1: m1, midterm: midV, m2: m2, finalExam: finalForTotal, total: gt };
}

/* يحدّد أعمدة «نهاية العام» الخمسة لمادة بحسب أسماء صف 3 (typeRow) */
function _teacherYearEndCols(sheet, subject) {
  var lastCol = sheet.getLastColumn();
  var headers = _getGradeHeaders(sheet).headers;
  var monthRow = headers[0], subjectRow = headers[1], typeRow = headers[2];
  var VALID = ['محرم', 'صفر', 'ربيع اول', 'ربيع ثاني', 'جماد اول', 'جماد ثاني',
               'رجب', 'شعبان', 'نصف العام', 'نهاية العام'];
  var filled = [], lastM = '';
  for (var i = 0; i < monthRow.length; i++) {
    var mc = _safeStr(monthRow[i]);
    if (VALID.indexOf(mc) !== -1) { lastM = mc; filled.push(mc); }
    else if (mc === '' && lastM) { filled.push(lastM); }
    else { filled.push(''); lastM = ''; }
  }
  var map = {
    m1:      ['المحصلة1', 'محصلة1'],
    midterm: ['النصفي'],
    m2:      ['المحصلة2', 'محصلة2'],
    finalEx: ['النهائي', 'الاختبار النهائي'],
    total:   ['الاجمالي', 'الإجمالي', 'المجموع']
  };
  var cols = {};
  for (var c = 0; c < filled.length; c++) {
    if (filled[c] !== 'نهاية العام') continue;
    if (_safeStr(subjectRow[c]) !== subject) continue;
    var lab = _safeStr(typeRow[c]);
    for (var k in map) {
      if (map.hasOwnProperty(k) && cols[k] === undefined && map[k].indexOf(lab) !== -1) cols[k] = c;
    }
  }
  return cols;
}

/* مجموع «الأعمال المستمرة» عبر أشهر عادية: لكل شهر round(مجموع الأعمدة الأربعة/10) ثم clamp /20 */
function _teacherMonthlyFromMonths(sheet, rowIndex, subject, monthsArr) {
  var total = 0, foundAny = false;
  for (var i = 0; i < monthsArr.length; i++) {
    var loc = _findSubjectLocation(monthsArr[i], subject);
    if (!loc.success || loc.isTermMonth) continue;
    var c = loc.columns;
    var b = _safeNum(sheet.getRange(rowIndex, c.behavior + 1).getValue());
    var h = _safeNum(sheet.getRange(rowIndex, c.homework + 1).getValue());
    var o = _safeNum(sheet.getRange(rowIndex, c.oral + 1).getValue());
    var w = _safeNum(sheet.getRange(rowIndex, c.written + 1).getValue());
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

/* مجموع الأعمال المستمرة من صف في الذاكرة عبر مواقع أشهر مُحضّرة مسبقاً (بلا قراءة شيت متكررة) */
function _yeSumLocs(row, locs) {
  var total = 0, found = false;
  for (var i = 0; i < locs.length; i++) {
    var loc = locs[i];
    if (!loc || !loc.success || loc.isTermMonth) continue;
    var c = loc.columns;
    var b = _safeNum(row[c.behavior]), h = _safeNum(row[c.homework]);
    var o = _safeNum(row[c.oral]),     w = _safeNum(row[c.written]);
    if (b !== null || h !== null || o !== null || w !== null) {
      var mt = (b || 0) + (h || 0) + (o || 0) + (w || 0);
      var sc = Math.round(mt / 10);
      if (sc > 10) sc = 10;
      total += sc; found = true;
    }
  }
  if (total > 20) total = 20;
  return found ? total : null;
}

/* يحسب قيم نهاية العام الخمسة من صف الطالب (في الذاكرة) — يقرأ الخلية إن وُجدت وإلا يحسب */
function _yeComputeFromRow(row, yeCols, yeNisfExam, yeSrc) {
  function rawAt(idx) {
    if (idx === undefined || idx === null || idx < 0) return null;
    var v = row[idx];
    return (v === '' || v === null || v === undefined) ? null : v;
  }
  var m1 = rawAt(yeCols.m1), mid = rawAt(yeCols.midterm), m2 = rawAt(yeCols.m2);
  var fin = rawAt(yeCols.finalEx), tot = rawAt(yeCols.total);

  m1 = (m1 !== null) ? _safeNum(m1) : _yeSumLocs(row, yeSrc.t1);   /* محرم + صفر */
  m2 = (m2 !== null) ? _safeNum(m2) : _yeSumLocs(row, yeSrc.t2);   /* جماد اول + جماد ثاني */
  if (mid !== null) { mid = _safeNum(mid); }
  else if (yeNisfExam >= 0) {                                       /* النصفي محمول من بلوك نصف العام */
    var mv = row[yeNisfExam];
    mid = (mv === '' || mv === null || mv === undefined) ? null : _safeNum(mv);
  }
  fin = (fin !== null) ? _safeNum(fin) : null;

  var total;
  if (tot !== null) { total = _safeNum(tot); }
  else {
    var any = (m1 !== null || mid !== null || m2 !== null || fin !== null);
    var sum = (m1 || 0) + (mid || 0) + (m2 || 0) + (fin || 0);
    total = any ? (sum > 100 ? 100 : Math.round(sum * 10) / 10) : null;
  }
  return { m1: m1, mid: mid, m2: m2, fin: fin, total: total };
}
/**
 * عند تعديل درجة في شهر عادي، يُعاد حساب الأعمال المستمرة والمحصلة
 * للشهر الفصلي المرتبط (نصف العام أو نهاية العام)
 *
 * محرم/صفر          → نصف العام
 * جماد اول/جماد ثاني → نهاية العام
 *
 * @param {Sheet}  sheet
 * @param {string} studentCode
 * @param {string} subject
 * @param {string} regularMonth - الشهر العادي الذي تم تعديله
 */
function _recalcLinkedTermMonth(sheet, studentCode, subject, regularMonth) {
  /* ─── v3.1: هذا الاستدعاء من السيرفر وليس من المستخدم،
       لذلك لا يمر عبر _isWriteAllowed. ─── */
  var INTERNAL_WRITE = true;

  var termMonth = null;
  if (regularMonth === 'محرم' || regularMonth === 'صفر') {
    termMonth = 'نصف العام';
  } else if (regularMonth === 'جماد اول' || regularMonth === 'جماد ثاني') {
    termMonth = 'نهاية العام';
  }
  if (!termMonth) return;

  var termLoc = _findSubjectLocation(termMonth, subject);
  if (!termLoc.success || !termLoc.isTermMonth) return;

  var studentMap = _getStudentRowMap();
  var rowIndex = studentMap[studentCode];
  if (!rowIndex) return;

  var cols = termLoc.columns;

  // 1) إعادة حساب المحصلة
  var autoMonthly = _calcTermMonthlyScore(sheet, studentCode, subject, termMonth);
  if (autoMonthly !== null && cols.monthly_score >= 0) {
    sheet.getRange(rowIndex, cols.monthly_score + 1).setValue(autoMonthly);

    // 2) إعادة حساب المجموع إذا كان هناك exam_score مُدخل
    if (cols.exam_score >= 0 && cols.total_score >= 0) {
      var examVal = _safeNum(sheet.getRange(rowIndex, cols.exam_score + 1).getValue());
      if (examVal !== null) {
        var totalVal = autoMonthly + examVal;
        if (totalVal > 50) totalVal = 50;
        totalVal = Math.round(totalVal * 10) / 10;
        sheet.getRange(rowIndex, cols.total_score + 1).setValue(totalVal);
      }
    }
  }
}
function _getCombinedLikesMap() {
  var map = {};
  var sheet = _getSheet('اخبار_اعجابات');
  if (sheet) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var nid = _safeStr(data[i][0]);
      if (!nid) continue;
      if (!map[nid]) map[nid] = [];
      map[nid].push({ userId: _safeStr(data[i][1]), userName: _safeStr(data[i][2]), userType: _safeStr(data[i][3]) });
    }
  }
  try {
    var sf = _getSSById(_activeFileId());
    var sSheet = sf.getSheetByName('اخبار_اعجابات');
    if (sSheet) {
      var sData = sSheet.getDataRange().getValues();
      for (var j = 1; j < sData.length; j++) {
        var nid2 = _safeStr(sData[j][0]);
        if (!nid2) continue;
        if (!map[nid2]) map[nid2] = [];
        map[nid2].push({ userId: _safeStr(sData[j][1]), userName: _safeStr(sData[j][2]), userType: 'student' });
      }
    }
  } catch(e) {}
  return map;
}
/**
 * يُستدعى من الواجهة لتحميل تكوين Schema بدلاً من hard-coding
 */
function getSchemaConfig() {
  return {
    success: true,
    orderedMonths: GS_ORDERED_MONTHS,
    termMonths: ['نصف العام', 'نهاية العام'],
    regularSchema: GS_SCHEMA.regular.fields,
    termSchema: GS_SCHEMA.term.fields,
    derivedFrom: GS_SCHEMA.term.derivedFrom,
    version: '2.0'
  };
}

// ═══════════════════════════════════════════════════════════
//  غياب المعلمين — تسجيل المشرف/المدير/الوكيل + ملخّص بالأدوار
//  المعلم العادي يرى ملخّصه فقط؛ المدير/الوكيل/المشرف يرون الجميع.
// ═══════════════════════════════════════════════════════════
function _teacherAbsenceSheet() {
  return _getOrCreateSheet('غياب_المعلمين', [
    'اسم المدرس', 'الفصل', 'الشعبة', 'المادة', 'اليوم', 'الحصة',
    'النوع', 'نوع الغياب', 'المسجّل', 'التاريخ', 'ملاحظات'
  ]);
}

function recordTeacherAbsenceProtected(params) {
  return withAuth(params, function (session) {
    try {
      var role = _safeStr(session.role || 'teacher');
      var canRecord = session.isAdmin || role === 'admin' || role === 'deputy' || role === 'supervisor';
      if (!canRecord) return { success: false, error: 'غير مصرّح لك بتسجيل غياب المعلمين' };

      var teacher = _safeStr(params.teacherName || '');
      if (!teacher) return { success: false, error: 'اسم المعلم مطلوب' };

      var kind    = _safeStr(params.kind || 'يوم');         // يوم | حصة
      var absType = _safeStr(params.absType || 'بدون عذر');  // بعذر | بدون عذر | مكلف بمهمة
      var date    = _safeStr(params.date || '') || _nowString();
      var day     = _safeStr(params.day || '');
      var grade   = _safeStr(params.grade || '');
      var section = _safeStr(params.section || '');
      var subject = _safeStr(params.subject || '');
      var period  = _safeStr(params.period || '');
      var notes   = _safeStr(params.notes || '');
      var recorder = _safeStr(session.teacherName || session.name || '');

      _teacherAbsenceSheet().appendRow([
        teacher,
        (kind === 'يوم') ? 'كل الفصول' : grade,
        (kind === 'يوم') ? '' : section,
        (kind === 'يوم') ? '' : subject,
        day,
        (kind === 'يوم') ? '' : period,
        kind, absType, recorder, date, notes
      ]);
      return { success: true, message: 'تم تسجيل غياب المعلم: ' + teacher };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  });
}

function getTeacherAbsenceSummaryProtected(params) {
  return withAuth(params, function (session) {
    try {
      var role   = _safeStr(session.role || 'teacher');
      var isPriv = session.isAdmin || role === 'admin' || role === 'deputy' || role === 'supervisor';
      var myName = _safeStr(session.teacherName || session.name || '');
      var filterTeacher = _safeStr(params.teacherName || '');
      if (!isPriv) filterTeacher = myName; // المعلم العادي: نفسه فقط

      // إجمالي الحصص الأسبوعية لكل معلم من ورقة الجدول (عمود المعلم = 5)
      var periodsByT = {};
      var jsh = _getSheet('الجدول');
      if (jsh) {
        var jd = jsh.getDataRange().getValues();
        for (var j = 1; j < jd.length; j++) {
          var tn = _safeStr(jd[j][5]); if (!tn) continue;
          periodsByT[tn] = (periodsByT[tn] || 0) + 1;
        }
      }

      function _blank(t) {
        return { teacher: t, totalPeriods: periodsByT[t] || 0, absentDays: 0,
                 absentPeriods: 0, excused: 0, unexcused: 0, tasked: 0, records: [] };
      }

      var byT = {};
      var ash = _getSheet('غياب_المعلمين');
      if (ash) {
        var ad = ash.getDataRange().getValues();
        for (var i = 1; i < ad.length; i++) {
          var t = _safeStr(ad[i][0]); if (!t) continue;
          if (filterTeacher && t !== filterTeacher) continue;
          if (!byT[t]) byT[t] = _blank(t);
          var kind = _safeStr(ad[i][6]); var at = _safeStr(ad[i][7]);
          if (kind === 'يوم') byT[t].absentDays++; else byT[t].absentPeriods++;
          if (at.indexOf('بعذر') >= 0) byT[t].excused++;
          else if (at.indexOf('مكلف') >= 0) byT[t].tasked++;
          else byT[t].unexcused++;
          byT[t].records.push({
            grade: _safeStr(ad[i][1]), section: _safeStr(ad[i][2]), subject: _safeStr(ad[i][3]),
            day: _safeStr(ad[i][4]), period: _safeStr(ad[i][5]), kind: kind, type: at,
            recorder: _safeStr(ad[i][8]), date: _safeStr(ad[i][9]), notes: _safeStr(ad[i][10])
          });
        }
      }
      if (filterTeacher && !byT[filterTeacher]) byT[filterTeacher] = _blank(filterTeacher);

      var list = [];
      for (var k in byT) { if (byT.hasOwnProperty(k)) list.push(byT[k]); }
      list.sort(function (a, b) { return (b.absentDays + b.absentPeriods) - (a.absentDays + a.absentPeriods); });
      return { success: true, summary: list, isPrivileged: isPriv };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  });
}

// أسماء المعلمين (لقائمة اختيار غياب المعلمين) — للمشرف/الوكيل/المدير فقط
function getTeacherNamesProtected(params) {
  return withAuth(params, function (session) {
    try {
      var role = _safeStr(session.role || 'teacher');
      var isPriv = session.isAdmin || role === 'admin' || role === 'deputy' || role === 'supervisor';
      if (!isPriv) return { success: false, error: 'غير مصرّح' };
      var sheet = _getSheet('المدرسين');
      var names = [], seen = {};
      if (sheet) {
        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          var n = _safeStr(data[i][0]);
          if (n && !seen[n]) { seen[n] = 1; names.push(n); }
        }
      }
      names.sort();
      return { success: true, teachers: names };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  });
}

// أسماء كل الطلاب من ورقة «الطلاب» (لاقتراح أسماء البحث في الغياب) — العمود 1 = الاسم
function getStudentNamesProtected(params) {
  return withAuth(params, function (session) {
    try {
      var sheet = _getSheet('الطلاب');
      var names = [], seen = {};
      if (sheet) {
        var d = sheet.getDataRange().getValues();
        for (var i = 1; i < d.length; i++) {
          var n = _safeStr(d[i][1]);
          if (n && !seen[n]) { seen[n] = 1; names.push(n); }
        }
      }
      names.sort();
      return { success: true, students: names };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  });
}

// الصفوف/الشعب/المواد التي يدرّسها معلّم معيّن (من ورقة الجدول) — لتضييق قوائم غياب المعلمين
function getTeacherScheduleInfoProtected(params) {
  return withAuth(params, function (session) {
    try {
      var role = _safeStr(session.role || 'teacher');
      var isPriv = session.isAdmin || role === 'admin' || role === 'deputy' || role === 'supervisor';
      if (!isPriv) return { success: false, error: 'غير مصرّح' };
      var t = _safeStr(params.teacherName || '');
      if (!t) return { success: true, grades: [], sections: [], subjects: [] };
      var sh = _getSheet('الجدول');
      var g = {}, s = {}, su = {}, gl = [], sl = [], sul = [];
      if (sh) {
        var d = sh.getDataRange().getValues();
        for (var i = 1; i < d.length; i++) {
          if (_safeStr(d[i][5]) !== t) continue;     // عمود المعلم
          var gg = _safeStr(d[i][0]); if (gg && !g[gg])  { g[gg] = 1;  gl.push(gg); }
          var ss = _safeStr(d[i][1]); if (ss && !s[ss])  { s[ss] = 1;  sl.push(ss); }
          var uu = _safeStr(d[i][4]); if (uu && !su[uu]) { su[uu] = 1; sul.push(uu); }
        }
      }
      return { success: true, grades: gl, sections: sl, subjects: sul };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
//  قوائم منسدلة (Data Validation) في أوراق الإدخال — من ورقة «القوائم»
//  القوائم: الفصول(0) | (1) | المواد(2) | الشعب(3) | ...
//  idempotent: آمنة لإعادة التشغيل؛ لا تعدّل أي بيانات؛ setAllowInvalid(true).
//  تُشغَّل يدوياً من محرّر Apps Script أو ضمن صيانة المدرسة.
// ═══════════════════════════════════════════════════════════════════
function applyTeacherListValidations() {
  try {
    var ss = _getSS();
    var listSheet = ss.getSheetByName('القوائم');
    if (!listSheet) return { success: false, error: 'ورقة القوائم غير موجودة' };

    var data = listSheet.getDataRange().getValues();
    function colVals(idx) {
      var a = [], seen = {};
      for (var i = 1; i < data.length; i++) {
        var v = _safeStr(data[i][idx]);
        if (v && !seen[v]) { seen[v] = 1; a.push(v); }
      }
      return a;
    }
    var grades = colVals(0), subjects = colVals(2), sections = colVals(3);

    function rule(vals) {
      if (!vals.length) return null;
      return SpreadsheetApp.newDataValidation()
        .requireValueInList(vals, true).setAllowInvalid(true).build();
    }
    var gRule = rule(grades), sRule = rule(sections), subRule = rule(subjects);

    function applyCol(sheetName, col, r) {
      if (!r) return;
      var sh = ss.getSheetByName(sheetName);
      if (!sh) return;
      var rows = sh.getMaxRows() - 1;
      if (rows < 1) rows = 1;
      sh.getRange(2, col, rows, 1).setDataValidation(r);
    }

    // الطلاب: الفصل(3) | الشعبة(4)
    applyCol('الطلاب', 3, gRule); applyCol('الطلاب', 4, sRule);
    // الواجبات: المادة(3) | الفصل(4) | الشعبة(5)
    applyCol('الواجبات', 3, subRule); applyCol('الواجبات', 4, gRule); applyCol('الواجبات', 5, sRule);
    // المخالفات: الفصل(3) | الشعبة(4)
    applyCol('المخالفات', 3, gRule); applyCol('المخالفات', 4, sRule);
    // الغياب: الفصل(3) | الشعبة(4)
    applyCol('الغياب', 3, gRule); applyCol('الغياب', 4, sRule);

    return { success: true, grades: grades.length, sections: sections.length, subjects: subjects.length };
  } catch (e) {
    return { success: false, error: String((e && e.message) || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  📒 صفحة أسماء الطلاب + بيان حالة الطالب (append — ES5)
//  - أسماء الطلاب: عرض حسب الصلاحية (معلم: طلابه فقط/قراءة؛ مدير-وكيل-مشرف-محاسب:
//    تعديل الجوال/كلمة المرور + تحديد متعدد + إرسال واتساب + إضافة طالب).
//  - بيان الحالة: تقرير كامل لطالب بحسب صفه/شعبته ومعلميه فقط.
//  كل الدوال محمية بـ withAuth وترث ملف المدرسة النشط تلقائياً.
// ═══════════════════════════════════════════════════════════════════

var TC_WORKER_BASE = 'https://school-teacher-proxy.procorners-shop.workers.dev';

// رابط منصة الطالب عبر الـ Worker (مع schoolId للعزل)
function _tcStudentPortalUrl(schoolId) {
  var u = TC_WORKER_BASE + '/student/index.html';
  if (schoolId) u += '?school=' + encodeURIComponent(schoolId);
  return u;
}

// تطبيع رقم الجوال اليمني إلى صيغة دولية (نفس منطق buildWhatsAppLink)
function _tcNormalizePhone(phone) {
  phone = _safeStr(phone).replace(/[^0-9]/g, '');
  if (phone.charAt(0) === '0') {
    phone = '967' + phone.substring(1);
  } else if (phone.indexOf('967') !== 0 && phone.length >= 9) {
    phone = '967' + phone;
  }
  return phone;
}

// توكنات واتساب الأعمال (اختياري) من ScriptProperties لمشروع المعلم
function _tcWhatsAppTokens() {
  try {
    var p = PropertiesService.getScriptProperties();
    var id = p.getProperty('WA_PHONE_ID') || '';
    var tok = p.getProperty('WA_TOKEN') || '';
    return { ok: !!(id && tok), phoneId: id, token: tok };
  } catch (e) {
    return { ok: false, phoneId: '', token: '' };
  }
}

// توليد كلمة مرور بسيطة (حروف + أرقام) بلا Math.random
function _tcGenPassword() {
  var d = Utilities.getUuid().replace(/[^0-9]/g, '').substring(0, 4);
  if (d.length < 4) d = (d + '1234').substring(0, 4);
  return 'st' + d;
}

// رسالة بيانات الدخول الجاهزة لولي الأمر
function _buildStudentCredMsg(name, password, schoolId) {
  return 'بسم الله الرحمن الرحيم\n' +
    'عزيزي ولي أمر الطالب: ' + name + '\n' +
    'بيانات الدخول إلى منصة الطالب:\n' +
    '• اسم المستخدم: ' + name + '\n' +
    '• كلمة المرور: ' + password + '\n' +
    '• رابط المنصة: ' + _tcStudentPortalUrl(schoolId) + '\n' +
    'مدارس الإبداع والتميز الدولية';
}

// هل الطالب (فصله/شعبته) ضمن صلاحيات المستخدم؟ (المدير/المحاسب يرى الكل)
function _tcStudentVisibleToTeacher(session, grade, section) {
  if (session.isAdmin) return true;
  var classes = session.classes || [];
  var sections = session.sections || [];
  var gradeOk = (classes.indexOf('جميع الفصول') !== -1) || (classes.indexOf(grade) !== -1);
  if (!gradeOk) return false;
  var secOk = (!sections.length) || (sections.indexOf('جميع الشعب') !== -1) ||
              (sections.indexOf(section) !== -1);
  return secOk;
}

// هل كلمة المرور مخزّنة مشفّرة؟
function _tcIsHashedPw(pw) {
  return _safeStr(pw).indexOf('h1$') === 0;
}

// ── جلب دليل الطلاب حسب الصلاحية ──
function getStudentsDirectoryProtected(params) {
  return withAuth(params, function (session) {
    try {
      var sheet = _getSheet('الطلاب');
      if (!sheet) return { success: false, error: 'ورقة الطلاب غير موجودة' };
      var isMgr = !!session.isAdmin;
      var colMap = _getStudentSheetColumnMap();
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        return { success: true, mode: isMgr ? 'manager' : 'teacher', students: [],
                 schoolId: session.schoolId || '', hasWa: _tcWhatsAppTokens().ok };
      }
      var lastCol = sheet.getLastColumn();
      var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();

      // الرسوم المسددة من ورقة الرسوم (للمدراء فقط)
      var feesData = {};
      if (isMgr) {
        try {
          var studentFile = _getSSById(_activeFileId());
          var feesSheet = studentFile.getSheetByName('الرسوم');
          if (feesSheet) {
            var lfr = feesSheet.getLastRow();
            if (lfr > 1) {
              var fr = feesSheet.getRange(2, 1, lfr - 1, 4).getValues();
              for (var j = 0; j < fr.length; j++) {
                var fc = _safeStr(fr[j][0]);
                if (fc) feesData[fc] = _safeFloat(fr[j][3]);
              }
            }
          }
        } catch (e0) {}
      }

      var out = [];
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var code = _safeStr(row[colMap.code]);
        var name = _safeStr(row[colMap.name]);
        if (!code && !name) continue;
        var grade = _safeStr(row[colMap.grade]);
        var section = _safeStr(row[colMap.section]);
        if (!_tcStudentVisibleToTeacher(session, grade, section)) continue;

        var phone = (colMap.phone >= 0 && colMap.phone < row.length) ? _safeStr(row[colMap.phone]) : '';
        var pass = (colMap.pass >= 0 && colMap.pass < row.length) ? _safeStr(row[colMap.pass]) : '';
        var hashed = _tcIsHashedPw(pass);

        var item = {
          rowIndex: i + 1,
          code: code,
          name: name,
          phone: phone,
          password: hashed ? '' : pass,
          hasHash: hashed,
          hasPassword: !!pass
        };
        if (isMgr) {
          item.grade = grade;
          item.section = section;
          item.fees = _safeFloat(row[colMap.fees]);
          item.paid = (feesData[code] != null) ? feesData[code] : _safeFloat(row[colMap.paid]);
        }
        out.push(item);
      }
      out.sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'ar'); });

      return { success: true, mode: isMgr ? 'manager' : 'teacher', students: out,
               schoolId: session.schoolId || '', hasWa: _tcWhatsAppTokens().ok };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  });
}

// ── تحديث حقل طالب (الجوال/كلمة المرور) — للمدراء فقط ──
function updateStudentFieldProtected(params) {
  return withAuth(params, function (session) {
    if (!session.isAdmin) return { success: false, error: 'غير مصرح — لإدارة المدرسة فقط' };
    var field = _safeStr(params.field);
    if (field !== 'phone' && field !== 'password') return { success: false, error: 'حقل غير مدعوم' };

    var sheet = _getSheet('الطلاب');
    if (!sheet) return { success: false, error: 'ورقة الطلاب غير موجودة' };
    var colMap = _getStudentSheetColumnMap();

    var rowIndex = parseInt(params.rowIndex, 10);
    if (!rowIndex || rowIndex < 2) {
      var code = _safeStr(params.code);
      if (!code) return { success: false, error: 'المعرف مطلوب' };
      var lr = sheet.getLastRow();
      var codes = sheet.getRange(1, colMap.code + 1, lr, 1).getValues();
      rowIndex = -1;
      for (var i = 1; i < codes.length; i++) {
        if (_safeStr(codes[i][0]) === code) { rowIndex = i + 1; break; }
      }
      if (rowIndex === -1) return { success: false, error: 'الطالب غير موجود' };
    }

    var val = _safeStr(params.value);
    var col;
    if (field === 'phone') {
      col = colMap.phone + 1;
    } else {
      var pc = colMap.pass;
      if (pc < 0) {
        pc = sheet.getLastColumn();          // عمود جديد بعد الأخير
        sheet.getRange(1, pc + 1).setValue('كلمة المرور');
      }
      col = pc + 1;
    }
    sheet.getRange(rowIndex, col).setValue(val);
    SpreadsheetApp.flush();
    _tcCacheDel('tc_all_students_v1');
    return { success: true, message: 'تم التحديث بنجاح' };
  });
}

// ── إعادة تعيين كلمة مرور طالب (نصية) ثم إرجاعها — للمدراء فقط ──
function resetStudentPasswordProtected(params) {
  return withAuth(params, function (session) {
    if (!session.isAdmin) return { success: false, error: 'غير مصرح' };
    var newPw = _safeStr(params.newPassword) || _tcGenPassword();
    var r = updateStudentFieldProtected({
      token: params.token, code: params.code, rowIndex: params.rowIndex,
      field: 'password', value: newPw
    });
    if (r && r.success) return { success: true, password: newPw, message: 'تم إعادة تعيين كلمة المرور' };
    return r;
  });
}

// ── إضافة طالب جديد — للمدراء فقط ──
function addStudentProtected(params) {
  return withAuth(params, function (session) {
    if (!session.isAdmin) return { success: false, error: 'غير مصرح' };
    var name = _safeStr(params.name);
    if (!name) return { success: false, error: 'اسم الطالب مطلوب' };
    var grade = _safeStr(params.grade);
    var section = _safeStr(params.section);
    var phone = _safeStr(params.phone);
    var pw = _safeStr(params.password) || _tcGenPassword();
    var fees = _safeFloat(params.fees);

    var sheet = _getSheet('الطلاب');
    if (!sheet) {
      sheet = _getOrCreateSheet('الطلاب',
        ['الكود', 'الاسم', 'الفصل', 'الشعبة', 'اجمالي الرسوم', 'المبالغ المسدده', 'رقم الجوال', 'كلمة المرور']);
    }
    var colMap = _getStudentSheetColumnMap();
    var code = _safeStr(params.code) || ('S' + (new Date().getTime()));

    var lastCol = sheet.getLastColumn();
    var rowArr = [];
    for (var k = 0; k < lastCol; k++) rowArr.push('');
    function setIf(idx, value) { if (idx >= 0 && idx < rowArr.length) rowArr[idx] = value; }
    setIf(colMap.code, code);
    setIf(colMap.name, name);
    setIf(colMap.grade, grade);
    setIf(colMap.section, section);
    setIf(colMap.fees, fees);
    setIf(colMap.phone, phone);
    if (colMap.pass >= 0) setIf(colMap.pass, pw);
    sheet.appendRow(rowArr);

    // إنشاء عمود كلمة المرور إن لم يكن موجوداً وكتابة القيمة
    if (colMap.pass < 0) {
      var nc = sheet.getLastColumn() + 1;
      sheet.getRange(1, nc).setValue('كلمة المرور');
      sheet.getRange(sheet.getLastRow(), nc).setValue(pw);
    }
    SpreadsheetApp.flush();
    _tcCacheDel('tc_all_students_v1');
    return { success: true, code: code, password: pw, message: 'تمت إضافة الطالب بنجاح' };
  });
}

// ── إرسال بيانات الدخول لأولياء الأمور (API إن توفّر، وإلا روابط wa.me) ──
function sendStudentCredentialsProtected(params) {
  return withAuth(params, function (session) {
    var list = params.students || [];
    if (!list.length) return { success: false, error: 'لا يوجد طلاب محددون' };
    var wa = _tcWhatsAppTokens();
    var schoolId = session.schoolId || '';
    var results = [], links = [], sentCount = 0;

    for (var i = 0; i < list.length; i++) {
      var st = list[i];
      var name = _safeStr(st.name);
      var pw = _safeStr(st.password);
      var phone = _tcNormalizePhone(st.phone);
      if (!phone) { results.push({ name: name, ok: false, error: 'لا يوجد رقم جوال' }); continue; }
      var msg = _buildStudentCredMsg(name, pw, schoolId);
      var waUrl = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg);

      if (wa.ok) {
        try {
          var resp = UrlFetchApp.fetch('https://graph.facebook.com/v18.0/' + wa.phoneId + '/messages', {
            method: 'post', contentType: 'application/json', muteHttpExceptions: true,
            headers: { Authorization: 'Bearer ' + wa.token },
            payload: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: msg } })
          });
          var jr = JSON.parse(resp.getContentText());
          if (jr && jr.messages) { sentCount++; results.push({ name: name, ok: true }); }
          else { results.push({ name: name, ok: false, error: (jr.error ? jr.error.message : 'فشل') }); links.push({ name: name, phone: phone, waUrl: waUrl }); }
        } catch (e) {
          results.push({ name: name, ok: false, error: String(e) });
          links.push({ name: name, phone: phone, waUrl: waUrl });
        }
      } else {
        links.push({ name: name, phone: phone, waUrl: waUrl });
      }
    }
    return { success: true, sent: sentCount, total: list.length, results: results, links: links, viaApi: wa.ok };
  });
}

// ── قراءة درجات طالب (best-effort، carry-forward للشهر/المادة) ──
function _tcReadStudentGrades(code, session) {
  var sheet = _getSheet('الدرجات');
  if (!sheet) return [];
  var lr = sheet.getLastRow();
  var lc = sheet.getLastColumn();
  if (lr < 4 || lc < 2) return [];
  var head = sheet.getRange(1, 1, 3, lc).getValues();
  var monthRow = head[0], subjRow = head[1], typeRow = head[2];
  var codes = sheet.getRange(1, 1, lr, 1).getValues();
  var srow = -1;
  for (var i = 3; i < codes.length; i++) {
    if (_safeStr(codes[i][0]) === code) { srow = i + 1; break; }
  }
  if (srow === -1) return [];
  var vals = sheet.getRange(srow, 1, 1, lc).getValues()[0];
  var mySubs = session.isAdmin ? null : (session.subjects || []);
  var curMonth = '', curSubj = '', out = [];
  for (var c = 0; c < lc; c++) {
    if (_safeStr(monthRow[c])) curMonth = _safeStr(monthRow[c]);
    if (_safeStr(subjRow[c])) curSubj = _safeStr(subjRow[c]);
    var typ = _safeStr(typeRow[c]);
    if (typ === 'الاجمالي' || typ === 'المجموع' || typ === 'الكلي' || typ === 'المحصلة') {
      if (mySubs && mySubs.indexOf('جميع المواد') === -1 && mySubs.indexOf(curSubj) === -1) continue;
      var val = _safeStr(vals[c]);
      if (val !== '') out.push({ month: curMonth, subject: curSubj, total: val });
    }
  }
  return out;
}

// ── بيان حالة الطالب: تقرير كامل بحسب الصلاحية وصف/شعبة الطالب ──
function getStudentStatusReportProtected(params) {
  return withAuth(params, function (session) {
    try {
      var sheet = _getSheet('الطلاب');
      if (!sheet) return { success: false, error: 'ورقة الطلاب غير موجودة' };
      var colMap = _getStudentSheetColumnMap();
      var lr = sheet.getLastRow();
      var lc = sheet.getLastColumn();
      var data = sheet.getRange(1, 1, lr, lc).getValues();
      var wantCode = _safeStr(params.code);
      var wantName = _safeStr(params.name);
      var found = null;
      for (var i = 1; i < data.length; i++) {
        var c = _safeStr(data[i][colMap.code]);
        var n = _safeStr(data[i][colMap.name]);
        if ((wantCode && c === wantCode) || (wantName && n === wantName)) {
          found = { row: data[i], idx: i + 1, code: c, name: n };
          break;
        }
      }
      if (!found) return { success: false, error: 'الطالب غير موجود' };

      var grade = _safeStr(found.row[colMap.grade]);
      var section = _safeStr(found.row[colMap.section]);
      if (!_tcStudentVisibleToTeacher(session, grade, section)) {
        return { success: false, error: 'غير مصرح لك بعرض هذا الطالب (خارج فصولك)' };
      }

      var flags = params.sections || { basic: true, grades: true, attendance: true, violations: true, homework: true, fees: true };
      var report = {
        success: true,
        schoolId: session.schoolId || '',
        student: {
          code: found.code, name: found.name, grade: grade, section: section,
          phone: (colMap.phone >= 0) ? _safeStr(found.row[colMap.phone]) : ''
        }
      };

      // المعلومات المالية
      if (flags.basic || flags.fees) {
        var total = _safeFloat(found.row[colMap.fees]);
        var paid = _safeFloat(found.row[colMap.paid]);
        try {
          var sf = _getSSById(_activeFileId()).getSheetByName('الرسوم');
          if (sf) {
            var lfr = sf.getLastRow();
            if (lfr > 1) {
              var frr = sf.getRange(2, 1, lfr - 1, 4).getValues();
              for (var f = 0; f < frr.length; f++) {
                if (_safeStr(frr[f][0]) === found.code) { paid = _safeFloat(frr[f][3]); break; }
              }
            }
          }
        } catch (e1) {}
        report.fees = { total: total, paid: paid, remaining: total - paid,
                        percent: total > 0 ? Math.round(paid / total * 100) : 100 };
      }

      // الحضور والغياب
      if (flags.attendance) {
        report.attendance = [];
        try {
          var at = _getSheet('الغياب');
          if (at) {
            var ad = at.getDataRange().getValues();
            for (var a = 1; a < ad.length; a++) {
              if (_safeStr(ad[a][0]) === found.code || _safeStr(ad[a][1]) === found.name) {
                report.attendance.push({ date: _safeStr(ad[a][4]), status: _safeStr(ad[a][5]) });
              }
            }
          }
        } catch (e2) {}
      }

      // المخالفات
      if (flags.violations) {
        report.violations = [];
        try {
          var vt = _getSheet('المخالفات');
          if (vt) {
            var vd = vt.getDataRange().getValues();
            for (var v = 1; v < vd.length; v++) {
              if (_safeStr(vd[v][0]) === found.code || _safeStr(vd[v][1]) === found.name) {
                report.violations.push({
                  type: _safeStr(vd[v][4]), teacher: _safeStr(vd[v][5]),
                  date: _safeStr(vd[v][6]), reply: _safeStr(vd[v][7])
                });
              }
            }
          }
        } catch (e3) {}
      }

      // الواجبات (لفصل/شعبة الطالب؛ للمعلم: مواده فقط)
      if (flags.homework) {
        report.homework = [];
        try {
          var ht = _getSheet('الواجبات');
          if (ht) {
            var hd = ht.getDataRange().getValues();
            var mySubs = session.isAdmin ? null : (session.subjects || []);
            for (var h = 1; h < hd.length; h++) {
              var hsub = _safeStr(hd[h][2]);
              var hg = _safeStr(hd[h][3]);
              var hsec = _safeStr(hd[h][4]);
              if (hg !== grade) continue;
              if (section && hsec && hsec !== section) continue;
              if (mySubs && mySubs.indexOf('جميع المواد') === -1 && mySubs.indexOf(hsub) === -1) continue;
              report.homework.push({
                subject: hsub, teacher: _safeStr(hd[h][1]),
                homework: _safeStr(hd[h][5]), date: _safeStr(hd[h][6])
              });
            }
          }
        } catch (e4) {}
      }

      // الدرجات
      if (flags.grades) {
        report.grades = [];
        try { report.grades = _tcReadStudentGrades(found.code, session); } catch (e5) {}
      }

      return report;
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  });
}