package pro.logoff.wms.tsd;
import android.app.Activity;
import android.os.Looper;
import android.widget.EditText;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.*;
import retrofit2.*;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class FboCompactPackingScreenTest {
 Object field(Object o,String n)throws Exception{Field f=o.getClass().getDeclaredField(n);f.setAccessible(true);return f.get(o);}
 void idle(FboTwoStageScreen s)throws Exception{for(int i=0;i<300;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();if(!(boolean)field(s,"busy"))return;Thread.sleep(10);}fail("busy");}
 // TEST: opening and packing retain the input, avoid full GET, and lost replies use status only.
 @Test public void nextScanWithoutFullPlan()throws Exception{exercise(false);}
 @Test public void lostReplyUsesSameCompactState()throws Exception{exercise(true);}
 void exercise(boolean lose)throws Exception{
  if(!"logoff".equals(BuildConfig.FLAVOR))return;
  try(var c=Robolectric.buildActivity(Activity.class).setup()){
   Activity a=c.get();String user=UUID.randomUUID().toString();a.getSharedPreferences("fbo-pending",0).edit().putString(user+":r:mode","NEW_BOXES").commit();
   AtomicInteger reads=new AtomicInteger(),writes=new AtomicInteger(),checks=new AtomicInteger();
   TsdFboPlan p=new TsdFboPlan();p.requestId="r";p.title="Packing";p.phase="PACKING";p.needed=2;p.picked=2;p.fastAcknowledgementSupported=true;p.compactPackingSupported=true;
   p.lines=new ArrayList<>();p.boxes=new ArrayList<>();p.route=new ArrayList<>();p.wholeBoxes=new ArrayList<>();
   WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(call,method,values)->{
    if(!method.getName().equals("execute"))return null;
    if(m.getName().equals("getFboPlanAtLocation")){reads.incrementAndGet();return Response.success(p);}
    Map<String,String> payload=(Map<String,String>)args[2];
    if(m.getName().equals("acknowledgeFbo")){writes.incrementAndGet();if(lose)throw new java.io.IOException("lost");}else if(m.getName().equals("fboOperationStatus"))checks.incrementAndGet();else throw new AssertionError(m.getName());
    TsdFboAcknowledgement ack=new TsdFboAcknowledgement();ack.accepted=true;ack.requestId="r";ack.operationId=payload.get("operationId");ack.action=payload.get("action");
    FboPackingReceipt.State s=new FboPackingReceipt.State();s.version=1;s.requestId="r";s.phase="PACKING";s.needed=2;s.picked=2;s.packed=0;s.looseRemaining=2;s.lines=p.lines;s.wholeBoxes=p.wholeBoxes;s.boxes=new ArrayList<>();TsdFboPlan.Box b=new TsdFboPlan.Box();b.code="FFL_NEW";s.boxes.add(b);ack.packing=s;return Response.success(ack);
   }));
   FboTwoStageScreen screen=new FboTwoStageScreen(a,new TsdSession("t","Bearer","T","T",user,"Test",Collections.emptyList()),api,"https://example.invalid","r",true,()->{},null,null);
   try{idle(screen);EditText input=screen.scannerField();input.setText("FFL_NEW");screen.submit();
    for(int i=0;i<300;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();Thread.sleep(10);if(((FboScanState)field(screen,"state")).pending()==null&&writes.get()>0)break;}
    idle(screen);assertEquals(1,reads.get());assertEquals(1,writes.get());assertEquals(lose?1:0,checks.get());assertSame(input,screen.scannerField());assertTrue(input.isEnabled());assertEquals("FFL_NEW",((FboScanState)field(screen,"state")).target);
   }finally{screen.close();}
  }
 }
}
