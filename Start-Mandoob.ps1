$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskServer = Join-Path $taskRoot 'server'
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot '.env'))) { throw 'Configure .env first.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'web/dist/index.html'))) {
    & pnpm -C (Join-Path $taskRoot 'web') build
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
}
$taskPort = 4000
if (-not (Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue)) {
    $taskData = Join-Path $taskServer 'data'
    New-Item -ItemType Directory -Path $taskData -Force | Out-Null
    $taskProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('--import','tsx','--env-file=../.env','src/index.ts') -WorkingDirectory $taskServer -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskData 'app-output.log') -RedirectStandardError (Join-Path $taskData 'app-error.log') -PassThru
    $taskProcess.Id | Set-Content -LiteralPath (Join-Path $taskData 'app-process-id.txt')
    for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
        if (Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue) { break }
        $taskProcess.Refresh()
        if ($taskProcess.HasExited) { throw 'Application failed to start. Check server/data/app-error.log.' }
        Start-Sleep -Milliseconds 100
    }
}
Write-Output 'Mandoob: http://localhost:4000/admin/login'
