param([string]$Title='Desktop Bridge Test',[string]$Mode='host',[long]$Handle=0)
$ErrorActionPreference='Stop'
if($Mode -eq 'host') {
  Add-Type -AssemblyName System.Windows.Forms
  $form=[Windows.Forms.Form]::new()
  $form.Text=$Title
  $form.StartPosition='Manual'
  $form.Location=[Drawing.Point]::new(-15000,-15000)
  $form.Size=[Drawing.Size]::new(800,600)
  $form.Show()
  [Console]::WriteLine((@{pid=$PID;handle=$form.Handle.ToInt64()} | ConvertTo-Json -Compress))
  [Windows.Forms.Application]::Run($form)
  exit
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Probe {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int x,y,right,bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd,int index);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr hwnd,IntPtr region);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int x,int y,int right,int bottom);
  [DllImport("gdi32.dll")] public static extern bool PtInRegion(IntPtr region,int x,int y);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr region);
}
'@
$hwnd=[IntPtr]::new($Handle)
$rect=[Probe+Rect]::new()
[void][Probe]::GetWindowRect($hwnd,[ref]$rect)
$region=[Probe]::CreateRectRgn(0,0,1,1)
[void][Probe]::GetWindowRgn($hwnd,$region)
$result=@{parent=[Probe]::GetParent($hwnd).ToInt64();width=$rect.right-$rect.x;height=$rect.bottom-$rect.y;child=([Probe]::GetWindowLong($hwnd,-16) -band 0x40000000) -ne 0;visible=[Probe]::IsWindowVisible($hwnd);normalPoint=[Probe]::PtInRegion($region,5,5);coveredPoint=[Probe]::PtInRegion($region,90,30)}
[void][Probe]::DeleteObject($region)
[Console]::WriteLine(($result | ConvertTo-Json -Compress))
