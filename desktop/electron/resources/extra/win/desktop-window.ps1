param([long]$ParentHandle,[switch]$GlassOnly)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
using System.Threading;
[ComImport,Guid("29E691FA-4567-4DCA-B319-D0F207EB6807"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ICompositorDesktopInterop { void CreateDesktopWindowTarget(IntPtr hwnd,[MarshalAs(UnmanagedType.Bool)]bool topmost,[MarshalAs(UnmanagedType.IInspectable)]out object target);void EnsureOnThread(uint id); }
[ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMirrorPropertyStore {
  void GetCount(out uint count);void GetAt(uint index,out MirrorPropertyKey key);
  void GetValue(ref MirrorPropertyKey key,out MirrorPropVariant value);
  void SetValue(ref MirrorPropertyKey key,ref MirrorPropVariant value);void Commit();
}
[StructLayout(LayoutKind.Sequential)] struct MirrorPropertyKey {public Guid format;public uint id;}
[StructLayout(LayoutKind.Explicit,Size=24)] struct MirrorPropVariant {
  [FieldOffset(0)] public ushort type;[FieldOffset(8)] public IntPtr text;
}
public static class DesktopWindowBridge {
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd,ref Guid iid,out IMirrorPropertyStore store);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr instance,string name,uint type,int width,int height,uint flags);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
  static readonly Dictionary<int,List<IntPtr>> mirrorIcons=new Dictionary<int,List<IntPtr>>();
  public static void ForgetMirrorIcons(int process) {
    List<IntPtr> icons;if(!mirrorIcons.TryGetValue(process,out icons))return;
    mirrorIcons.Remove(process);foreach(IntPtr icon in icons)DestroyIcon(icon);
  }
  public static bool MirrorIcon(int process,string title,string file) {
    IntPtr hwnd=Find(process,title);if(hwnd==IntPtr.Zero)return false;
    foreach(int size in new int[]{16,32}) {
      IntPtr icon=LoadImage(IntPtr.Zero,file,1,size,size,0x10);
      if(icon==IntPtr.Zero)throw new InvalidOperationException("Mirror icon could not be loaded");
      UIntPtr result;
      if(SendMessageTimeout(hwnd,0x80,new UIntPtr(size==16?0u:1u),icon,2,250,out result)==IntPtr.Zero){DestroyIcon(icon);throw new InvalidOperationException("Mirror icon update timed out");}
      if(!mirrorIcons.ContainsKey(process))mirrorIcons[process]=new List<IntPtr>();
      mirrorIcons[process].Add(icon);
    }
    Guid iid=new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");IMirrorPropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(hwnd,ref iid,out store));
    try {
      foreach(var item in new Dictionary<uint,string>{{5,"YanjiuScrcpy.PhoneMirror"},{3,file},{4,"手机镜像"}}) {
        MirrorPropertyKey key=new MirrorPropertyKey {format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),id=item.Key};
        MirrorPropVariant value=new MirrorPropVariant {type=31,text=Marshal.StringToCoTaskMemUni(item.Value)};
        try{store.SetValue(ref key,ref value);}finally{Marshal.FreeCoTaskMem(value.text);}
      }
      store.Commit();
    }finally{Marshal.ReleaseComObject(store);}
    return true;
  }

  [StructLayout(LayoutKind.Sequential)] struct AccentPolicy { public int state,flags,color,animation; }
  [StructLayout(LayoutKind.Sequential)] struct CompositionData { public int attribute; public IntPtr data; public int size; }
  [StructLayout(LayoutKind.Sequential)] struct BlurRegion { public uint flags; [MarshalAs(UnmanagedType.Bool)] public bool enable; public IntPtr region; [MarshalAs(UnmanagedType.Bool)] public bool transition; }
  [DllImport("user32.dll")] static extern bool SetWindowCompositionAttribute(IntPtr hwnd, ref CompositionData data);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr hwnd,IntPtr region);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd,int attribute,ref int value,int size);
  [DllImport("dwmapi.dll")] static extern int DwmEnableBlurBehindWindow(IntPtr hwnd,ref BlurRegion blur);
  [StructLayout(LayoutKind.Sequential)] public struct QueueOptions {public int size,type,apartment;}
  [DllImport("CoreMessaging.dll")] static extern int CreateDispatcherQueueController(QueueOptions options,out IntPtr controller);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr data);
  [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
  public static IntPtr GlassQueue(){IntPtr q;Marshal.ThrowExceptionForHR(CreateDispatcherQueueController(new QueueOptions {size=12,type=2,apartment=2},out q));return q;}
  public static System.Threading.Tasks.Task<string> ReadGlassLine(){return System.Threading.Tasks.Task.Factory.StartNew(()=>Console.ReadLine());}
  public static void ClearGlassBackdrop(IntPtr hwnd) {
    int none=1,enabled=1;DwmSetWindowAttribute(hwnd,38,ref none,4);DwmSetWindowAttribute(hwnd,33,ref none,4);DwmSetWindowAttribute(hwnd,17,ref enabled,4);
    AccentPolicy policy=new AccentPolicy {state=0};IntPtr ptr=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(AccentPolicy)));
    try {Marshal.StructureToPtr(policy,ptr,false);CompositionData data=new CompositionData {attribute=19,data=ptr,size=Marshal.SizeOf(typeof(AccentPolicy))};SetWindowCompositionAttribute(hwnd,ref data);}finally{Marshal.FreeHGlobal(ptr);}
    BlurRegion blur=new BlurRegion {flags=1,enable=false};DwmEnableBlurBehindWindow(hwnd,ref blur);SetWindowRgn(hwnd,IntPtr.Zero,true);
  }
  public static IntPtr GlassHost(IntPtr parent) {
    ClearGlassBackdrop(parent);IntPtr awareness=SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {IntPtr host=CreateWindowEx(0x08200020,"Static","",0x54000000,0,0,1,1,parent,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);if(host==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());EnableWindow(host,false);return host;}
    finally{SetThreadDpiAwarenessContext(awareness);}
  }
  public static object GlassTarget(object compositor,IntPtr host) {
    object target;((ICompositorDesktopInterop)compositor).CreateDesktopWindowTarget(host,false,out target);return target;
  }
  public static int[] SizeGlassHost(IntPtr parent,IntPtr host,int radius) {
    int enabled=1;DwmSetWindowAttribute(parent,17,ref enabled,4);
    IntPtr awareness=SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {Rect r;if(!GetWindowRect(parent,out r))throw new InvalidOperationException("Glass host unavailable");int w=r.right-r.x,h=r.bottom-r.y;SetWindowPos(host,new IntPtr(1),0,0,w,h,0x10);int scaleRadius=(int)Math.Round(radius*GetDpiForWindow(parent)/96.0);return new int[]{w,h,scaleRadius};}
    finally{SetThreadDpiAwarenessContext(awareness);}
  }
  static IntPtr fusionLauncher;
  static bool switcherHidden;
  static readonly object switcherGate=new object();
  static Timer switcherTimer;
  static IntPtr keyboardHook;
  static MouseProc keyboardCallback=OnKeyboard;
  static ManualResetEvent keyboardReady=new ManualResetEvent(false);
  static void FusionStyle(bool exclude) {
    if(fusionLauncher==IntPtr.Zero || !IsWindow(fusionLauncher)) return;
    exclude=exclude || !IsWindowVisible(fusionLauncher);
    int style=GetWindowLong(fusionLauncher,-20);
    int next=exclude ? ((style | 0x80) & ~(0x40000 | 0x08000000)) : ((style | 0x40000) & ~(0x80 | 0x08000000));
    if(next!=style) SetWindowLong(fusionLauncher,-20,next);
  }
  public static int PopupTaskbar(IntPtr hwnd) {
    lock(switcherGate) { fusionLauncher=hwnd; FusionStyle(switcherHidden); }
    if(keyboardHook==IntPtr.Zero) {
      PostThreadMessage(mouseThreadId,0x8002,UIntPtr.Zero,IntPtr.Zero);
      if(!keyboardReady.WaitOne(2000) || keyboardHook==IntPtr.Zero) throw new InvalidOperationException("无法初始化桌面模式 Alt+Tab 过滤");
    }
    return GetWindowLong(hwnd,-20);
  }
  [StructLayout(LayoutKind.Sequential)] struct KeyData { public uint key,scan,flags,time; public UIntPtr extra; }
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder value,int count);
  public static bool IsFusionSwitchChord(uint key,uint flags) { return (flags & 0x20)!=0 && (key==9 || key==27); }
  static IntPtr OnKeyboard(int code,IntPtr message,IntPtr data) {
    if(code>=0 && (message.ToInt32()==0x100 || message.ToInt32()==0x104)) {
      KeyData key=(KeyData)Marshal.PtrToStructure(data,typeof(KeyData));
      if(IsFusionSwitchChord(key.key,key.flags)) {
        lock(switcherGate) {
          switcherHidden=true;FusionStyle(true);
          if(switcherTimer==null) switcherTimer=new Timer(RestoreAfterSwitcher,null,250,150);
        }
      }
    }
    return CallNextHookEx(keyboardHook,code,message,data);
  }
  static void RestoreAfterSwitcher(object state) {
    if((GetAsyncKeyState(0x12) & 0x8000)!=0) return;
    StringBuilder name=new StringBuilder(160);GetClassName(GetForegroundWindow(),name,name.Capacity);
    string foreground=name.ToString();
    if(foreground=="MultitaskingViewFrame" || foreground=="TaskSwitcherWnd" || foreground=="#32771" || foreground=="XamlExplorerHostIslandWindow") return;
    lock(switcherGate) {
      switcherHidden=false;FusionStyle(false);
      if(switcherTimer!=null) { switcherTimer.Dispose();switcherTimer=null; }
    }
  }
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  delegate IntPtr MouseProc(int code,IntPtr message,IntPtr data);
  [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; }
  [StructLayout(LayoutKind.Sequential)] struct MouseData { public Point point; public uint mouseData,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public Point point; public uint reserved; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int x, y, right, bottom; }
  public struct ClipRect { public int x, y, right, bottom, radius; }
  [StructLayout(LayoutKind.Sequential)] public struct GuiInfo {
    public int size, flags; public IntPtr active, focus, capture, menu, move, caret; public Rect caretRect;
  }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int size);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetParent(IntPtr hwnd, IntPtr parent);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GuiInfo info);
  [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr hwnd, IntPtr region, bool repaint);
  [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
  [DllImport("gdi32.dll")] static extern IntPtr CreateRoundRectRgn(int left,int top,int right,int bottom,int ellipseWidth,int ellipseHeight);
  [DllImport("gdi32.dll")] static extern int OffsetRgn(IntPtr region,int x,int y);
  [DllImport("gdi32.dll")] static extern int CombineRgn(IntPtr dest, IntPtr src1, IntPtr src2, int mode);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int hook,MouseProc callback,IntPtr module,uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern int GetMessage(out Message message,IntPtr hwnd,uint min,uint max);
  [DllImport("user32.dll")] static extern bool PeekMessage(out Message message,IntPtr hwnd,uint min,uint max,uint flags);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint message,UIntPtr wParam,IntPtr lParam);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  static readonly object gate=new object();
  static readonly Dictionary<string,IntPtr> appWindows=new Dictionary<string,IntPtr>();
  static readonly HashSet<string> returnModes=new HashSet<string>();
  static Thread mouseThread;
  static uint mouseThreadId;
  static IntPtr mouseHook;
  static MouseProc mouseCallback=OnMouse;
  static bool blockedRightUp;
  static volatile bool hostEditing;
  public static bool StartMouse() {
    ManualResetEvent started=new ManualResetEvent(false);
    mouseThread=new Thread(() => {
      mouseThreadId=GetCurrentThreadId();
      mouseHook=SetWindowsHookEx(14,mouseCallback,GetModuleHandle(null),0);
      started.Set();
      Message message;
      while(GetMessage(out message,IntPtr.Zero,0,0)>0) {
        if(message.message==0x8002) { if(keyboardHook==IntPtr.Zero) keyboardHook=SetWindowsHookEx(13,keyboardCallback,GetModuleHandle(null),0);keyboardReady.Set();continue; }
        TranslateMessage(ref message); DispatchMessage(ref message);
      }
      if(mouseHook!=IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
      if(keyboardHook!=IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
    });
    mouseThread.IsBackground=true; mouseThread.Start();
    return started.WaitOne(3000) && mouseHook!=IntPtr.Zero;
  }
  public static void StopMouse() {
    lock(switcherGate) { switcherHidden=false;FusionStyle(false);if(switcherTimer!=null) {switcherTimer.Dispose();switcherTimer=null;} }
    if(mouseThreadId!=0) PostThreadMessage(mouseThreadId,0x12,UIntPtr.Zero,IntPtr.Zero);
  }
  public static void Register(string id,IntPtr hwnd) { lock(gate) { appWindows[id]=hwnd; } if(id!="__desktop_wallpaper__" && id!="__phone_mirror__" && hostEditing) EnableWindow(hwnd,false); }
  public static void Forget(string id) { lock(gate) { IntPtr hwnd;if(appWindows.TryGetValue(id,out hwnd)) rawKeyboardWindows.Remove(hwnd);appWindows.Remove(id); returnModes.Remove(id); } }
  public static void SetRightBack(string id,bool enabled) { lock(gate) { if(enabled) returnModes.Add(id); else returnModes.Remove(id); } }
  static IntPtr RegisteredAncestor(IntPtr hwnd) {
    for(int depth=0;hwnd!=IntPtr.Zero && depth<24;depth++,hwnd=GetParent(hwnd)) {
      lock(gate) { foreach(IntPtr app in appWindows.Values) if(app==hwnd) return hwnd; }
    }
    return IntPtr.Zero;
  }
  public static string RouteRightClick(IntPtr pointed,IntPtr focused) {
    pointed=RegisteredAncestor(pointed); focused=RegisteredAncestor(focused);
    if(pointed==IntPtr.Zero || pointed!=focused) return null;
    lock(gate) {
      foreach(string id in returnModes) { IntPtr hwnd; if(appWindows.TryGetValue(id,out hwnd) && hwnd==pointed) return id; }
    }
    return null;
  }
  // Never perform cross-thread focus, IME calls or pipe writes in a global hook.
  static readonly System.Collections.Concurrent.ConcurrentQueue<Action> mouseWork=new System.Collections.Concurrent.ConcurrentQueue<Action>();
  static int mouseWorker;
  static void QueueMouseWork(Action action) {
    if(mouseWork.Count>=64)return;
    mouseWork.Enqueue(action);
    if(Interlocked.CompareExchange(ref mouseWorker,1,0)!=0)return;
    ThreadPool.QueueUserWorkItem(_=>{
      do {
        Action work;
        while(mouseWork.TryDequeue(out work)) {try{work();}catch{}}
        Interlocked.Exchange(ref mouseWorker,0);
      } while(!mouseWork.IsEmpty && Interlocked.CompareExchange(ref mouseWorker,1,0)==0);
    });
  }
  static IntPtr OnMouse(int code,IntPtr message,IntPtr data) {
    if(code>=0) {
      int kind=message.ToInt32();
      if(kind==0x205 && blockedRightUp) { blockedRightUp=false; return new IntPtr(1); }
      if(kind==0x201 || kind==0x204) {
        MouseData mouse=(MouseData)Marshal.PtrToStructure(data,typeof(MouseData));
        IntPtr pointed=hostEditing ? IntPtr.Zero : RegisteredAncestor(WindowFromPoint(mouse.point));
        if(pointed!=IntPtr.Zero) {
          lock(gate) { foreach(var app in appWindows) { if(app.Value==pointed) { string appId=app.Key;QueueMouseWork(()=>Console.WriteLine("{\"event\":\"pointer-down\",\"appId\":\""+appId+"\"}")); break; } } }
        }
        IntPtr focus=Focused();
        if(pointed!=IntPtr.Zero && GetAncestor(GetForegroundWindow(),2)==GetAncestor(pointed,2)) {
          IntPtr target=pointed;QueueMouseWork(()=>{if(GetAncestor(GetForegroundWindow(),2)==GetAncestor(target,2))FocusApp(target);});
          focus=pointed;
        }
        string id=kind==0x204 ? RouteRightClick(pointed,focus) : null;
        if(id!=null) {
          blockedRightUp=true;
          QueueMouseWork(()=>Console.WriteLine("{\"event\":\"right-back\",\"appId\":\""+id+"\"}"));
          return new IntPtr(1);
        }
      }
    }
    return CallNextHookEx(mouseHook,code,message,data);
  }
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  static Dictionary<IntPtr,int> hiddenMirrors=new Dictionary<IntPtr,int>();
  public static bool MirrorVisibility(int process,string title,bool hidden) {
    IntPtr hwnd=Find(process,title);
    if(hwnd==IntPtr.Zero)return false;
    if(hidden) {
      if(!hiddenMirrors.ContainsKey(hwnd) && IsWindowVisible(hwnd)) {
        hiddenMirrors[hwnd]=IsIconic(hwnd)?7:4;
        ShowWindow(hwnd,0);
      }
    } else {
      int mode;
      if(hiddenMirrors.TryGetValue(hwnd,out mode)) {
        hiddenMirrors.Remove(hwnd);
        ShowWindow(hwnd,mode);
      }
    }
    return true;
  }
  [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr hwnd,int index,IntPtr value);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd,uint command);
  static readonly Dictionary<IntPtr,Rect> mirrorBounds=new Dictionary<IntPtr,Rect>();
  [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr hwnd,uint color,byte alpha,uint flags);
  public static bool MirrorTransition(int process,string title,bool opening,int x,int y) {
    IntPtr hwnd=Find(process,title);Rect bounds;
    if(hwnd==IntPtr.Zero || !mirrorBounds.TryGetValue(hwnd,out bounds)) return false;
    int style=GetWindowLong(hwnd,-20);SetWindowLong(hwnd,-20,style|0x80000);
    int width=bounds.right-bounds.x,height=bounds.bottom-bounds.y;
    int endX=x-width/2,endY=y-height/2;
    try {
      SetLayeredWindowAttributes(hwnd,0,0,2);
      if(IsIconic(hwnd))ShowWindow(hwnd,9);
      SetWindowPos(hwnd,IntPtr.Zero,opening?endX:bounds.x,opening?endY:bounds.y,width,height,0x14);
      ShowWindow(hwnd,4);
      if(opening)FocusExternal(process,title);
      var watch=System.Diagnostics.Stopwatch.StartNew();
      while(IsWindow(hwnd)) {
        double t=Math.Min(1,watch.Elapsed.TotalMilliseconds/240.0);
        double eased=1-Math.Pow(1-t,3),distance=opening?1-eased:eased;
        SetWindowPos(hwnd,IntPtr.Zero,(int)Math.Round(bounds.x+(endX-bounds.x)*distance),(int)Math.Round(bounds.y+(endY-bounds.y)*distance),width,height,0x14);
        SetLayeredWindowAttributes(hwnd,0,(byte)Math.Round(255*(opening?eased:1-eased)),2);
        if(t>=1)break;Thread.Sleep(16);
      }
    } finally {
      if(IsWindow(hwnd)) {
        if(!opening)ShowWindow(hwnd,0);
        SetWindowPos(hwnd,IntPtr.Zero,bounds.x,bounds.y,width,height,0x14);
        SetLayeredWindowAttributes(hwnd,0,255,2);SetWindowLong(hwnd,-20,style);
      }
    }
    return true;
  }
  public static string MirrorFloating(int process,string title,IntPtr owner) {
    IntPtr hwnd=Find(process,title); if(hwnd==IntPtr.Zero)return "missing";
    int disable=1;DwmSetWindowAttribute(hwnd,3,ref disable,4);
    if(!IsIconic(hwnd) && IsWindowVisible(hwnd)) {Rect bounds;if(GetWindowRect(hwnd,out bounds))mirrorBounds[hwnd]=bounds;}
    // A normal unowned app window participates in Alt+Tab.
    int style=GetWindowLong(hwnd,-20); int next=(style&~0x80)|0x40000;
    if(style!=next || GetWindow(hwnd,4)!=IntPtr.Zero) {
      SetWindowLong(hwnd,-20,next);
      SetWindowLongPtr(hwnd,-8,IntPtr.Zero);
      SetWindowPos(hwnd,IntPtr.Zero,0,0,0,0,0x20|0x10|0x4|0x2|0x1);
    }
    if(IsIconic(hwnd)) return "minimized";
    return IsWindowVisible(hwnd)?"visible":"hidden";
  }
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out int value,int size);
  public static bool FullyCovered(IntPtr hwnd) {
    if(!IsWindowVisible(hwnd)||IsIconic(hwnd)||GetForegroundWindow()==hwnd)return false;
    Rect r;if(!GetWindowRect(hwnd,out r))return false;
    IntPtr remaining=CreateRectRgn(r.x,r.y,r.right,r.bottom);
    try {
      for(IntPtr above=GetWindow(hwnd,3);above!=IntPtr.Zero;above=GetWindow(above,3)) {
        int cloaked;DwmGetWindowAttribute(above,14,out cloaked,4);
        if(!IsWindowVisible(above)||IsIconic(above)||cloaked!=0||(GetWindowLong(above,-20)&(0x80000|0x20))!=0)continue;
        Rect cover;if(!GetWindowRect(above,out cover))continue;
        IntPtr region=CreateRectRgn(0,0,0,0);
        try {
          if(GetWindowRgn(above,region)<=1) {DeleteObject(region);region=CreateRectRgn(cover.x,cover.y,cover.right,cover.bottom);}
          else OffsetRgn(region,cover.x,cover.y);
          if(CombineRgn(remaining,remaining,region,4)==1)return true;
        }finally{DeleteObject(region);}
      }
      return false;
    }finally{DeleteObject(remaining);}
  }
  public static bool PopupTray(IntPtr hwnd) {
    int style=GetWindowLong(hwnd,-20);SetWindowLong(hwnd,-20,(style|0x80)&~0x40000);return true;
  }
  public static bool FocusExternal(int process,string title) {
    IntPtr hwnd=Find(process,title);if(hwnd==IntPtr.Zero)return false;
    if(IsIconic(hwnd))ShowWindow(hwnd,9);else ShowWindow(hwnd,5);
    Message pending;PeekMessage(out pending,IntPtr.Zero,0,0,0);
    uint pid,own=GetCurrentThreadId(),target=GetWindowThreadProcessId(hwnd,out pid);
    uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out pid);
    bool fg=foreground!=0 && own!=foreground && AttachThreadInput(own,foreground,true);
    bool appThread=target!=0 && own!=target && foreground!=target && AttachThreadInput(own,target,true);
    try {
      SetWindowPos(hwnd,IntPtr.Zero,0,0,0,0,0x3);
      SetForegroundWindow(hwnd);SetFocus(hwnd);
      return GetForegroundWindow()==hwnd;
    } finally {
      if(appThread)AttachThreadInput(own,target,false);
      if(fg)AttachThreadInput(own,foreground,false);
    }
  }
  public static IntPtr Find(int process,string title) {
    IntPtr result=IntPtr.Zero;
    EnumWindows((hwnd, state) => { uint pid; GetWindowThreadProcessId(hwnd, out pid);
      if(pid==(uint)process) { StringBuilder text=new StringBuilder(512); GetWindowText(hwnd,text,text.Capacity);
        if(text.ToString()==title) { result=hwnd; return false; } } return true; }, IntPtr.Zero);
    return result;
  }
  public static IntPtr Attach(int process, string title, IntPtr parent) {
    IntPtr hwnd=Find(process,title); if(hwnd==IntPtr.Zero) return hwnd;
    ShowWindow(hwnd,0);
    int style=GetWindowLong(hwnd,-16);
    style=(style & ~unchecked((int)0x80C40000)) | 0x40000000 | 0x04000000;
    SetWindowLong(hwnd,-16,style);
    SetParent(hwnd,parent);
    if(GetParent(hwnd)!=parent) throw new Exception("Windows rejected the embedded app window");
    SetWindowPos(hwnd,IntPtr.Zero,0,0,1,1,0x20|0x10);
    return hwnd;
  }
  [DllImport("user32.dll")] static extern bool EnableWindow(IntPtr hwnd,bool enabled);
  public static void Background(IntPtr hwnd) { EnableWindow(hwnd,false); }
  public static void HostInput(bool active) {
    List<IntPtr> windows=new List<IntPtr>();
    lock(gate) {
      hostEditing=active;
      foreach(var pair in appWindows) if(pair.Key!="__desktop_wallpaper__" && pair.Key!="__phone_mirror__") windows.Add(pair.Value);
    }
    // EnableWindow can synchronously call the SDL thread; never hold the mouse-hook lock here.
    foreach(IntPtr hwnd in windows) if(IsWindow(hwnd)) EnableWindow(hwnd,!active);
  }
  static readonly Dictionary<string,IntPtr> roundRegions=new Dictionary<string,IntPtr>();
  static readonly Queue<string> roundRegionOrder=new Queue<string>();
  static IntPtr RoundedRegion(int x,int y,int w,int h,int radius) {
    if(w<=0 || h<=0) return CreateRectRgn(0,0,0,0);
    radius=Math.Max(0,Math.Min(radius,Math.Min(w,h)/2));
    if(radius==0) return CreateRectRgn(x,y,x+w,y+h);
    string key=w+":"+h+":"+radius; IntPtr shape;
    if(!roundRegions.TryGetValue(key,out shape)) {
      shape=CreateRectRgn(0,radius,w,h-radius);
      // Sample pixel centres and mirror each row: all four corners share one
      // circle and exclusive right/bottom bounds, without GDI's extra edge pixel.
      for(int row=0;row<radius;row++) {
        double dy=radius-row-0.5;
        int inset=(int)Math.Ceiling(radius-Math.Sqrt(radius*radius-dy*dy)-0.5);
        inset=Math.Max(0,inset);
        IntPtr top=CreateRectRgn(inset,row,w-inset,row+1);
        IntPtr bottom=CreateRectRgn(inset,h-row-1,w-inset,h-row);
        CombineRgn(shape,shape,top,2); CombineRgn(shape,shape,bottom,2);
        DeleteObject(top); DeleteObject(bottom);
      }
      if(roundRegions.Count>=96) {string old=roundRegionOrder.Dequeue();DeleteObject(roundRegions[old]);roundRegions.Remove(old);}
      roundRegions.Add(key,shape);roundRegionOrder.Enqueue(key);
    }
    IntPtr region=CreateRectRgn(0,0,0,0);CombineRgn(region,shape,IntPtr.Zero,5);
    if(x!=0 || y!=0) OffsetRgn(region,x,y);
    return region;
  }
  public static void Layout(IntPtr hwnd,int x,int y,int w,int h,bool visible,ClipRect[] clips,int radius=0) {
    if(!IsWindow(hwnd)) return;
    if(!visible || w<2 || h<2) { ShowWindow(hwnd,0); return; }
    IntPtr region=RoundedRegion(0,0,w,h,radius);
    foreach(ClipRect clip in clips) {
      IntPtr cut=RoundedRegion(clip.x-x,clip.y-y,clip.right-clip.x,clip.bottom-clip.y,clip.radius);
      CombineRgn(region,region,cut,4); DeleteObject(cut);
    }
    if(SetWindowRgn(hwnd,region,true)==0) DeleteObject(region);
    SetWindowPos(hwnd,IntPtr.Zero,x,y,w,h,0x10);
    ShowWindow(hwnd,4);
  }
  [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
  [DllImport("imm32.dll")] static extern IntPtr ImmGetDefaultIMEWnd(IntPtr hwnd);
  static readonly HashSet<IntPtr> rawKeyboardWindows=new HashSet<IntPtr>();
  public static void RawKeyboard(IntPtr hwnd,bool enabled) { lock(gate) { if(enabled) rawKeyboardWindows.Add(hwnd);else rawKeyboardWindows.Remove(hwnd); } }
  static void CloseHostIme(IntPtr hwnd) {
    lock(gate) { if(!rawKeyboardWindows.Contains(hwnd)) return; }
    IntPtr ime=ImmGetDefaultIMEWnd(hwnd);
    if(ime!=IntPtr.Zero) { UIntPtr result;SendMessageTimeout(ime,0x283,new UIntPtr(6),IntPtr.Zero,2,30,out result); }
  }
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint message,UIntPtr wParam,IntPtr lParam,uint flags,uint timeout,out UIntPtr result);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from,uint to,bool attach);
  [DllImport("user32.dll")] static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
  [DllImport("user32.dll")] static extern int GetKeyboardLayoutList(int count,[Out] IntPtr[] layouts);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr wParam,IntPtr lParam);
  static IntPtr lastInputFocus;
  public static bool FocusRegistered(string id) {
    IntPtr hwnd;
    lock(gate) { if(!appWindows.TryGetValue(id,out hwnd)) return false; }
    if(hostEditing || !IsWindowEnabled(hwnd) || !IsWindow(hwnd) || GetAncestor(GetForegroundWindow(),2)!=GetAncestor(hwnd,2)) return false;
    FocusApp(hwnd); lastInputFocus=hwnd;
    return RegisteredAncestor(Focused())==hwnd;
  }
  [DllImport("user32.dll")] static extern short GetKeyState(int key);
  [DllImport("user32.dll")] static extern bool SetKeyboardState(byte[] state);
  static void FocusApp(IntPtr hwnd) {
    if(hostEditing || !IsWindowEnabled(hwnd)) return;
    CloseHostIme(hwnd);
    if(RegisteredAncestor(Focused())==hwnd) return;
    Message pending; PeekMessage(out pending,IntPtr.Zero,0,0,0);
    uint pid; uint target=GetWindowThreadProcessId(hwnd,out pid);
    uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out pid);
    uint own=GetCurrentThreadId();
    byte[] keys=new byte[256];
    for(int key=0;key<256;key++) keys[key]=(byte)(((GetAsyncKeyState(key)&0x8000)!=0?0x80:0)|(GetKeyState(key)&1));
    bool foregroundAttached=own!=foreground && AttachThreadInput(own,foreground,true);
    bool targetAttached=own!=target && foreground!=target && AttachThreadInput(own,target,true);
    try {
      // AttachThreadInput clears the shared keyboard state. Preserve modifier/toggle state.
      SetKeyboardState(keys);
      SetFocus(hwnd);
    } finally {
      if(targetAttached) AttachThreadInput(own,target,false);
      if(foregroundAttached) AttachThreadInput(own,foreground,false);
    }
  }
  public static IntPtr Focused() {
    GuiInfo info=new GuiInfo(); info.size=Marshal.SizeOf(typeof(GuiInfo));
    return GetGUIThreadInfo(0,ref info) ? info.focus : IntPtr.Zero;
  }
}
'@
$parent=[IntPtr]::new($ParentHandle)
if($GlassOnly) {
  Add-Type -Path (Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'System.Numerics.Vectors.dll')
  Add-Type -AssemblyName System.Windows.Forms
  $queue=[DesktopWindowBridge]::GlassQueue()
  $compositor=[Windows.UI.Composition.Compositor,Windows.UI.Composition,ContentType=WindowsRuntime]::new()
  $scenes=@{}
  [Console]::WriteLine('{"ready":true}')
  while($true) {
    $read=[DesktopWindowBridge]::ReadGlassLine()
    while(-not $read.IsCompleted){[Windows.Forms.Application]::DoEvents();[Threading.Thread]::Sleep(8)}
    $line=$read.Result
    if($null -eq $line){break}
    $request=$null
    try {
      $request=$line|ConvertFrom-Json
      $key=[string]$request.hwnd
      $hwnd=[IntPtr]::new([long]$key)
      if($request.command -eq 'forget') {
        if($scenes.ContainsKey($key)){$null=[DesktopWindowBridge]::DestroyWindow($scenes[$key].host);$scenes.Remove($key)}
        $result=$true
      } elseif($request.command -eq 'inspect') {
        $scene=$scenes[$key]
        $result=@{clip=$scene.sprite.Clip.GetType().FullName;brush=$scene.sprite.Brush.GetType().FullName;radius=$scene.geometry.CornerRadius.X;width=$scene.sprite.Size.X;height=$scene.sprite.Size.Y;opacity=$scene.sprite.Opacity;interactive=[DesktopWindowBridge]::IsWindowEnabled($scene.host)}
      } else {
        if(-not [DesktopWindowBridge]::IsWindow($hwnd)){throw 'Glass window closed'}
        if(-not $scenes.ContainsKey($key)) {
          $hostWindow=[DesktopWindowBridge]::GlassHost($hwnd)
          $target=[Windows.UI.Composition.Desktop.DesktopWindowTarget,Windows.UI.Composition,ContentType=WindowsRuntime][DesktopWindowBridge]::GlassTarget($compositor,$hostWindow)
          $sprite=$compositor.CreateSpriteVisual()
          $sprite.Brush=$compositor.CreateHostBackdropBrush()
          $geometry=$compositor.CreateRoundedRectangleGeometry()
          $sprite.Clip=$compositor.CreateGeometricClip($geometry)
          $target.Root=$sprite
          $scenes[$key]=@{host=$hostWindow;target=$target;sprite=$sprite;geometry=$geometry}
        }
        $scene=$scenes[$key]
        # Reuse the live backdrop brush; replacing it on each show causes a flash.
        $opacity=if($null -ne $request.opacity){[double]$request.opacity}else{0.78}
        $scene.sprite.Opacity=[single][Math]::Max(0.2,[Math]::Min(1.0,$opacity))
        $size=[DesktopWindowBridge]::SizeGlassHost($hwnd,$scene.host,[int]$request.radius)
        $scene.sprite.Size=[System.Numerics.Vector2]::new($size[0],$size[1])
        $scene.geometry.Size=$scene.sprite.Size
        $scene.geometry.CornerRadius=[System.Numerics.Vector2]::new($size[2],$size[2])
        [Windows.Forms.Application]::DoEvents()
        $result=$true
      }
      [Console]::WriteLine((@{id=$request.id;result=$result}|ConvertTo-Json -Compress -Depth 5))
    } catch {[Console]::WriteLine((@{id=$request.id;error=$_.Exception.Message}|ConvertTo-Json -Compress))}
  }
  foreach($scene in $scenes.Values){$null=[DesktopWindowBridge]::DestroyWindow($scene.host)}
  exit
}
$handles=@{}
$mouseAvailable=[DesktopWindowBridge]::StartMouse()
[Console]::WriteLine((@{ready=$true;mouseAvailable=$mouseAvailable} | ConvertTo-Json -Compress))
while ($null -ne ($line=[Console]::ReadLine())) {
  $request=$null
  try {
    $request=$line | ConvertFrom-Json
    $result=$null
    switch ($request.command) {
      'register-external' {
        $hwnd=[DesktopWindowBridge]::Find([int]$request.pid,[string]$request.title)
        $result=$hwnd -ne [IntPtr]::Zero
        if($result) {
          $handles[[string]$request.appId]=$hwnd
          [DesktopWindowBridge]::Register([string]$request.appId,$hwnd)
          [DesktopWindowBridge]::RawKeyboard($hwnd,([string]$request.keyboard -eq 'uhid'))
        }
      }
      'attach' {
        $hwnd=[DesktopWindowBridge]::Attach([int]$request.pid,[string]$request.title,$parent)
        if($hwnd -ne [IntPtr]::Zero) {
          $handles[[string]$request.appId]=$hwnd
          [DesktopWindowBridge]::Register([string]$request.appId,$hwnd)
          [DesktopWindowBridge]::RawKeyboard($hwnd,([string]$request.keyboard -eq 'uhid'))
          $result=$true
        } else { $result=$false }
      }
      'sync' {
        foreach($item in $request.windows) {
          $hwnd=$handles[[string]$item.id]
          if($null -eq $hwnd) { continue }
          $clips=[System.Collections.Generic.List[DesktopWindowBridge+ClipRect]]::new()
          foreach($clip in $item.clips) {
            $rect=[DesktopWindowBridge+ClipRect]::new()
            $rect.x=[int]$clip.x; $rect.y=[int]$clip.y
            $rect.right=[int]($clip.x+$clip.width); $rect.bottom=[int]($clip.y+$clip.height)
            $rect.radius=[int]$clip.radius
            $clips.Add($rect)
          }
          [DesktopWindowBridge]::Layout($hwnd,[int]$item.x,[int]$item.y,[int]$item.width,[int]$item.height,[bool]$item.visible,$clips.ToArray(),[int]$item.radius)
        }
        $result=$true
      }
      'forget' { $handles.Remove([string]$request.appId); [DesktopWindowBridge]::Forget([string]$request.appId); $result=$true }
      'focus' { $result=[DesktopWindowBridge]::FocusRegistered([string]$request.appId) }
      'right-button' { [DesktopWindowBridge]::SetRightBack([string]$request.appId,[bool]$request.enabled); $result=$true }
      'host-input' { [DesktopWindowBridge]::HostInput([bool]$request.active); $result=$true }
      'background' { [DesktopWindowBridge]::Background($handles[[string]$request.appId]); $result=$true }
      'popup-taskbar' {
        $style=[DesktopWindowBridge]::PopupTaskbar([IntPtr]$ParentHandle)
        $result=@{toolWindow=($style -band 0x80) -ne 0;appWindow=($style -band 0x40000) -ne 0;taskbarRegistered=($style -band 0x40000) -ne 0}
      }
      'mirror-visibility' { $result=[DesktopWindowBridge]::MirrorVisibility([int]$request.pid,[string]$request.title,[bool]$request.hidden) }
      'popup-tray' { $result=[DesktopWindowBridge]::PopupTray($parent) }
      'mirror-icon-release' { [DesktopWindowBridge]::ForgetMirrorIcons([int]$request.pid); $result=$true }
      'mirror-icon' { $result=[DesktopWindowBridge]::MirrorIcon([int]$request.pid,[string]$request.title,[string]$request.icon) }
      'mirror-floating' { $result=[DesktopWindowBridge]::MirrorFloating([int]$request.pid,[string]$request.title,$parent) }
      'mirror-transition' { $result=[DesktopWindowBridge]::MirrorTransition([int]$request.pid,[string]$request.title,[bool]$request.opening,[int]$request.x,[int]$request.y) }
      'mirror-covered' { $hwnd=[DesktopWindowBridge]::Find([int]$request.pid,[string]$request.title); $result=($hwnd -ne [IntPtr]::Zero -and [DesktopWindowBridge]::FullyCovered($hwnd)) }
      'mirror-focus' { $result=[DesktopWindowBridge]::FocusExternal([int]$request.pid,[string]$request.title) }
      'fusion-anchor' {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        $root=[System.Windows.Automation.AutomationElement]::RootElement
        $bars=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.OrCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty,'Shell_TrayWnd'),[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty,'Shell_SecondaryTrayWnd')))
        $result=$null
        foreach($taskbar in $bars) {
          $buttons=$taskbar.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
          foreach($button in $buttons) {
            try {
              $current=$button.Current
              if($current.AutomationId -like '*FusionLauncher*' -or $current.Name -like '*桌面模式*') {
                $r=$current.BoundingRectangle
                if(-not $r.IsEmpty -and $r.Width -gt 0 -and $r.Height -gt 0){$result=@{x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height};break}
              }
            } catch {}
          }
          if($null -ne $result){break}
        }
      }
      'covered' { $result=[DesktopWindowBridge]::FullyCovered($parent) }
      'active' {
        $focused=[DesktopWindowBridge]::Focused(); $result=''
        foreach($key in $handles.Keys) { if($handles[$key] -eq $focused) { $result=$key; break } }
      }
      default { throw 'Unknown desktop bridge command' }
    }
    [Console]::WriteLine((@{id=$request.id;result=$result} | ConvertTo-Json -Compress -Depth 12))
  } catch {
    [Console]::WriteLine((@{id=$request.id;error=$_.Exception.Message} | ConvertTo-Json -Compress))
  }
}
[DesktopWindowBridge]::StopMouse()

