package dev.yanjiu.scrcpy.notifications;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.content.ComponentName;
import android.net.Uri;
import android.provider.Settings;
import android.widget.*;
public class SetupActivity extends Activity {
  @Override public void onResume() {super.onResume();WakeReceiver.reconnect(this,null);}
  public void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout layout = new LinearLayout(this); layout.setOrientation(1); layout.setPadding(32,48,32,32);
    TextView text = new TextView(this); text.setText("Yanjiu-scrcpy 通知助手\n\n开启通知使用权后，通过 ADB 向连接的电脑实时同步通知。没有电脑连接时不会发送数据，不上传云端。关闭通知使用权即可停止同步。\n\n此权限可以读取通知内容，请仅连接你信任的电脑。"); text.setTextSize(18); layout.addView(text);
    Button button = new Button(this); button.setText("打开通知使用权设置"); button.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))); layout.addView(button);
    Button autoStart = new Button(this);
    autoStart.setText("打开自启动设置");
    autoStart.setOnClickListener(v -> openAutoStartSettings());
    layout.addView(autoStart);
    Button battery = new Button(this);
    battery.setText("打开电池策略设置");
    battery.setOnClickListener(v -> openBatterySettings());
    layout.addView(battery);
    setContentView(layout);
  }
  private boolean openSettings(Intent intent) {
    try {
      startActivity(intent);
      return true;
    } catch (android.content.ActivityNotFoundException | SecurityException error) {
      return false;
    }
  }
  private void openAppSettings() {
    if (!openSettings(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:" + getPackageName())))) {
      Toast.makeText(this, "请在系统设置中打开通知助手的应用设置", Toast.LENGTH_LONG).show();
    }
  }
  private void openAutoStartSettings() {
    Intent intent = new Intent().setComponent(new ComponentName(
        "com.miui.securitycenter",
        "com.miui.permcenter.autostart.AutoStartManagementActivity"));
    if (!openSettings(intent)) {
      Toast.makeText(this, "请在应用设置中允许自启动", Toast.LENGTH_LONG).show();
      openAppSettings();
    }
  }
  private void openBatterySettings() {
    Intent intent = new Intent().setComponent(new ComponentName(
        "com.miui.powerkeeper",
        "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"))
        .putExtra("package_name", getPackageName())
        .putExtra("package_label", "Yanjiu-scrcpy 通知助手");
    if (!openSettings(intent)) {
      Toast.makeText(this, "请在应用电池设置中选择无限制", Toast.LENGTH_LONG).show();
      openAppSettings();
    }
  }

}
