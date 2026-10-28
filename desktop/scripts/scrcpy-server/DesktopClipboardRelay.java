/* SPDX-License-Identifier: Apache-2.0 */
package com.genymobile.scrcpy;

import android.os.Handler;
import android.os.Looper;
import com.genymobile.scrcpy.device.Device;
import com.genymobile.scrcpy.wrappers.ClipboardManager;
import com.genymobile.scrcpy.wrappers.ServiceManager;
import java.io.RandomAccessFile;
import java.nio.channels.FileLock;
import org.json.JSONObject;

/** One event-driven publisher per connected desktop; never polls clipboard text. */
public final class DesktopClipboardRelay {
    private static final String LOCK = "/data/local/tmp/yanjiu-desktop-clipboard.lock";
    private DesktopClipboardRelay() {}

    public static boolean isRunning() {
        try (RandomAccessFile file = new RandomAccessFile(LOCK, "rw")) {
            FileLock lock = file.getChannel().tryLock();
            if (lock == null) return true;
            lock.release();
        } catch (Exception ignored) { /* Preserve upstream sync on failure. */ }
        return false;
    }

    private static void send(JSONObject message) {
        System.out.println("DESKTOP_CLIPBOARD:" + message.toString());
        System.out.flush();
    }

    public static void main(String[] args) throws Exception {
        Looper.prepareMainLooper();
        Workarounds.apply();
        ClipboardManager manager = ServiceManager.getClipboardManager();
        if (manager == null) throw new IllegalStateException("Clipboard service unavailable");
        final Handler handler = new Handler(Looper.getMainLooper());
        Runnable publish = () -> {
            try {
                String text = Device.getClipboardText();
                if (text != null && text.getBytes("UTF-8").length <= 256 * 1024)
                    send(new JSONObject().put("text", text));
            } catch (Exception ignored) { /* Never log private clipboard content. */ }
        };
        // Shared leases allow multiple computers; process death releases the
        // lease, so normal scrcpy autosync resumes if the coordinator disappears.
        try (RandomAccessFile file = new RandomAccessFile(LOCK, "rw");
             FileLock lease = file.getChannel().lock(0, Long.MAX_VALUE, true)) {
            manager.addPrimaryClipChangedListener(() -> {
                handler.removeCallbacks(publish);
                handler.postDelayed(publish, 60);
            });
            Thread lifetime = new Thread(() -> {
                try { while (System.in.read() != -1) {} } catch (Exception ignored) {}
                System.exit(0);
            }, "clipboard-lifetime");
            lifetime.setDaemon(true);
            lifetime.start();
            send(new JSONObject().put("ready", true));
            // Do not publish the initial value: opening desktop mode must not
            // replace the PC clipboard with a stale value from the phone.
            Looper.loop();
        }
    }
}
