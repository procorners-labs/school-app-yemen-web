/**
 * Pipeline.gs — منطق سير العمل: «مراجعة ثم نشر».
 *
 *   جديد ──(توليد)──▶ للمراجعة ──(أنت تعتمد يدوياً)──▶ معتمد ──(نشر)──▶ منشور
 *
 * لا يُنشر أي شيء تلقائياً قبل أن تغيّر حالته إلى «معتمد» بنفسك.
 */

/**
 * ② يولّد النص (Claude) والتصميم (Canva) لكل صف حالته «جديد».
 * النتيجة تُصبح «للمراجعة».
 */
function generateDrafts() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_POSTS);
  if (!sh) { toast_('شغّل «تجهيز الجدول» أولاً.'); return; }
  const settings = readSettings_();
  const last = sh.getLastRow();
  if (last < 2) return;

  const rows = sh.getRange(2, 1, last - 1, POSTS_HEADERS.length).getValues();
  let processed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = i + 2; // رقم الصف الفعلي
    const status = String(rows[i][COL.STATUS - 1]).trim();
    const input  = String(rows[i][COL.INPUT - 1]).trim();
    const type   = String(rows[i][COL.TYPE - 1]).trim() || 'تحفيزي';

    if (status !== STATUS.NEW) continue;
    if (!input && type !== 'تحفيزي') {
      setCell_(sh, r, COL.STATUS, STATUS.FAILED);
      setCell_(sh, r, COL.LOG, 'أضِف مدخلات في عمود «المدخلات».');
      continue;
    }

    setCell_(sh, r, COL.STATUS, STATUS.DRAFTING);
    if (!rows[i][COL.ID - 1]) setCell_(sh, r, COL.ID, 'P' + Date.now() + i);

    try {
      // 1) النص
      const caption = generateCaption_(type, input, settings);
      setCell_(sh, r, COL.CAPTION, caption);

      // 2) التصميم (إن كان Canva مهيّأ)
      let logMsg = 'تم توليد النص. ';
      if (canvaEnabled_()) {
        try {
          const d = makeDesign_(type, caption);
          setCell_(sh, r, COL.DESIGN, d.designUrl);
          setCell_(sh, r, COL.IMAGE, d.imageUrl);
          logMsg += 'تم توليد التصميم.';
        } catch (ce) {
          logMsg += 'تعذّر التصميم آلياً (صمّمه يدوياً): ' + ce.message;
        }
      } else {
        logMsg += 'Canva غير مُفعّل — أضِف رابط صورة يدوياً قبل النشر.';
      }

      setCell_(sh, r, COL.STATUS, STATUS.REVIEW);
      setCell_(sh, r, COL.LOG, logMsg + ' [' + nowStr_() + ']');
      processed++;
    } catch (e) {
      setCell_(sh, r, COL.STATUS, STATUS.FAILED);
      setCell_(sh, r, COL.LOG, 'خطأ: ' + e.message + ' [' + nowStr_() + ']');
    }
  }
  toast_('تم توليد ' + processed + ' مسودّة. راجِعها ثم غيّر الحالة إلى «' + STATUS.APPROVED + '».');
}

/**
 * ③ ينشر كل صف حالته «معتمد» وحان وقته (إن حُدِّد تاريخ).
 * النتيجة تُصبح «منشور» أو «فشل».
 */
function publishApproved() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_POSTS);
  if (!sh) return;
  const last = sh.getLastRow();
  if (last < 2) return;

  const rows = sh.getRange(2, 1, last - 1, POSTS_HEADERS.length).getValues();
  const now = new Date();
  let published = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = i + 2;
    const status = String(rows[i][COL.STATUS - 1]).trim();
    if (status !== STATUS.APPROVED) continue;

    // احترام التاريخ المجدوَل إن وُجد
    const when = rows[i][COL.DATE - 1];
    if (when instanceof Date && when.getTime() > now.getTime()) continue;

    const caption   = String(rows[i][COL.CAPTION - 1]).trim();
    const imageUrl  = String(rows[i][COL.IMAGE - 1]).trim();
    const platforms = String(rows[i][COL.PLATFORMS - 1]).trim() || 'فيسبوك';

    if (!caption) {
      setCell_(sh, r, COL.STATUS, STATUS.FAILED);
      setCell_(sh, r, COL.LOG, 'لا يوجد نص للنشر.');
      continue;
    }

    try {
      const result = publishPost_(caption, imageUrl, platforms);
      if (result.ok) {
        setCell_(sh, r, COL.STATUS, STATUS.PUBLISHED);
        setCell_(sh, r, COL.POST_ID, JSON.stringify(result.ids));
        setCell_(sh, r, COL.LOG, 'تم النشر ✅ [' + nowStr_() + ']' +
          (result.errors.length ? ' | تنبيهات: ' + result.errors.join(' / ') : ''));
        published++;
      } else {
        setCell_(sh, r, COL.STATUS, STATUS.FAILED);
        setCell_(sh, r, COL.LOG, 'فشل النشر: ' + result.errors.join(' / ') + ' [' + nowStr_() + ']');
      }
    } catch (e) {
      setCell_(sh, r, COL.STATUS, STATUS.FAILED);
      setCell_(sh, r, COL.LOG, 'خطأ نشر: ' + e.message + ' [' + nowStr_() + ']');
    }
  }
  toast_('تم نشر ' + published + ' منشور.');
}

// ===== أدوات مساعدة =====
function setCell_(sh, row, col, val) { sh.getRange(row, col).setValue(val); }
function nowStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}
function toast_(msg) {
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'أتمتة المنشورات', 6); } catch (e) {}
}
