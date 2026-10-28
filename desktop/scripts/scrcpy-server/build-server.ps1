param(
  [Parameter(Mandatory=$true)][string]$JdkHome,
  [Parameter(Mandatory=$true)][string]$AndroidPlatform,
  [Parameter(Mandatory=$true)][string]$AndroidBuildTools,
  [Parameter(Mandatory=$true)][string]$WorkDirectory,
  [string]$SourceArchive
)
$ErrorActionPreference='Stop'
$version='4.1'
$sourceHash='1525C92183C4D1F7D4D1A702CFDDC5A452DA4F49222B0C327A7E8B1E0AF14833'
$desktop=Split-Path (Split-Path $PSScriptRoot)
$build=Join-Path ([IO.Path]::GetFullPath($WorkDirectory)) ('focus-'+[guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $build | Out-Null
if (-not $SourceArchive) {
  $SourceArchive=Join-Path $build 'upstream.zip'
  Invoke-WebRequest "https://codeload.github.com/Genymobile/scrcpy/zip/refs/tags/v$version" -OutFile $SourceArchive
}
if ((Get-FileHash -LiteralPath $SourceArchive -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Unexpected upstream scrcpy source hash' }
Expand-Archive -LiteralPath $SourceArchive -DestinationPath $build
$upstream=Join-Path $build "scrcpy-$version"
$source=Join-Path $upstream 'server/src/main/java'
$capture=Join-Path $source 'com/genymobile/scrcpy/video/NewDisplayCapture.java'
$text=[IO.File]::ReadAllText($capture)
$before='flags \|= VIRTUAL_DISPLAY_FLAG_OWN_FOCUS\s*\| VIRTUAL_DISPLAY_FLAG_DEVICE_DISPLAY_GROUP;'
if ([regex]::Matches($text,$before).Count -ne 1) { throw 'Upstream display focus code changed; review the patch' }
$text=[regex]::Replace($text,$before,'// Yanjiu desktop: one keyboard/IME focus follows the foreground app.
                    // OWN_FOCUS prevents focus-loss/gain callbacks when switching displays.
                    flags |= VIRTUAL_DISPLAY_FLAG_DEVICE_DISPLAY_GROUP;')
[IO.File]::WriteAllText($capture,$text,[Text.UTF8Encoding]::new($false))
# Delegate only Android-to-PC updates, preserving normal Ctrl+V and its ACK.
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'DesktopClipboardRelay.java') -Destination (Join-Path $source 'com/genymobile/scrcpy/DesktopClipboardRelay.java')
$controller=Join-Path $source 'com/genymobile/scrcpy/control/Controller.java'
$text=[IO.File]::ReadAllText($controller)
$before='if (isSettingClipboard.get()) {'
if ($text.Split(@($before),[StringSplitOptions]::None).Count -ne 2) { throw 'Upstream clipboard callback changed' }
$text=$text.Replace($before,'if (isSettingClipboard.get() || com.genymobile.scrcpy.DesktopClipboardRelay.isRunning()) {')
[IO.File]::WriteAllText($controller,$text,[Text.UTF8Encoding]::new($false))
$classes=Join-Path $build 'classes'
$generated=Join-Path $build 'generated'
New-Item -ItemType Directory -Path $classes,"$generated/com/genymobile/scrcpy" -Force | Out-Null
[IO.File]::WriteAllText("$generated/com/genymobile/scrcpy/BuildConfig.java",'package com.genymobile.scrcpy; public final class BuildConfig { public static final boolean DEBUG=false; public static final String VERSION_NAME="4.1"; }')
$aidl=Join-Path $upstream 'server/src/main/aidl'
& "$AndroidBuildTools/aidl.exe" (Join-Path $aidl 'android\content\IOnPrimaryClipChangedListener.aidl') (Join-Path $generated 'android\content\IOnPrimaryClipChangedListener.java')
if ($LASTEXITCODE) { throw 'Clipboard AIDL build failed' }
& "$AndroidBuildTools/aidl.exe" '-p' (Join-Path $AndroidPlatform 'framework.aidl') (Join-Path $aidl 'android\view\IDisplayWindowListener.aidl') (Join-Path $generated 'android\view\IDisplayWindowListener.java')
if ($LASTEXITCODE) { throw 'Display AIDL build failed' }
# Older Windows aidl writes its command-line comment in the local code page.
Get-ChildItem $generated -Filter '*.java' -Recurse | ForEach-Object {
  $lines=[IO.File]::ReadAllLines($_.FullName) | Where-Object { $_ -notmatch '^ \* Using:' }
  [IO.File]::WriteAllLines($_.FullName,$lines,[Text.UTF8Encoding]::new($false))
}
$java=@(Get-ChildItem $source,$generated -Filter '*.java' -Recurse | ForEach-Object { '"'+$_.FullName.Replace('\','/')+'"' })
$arguments=Join-Path $build 'sources.txt'
[IO.File]::WriteAllLines($arguments,$java,[Text.UTF8Encoding]::new($false))
& "$JdkHome/bin/javac.exe" -encoding UTF-8 -source 8 -target 8 -bootclasspath "$AndroidPlatform/android.jar" -classpath "$AndroidBuildTools/core-lambda-stubs.jar" -d $classes "@$arguments"
if ($LASTEXITCODE) { throw 'scrcpy server compilation failed' }
& "$JdkHome/bin/jar.exe" cf "$build/classes.jar" -C $classes .
if ($LASTEXITCODE) { throw 'Class archive failed' }
& "$JdkHome/bin/java.exe" -cp "$AndroidBuildTools/lib/d8.jar" com.android.tools.r8.D8 --lib "$AndroidPlatform/android.jar" --min-api 21 --output "$build/server.zip" "$build/classes.jar"
if ($LASTEXITCODE) { throw 'scrcpy DEX build failed' }
$output=Join-Path $desktop 'electron/resources/extra/common'
Copy-Item -LiteralPath "$build/server.zip" -Destination "$output/scrcpy-server-4.1-desktop.jar"
Copy-Item -LiteralPath "$upstream/LICENSE" -Destination "$output/scrcpy-server-LICENSE"
@{ version=$version; source="https://github.com/Genymobile/scrcpy/tree/v$version"; sourceSha256=$sourceHash.ToLower(); sha256=(Get-FileHash "$output/scrcpy-server-4.1-desktop.jar" -Algorithm SHA256).Hash.ToLower(); policy='single-foreground-focus'; patch='Omit OWN_FOCUS; event-driven desktop clipboard coordinator with upstream fallback' } | ConvertTo-Json | Set-Content "$output/scrcpy-server-desktop.json" -Encoding utf8
Write-Output "$output/scrcpy-server-4.1-desktop.jar"
