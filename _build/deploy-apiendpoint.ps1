<#
  deploy-apiendpoint.ps1 — نشر آمن ومعزول لملف ApiEndpoint.js إلى مشروع GAS حيّ.

  لماذا معزول؟ المستودع منحرف عن بعض مشاريع GAS الحيّة (ملفات مختلفة/مفقودة).
  لذا `clasp push` المباشر من مجلد المستودع خطر (قد يحذف/يستبدل ملفات إنتاج).
  هذا السكربت بدلاً من ذلك:
    1) يسحب نسخة الإنتاج الحيّة إلى مجلد مؤقت (clasp pull).
    2) يستبدل ApiEndpoint.js وحده بنسخة المستودع (denylist الأمنية).
    3) clasp push  → لا يتغيّر في الإنتاج إلا ApiEndpoint.js.
    4) clasp deploy -i <deploymentId> → إصدار جديد على نفس النشر (يبقى /exec ثابتاً).

  المتطلّبات: clasp 3.x مسجّل دخول (~/.clasprc.json)، Node.js، تشغيل من جذر المستودع.
  الاستخدام:  pwsh _build/deploy-apiendpoint.ps1 -Project student
              pwsh _build/deploy-apiendpoint.ps1 -Project all -WhatIf
#>
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('home','teacher','student','cms','schedule','master-admin','all')]
  [string]$Project,
  [switch]$WhatIf  # عرض ما سيحدث دون نشر فعلي
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

# معرّفات النشر الإنتاجية (مطابقة لـ home/DeploymentRegistry.js و /exec)
$DEPLOY = @{
  'home'         = 'AKfycbzDfGEK6IpChVNl9k8xbt_iv5p6bLOktt-TvEzDp8yBpH3Ga3yNMen_0S2ZyuuvGtKFCA'
  'cms'          = 'AKfycbz-iAj9L3ROOn4CAjmwkVBUqpWuxIx1LkgPLwKnHu7kHLWKCy3GVJNo1vZbnekop0VlMA'
  'teacher'      = 'AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND'
  'student'      = 'AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq'
  'schedule'     = 'AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag'
  'master-admin' = 'AKfycbx5H6uYXb-6iVt_nT4YkdnYMhl6eZJSDxsULsKa2eyblZQcwzRo4CXR3Mh_ecRSZd4M'
}

function Deploy-One([string]$proj) {
  Write-Host "`n========== $proj ==========" -ForegroundColor Cyan
  $srcApi = Join-Path $repo "$proj\ApiEndpoint.js"
  $claspCfg = Join-Path $repo "$proj\.clasp.json"
  if (-not (Test-Path $srcApi))   { throw "ApiEndpoint.js غير موجود: $srcApi" }
  if (-not (Test-Path $claspCfg)) { throw ".clasp.json غير موجود: $claspCfg" }
  $depId = $DEPLOY[$proj]
  if (-not $depId) { throw "لا معرّف نشر لـ $proj" }

  $tmp = Join-Path $repo ".claude\_deploy_$proj"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory -Path $tmp | Out-Null
  Copy-Item $claspCfg (Join-Path $tmp '.clasp.json')

  Push-Location $tmp
  try {
    Write-Host "→ سحب نسخة الإنتاج الحيّة (clasp pull)..." -ForegroundColor Yellow
    clasp pull | Out-Null

    # استبدال ApiEndpoint.js وحده بنسخة denylist من المستودع
    Copy-Item $srcApi (Join-Path $tmp 'ApiEndpoint.js') -Force
    Write-Host "→ استُبدل ApiEndpoint.js بنسخة denylist الأمنية."

    if ($WhatIf) {
      Write-Host "[WhatIf] سيُنفَّذ: clasp push -f ثم clasp deploy -i $depId" -ForegroundColor Magenta
      return
    }

    Write-Host "→ رفع المحتوى (clasp push)..." -ForegroundColor Yellow
    clasp push -f | Out-Null
    Write-Host "→ نشر إصدار جديد على نفس الـDeployment..." -ForegroundColor Yellow
    clasp deploy -i $depId -d "fix(security): denylist للدوال الخطرة" | Out-Null
    Write-Host "✅ تم نشر $proj بنجاح (الرابط /exec ثابت)." -ForegroundColor Green
  }
  finally {
    Pop-Location
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($Project -eq 'all') {
  # teacher يُنشر يدوياً مسبقاً؛ أعد إدراجه إن لزم
  foreach ($p in @('student','home','cms','master-admin','schedule')) { Deploy-One $p }
} else {
  Deploy-One $Project
}
Write-Host "`nانتهى. تحقّق من كل منصّة عبر فتحها على رابط الـWorker." -ForegroundColor Cyan
