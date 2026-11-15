package dev.yanjiu.scrcpy.notifications;
import java.util.concurrent.atomic.AtomicReference;
public class NotificationQueueRaceTest {
 public static void main(String[] args)throws Exception {
  for(int round=0;round<100;round++) {
   NotificationWorkQueue queue=new NotificationWorkQueue();AtomicReference<Throwable> failure=new AtomicReference<>();Thread[] senders=new Thread[4];
   for(int i=0;i<senders.length;i++){senders[i]=new Thread(() -> {try{for(int n=0;n<1000;n++)queue.execute(() -> {});}catch(Throwable t){failure.set(t);}});senders[i].start();}
   queue.close();for(Thread t:senders)t.join();
   if(failure.get()!=null)throw new AssertionError("Late socket callback crashed",failure.get());
   if(queue.execute(() -> {}))throw new AssertionError("Accepted work after shutdown");
  }
  System.out.println("PASS: 400000 concurrent submissions with shutdown; no rejected-execution crash");
 }
}
