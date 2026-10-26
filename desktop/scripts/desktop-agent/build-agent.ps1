param(
  [Parameter(Mandatory=$true)][string]$JdkHome,
  [Parameter(Mandatory=$true)][string]$AndroidJar,
  [Parameter(Mandatory=$true)][string]$D8Jar
)
$ErrorActionPreference='Stop'
$desktop=Split-Path (Split-Path $PSScriptRoot)
$generated=Join-Path ([IO.Path]::GetTempPath()) 'yanjiu-scrcpy-desktop-agent-build'
$buildRoot=[IO.Path]::GetFullPath($generated)
if ((Split-Path $buildRoot -Leaf) -ne 'yanjiu-scrcpy-desktop-agent-build') { throw 'Invalid helper build path' }
foreach ($name in @('classes','dex')) {
  $target=[IO.Path]::GetFullPath((Join-Path $buildRoot $name))
  if (-not $target.StartsWith($buildRoot+[IO.Path]::DirectorySeparatorChar)) { throw 'Invalid helper cleanup path' }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
New-Item -ItemType Directory -Force -Path $generated,(Join-Path $generated 'classes'),(Join-Path $generated 'dex') | Out-Null
& (Join-Path $JdkHome 'bin/javac.exe') -encoding UTF-8 -source 8 -target 8 -classpath $AndroidJar -d (Join-Path $generated 'classes') (Join-Path $PSScriptRoot 'Agent.java')
if ($LASTEXITCODE) { throw 'Desktop agent Java compilation failed' }
& (Join-Path $JdkHome 'bin/jar.exe') cf (Join-Path $generated 'agent-input.jar') -C (Join-Path $generated 'classes') .
if ($LASTEXITCODE) { throw 'Desktop agent JAR creation failed' }
& (Join-Path $JdkHome 'bin/java.exe') -cp $D8Jar com.android.tools.r8.D8 --lib $AndroidJar --min-api 26 --output (Join-Path $generated 'dex') (Join-Path $generated 'agent-input.jar')
if ($LASTEXITCODE) { throw 'Desktop agent DEX compilation failed' }
& (Join-Path $JdkHome 'bin/jar.exe') cf (Join-Path $desktop 'electron/resources/extra/common/desktop-agent.jar') -C (Join-Path $generated 'dex') classes.dex
if ($LASTEXITCODE) { throw 'Desktop agent output failed' }
