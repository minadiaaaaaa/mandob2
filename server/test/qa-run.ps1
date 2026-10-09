$ErrorActionPreference='Stop'
# Run from server/. Requires .env, QA_PLAYWRIGHT_MODULE and QA_BROWSER_PATH.
if (-not $env:QA_PLAYWRIGHT_MODULE -or -not $env:QA_BROWSER_PATH) { throw 'Configure Playwright module and browser executable paths first.' }
$qaServer=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $qaServer
if (Get-NetTCPConnection -LocalPort 4100 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 4100 is already in use. Stop the previous test server first.' }
$qaEnvironmentNames=@('DB_SCHEMA','DB_SSL_CA_FILE','APP_DATA_DIR','DISABLE_SCHEDULER','PORT','QA_RESUME_REPORT')
$qaEnvironment=@{}
foreach ($qaName in $qaEnvironmentNames) { $qaEnvironment[$qaName]=[Environment]::GetEnvironmentVariable($qaName,'Process') }
$env:DB_SCHEMA='mandoob_test_fullqa_'+(Get-Date -Format 'yyyyMMddHHmmss')
$env:DB_SSL_CA_FILE=(Resolve-Path '../database/supabase/prod-ca-2021.crt').Path
$env:APP_DATA_DIR=Join-Path $env:TEMP $env:DB_SCHEMA
$env:DISABLE_SCHEDULER='1'
$env:PORT='4100'
$env:QA_RESUME_REPORT='0'
function Invoke-QaNode([string[]]$QaArguments) { & node @QaArguments; if ($LASTEXITCODE -ne 0) { throw "QA command failed: $($QaArguments[-1])" } }
$qaProcess=$null
try {
    Invoke-QaNode -QaArguments @('--import','tsx','--env-file=../.env','test/prepare-postgres.ts')
    Invoke-QaNode -QaArguments @('--import','tsx','--env-file=../.env','test/security-db.ts')
    $qaProcess=Start-Process -FilePath (Get-Command node).Source -ArgumentList @('--import','tsx','--env-file=../.env','src/index.ts') -WorkingDirectory $qaServer -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $env:TEMP 'mandoob-qa-output.log') -RedirectStandardError (Join-Path $env:TEMP 'mandoob-qa-error.log')
    for ($qaAttempt=0; $qaAttempt -lt 100; $qaAttempt++) { if (Get-NetTCPConnection -LocalPort 4100 -State Listen -ErrorAction SilentlyContinue) { break }; Start-Sleep -Milliseconds 100 }
    foreach ($qaScript in @('smoke.mjs','security-roles.mjs','full-permissions.mjs','read-endpoints.mjs')) { Invoke-QaNode -QaArguments @("test/$qaScript",'http://127.0.0.1:4100') }
    Invoke-QaNode -QaArguments @('--import','tsx','--env-file=../.env','test/full-db-read.ts')
    Invoke-QaNode -QaArguments @('--import','tsx','--env-file=../.env','test/session-lifecycle.ts')
    foreach ($qaScript in @('edge-cases.mjs','role-workflows.mjs','fleet-workflows.mjs','browser-qa.mjs','browser-details.mjs','browser-write.mjs','browser-public.mjs')) { Invoke-QaNode -QaArguments @("test/$qaScript",'http://127.0.0.1:4100') }
} finally {
    try {
        if ($qaProcess -and -not $qaProcess.HasExited) { Stop-Process -Id $qaProcess.Id }
        Invoke-QaNode -QaArguments @('--import','tsx','--env-file=../.env','test/prepare-postgres.ts','--cleanup')
    } finally {
        foreach ($qaName in $qaEnvironmentNames) { [Environment]::SetEnvironmentVariable($qaName,$qaEnvironment[$qaName],'Process') }
    }
}
