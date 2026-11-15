package dev.yanjiu.scrcpy.notifications;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.app.Notification;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.os.*;
import android.util.Base64;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public class NotificationRelay extends NotificationListenerService {
  private volatile LocalServerSocket server;
  private final Set<LocalSocket> clients = Collections.synchronizedSet(new HashSet<LocalSocket>());
  private final NotificationWorkQueue writer = new NotificationWorkQueue();
  private volatile boolean destroyed,connected;
  private static volatile NotificationRelay instance;
  static boolean isConnected(){NotificationRelay active=instance;return active!=null&&active.connected&&!active.destroyed;}
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final Map<String,JSONObject> apps = new HashMap<>();
  private final Runnable update = () -> { if (!clients.isEmpty()) writer.execute(() -> broadcast()); };
  public synchronized void onListenerConnected() {
    if(destroyed)return;
    connected=true;instance=this;
    if(server!=null)return;
    android.util.Log.i("YanjiuNotifications","Listener connected");
    try {
      final LocalServerSocket current = new LocalServerSocket("yanjiu-notifications-v1"); server=current;
      new Thread(() -> {
        while (server==current) {
          try {
            final LocalSocket client=current.accept();
            int uid=client.getPeerCredentials().getUid();
            // Only adbd (shell/root) can consume notification contents.
            if ((uid!=2000 && uid!=0) || clients.size()>=4) { android.util.Log.w("YanjiuNotifications","Socket peer rejected uid="+uid);client.close(); continue; }
            synchronized(NotificationRelay.this) {
              if(destroyed||server!=current){close(client);break;}
              clients.add(client);
              if(!writer.execute(() -> send(client, snapshot()))){close(client);break;}
            }
            new Thread(() -> { try { while(client.getInputStream().read()!=-1) {} } catch(IOException ignored) {} finally { close(client); } },"notification-client").start();
          } catch(IOException error) { if(server==current) stopServer(); break; }
        }
      },"notification-adb").start();
    } catch(IOException error) {android.util.Log.w("YanjiuNotifications","Socket server failed",error);}
  }
  public synchronized void onNotificationPosted(StatusBarNotification notice) {
    if(destroyed||!connected||clients.isEmpty())return;
    // Preserve each immutable callback, rather than rereading only the final state.
    writer.execute(() -> {
      try {
        JSONObject item=serializeNotice(notice);
        if(item!=null)broadcastData(new JSONObject().put("type","posted").put("notice",item).toString()+"\n");
      }catch(Exception error){android.util.Log.w("YanjiuNotifications","Notification event failed",error);}
    });
  }
  public void onNotificationRemoved(StatusBarNotification notice) { schedule(); }
  private void schedule() { if(destroyed||!connected)return;handler.removeCallbacks(update); handler.postDelayed(update,16); }
  private JSONObject appInfo(String pkg) {
    JSONObject cached=apps.get(pkg); if(cached!=null)return cached;
    JSONObject info=new JSONObject();
    try {
      android.content.pm.ApplicationInfo app=getPackageManager().getApplicationInfo(pkg,0);
      info.put("appName",getPackageManager().getApplicationLabel(app).toString());
      Drawable icon=getPackageManager().getApplicationIcon(app);
      Bitmap bitmap=Bitmap.createBitmap(48,48,Bitmap.Config.ARGB_8888); Canvas canvas=new Canvas(bitmap); icon.setBounds(0,0,48,48);icon.draw(canvas);
      ByteArrayOutputStream out=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,out);bitmap.recycle();
      info.put("icon","data:image/png;base64,"+Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP));
    } catch(Exception ignored) {}
    apps.put(pkg,info);return info;
  }
  private static String text(Bundle extras,String key) { CharSequence s=extras.getCharSequence(key);return s==null?"":s.toString(); }
  private JSONObject serializeNotice(StatusBarNotification sbn)throws Exception {
        Notification n=sbn.getNotification();
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY)!=0)return null;
        String title=text(n.extras,Notification.EXTRA_TITLE), body=text(n.extras,Notification.EXTRA_BIG_TEXT);
        if(body.isEmpty())body=text(n.extras,Notification.EXTRA_TEXT);
        if(title.isEmpty()&&body.isEmpty())return null;
        JSONObject info=appInfo(sbn.getPackageName()), item=new JSONObject();
        item.put("key",sbn.getKey());item.put("packageName",sbn.getPackageName());item.put("title",title);item.put("text",body);
        item.put("appName",info.optString("appName",sbn.getPackageName()));item.put("icon",info.optString("icon"));
        item.put("postTime",sbn.getPostTime());item.put("time",sbn.getPostTime());item.put("ongoing",sbn.isOngoing());item.put("dismissible",sbn.isClearable());item.put("groupId",sbn.getGroupKey());
    return item;
  }
  private String snapshot() {
    JSONArray notices=new JSONArray();
    try {
      StatusBarNotification[] active=getActiveNotifications();
      if(active!=null)for(StatusBarNotification sbn:active) {
        JSONObject item=serializeNotice(sbn);
        if(item==null)continue;
        notices.put(item);if(notices.length()>=80)break;
      }
      return new JSONObject().put("type","snapshot").put("notices",notices).toString()+"\n";
    } catch(Exception error) { return "{\"type\":\"unavailable\"}\n"; }
  }
  private void broadcast() { broadcastData(snapshot()); }
  private void broadcastData(String data) { LocalSocket[] copy; synchronized(clients){copy=clients.toArray(new LocalSocket[0]);} for(LocalSocket c:copy)send(c,data); }
  private void send(LocalSocket client,String data) { try { client.setSoTimeout(5000);client.getOutputStream().write(data.getBytes("UTF-8"));client.getOutputStream().flush(); } catch(IOException error){close(client);} }
  private void close(LocalSocket c) { clients.remove(c);try{c.close();}catch(IOException ignored){} }
  private void stopServer() { LocalServerSocket old=server;server=null;if(old!=null)try{old.close();}catch(IOException ignored){} LocalSocket[] copy;synchronized(clients){copy=clients.toArray(new LocalSocket[0]);}for(LocalSocket c:copy)close(c); }
  public synchronized void onListenerDisconnected(){connected=false;handler.removeCallbacks(update);stopServer();}
  public synchronized void onDestroy(){destroyed=true;connected=false;if(instance==this)instance=null;handler.removeCallbacks(update);stopServer();writer.close();super.onDestroy();}
}
