/**
 * ═══════════════════════════════════════════════════════════════════
 *  DriveUrlUtils.gs — مكتبة معالجة روابط Google Drive الموحّدة
 *  إصدار: 1.0.0 (مستقر)
 *  School App Yemen — مدارس الإبداع والتميز الدولية
 *
 *  📂 هذا الملف يُنسخ إلى المشاريع التالية:
 *     - منصة الطالب (StudentLogic.gs)
 *     - منصة المعلم (TeacherCore.gs)
 *     - الموقع الرسمي (Code.gs)
 *     - نظام إدارة المحتوى (CMS.gs)
 *     - ❌ لا يُنسخ إلى: أداة توزيع الحصص (لا تتعامل مع Drive)
 *
 *  🎯 الهدف:
 *     توحيد طريقة التعامل مع روابط Google Drive بحيث:
 *       - تُعرض الصور مباشرة في وسم <img> دون إعادة توجيه.
 *       - يُستخرج File ID من أي صيغة رابط.
 *       - تُصنّف روابط الفيديو (YouTube, Facebook, ...).
 *       - تُستخدم نفس الدوال في جميع المنصات.
 *
 *  ⚠️ هام:
 *     هذا الملف يفترض أن البيئة هي Google Apps Script V8.
 *     لا يستخدم أي ميزات ES6+ (template literals، arrow functions، const/let).
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * تحويل أي رابط Google Drive إلى صيغة عرض مباشر (thumbnail).
 */
function normalizeGoogleDriveUrl(url, size) {
  size = size || 1400;
  if (!url || typeof url !== 'string') return url || '';
  url = url.trim();

  if (url.indexOf('drive.google.com') === -1) {
    return url;
  }

  var fileId = extractDriveFileId(url);
  if (!fileId) {
    Logger.log('normalizeGoogleDriveUrl: تعذر استخراج File ID من: ' + url);
    return url;
  }

  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w' + size;
}

/**
 * استخراج Google Drive File ID من أي صيغة رابط.
 */
function extractDriveFileId(url) {
  if (!url) return null;
  url = String(url);

  var match = url.match(/\/file\/d\/([a-zA-Z0-9_\-]+)/);
  if (match && match[1]) return match[1];

  match = url.match(/\/d\/([a-zA-Z0-9_\-]+)/);
  if (match && match[1]) return match[1];

  match = url.match(/[?&]id=([a-zA-Z0-9_\-]+)/);
  if (match && match[1]) return match[1];

  match = url.match(/open\?id=([a-zA-Z0-9_\-]+)/);
  if (match && match[1]) return match[1];

  match = url.match(/thumbnail\?id=([a-zA-Z0-9_\-]+)/);
  if (match && match[1]) return match[1];

  return null;
}

/**
 * تصنيف رابط الفيديو لتحديد طريقة العرض المناسبة.
 */
function classifyVideoUrl(url) {
  if (!url) return { type: 'unknown', embedUrl: url };

  if (url.indexOf('youtube.com') !== -1 || url.indexOf('youtu.be') !== -1) {
    var ytId = extractYouTubeId(url);
    return {
      type: 'youtube',
      embedUrl: ytId ? 'https://www.youtube-nocookie.com/embed/' + ytId + '?rel=0' : url,
      renderAs: ytId ? 'embed' : 'link'
    };
  }

  if (url.indexOf('facebook.com') !== -1) {
    return { type: 'facebook', embedUrl: url, renderAs: 'link' };
  }

  if (url.indexOf('instagram.com') !== -1) {
    return { type: 'instagram', embedUrl: url, renderAs: 'link' };
  }

  if (url.indexOf('drive.google.com') !== -1) {
    var fid = extractDriveFileId(url);
    return {
      type: 'drive_video',
      embedUrl: fid ? 'https://drive.google.com/file/d/' + fid + '/preview' : url,
      renderAs: 'embed'
    };
  }

  return { type: 'unknown', embedUrl: url, renderAs: 'link' };
}

/**
 * استخراج YouTube Video ID من الرابط.
 */
function extractYouTubeId(url) {
  if (!url) return null;
  var patterns = [
    /youtu\.be\/([a-zA-Z0-9_\-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_\-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_\-]{11})/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = url.match(patterns[i]);
    if (match && match[1]) return match[1];
  }
  return null;
}

/**
 * تطبيع جميع روابط Drive في حقل معين داخل مصفوفة كائنات.
 */
function normalizeUrlsInData(dataArray, fieldName) {
  if (!dataArray || !fieldName) return dataArray;
  return dataArray.map(function(row) {
    if (row[fieldName]) {
      row[fieldName] = normalizeGoogleDriveUrl(row[fieldName]);
    }
    return row;
  });
}

/**
 * تشغّل مرة واحدة لتحويل كل روابط Drive القديمة في أوراق News, Images, Schedule إلى الصيغة الصحيحة.
 */
function migrateExistingDriveUrls() {
  var CMS_SHEET_ID = '1J7DY-Z2PZU5y5HH-LR3vhuEhPAkjWz22vMu1rYLcse0';
  var ss = SpreadsheetApp.openById(CMS_SHEET_ID);

  var sheetsToMigrate = [
    { name: 'News',   urlColumn: 'MediaURL',   columnIndex: 5 },
    { name: 'Images', urlColumn: 'ImageURL',   columnIndex: 3 },
    { name: 'Schedule', urlColumn: 'MediaURL', columnIndex: 4 }
  ];

  var totalFixed = 0;
  var totalSkipped = 0;

  sheetsToMigrate.forEach(function(config) {
    var sheet = ss.getSheetByName(config.name);
    if (!sheet) {
      Logger.log('Sheet not found: ' + config.name);
      return;
    }

    var rows = sheet.getDataRange().getValues();
    var headers = rows[0];

    var colIndex = headers.indexOf(config.urlColumn);
    if (colIndex === -1) {
      colIndex = config.columnIndex;
      Logger.log('Column "' + config.urlColumn + '" not found in ' + config.name +
                 ' — using index ' + colIndex);
    }

    var updates = [];

    for (var i = 1; i < rows.length; i++) {
      var raw = String(rows[i][colIndex] || '').trim();
      if (!raw) continue;

      var normalized = normalizeGoogleDriveUrl(raw);
      if (normalized === raw) {
        totalSkipped++;
        continue;
      }

      updates.push({
        row: i + 1,
        col: colIndex + 1,
        original: raw,
        normalized: normalized
      });
    }

    updates.forEach(function(update) {
      sheet.getRange(update.row, update.col).setValue(update.normalized);
      Logger.log('[' + config.name + '] Row ' + update.row + ': ' +
                 update.original + ' → ' + update.normalized);
      totalFixed++;
    });

    Logger.log("Sheet '" + config.name + "': " + updates.length + " URLs fixed.");
  });

  Logger.log('═══ Migration complete ═══');
  Logger.log('Fixed: ' + totalFixed + ' URLs');
  Logger.log('Skipped (already correct): ' + totalSkipped + ' URLs');
}