package pro.logoff.wms.tsd;

import android.app.Activity;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import java.lang.reflect.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.*;
import retrofit2.Call;
import retrofit2.Response;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class LamodaAutoRefreshScreenTest {
    private TsdFboPlan plan(String status,int packed){
        TsdFboPlan p=new TsdFboPlan();p.requestId="r";p.title="Lamoda";p.phase="PACKING";p.marketplace="LAMODA";
        p.needed=2;p.picked=2;p.packed=packed;p.looseRemaining=2-packed;p.fastAcknowledgementSupported=true;p.relabelRequired=true;
        p.lines=new ArrayList<>();p.route=new ArrayList<>();p.boxes=new ArrayList<>();p.wholeBoxes=new ArrayList<>();p.directions=new ArrayList<>();p.relabelUnits=new ArrayList<>();
        TsdFboPlan.Box b=new TsdFboPlan.Box();b.code="BOX";b.direction="Destination";b.quantity=packed;p.boxes.add(b);
        TsdFboPlan.Direction d=new TsdFboPlan.Direction();d.name="Destination";d.needed=2;d.packed=packed;d.items=new ArrayList<>();p.directions.add(d);
        TsdFboPlan.RelabelUnit u=new TsdFboPlan.RelabelUnit();u.id="unit";u.printStatus=status;
        u.label=new TsdFboPlan.RelabelLabel();u.label.name="Suit";u.label.size="42";u.label.barcode="4640684262415";p.relabelUnits.add(u);return p;
    }
    private Object field(FboTwoStageScreen s,String name)throws Exception{Field f=FboTwoStageScreen.class.getDeclaredField(name);f.setAccessible(true);return f.get(s);}
    private void idle(FboTwoStageScreen s)throws Exception{
        for(int i=0;i<300;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();if(!(Boolean)field(s,"busy"))return;Thread.sleep(10);}fail("Screen remained busy");
    }
    private FboTwoStageScreen screen(Activity a,WmsApi api){return new FboTwoStageScreen(a,new TsdSession("test","Bearer","T","T",UUID.randomUUID().toString(),"Tester",Collections.emptyList()),api,"https://example.invalid","r",true,()->{});}
    private interface Reply{Object get(String name,Object[] args)throws Exception;}
    private WmsApi api(Reply reply){return (WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,values)->method.getName().equals("execute")?reply.get(m.getName(),args):null));}
    private boolean text(View v,String wanted){if(v instanceof TextView&&((TextView)v).getText().toString().contains(wanted))return true;if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++)if(text(((ViewGroup)v).getChildAt(i),wanted))return true;return false;}

    // TEST: actual print callback -> queued plan -> automatic GET -> next scan button, one print only.
    @Test public void printCompletionShowsNextStepAutomatically()throws Exception{
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        AtomicInteger reads=new AtomicInteger(),prints=new AtomicInteger();
        WmsApi api=api((name,args)->{
            if(name.equals("getFboPlanAtLocation")){int n=reads.incrementAndGet();return Response.success(plan(n==1?null:n==2?"QUEUED":"PRINTED",0));}
            if(name.equals("lamodaFboRelabelPrint")){prints.incrementAndGet();TsdRelabelPrintJob j=new TsdRelabelPrintJob();j.status="QUEUED";return Response.success(j);}
            throw new AssertionError("Unexpected mutation: "+name);
        });
        try(var activity=Robolectric.buildActivity(Activity.class).setup()){
            FboTwoStageScreen s=screen(activity.get(),api);
            try{
                idle(s);Field selected=FboTwoStageScreen.class.getDeclaredField("relabelUnitId");selected.setAccessible(true);selected.set(s,"unit");
                Method print=FboTwoStageScreen.class.getDeclaredMethod("printLamodaUnit",TsdFboPlan.RelabelUnit.class,String.class);print.setAccessible(true);print.invoke(s,plan(null,0).relabelUnits.get(0),"station");idle(s);
                Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2));idle(s);
                assertEquals(3,reads.get());assertEquals(1,prints.get());assertTrue(text(activity.get().findViewById(android.R.id.content),"Сканировать новую этикетку"));
            }finally{s.close();}
        }
    }

    // TEST: a compact packing acknowledgement triggers a full GET preserving direction and counters.
    @Test public void packingAcknowledgementRefreshesDirectionsAutomatically()throws Exception{
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        AtomicInteger reads=new AtomicInteger(),writes=new AtomicInteger();
        WmsApi api=api((name,args)->{
            if(name.equals("getFboPlanAtLocation"))return Response.success(plan("PRINTED",reads.incrementAndGet()>1?1:0));
            if(name.equals("acknowledgeFbo")){
                writes.incrementAndGet();Map<?,?> body=(Map<?,?>)args[2];TsdFboAcknowledgement a=new TsdFboAcknowledgement();a.accepted=true;a.requestId="r";a.action="PACK_UNIT";a.operationId=(String)body.get("operationId");
                a.packing=new FboPackingReceipt.State();a.packing.version=1;a.packing.requestId="r";a.packing.phase="PACKING";a.packing.needed=2;a.packing.picked=2;a.packing.packed=1;
                a.packing.lines=new ArrayList<>();a.packing.boxes=new ArrayList<>();a.packing.wholeBoxes=new ArrayList<>();return Response.success(a);
            }
            throw new AssertionError("Unexpected call: "+name);
        });
        try(var activity=Robolectric.buildActivity(Activity.class).setup()){
            FboTwoStageScreen s=screen(activity.get(),api);
            try{
                idle(s);FboScanState state=(FboScanState)field(s,"state");state.target="BOX";state.direction="Destination";state.barcode="4640684262415";
                Method send=FboTwoStageScreen.class.getDeclaredMethod("send",String.class,String.class);send.setAccessible(true);send.invoke(s,"PACK_UNIT",null);idle(s);
                TsdFboPlan p=(TsdFboPlan)field(s,"plan");assertEquals(2,reads.get());assertEquals(1,writes.get());assertEquals(1,p.packed);assertEquals(1,p.directions.get(0).packed);assertEquals("Destination",p.boxes.get(0).direction);assertNull(state.pending());
            }finally{s.close();}
        }
    }
}
