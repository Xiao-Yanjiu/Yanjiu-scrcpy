param([Parameter(Mandatory=$true)][string]$Helper)
$ErrorActionPreference='Stop'
$source=Get-Content -LiteralPath $Helper -Raw
$match=[regex]::Match($source,"(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if(-not $match.Success) { throw 'Native bridge C# implementation not found' }
Add-Type -TypeDefinition $match.Groups[1].Value
$first=[IntPtr]::new(101)
$second=[IntPtr]::new(202)
[DesktopWindowBridge]::Register('first',$first)
[DesktopWindowBridge]::Register('second',$second)
[DesktopWindowBridge]::SetRightBack('first',$true)
if([DesktopWindowBridge]::RouteRightClick($first,$first) -ne 'first') { throw 'Focused enabled app must use Back' }
if($null -ne [DesktopWindowBridge]::RouteRightClick($first,$second)) { throw 'Unfocused app must not intercept' }
if($null -ne [DesktopWindowBridge]::RouteRightClick($second,$second)) { throw 'Other app must preserve normal right click' }
[DesktopWindowBridge]::SetRightBack('second',$true)
if([DesktopWindowBridge]::RouteRightClick($second,$second) -ne 'second') { throw 'Each app must have an independent switch' }
[DesktopWindowBridge]::SetRightBack('first',$false)
if($null -ne [DesktopWindowBridge]::RouteRightClick($first,$first)) { throw 'Switch must change without restarting' }
if([DesktopWindowBridge]::RouteRightClick($second,$second) -ne 'second') { throw 'Changing first app must not change second app' }
[DesktopWindowBridge]::Forget('second')
if($null -ne [DesktopWindowBridge]::RouteRightClick($second,$second)) { throw 'Closed app must not intercept mouse events' }
Write-Output '{"passed":true,"checks":["focused app only","normal right click","independent per-app modes","live toggle","close cleanup"]}'
