param([switch]$Check)
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path -Parent $PSScriptRoot
$desktop=Join-Path $sourceRoot 'desktop'
$bundledNode=Join-Path $sourceRoot 'build-tools\node.exe'
$node=if(Test-Path -LiteralPath $bundledNode){$bundledNode}else{(Get-Command node -ErrorAction Stop).Source}
$vite=Join-Path $desktop 'node_modules\vite\bin\vite.js'
$electron=Join-Path $desktop 'node_modules\electron\dist\electron.exe'
foreach($file in @($vite,$electron)) {
  if(-not(Test-Path -LiteralPath $file)){throw 'Dependencies missing. Run pnpm install from the source folder first.'}
}
$data=Join-Path $sourceRoot 'user-data'
if($Check) {
  Write-Output "Source: $sourceRoot"
  Write-Output "Settings: $data\config.json"
  Write-Output 'Ready: local Node, Vite and Electron are available. No application started.'
  exit 0
}
$logs=Join-Path $data 'logs'
$null=New-Item -ItemType Directory -Path $logs -Force
$oldConfig=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'yanjiu-scrcpy\config.json'
$newConfig=Join-Path $data 'config.json'
if(-not(Test-Path -LiteralPath $newConfig) -and (Test-Path -LiteralPath $oldConfig)) {
  Copy-Item -LiteralPath $oldConfig -Destination $newConfig
}
$env:YANJIU_SOURCE_ROOT=$sourceRoot
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:PORTABLE_EXECUTABLE_DIR -ErrorAction SilentlyContinue
$env:PATH=(Split-Path -Parent $node)+';'+$env:PATH
Push-Location -LiteralPath $desktop
try {
  Write-Output 'Starting Yanjiu-scrcpy from source. Use the tray Exit command to quit.'
  & $node $vite dev --host 127.0.0.1 --strictPort *> (Join-Path $logs 'Yanjiu-scrcpy-startup.log')
  if($LASTEXITCODE -ne 0){throw "Source startup failed. See $logs\Yanjiu-scrcpy-startup.log. Port 1535 may already be in use."}
} finally {Pop-Location}
