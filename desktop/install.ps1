param([string]$DshCli = "")
$ErrorActionPreference = "Stop"
if (-not $DshCli) {
    $command = Get-Command dsh -ErrorAction SilentlyContinue
    if ($command) { $DshCli = $command.Source }
}
if (-not $DshCli -or -not (Test-Path -LiteralPath $DshCli)) {
    throw "DeepSeek Harness CLI was not found. Enable the dsh command, or pass -DshCli with its CLI path."
}
$packages = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter "*.tgz" -File)
if ($packages.Count -ne 1) { throw "Keep this installer next to the dsbot .tgz file." }
& $DshCli plugin --profile desktop add ("file:" + $packages[0].FullName)
if ($LASTEXITCODE -ne 0) { throw "DSH plugin installation failed (exit $LASTEXITCODE)." }
Write-Host ""
Write-Host "dsbot installed. Keep DeepSeek Harness running."
Write-Host "Open this address on your computer: http://127.0.0.1:3098/"
