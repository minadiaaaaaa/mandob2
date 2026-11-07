# The full test plan (TEST-PLAN.md) on a disposable MySQL / MariaDB database. Run from server/.
# Needs: QA_DATABASE_URL (a throwaway database, its name must start with mandoob_test), and for the browser tests
# QA_BROWSER_PATH (Chrome or Edge). QA_PLAYWRIGHT_MODULE defaults to the playwright-core installed in server/.
$ErrorActionPreference = 'Stop'
$qaServer = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $qaServer
if (-not $env:QA_DATABASE_URL -or $env:QA_DATABASE_URL -notmatch '/mandoob_test[a-z0-9_]*$') { throw 'Set QA_DATABASE_URL to a disposable mysql://…/mandoob_test… database.' }
if (-not $env:QA_PLAYWRIGHT_MODULE) { $env:QA_PLAYWRIGHT_MODULE = (Join-Path $qaServer 'node_modules\playwright-core\index.mjs') }
if (Get-NetTCPConnection -LocalPort 4100 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 4100 is already in use. Stop the previous test server first.' }
$qaData = Join-Path $env:TEMP ('mandoob-qa-' + (Get-Date -Format 'yyyyMMddHHmmss'))
$qaEnv = Join-Path $env:TEMP 'mandoob-qa.env'
"DATABASE_URL=$($env:QA_DATABASE_URL)`nAPP_DATA_DIR=$($qaData -replace '\\','/')`nPORT=4100`nDISABLE_SCHEDULER=1`nSIGNUP_LIMIT_PER_HOUR=1000`nOWNER_EMAIL=admin@example.com`nOWNER_PASSWORD=Admin12345!`nOWNER_NAME=Admin" | Set-Content -LiteralPath $qaEnv -Encoding ascii
$results = [System.Collections.Generic.List[object]]::new()
function Step([string]$Name, [scriptblock]$Run) {
    $started = Get-Date
    Write-Host "=== $Name"
    & $Run
    $ok = $LASTEXITCODE -eq 0
    $results.Add([pscustomobject]@{ step = $Name; ok = $ok; seconds = [int]((Get-Date) - $started).TotalSeconds })
    if (-not $ok) { throw "FAILED: $Name" }
}
$api = $null
function Start-Api {
    $script:api = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('--import','tsx',"--env-file=$qaEnv",'src/index.ts') -WorkingDirectory $qaServer -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $env:TEMP 'mandoob-qa-output.log') -RedirectStandardError (Join-Path $env:TEMP 'mandoob-qa-error.log')
    for ($i = 0; $i -lt 120; $i++) { if (Get-NetTCPConnection -LocalPort 4100 -State Listen -ErrorAction SilentlyContinue) { return }; Start-Sleep -Milliseconds 250 }
    throw 'The test server did not start; see mandoob-qa-error.log in TEMP.'
}
function Stop-Api { if ($script:api -and -not $script:api.HasExited) { Stop-Process -Id $script:api.Id -Force; Start-Sleep -Milliseconds 800 } }
try {
    Step 'U1-U3 unit tests' { npx tsx --test src/sql.test.ts src/tenancy.test.ts src/http.test.ts src/importer.test.ts src/security.test.ts src/employees.test.ts }
    Step 'U4 server typecheck' { npx tsc --noEmit -p . }
    Step 'U5 every route checks a permission or is an explained exception' { node test/route-guard.mjs }
    Step 'U4 web typecheck and build' { Push-Location ..\web; try { npx tsc --noEmit -p .; if ($LASTEXITCODE -eq 0) { node node_modules/vite/bin/vite.js build | Out-Null } } finally { Pop-Location } }
    Step 'fresh database' { node test/support/fresh-db.mjs $env:QA_DATABASE_URL }
    Start-Api
    # no setup screens: the server builds the tables and the owner admin@example.com (username admin) when it starts
    Step 'server prepared the database by itself' { node test/support/check-bootstrap.mjs http://127.0.0.1:4100 }
    Step 'migrations-check.ts' { node --import tsx "--env-file=$qaEnv" test/migrations-check.ts }
    foreach ($s in @('smoke.mjs','security-roles.mjs','full-permissions.mjs','read-endpoints.mjs','missing-records.mjs')) { Step "API $s" { node "test/$s" http://127.0.0.1:4100 } }
    Step 'API fixtures-mysql.ts' { node --import tsx "--env-file=$qaEnv" test/fixtures-mysql.ts }
    Step 'API session-lifecycle.ts' { node --import tsx "--env-file=$qaEnv" test/session-lifecycle.ts }
    foreach ($s in @('edge-cases.mjs','role-workflows.mjs','fleet-workflows.mjs')) { Step "API $s" { node "test/$s" http://127.0.0.1:4100 } }
    # earlier scripts try wrong portal passwords on purpose; the portal limit counts across every company
    Step 'clear the portal failures of earlier scripts' { node --import tsx "--env-file=$qaEnv" test/support/clear-portal-attempts.ts }
    Step 'SaaS tenant-isolation.mjs' { node test/tenant-isolation.mjs http://127.0.0.1:4100 }
    Step 'clear the portal guessing limit it reached' { node --import tsx "--env-file=$qaEnv" test/support/clear-portal-attempts.ts }
    # sign-ups are limited per network and hour, so the next SaaS tests get a freshly started server
    Stop-Api; Start-Api
    Step 'SaaS saas-extra.mjs' { node test/saas-extra.mjs http://127.0.0.1:4100 }
    Step 'clear the portal guessing of saas-extra' { node --import tsx "--env-file=$qaEnv" test/support/clear-portal-attempts.ts }
    Stop-Api; Start-Api
    Step 'SaaS plans.mjs (phase 1)' { node test/plans.mjs http://127.0.0.1:4100 }
    Step 'SaaS branches.mjs (phase 2)' { node test/branches.mjs http://127.0.0.1:4100 }
    Step 'SaaS platform-ids.mjs (phase 3)' { node test/platform-ids.mjs http://127.0.0.1:4100 }
    Stop-Api; Start-Api
    Step 'SaaS fleet-log.mjs (phase 4)' { node test/fleet-log.mjs http://127.0.0.1:4100 }
    Step 'SaaS employees.mjs (phase 5)' { node test/employees.mjs http://127.0.0.1:4100 }
    Step 'SaaS finance.mjs (phase 6)' { node test/finance.mjs http://127.0.0.1:4100 }
    Step 'SaaS invoices.mjs (phase 7)' { node test/invoices.mjs http://127.0.0.1:4100 }
    if ($env:QA_BROWSER_PATH) {
        foreach ($s in @('browser-qa.mjs','browser-details.mjs','browser-write.mjs','browser-public.mjs')) { Step "browser $s" { node "test/$s" http://127.0.0.1:4100 } }
        Stop-Api; Start-Api
        Step 'browser browser-saas.mjs' { node test/browser-saas.mjs http://127.0.0.1:4100 }
    } else { Write-Host 'QA_BROWSER_PATH not set: browser tests skipped' }
} finally {
    Stop-Api
    $results | Format-Table -AutoSize | Out-String | Write-Host
    $results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qaServer '..\.qa-reports\qa-run-mysql.json') -Encoding utf8
}
