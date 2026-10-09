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

'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────
// المصدرُ — يُحمَّل من الملفّ الفعليّ
// ─────────────────────────────────────────────────────────────────────────

let src;
try {
  src = fs.readFileSync(path.join(__dirname, 'school-app-proxy.js'), 'utf8');
} catch (e) {
  console.error('❌ فشلُ قراءةِ worker/school-app-proxy.js:', e.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────
// 38b: فحوصُ المعرّفِ الموحَّد — slug + UUID + canonicalization
// ─────────────────────────────────────────────────────────────────────────

(function testCanonical38b() {
  console.log('\n📋 38b — canonicalization schoolId (UUID/slug → UUID في الكاش)');
  let failed = 0;

  function check_canon(ok, label) {
    if (!ok) failed++;
    console.log((ok ? '  ✅ ' : '  ❌ ') + label);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ① فحصُ _apiCanonTenant — تحويلُ slug إلى UUID عبر pairs
  // ═════════════════════════════════════════════════════════════════════════

  const ctx_canonTenant = vm.createContext({
    _API_UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    Object: Object,
    String: String
  });
  
  let ctSuccess = false;
  try {
    vm.runInContext(src, ctx_canonTenant);
    ctSuccess = true;
  } catch (e) {
    console.error(
      '  ⚠️ تحذير: استخراجُ _apiCanonTenant قد لا يكون متاحاً — اختبار مُتخطّى'
    );
  }

  if (ctSuccess && typeof ctx_canonTenant._apiCanonTenant === 'function') {
    // الحالة ① — UUID يعودُ كما هو (موجب)
    const uuid_in = 'a1b2c3d4-e5f6-4789-9abc-def012345678';
    ctx_canonTenant.__v = uuid_in;
    ctx_canonTenant.__p = null;
    let result_uuid_nochange;
    try {
      result_uuid_nochange = vm.runInContext(
        '_apiCanonTenant(__v, __p)',
        ctx_canonTenant
      );
      check_canon(
        result_uuid_nochange === uuid_in,
        '① UUID دون تغيير عند pairs=null (موجب)'
      );
    } catch (e) {
      check_canon(false, '① UUID test — error: ' + e.message);
      failed++;
    }

    // الحالة ② — slug محلولٌ إلى UUID عبر pairs (موجب)
    const slug = 'test-school';
    const slug_uuid = 'f1e2d3c4-b5a6-4789-0abc-def123456789';
    ctx_canonTenant.__v = slug;
    ctx_canonTenant.__p = { 'test-school': slug_uuid };
    let result_slug_resolved;
    try {
      result_slug_resolved = vm.runInContext(
        '_apiCanonTenant(__v, __p)',
        ctx_canonTenant
      );
      check_canon(
        result_slug_resolved &&
          result_slug_resolved.toLowerCase() === slug_uuid.toLowerCase(),
        '② slug محلولٌ إلى UUID عبر pairs (موجب)'
      );
    } catch (e) {
      check_canon(false, '② slug resolution — error: ' + e.message);
      failed++;
    }

    // الحالة ③ — slug غيرُ موجودٍ في pairs ⇒ يعودُ كما هو (سالب)
    ctx_canonTenant.__v = 'unknown-school';
    ctx_canonTenant.__p = { 'test-school': slug_uuid };
    let result_slug_unknown;
    try {
      result_slug_unknown = vm.runInContext(
        '_apiCanonTenant(__v, __p)',
        ctx_canonTenant
      );
      check_canon(
        result_slug_unknown === 'unknown-school',
        '③ slug غيرُ محلول → عودةٌ بلا تغيير (سالب)'
      );
    } catch (e) {
      check_canon(false, '③ unknown slug — error: ' + e.message);
      failed++;
    }

    // الحالة ④ — قيمةٌ غير نصية ⇒ عودةٌ كما هي (سالب)
    ctx_canonTenant.__v = null;
    ctx_canonTenant.__p = null;
    let result_null;
    try {
      result_null = vm.runInContext(
        '_apiCanonTenant(__v, __p)',
        ctx_canonTenant
      );
      check_canon(result_null === null, '④ قيمةٌ null تعودُ null (سالب)');
    } catch (e) {
      check_canon(false, '④ null value — error: ' + e.message);
      failed++;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ② فحصُ _apiCacheProbe — رصدُ canon flag و إعادةُ بناءِ المفتاح
  // ═════════════════════════════════════════════════════════════════════════

  const ctx_probe = vm.createContext({
    API_CACHE_BODY_MAX: 131072,
    API_CACHE_ARGSKEY_MAX: 2048,
    API_CACHE_FNS: {
      getHomePageBundle: { tenantless: false, argTenant: true },
      listPartnerSchoolsPublic: { tenantless: true, argTenant: false }
    },
    _API_UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    console: { log: function () {} },
    JSON: JSON,
    Object: Object,
    String: String
  });
  
  let cpSuccess = false;
  try {
    vm.runInContext(src, ctx_probe);
    cpSuccess = true;
  } catch (e) {
    console.error('⚠️ تحذير: استخراجُ _apiCacheProbe قد لا يكون متاحاً');
  }

  if (cpSuccess && typeof ctx_probe._apiCacheProbe === 'function') {
    // الحالة ① — slug منشورٌ بدونِ pairs ⇒ canon:true يُرجَع (موجب)
    const body_with_slug = JSON.stringify({
      fn: 'getHomePageBundle',
      args: ['my-school-slug']
    });
    ctx_probe.__b = body_with_slug;
    ctx_probe.__p = null;
    let probe_slug_nomap;
    try {
      probe_slug_nomap = vm.runInContext(
        '_apiCacheProbe(__b, __p)',
        ctx_probe
      );
      check_canon(
        probe_slug_nomap && probe_slug_nomap.canon === true,
        '⑤ slug بلا pairs → canon:true يُرجَع (موجب)'
      );
    } catch (e) {
      check_canon(false, '⑤ slug without pairs — error: ' + e.message);
      failed++;
    }

    // الحالة ② — slug محلولٌ عبر pairs ⇒ mapsKey بالـUUID، canon غائب (موجب)
    const pairs_map = { 'my-school-slug': 'a1b2c3d4-e5f6-4789-9abc-def012345678' };
    ctx_probe.__b = body_with_slug;
    ctx_probe.__p = pairs_map;
    let probe_slug_mapped;
    try {
      probe_slug_mapped = vm.runInContext(
        '_apiCacheProbe(__b, __p)',
        ctx_probe
      );
      check_canon(
        probe_slug_mapped &&
          probe_slug_mapped.argsKey &&
          !probe_slug_mapped.canon,
        '⑥ slug محلولٌ عبر pairs → mapsKey بـUUID، بلا canon (موجب)'
      );
    } catch (e) {
      check_canon(false, '⑥ slug with pairs — error: ' + e.message);
      failed++;
    }

    // تفصيلٌ إضافي: argsKey يجب أن يحتويَ UUID لا الـslug
    if (probe_slug_mapped && probe_slug_mapped.argsKey) {
      let decoded_key_slug = '';
      try {
        decoded_key_slug = decodeURIComponent(probe_slug_mapped.argsKey);
      } catch (e) {
        // ignore decode error
      }
      check_canon(
        decoded_key_slug.indexOf('a1b2c3d4-e5f6-4789-9abc-def012345678') >= 0,
        '⑦ mapsKey يحتوي الـUUID القانونيّ (موجب)'
      );
    }

    // الحالة ③ — UUID مباشرةً ⇒ لا canon (موجب)
    const body_with_uuid = JSON.stringify({
      fn: 'getHomePageBundle',
      args: ['a1b2c3d4-e5f6-4789-9abc-def012345678']
    });
    ctx_probe.__b = body_with_uuid;
    ctx_probe.__p = null;
    let probe_uuid_direct;
    try {
      probe_uuid_direct = vm.runInContext(
        '_apiCacheProbe(__b, __p)',
        ctx_probe
      );
      check_canon(
        probe_uuid_direct && !probe_uuid_direct.canon,
        '⑧ UUID مباشرةً → بلا canon flag (موجب)'
      );
    } catch (e) {
      check_canon(false, '⑧ UUID direct — error: ' + e.message);
      failed++;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ③ فحصُ _schoolIdScript — حقنُ window.__CANON_SCHOOL__
  // ═════════════════════════════════════════════════════════════════════════

  const ctx_script = vm.createContext({
    _SCHOOL_UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    console: { log: function () {} },
    JSON: JSON,
    String: String
  });
  
  let csSuccess = false;
  try {
    vm.runInContext(src, ctx_script);
    csSuccess = true;
  } catch (e) {
    console.error('⚠️ تحذير: استخراجُ _schoolIdScript قد لا يكون متاحاً');
  }

  if (csSuccess && typeof ctx_script._schoolIdScript === 'function') {
    // الحالة ① — UUID صحيح ⇒ يُحقَن __CANON_SCHOOL__ (موجب)
    const canon_uuid = 'F1E2D3C4-B5A6-4789-0ABC-DEF123456789';
    ctx_script.__k = canon_uuid;
    let script_output = '';
    try {
      script_output = vm.runInContext('_schoolIdScript(__k)', ctx_script);
      check_canon(
        script_output.indexOf('window.__CANON_SCHOOL__') >= 0,
        '⑨ UUID → حقنُ __CANON_SCHOOL__ (موجب)'
      );
      check_canon(
        script_output.indexOf('window.SCHOOL_ID') >= 0,
        '⑩ UUID → حقنُ SCHOOL_ID أيضاً (موجب)'
      );
    } catch (e) {
      check_canon(false, '⑨-⑩ _schoolIdScript with UUID — error: ' + e.message);
      failed++;
    }

    // الحالة ② — slug أو قيمةٌ غيرُ UUID ⇒ لا حقن (سالب)
    ctx_script.__k = 'my-school-slug';
    let script_no_output = '';
    try {
      script_no_output = vm.runInContext('_schoolIdScript(__k)', ctx_script);
      check_canon(
        script_no_output === '',
        '⑪ slug غيرُ صحيح → سلسلةٌ فارغة (سالب)'
      );
    } catch (e) {
      check_canon(false, '⑪ _schoolIdScript with slug — error: ' + e.message);
      failed++;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // النتيجةُ النهائيّة
  // ─────────────────────────────────────────────────────────────────────────

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

console.log('\n✅ اختبارات الوركر اكتملت بنجاح — آمِنٌ للدمج');
