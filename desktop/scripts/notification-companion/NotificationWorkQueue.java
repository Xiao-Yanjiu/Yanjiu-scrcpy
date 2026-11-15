package dev.yanjiu.scrcpy.notifications;
import java.util.concurrent.*;
/** Serial work queue whose shutdown cannot race a late socket callback. */
final class NotificationWorkQueue {
  private final ExecutorService executor=Executors.newSingleThreadExecutor();
  private boolean closed;
  synchronized boolean execute(Runnable task) {
    if(closed)return false;
    try {executor.execute(task);return true;}
    catch(RejectedExecutionException ignored){return false;}
  }
  synchronized void close(){closed=true;executor.shutdownNow();}
}
