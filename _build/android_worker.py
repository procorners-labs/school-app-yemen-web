# -*- coding: utf-8 -*-
# يحوّل تطبيق الأندرويد لاستخدام الـ Worker بدل روابط GAS المباشرة.
import sys
p = '_android_probe/app/src/main/java/com/proconrers/schoolappyemen/AppConfig.kt'
s = open(p, encoding='utf-8').read()
W = 'https://school-teacher-proxy.procorners-shop.workers.dev'
log = []

def rep(a, b, label):
    global s
    n = s.count(a)
    if n == 1:
        s = s.replace(a, b); log.append(label + '=OK')
    else:
        log.append(label + '=MISS(' + str(n) + ')')

# 1) الروابط الافتراضية → الـ Worker (home/cms/teacher/student/schedule)
rep('"https://script.google.com/macros/s/AKfycbzDfGEK6IpChVNl9k8xbt_iv5p6bLOktt-TvEzDp8yBpH3Ga3yNMen_0S2ZyuuvGtKFCA/exec"',
    '"' + W + '/home/index.html"', 'HOME')
rep('"https://script.google.com/macros/s/AKfycbz-iAj9L3ROOn4CAjmwkVBUqpWuxIx1LkgPLwKnHu7kHLWKCy3GVJNo1vZbnekop0VlMA/exec"',
    '"' + W + '/cms/index.html"', 'CMS')
rep('"https://script.google.com/macros/s/AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND/exec"',
    '"' + W + '/teacher/index.html"', 'TEACHER')
rep('"https://script.google.com/macros/s/AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq/exec"',
    '"' + W + '/student/index.html"', 'STUDENT')
rep('"https://script.google.com/macros/s/AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag/exec"',
    '"' + W + '/schedule/index.html"', 'SCHEDULE')

# 2) ترقية اسم الكاش لتجاهل روابط GAS القديمة المخزّنة
rep('private const val PREFS_NAME = "deployment_config_v2"',
    'private const val PREFS_NAME = "deployment_config_v3"', 'PREFS')

# 3) تعطيل المزامنة الديناميكية (وإلا تُعيد الروابط لـ GAS)
rep('        // مزامنة في الخلفية لو مرّ وقت كافٍ منذ آخر تحديث\n        syncIfNeeded()',
    '        // ⛔ مُعطّلة: التطبيق يستخدم روابط الـ Worker الثابتة (لا مزامنة GAS)\n        // syncIfNeeded()', 'SYNC')

# 4) إضافة workers.dev للنطاقات الموثوقة
rep('    val trustedSslDomains: List<String> = listOf(\n        "google.com",',
    '    val trustedSslDomains: List<String> = listOf(\n        "workers.dev",\n        "google.com",', 'SSL')

# 5) مطابقة التوجيه بالمسار للـ Worker (إضافة fallback)
rep('''    private fun matchesDeployment(url: String, deploymentUrl: String): Boolean {
        if (url.isBlank() || deploymentUrl.isBlank()) return false
        val id = extractDeploymentId(deploymentUrl) ?: return false
        return url.contains(id, ignoreCase = true)
    }''',
    '''    private fun matchesDeployment(url: String, deploymentUrl: String): Boolean {
        if (url.isBlank() || deploymentUrl.isBlank()) return false
        val id = extractDeploymentId(deploymentUrl)
        if (id != null) return url.contains(id, ignoreCase = true)
        // روابط الـ Worker: طابِق حسب مسار الصفحة (/teacher/ , /student/ ...)
        val seg = extractWorkerSegment(deploymentUrl)
        return seg != null && url.contains(seg, ignoreCase = true)
    }

    private fun extractWorkerSegment(url: String): String? {
        return Regex("/(home|student|teacher|cms|schedule)/").find(url)?.value
    }''', 'MATCH')

open(p, 'w', encoding='utf-8').write(s)
sys.stdout.buffer.write((' | '.join(log)).encode('utf-8'))
