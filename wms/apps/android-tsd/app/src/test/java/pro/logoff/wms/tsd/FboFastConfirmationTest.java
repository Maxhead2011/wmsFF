package pro.logoff.wms.tsd;

import android.app.Activity;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import java.lang.reflect.Proxy;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.*;
import retrofit2.Call;
import retrofit2.Response;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class FboFastConfirmationTest {
    private TsdFboPlan plan() {
        TsdFboPlan p=new TsdFboPlan();p.requestId="request";p.title="Test";p.phase="PICKING";p.needed=2;p.fastAcknowledgementSupported=true;
        p.lines=new ArrayList<>();p.route=new ArrayList<>();p.boxes=new ArrayList<>();p.wholeBoxes=new ArrayList<>();return p;
    }
    private FboScanState state(FboTwoStageScreen s)throws Exception{var f=FboTwoStageScreen.class.getDeclaredField("state");f.setAccessible(true);return (FboScanState)f.get(s);}
    private void idle(FboTwoStageScreen s)throws Exception {
        var f=FboTwoStageScreen.class.getDeclaredField("busy");f.setAccessible(true);
        for(int i=0;i<300;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();if(!f.getBoolean(s))return;Thread.sleep(10);}fail("screen remained busy");
    }
    private void send(FboTwoStageScreen s)throws Exception{var m=FboTwoStageScreen.class.getDeclaredMethod("send",String.class,String.class);m.setAccessible(true);m.invoke(s,"PICK_UNIT","KIZ");}
    private boolean text(View v,String value){if(v instanceof TextView&&((TextView)v).getText().toString().contains(value))return true;if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++)if(text(((ViewGroup)v).getChildAt(i),value))return true;return false;}
    // TEST: a failed route refresh after commit must not resurrect the pick or enable stale scanning.
    @Test public void acceptedPickSurvivesRouteFailure()throws Exception{exercise(false,true,true);}
    // TEST: a lost HTTP response is reconciled by a read-only check, not by a second mutation.
    @Test public void lostResponseIsCheckedAutomatically()throws Exception{exercise(true,false,true);}
    // TEST: an unknown result keeps the original durable id and cannot become a new scan.
    @Test public void unknownResultKeepsPendingRequest()throws Exception{exercise(true,false,false);}
    // TEST: after process restart, check the persisted receipt before requesting a slow route.
    @Test public void restartChecksReceiptBeforeLoadingRoute()throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var c=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=c.get();String user=UUID.randomUUID().toString();String key=user+":request";
            Map<String,String> payload=Map.of("operationId","saved-operation","action","PICK_UNIT","barcode","2051234567890","kiz","KIZ");
            a.getSharedPreferences("fbo-pending",0).edit().putString(key,new org.json.JSONObject(payload).toString()).putBoolean(key+":fast",true).commit();
            List<String> calls=Collections.synchronizedList(new ArrayList<>());
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(call,method,values)->{
                if(!method.getName().equals("execute"))return null;calls.add(m.getName());
                if(m.getName().equals("fboOperationStatus")){TsdFboAcknowledgement ack=new TsdFboAcknowledgement();ack.requestId="request";ack.operationId="saved-operation";ack.action="PICK_UNIT";ack.accepted=true;return Response.success(ack);}
                if(m.getName().equals("getFboPlanAtLocation"))return Response.success(plan());
                throw new AssertionError("Restart must not replay the stock mutation");
            }));
            FboTwoStageScreen s=new FboTwoStageScreen(a,new TsdSession("test","Bearer","T","T",user,"Test",Collections.emptyList()),api,"https://example.invalid","request",false,()->{});
            try{idle(s);assertEquals(Arrays.asList("fboOperationStatus","getFboPlanAtLocation"),calls);assertNull(state(s).pending());assertTrue(text(a.findViewById(android.R.id.content),"Принято: 1 шт."));}
            finally{s.close();a.getSharedPreferences("fbo-pending",0).edit().clear().commit();}
        }
    }
    // TEST: a manual unit recovered after a lost response speaks once, with no second mutation.
    @Test public void manualPackingReceiptSpeaksAfterLostResponse()throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var c=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=c.get();String user=UUID.randomUUID().toString();String key=user+":request";
            Map<String,String> payload=Map.of("operationId","manual-saved","action","MANUAL_PACK_UNIT","barcode","EXTRA","kiz","KIZ","targetBoxCode","TARGET");
            a.getSharedPreferences("fbo-pending",0).edit().putString(key,new org.json.JSONObject(payload).toString()).putBoolean(key+":fast",true).commit();
            List<FboPackingVoice.Cue> spoken=new ArrayList<>();AtomicInteger writes=new AtomicInteger();
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(call,method,values)->{
                if(!method.getName().equals("execute"))return null;
                if(m.getName().equals("fboOperationStatus")){TsdFboAcknowledgement ack=new TsdFboAcknowledgement();ack.requestId="request";ack.operationId="manual-saved";ack.action="MANUAL_PACK_UNIT";ack.accepted=true;return Response.success(ack);}
                if(m.getName().equals("getFboPlanAtLocation")){TsdFboPlan p=plan();p.phase="PACKING";p.manualPackingEnabled=true;TsdFboPlan.Box b=new TsdFboPlan.Box();b.code="TARGET";p.boxes.add(b);return Response.success(p);}
                writes.incrementAndGet();throw new AssertionError("No second mutation after saved manual receipt");
            }));
            FboScanFeedback voice=new FboScanFeedback(){public void play(boolean ok){}public void close(){}public void prompt(FboPackingVoice.Cue cue){spoken.add(cue);}};
            FboTwoStageScreen screen=new FboTwoStageScreen(a,new TsdSession("test","Bearer","T","T",user,"Test",Collections.emptyList()),api,"https://example.invalid","request",true,()->{},()->{},voice);
            try{idle(screen);assertNull(state(screen).pending());assertEquals(0,writes.get());assertEquals(Arrays.asList(FboPackingVoice.Cue.PUT),spoken);}
            finally{screen.close();}
        }
    }
    private void exercise(boolean loseResponse,boolean failRoute,boolean accepted)throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var c=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=c.get();String user=UUID.randomUUID().toString();AtomicInteger reads=new AtomicInteger(),writes=new AtomicInteger(),checks=new AtomicInteger();List<String> ids=new ArrayList<>();List<String> locations=new ArrayList<>();
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(call,method,values)->{
                if(!method.getName().equals("execute"))return null;
                if(m.getName().equals("getFboPlanAtLocation")){locations.add(args[2]+":"+args[3]);if(reads.incrementAndGet()>1&&failRoute)throw new java.io.IOException("route timeout");return Response.success(plan());}
                if(m.getName().equals("actFbo"))throw new AssertionError("Legacy mutation should not be called");
                Map<?,?> payload=(Map<?,?>)args[2];ids.add((String)payload.get("operationId"));
                if(m.getName().equals("acknowledgeFbo")){writes.incrementAndGet();if(loseResponse)throw new java.io.IOException("response lost");}
                else if(m.getName().equals("fboOperationStatus"))checks.incrementAndGet();else throw new AssertionError(m.getName());
                TsdFboAcknowledgement ack=new TsdFboAcknowledgement();ack.requestId="request";ack.operationId=(String)payload.get("operationId");ack.action="PICK_UNIT";ack.accepted=accepted;return Response.success(ack);
            }));
            FboTwoStageScreen s=new FboTwoStageScreen(a,new TsdSession("test","Bearer","T","T",user,"Test",Collections.emptyList()),api,"https://example.invalid","request",false,()->{});
            try {
                idle(s);state(s).pallet="PALLET";state(s).source="BOX";state(s).barcode="2051234567890";send(s);
                for(int i=0;i<400;i++){Shadows.shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(100));Thread.sleep(10);if(accepted&&state(s).pending()==null&&reads.get()>1)break;if(!accepted&&checks.get()>=3)break;}
                idle(s);assertEquals(1,writes.get());assertEquals(1,new HashSet<>(ids).size());
                if(loseResponse)assertTrue(checks.get()>0);
                if(accepted){assertTrue("Refresh must retain the physical location",locations.contains("PALLET:BOX"));assertNull(state(s).pending());assertFalse(a.getSharedPreferences("fbo-pending",0).contains(user+":request"));assertTrue(text(a.findViewById(android.R.id.content),"Принято: 1 шт."));}
                else{assertNotNull(state(s).pending());assertEquals(3,checks.get());assertTrue(a.getSharedPreferences("fbo-pending",0).contains(user+":request"));}
                if(failRoute){assertFalse(s.scannerField().isEnabled());assertFalse(text(a.findViewById(android.R.id.content),"Повторить отправку"));}
            }finally{s.close();a.getSharedPreferences("fbo-pending",0).edit().clear().commit();}
        }
    }
}
