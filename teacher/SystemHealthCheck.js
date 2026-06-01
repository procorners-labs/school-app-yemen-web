// ══════════════════════════════════════════════════════════════
//  سكريبت الاختبار الشامل لمنظومة مدارس الإبداع والتميز
//  SystemHealthCheck.gs
//  شغّله يدوياً من المحرر: الدالة runFullSystemTest()
// ══════════════════════════════════════════════════════════════

function runFullSystemTest() {
  var report = [];
  var passed = 0;
  var failed = 0;
  var warnings = 0;

  function _pass(section, test, detail) {
    passed++;
    Logger.log('✅ [' + section + '] ' + test + (detail ? ' → ' + detail : ''));
    report.push({ status: 'PASS', section: section, test: test, detail: detail || '' });
  }
  function _fail(section, test, detail) {
    failed++;
    Logger.log('❌ [' + section + '] ' + test + (detail ? ' → ' + detail : ''));
    report.push({ status: 'FAIL', section: section, test: test, detail: detail || '' });
  }
  function _warn(section, test, detail) {
    warnings++;
    Logger.log('⚠️ [' + section + '] ' + test + (detail ? ' → ' + detail : ''));
    report.push({ status: 'WARN', section: section, test: test, detail: detail || '' });
  }

  Logger.log('══════════════════════════════════════════════════════════');
  Logger.log('  🔬 سكريبت الاختبار الشامل — مدارس الإبداع والتميز');
  Logger.log('  🕒 ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'));
  Logger.log('══════════════════════════════════════════════════════════');

  // ── 1. فحص ملفات الشيت ──────────────────────────────────────
  Logger.log('\n📁 [1/7] فحص الوصول إلى ملفات الشيت');
  var files = {
    'ملف المعلمين'  : '1G6sLNJZqZ2pazx22nNS6X6GIYfAE-rT2IjcrF9NSheM',
    'ملف الطالب'    : '1BPtHUMB8kdi2exbfPVaKoSOcjGGZrnbJANXPHnWTD_A',
    'ملف الموقع/CMS': '1J7DY-Z2PZU5y5HH-LR3vhuEhPAkjWz22vMu1rYLcse0',
    'ملف الحصص'     : '14VflEuGRCXIOz22_cYp2HmUTZYYsMJ1fNtvDMxbYSZA'
  };
  var openedFiles = {};
  for (var fname in files) {
    try {
      var ss = SpreadsheetApp.openById(files[fname]);
      openedFiles[fname] = ss;
      _pass('الشيت', 'فتح ' + fname, 'الاسم: ' + ss.getName());
    } catch (e) {
      _fail('الشيت', 'فتح ' + fname, e.message);
    }
  }

  // ── 2. فحص الأوراق الحيوية ──────────────────────────────────
  Logger.log('\n📋 [2/7] فحص الأوراق الحيوية');
  var teacherFile   = openedFiles['ملف المعلمين'];
  var studentFile   = openedFiles['ملف الطالب'];

  var teacherSheets = [
    'الطلاب', 'المدرسين', 'الدرجات', 'الواجبات',
    'الاخبار', 'المخالفات', 'القوائم', 'الملاحظات', 'الغياب'
  ];
  var studentSheets = [
    'الطلاب', 'الدرجات', 'الرسوم', 'التسديد', 'الجدول',
    'الاخبار', 'الواجبات', 'الملاحظات', 'سلبيات ومميزات الطالب', 'الاعدادات'
  ];

  if (teacherFile) {
    for (var ts = 0; ts < teacherSheets.length; ts++) {
      var tSheet = teacherFile.getSheetByName(teacherSheets[ts]);
      if (tSheet) {
        var rowCount = Math.max(0, tSheet.getLastRow() - 1);
        _pass('أوراق المعلم', 'ورقة "' + teacherSheets[ts] + '"', rowCount + ' سجل');
      } else {
        if (teacherSheets[ts] === 'الغياب') {
          _warn('أوراق المعلم', 'ورقة "الغياب"', 'غير موجودة — ستُنشأ عند أول تسجيل غياب');
        } else {
          _fail('أوراق المعلم', 'ورقة "' + teacherSheets[ts] + '"', 'غير موجودة');
        }
      }
    }
  }

  if (studentFile) {
    for (var ss2 = 0; ss2 < studentSheets.length; ss2++) {
      var sSheet = studentFile.getSheetByName(studentSheets[ss2]);
      if (sSheet) {
        var sRow = Math.max(0, sSheet.getLastRow() - 1);
        _pass('أوراق الطالب', 'ورقة "' + studentSheets[ss2] + '"', sRow + ' سجل');
      } else {
        _fail('أوراق الطالب', 'ورقة "' + studentSheets[ss2] + '"', 'غير موجودة');
      }
    }
  }

  // ── 3. فحص عمود الجوال ──────────────────────────────────────
  Logger.log('\n📞 [3/7] فحص عمود رقم الجوال');
  if (teacherFile) {
    var studSheet = teacherFile.getSheetByName('الطلاب');
    if (studSheet) {
      var headers = studSheet.getRange(1, 1, 1, studSheet.getLastColumn()).getValues()[0];
      var phoneIdx = -1;
      for (var h = 0; h < headers.length; h++) {
        var hv = (headers[h] || '').toString().trim();
        if (hv === 'رقم الجوال' || hv === 'الجوال' || hv === 'رقم الهاتف') {
          phoneIdx = h;
          break;
        }
      }
      if (phoneIdx >= 0) {
        // فحص كم طالب لديه رقم جوال
        var studData    = studSheet.getDataRange().getValues();
        var withPhone   = 0;
        var withoutPhone = 0;
        for (var ri = 1; ri < studData.length; ri++) {
          if ((studData[ri][phoneIdx] || '').toString().trim()) withPhone++;
          else withoutPhone++;
        }
        _pass('الجوال', 'عمود رقم الجوال موجود', 'الفهرس=' + phoneIdx +
              ' | مع رقم: ' + withPhone + ' | بدون رقم: ' + withoutPhone);
        if (withoutPhone > withPhone) {
          _warn('الجوال', 'معظم الطلاب بدون رقم جوال',
                withoutPhone + ' طالب بحاجة لإضافة رقم');
        }
      } else {
        _fail('الجوال', 'عمود رقم الجوال غير موجود',
              'يجب إضافة عمود بعنوان "رقم الجوال" في ورقة الطلاب');
      }
    }
  }

  // ── 4. فحص نظام المصادقة ────────────────────────────────────
  Logger.log('\n🔐 [4/7] فحص نظام المصادقة');
  try {
    var authResult = testAuthSystem();
    if (authResult.tokenOk) {
      _pass('المصادقة', 'توليد Token (40 حرف)', 'طول Token صحيح');
    } else {
      _fail('المصادقة', 'توليد Token', 'طول Token غير صحيح');
    }
    if (authResult.sessionOk) {
      _pass('المصادقة', 'حفظ واسترجاع الجلسة من CacheService', 'Cache يعمل بشكل صحيح');
    } else {
      _fail('المصادقة', 'حفظ واسترجاع الجلسة', 'CacheService قد يكون معطلاً');
    }
  } catch (e) {
    _fail('المصادقة', 'اختبار النظام', e.message);
  }

  // ── 5. فحص الحجب المالي ─────────────────────────────────────
  Logger.log('\n💰 [5/7] فحص إعدادات الحجب المالي');
  if (studentFile) {
    var settingsSheet = studentFile.getSheetByName('الاعدادات');
    if (settingsSheet) {
      var settData = settingsSheet.getDataRange().getValues();
      if (settData.length > 1) {
        var blockPct = parseFloat(settData[1][0]) || 0;
        if (blockPct > 0) {
          _pass('الحجب المالي', 'نسبة الحجب مضبوطة', 'القيمة: ' + blockPct + '%');
        } else {
          _warn('الحجب المالي', 'نسبة الحجب = 0',
                'الحجب المالي معطل. فعّله بوضع قيمة في خلية A2 بورقة الاعدادات');
        }
        var exceptions = 0;
        for (var ei = 1; ei < settData.length; ei++) {
          if ((settData[ei][1] || '').toString().trim()) exceptions++;
        }
        _pass('الحجب المالي', 'الاستثناءات', exceptions + ' طالب مستثنى');
      } else {
        _fail('الحجب المالي', 'ورقة الاعدادات فارغة', 'يجب إضافة صف رأس وصف البيانات');
      }
    } else {
      _fail('الحجب المالي', 'ورقة الاعدادات غير موجودة', 'في ملف الطالب');
    }
  }

  // ── 6. فحص تزامن البيانات ───────────────────────────────────
  Logger.log('\n🔄 [6/7] فحص تزامن البيانات');
  if (teacherFile && studentFile) {

    // مقارنة عدد طلاب المعلم vs الطالب
    var tStudents = teacherFile.getSheetByName('الطلاب');
    var sStudents = studentFile.getSheetByName('الطلاب');
    if (tStudents && sStudents) {
      var tCount = Math.max(0, tStudents.getLastRow() - 1);
      var sCount = Math.max(0, sStudents.getLastRow() - 1);
      if (Math.abs(tCount - sCount) <= 5) {
        _pass('التزامن', 'عدد الطلاب متقارب', 'معلم: ' + tCount + ' | طالب: ' + sCount);
      } else {
        _warn('التزامن', 'فارق كبير في عدد الطلاب',
              'معلم: ' + tCount + ' | طالب: ' + sCount +
              ' | فارق: ' + Math.abs(tCount - sCount));
      }
    }

    // فحص المخالفات في ملف الطالب
    var sViolSheet = studentFile.getSheetByName('سلبيات ومميزات الطالب');
    var tViolSheet = teacherFile.getSheetByName('المخالفات');
    if (sViolSheet && tViolSheet) {
      var sVCount = Math.max(0, sViolSheet.getLastRow() - 1);
      var tVCount = Math.max(0, tViolSheet.getLastRow() - 1);
      if (sVCount === tVCount) {
        _pass('التزامن', 'المخالفات متزامنة', 'كلا الملفين: ' + tVCount + ' سجل');
      } else {
        _warn('التزامن', 'المخالفات غير متزامنة',
              'معلم: ' + tVCount + ' | طالب: ' + sVCount +
              ' | شغّل syncViolationsFromMaster()');
      }
    }

    // فحص الملاحظات
    var sNoteSheet = studentFile.getSheetByName('الملاحظات');
    var tNoteSheet = teacherFile.getSheetByName('الملاحظات');
    if (sNoteSheet && tNoteSheet) {
      var sNCount = Math.max(0, sNoteSheet.getLastRow() - 1);
      var tNCount = Math.max(0, tNoteSheet.getLastRow() - 1);
      if (Math.abs(sNCount - tNCount) <= 2) {
        _pass('التزامن', 'الملاحظات متزامنة', 'معلم: ' + tNCount + ' | طالب: ' + sNCount);
      } else {
        _warn('التزامن', 'الملاحظات غير متزامنة',
              'معلم: ' + tNCount + ' | طالب: ' + sNCount +
              ' | شغّل syncNotesToMaster()');
      }
    }
  }

  // ── 7. فحص روابط Drive ──────────────────────────────────────
  Logger.log('\n🔗 [7/7] فحص روابط Google Drive');
  if (teacherFile) {
    var newsSheet = teacherFile.getSheetByName('الاخبار');
    if (newsSheet) {
      var newsRows  = newsSheet.getDataRange().getValues();
      var oldLinks  = 0;
      var thumbLinks = 0;
      var emptyLinks = 0;
      for (var nr = 1; nr < newsRows.length; nr++) {
        var link = (newsRows[nr][5] || '').toString().trim();
        if (!link) { emptyLinks++; continue; }
        if (link.indexOf('thumbnail?id=') !== -1) thumbLinks++;
        else if (link.indexOf('uc?export=view') !== -1 || link.indexOf('/view') !== -1) oldLinks++;
        else thumbLinks++; // روابط أخرى
      }
      if (oldLinks === 0) {
        _pass('Drive', 'روابط الأخبار', thumbLinks + ' رابط thumbnail صحيح');
      } else {
        _warn('Drive', 'روابط قديمة في الأخبار',
              oldLinks + ' رابط بصيغة قديمة. شغّل convertOldAttachmentsToThumbnailLink()');
      }
    }
  }

  // ── ملخص نهائي ──────────────────────────────────────────────
  Logger.log('\n══════════════════════════════════════════════════════════');
  Logger.log('  📊 ملخص نتائج الاختبار');
  Logger.log('──────────────────────────────────────────────────────────');
  Logger.log('  ✅ نجح  : ' + passed);
  Logger.log('  ❌ فشل  : ' + failed);
  Logger.log('  ⚠️ تحذير: ' + warnings);
  Logger.log('  📈 إجمالي: ' + (passed + failed + warnings) + ' اختبار');
  Logger.log('');

  var score = Math.round((passed / (passed + failed + warnings)) * 100);
  Logger.log('  🏆 درجة الصحة الكلية: ' + score + '%');

  if (failed === 0 && warnings === 0) {
    Logger.log('  🎉 المنظومة تعمل بصحة كاملة!');
  } else if (failed === 0) {
    Logger.log('  👍 المنظومة تعمل بشكل جيد مع بعض التحذيرات');
  } else {
    Logger.log('  🔧 توجد مشكلات تحتاج معالجة فورية');
  }

  // تفاصيل الفشل للمراجعة
  if (failed > 0) {
    Logger.log('\n  🔴 الاختبارات الفاشلة:');
    for (var fi = 0; fi < report.length; fi++) {
      if (report[fi].status === 'FAIL') {
        Logger.log('    • [' + report[fi].section + '] ' + report[fi].test +
                  ': ' + report[fi].detail);
      }
    }
  }

  if (warnings > 0) {
    Logger.log('\n  🟡 التحذيرات:');
    for (var wi = 0; wi < report.length; wi++) {
      if (report[wi].status === 'WARN') {
        Logger.log('    • [' + report[wi].section + '] ' + report[wi].test +
                  ': ' + report[wi].detail);
      }
    }
  }

  Logger.log('══════════════════════════════════════════════════════════');

  return {
    passed   : passed,
    failed   : failed,
    warnings : warnings,
    score    : score,
    report   : report
  };
}