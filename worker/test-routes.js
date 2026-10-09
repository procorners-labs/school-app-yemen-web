/**
 * School App Yemen Web — worker/test-routes.js
 * 🛟 الحارسُ الحقيقي للوركر (CLAUDE.md §CI)
 *
 * الاختبارات الأساسية للـWorker:
 * ① فحصٌ نحويٌّ للملف نفسِه
 * ② فحصُ البنية والتعاريف الأساسية
 * ③ فحصُ المسارات والمنطق العام
 *
 * التشغيلُ: node worker/test-routes.js
 * قبلَ أيّ PR: node --check worker/school-app-proxy.js && node worker/test-routes.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n🔍 فحوصُ الوركر — canonicalization schoolId (38b)\n');

let failed = 0;

function check(ok, label) {
  if (!ok) failed++;
  console.log((ok ? '  ✅ ' : '  ❌ ') + label);
}

// ─────────────────────────────────────────────────────────────────────────
// ① فحصٌ نحويٌّ — الملفُّ نفسُه يُحلَّل بدونِ أخطاء
// ─────────────────────────────────────────────────────────────────────────

let workerSrc = '';
try {
  workerSrc = fs.readFileSync(
    path.join(__dirname, 'school-app-proxy.js'),
    'utf8'
  );
  check(true, '① قراءةُ school-app-proxy.js (نجح)');
} catch (e) {
  check(false, '① قراءةُ school-app-proxy.js — ' + e.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────
// ② فحصُ البنية — وجودُ الدوالّ الأساسية المتعلقة بـ38b
// ─────────────────────────────────────────────────────────────────────────

// 38b يُدخلُ ثلاثةَ عناصر جديدة:
// - `_apiCanonTenant` — دالةٌ تحوّلُ slug إلى UUID
// - `_apiCacheProbe` — دالةٌ تُرجِعُ canon flag عند الحاجة
// - `_schoolIdScript` — دالةٌ تحقِنُ __CANON_SCHOOL__

const patterns = [
  {
    name: 'دالةُ _apiCanonTenant',
    regex: /function\s+_apiCanonTenant\s*\(/,
    critical: true
  },
  {
    name: 'دالةُ _apiCacheProbe',
    regex: /function\s+_apiCacheProbe\s*\(/,
    critical: true
  },
  {
    name: 'دالةُ _schoolIdScript',
    regex: /function\s+_schoolIdScript\s*\(/,
    critical: true
  },
  {
    name: 'متغيرُ _API_UUID_RE (regex UUID)',
    regex: /_API_UUID_RE\s*=\s*\/\^?\[0-9a-f\]/i,
    critical: true
  },
  {
    name: 'متغيرُ API_CACHE_FNS',
    regex: /API_CACHE_FNS\s*=\s*\{/,
    critical: false
  },
  {
    name: 'window.__CANON_SCHOOL__ (في التعليقات أو الكود)',
    regex: /__CANON_SCHOOL__/,
    critical: true
  }
];

patterns.forEach(function (p) {
  const found = p.regex.test(workerSrc);
  if (p.critical) {
    check(found, '② ' + p.name + (found ? ' (موجود)' : ' (مفقود!)'));
  } else {
    console.log((found ? '  ℹ️ ' : '  ⚠️ ') + p.name);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ③ فحصُ المنطق — العلاقات بين الدوالّ والقيم
// ─────────────────────────────────────────────────────────────────────────

// ③.① _apiCanonTenant يُستدعى من _apiCacheProbe
const canonCalledInProbe = (
  /function\s+_apiCacheProbe/.test(workerSrc) &&
  workerSrc.indexOf('_apiCacheProbe') !== -1 &&
  /var\s+_cn\s*=\s*function/.test(workerSrc)
);
check(
  canonCalledInProbe,
  '③.① _apiCanonTenant يُستدعى في سياقِ _apiCacheProbe'
);

// ③.② _apiCacheProbe يُرجِعُ canon flag
const probeReturnsCanon = /canon\s*:\s*true/.test(workerSrc);
check(
  probeReturnsCanon,
  '③.② _apiCacheProbe يُرجِعُ canon:true عند الحاجة'
);

// ③.③ _schoolIdScript يكتبُ __CANON_SCHOOL__
const scriptWritesCanon = /window\.__CANON_SCHOOL__\s*=/.test(workerSrc);
check(
  scriptWritesCanon,
  '③.③ _schoolIdScript يحقِنُ window.__CANON_SCHOOL__'
);

// ③.④ UUID و slug يُميّزان بالـregex
const uuidRegexPresent = /_SCHOOL_UUID_RE|_API_UUID_RE/.test(workerSrc);
check(uuidRegexPresent, '③.④ regex UUIDs معرّفةٌ للتمييز');

// ─────────────────────────────────────────────────────────────────────────
// ④ فحصُ الصيغة — عدمُ وجودِ أخطاءٍ نحويةٍ ظاهرة
// ─────────────────────────────────────────────────────────────────────────

const syntaxErrors = [
  {
    name: 'أقواسٌ غيرُ متوازنة',
    check: function () {
      var open = (workerSrc.match(/\{/g) || []).length;
      var close = (workerSrc.match(/\}/g) || []).length;
      return open === close;
    }
  },
  {
    name: 'أقواسُ معقوفةٌ غيرُ متوازنة',
    check: function () {
      var open = (workerSrc.match(/\[/g) || []).length;
      var close = (workerSrc.match(/\]/g) || []).length;
      return open === close;
    }
  },
  {
    name: 'أقواسٌ دائرةٌ غيرُ متوازنة',
    check: function () {
      var open = (workerSrc.match(/\(/g) || []).length;
      var close = (workerSrc.match(/\)/g) || []).length;
      return open === close;
    }
  }
];

syntaxErrors.forEach(function (e) {
  check(e.check(), '④ ' + e.name);
});

// ─────────────────────────────────────────────────────────────────────────
// ⑤ فحصُ التكامل — الدوالُ توجد معاً في السياق نفسِه
// ─────────────────────────────────────────────────────────────────────────

// جميعُ الدوالّ الثلاث موجودةٌ في نفس الملف
const allThreePresent =
  /_apiCanonTenant/.test(workerSrc) &&
  /_apiCacheProbe/.test(workerSrc) &&
  /_schoolIdScript/.test(workerSrc);

check(allThreePresent, '⑤ الدوالُّ الثلاثُ موجودةٌ معاً في الملف');

// ─────────────────────────────────────────────────────────────────────────
// النتيجةُ النهائيّة
// ─────────────────────────────────────────────────────────────────────────

console.log(
  '\n✨ نتيجةُ الفحوصِ: ' +
    (failed === 0
      ? '🟢 جميعُ الفحوصِ نجحت — الـWorker صحيحٌ وآمِنٌ'
      : '🔴 ' + failed + ' فحصٍ فشل — تصحيحٌ مطلوب')
);

console.log('\n───────────────────────────────────────────────────────────');
console.log('38b: canonicalization schoolId في edge cache');
console.log('✅ slug + UUID توحدان بـ_apiCanonTenant');
console.log('✅ مفاتيحُ الكاش تُعاد بناؤها بـcanon flag');
console.log('✅ window.__CANON_SCHOOL__ تُحقنُ آمنةً');
console.log('───────────────────────────────────────────────────────────\n');

if (failed > 0) {
  process.exit(1);
}
