// ============================================================
// Schedule.gs - 
// ============================================================
/**
 * مزامنة ذكية واحترافية لجدول الحصص – مع استخراج الشعبة.
 * - تحويل رموز الفصول (10A) إلى اسم وصفي (الأول ثانوي) + شعبة (أ).
 * - تصحيح أسماء المعلمين (مع إزالة النقاط الزائدة).
 * - كتابة البيانات إلى ملف الطالب.
 */
function syncScheduleToStudentFile() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var scheduleSheet = ss.getSheetByName('الجدول');
  var teachersSheet = ss.getSheetByName('المدرسين');
  if (!scheduleSheet || !teachersSheet) {
    throw new Error('ورقة "الجدول" أو "المدرسين" غير موجودة');
  }

  // ════════════════════════════════
  // 0. دالة مساعدة: استخراج الشعبة
  // ════════════════════════════════
  function getSectionFromCode(raw) {
    if (!raw) return 'أ';
    var cleaned = String(raw).trim();
    var match = cleaned.match(/([أ-يA-Ca-c])$/);
    if (!match) return 'أ';
    var letter = match[1].toUpperCase();
    if (letter === 'A' || letter === 'أ') return 'أ';
    if (letter === 'B' || letter === 'ب') return 'ب';
    if (letter === 'C' || letter === 'ج') return 'ج';
    return 'أ';
  }

  // ════════════════════════════════
  // 1. استثناءات الأسماء اليدوية
  // ════════════════════════════════
  var manualNameFixes = {
    'سمية': 'سمية محمد علي',
    'هنادي': 'هنادي أحمد حسن',
    'سارة': 'سارة عبدالله محمد'
  };

  // ════════════════════════════════
  // 2. قاموس تحويل أسماء الفصول
  // ════════════════════════════════
  var classMap = {
    '12': 'الثالث ثانوي', '11': 'الثاني ثانوي', '10': 'الأول ثانوي',
    '9': 'التاسع', '8': 'الثامن', '7': 'السابع', '6': 'السادس',
    '5': 'الخامس', '4': 'الرابع', '3': 'الثالث', '2': 'الثاني',
    '1': 'الأول', 'KG2': 'KG2', 'KG1': 'KG1'
  };

  function resolveClassName(raw) {
    if (!raw) return '';
    var cleaned = String(raw).trim();
    var match = cleaned.match(/^(\d{1,2}|KG[12])\s*([أ-يA-Ca-c]?)$/i);
    if (match) {
      var base = match[1].toUpperCase().replace(/\s/g, '');
      var mapped = classMap[base];
      if (mapped) return mapped;
    }
    return cleaned;
  }

  // ════════════════════════════════
  // 3. قاعدة بيانات الأسماء الرسمية
  // ════════════════════════════════
  var officialNames = [];
  try {
    // ✅ تم تغيير المعرف الثابت إلى الملف النشط الحالي
    var teacherFile = SpreadsheetApp.openById(_activeFileId());
    var officialSheet = teacherFile.getSheetByName('المدرسين');
    if (officialSheet) {
      var offData = officialSheet.getDataRange().getValues();
      var seenNames = {};
      for (var oi = 1; oi < offData.length; oi++) {
        // ⭐ إزالة النقطة من نهاية الاسم
        var offName = (offData[oi][0] || '').toString().trim().replace(/\.$/, '');
        if (!offName || seenNames[offName]) continue;
        seenNames[offName] = true;

        var entry = { name: offName, keys: [] };
        entry.keys.push(offName);
        entry.keys.push(offName.replace(/\s+/g, ''));
        var words = offName.split(/\s+/);
        if (words[0] && words[0].length >= 2) entry.keys.push(words[0]);
        if (words.length > 1 && words[words.length - 1].length >= 2) entry.keys.push(words[words.length - 1]);
        for (var w = 0; w < words.length; w++) {
          if (words[w].length >= 3) entry.keys.push(words[w]);
        }
        for (var w = 0; w < words.length - 1; w++) {
          var combo = words[w] + words[w + 1];
          if (combo.length >= 3) entry.keys.push(combo);
        }
        officialNames.push(entry);
      }
    }
  } catch (e) {
    Logger.log('تعذر فتح ملف المعلمين: ' + e.message);
  }

  function resolveTeacherName(shortName) {
    if (!shortName) return '';
    var clean = shortName.replace(/\s+/g, ' ').trim();
    if (manualNameFixes[clean]) return manualNameFixes[clean];

    var searchWords = clean.split(/\s+/).filter(function(w) { return w.length >= 2; });
    if (searchWords.length === 0) searchWords = [clean];

    var bestEntry = null, bestScore = 0;
    for (var ei = 0; ei < officialNames.length; ei++) {
      var entry = officialNames[ei], score = 0;
      for (var sw = 0; sw < searchWords.length; sw++) {
        var swl = searchWords[sw].toLowerCase();
        for (var ki = 0; ki < entry.keys.length; ki++) {
          var kl = entry.keys[ki].toLowerCase();
          if (kl === swl) score += 3;
          else if (kl.indexOf(swl) === 0) score += 2;
          else if (kl.indexOf(swl) !== -1) score += 1;
        }
      }
      if (score > bestScore) { bestScore = score; bestEntry = entry; }
    }
    if (bestEntry && bestScore >= 2) return bestEntry.name;

    var cleanLower = clean.toLowerCase();
    for (var ei = 0; ei < officialNames.length; ei++) {
      if (officialNames[ei].name.toLowerCase().indexOf(cleanLower) !== -1 ||
          cleanLower.indexOf(officialNames[ei].name.toLowerCase()) !== -1)
        return officialNames[ei].name;
    }
    Logger.log('⚠️ لم يتم العثور على اسم رسمي للمعلم: ' + clean);
    return shortName;
  }

  // ════════════════════════════════
  // 4. خريطة (معلم|فصل_مختصر) → مادة
  // ════════════════════════════════
  var subjectMap = {};
  var tData = teachersSheet.getDataRange().getValues();
  for (var i = 1; i < tData.length; i++) {
    var teacher = (tData[i][0] || '').toString().trim();
    if (!teacher) continue;
    var sub1 = (tData[i][1] || '').toString().trim();
    var cls1 = (tData[i][2] || '').toString().trim();
    if (sub1 && cls1) subjectMap[teacher + '|' + cls1] = sub1;
    var sub2 = (tData[i][6] || '').toString().trim();
    var cls2 = (tData[i][7] || '').toString().trim();
    if (sub2 && cls2) subjectMap[teacher + '|' + cls2] = sub2;
  }

  // ════════════════════════════════
  // 5. تحويل الجدول – مع الشعبة
  // ════════════════════════════════
  var sData = scheduleSheet.getDataRange().getValues();
  var days = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء'];
  var rows = [];
  var stats = { total: 0, resolved: 0, unresolved: 0, unresolvedList: {} };

  for (var r = 2; r < sData.length; r++) {
    var teacherShort = (sData[r][0] || '').toString().trim();
    if (!teacherShort) continue;

    var teacherOfficial = resolveTeacherName(teacherShort);
    if (teacherOfficial !== teacherShort) {
      stats.resolved++;
      Logger.log('✅ "' + teacherShort + '" → "' + teacherOfficial + '"');
    } else {
      stats.unresolved++;
      stats.unresolvedList[teacherShort] = true;
    }

    for (var day = 0; day < 5; day++) {
      for (var period = 0; period < 7; period++) {
        var colIndex = 1 + (day * 7 + period);
        var classCode = (sData[r][colIndex] || '').toString().trim();
        if (!classCode) continue;

        var subject = subjectMap[teacherShort + '|' + classCode] || 'مادة غير محددة';
        var displayClass = resolveClassName(classCode);
        var sectionFromCode = getSectionFromCode(classCode);

        rows.push([
          displayClass,
          sectionFromCode,
          days[day],
          period + 1,
          subject,
          teacherOfficial,
          ''
        ]);
        stats.total++;
      }
    }
  }

  if (rows.length === 0) {
    Logger.log('⚠️ لا توجد بيانات للمزامنة.');
    return;
  }

  // ════════════════════════════════
  // 6. كتابة البيانات إلى ملف الطالب
  // ════════════════════════════════
  // ✅ تم تغيير المعرف الثابت إلى الملف النشط الحالي
  var studentFile = SpreadsheetApp.openById(_activeFileId());
  var targetSheet = studentFile.getSheetByName('الجدول');
  if (!targetSheet) targetSheet = studentFile.insertSheet('الجدول');
  else targetSheet.clearContents();

  targetSheet.getRange(1, 1, 1, 7).setValues([[
    'الفصل', 'الشعبة', 'اليوم', 'الحصة', 'المادة', 'المعلم', 'القاعة'
  ]]);
  if (rows.length > 0) targetSheet.getRange(2, 1, rows.length, 7).setValues(rows);
  SpreadsheetApp.flush();

  // ════════════════════════════════
  // 7. تقرير نهائي
  // ════════════════════════════════
  Logger.log('════════════════════════════════');
  Logger.log('✅ تمت مزامنة ' + stats.total + ' حصة.');
  Logger.log('📌 تم تصحيح ' + stats.resolved + ' اسم معلم بنجاح.');
  if (stats.unresolved > 0) {
    Logger.log('⚠️ تعذر تصحيح ' + stats.unresolved + ' اسم(اء):');
    for (var uName in stats.unresolvedList) {
      Logger.log('   • ' + uName);
    }
    Logger.log('   ➤ يرجى التحقق من تطابق الاسم المختصر مع الاسم الكامل في ملف المعلمين الرسمي.');
  }
  Logger.log('════════════════════════════════');
}