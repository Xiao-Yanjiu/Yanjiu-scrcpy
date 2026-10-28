package dev.yanjiu.scrcpy.desktop;

import android.app.WallpaperManager;
import android.media.AudioManager;
import android.provider.Settings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.BitmapFactory;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.os.ParcelFileDescriptor;
import android.os.Bundle;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.List;

/** Runs as the ADB shell user; no APK, account or background service is installed. */
public final class Agent {
    private static Context cachedContext;
    private static final java.util.Map<String,Boolean> floatingActivities = new java.util.HashMap<String,Boolean>();
    private static synchronized Context context() throws Exception {
        if (cachedContext != null) return cachedContext;
        android.os.Looper.prepareMainLooper();
        Class<?> cls = Class.forName("android.app.ActivityThread");
        Object thread = cls.getMethod("systemMain").invoke(null);
        Context system = (Context) cls.getMethod("getSystemContext").invoke(thread);
        cachedContext = system.createPackageContext("com.android.shell", Context.CONTEXT_IGNORE_SECURITY);
        return cachedContext;
    }

    private static String image(Drawable drawable, int width, int height, boolean jpeg) throws Exception {
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        drawable.setBounds(0, 0, width, height);
        drawable.draw(canvas);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bitmap.compress(jpeg ? Bitmap.CompressFormat.JPEG : Bitmap.CompressFormat.PNG, 86, bytes);
        bitmap.recycle();
        return "data:image/" + (jpeg ? "jpeg" : "png") + ";base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    }

    private static volatile boolean wallpaperRunning = true;
    private static Bitmap wallpaperBitmap() throws Exception {
        Object service = Class.forName("android.view.WindowManagerGlobal").getMethod("getWindowManagerService").invoke(null);
        Bitmap bitmap = (Bitmap) Class.forName("android.view.IWindowManager").getMethod("screenshotWallpaper").invoke(service);
        if (bitmap == null) throw new Exception("Phone wallpaper is not visible; unlock the phone and return to its home screen");
        return bitmap;
    }
    private static String wallpaperFrame(int width, int height, boolean contain) throws Exception {
        Bitmap raw = wallpaperBitmap();
        Bitmap pixels = raw;
        Bitmap target = null;
        try {
            if (raw.getConfig() == Bitmap.Config.HARDWARE) pixels = raw.copy(Bitmap.Config.ARGB_8888, false);
            int sourceWidth = pixels.getWidth(), sourceHeight = pixels.getHeight();
            int outWidth = width, outHeight = height;
            if (contain) {
                float scale = Math.min(width / (float) sourceWidth, height / (float) sourceHeight);
                outWidth = Math.max(1, Math.round(sourceWidth * scale)); outHeight = Math.max(1, Math.round(sourceHeight * scale));
            }
            float ratio = outWidth / (float) outHeight;
            int cropWidth = Math.min(sourceWidth, Math.round(sourceHeight * ratio));
            int cropHeight = Math.min(sourceHeight, Math.round(sourceWidth / ratio));
            int left = (sourceWidth - cropWidth) / 2, top = (sourceHeight - cropHeight) / 2;
            target = Bitmap.createBitmap(outWidth, outHeight, Bitmap.Config.ARGB_8888);
            new Canvas(target).drawBitmap(pixels, new android.graphics.Rect(left, top, left+cropWidth, top+cropHeight), new android.graphics.Rect(0,0,outWidth,outHeight), new android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG));
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            target.compress(Bitmap.CompressFormat.JPEG, 78, bytes);
            return "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        } finally {
            if(target!=null) target.recycle();
            if(pixels!=raw && pixels!=null) pixels.recycle();
            raw.recycle();
        }
    }
    private static void streamWallpaper(String[] args) throws Exception {
        final int fps = Math.max(1,Math.min(15,Integer.parseInt(args[1])));
        final int width = Math.max(160,Math.min(1280,Integer.parseInt(args[2])));
        final int height = Math.max(160,Math.min(720,Integer.parseInt(args[3])));
        final boolean contain = args.length>4 && "contain".equals(args[4]);
        Thread input = new Thread(() -> { try { while(System.in.read()!=-1) {} } catch(Exception ignored) {} wallpaperRunning=false; });
        input.setDaemon(true); input.start();
        boolean waiting=false;
        while(wallpaperRunning) {
            long start=System.nanoTime();
            try {
                System.out.println("DESKTOP_WALLPAPER:" + wallpaperFrame(width,height,contain));
                if(System.out.checkError()) break;
                waiting=false;
            } catch(Throwable error) {
                if(!waiting) { Throwable reason=error; while(reason.getCause()!=null) reason=reason.getCause(); System.out.println("DESKTOP_WALLPAPER_WAIT:"+new JSONObject().put("error",reason.toString()).toString()); System.out.flush(); waiting=true; }
                if(System.out.checkError()) break;
                Thread.sleep(500);
            }
            long delay = 1000/fps - (System.nanoTime()-start)/1000000;
            if(delay>0) Thread.sleep(delay);
        }
    }
    private static android.app.UiAutomation notificationAutomation(android.os.HandlerThread thread) throws Exception {
        Class<?> connectionClass = Class.forName("android.app.UiAutomationConnection");
        Object connection = connectionClass.getDeclaredConstructor().newInstance();
        java.lang.reflect.Constructor<?> constructor = android.app.UiAutomation.class.getDeclaredConstructor(android.os.Looper.class, Class.forName("android.app.IUiAutomationConnection"));
        constructor.setAccessible(true);
        android.app.UiAutomation automation = (android.app.UiAutomation) constructor.newInstance(thread.getLooper(), connection);
        android.app.UiAutomation.class.getMethod("connect", int.class).invoke(automation, 1);
        android.accessibilityservice.AccessibilityServiceInfo info = automation.getServiceInfo();
        info.flags |= android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS | android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS | android.accessibilityservice.AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
        automation.setServiceInfo(info);
        return automation;
    }
    private static void findNotificationText(android.view.accessibility.AccessibilityNodeInfo node, String title, java.util.List<android.view.accessibility.AccessibilityNodeInfo> matches, int depth) {
        if(node==null || title.length()==0 || depth>35) return;
        CharSequence text=node.getText(), description=node.getContentDescription();
        if((text!=null && text.toString().contains(title)) || (description!=null && description.toString().contains(title))) matches.add(node);
        for(int i=0;i<node.getChildCount();i++) findNotificationText(node.getChild(i),title,matches,depth+1);
    }
    private static android.view.accessibility.AccessibilityNodeInfo findNotificationNode(android.view.accessibility.AccessibilityNodeInfo root, String title, boolean dismiss) {
        if (root == null || title.length() == 0) return null;
        java.util.List<android.view.accessibility.AccessibilityNodeInfo> matches = new java.util.ArrayList<>();
        findNotificationText(root,title,matches,0);
        for (android.view.accessibility.AccessibilityNodeInfo match : matches) {
            CharSequence text = match.getText();
            CharSequence description = match.getContentDescription();
            if ((text == null || !text.toString().contains(title)) && (description == null || !description.toString().contains(title))) continue;
            android.view.accessibility.AccessibilityNodeInfo node = match;
            for (int depth = 0; node != null && depth < 12; depth++, node = node.getParent()) {
                if (dismiss) {
                    for (android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction action : node.getActionList()) if (action.getId() == android.view.accessibility.AccessibilityNodeInfo.ACTION_DISMISS) return node;
                } else if (node.isClickable()) return node;
            }
        }
        return null;
    }
    private static android.view.accessibility.AccessibilityNodeInfo clearNotificationsNode(android.view.accessibility.AccessibilityNodeInfo node) {
        if (node == null) return null;
        String id = node.getViewIdResourceName();
        String text = node.getText() == null ? "" : node.getText().toString();
        String description = node.getContentDescription() == null ? "" : node.getContentDescription().toString();
        boolean clear = (id != null && (id.endsWith(":id/clear_all") || id.endsWith(":id/dismiss_view") || id.endsWith(":id/clear_all_button") || id.endsWith(":id/notification_dismiss_view"))) || text.matches("清空|清除全部|全部清除|清除所有通知|Clear all") || description.matches("清除全部通知|清除所有通知|Clear all notifications");
        if (clear && node.isClickable()) return node;
        for (int i = 0; i < node.getChildCount(); i++) { android.view.accessibility.AccessibilityNodeInfo found = clearNotificationsNode(node.getChild(i)); if (found != null) return found; }
        return null;
    }
    private static boolean scrollNotifications(android.view.accessibility.AccessibilityNodeInfo node) {
        if (node == null) return false;
        String id = node.getViewIdResourceName();
        if (node.isScrollable() && id != null && (id.contains("notification") || id.contains("scroller"))) return node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);
        for (int i = 0; i < node.getChildCount(); i++) if (scrollNotifications(node.getChild(i))) return true;
        return false;
    }
    private static JSONObject focusedNotificationTask(int displayId) throws Exception {
        Class<?> cls = Class.forName("android.app.ActivityTaskManager");
        Object service = cls.getMethod("getService").invoke(null);
        Class<?> api = Class.forName("android.app.IActivityTaskManager");
        Object task = api.getMethod("getFocusedRootTaskInfo").invoke(service);
        JSONObject result = new JSONObject();
        if (task == null) return result;
        int taskId = task.getClass().getField("taskId").getInt(task);
        android.content.ComponentName component = (android.content.ComponentName) task.getClass().getField("topActivity").get(task);
        if (component != null) result.put("packageName", component.getPackageName());
        result.put("taskId", taskId);
        if (displayId > 0) { api.getMethod("moveRootTaskToDisplay", int.class, int.class).invoke(service, taskId, displayId); result.put("attached", true); }
        return result;
    }
    private static int notificationNodeCount(android.view.accessibility.AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 35) return 0;
        int count = 1;
        for (int i=0;i<node.getChildCount() && count<2000;i++) count += notificationNodeCount(node.getChild(i),depth+1);
        return count;
    }
    private static android.view.accessibility.AccessibilityNodeInfo notificationRoot(android.app.UiAutomation automation) {
        android.view.accessibility.AccessibilityNodeInfo best = null;
        long size = 0;
        java.util.List<android.view.accessibility.AccessibilityWindowInfo> windows;
        try { windows = automation.getWindowsOnAllDisplays().get(0); } catch (NoSuchMethodError oldAndroid) { windows = automation.getWindows(); }
        if (windows != null) for (android.view.accessibility.AccessibilityWindowInfo window : windows) {
            android.view.accessibility.AccessibilityNodeInfo root = window.getRoot();
            if (root == null || root.getPackageName() == null || !root.getPackageName().toString().equals("com.android.systemui")) continue;
            long area = notificationNodeCount(root,0);
            if (area > size) { size = area; best = root; }
        }
        return best != null ? best : automation.getRootInActiveWindow();
    }
    private static boolean expandNotificationGroups(android.view.accessibility.AccessibilityNodeInfo node) {
        if (node == null) return false;
        for (int i=0;i<node.getChildCount();i++) {
            android.view.accessibility.AccessibilityNodeInfo child=node.getChild(i);
            if (child!=null && "com.android.systemui:id/notification_children_container".equals(child.getViewIdResourceName())) {
                for (android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction action : node.getActionList()) if (action.getId()==android.view.accessibility.AccessibilityNodeInfo.ACTION_EXPAND) return node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_EXPAND);
            }
        }
        for (int i=0;i<node.getChildCount();i++) if (expandNotificationGroups(node.getChild(i))) return true;
        return false;
    }
    private static JSONObject notificationUi(JSONObject request) throws Exception {
        android.os.HandlerThread thread = new android.os.HandlerThread("desktop-notifications"); thread.start();
        android.app.UiAutomation automation = null;
        boolean expanded = false;
        try {
            automation = notificationAutomation(thread);
            String action = request.optString("action");
            Runtime.getRuntime().exec(new String[]{"cmd", "statusbar", "expand-notifications"}).waitFor(); expanded = true;
            Thread.sleep(350);
            if (!"open".equals(action) && !"dismiss".equals(action) && !"clear".equals(action)) throw new Exception("通知操作无效");
            for (int attempt = 0; attempt < 7; attempt++) {
                android.view.accessibility.AccessibilityNodeInfo root = notificationRoot(automation);
                if (!"clear".equals(action) && expandNotificationGroups(root)) { Thread.sleep(180); continue; }
                android.view.accessibility.AccessibilityNodeInfo node = "clear".equals(action) ? clearNotificationsNode(root) : findNotificationNode(root, request.optString("text"), "dismiss".equals(action));
                if (node == null && !"clear".equals(action)) node = findNotificationNode(root, request.optString("title"), "dismiss".equals(action));
                if (node != null) {
                    boolean success = node.performAction("dismiss".equals(action) ? android.view.accessibility.AccessibilityNodeInfo.ACTION_DISMISS : android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
                    if (!success) throw new Exception("手机系统未执行这条通知的操作");
                    if ("open".equals(action)) { Thread.sleep(400); try { return focusedNotificationTask(request.optInt("displayId", 0)).put("success", true); } catch (Throwable ignored) { return new JSONObject().put("success", true); } }
                    return new JSONObject().put("success", true);
                }
                if (root != null && attempt == 0 && !"clear".equals(action)) {
                    android.view.accessibility.AccessibilityNodeInfo group = findNotificationNode(root, request.optString("appName"), false);
                    if (group != null) group.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
                } else scrollNotifications(root);
                Thread.sleep(180);
            }
            throw new Exception("clear".equals(request.optString("action")) ? "手机当前没有可清除的通知" : "通知已变化、被折叠或不允许此操作，请刷新后再试");
        } finally {
            if (expanded) { try { Runtime.getRuntime().exec(new String[]{"cmd", "statusbar", "collapse"}).waitFor(); } catch (Throwable ignored) {} }
            if (automation != null) { try { android.app.UiAutomation.class.getMethod("disconnect").invoke(automation); } catch (Throwable ignored) {} }
            thread.quitSafely();
        }
    }
    private static JSONObject taskSnapshot() throws Exception {
        Object service = Class.forName("android.app.ActivityTaskManager").getMethod("getService").invoke(null);
        List<?> tasks = (List<?>) Class.forName("android.app.IActivityTaskManager").getMethod("getAllRootTaskInfos").invoke(service);
        JSONArray result = new JSONArray();
        for (Object task : tasks) {
            Class<?> type = task.getClass();
            android.content.ComponentName top = (android.content.ComponentName) type.getField("topActivity").get(task);
            if (top == null) continue;
            JSONObject item = new JSONObject().put("taskId", type.getField("taskId").getInt(task)).put("displayId", type.getField("displayId").getInt(task)).put("packageName", top.getPackageName()).put("component", top.flattenToShortString());
            android.content.ComponentName base = (android.content.ComponentName) type.getField("baseActivity").get(task);
            if (base != null) item.put("basePackage", base.getPackageName());
            String component = top.flattenToString();
            Boolean floating = floatingActivities.get(component);
            if (floating == null) {
                floating = false;
                try {
                    Context system = context();
                    android.content.pm.ActivityInfo info = system.getPackageManager().getActivityInfo(top, 0);
                    Context activity = system.createPackageContext(top.getPackageName(), Context.CONTEXT_IGNORE_SECURITY);
                    android.content.res.Resources.Theme theme = activity.getResources().newTheme();
                    theme.applyStyle(info.getThemeResource(), true);
                    android.content.res.TypedArray values = theme.obtainStyledAttributes(new int[]{android.R.attr.windowIsFloating});
                    floating = values.getBoolean(0, false); values.recycle();
                } catch (Throwable ignored) {}
                if (floatingActivities.size() >= 512) floatingActivities.clear();
                floatingActivities.put(component, floating);
            }
            item.put("floating", floating);
            try { item.put("visible", type.getField("visible").getBoolean(task)); } catch (Throwable ignored) { try { item.put("visible", type.getField("isVisible").getBoolean(task)); } catch (Throwable old) { item.put("visible", true); } }
            try { item.put("focused", type.getField("isFocused").getBoolean(task)); } catch (Throwable ignored) {}
            result.put(item);
        }
        return new JSONObject().put("tasks", result);
    }
    private static JSONObject focusDisplay(JSONObject request) throws Exception {
        int displayId = request.getInt("displayId");
        String pkg = request.getString("packageName");
        if (displayId < 0 || (displayId != 0 && !pkg.matches("[a-zA-Z0-9_.]+"))) throw new Exception("Invalid application display");
        Object service = Class.forName("android.app.ActivityTaskManager").getMethod("getService").invoke(null);
        Class<?> manager = Class.forName("android.app.IActivityTaskManager");
        List<?> tasks = (List<?>) manager.getMethod("getAllRootTaskInfos").invoke(service);
        int taskId = -1;
        for (Object task : tasks) {
            Class<?> type = task.getClass();
            android.content.ComponentName top = (android.content.ComponentName) type.getField("topActivity").get(task);
            if (type.getField("displayId").getInt(task) == displayId && top != null && (displayId == 0 || pkg.equals(top.getPackageName()))) {
                taskId = type.getField("taskId").getInt(task); break;
            }
        }
        if (taskId < 0) throw new Exception("应用任务不在指定虚拟显示器中，未修改其他应用的焦点");
        JSONObject result = new JSONObject();
        if (displayId > 0 && request.optBoolean("restoreIme")) {
            try {
                Object wm = Class.forName("android.view.WindowManagerGlobal").getMethod("getWindowManagerService").invoke(null);
                Class.forName("android.view.IWindowManager").getMethod("setDisplayImePolicy", int.class, int.class).invoke(wm, displayId, 0);
            } catch (NoSuchMethodException ignored) {
                // The scrcpy display was already created with --display-ime-policy=local.
            } catch (Throwable warning) { result.put("imeWarning", warning.toString()); }
        }
        try { manager.getMethod("focusTopTask", int.class).invoke(service, displayId); }
        catch (NoSuchMethodException legacy) { manager.getMethod("setFocusedTask", int.class).invoke(service, taskId); }
        return result.put("displayId", displayId).put("focused", true);
    }
    private static void streamTasks() throws Exception {
        final java.util.concurrent.atomic.AtomicBoolean running = new java.util.concurrent.atomic.AtomicBoolean(true);
        Thread input = new Thread(() -> {
            try {
                java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, "UTF-8"));
                String line;
                while ((line = reader.readLine()) != null) {
                    JSONObject reply = new JSONObject();
                    try {
                        JSONObject request = new JSONObject(line);
                        reply.put("id", request.getInt("id"));
                        if (!"focus-display".equals(request.optString("command"))) throw new Exception("Unknown task-channel command");
                        JSONObject focused = focusDisplay(request);
                        java.util.Iterator<String> keys = focused.keys();
                        while (keys.hasNext()) { String key = keys.next(); reply.put(key, focused.get(key)); }
                    } catch (Throwable error) {
                        while (error.getCause() != null) error = error.getCause();
                        try { reply.put("error", error.toString()); } catch (Exception ignored) {}
                    }
                    System.out.println("DESKTOP_INPUT:" + reply.toString()); System.out.flush();
                }
            } catch (Exception ignored) {}
            running.set(false);
        });
        input.setDaemon(true); input.start();
        String previous = "";
        while(running.get()) {
            String snapshot = taskSnapshot().toString();
            if (!snapshot.equals(previous)) { System.out.println("DESKTOP_TASKS:" + snapshot); System.out.flush(); previous = snapshot; }
            if (System.out.checkError()) break;
            Thread.sleep(650);
        }
    }
    private static JSONObject quickIcons(Context context, JSONArray entries) throws Exception {
        JSONObject icons = new JSONObject();
        PackageManager pm = context.getPackageManager();
        for (int i=0;i<Math.min(80,entries.length());i++) {
            JSONObject entry=entries.getJSONObject(i); String spec=entry.optString("spec");
            try {
                Drawable drawable=null;
                if (spec.startsWith("custom(") && spec.endsWith(")")) {
                    android.content.ComponentName component=android.content.ComponentName.unflattenFromString(spec.substring(7,spec.length()-1));
                    android.content.pm.ServiceInfo info=pm.getServiceInfo(component,0);
                    if (!"android.permission.BIND_QUICK_SETTINGS_TILE".equals(info.permission)) continue;
                    drawable=info.loadIcon(pm);
                } else if (entry.optInt("resourceId")!=0) {
                    drawable=context.createPackageContext("com.android.systemui",Context.CONTEXT_IGNORE_SECURITY).getDrawable(entry.getInt("resourceId"));
                }
                if(drawable!=null) icons.put(spec,image(drawable,72,72,false));
            } catch(Throwable ignored) {}
        }
        return new JSONObject().put("icons",icons);
    }
    private static String quickNodeText(android.view.accessibility.AccessibilityNodeInfo node,int depth) {
        if(node==null || depth>8 || !node.isVisibleToUser()) return "";
        String own=node.getText()==null?"":node.getText().toString();
        if(own.length()>0) return own.substring(0,Math.min(240,own.length()));
        StringBuilder out=new StringBuilder();
        for(int i=0;i<node.getChildCount()&&out.length()<240;i++) {
            String value=quickNodeText(node.getChild(i),depth+1);
            if(value.length()>0 && out.indexOf(value)<0) {if(out.length()>0)out.append(" · ");out.append(value);}
        }
        if(out.length()==0 && node.getContentDescription()!=null) out.append(node.getContentDescription());
        return out.substring(0,Math.min(240,out.length()));
    }
    private static android.view.accessibility.AccessibilityNodeInfo quickContainer(android.view.accessibility.AccessibilityNodeInfo node,int depth) {
        if(node==null || depth>30 || !node.isVisibleToUser()) return null;
        String id=node.getViewIdResourceName();
        if(id!=null && id.endsWith(":id/qs_detail_content")) {
            android.view.accessibility.AccessibilityNodeInfo parent=node.getParent(), list=null;
            for(int i=0;parent!=null && i<8;i++,parent=parent.getParent()) {
                String parentId=parent.getViewIdResourceName();
                if(parentId!=null && (parentId.endsWith(":id/scale_content")||parentId.endsWith(":id/qs_detail")||parentId.endsWith(":id/detail_panel")))return parent;
                if(parentId!=null && parentId.endsWith(":id/list"))list=parent;
            }
            if(list!=null)return list;
        }
        if(id!=null && id.matches(".*:(?:id)/(?:.*dialog.*|.*alert.*|.*qs_detail.*|.*control.*detail.*|.*bottom_sheet.*|.*parentPanel.*)")) {
            android.graphics.Rect bounds=new android.graphics.Rect();node.getBoundsInScreen(bounds);
            if(bounds.width()>80&&bounds.height()>80&&notificationNodeCount(node,0)>2)return node;
        }
        for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo found=quickContainer(node.getChild(i),depth+1);if(found!=null)return found;}
        return null;
    }
    private static String quickSourcePackage="";
    private static android.view.accessibility.AccessibilityNodeInfo quickDialogRoot(android.app.UiAutomation automation) throws Exception {
        java.util.HashSet<String> floating=new java.util.HashSet<>();
        JSONArray tasks=taskSnapshot().getJSONArray("tasks");
        for(int i=0;i<tasks.length();i++){JSONObject task=tasks.getJSONObject(i);if(task.optInt("displayId")==0&&task.optBoolean("visible")&&task.optBoolean("floating"))floating.add(task.optString("packageName"));}
        java.util.List<android.view.accessibility.AccessibilityWindowInfo> windows;
        try {windows=automation.getWindowsOnAllDisplays().get(0);}catch(NoSuchMethodError older){windows=automation.getWindows();}
        android.view.accessibility.AccessibilityNodeInfo best=null;int layer=Integer.MIN_VALUE;
        if(windows!=null)for(android.view.accessibility.AccessibilityWindowInfo window:windows){
            android.view.accessibility.AccessibilityNodeInfo root=window.getRoot();if(root==null||root.getPackageName()==null)continue;
            String pkg=root.getPackageName().toString();
            android.view.accessibility.AccessibilityNodeInfo candidate=null;
            if(floating.contains(pkg) && (pkg.equals("com.android.settings") || pkg.equals("com.android.vpndialogs") || pkg.equals("com.android.permissioncontroller") || pkg.equals("com.google.android.permissioncontroller") || pkg.equals("com.lbe.security.miui") || pkg.equals("com.miui.securitycenter")))candidate=root;
            else if(pkg.equals(quickSourcePackage)&&(floating.contains(pkg)||window.getType()==android.view.accessibility.AccessibilityWindowInfo.TYPE_SYSTEM))candidate=root;
            else if("com.android.systemui".equals(pkg))candidate=quickContainer(root,0);
            if(candidate!=null&&window.getLayer()>layer){best=candidate;layer=window.getLayer();}
        }
        return best;
    }
    private static void quickRows(android.view.accessibility.AccessibilityNodeInfo node,String path,JSONArray rows,int depth) throws Exception {
        if(node==null||depth>30||rows.length()>=100||!node.isVisibleToUser())return;
        android.graphics.Rect bounds=new android.graphics.Rect();node.getBoundsInScreen(bounds);if(bounds.isEmpty())return;
        android.view.accessibility.AccessibilityNodeInfo.RangeInfo range=node.getRangeInfo();
        String label=quickNodeText(node,0);String cls=String.valueOf(node.getClassName());
        boolean actionable=node.isClickable()||node.isCheckable()||node.isEditable()||range!=null;
        String nodeId=node.getViewIdResourceName()==null?"":node.getViewIdResourceName();
        boolean container=node.isScrollable()||cls.contains("RecyclerView")||cls.contains("ScrollView")||nodeId.endsWith(":id/content")||nodeId.endsWith(":id/scale_content")||nodeId.endsWith(":id/list")||(depth==0&&node.getChildCount()>0);
        if(!container && ((actionable&&(node.getChildCount()<7||range!=null))||(node.getText()!=null&&node.getText().length()>0))){
            JSONObject row=new JSONObject().put("path",path).put("resource",node.getViewIdResourceName()==null?"":node.getViewIdResourceName()).put("label",label).put("role",node.isEditable()?"input":range!=null?"range":node.isCheckable()?"switch":actionable?"button":"text").put("enabled",node.isEnabled()).put("checked",node.isChecked()).put("top",bounds.top).put("left",bounds.left);
            if(range!=null)row.put("min",range.getMin()).put("max",range.getMax()).put("value",range.getCurrent());
            if(label.length()>0||range!=null){rows.put(row);return;}
        }
        for(int i=0;i<node.getChildCount();i++)quickRows(node.getChild(i),path+"/"+i,rows,depth+1);
        if(node.isScrollable())for(android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction action:node.getActionList()) {
            boolean forward=action.getId()==android.view.accessibility.AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
            if(forward||action.getId()==android.view.accessibility.AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)rows.put(new JSONObject().put("path",path).put("resource",nodeId).put("label",forward?"向下查看更多":"向上查看").put("role",forward?"scroll-forward":"scroll-backward").put("enabled",true));
        }
    }
    private static JSONObject quickDialog(android.app.UiAutomation automation) throws Exception {
        android.view.accessibility.AccessibilityNodeInfo root=quickDialogRoot(automation);if(root==null)return new JSONObject();
        JSONArray rows=new JSONArray();quickRows(root,"",rows,0);if(rows.length()==0)return new JSONObject();
        String pkg=String.valueOf(root.getPackageName());
        return new JSONObject().put("dialog",new JSONObject().put("packageName",pkg).put("sourcePackage",quickSourcePackage).put("rootResource",root.getViewIdResourceName()==null?"":root.getViewIdResourceName()).put("rows",rows));
    }
    private static void quickMatches(android.view.accessibility.AccessibilityNodeInfo node,String label,List<android.view.accessibility.AccessibilityNodeInfo> matches,int depth) {
        if(node==null||depth>35)return;
        String text=node.getText()==null?"":node.getText().toString().replaceAll("\\s+"," ");
        String description=node.getContentDescription()==null?"":node.getContentDescription().toString().replaceAll("\\s+"," ");
        if(text.contains(label)||description.contains(label))matches.add(node);
        for(int i=0;i<node.getChildCount();i++)quickMatches(node.getChild(i),label,matches,depth+1);
    }
    private static android.view.accessibility.AccessibilityNodeInfo quickTile(android.app.UiAutomation automation,JSONObject request) {
        android.view.accessibility.AccessibilityNodeInfo root=notificationRoot(automation);if(root==null)return null;
        String[] labels={request.optString("label"),request.optString("description"),request.optString("fallback")};
        for(String label:labels){
            if(label.length()==0)continue;
            java.util.List<android.view.accessibility.AccessibilityNodeInfo> matches=new java.util.ArrayList<>();quickMatches(root,label.replaceAll("\\s+"," "),matches,0);
            final String exactLabel=label.replaceAll("\\s+"," ");
            java.util.Collections.sort(matches,(left,right)->{
                String lt=left.getText()==null?"":left.getText().toString().replaceAll("\\s+"," ");
                String rt=right.getText()==null?"":right.getText().toString().replaceAll("\\s+"," ");
                String ld=left.getContentDescription()==null?"":left.getContentDescription().toString().replaceAll("\\s+"," ");
                String rd=right.getContentDescription()==null?"":right.getContentDescription().toString().replaceAll("\\s+"," ");
                int ls=lt.equals(exactLabel)?0:ld.equals(exactLabel)?1:lt.startsWith(exactLabel)?2:ld.startsWith(exactLabel)?3:4;
                int rs=rt.equals(exactLabel)?0:rd.equals(exactLabel)?1:rt.startsWith(exactLabel)?2:rd.startsWith(exactLabel)?3:4;
                return Integer.compare(ls,rs);
            });
            for(android.view.accessibility.AccessibilityNodeInfo match:matches){
                android.view.accessibility.AccessibilityNodeInfo node=match;
                for(int d=0;node!=null&&d<7;d++,node=node.getParent()){
                    if(!node.isVisibleToUser())continue;
                    String id=node.getViewIdResourceName()==null?"":node.getViewIdResourceName();String cls=String.valueOf(node.getClassName());
                    if((node.isClickable()||node.isLongClickable())&&(id.contains("tile")||cls.toLowerCase().contains("tile")))return node;
                }
            }
        }
        return null;
    }
    private static JSONObject quickUi(JSONObject request) throws Exception {
        android.os.HandlerThread thread=new android.os.HandlerThread("desktop-quick-actions");thread.start();
        android.app.UiAutomation automation=null;boolean keep=false;
        try {
            JSONObject prior=request.optJSONObject("dialog");quickSourcePackage=request.optString("sourcePackage",prior==null?"":prior.optString("sourcePackage"));
            automation=notificationAutomation(thread);Thread.sleep(250);String op=request.optString("op");
            if("tile".equals(op)){
                Runtime.getRuntime().exec(new String[]{"cmd","statusbar","expand-settings"}).waitFor();Thread.sleep(250);
                android.view.accessibility.AccessibilityNodeInfo node=quickTile(automation,request);
                for(int retry=0;node==null && retry<8;retry++){Thread.sleep(150);node=quickTile(automation,request);}
                if(node==null)throw new Exception("手机系统未提供这个快捷按钮的操作节点");
                boolean longPress="long".equals(request.optString("gesture"));
                // Use an explicit display id: the desktop app may own input focus
                // on a virtual display while the native tile is on display 0.
                android.graphics.Rect rect=new android.graphics.Rect();node.getBoundsInScreen(rect);
                String x=String.valueOf(rect.centerX()), y=String.valueOf(rect.centerY());
                String[] command=longPress?new String[]{"input","-d","0","swipe",x,y,x,y,"650"}:new String[]{"input","-d","0","tap",x,y};
                if(Runtime.getRuntime().exec(command).waitFor()!=0)throw new Exception("手机拒绝了快捷按钮操作");
                Thread.sleep(550);
            }else if("node".equals(op)||"dismiss".equals(op)){
                android.view.accessibility.AccessibilityNodeInfo root=quickDialogRoot(automation);
                JSONObject dialog=request.getJSONObject("dialog");
                if(root==null||!String.valueOf(root.getPackageName()).equals(dialog.optString("packageName"))||!String.valueOf(root.getViewIdResourceName()==null?"":root.getViewIdResourceName()).equals(dialog.optString("rootResource")))throw new Exception("手机弹窗已变化，请刷新后重试");
                if("dismiss".equals(op)){Runtime.getRuntime().exec(new String[]{"input","-d","0","keyevent","4"}).waitFor();Thread.sleep(180);}
                else {
                    JSONObject row=request.getJSONObject("row");android.view.accessibility.AccessibilityNodeInfo node=root;
                    for(String part:row.optString("path").split("/")){if(part.length()==0)continue;int index=Integer.parseInt(part);node=node==null?null:node.getChild(index);}
                    if(node==null||!node.isVisibleToUser()||(!row.optString("role").startsWith("scroll-")&&!quickNodeText(node,0).equals(row.optString("label"))))throw new Exception("手机弹窗内容已变化，请刷新后重试");
                    String resource=node.getViewIdResourceName()==null?"":node.getViewIdResourceName();if(!resource.equals(row.optString("resource")))throw new Exception("手机弹窗控件已变化");
                    Bundle args=new Bundle();int action=android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK;
                    if("scroll-forward".equals(row.optString("role")))action=android.view.accessibility.AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
                    if("scroll-backward".equals(row.optString("role")))action=android.view.accessibility.AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
                    if("input".equals(row.optString("role"))){action=android.view.accessibility.AccessibilityNodeInfo.ACTION_SET_TEXT;args.putCharSequence(android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,request.optString("text"));}
                    if("range".equals(row.optString("role"))){action=android.R.id.accessibilityActionSetProgress;args.putFloat(android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_PROGRESS_VALUE,(float)request.optDouble("value"));}
                    if(!node.performAction(action,args))throw new Exception("手机未执行这个弹窗操作");Thread.sleep(220);
                }
            }else if(!"inspect".equals(op))throw new Exception("控制中心操作无效");
            JSONObject result=quickDialog(automation);keep=result.has("dialog");
            if(!keep && !"inspect".equals(op))Runtime.getRuntime().exec(new String[]{"cmd","statusbar","collapse"}).waitFor();
            return result.put("success",true);
        } finally {
            if("tile".equals(request.optString("op"))&&!keep){try{Runtime.getRuntime().exec(new String[]{"cmd","statusbar","collapse"}).waitFor();}catch(Throwable ignored){}}
            if(automation!=null){try{android.app.UiAutomation.class.getMethod("disconnect").invoke(automation);}catch(Throwable ignored){}}
            thread.quitSafely();
        }
    }

    private static JSONObject quickPhoneState(Context context,String transport) throws Exception {
        Context audioContext=new android.content.ContextWrapper(context){
            @Override public Context getApplicationContext(){return this;}
            @Override public String getPackageName(){return "com.android.shell";}
            @Override public String getOpPackageName(){return "com.android.shell";}
            @Override public android.content.AttributionSource getAttributionSource(){return new android.content.AttributionSource.Builder(android.os.Process.myUid()).setPackageName("com.android.shell").build();}
        };
        AudioManager audio=AudioManager.class.getDeclaredConstructor(Context.class).newInstance(audioContext);
        JSONObject result=new JSONObject().put("volume",Math.round(audio.getStreamVolume(AudioManager.STREAM_MUSIC)*100f/Math.max(1,audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC))));
        try {
            Class<?> cls=Class.forName("android.hardware.display.DisplayManagerGlobal");Object display=cls.getMethod("getInstance").invoke(null);
            result.put("brightness",Math.round((Float)cls.getMethod("getBrightness",int.class).invoke(display,0)*100));
        }catch(Throwable ignored){result.put("brightness",Math.round(Settings.System.getInt(context.getContentResolver(),Settings.System.SCREEN_BRIGHTNESS,128)*100f/255));}
        JSONObject media=new JSONObject().put("title","暂无播放").put("artist","").put("playing",false);
        try {
            android.os.IBinder binder=(android.os.IBinder)Class.forName("android.os.ServiceManager").getMethod("getService",String.class).invoke(null,"media_session");
            Object service=Class.forName("android.media.session.ISessionManager$Stub").getMethod("asInterface",android.os.IBinder.class).invoke(null,binder);
            List<?> tokens=(List<?>)Class.forName("android.media.session.ISessionManager").getMethod("getSessions",android.content.ComponentName.class,int.class).invoke(service,null,0);
            List<android.media.session.MediaController> sessions=new java.util.ArrayList<>();
            for(Object token:tokens)sessions.add(new android.media.session.MediaController(audioContext,(android.media.session.MediaSession.Token)token));
            android.media.session.MediaController selected=null;
            for(android.media.session.MediaController candidate:sessions){if(selected==null)selected=candidate;android.media.session.PlaybackState state=candidate.getPlaybackState();if(state!=null&&state.getState()==android.media.session.PlaybackState.STATE_PLAYING){selected=candidate;break;}}
            if(selected!=null){
                android.media.session.PlaybackState state=selected.getPlaybackState();android.media.MediaMetadata data=selected.getMetadata();
                media.put("packageName",selected.getPackageName()).put("playing",state!=null&&state.getState()==android.media.session.PlaybackState.STATE_PLAYING);
                if(data!=null){media.put("title",String.valueOf(data.getDescription().getTitle()==null?"正在播放":data.getDescription().getTitle()));media.put("artist",String.valueOf(data.getDescription().getSubtitle()==null?"":data.getDescription().getSubtitle()));}
                if(transport!=null){
                    android.media.session.MediaController.TransportControls controls=selected.getTransportControls();
                    if("previous".equals(transport))controls.skipToPrevious();else if("next".equals(transport))controls.skipToNext();else if("toggle".equals(transport)){if(media.optBoolean("playing"))controls.pause();else controls.play();}else throw new Exception("媒体操作无效");
                }
            } else if(transport!=null) throw new Exception("手机没有活动的媒体播放会话");
        }catch(Throwable error){if(transport!=null)throw new Exception("手机媒体控制未执行："+error.toString());while(error.getCause()!=null)error=error.getCause();media.put("unavailable",true).put("reason",error.toString());}
        JSONObject active=new JSONObject();
        try {android.net.wifi.WifiManager wifi=(android.net.wifi.WifiManager)context.getSystemService(Context.WIFI_SERVICE);active.put("wifi",wifi.isWifiEnabled());String ssid=wifi.getConnectionInfo().getSSID();if(wifi.isWifiEnabled()&&ssid!=null&&!"<unknown ssid>".equals(ssid))result.put("wifiName",ssid.replace("\"",""));try{active.put("hotspot",(Boolean)wifi.getClass().getMethod("isWifiApEnabled").invoke(wifi));}catch(Throwable ignored){}}catch(Throwable ignored){}
        try {android.bluetooth.BluetoothAdapter adapter=android.bluetooth.BluetoothAdapter.getDefaultAdapter();if(adapter!=null)active.put("bt",adapter.isEnabled());}catch(Throwable ignored){}
        try {active.put("gps",((android.location.LocationManager)context.getSystemService(Context.LOCATION_SERVICE)).isLocationEnabled());}catch(Throwable ignored){}
        try { active.put("rotation",Settings.System.getInt(context.getContentResolver(),Settings.System.ACCELEROMETER_ROTATION,1)==0); } catch(Throwable ignored) {}
        active.put("mute",audio.getRingerMode()!=AudioManager.RINGER_MODE_NORMAL);
        try { active.put("airplane",Settings.Global.getInt(context.getContentResolver(),Settings.Global.AIRPLANE_MODE_ON,0)!=0); } catch(Throwable ignored) {}
        return result.put("active",active).put("media",media);
    }

    public static void main(String[] args) {
        JSONObject result = new JSONObject();
        try {
            Context context = context();
            if (args.length > 0 && "quick-state".equals(args[0])) {
                result=quickPhoneState(context,args.length>1?args[1]:null);
            } else if (args.length > 1 && "quick-icons".equals(args[0])) {
                result=quickIcons(context,new JSONArray(new String(Base64.decode(args[1],Base64.DEFAULT),"UTF-8")));
            } else if (args.length > 1 && "quick-ui".equals(args[0])) {
                result=quickUi(new JSONObject(new String(Base64.decode(args[1],Base64.DEFAULT),"UTF-8")));
            } else if (args.length > 0 && "task-stream".equals(args[0])) {
                streamTasks(); return;
            } else if (args.length > 0 && "tasks".equals(args[0])) {
                result = taskSnapshot();
            } else if (args.length > 1 && "notification-ui".equals(args[0])) {
                result = notificationUi(new JSONObject(new String(Base64.decode(args[1], Base64.DEFAULT), "UTF-8")));
            } else if (args.length > 1 && "notification-attach".equals(args[0])) {
                JSONObject request = new JSONObject(new String(Base64.decode(args[1], Base64.DEFAULT), "UTF-8"));
                Object service = Class.forName("android.app.ActivityTaskManager").getMethod("getService").invoke(null);
                Class.forName("android.app.IActivityTaskManager").getMethod("moveRootTaskToDisplay", int.class, int.class).invoke(service, request.getInt("taskId"), request.getInt("displayId"));
                result.put("attached", true);
            } else if (args.length > 0 && "notification-apps".equals(args[0])) {
                JSONObject apps = new JSONObject();
                PackageManager pm = context.getPackageManager();
                for (int i = 1; i < Math.min(args.length, 81); i++) {
                    String pkg = args[i];
                    if (!pkg.matches("[a-zA-Z0-9_.]+")) continue;
                    JSONObject info = new JSONObject().put("name", pkg).put("icon", "");
                    try {
                        android.content.pm.ApplicationInfo app = pm.getApplicationInfo(pkg, 0);
                        info.put("name", pm.getApplicationLabel(app).toString());
                        info.put("icon", image(pm.getApplicationIcon(app), 72, 72, false));
                    } catch (Throwable ignored) {}
                    apps.put(pkg, info);
                }
                result.put("apps", apps);
            } else if (args.length > 0 && "wallpaper-stream".equals(args[0])) {
                streamWallpaper(args); return;
            } else if (args.length > 0 && "wallpaper-snapshot".equals(args[0])) {
                result.put("image",wallpaperFrame(1280,720,false));
            } else if (args.length > 0 && "brightness".equals(args[0])) {
                float value = Math.max(0.01f, Math.min(1f, Integer.parseInt(args[1]) / 100f));
                Class<?> cls = Class.forName("android.hardware.display.DisplayManagerGlobal");
                Object display = cls.getMethod("getInstance").invoke(null);
                cls.getMethod("setBrightness", int.class, float.class).invoke(display, 0, value);
                result.put("brightness", Math.round(((Float) cls.getMethod("getBrightness", int.class).invoke(display, 0)) * 100));
            } else if (args.length > 0 && ("state".equals(args[0]) || "volume".equals(args[0]) || "brightness".equals(args[0]))) {
                Context audioContext = new android.content.ContextWrapper(context) {
                    @Override public Context getApplicationContext() { return this; }
                    @Override public String getPackageName() { return "com.android.shell"; }
                    @Override public String getOpPackageName() { return "com.android.shell"; }
                    @Override public android.content.AttributionSource getAttributionSource() { return new android.content.AttributionSource.Builder(android.os.Process.myUid()).setPackageName("com.android.shell").build(); }
                };
                AudioManager audio = AudioManager.class.getDeclaredConstructor(Context.class).newInstance(audioContext);
                int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                if ("volume".equals(args[0])) {
                    int percent = Math.max(0, Math.min(100, Integer.parseInt(args[1])));
                    audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(max * percent / 100f), 0);
                }
                if ("brightness".equals(args[0])) {
                    int percent = Math.max(1, Math.min(100, Integer.parseInt(args[1])));
                    Settings.System.putInt(context.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, 0);
                    Settings.System.putInt(context.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, Math.round(255 * percent / 100f));
                }
                result.put("volume", Math.round(audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / Math.max(1, max)));
                if (!"volume".equals(args[0])) {
                result.put("brightness", Math.round(Settings.System.getInt(context.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, 128) * 100f / 255));
                result.put("wifi", Settings.Global.getInt(context.getContentResolver(), "wifi_on", 0) != 0);
                result.put("bluetooth", Settings.Global.getInt(context.getContentResolver(), "bluetooth_on", 0) != 0);
                result.put("airplane", Settings.Global.getInt(context.getContentResolver(), "airplane_mode_on", 0) != 0);
                result.put("powerSave", Settings.Global.getInt(context.getContentResolver(), "low_power", 0) != 0);
                result.put("dark", (context.getResources().getConfiguration().uiMode & 48) == 32);
                }
            } else if (args.length > 0 && "wallpaper-info".equals(args[0])) {
                android.app.WallpaperInfo info = WallpaperManager.getInstance(context).getWallpaperInfo();
                result.put("live", info != null);
                boolean multiple = false;
                if (info != null) {
                    try { multiple = (Boolean) info.getClass().getMethod("supportsMultipleDisplays").invoke(info); } catch (Throwable ignored) {}
                }
                result.put("multipleDisplays", multiple);
            } else if (args.length > 0 && "wallpaper".equals(args[0])) {
                ParcelFileDescriptor file = WallpaperManager.getInstance(context).getWallpaperFile(WallpaperManager.FLAG_SYSTEM);
                if (file == null) throw new Exception("System did not expose a static wallpaper file");
                Bitmap bitmap;
                try { bitmap = BitmapFactory.decodeFileDescriptor(file.getFileDescriptor()); } finally { file.close(); }
                if (bitmap == null) throw new Exception("Wallpaper image could not be decoded");
                Drawable drawable = new BitmapDrawable(context.getResources(), bitmap);
                int width = Math.max(1, drawable.getIntrinsicWidth());
                int height = Math.max(1, drawable.getIntrinsicHeight());
                double scale = Math.min(1.0, 2560.0 / Math.max(width, height));
                result.put("image", image(drawable, (int)(width * scale), (int)(height * scale), true));
            } else {
                PackageManager pm = context.getPackageManager();
                Intent intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> entries = pm.queryIntentActivities(intent, 0);
                JSONArray apps = new JSONArray();
                HashSet<String> seen = new HashSet<String>();
                for (ResolveInfo entry : entries) {
                    String pkg = entry.activityInfo.packageName; if ("dev.yanjiu.scrcpy.wallpaper".equals(pkg)) continue;
                    if (!seen.add(pkg)) continue;
                    JSONObject item = new JSONObject();
                    item.put("packageName", pkg);
                    item.put("name", entry.loadLabel(pm).toString());
                    try { item.put("icon", image(entry.loadIcon(pm), 96, 96, false)); } catch (Throwable ignored) {}
                    apps.put(item);
                }
                result.put("apps", apps);
            }
        } catch (Throwable error) {
            while (error.getCause() != null) error = error.getCause();
            try { result.put("error", error.toString()); } catch (Exception ignored) {}
        }
        System.out.println("DESKTOP_AGENT:" + result.toString());
        System.exit(0);
    }
}
