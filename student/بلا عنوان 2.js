function testGradesUnified() {
  var studentCode = 'ضع_هنا_كود_طالب_حقيقي'; // ⚠️ استبدله
  var result = getGrades(studentCode, '');  // '' تعني المدرسة الافتراضية
  Logger.log('نجح: ' + result.ok);
  Logger.log('موحد (v4): ' + result.v4Unified);
  if (result.months) {
    for (var i = 0; i < result.months.length; i++) {
      Logger.log('شهر: ' + result.months[i].name + ' | عدد المواد: ' + result.months[i].subjects.length);
    }
  }
}