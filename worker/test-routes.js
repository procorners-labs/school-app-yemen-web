/**
 * School App Yemen Web — worker/test-routes.js
 * 🛟 الحارسُ الحقيقي للوركر (CLAUDE.md §CI)
 *
 * استخرجُ المنطقِ من worker/school-app-proxy.js ويختبرُه بـvm.
 * كلُّ فحصٍ يملكُ ضابطَه المعاكس — غيابُهما = نجاحٌ مشروطٌ.
 *
 * التشغيلُ: node worker/test-routes.js
 * قبلَ أيّ PR: node --check worker/school-app-proxy.js && node worker/test-routes.js
 */

[... ملايينُ الأسطرِ السابقة ...]

// ============================================================================
// 38b: فحوصُ المعرّفِ الموحَّد — slug + UUID + canonicalization
// ============================================================================

(function () {
  console.log('\n📋 38b — canonicalization schoolId (UUID/slug → UUID في الكاش)');
  var failed = 0;

  // ─────────────────────────────────────────────────────────────────────────
  // ① فحصُ _apiCanonTenant — تحويلُ slug إلى UUID عبر pairs
  // ─────────────────────────────────────────────────────────────────────────

  var ctx_canonTenant = vm.createContext({
    _API_UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  });
  vm.runInContext(src, ctx_canonTenant); // استخرجْ _apiCanonTenant من المصدر

  function check_canon(ok, label) {
    if (!ok) failed++;
    console.log((ok ? '  ✅ ' : '  ❌ ') + label);
  }

  // الحالة ① — UUID يعودُ كما هو (موجب)
  var uuid_in = 'a1b2c3d4-e5f6-4789-9abc-def012345678';
  ctx_canonTenant.__v = uuid_in;
  ctx_canonTenant.__p = null;
  var result_uuid_nochange = vm.runInContext(
    '_apiCanonTenant(__v, __p)',
    ctx_canonTenant
  );
  check_canon(
    result_uuid_nochange === uuid_in,
    'UUID دون تغيير عند pairs=null (موجب)'
  );

  // الحالة ② — slug محلولٌ إلى UUID عبر pairs (موجب)
  var slug = 'test-school';
  var slug_uuid = 'f1e2d3c4-b5a6-4789-0abc-def123456789';
  ctx_canonTenant.__v = slug;
  ctx_canonTenant.__p = { 'test-school': slug_uuid }; // pairs
  var result_slug_resolved = vm.runInContext(
    '_apiCanonTenant(__v, __p)',
    ctx_canonTenant
  );
  check_canon(
    result_slug_resolved.toLowerCase() === slug_uuid.toLowerCase(),
    'slug محلولٌ إلى UUID عبر pairs (موجب)'
  );

  // الحالة ③ — slug غيرُ موجودٍ في pairs ⇒ يعودُ كما هو (سالب)
  ctx_canonTenant.__v = 'unknown-school';
  ctx_canonTenant.__p = { 'test-school': slug_uuid };
  var result_slug_unknown = vm.runInContext(
    '_apiCanonTenant(__v, __p)',
    ctx_canonTenant
  );
  check_canon(
    result_slug_unknown === 'unknown-school',
    'slug غيرُ محلول → عودةٌ بلا تغيير (سالب)'
  );

  // الحالة ④ — قيمةٌ غير نصية ⇒ عودةٌ كما هي
  ctx_canonTenant.__v = null;
  ctx_canonTenant.__p = null;
  var result_null = vm.runInContext(
    '_apiCanonTenant(__v, __p)',
    ctx_canonTenant
  );
  check_canon(result_null === null, 'قيمةٌ null تعودُ null (سالب)');

  // ─────────────────────────────────────────────────────────────────────────
  // ② فحصُ _apiCacheProbe — رصدُ canon flag و إعادةُ بناءِ المفتاح
  // ─────────────────────────────────────────────────────────────────────────

  var ctx_probe = vm.createContext({
    API_CACHE_BODY_MAX: 131072,
    API_CACHE_ARGSKEY_MAX: 2048,
    API_CACHE_FNS: {
      getHomePageBundle: { tenantless: false, argTenant: true },
      listPartnerSchoolsPublic: { tenantless: true, argTenant: false }
    },
    _API_UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    console: { log: function () {} }
  });
  vm.runInContext(src, ctx_probe);

  // الحالة ① — slug منشورٌ بدونِ pairs ⇒ canon:true يُرجَع (موجب)
  var body_with_slug = JSON.stringify({
    fn: 'getHomePageBundle',
    args: ['my-school-slug']
  });
  ctx_probe.__b = body_with_slug;
  ctx_probe.__p = null;
  var probe_slug_nomap = vm.runInContext(
    '_apiCacheProbe(__b, __p)',
    ctx_probe
  );
  check_canon(
    probe_slug_nomap && probe_slug_nomap.canon === true,
    'slug بلا pairs → canon:true يُرجَع (موجب)'
  );

  // الحالة ② — slug محلولٌ عبر pairs ⇒ mapsKey بالـUUID، canon غائب (موجب)
  var pairs_map = { 'my-school-slug': 'a1b2c3d4-e5f6-4789-9abc-def012345678' };
  ctx_probe.__b = body_with_slug;
  ctx_probe.__p = pairs_map;
  var probe_slug_mapped = vm.runInContext(
    '_apiCacheProbe(__b, __p)',
    ctx_probe
  );
  check_canon(
    probe_slug_mapped && probe_slug_mapped.argsKey && !probe_slug_mapped.canon,
    'slug محلولٌ عبر pairs → mapsKey بـUUID، بلا canon (موجب)'
  );
  // تفصيلٌ إضافي: argsKey يجب أن يحتويَ UUID لا الـslug
  var decoded_key_slug = decodeURIComponent(probe_slug_mapped.argsKey || '');
  check_canon(
    decoded_key_slug.indexOf('a1b2c3d4-e5f6-4789-9abc-def012345678') >= 0,
    'mapsKey يحتوي الـUUID القانونيّ (موجب)'
  );

  // الحالة ③ — UUID مباشرةً ⇒ لا canon (موجب)
  var body_with_uuid = JSON.stringify({
    fn: 'getHomePageBundle',
    args: ['a1b2c3d4-e5f6-4789-9abc-def012345678']
  });
  ctx_probe.__b = body_with_uuid;
  ctx_probe.__p = null;
  var probe_uuid_direct = vm.runInContext(
    '_apiCacheProbe(__b, __p)',
    ctx_probe
  );
  check_canon(
    probe_uuid_direct && !probe_uuid_direct.canon,
    'UUID مباشرةً → بلا canon flag (موجب)'
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ③ فحصُ _schoolIdScript — حقنُ window.__CANON_SCHOOL__
  // ─────────────────────────────────────────────────────────────────────────

  var ctx_script = vm.createContext({
    _SCHOOL_UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    console: { log: function () {} }
  });
  vm.runInContext(src, ctx_script);

  // الحالة ① — UUID صحيح ⇒ يُحقَن __CANON_SCHOOL__ (موجب)
  var canon_uuid = 'F1E2D3C4-B5A6-4789-0ABC-DEF123456789'; // مختلطُ الحالة
  ctx_script.__k = canon_uuid;
  var script_output = vm.runInContext(
    '_schoolIdScript(__k)',
    ctx_script
  );
  check_canon(
    script_output.indexOf('window.__CANON_SCHOOL__') >= 0,
    'UUID → حقنُ __CANON_SCHOOL__ (موجب)'
  );
  check_canon(
    script_output.indexOf('window.SCHOOL_ID') >= 0,
    'UUID → حقنُ SCHOOL_ID أيضاً (موجب)'
  );
  // التحقّقُ من القيمة مكتوبةً بأحرفٍ صغيرة (مُطابقةٌ)
  var lowercase_uuid = canon_uuid.toLowerCase();
  check_canon(
    script_output.indexOf('"' + lowercase_uuid + '"') >= 0 &&
    script_output.indexOf('"' + lowercase_uuid + '"') >= 0, // الاثنا معاً
    'القيمةُ مكتوبةٌ بأحرفٍ صغيرة في __CANON_SCHOOL__ و SCHOOL_ID (موجب)'
  );

  // الحالة ② — slug أو قيمةٌ غيرُ UUID ⇒ لا حقن (سالب)
  ctx_script.__k = 'my-school-slug';
  var script_no_output = vm.runInContext(
    '_schoolIdScript(__k)',
    ctx_script
  );
  check_canon(
    script_no_output === '',
    'slug غيرُ صحيح → سلسلةٌ فارغة (سالب)'
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ④ الاختبارُ المتكاملُ — العمليّةُ كاملةً (slug ⇒ canon ⇒ mapsKey)
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n  🧪 متكاملٌ: slug → canonicalization → مفاتيحُ الكاش');

  var full_pairs = {
    'school-a': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'school-b': 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
  };

  var full_body = JSON.stringify({
    fn: 'getHomePageBundle',
    args: ['school-a'],
    sid: ''
  });

  ctx_probe.__b = full_body;
  ctx_probe.__p = full_pairs;
  var full_probe = vm.runInContext(
    '_apiCacheProbe(__b, __p)',
    ctx_probe
  );

  check_canon(
    full_probe && full_probe.fn === 'getHomePageBundle',
    'وظيفةُ المسبار تُحفظ (موجب)'
  );
  check_canon(
    full_probe && full_probe.argsKey,
    'مفتاحٌ يُولَّد (موجب)'
  );
  check_canon(
    full_probe &&
    !full_probe.canon &&
    decodeURIComponent(full_probe.argsKey).indexOf(full_pairs['school-a']) >= 0,
    'مفتاحُ الكاش يحتويَ الـUUID القانونيَّ (موجب)'
  );

  console.log(
    '\n✨ 38b — ' +
    (failed === 0
      ? '🟢 جميعُ الفحوصِ نجحت'
      : '🔴 ' + failed + ' فحصٍ فشل')
  );

  if (failed > 0) {
    process.exit(1);
  }
})();

// ============================================================================
// [... بقيّةُ الملفّ كما هي ...]
// ============================================================================
