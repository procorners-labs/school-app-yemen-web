// ⚠️ أمان: لا تكتب التوكنات داخل الكود (الريبو عام). املأ القيم في محرّر Apps Script
//    ثم شغّل setupAllTokens() مرة واحدة. القيم الحقيقية تُحفظ في ScriptProperties فقط.
//    (التوكن القديم كان مكشوفاً وأُزيل — يجب إبطاله/تدويره من Meta فوراً.)
function setupAllTokens() {
  var props = PropertiesService.getScriptProperties();
  props.setProperties({
    'FB_PAGE_ID'      : 'YOUR_FB_PAGE_ID',
    'FB_PAGE_TOKEN'   : 'YOUR_FB_PAGE_TOKEN',
    'IG_BUSINESS_ID'  : 'YOUR_IG_BUSINESS_ID',
    'WA_PHONE_ID'     : 'YOUR_WHATSAPP_PHONE_ID',
    'WA_TOKEN'        : 'YOUR_WHATSAPP_TOKEN',
    'WA_RECIPIENTS'   : '967775189922', // قائمة بأرقام أولياء الأمور (مفصولة بفواصل)
    'YT_CHANNEL_URL'  : 'https://youtube.com/@ebda3tamayz_school'
  });
}

// ملاحظة: لا تُنفَّذ تهيئة/Trigger هنا في المستوى الأعلى (كانت تُعاد في كل تحميل
//         وتُكرّر الـ Trigger). شغّل fullSystemStart() يدوياً مرة واحدة فقط.

function publishToFacebook(content, mediaUrl) {
  var props = PropertiesService.getScriptProperties();
  var pageId = props.getProperty('FB_PAGE_ID');
  var token = props.getProperty('FB_PAGE_TOKEN');

  if (!pageId || !token) {
    return { success: false, error: 'لم يتم إعداد Facebook API' };
  }

  var endpoint = 'https://graph.facebook.com/v18.0/' + pageId + '/feed';

  try {
    var payload = {
      message: content,
      access_token: token
    };

    if (mediaUrl) {
      // إذا كان هناك صورة، نستخدم /photos بدلاً من /feed
      endpoint = 'https://graph.facebook.com/v18.0/' + pageId + '/photos';
      payload.url = mediaUrl;
      payload.caption = content;
      delete payload.message;
    }

    var resp = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true
    });

    var result = JSON.parse(resp.getContentText());
    if (result.id) {
      return { success: true, postId: result.id, message: 'تم النشر على فيسبوك' };
    } else {
      return { success: false, error: JSON.stringify(result) };
    }
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
function publishToInstagram(content, mediaUrl) {
  var props = PropertiesService.getScriptProperties();
  var igBusinessId = props.getProperty('IG_BUSINESS_ID');
  var pageToken = props.getProperty('FB_PAGE_TOKEN');

  if (!igBusinessId || !pageToken) {
    return { success: false, error: 'لم يتم إعداد Instagram API' };
  }

  // Instagram يحتاج لصورة أو فيديو — لا يدعم النص فقط
  if (!mediaUrl) {
    return { success: false, error: 'Instagram يتطلب صورة أو فيديو للنشر' };
  }

  try {
    // الخطوة 1: إنشاء حاوية وسائط (Media Container)
    var createUrl = 'https://graph.facebook.com/v18.0/' + igBusinessId + '/media';
    var containerPayload = {
      image_url: mediaUrl,
      caption: content,
      access_token: pageToken
    };

    var containerResp = UrlFetchApp.fetch(createUrl, {
      method: 'post',
      payload: containerPayload,
      muteHttpExceptions: true
    });
    var containerResult = JSON.parse(containerResp.getContentText());

    if (!containerResult.id) {
      return { success: false, error: 'فشل إنشاء الحاوية: ' + JSON.stringify(containerResult) };
    }

    // الخطوة 2: نشر الحاوية (Publish)
    var publishUrl = 'https://graph.facebook.com/v18.0/' + igBusinessId + '/media_publish';
    var publishPayload = {
      creation_id: containerResult.id,
      access_token: pageToken
    };

    var publishResp = UrlFetchApp.fetch(publishUrl, {
      method: 'post',
      payload: publishPayload,
      muteHttpExceptions: true
    });
    var publishResult = JSON.parse(publishResp.getContentText());

    if (publishResult.id) {
      return { success: true, postId: publishResult.id, message: 'تم النشر على إنستغرام' };
    } else {
      return { success: false, error: 'فشل النشر: ' + JSON.stringify(publishResult) };
    }
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
function fullSystemStart() {
  setupAllTokens();       // يسجل جميع المفاتيح
  smmSetupSystem();       // ينشئ الأوراق والتقويم والبيانات الأولية
  smmInstallTrigger();    // يثبت المشغل التلقائي
  Logger.log('✅ تم تشغيل جميع مكونات النظام بنجاح');
}