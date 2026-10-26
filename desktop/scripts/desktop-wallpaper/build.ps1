param(
  [Parameter(Mandatory=$true)][string]$JdkHome,
  [Parameter(Mandatory=$true)][string]$AndroidJar,
  [Parameter(Mandatory=$true)][string]$BuildTools,
  [Parameter(Mandatory=$true)][string]$KeyStore
)
$ErrorActionPreference='Stop'
$desktop=Split-Path (Split-Path $PSScriptRoot)
$generated=Join-Path ([IO.Path]::GetTempPath()) 'yanjiu-scrcpy-wallpaper-build'
New-Item -ItemType Directory -Force -Path $generated,(Join-Path $generated 'classes'),(Join-Path $generated 'dex') | Out-Null
& (Join-Path $JdkHome 'bin/javac.exe') -encoding UTF-8 -source 8 -target 8 -classpath $AndroidJar -d (Join-Path $generated 'classes') (Join-Path $PSScriptRoot 'WallpaperActivity.java')
if ($LASTEXITCODE) { throw 'Wallpaper Java compilation failed' }
& (Join-Path $JdkHome 'bin/jar.exe') cf (Join-Path $generated 'input.jar') -C (Join-Path $generated 'classes') .
if ($LASTEXITCODE) { throw 'Wallpaper class archive failed' }
& (Join-Path $JdkHome 'bin/java.exe') -cp (Join-Path $BuildTools 'lib/d8.jar') com.android.tools.r8.D8 --lib $AndroidJar --min-api 26 --output (Join-Path $generated 'dex') (Join-Path $generated 'input.jar')
if ($LASTEXITCODE) { throw 'Wallpaper DEX compilation failed' }
$unsigned=Join-Path $generated 'unsigned.apk'
& (Join-Path $BuildTools 'aapt.exe') package -f -M (Join-Path $PSScriptRoot 'AndroidManifest.xml') -S (Join-Path $PSScriptRoot 'res') -I $AndroidJar -F $unsigned
if ($LASTEXITCODE) { throw 'Wallpaper resources failed' }
& (Join-Path $JdkHome 'bin/jar.exe') uf $unsigned -C (Join-Path $generated 'dex') classes.dex
if ($LASTEXITCODE) { throw 'Wallpaper APK assembly failed' }
$aligned=Join-Path $generated 'aligned.apk'
& (Join-Path $BuildTools 'zipalign.exe') -f 4 $unsigned $aligned
if ($LASTEXITCODE) { throw 'Wallpaper APK alignment failed' }
if (-not (Test-Path -LiteralPath $KeyStore)) {
  & (Join-Path $JdkHome 'bin/keytool.exe') -genkeypair -keystore $KeyStore -storepass android -keypass android -alias desktop-wallpaper -dname 'CN=Local Yanjiu-scrcpy Desktop' -keyalg RSA -keysize 2048 -validity 10000
  if ($LASTEXITCODE) { throw 'Local wallpaper signing key creation failed' }
}
$output=Join-Path $desktop 'electron/resources/extra/common/desktop-wallpaper.apk'
& (Join-Path $JdkHome 'bin/java.exe') -jar (Join-Path $BuildTools 'lib/apksigner.jar') sign --ks $KeyStore --ks-key-alias desktop-wallpaper --ks-pass pass:android --key-pass pass:android --out $output $aligned
if ($LASTEXITCODE) { throw 'Wallpaper APK signing failed' }
& (Join-Path $JdkHome 'bin/java.exe') -jar (Join-Path $BuildTools 'lib/apksigner.jar') verify --verbose $output
if ($LASTEXITCODE) { throw 'Wallpaper APK signature verification failed' }
