/*!
 * offline-sync.js — محرك العمل دون اتصال + المزامنة التلقائية + واجهة الحالة
 * مدارس الإبداع والتميز الدولية
 *
 * يعمل بالتعاون مع gas-bridge.js (الذي يستشير window.OfflineSync لكل نداء):
 *   - تصنيف الدوال: قراءة (تُخزَّن وتُخدَم دون اتصال) / كتابة قابلة للطابور / online-only.
 *   - طابور كتابة دائم (outbox) يُزامَن تلقائياً عند عودة الإنترنت (FIFO + إعادة محاولة).
 *   - كاش قراءة دائم لعرض آخر بيانات دون اتصال.
 *   - جلسة دائمة: حفظ/استعادة توكن المعلّم والطالب ليعمل التطبيق بعد إعادة الفتح دون نت.
 *   - شارة عائمة عربية تُظهر حالة الاتصال وعدد العمليات المعلّقة + إشعارات المزامنة.
 *
 * يعتمد على window.OfflineDB (offline-db.js).
 */
(function () {
  'use strict';

  if (!window.OfflineDB) {
    // بلا تخزين دائم لا نستطيع العمل دون اتصال — نترك السلوك الأصلي للجسر.
    return;
  }

  var OUTBOX = 'outbox';
  var READCACHE = 'readcache';
  var KV = 'kv';

  // ── تصنيف الدوال ─────────────────────────────────────────────
  // كتابات المعلّم القابلة للطابور (النطاق المتفق عليه).
  var WRITE_QUEUEABLE = {
    saveAttendanceSingleProtected: true,
    addListItemProtected: true,
    updateListItemProtected: true,
    deleteListItemProtected: true,
    adminSaveTeacherGrouped: true,
    adminDeleteTeacherByName: true
  };

  // دوال يجب أن تصل الشبكة فوراً (تفشل بلطف دون اتصال): مصادقة/رفع ملفات/كتابات خارج النطاق.
  var ONLINE_ONLY = {
    handleTeacherLogin: true,
    loginStudent: true,
    handleTeacherLogout: true,
    changePassword: true,
    uploadFileToDrive: true
  };

  /* 🔒 (الدفعة 29a2 · 2026-10-01) **دوالُّ الدخول على الشبكة وحدها: لا كاشَ ولا طابورَ ولا إعادةَ تشغيل.**
     كانت القاعدةُ العامّة في `classify` تعدّ كلَّ `login*` قراءةً ⇒ ردُّ `loginStudentByDeviceProtected`
     كاملاً (`switchToken` ورموزُ الإخوة من `_stuBuildLoginResult_`) يُكتب في `readcache` ولا يمسحه
     الخروج، و`revalidate()` يُعيد الدخولَ بـ`deviceSecret` عند عودة الاتصال، ودون اتصالٍ يُخدَم الردُّ
     القديم كأنه دخولٌ جديد. ⇒ «دالّةُ دخول» = كلُّ اسمٍ يذكر `login` بأيّ حالة أحرف + هذه القائمة:
     أسماءُ `BH_LOGIN_FNS` في الوسيط ودخولُ CMS، ودالّتا الطالب اللتان تُصدران `switchToken`.
     🔁 نسخةٌ مطابقةٌ في `gas-bridge.js` (‏`LOGIN_FNS`) — يفرض تطابقَهما `tests/login_never_cached.test.js`. */
  var LOGIN_FNS = {
    handleTeacherLogin: true,
    handleTeacherLoginByDevice: true,
    loginStudent: true,
    loginStudentByDeviceProtected: true,
    masterLogin: true,
    handleCmsLogin: true,
    handleCmsAutoLogin: true,
    switchStudentAccount: true,
    refreshStudentSiblings: true
  };

  function isLoginFn(fn) {
    return typeof fn === 'string' && (Object.prototype.hasOwnProperty.call(LOGIN_FNS, fn) || /login/i.test(fn));
  }

  /* 🔒 L4 (2026-09-29): **لا تُحفظ ردودُ الدخول هنا بعد اليوم.** كانت تُكتب كلُّ ردٍّ (حتى الفاشل، ومعه
     `switchToken` ورموزُ الإخوة) في `teacherSession_v2`/`studentSession_v2` وفي IndexedDB، ولا أحدَ يقرؤها
     (الصفحتان تحفظان جلستيهما بنفسيهما: `teacherSession_v1` و`studentSession_v1`)، والخروجُ لا يمسحها ⇒
     رموزٌ تبقى على الأجهزة المشتركة. `purgeLegacySessions` يمسح ما بقي منها عند كلّ تحميل. */
  var SESSION_FNS = {};

  function classify(fn) {
    if (!fn || typeof fn !== 'string') return 'online-only';
    if (isLoginFn(fn)) return 'online-only';   // 🔒 29a2: قبل كلّ قاعدة
    if (ONLINE_ONLY[fn]) return 'online-only';
    if (WRITE_QUEUEABLE[fn]) return 'write';
    /* 🔴 **`upload|media|attach` تُستثنى قبل أيّ قاعدةٍ عامّة — وهي فجوةٌ كامنةٌ لا حالةٌ واقعة.**
       نظيرُ هذا التصنيف في الجسر (`_csIsRead`/`_stuIsRead`) يستثنيها صراحةً لأن مهلةَ
       الرفع **١٨٠ث** فوق مهلة خانة التزامن ⇒ دالّةٌ مثل `getMediaAttachments` كانت
       تُصنَّف قراءةً **فتُخزَّن حمولةُ رفعٍ ثقيلةٌ في IndexedDB بلا داعٍ**.
       🎯 والتصنيفان يجب أن يفترقا **أبداً** — نسختان تتباعدان بصمت. */
    if (/upload|media|attach/i.test(fn)) return 'online-only';

    // قاعدة عامّة: الدوال التي تبدأ بـ get أو check (قراءة) تُخزَّن. (`login*` ليست قراءةً — 29a2 أعلاه)
    if (/^get/i.test(fn) || /^check/i.test(fn)) return 'read';

    /* 🔴 **`list*` قراءةٌ أيضاً — وسقوطُها كان فجوةً مقيسة، لا احتياطاً مقصوداً.**

       🎯 **العلّةُ مقيسةٌ 2026-09-22:** من **٨٥ نداءً قرائيّاً** عبر `callServer` في سطح
       المعلّم، **٨٢ مغطّاةٌ بالقاعدة أعلاه و٣ تسقط** — وكلُّها تبدأ بـ`list`:
       `listCircularsProtected` (‏٤ مواضع) · `listPlatformReviewRequestsProtected` ·
       `listMyBiometricDevicesProtected`.

       **والأثرُ ليس تنظيمياً:** `online-only` تعني **لا تُخزَّن ولا تُخدَم بائتةً** ⇒
       أيُّ 502 على «التعاميم» **يصل المستخدمَ خطأً**، بينما نظيرتُها `getAllNewsProtected`
       تُخدَم من آخر نسخةٍ ناجحة. ⇒ **نفسُ الشاشة، سلوكان مختلفان، والفارقُ حرفُ اسمٍ.**

       🔴 **والبادئةُ `list` قرائيّةٌ بعقدِ هذا المستودع لا باجتهاد:** `_csIsRead` في الجسر
       تُصنّفها قراءةً منذ إنشائها (‏`/^get|^check|^list/`). ⇒ **التصنيفان كانا مفترقَين،
       وهذا يوحّدهما** — والافتراقُ هو العلّةُ لا الاسم.

       ⚠️ **ولا يُوسَّع إلى بادئةٍ رابعة بلا قياس:** `save`/`add`/`submit` كتابةٌ، وإدخالُها
       هنا يجعل الفشلَ يُخدَم من كاشٍ **فيُقرأ نجاحاً** — وهو أخطرُ من 502 بكثير. */
    if (/^list/i.test(fn)) return 'read';
    // مجموعة قراءة صريحة لا تبدأ بـ get.
    if (fn === 'getTeachersForClass' || fn === 'getV3Config' || fn === 'adminGetAllTeachersGrouped') return 'read';
    // أي شيء آخر: لا نخاطر بالطابور — اتركه online-only (سلوك أصلي).
    return 'online-only';
  }

  // ── أدوات ────────────────────────────────────────────────────
  function nowISO() { return new Date().toISOString(); }

  function clientId() {
    try {
      var id = localStorage.getItem('teacherClientId') ||
               localStorage.getItem('stu_clientId') ||
               localStorage.getItem('offlineClientId');
      if (!id) {
        id = 'cid_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('offlineClientId', id);
      }
      return id;
    } catch (e) {
      return 'cid_anon';
    }
  }

  function newOpId() {
    return clientId() + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // تجزئة بسيطة ومستقرّة للوسائط (لمفتاح الكاش).
  function hashArgs(args) {
    var s;
    try { s = JSON.stringify(args || []); } catch (e) { s = String(args); }
    var h = 5381, i = s.length;
    while (i) { h = (h * 33) ^ s.charCodeAt(--i); }
    return (h >>> 0).toString(36);
  }

  function readKey(app, fn, args, schoolId) {
    return (app || '?') + ':' + fn + ':' + hashArgs(args) + ':' + (schoolId || '');
  }

  // هل الدالّةُ في مفتاح `readKey` تحقّق `test`؟ هي الثالثةُ من الآخر (قد يحوي `app` نقطتين حين تكون
  // `GAS_ENDPOINT` رابطاً كاملاً)، والثانيةُ من الأوّل احتياطاً.
  function readKeyHasFn(key, test) {
    var p = String(key || '').split(':');
    if (p.length < 4) return false;
    return test(p[p.length - 3]) || test(p[1]);
  }
  function readKeyIsLogin(key) { return readKeyHasFn(key, isLoginFn); }

  function appName() {
    // /gas/teacher → teacher
    var ep = window.GAS_ENDPOINT || '';
    var m = ep.match(/\/gas\/([a-zA-Z]+)/);
    return m ? m[1] : (ep || 'app');
  }

  function isOnline() {
    return (typeof navigator === 'undefined') ? true : (navigator.onLine !== false);
  }

  // ── كاش القراءة ──────────────────────────────────────────────
  function cacheRead(app, fn, args, schoolId, result) {
    if (isLoginFn(fn)) return Promise.resolve();   // 🔒 29a2: ردُّ الدخول لا يُكتب أبداً (ولو طلبه جسرٌ قديم)
    return OfflineDB.set(READCACHE, readKey(app, fn, args, schoolId), {
      result: result, savedAt: nowISO()
    });
  }

  function getCachedRead(app, fn, args, schoolId) {
    if (isLoginFn(fn)) return Promise.resolve(null);   // ولا يُخدَم ردُّ دخولٍ قديم
    return OfflineDB.get(READCACHE, readKey(app, fn, args, schoolId));
  }

  // ── طابور الكتابة ────────────────────────────────────────────
  /* 🔑 `opId` يُحفظ مع العمليّة ويُعاد به نفسِه في كلّ إرسال — فالخادمُ يُرجِع نتيجةَ تنفيذٍ
     سابقٍ تمّ (ضاع جوابُه) بلا تنفيذٍ ثانٍ (`teacher/ApiEndpoint.js`). يمرّره الجسرُ حين
     وُلدت الكتابةُ متّصلةً فأُرسلت مرّةً قبل الطابور؛ وإلّا يُولَّد هنا. */
  var OP_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
  function enqueue(app, fn, args, schoolId, opId) {
    // 🔒 29a2: دالّةُ دخولٍ لا تدخل الطابور (وسائطُها كلمةُ مرورٍ أو `deviceSecret`) — ولا «نجاحَ» متفائلاً لها.
    if (isLoginFn(fn)) return Promise.reject(new Error('online-only: ' + fn));
    var op = {
      key: newOpId(),
      opId: (typeof opId === 'string' && OP_ID_RE.test(opId)) ? opId
            : ('op' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12)),
      app: app,
      fn: fn,
      args: args,
      schoolId: schoolId,
      createdAt: nowISO(),
      tries: 0,
      status: 'pending'
    };
    return OfflineDB.set(OUTBOX, op.key, op).then(function () {
      UI.refresh();
      requestBackgroundSync();
      return op;
    });
  }

  function pendingOps() {
    return OfflineDB.all(OUTBOX).then(function (ops) {
      ops = ops || [];
      // FIFO حسب وقت الإنشاء.
      ops.sort(function (a, b) { return (a.createdAt < b.createdAt) ? -1 : 1; });
      return ops;
    });
  }

  function pendingCount() {
    return pendingOps().then(function (ops) {
      var n = 0;
      for (var i = 0; i < ops.length; i++) if (ops[i].status !== 'failed') n++;
      return n;
    });
  }

  // ── سجلّ الكتابات الفاشلة (الدفعة 28k) ────────────────────────
  /* 🔴 الكتابةُ التي يرفضها الخادمُ منطقياً عند إعادة التشغيل كانت تبقى في الطابور «فاشلةً»
     **بلا سقفٍ ولا طريقِ مراجعة، وبوسائطها كاملةً**: توكنُ الجلسة في كلّ نداء، وكلمةُ مرور
     المعلّم الجديد في `adminSaveTeacherGrouped`. ⇒ تُنقل الآن إلى سجلٍّ مختصرٍ في `kv` (آخرُ
     ٥٠): الدالّة، ملخّصُ الوسائط **بلا أيّ سرّ**، نصُّ الخطأ، الوقت — ثمّ تُحذف من الطابور.
     المراجعةُ من الطرفيّة: `OfflineSync.failed()` ⇒ وعدٌ بالقائمة، و`OfflineSync.clearFailed()`.
     🔒 لا يُحفظ هنا ردُّ خادمٍ أبداً (ولا ردُّ دخول) — نصُّ الخطأ وحده. */
  var FAILED_KEY = 'failed_writes';
  var FAILED_MAX = 50;
  /* (29a2) و`pw`/`newPw`/`oldPw` و`apiKey`/`inviteKey` أيضاً (`^pw|pw$|key$`)؛ و`deviceSecret` تغطّيه `secret`،
     وقيمتُه (٦٤ محرفاً ست عشرياً) تُحجب بـ`SECRET_VAL_RE` ولو مُرِّرت بلا مفتاح. */
  var SECRET_KEY_RE = /pass|pwd|token|secret|otp|hash|cookie|session|auth|credential|signature|bridgesig|كلمة|رمز|^pw|pw$|key$/i;
  var SECRET_EXACT_RE = /^(sig|pin|key)$/i;
  var SECRET_VAL_RE = /^[A-Za-z0-9_\-.+\/=]{24,}$/;   // قيمةٌ تشبه التوكن: طويلةٌ بلا مسافات

  function redactValue(v, depth) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') {
      if (SECRET_VAL_RE.test(v)) return '[redacted]';
      return v.length > 60 ? v.substring(0, 60) + '…' : v;
    }
    if (typeof v !== 'object') return v;
    if (depth > 3) return '…';
    var i, out;
    if (Object.prototype.toString.call(v) === '[object Array]') {
      out = [];
      for (i = 0; i < v.length && i < 10; i++) out.push(redactValue(v[i], depth + 1));
      if (v.length > 10) out.push('…+' + (v.length - 10));
      return out;
    }
    out = {};
    var n = 0;
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      if (n++ >= 20) { out['…'] = '+'; break; }
      out[k] = (SECRET_KEY_RE.test(k) || SECRET_EXACT_RE.test(k)) ? '[redacted]' : redactValue(v[k], depth + 1);
    }
    return out;
  }

  // ملخّصٌ قصيرٌ للوسائط للمراجعة — بلا كلمات مرور ولا توكنات (مفتاحاً أو قيمةً).
  function summarizeArgs(fn, args) {
    if (/login|logout|password|passwd/i.test(String(fn || ''))) return '';
    var s = '';
    try { s = JSON.stringify(redactValue(args, 0)) || ''; } catch (e) { s = ''; }
    return s.length > 300 ? s.substring(0, 300) + '…' : s;
  }

  function failedList() {
    return OfflineDB.get(KV, FAILED_KEY).then(function (list) {
      return (Object.prototype.toString.call(list) === '[object Array]') ? list.slice() : [];
    });
  }

  function recordFailed(op, error) {
    var rec = {
      at: nowISO(),
      createdAt: op.createdAt || '',
      app: op.app || '',
      fn: String(op.fn || ''),
      schoolId: op.schoolId || '',
      opId: op.opId || '',
      tries: op.tries || 0,
      error: String(error || '').substring(0, 300),
      args: summarizeArgs(op.fn, op.args)
    };
    return failedList().then(function (list) {
      list.push(rec);
      if (list.length > FAILED_MAX) list = list.slice(list.length - FAILED_MAX);
      return OfflineDB.set(KV, FAILED_KEY, list);
    }).then(function () { return rec; });
  }

  // يُسجَّل المختصرُ أوّلاً، ثم يُحذف من الطابور — فإن تعذّر التسجيلُ بقيت العمليّةُ كما هي.
  function moveToFailed(op, error) {
    return recordFailed(op, error).then(function () { return OfflineDB.del(OUTBOX, op.key); });
  }

  function clearFailed() {
    return OfflineDB.del(KV, FAILED_KEY).then(function () { UI.refresh(); });
  }

  // عمليّاتٌ عُلِّمت «فاشلة» قبل هذه الطبقة وبقيت في الطابور بوسائطها الكاملة ⇒ تُنقل مرّةً.
  function migrateLegacyFailed() {
    return pendingOps().then(function (ops) {
      var chain = Promise.resolve();
      ops.forEach(function (op) {
        if (op.status !== 'failed') return;
        chain = chain.then(function () { return moveToFailed(op, op.lastError || ''); });
      });
      return chain;
    })['catch'](function () {});
  }

  // ── المزامنة ─────────────────────────────────────────────────
  var _flushing = false;
  var _retryTimer = null;
  var _retryDelay = 2000; // يبدأ 2s ثم يتضاعف حتى 60s

  function scheduleRetry() {
    if (_retryTimer) return;
    _retryTimer = setTimeout(function () {
      _retryTimer = null;
      flush();
    }, _retryDelay);
    _retryDelay = Math.min(_retryDelay * 2, 60000);
  }

  function resetRetry() { _retryDelay = 2000; if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; } }

  // ينفّذ عملية واحدة عبر النقل الخام في الجسر، ويعيد Promise.
  function runOp(op) {
    return new Promise(function (resolve) {
      if (!window.__gasRawCall) { resolve({ kind: 'network' }); return; }
      /* عمليّةٌ قديمةٌ في الطابور قبل هذه الطبقة بلا `opId` ⇒ تُرسَل بلاه كما كانت (لا اختلاق). */
      var oid = (typeof op.opId === 'string' && OP_ID_RE.test(op.opId)) ? op.opId : undefined;
      window.__gasRawCall(op.fn, op.args, function (res) {
        /* 🔴 (الدفعة 15 · 2026-09-28) ردٌّ منطقيٌّ فاشل `{success:false}` (لا صلاحية · صفٌّ تغيّر ·
           قيمةٌ مرفوضة) كان يُحذف من الطابور **كأنه نجح** ⇒ كتابةُ المعلّم تضيع بصمت. الآن تُعامَل
           كخطأ خادم: تُنقل إلى سجلّ الفاشلة للمراجعة وتُبلَّغ.
           (28k) و`{ok:false}` مثلُها — وكان يمرّ نجاحاً. أمّا «الخادم مشغول» (`busy:true` · قفلٌ
           لم يُنل) فعابرٌ لا رفض: يبقى في الطابور ويُعاد لاحقاً — الخادمُ لا يخزّن الفشلَ المنطقيّ
           لنفس `opId` (‏`_apiOpEnd_`) فالإعادةُ تُنفَّذ فعلاً. */
        if (res && typeof res === 'object' && (res.success === false || res.ok === false)) {
          var why = String(res.error || res.message || 'رفض الخادم العملية');
          if (res.busy === true || /الخادم مشغول|العملية مشغولة/.test(why)) { resolve({ kind: 'network', busy: true }); return; }
          try { if (typeof window.reportAppError === 'function') window.reportAppError('offline-replay', why.substring(0, 400), '', op.fn); } catch (eR) {}
          resolve({ kind: 'server', error: why });
          return;
        }
        resolve({ kind: 'ok' });
      }, function (err) {
        // نميّز خطأ الشبكة عن خطأ الخادم المنطقي عبر علامة يضبطها الجسر.
        var net = err && err.__network === true;
        var msg = (err && err.message) || 'خطأ';
        /* (28k) استثناءُ خادمٍ يُسقط الكتابةَ من الطابور ⇒ يُبلَّغ بوصفه إسقاطاً (الجسرُ بلّغ الاستثناءَ نفسَه). */
        if (!net) { try { if (typeof window.reportAppError === 'function') window.reportAppError('offline-replay', String(msg).substring(0, 400), '', op.fn); } catch (eR2) {} }
        resolve({ kind: net ? 'network' : 'server', error: msg });
      }, undefined, oid);
    });
  }

  function flush() {
    if (_flushing) return Promise.resolve();
    if (!isOnline()) return Promise.resolve();
    _flushing = true;
    var synced = 0, failed = 0;

    return pendingOps().then(function (ops) {
      var queue = ops.filter(function (o) { return o.status !== 'failed'; });
      if (queue.length === 0) { return; }
      UI.setSyncing(true);

      // تسلسلي: لا نحذف عملية قبل تأكيد نجاحها (يقلّل التكرار وفقدان البيانات).
      var chain = Promise.resolve();
      queue.forEach(function (op) {
        chain = chain.then(function (stop) {
          if (stop) return stop; // توقّفنا بسبب خطأ شبكة
          op.tries++;
          op.status = 'syncing';
          return OfflineDB.set(OUTBOX, op.key, op).then(function () {
            return runOp(op);
          }).then(function (r) {
            if (r.kind === 'ok') {
              synced++;
              return OfflineDB.del(OUTBOX, op.key).then(function () { UI.refresh(); return false; });
            }
            if (r.kind === 'server') {
              // خطأ منطقي من الخادم: لن تنجح بالإعادة — تُنقل إلى سجلّ الفاشلة (مختصرةً بلا أسرار) للمراجعة.
              failed++;
              return moveToFailed(op, r.error).then(function () { UI.refresh(); return false; }, function () {
                // تعذّر التسجيل ⇒ لا حذف: تبقى «فاشلة» في الطابور كما كانت (لا فقدَ صامت).
                op.status = 'failed';
                op.lastError = r.error;
                return OfflineDB.set(OUTBOX, op.key, op).then(function () { UI.refresh(); return false; });
              });
            }
            // خطأ شبكة: نتوقّف ونعيد المحاولة لاحقاً (نُبقي الترتيب).
            op.status = 'pending';
            return OfflineDB.set(OUTBOX, op.key, op).then(function () { return true; });
          });
        });
      });
      return chain;
    }).then(function () {
      UI.setSyncing(false);
      _flushing = false;
      return pendingCount().then(function (n) {
        if (synced > 0) UI.toast('✅ تمت مزامنة ' + synced + ' عملية', 'ok');
        if (failed > 0) UI.toast('⚠️ تعذّرت مزامنة ' + failed + ' عملية — راجعها', 'warn');
        if (n > 0) { scheduleRetry(); } else { resetRetry(); }
        UI.refresh();
        return { synced: synced, failed: failed };
      });
    })['catch'](function () {
      UI.setSyncing(false);
      _flushing = false;
      scheduleRetry();
      return { synced: synced, failed: failed };
    });
  }

  function requestBackgroundSync() {
    try {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg.sync) reg.sync.register('creativity-outbox-sync')['catch'](function () {});
        })['catch'](function () {});
      }
    } catch (e) {}
  }

  // ── إعادة التحقّق الذكية للبيانات + التحديث الديناميكي ────────
  // نتتبّع نداءات القراءة المعروضة في هذه الجلسة، فعند عودة الاتصال نعيد جلبها
  // في الخلفية ونحدّث الكاش؛ وإن تغيّرت البيانات نحدّث الشاشة ذكياً.
  var trackedReads = {}; // key → {app, fn, args, schoolId}

  function trackRead(app, fn, args, schoolId) {
    if (isLoginFn(fn)) return;   // 🔒 29a2: الدخولُ لا يُعاد تشغيلُه عند عودة الاتصال
    try { trackedReads[readKey(app, fn, args, schoolId)] = { app: app, fn: fn, args: args, schoolId: schoolId }; }
    catch (e) {}
  }

  function stableStr(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }

  // يعيد جلب كل القراءات المتتبَّعة، يحدّث الكاش، ويُرجع true إن تغيّرت أي نتيجة.
  function revalidate() {
    if (!isOnline()) return Promise.resolve(false);
    var keys = Object.keys(trackedReads).filter(function (k) { return !isLoginFn(trackedReads[k].fn); });   // 🔒 29a2
    if (keys.length === 0) return Promise.resolve(false);

    /* 🔴 اثنان في آنٍ واحد لا الكلُّ دفعةً (2026-09-24): حدثُ `online` كان يُطلق كلَّ القراءات
       المتتبَّعة معاً فتصطدم بحدّ الوسيط (503) لحظةَ عودة الاتصال بالضبط. */
    var results = [], idx = 0, LIMIT = 2;
    function one(k) {
      var r = trackedReads[k];
      return new Promise(function (resolve) {
        if (!window.__gasRawCall) { resolve(false); return; }
        // نضبط GAS_ENDPOINT المناسب للتطبيق الحالي (نفس الصفحة) — متوافق مع البنية.
        window.__gasRawCall(r.fn, r.args, function (result) {
          getCachedRead(r.app, r.fn, r.args, r.schoolId).then(function (prev) {
            var changed = !prev || stableStr(prev.result) !== stableStr(result);
            cacheRead(r.app, r.fn, r.args, r.schoolId, result).then(function () { resolve(changed); });
          });
        }, function () { resolve(false); }); // فشل/خطأ: لا نعدّه تغييراً
      });
    }
    function worker() {
      if (idx >= keys.length) return Promise.resolve();
      var k = keys[idx++];
      return one(k).then(function (ch) { results.push(ch); return worker(); });
    }
    var ws = [];
    for (var w = 0; w < Math.min(LIMIT, keys.length); w++) ws.push(worker());
    return Promise.all(ws).then(function () {
      for (var i = 0; i < results.length; i++) if (results[i]) return true;
      return false;
    });
  }

  // تحديث ديناميكي للشاشة: إعادة تحميل آمنة (لا تقاطع إدخال المستخدم).
  var _refreshPending = false;
  function isSafeToReload() {
    try {
      if (typeof document !== 'undefined' && document.hidden) return false;
      var a = document.activeElement;
      if (a) {
        var t = (a.tagName || '').toUpperCase();
        if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || a.isContentEditable) return false;
      }
      return true;
    } catch (e) { return true; }
  }
  function tryRefresh() {
    if (!_refreshPending) return;
    if (isSafeToReload()) {
      try { window.location.reload(); } catch (e) {}
    }
  }
  // يُطلب التحديث عند تغيّر البيانات أو بعد مزامنة كتابات؛ فوري إن أمكن وإلا يؤجَّل بأمان.
  function requestRefresh() {
    _refreshPending = true;
    UI.showRefresh();   // زر «تحديث» غير مزعج كخيار يدوي فوري
    tryRefresh();       // تحديث تلقائي إن كان آمناً الآن
  }

  // تُستدعى عند عودة الاتصال: مزامنة الكتابات ثم تحديث القراءات ذكياً.
  function syncNow() {
    resetRetry();
    return flush().then(function (res) {
      return revalidate().then(function (changed) {
        if ((res && res.synced > 0) || changed) requestRefresh();
      });
    });
  }

  // ── الجلسة الدائمة ───────────────────────────────────────────
  // تُستدعى من الجسر بعد نجاح دالة مصادقة، لحفظ الجلسة بشكل دائم.
  var SESSION_LS_KEYS = { teacher: 'teacherSession_v2', student: 'studentSession_v2' };
  var SESSION_TTL_MS  = 28800000; // 8 ساعات

  function purgeLegacySessions() {
    try { localStorage.removeItem('teacherSession_v2'); localStorage.removeItem('studentSession_v2'); } catch (e) {}
    try { OfflineDB.del(KV, 'session:teacher'); OfflineDB.del(KV, 'session:student'); } catch (e2) {}
  }

  /* 🔒 (29a2) ردودُ الدخول التي حفظها الإصدارُ السابق في `readcache` تُمسح عند كلّ تحميل (بالمفاتيح
     وحدها، فالتحميلاتُ التالية لا تجد شيئاً)، وتستدعيه صفحتا الخروج أيضاً (`clearSession` في اللوحة ·
     `lsClearSession` في البوّابة). `OfflineDB.purge` يمسح IndexedDB ونسخةَ localStorage الاحتياطية معاً.
     ⚠️ وإن خدم عاملُ الخدمة `offline-db.js` قديماً بلا `purge` يُؤجَّل المسحُ إلى تحميلٍ لاحق — بلا رمي. */
  function purgeReadcache(pred) {
    try {
      if (typeof OfflineDB.purge !== 'function') return Promise.resolve(0);
      return OfflineDB.purge(READCACHE, pred)['catch'](function () { return 0; });
    } catch (e) { return Promise.resolve(0); }
  }
  function purgeLoginCache() { return purgeReadcache(readKeyIsLogin); }

  /* 🔒 (29a2) **فحوصُ الجلسة قراءاتٌ عاديّة تبقى مخزّنةً ما دامت الجلسةُ حيّة** — استعادةُ اللوحة دون اتصال
     تقوم عليها (بلا ردٍّ مخزَّن يظهر الدخولُ: `_restoreKeepSessionOffline`) — **وتُمسح حين تنتهي جلستُها وحدها:**
     `checkSession` يُعيد التوكنَ نفسَه في ردّه، و`checkMasterSession`/`checkCmsSession` هويّةَ الجلسة (الاسم والدور).
     ولا قراءةَ مخزّنةً أخرى تُعيد توكناً (مسحُ مفاتيح `token`/`switchToken` في المشاريع الأربعة · 2026-10-01).
     ⚠️ والصفحاتُ كلُّها أصلٌ واحد (IndexedDB واحدة) ⇒ كلُّ خروجٍ يمسح فحصَ **الجلسة التي ينهيها** (`checkFn`)
     لا فحوصَ جلساتٍ أخرى ما زالت حيّةً على الجهاز نفسِه. وردودُ الدخول تُمسح معه دائماً. */
  var SESSION_CHECK_FNS = { checkSession: true, checkMasterSession: true, checkCmsSession: true };
  function purgeSessionCache(checkFn) {
    var own = Object.prototype.hasOwnProperty.call(SESSION_CHECK_FNS, checkFn) ? checkFn : '';
    return purgeReadcache(function (k) {
      return readKeyIsLogin(k) || (own !== '' && readKeyHasFn(k, function (f) { return f === own; }));
    });
  }

  function persistSession(fn, result) {
    if (isLoginFn(fn)) return;   // 🔒 L4 + 29a2: ردُّ الدخول لا يُحفظ هنا أبداً
    var which = SESSION_FNS[fn];
    if (!which || !result) return;
    // كتابة في IndexedDB (للعمل دون اتصال الكامل)
    OfflineDB.set(KV, 'session:' + which, { result: result, savedAt: nowISO() });
    // كتابة في localStorage أيضاً (بديل سريع لاستعادة الجلسة عند التحديث)
    try {
      var lsKey = SESSION_LS_KEYS[which];
      if (lsKey) {
        var obj = { data: result, savedAt: Date.now(), ttl: SESSION_TTL_MS };
        localStorage.setItem(lsKey, JSON.stringify(obj));
      }
    } catch (e) {}
  }

  // تُستعاد الجلسة المخزّنة (إن وُجدت) — يستدعيها كود التطبيق عند الإقلاع إن لزم.
  function getPersistedSession(which) {
    return OfflineDB.get(KV, 'session:' + which);
  }

  // ── الواجهة (شارة + إشعارات) ─────────────────────────────────
  var UI = (function () {
    var pill, countEl, dot, label, toastWrap, syncing = false;

    function ensure() {
      if (pill || typeof document === 'undefined' || !document.body) return;
      var style = document.createElement('style');
      style.textContent =
        '#ofl-pill{position:fixed;z-index:2147483000;bottom:16px;inset-inline-start:16px;' +
        'display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;' +
        'font:600 13px/1 "Segoe UI",Tahoma,system-ui,sans-serif;color:#fff;direction:rtl;' +
        'background:#1b6fd6;box-shadow:0 8px 24px rgba(0,0,0,.3);cursor:default;' +
        'transition:background .3s,opacity .3s;opacity:.96}' +
        '#ofl-pill .d{width:9px;height:9px;border-radius:50%;background:#fff;flex:0 0 auto}' +
        '#ofl-pill.off{background:#c0392b}#ofl-pill.sync{background:#e67e22}' +
        '#ofl-pill.ok{background:#2e7d32}' +
        '#ofl-pill .c{background:rgba(255,255,255,.25);border-radius:999px;padding:1px 8px;font-weight:800}' +
        '#ofl-toasts{position:fixed;z-index:2147483000;bottom:64px;inset-inline-start:16px;' +
        'display:flex;flex-direction:column;gap:8px;direction:rtl}' +
        '#ofl-toasts .t{padding:10px 14px;border-radius:12px;color:#fff;font:600 13px "Segoe UI",Tahoma,sans-serif;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.3);background:#333;opacity:0;transform:translateY(8px);' +
        'transition:opacity .25s,transform .25s}' +
        '#ofl-toasts .t.show{opacity:1;transform:none}' +
        '#ofl-toasts .t.ok{background:#2e7d32}#ofl-toasts .t.warn{background:#e67e22}#ofl-toasts .t.err{background:#c0392b}' +
        '#ofl-refresh{display:none;border:0;cursor:pointer;padding:11px 16px;border-radius:12px;' +
        'font:800 14px "Segoe UI",Tahoma,sans-serif;color:#fff;background:#1b6fd6;direction:rtl;' +
        'box-shadow:0 8px 24px rgba(27,111,214,.4)}#ofl-refresh:active{transform:scale(.97)}';
      document.head.appendChild(style);

      pill = document.createElement('div');
      pill.id = 'ofl-pill';
      dot = document.createElement('span'); dot.className = 'd';
      label = document.createElement('span');
      countEl = document.createElement('span'); countEl.className = 'c'; countEl.style.display = 'none';
      pill.appendChild(dot); pill.appendChild(label); pill.appendChild(countEl);
      document.body.appendChild(pill);

      toastWrap = document.createElement('div');
      toastWrap.id = 'ofl-toasts';
      document.body.appendChild(toastWrap);

      refresh();
    }

    function setSyncing(v) { syncing = v; refresh(); }

    function refresh() {
      if (!pill) { ensure(); if (!pill) return; }
      pendingCount().then(function (n) {
        if (n > 0) { countEl.style.display = ''; countEl.textContent = n; }
        else { countEl.style.display = 'none'; }

        pill.className = '';
        if (!isOnline()) {
          pill.classList.add('off');
          label.textContent = n > 0 ? 'دون اتصال — بانتظار المزامنة' : 'يعمل دون اتصال';
        } else if (syncing) {
          pill.classList.add('sync');
          label.textContent = 'جارٍ المزامنة…';
        } else if (n > 0) {
          pill.classList.add('sync');
          label.textContent = 'بانتظار المزامنة';
        } else {
          pill.classList.add('ok');
          label.textContent = 'متصل';
          // إخفاء لطيف عند الاستقرار.
          setTimeout(function () {
            if (pill && pill.classList.contains('ok')) pill.style.opacity = '0';
          }, 2500);
          return;
        }
        pill.style.opacity = '.96';
      });
    }

    function toast(msg, kind) {
      ensure();
      if (!toastWrap) return;
      var t = document.createElement('div');
      t.className = 't ' + (kind || '');
      t.textContent = msg;
      toastWrap.appendChild(t);
      requestAnimationFrame(function () { t.classList.add('show'); });
      setTimeout(function () {
        t.classList.remove('show');
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
      }, 4000);
    }

    // زر «تحديث البيانات» غير مزعج: يظهر حين توجد بيانات أحدث وتعذّر التحديث التلقائي الآمن.
    var refreshBtn;
    function showRefresh() {
      ensure();
      if (refreshBtn) { refreshBtn.style.display = ''; return; }
      refreshBtn = document.createElement('button');
      refreshBtn.id = 'ofl-refresh';
      refreshBtn.type = 'button';
      refreshBtn.textContent = '🔄 تحديث البيانات';
      refreshBtn.onclick = function () { try { window.location.reload(); } catch (e) {} };
      if (toastWrap) toastWrap.appendChild(refreshBtn); else document.body.appendChild(refreshBtn);
    }

    return { ensure: ensure, refresh: refresh, setSyncing: setSyncing, toast: toast, showRefresh: showRefresh };
  })();

  // ── الواجهة العامّة المستهلَكة من gas-bridge.js ───────────────
  window.OfflineSync = {
    classify: classify,
    appName: appName,
    isOnline: isOnline,
    cacheRead: cacheRead,
    getCachedRead: getCachedRead,
    enqueue: enqueue,
    flush: flush,
    persistSession: persistSession,
    getPersistedSession: getPersistedSession,
    purgeLegacySessions: purgeLegacySessions,
    purgeLoginCache: purgeLoginCache,   // (29a2) يستدعيه الخروج أيضاً
    purgeSessionCache: purgeSessionCache,   // (29a2) الخروج: + فحصُ الجلسة التي تنتهي ('checkSession' …)
    pendingCount: pendingCount,
    failed: failedList,        // (28k) الكتاباتُ التي رفضها الخادم: آخرُ ٥٠، بلا أسرار
    clearFailed: clearFailed,
    trackRead: trackRead,
    revalidate: revalidate,
    syncNow: syncNow,
    refreshUI: function () { UI.refresh(); },
    toast: function (m, k) { UI.toast(m, k); }
  };

  // ── المشغّلات ────────────────────────────────────────────────
  function init() {
    purgeLegacySessions();
    purgeLoginCache();
    migrateLegacyFailed();
    UI.ensure();
    if (isOnline()) flush();

    window.addEventListener('online', function () {
      UI.refresh();
      UI.toast('🔄 عاد الاتصال — جارٍ المزامنة وتحديث البيانات', 'ok');
      syncNow();
    });
    window.addEventListener('offline', function () {
      UI.refresh();
      UI.toast('📴 انقطع الاتصال — يعمل التطبيق محلياً', 'warn');
    });

    // مزامنة دورية احتياطية (كل 30 ثانية) عند وجود عمليات معلّقة.
    setInterval(function () {
      if (isOnline()) {
        pendingCount().then(function (n) { if (n > 0) flush(); });
      }
    }, 30000);

    // تحديث تلقائي مؤجَّل: حين يصبح آمناً (عودة التركيز/الظهور أو نقرة) نُكمل التحديث.
    window.addEventListener('focus', tryRefresh);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function () { if (!document.hidden) tryRefresh(); });
      document.addEventListener('click', function () { setTimeout(tryRefresh, 50); }, true);
    }

    // رسالة من Service Worker (Background Sync).
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', function (ev) {
        if (ev.data && ev.data.type === 'creativity-sync') syncNow();
      });
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
