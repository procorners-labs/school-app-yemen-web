/*!
 * gas-bridge.js — Drop-in replacement for google.script.run (ES5)
 * متوافق مع Cloudflare Workers / CORS proxies
 * يستخدم XMLHttpRequest لتجنب تداخل إضافات المتصفح
 */
(function () {
  'use strict';

  var WITH_HANDLERS = {
    withSuccessHandler: true,
    withFailureHandler: true,
    withUserObject: true
  };

  // علامة على أخطاء الشبكة (تعذّر الوصول للخادم) لتمييزها عن أخطاء الخادم المنطقية.
  function netError(msg) { var e = new Error(msg); e.__network = true; return e; }

  // 🔴 «الخدمة مشبعة» صنف ثالث بين الشبكة والمنطق — وعلاجه **معاكس** لعلاج خطأ الشبكة.
  // الوسيط (school-app-proxy.js) يُرجِع 503 في حالتين، كلتاهما تعني «حصّة Google الثلاثينية
  // مستنفدة»: رفضُ منظّم التزاحم، واستنفادُ محاولتَي الوسيط. وقبل هذا التمييز كان الجسر يعدّهما
  // «شبكة عابرة» فيعيد المحاولة بعد 900ms **ضدّ حصّة مستنفدة أصلاً** ⇒ محاولتان هنا × محاولتان
  // في الوسيط = **أربعة نداءات GAS خلف نداء منطقي واحد، بالضبط لحظة الإشباع**: تغذية راجعة موجبة
  // تُطيل الإشباع الذي وقعت بسببه (قياس 2026-08-11: إخفاق teacher 18.35٪ وp99 مثبَّت عند 23,701ms
  // = 11500+700+11500 أي سقف ميزانية الوسيط حرفياً ⇒ الفشل والبطء ظاهرة واحدة).
  // ⚠️ **والحسبة أعلاه تاريخيّة لا سارية** (صُحِّح 2026-08-30): `PER_ATTEMPT_TIMEOUT_MS = 11500`
  //    **حُذفت** من الوسيط في `web#150` (‏`web@486948d`) واستُبدلت بـ`_gasAttemptPlan` التي
  //    تشتقّ مهلةَ المحاولة من **الميزانية المتبقّية** (`24000 - _bhWaited - 300`)، مع
  //    `_gasShouldRetry` التي **لا تُعيد على المهلة إطلاقاً**. ⇒ الرقم 23,700 يبقى صحيحاً
  //    كسقفٍ كلّيّ، ولا يبقى صحيحاً كحاصلِ ضربِ محاولتين. التمييز أدناه لا يتغيّر.
  // ⚠️ يبقى `__network = true` عمداً: التراجع للكاش وطابور الكتابة في `callServer` أدناه مشروطان
  //    به، وإسقاطه كان سيُحوِّل ازدحاماً عابراً إلى شاشة خطأ صلبة بلا أي بيانات محفوظة.
  function satError(msg) { var e = netError(msg); e.__saturated = true; return e; }

  // ── تفسير الخطأ لسطح المستخدم — مصدر حقيقة واحد لكل الصفحات ──────────────
  // ثلاثة أسباب **علاجها متعاكس**، ودمجها في نصّ واحد يدفع المستخدم والمالك إلى العلاج الخطأ
  // (نفس درس بند 119). قبل هذه الدالّة كان السطح العام يكتب `withFailureHandler(function(){…})`
  // **بلا وسيط أصلاً** ⇒ التمييز الذي يبنيه الجسر بعناية يُهدَر كلّه عند نقطة الاستهلاك.
  //   busy    ⇒ الحصّة مشبعة الآن؛ الانتظار لحظات يُصلحها، وإعادة المحاولة الفورية تُسيئها
  //   offline ⇒ الوصول مقطوع فعلاً؛ العلاج عند المستخدم (شبكته)
  //   server  ⇒ خطأ منطقي؛ نصّ الخادم هو الرسالة ولا يُبتلَع خلف نصّ عام
  // ⚠️ الصفحات المخدومة من GAS مباشرةً (`doGet`) **لا تحمّل هذا الملف إطلاقاً** — الحقن يخصّ
  //    `frontend/` وحده. فـ`window.gasErrorInfo` غير معرَّفة هناك، ولهذا يستدعيها كل مستهلك
  //    بحارس وجود ويسقط على نصّ يحمل **هوية المسار** («عبر خادم Google مباشرةً»): بلاغٌ واحد
  //    من مستخدم يكفي عندئذٍ لمعرفة أي نصف من السطح المزدوج هبط عليه.
  function gasErrorInfo(err) {
    if (err && err.__saturated) {
      return { kind: 'busy', retryable: true,
               text: 'الخدمة مزدحمة الآن — أعد المحاولة بعد لحظات.' };
    }
    if (err && err.__network) {
      return { kind: 'offline', retryable: true,
               text: 'تعذّر الاتصال — تحقّق من الشبكة وأعد المحاولة.' };
    }
    return { kind: 'server', retryable: false,
             text: (err && err.message) || 'تعذّر تنفيذ الطلب — أعد المحاولة.' };
  }
  window.gasErrorInfo = gasErrorInfo;

  /* 📡 تبليغُ إخفاقات النقل التي **لا تصل الحافّة أصلاً** (2026-09-18، قرار مالك).
     الوسيطُ يسجّل كلَّ نداءٍ يصله (`ev=gas`)، فالـ5xx مسجَّلٌ هناك سلفاً ولا يُكرَّر.
     الغائبُ عن كلّ قناة: انقطاعُ الشبكة ومهلةُ العميل (`status 0`) — تُرسَل إلى
     `POST /client-err` في الوسيط (‏web#314) **بصفر نداءٍ لـGAS**: التبليغُ عبر GAS كان
     سيضيف حِملاً على المورد المشبع لحظةَ إشباعه، فيُغذّي العَرَضَ الذي يبلّغ عنه.
     العقد: مفاتيحُ مغلقة · `page` مسارٌ بلا استعلام (التوكنات تسافر فيه) · `schoolId`
     UUID أو فارغ. وسقفٌ ٥ لكلّ صفحة. وأيُّ فشلٍ هنا يُبتلَع — المبلِّغُ لا يُسقط ما يبلّغ عنه. */
  var _ceSent = 0;
  var _CE_APPS = { home: 1, teacher: 1, student: 1, cms: 1, 'master-admin': 1 };
  function _reportTransport(kind, fnName, status, ms) {
    try {
      if (_ceSent >= 5) return;
      /* التطبيقُ من **وجهة النداء الفاشل** (`GAS_ENDPOINT` = `/gas/<app>`) لا من مسار الصفحة:
         `/portal` و`/<slug>` سطحان حيّان مقطعُهما الأوّل ليس اسمَ تطبيق فكانا يُسقَطان صامتَين
         (رصدته جلسةُ الوركر على #1618). والمسارُ تراجعٌ فقط. */
      var em = /\/gas\/([a-z-]+)/i.exec(String(window.GAS_ENDPOINT || ''));
      var seg = em ? em[1].toLowerCase() : (String(location.pathname || '').split('/')[1] || '').toLowerCase();
      if (seg === 'portal') seg = 'student';
      if (!_CE_APPS[seg]) seg = 'home';
      var sid = String(window.SCHOOL_ID || '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) sid = '';
      var page = String(location.pathname || '/');
      if (!/^\/[A-Za-z0-9\/._-]{0,160}$/.test(page)) page = '/' + seg + '/';
      var body = { app: seg, kind: kind, status: status, ms: Math.min(Math.max(Math.round(ms) || 0, 0), 600000),  /* تبويبٌ معلَّق قد يتجاوز السقف ⇒ 400 */ schoolId: sid, page: page };
      if (/^[A-Za-z0-9_]{1,64}$/.test(String(fnName || ''))) body.fn = String(fnName);
      var json = JSON.stringify(body);
      _ceSent++;
      if (navigator.sendBeacon && window.Blob) {
        navigator.sendBeacon('/client-err', new Blob([json], { type: 'application/json' }));
      } else {
        var x = new XMLHttpRequest();
        x.open('POST', '/client-err', true);
        x.setRequestHeader('Content-Type', 'application/json');
        x.send(json);
      }
    } catch (eCe) {}
  }

  // النقل الخام: نفس سلوك google.script.run الأصلي عبر XHR.
  // أخطاء الشبكة (status 0/مهلة/onerror/رد غير صالح/خطأ بوابة) تُعلَّم __network=true.
  function rawCall(fnName, args, onSuccess, onFailure, userObject, opId) {
    var _t0 = Date.now();
    var endpoint = window.GAS_ENDPOINT;
    if (!endpoint) {
      if (onFailure) onFailure(new Error('GAS_ENDPOINT غير مُعرّف'), userObject);
      return;
    }

    /* 🔑 `opId` **مفتاحٌ أخيرٌ ويُضاف للكتابات وحدها** (يمرّره `callServer`/الطابور):
       أيُّ مفتاحٍ رابعٍ يُسقط النداءَ من كاش الحافّة في الوركر (`_apiCacheProbe`)،
       و`fn` أوّلاً لأن إسنادَ سجلّ الوركر يقرأ أوّلَ ٢٠٠ محرف. والعقدُ الخادميّ في
       `teacher/ApiEndpoint.js` (منعُ التنفيذ المزدوج). */
    var body = { fn: fnName, args: args, schoolId: window.SCHOOL_ID || null };
    if (opId) body.opId = opId;
    var payload = JSON.stringify(body);

    // استخدام XMLHttpRequest بدلاً من fetch لضمان التوافق وتجنب تداخل الإضافات
    var xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint, true);
    xhr.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    // مهلة أطول لدوال رفع الملفات (قد يصل الفيديو إلى 25MB)؛ والبقية 60 ثانية (كانت 30 — رُفعت
    // بعد قياس حيّ مباشر أثبت أن GAS/Sheets API لنفس مشروع GCP المشترك قد يستغرق فعلياً 20-30+
    // ثانية تحت ضغط تزامن حقيقي [استجابة ناجحة لا فاشلة]، فكانت المهلة القديمة (30 ثانية بالضبط)
    // تُسقِط نداءات كانت لتنجح لو أُمهلت قليلاً أكثر — راجع _docs/…-heartbeat-boot-burst).
    var _isUpload = /upload|media|attach/i.test(fnName);
    xhr.timeout = _isUpload ? 180000 : 60000;

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;

      if (xhr.status === 0) {
        var _el = Date.now() - _t0;
        _reportTransport(_el >= (xhr.timeout || 60000) - 1000 ? 'timeout' : 'network', fnName, 0, _el);
      }
      if (xhr.status === 0 || xhr.status >= 400) {
        // الخادم غير قابل للوصول (شبكة/بوابة): خطأ شبكة.
        // ⚠️ 503/429 استثناءان: إشباعٌ **مُعلَن من الوسيط** لا انقطاعُ وصول. إعادة المحاولة
        //    عليهما تُضاعف الحمل على المورد المستنفد نفسه (راجع `satError` أعلاه).
        //
        // 🔴 **و502 و504 انضمّا إليهما 2026-08-24 — بقياسٍ حيّ لا بتقدير.**
        // كانا يُصنَّفان «شبكة» فيُعادان مرّة، والوسيطُ يُعيد مستقلّاً منذ 2026-07-28 ⇒
        // **‏2 (عميل) × 2 (وسيط) = أربعة تنفيذات GAS خلف نداءٍ منطقيّ واحد** — بالضبط
        // لحظةَ الإشباع، فتغذيةٌ راجعة موجبة تُطيل ما وقعت بسببه.
        //
        // والتصنيفُ الجديد صحيحٌ دلالياً لا تخفيفاً: 502/504 من هذا الوسيط تعنيان أنه
        // **أجهض عند سقف ميزانيته** (‏24,000ms ناقص انتظار المنظّم؛ وكان يُحسَب
        // 11,500×2+700 = 23,700ms قبل `web#150` — التفصيل في التعليق أعلى `satError`)
        // — و**GAS يواصل التنفيذ
        // خادمياً** (بند 172). ⇒ إعادةُ المحاولة (أ) تُضاعف الحمل، و(ب) قد تُنتج **عملاً
        // مكرّراً** على الخادم لأن الأوّل لم يُلغَ. وقياسُ 2026-08-24 أثبت الشقّ الثاني
        // حيّاً: ورقةٌ حُذفت فعلاً بينما عُرض ❌ للمستخدم.
        //
        // 🔴 **وما لا يتغيّر — الضابط المعاكس:** `status === 0` (انقطاعٌ حقيقيّ · DNS ·
        //    مهلة) يبقى `netError` **فيُعاد**، وإلّا انقلب الإصلاحُ إلى إسقاطِ التعافي من
        //    الأعطال العابرة التي وُجدت إعادةُ المحاولة لأجلها أصلاً.
        var _sat = (xhr.status === 503 || xhr.status === 429 ||
                    xhr.status === 502 || xhr.status === 504);
        if (onFailure) {
          onFailure(
            _sat
              ? satError('الخدمة مزدحمة حالياً (status ' + xhr.status + ')')
              : netError('فشل الاتصال (status ' + xhr.status + ')'),
            userObject
          );
        }
        return;
      }

      var text = xhr.responseText;
      var data = null;
      try { data = JSON.parse(text); } catch (e) {
        // رد غير JSON (بوابة أسر/صفحة خطأ) — نعدّه خطأ شبكة ليعمل التراجع للكاش.
        if (onFailure) onFailure(netError('رد غير صالح'), userObject);
        return;
      }

      if (data && data.ok) {
        if (onSuccess) onSuccess(data.result, userObject);
      } else if (data && data.pending) {
        /* 🔑 التنفيذُ الأوّل لنفس `opId` ما زال جارياً عند Google — **ليس خطأً منطقياً**:
           يُعلَّم شبكةً كي يبقى في الطابور ويُعاد لاحقاً فيلقى النتيجةَ المخزَّنة. */
        var pe = netError('قيد التنفيذ — سيُستكمَل تلقائياً');
        pe.__pending = true;
        if (onFailure) onFailure(pe, userObject);
      } else {
        // الخادم رد بنجاح اتصال لكن بخطأ منطقي — ليس خطأ شبكة.
        if (onFailure) onFailure(new Error((data && data.error) || 'خطأ في الخادم'), userObject);
      }
    };

    xhr.ontimeout = function () {
      if (onFailure) onFailure(netError('انتهت مهلة الاتصال'), userObject);
    };

    xhr.onerror = function () {
      if (onFailure) onFailure(netError('فشل الاتصال بالشبكة'), userObject);
    };

    xhr.send(payload);
  }

  // يكشف النقل الخام لمحرّك المزامنة (offline-sync.js) لإعادة تشغيل عمليات الطابور.
  window.__gasRawCall = rawCall;

  // إعادة محاولة للنقل عند أخطاء الشبكة العابرة (status 0/≥400/مهلة/رد غير صالح).
  // ⚠️ للقراءات فقط (idempotent) — لا تُستخدم للكتابات تفاديًا للتنفيذ المزدوج.
  // تكمّل إعادة محاولة الوسيط وطابور offline-sync؛ تقلّل ظهور «تعذر الاتصال» العابر.
  function rawCallWithRetry(fnName, args, onSuccess, onFailure, userObject, retries) {
    // محاولة إضافية واحدة (محاولتان إجمالًا) — لا 2: وسيط الـWorker (school-app-proxy.js) يعيد
    // المحاولة بنفسه أيضاً (**محاولتان** منذ 2026-07-28، كانت أربعاً)؛ إبقاء محاولتين هنا فوق ذلك
    // كان يُضاعف عدد نداءات GAS الفعلية خلف الوسيط تحت الضغط بلا فائدة تُذكر في الحالة الشائعة
    // (استجابة بطيئة لكن ناجحة تُحسَب محاولة واحدة فقط، لا تُفعِّل إعادة المحاولة أصلاً) — خصوصًا
    // عند انفجار نداءات متزامنة عند إقلاع teacher/student معًا (heartbeat + إشعارات + قوائم).
    var left = (typeof retries === 'number') ? retries : 1; // محاولة إضافية واحدة (محاولتان إجمالًا)
    var delays = [900]; // backoff قصير (ms)
    function attempt(n) {
      rawCall(fnName, args, onSuccess, function (err, uo) {
        // `!err.__saturated` هو الشرط الحاكم: 503/429 تعني أن المورد مستنفد **الآن**، فإعادة
        // المحاولة بعد 900ms تضربه ثانيةً وهو لم يتعافَ. تُمرَّر للأعلى فوراً ليقع التراجع للكاش.
        if (err && err.__network && !err.__saturated && n < left) {
          setTimeout(function () { attempt(n + 1); }, delays[n] || 1500);
        } else if (onFailure) {
          onFailure(err, uo);
        }
      }, userObject);
    }
    attempt(0);
  }

  var WRITE_RECOVER_DELAY_MS = 3000;
  /* معرّفُ عمليّةٍ يطابق `API_OP_ID_RE` في الخادم (`[A-Za-z0-9_-]{8,64}`). */
  function newOpId() {
    return 'op' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10) +
           Math.random().toString(36).slice(2, 6);
  }

  function optimisticWrite() {
    return { success: true, queued: true, offline: true,
             message: '✅ حُفظ محلياً — سيُزامن تلقائياً عند عودة الاتصال' };
  }

  // طبقة العمل دون اتصال فوق النقل الخام (تستشير window.OfflineSync).
  function callServer(fnName, args, onSuccess, onFailure, userObject) {
    var OS = window.OfflineSync;
    if (!OS) { rawCall(fnName, args, onSuccess, onFailure, userObject); return; }

    var app = OS.appName();
    var schoolId = window.SCHOOL_ID || null;
    var kind = OS.classify(fnName);

    if (kind === 'read') {
      // نتتبّع القراءة لإعادة التحقّق منها وتحديثها تلقائياً عند عودة الاتصال.
      if (OS.trackRead) OS.trackRead(app, fnName, args, schoolId);
      if (OS.isOnline()) {
        rawCallWithRetry(fnName, args, function (result, uo) {
          OS.cacheRead(app, fnName, args, schoolId, result);
          if (onSuccess) onSuccess(result, uo);
        }, function (err, uo) {
          if (err && err.__network) {
            // تعذّر الوصول (بعد إعادة المحاولة): اخدم آخر نتيجة مخزّنة إن وُجدت.
            OS.getCachedRead(app, fnName, args, schoolId).then(function (rec) {
              if (rec && typeof rec.result !== 'undefined') {
                if (onSuccess) onSuccess(rec.result, uo);
              } else if (onFailure) { onFailure(err, uo); }
            });
          } else if (onFailure) { onFailure(err, uo); }
        }, userObject);
      } else {
        OS.getCachedRead(app, fnName, args, schoolId).then(function (rec) {
          if (rec && typeof rec.result !== 'undefined') {
            if (onSuccess) onSuccess(rec.result, userObject);
          } else if (onFailure) {
            onFailure(netError('لا توجد بيانات محفوظة لعرضها دون اتصال'), userObject);
          }
        });
      }
      return;
    }

    if (kind === 'write') {
      /* 🔑 مفتاحُ عمليّةٍ واحدٌ يرافق الكتابةَ في كلّ إرسالاتها — الأوّل والاسترجاع والطابور.
         🔴 **العطلُ الذي يقفله (2026-09-23):** الكتابةُ التي تتلقّى 502 كانت تُطابَر ثمّ تُعاد،
         والتنفيذُ الأوّل **يكتمل عند Google** (مُثبَت) ⇒ تنفيذٌ مزدوج، ورسالةُ «حُفظ محلياً»
         تكذب في الاتّجاه الآخر. الخادمُ يُرجِع المخزَّن للمعرّف نفسه بلا تنفيذٍ ثانٍ. */
      var opId = newOpId();
      var toQueue = function (uo) {   // تعبيرٌ لا تصريح: تصريحُ دالّةٍ داخل كتلةٍ ممنوعٌ في ES5 الصارم
        OS.enqueue(app, fnName, args, schoolId, opId).then(function () {
          if (onSuccess) onSuccess(optimisticWrite(), uo);
        });
      };
      if (OS.isOnline()) {
        rawCall(fnName, args, function (result, uo) {
          OS.refreshUI();
          if (onSuccess) onSuccess(result, uo);
        }, function (err, uo) {
          if (err && err.__saturated) {
            /* 502/504: الأرجحُ أن العملَ تمّ وضاع جوابُه ⇒ **استرجاعٌ واحد** بنفس المعرّف بعد
               ٣ث: يُرجِع النتيجةَ الحقيقيّة (`_dedup`) بدل «حُفظ محلياً» الكاذب. وما لم يُسترَدّ
               يذهب إلى الطابور — وصار آمناً. ولا إعادةَ ثانية: الإشباعُ لا يُضرَب مرّتين. */
            setTimeout(function () {
              rawCall(fnName, args, function (result2, uo2) {
                OS.refreshUI();
                if (onSuccess) onSuccess(result2, uo2);
              }, function (err2, uo2) {
                if (err2 && err2.__network) toQueue(uo2);
                else if (onFailure) onFailure(err2, uo2);
              }, uo, opId);
            }, WRITE_RECOVER_DELAY_MS);
          } else if (err && err.__network) {
            toQueue(uo);   // انقطاعٌ أو «قيد التنفيذ»: الطابورُ يُعيد بالمعرّف نفسه
          } else if (onFailure) { onFailure(err, uo); } // خطأ خادم منطقي: أظهره
        }, userObject, opId);
      } else {
        toQueue(userObject);
      }
      return;
    }

    // online-only (مصادقة/رفع/خارج النطاق): سلوك أصلي + حفظ الجلسة عند النجاح.
    rawCall(fnName, args, function (result, uo) {
      OS.persistSession(fnName, result);
      if (onSuccess) onSuccess(result, uo);
    }, onFailure, userObject);
  }

  function makeRunner() {
    var state = { success: null, failure: null, userObject: undefined };
    var base = {
      withSuccessHandler: function (fn) { state.success = fn; return runner; },
      withFailureHandler: function (fn) { state.failure = fn; return runner; },
      withUserObject: function (obj) { state.userObject = obj; return runner; }
    };
    var runner = new Proxy(base, {
      get: function (target, prop) {
        if (typeof prop !== 'string') return target[prop];
        if (WITH_HANDLERS[prop]) return target[prop];
        return function () {
          var args = Array.prototype.slice.call(arguments);
          callServer(prop, args, state.success, state.failure, state.userObject);
        };
      }
    });
    return runner;
  }

  var google = window.google = window.google || {};
  google.script = google.script || {};
  Object.defineProperty(google.script, 'run', {
    configurable: true,
    get: function () { return makeRunner(); }
  });
  google.script.host = google.script.host || {
    close: function () {}, setHeight: function () {}, setWidth: function () {}, origin: '', editor: { focus: function () {} }
  };
  google.script.url = google.script.url || {
    getLocation: function (cb) { if (cb) cb({ parameter: {}, parameters: {}, hash: '' }); }
  };
  google.script.history = google.script.history || {
    push: function () {}, replace: function () {}, setChangeHandler: function () {}
  };
})();
