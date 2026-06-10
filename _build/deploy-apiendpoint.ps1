<#
  deploy-apiendpoint.ps1 — نشر آمن لمشاريع Google Apps Script مع تحديث نفس رابط /exec.

  وضعان:
   • الافتراضي (معزول): يستبدل ملفات محدّدة فقط (-Files) في الإنتاج دون لمس الباقي.
     مفيد عند وجود انحراف ولا تريد لمس ملفات حيّة أخرى.
   • -FullSync: يجعل مشروع GAS الحيّ مطابقاً تماماً للمستودع (يضيف/يحدّث/يحذف).
     استخدمه بعد حسم الانحراف لاستعادة «المصدر الواحد».

  في الحالتين: يُنشر إصدار جديد على نفس الـDeployment (يبقى رابط /exec ثابتاً).

  المتطلّبات: clasp 3.x مسجّل دخول، Node.js، التشغيل من جذر المستودع.
  ⚠️ إن ظهر "Invalid Credentials" شغّل أولاً:  clasp login

  أمثلة:
    pwsh _build/deploy-apiendpoint.ps1 -Project home -Files Terms.html -Description "feat: Terms"
    pwsh _build/deploy-apiendpoint.ps1 -Project all  -FullSync -Description "sync: repo→live"
    pwsh _build/deploy-apiendpoint.ps1 -Project master-admin -FullSync -WhatIf
#>
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('home','teacher','student','cms','schedule','master-admin','all')]
  [string]$Project,
  [string[]]$Files = @('ApiEndpoint.js'),
  [string]$Description = 'deploy from repo',
  [switch]$FullSync,   # مزامنة كاملة: الحيّ = المستودع (يحذف الزائد)
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

$DEPLOY = @{
  'home'         = 'AKfycbzDfGEK6IpChVNl9k8xbt_iv5p6bLOktt-TvEzDp8yBpH3Ga3yNMen_0S2ZyuuvGtKFCA'
  'cms'          = 'AKfycbz-iAj9L3ROOn4CAjmwkVBUqpWuxIx1LkgPLwKnHu7kHLWKCy3GVJNo1vZbnekop0VlMA'
  'teacher'      = 'AKfycbwbiM1NdYlHf4XPpeftVcrJPmcrPJWm7KS2sSL4qtzZDMDtYo4sGdx6T-p8fAIArvND'
  'student'      = 'AKfycbz6wFJBq6RUg7buXM5LIGfEa4eVXZguPeIyrkg-T-kbOUhWlJMypO3Ame6lmcHzdcwq'
  'schedule'     = 'AKfycbwbsWcoOZ23TUWDtxVTV1RyG2LJ7IYWTWuk9Jt-15OeB1JgqRIyGSRxZo3NB8ZI2ag'
  'master-admin' = 'AKfycbx5H6uYXb-6iVt_nT4YkdnYMhl6eZJSDxsULsKa2eyblZQcwzRo4CXR3Mh_ecRSZd4M'
}

# يشغّل clasp ويكتشف الفشل (رمز خروج غير صفري أو رسائل خطأ صريحة) — لا نجاح كاذب.
function Invoke-Clasp {
  param([string[]]$ClaspArgs)
  $out = (& clasp @ClaspArgs 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or $out -match 'Invalid Credentials|Could not read|Permission denied|^\s*Error') {
    if ($out -match 'Invalid Credentials') {
      throw "انتهت صلاحية جلسة clasp. شغّل: clasp login  ثم أعد المحاولة.`n$out"
    }
    throw "فشل: clasp $($ClaspArgs -join ' ')`n$out"
  }
  return $out
}

function Deploy-One([string]$proj) {
  Write-Host "`n========== $proj ==========" -ForegroundColor Cyan
  $projDir  = Join-Path $repo $proj
  $claspCfg = Join-Path $projDir '.clasp.json'
  if (-not (Test-Path $claspCfg)) { throw ".clasp.json غير موجود: $claspCfg" }
  $depId = $DEPLOY[$proj]
  if (-not $depId) { throw "لا معرّف نشر لـ $proj" }

  if ($FullSync) {
    # مزامنة كاملة: ادفع كل ملفات المستودع (يضيف/يحدّث/يحذف) من مجلد المشروع نفسه
    # (في هذا الوضع تُتجاهَل -Files لأننا نزامن المشروع بالكامل)
    if ($WhatIf) {
      Write-Host "[WhatIf] مزامنة كاملة: clasp push -f (الحيّ=المستودع) ثم deploy -i $depId" -ForegroundColor Magenta
      Push-Location $projDir; try { Invoke-Clasp @('status') | Write-Host } finally { Pop-Location }
      return
    }
    Push-Location $projDir
    try {
      Write-Host "→ مزامنة كاملة (clasp push -f): الحيّ سيطابق المستودع..." -ForegroundColor Yellow
      Invoke-Clasp @('push','-f') | Out-Null
      Write-Host "→ نشر إصدار جديد على نفس الـDeployment..." -ForegroundColor Yellow
      Invoke-Clasp @('deploy','-i',$depId,'-d',$Description) | Out-Null
      Write-Host "✅ تمّت مزامنة ونشر $proj (الرابط /exec ثابت)." -ForegroundColor Green
    } finally { Pop-Location }
    return
  }

  # الوضع المعزول: استبدال ملفات محدّدة فقط عبر سحب الحيّ لمؤقت
  foreach ($file in $Files) {
    if (-not (Test-Path (Join-Path $projDir $file))) { throw "الملف غير موجود في المستودع: $proj\$file" }
  }
  $tmp = Join-Path $repo ".claude\_deploy_$proj"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory -Path $tmp | Out-Null
  Copy-Item $claspCfg (Join-Path $tmp '.clasp.json')
  Push-Location $tmp
  try {
    Write-Host "→ سحب نسخة الإنتاج الحيّة (clasp pull)..." -ForegroundColor Yellow
    Invoke-Clasp @('pull') | Out-Null
    foreach ($file in $Files) {
      Copy-Item (Join-Path $projDir $file) (Join-Path $tmp $file) -Force
      Write-Host "→ استُبدل: $file"
    }
    if ($WhatIf) {
      Write-Host "[WhatIf] سيُنفَّذ: clasp push -f ثم clasp deploy -i $depId" -ForegroundColor Magenta
      return
    }
    Write-Host "→ رفع المحتوى (clasp push)..." -ForegroundColor Yellow
    Invoke-Clasp @('push','-f') | Out-Null
    Write-Host "→ نشر إصدار جديد على نفس الـDeployment..." -ForegroundColor Yellow
    Invoke-Clasp @('deploy','-i',$depId,'-d',$Description) | Out-Null
    Write-Host "✅ تم نشر $proj بنجاح (الرابط /exec ثابت)." -ForegroundColor Green
  } finally {
    Pop-Location
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# تحقّق مبكّر من المصادقة (يفشل بوضوح إن انتهت الجلسة)
Write-Host "التحقّق من جلسة clasp..." -ForegroundColor DarkGray
try { Invoke-Clasp @('show-authorized-user') | Out-Null }
catch { Write-Host "❌ $_" -ForegroundColor Red; Write-Host "نفّذ: clasp login  ثم أعد تشغيل السكربت." -ForegroundColor Yellow; exit 1 }

if ($Project -eq 'all') {
  foreach ($p in @('student','home','teacher','cms','master-admin','schedule')) { Deploy-One $p }
} else {
  Deploy-One $Project
}
Write-Host "`nانتهى. تحقّق من كل منصّة عبر فتحها على رابط الـWorker." -ForegroundColor Cyan
