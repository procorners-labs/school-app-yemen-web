# -*- coding: utf-8 -*-
# تحسين _saveYearEndGrade: قراءة الصف مرة واحدة + حساب من الذاكرة (نفس النتيجة)
import io, sys
p = 'teacher/TeacherCore.js'
s = open(p, encoding='utf-8').read()
orig = s
reps = []

# (أ) إضافة قراءة الصف مرة واحدة بعد yc
reps.append((
    "  var yc = _teacherYearEndCols(sheet, subject);\n\n  /* النهائي",
    "  var yc = _teacherYearEndCols(sheet, subject);\n"
    "  var lastCol = _getGradeHeaders(sheet).lastCol;\n"
    "  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];\n\n  /* النهائي"
))

# (ب) محصلة1 من الذاكرة
reps.append((
    "var m1 = _teacherMonthlyFromMonths(sheet, rowIndex, subject, ['محرم', 'صفر']);",
    "var m1 = _yeSumLocs(row, [_findSubjectLocation('محرم', subject), _findSubjectLocation('صفر', subject)]);"
))

# (ج) محصلة2 من الذاكرة
reps.append((
    "var m2 = _teacherMonthlyFromMonths(sheet, rowIndex, subject, ['جماد اول', 'جماد ثاني']);",
    "var m2 = _yeSumLocs(row, [_findSubjectLocation('جماد اول', subject), _findSubjectLocation('جماد ثاني', subject)]);"
))

# (د) النصفي من الذاكرة
reps.append((
    "    midV = _safeNum(sheet.getRange(rowIndex, nf.columns.exam_score + 1).getValue());",
    "    var mv = row[nf.columns.exam_score];\n"
    "    midV = (mv === '' || mv === null || mv === undefined) ? null : _safeNum(mv);"
))

# (هـ) النهائي للإجمالي من الذاكرة
reps.append((
    "  var finalForTotal = fxn;\n"
    "  if (finalForTotal === null && yc.finalEx !== undefined) {\n"
    "    finalForTotal = _safeNum(sheet.getRange(rowIndex, yc.finalEx + 1).getValue());\n"
    "  }",
    "  var finalForTotal = (fxn !== null) ? fxn\n"
    "                      : ((yc.finalEx !== undefined) ? _safeNum(row[yc.finalEx]) : null);"
))

results = []
for (a, b) in reps:
    c = s.count(a)
    if c == 1:
        s = s.replace(a, b)
        results.append('OK')
    else:
        results.append('MISS(' + str(c) + ')')

open(p, 'w', encoding='utf-8').write(s)
sys.stdout.buffer.write((' | '.join(results)).encode('utf-8'))
