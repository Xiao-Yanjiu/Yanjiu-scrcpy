package dev.yanjiu.scrcpy.wallpaper;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import android.view.WindowManager;
import android.view.SurfaceControl;
import android.view.SurfaceView;
import android.view.SurfaceHolder;
/** Renders only a wallpaper surface supplied by the authorized ADB shell. */
public final class WallpaperActivity extends Activity implements SurfaceHolder.Callback {
  private SurfaceView view;
  private SurfaceControl mirror;
  private int sourceWidth=1200, sourceHeight=2670;
  private boolean ready;
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER | WindowManager.LayoutParams.FLAG_FULLSCREEN);
    getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
    view = new SurfaceView(this);
    view.setZOrderOnTop(true);
    view.getHolder().setFormat(PixelFormat.TRANSLUCENT);
    view.getHolder().addCallback(this);
    setContentView(view);
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    readMirror(getIntent());
  }
  @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); readMirror(intent); }
  private void readMirror(Intent intent) {
    SurfaceControl next = intent.getParcelableExtra("wallpaperSurface");
    if (next == null) return;
    releaseMirror(); mirror=next;
    sourceWidth=Math.max(1,intent.getIntExtra("sourceWidth",1200));
    sourceHeight=Math.max(1,intent.getIntExtra("sourceHeight",2670));
    attachMirror();
  }
  private void attachMirror() {
    if (!ready || mirror==null || !mirror.isValid()) return;
    float scale=Math.max(view.getWidth()/(float)sourceWidth,view.getHeight()/(float)sourceHeight);
    try (SurfaceControl.Transaction tx=new SurfaceControl.Transaction()) {
      tx.reparent(mirror,view.getSurfaceControl()).setLayer(mirror,10).setVisibility(mirror,true)
        .setScale(mirror,scale,scale).setPosition(mirror,(view.getWidth()-sourceWidth*scale)/2f,(view.getHeight()-sourceHeight*scale)/2f).apply();
    }
  }
  private void releaseMirror() {
    if(mirror!=null) { try(SurfaceControl.Transaction tx=new SurfaceControl.Transaction()) { tx.reparent(mirror,null).apply(); } catch(Throwable ignored) {} mirror.release(); mirror=null; }
  }
  public void surfaceCreated(SurfaceHolder holder) { ready=true; attachMirror(); }
  public void surfaceChanged(SurfaceHolder holder,int format,int width,int height) { attachMirror(); }
  public void surfaceDestroyed(SurfaceHolder holder) { ready=false; }
  @Override protected void onDestroy() { releaseMirror(); super.onDestroy(); }
}
