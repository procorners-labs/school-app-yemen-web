/**
 * ═══════════════════════════════════════════════════════════════
 *  كود تشخيصي كامل — يفحص صلاحيات المعلم ويعرض كل شيء في السجلات
 *  الاستخدام: شغّل fullDiagnosticsForTeacher() من محرر Apps Script
 *  غيّر اسم المعلم وكلمة المرور أدناه حسب الحاجة
 * ═══════════════════════════════════════════════════════════════
 */
function fullDiagnosticsForTeacher() {
  // ═══════════════════════════════════════════════
  // ① اختر المعلم الذي تريد تشخيصه
  // ═══════════════════════════════════════════════
  var testTeacherName = "أحمد محمد";   // ← غيّر هنا
  var testPassword    = "1234";        // ← غيّر هنا

  Logger.log("══════ بدء التشخيص الكامل ══════");
  Logger.log("المعلم المُختبر: " + testTeacherName);

  // ═══════════════════════════════════════════════
  // ② تسجيل الدخول التجريبي
  // ═══════════════════════════════════════════════
  var loginResult = handleTeacherLogin({
    username : testTeacherName,
    password : testPassword,
    clientId : "diag_" + new Date().getTime()
  });

  if (!loginResult.success) {
    Logger.log("❌ فشل تسجيل الدخول: " + loginResult.error);
    return;
  }

  Logger.log("✅ تم تسجيل الدخول بنجاح");
  Logger.log("   Token (أول 10 أحرف): " + loginResult.token.substring(0,10) + "...");
  Logger.log("   isAdmin : " + loginResult.isAdmin);
  Logger.log("   role    : " + loginResult.role);
  Logger.log("   subjects: " + JSON.stringify(loginResult.subjects));
  Logger.log("   classes : " + JSON.stringify(loginResult.classes));
  Logger.log("   sections: " + JSON.stringify(loginResult.sections));

  // ═══════════════════════════════════════════════
  // ③ محاكاة checkSession (التحقق من صحة الجلسة)
  // ═══════════════════════════════════════════════
  var sessionCheck = checkSession(loginResult.token);
  Logger.log("\n🔍 checkSession result:");
  Logger.log(JSON.stringify(sessionCheck, null, 2));

  // ═══════════════════════════════════════════════
  // ④ فحص القوائم المُعاد بناؤها (getLists)
  // ═══════════════════════════════════════════════
  var lists = getLists();
  Logger.log("\n📋 Lists (getLists):");
  Logger.log("   grades     : " + JSON.stringify(lists.grades));
  Logger.log("   subjects   : " + JSON.stringify(lists.subjects));
  Logger.log("   sections   : " + JSON.stringify(lists.sections));
  Logger.log("   violations : " + JSON.stringify(lists.violations));

  // تحقق من تطابق فصول المعلم مع الفصول الموجودة في القوائم
  if (loginResult.classes && lists.grades) {
    var unknownGrades = [];
    for (var i = 0; i < loginResult.classes.length; i++) {
      if (loginResult.classes[i] === 'جميع الفصول') continue;
      if (lists.grades.indexOf(loginResult.classes[i]) === -1) {
        unknownGrades.push(loginResult.classes[i]);
      }
    }
    if (unknownGrades.length > 0) {
      Logger.log("⚠️ تحذير: الفصول التالية غير موجودة في القوائم الرسمية:");
      Logger.log("   " + JSON.stringify(unknownGrades));
    } else {
      Logger.log("✅ جميع فصول المعلم موجودة في القوائم.");
    }
  }

  // ═══════════════════════════════════════════════
  // ⑤ تجربة جلب أنشطة المعلم (الواجبات، المخالفات)
  // ═══════════════════════════════════════════════
  var activities = getMyActivitiesProtected({ token: loginResult.token });
  Logger.log("\n📝 getMyActivitiesProtected:");
  Logger.log("   success: " + activities.success);
  if (activities.success) {
    Logger.log("   homeworks count: " + (activities.data.homework ? activities.data.homework.length : 0));
    Logger.log("   news count     : " + (activities.data.news ? activities.data.news.length : 0));
    Logger.log("   violations count: " + (activities.data.violations ? activities.data.violations.length : 0));
  } else {
    Logger.log("   error: " + activities.error);
  }

  // ═══════════════════════════════════════════════
  // ⑥ تجربة إضافة واجب (اختبار الصلاحية)
  // ═══════════════════════════════════════════════
  var testGrade   = loginResult.classes[0] || "الأول الأساسي";
  var testSection = loginResult.sections[0] || "أ";
  var testSubject = loginResult.subjects[0]  || "الرياضيات";

  Logger.log("\n✏️ اختبار إضافة واجب:");
  Logger.log("   grade   : " + testGrade);
  Logger.log("   section : " + testSection);
  Logger.log("   subject : " + testSubject);

  var addHwResult = addHomeworkProtected({
    token    : loginResult.token,
    grade    : testGrade,
    section  : testSection,
    subject  : testSubject,
    homework : "(واجب تجريبي – تشخيص)",
    date     : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd")
  });

  Logger.log("   result:");
  Logger.log(JSON.stringify(addHwResult, null, 2));

  // تنظيف الواجب التجريبي إذا نجح (حذف)
  if (addHwResult.success && addHwResult.id) {
    var delResult = deleteHomeworkProtected({ token: loginResult.token, id: addHwResult.id });
    Logger.log("   🧹 حذف الواجب التجريبي: " + (delResult.success ? "تم" : "فشل"));
  }

  // ═══════════════════════════════════════════════
  // ⑦ تجربة البحث عن طالب (صفحة المخالفات)
  // ═══════════════════════════════════════════════
  Logger.log("\n🔎 اختبار البحث عن طالب:");
  var searchResult = searchStudentsForTeacher({
    token   : loginResult.token,
    query   : "محمد",
    filters : {}
  });

  Logger.log("   success: " + searchResult.success);
  if (searchResult.success && searchResult.data) {
    Logger.log("   عدد النتائج: " + searchResult.data.length);
    // عرض أول 3 نتائج فقط
    var preview = searchResult.data.slice(0,3).map(function(s) {
      return s.name + " (" + s.grade + "/" + s.section + ")";
    });
    Logger.log("   أول 3 نتائج: " + JSON.stringify(preview));
  } else {
    Logger.log("   error: " + (searchResult.error || "لا توجد نتائج"));
  }

  // ═══════════════════════════════════════════════
  // ⑧ محاكاة إضافة مخالفة (إذا وُجد طالب)
  // ═══════════════════════════════════════════════
  if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
    var firstStudent = searchResult.data[0];
    Logger.log("\n⚠️ اختبار إضافة مخالفة للطالب: " + firstStudent.name);
    var vioResult = addViolationProtected({
      token      : loginResult.token,
      studentRow : firstStudent.rowIndex,
      violation  : "تأخر عن الدوام",
      teacherName: loginResult.teacherName,
      reply      : ""
    });
    Logger.log("   result:");
    Logger.log(JSON.stringify(vioResult, null, 2));

    // حذف المخالفة التجريبية بعد الإضافة (إذا نجحت)
    if (vioResult.success) {
      // لم نُعرّف دالة لحذف مخالفة بسهولة هنا، سنتركها فقط للسجل
      Logger.log("   (تمت إضافة مخالفة تشخيصية، يُرجى حذفها يدويًا إن لزم)");
    }
  }

  // ═══════════════════════════════════════════════
  // ⑨ التحقق من مزامنة أسماء الفصول بين الأوراق
  // ═══════════════════════════════════════════════
  try {
    var ss = _getSS();
    var teacherSheet = ss.getSheetByName('المدرسين');
    var studentSheet = ss.getSheetByName('الطلاب');
    if (teacherSheet && studentSheet) {
      var teacherGrades = teacherSheet.getRange(2, 3, teacherSheet.getLastRow()-1, 1).getValues().flat().filter(function(v) { return v; });
      var studentGrades = studentSheet.getRange(2, 3, studentSheet.getLastRow()-1, 1).getValues().flat().filter(function(v) { return v; });
      teacherGrades = teacherGrades.filter(function(v,i,s) { return s.indexOf(v)===i; });
      studentGrades = studentGrades.filter(function(v,i,s) { return s.indexOf(v)===i; });
      var missingInStudents = teacherGrades.filter(function(tg) { return studentGrades.indexOf(tg) === -1; });
      var missingInTeachers = studentGrades.filter(function(sg) { return teacherGrades.indexOf(sg) === -1 && sg !== 'جميع الفصول'; });

      Logger.log("\n🔄 تدقيق الفصول بين المدرسين والطلاب:");
      if (missingInStudents.length > 0) {
        Logger.log("   ❌ في المدرسين لكن غائبة عن الطلاب: " + JSON.stringify(missingInStudents));
      } else {
        Logger.log("   ✅ جميع فصول المدرسين موجودة في الطلاب.");
      }
      if (missingInTeachers.length > 0) {
        Logger.log("   ⚠️ فصول في الطلاب وغير موجودة في المدرسين: " + JSON.stringify(missingInTeachers));
      }
    }
  } catch(e) {
    Logger.log("   ⚠️ تعذّر تدقيق الفصول: " + e.message);
  }

  Logger.log("\n═══ انتهى التشخيص الكامل ═══");
}