package dev.yanjiu.scrcpy.notifications;
import android.content.*;
import android.os.*;
import android.service.notification.NotificationListenerService;
import android.util.Log;
public class WakeReceiver extends BroadcastReceiver {
  private static long lastRequest;
  static synchronized void reconnect(Context context, Runnable done) {
    if(NotificationRelay.isConnected() || SystemClock.elapsedRealtime()-lastRequest<5000) {if(done!=null)done.run();return;}
    lastRequest=SystemClock.elapsedRealtime();
    ComponentName component=new ComponentName(context,NotificationRelay.class);
    try {
      // Android may retain an enabled component without a live binding.
      // Reset only the listener's binding state, never its user-granted access.
      if(Build.VERSION.SDK_INT>=34)NotificationListenerService.requestUnbind(component);
      new Handler(Looper.getMainLooper()).postDelayed(() -> {
        try { NotificationListenerService.requestRebind(component);Log.i("YanjiuNotifications","Listener rebind requested"); }
        catch(Exception error){Log.w("YanjiuNotifications","Listener rebind failed",error);}
        finally {if(done!=null)done.run();}
      },250);
    } catch(Exception error){Log.w("YanjiuNotifications","Listener binding reset failed",error);if(done!=null)done.run();}
  }
  @Override public void onReceive(Context context, Intent intent) {
    final PendingResult pending=goAsync();
    reconnect(context,() -> {pending.setResultCode(1);pending.setResultData("rebind-requested");pending.finish();});
  }
}
