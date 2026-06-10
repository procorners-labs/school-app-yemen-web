<#
  rollback-deployments.ps1 — تراجع طارئ: إعادة كل منصّة لآخر نسخة عاملة.

  السبب: مزامنة repo→live (sync Phase 2) دفعت كوداً ناقصاً من المستودع فوق
  الإنتاج، فاختفت وظائف (واجبات/مخالفات/أنشطة) وظهر «_sampleAssignments is
  not defined». هذا السكربت يعيد توجيه كل /exec لنسخة ما قبل المزامنة
  (نسخة denylist العاملة وكاملة الوظائف) دون لمس HEAD.

  بعد التشغيل تعود كل المنصّات للعمل فوراً (الرابط /exec ثابت، إصدار سابق).
  ⚠️ يتطلّب clasp مسجّل دخول. إن ظهر Invalid Credentials شغّل: clasp login

  الاستخدام:
    pwsh _build/rollback-deployments.ps1            # تراجع كل المنصّات
    pwsh _build/rollback-deployments.ps1 -WhatIf    # معاينة فقط
#>
param([switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

# معرّف النشر الإنتاجي + رقم النسخة العاملة (ما قبل sync repo→live)
$TARGET = @(
  @{ name='student';      id='AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq'; ver=120 },
  @{ name='teacher';      id='AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND'; ver=351 },
  @{ name='home';         id='AKfycbzDfGEK6IpChVNl9k8xbt_iv5p6bLOktt-TvEzDp8yBpH3Ga3yNMen_0S2ZyuuvGtKFCA'; ver=67  },
  @{ name='cms';          id='AKfycbz-iAj9L3ROOn4CAjmwkVBUqpWuxIx1LkgPLwKnHu7kHLWKCy3GVJNo1vZbnekop0VlMA'; ver=86  },
  @{ name='master-admin'; id='AKfycbx5H6uYXb-6iVt_nT4YkdnYMhl6eZJSDxsULsKa2eyblZQcwzRo4CXR3Mh_ecRSZd4M'; ver=34  },
  @{ name='schedule';     id='AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag'; ver=47  }
)

function Invoke-Clasp {
  param([string[]]$ClaspArgs, [string]$WorkDir)
  Push-Location $WorkDir
  try {
    $out = (& clasp @ClaspArgs 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0 -or $out -match 'Invalid Credentials') {
      if ($out -match 'Invalid Credentials') { throw "انتهت جلسة clasp. شغّل: clasp login" }
      throw "فشل clasp $($ClaspArgs -join ' '):`n$out"
    }
    return $out
  } finally { Pop-Location }
}

foreach ($t in $TARGET) {
  Write-Host "`n========== $($t.name) → الإصدار @$($t.ver) ==========" -ForegroundColor Cyan
  $dir = Join-Path $repo $t.name
  if (-not (Test-Path (Join-Path $dir '.clasp.json'))) { Write-Host "تخطّي: لا .clasp.json" -ForegroundColor Yellow; continue }
  if ($WhatIf) {
    Write-Host "[WhatIf] clasp deploy -i $($t.id) -V $($t.ver)" -ForegroundColor Magenta
    continue
  }
  Invoke-Clasp -WorkDir $dir -ClaspArgs @('deploy','-i',$t.id,'-V',"$($t.ver)",'-d',"rollback: restore working version @$($t.ver)") | Out-Null
  Write-Host "✅ أُعيد $($t.name) للإصدار العامل @$($t.ver)." -ForegroundColor Green
}
Write-Host "`nانتهى التراجع. افتح كل منصّة على رابط الـWorker للتأكد من عودة الواجبات/المخالفات/الدرجات." -ForegroundColor Cyan
