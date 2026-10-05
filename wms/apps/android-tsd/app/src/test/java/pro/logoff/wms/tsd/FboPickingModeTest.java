package pro.logoff.wms.tsd;

import android.app.Activity;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import java.lang.reflect.Proxy;
import java.util.*;
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

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28)
public class FboPickingModeTest {
    // TEST: two routes partition the same plan; navigation and rejected location scans never write stock.
    @Test public void separateRoutesRejectOtherModeAndPreserveGlobalCompletion() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();TsdFboPlan plan=plan();List<Map<String,String>> writes=new ArrayList<>();
            FboTwoStageScreen screen=open(a,plan,writes,UUID.randomUUID().toString());
            try {
                idle(screen);
                if(!"logoff".equals(BuildConfig.FLAVOR)) {
                    assertNull(find(a,"Сборка целых коробов"));assertNotNull(screen.scannerField());return;
                }
                assertNotNull(find(a,"Сборка целых коробов"));assertNotNull(find(a,"Частичный отбор"));assertNull(screen.scannerField());
                click(a,"Сборка целых коробов");idle(screen);
                assertNotNull(find(a,"PALLET-W"));assertNull(find(a,"PALLET-P"));
                scan(screen,"PALLET-P");assertNotNull(find(a,"не требуется"));
                scan(screen,"PALLET-W");scan(screen,"WHOLE");
                assertNotNull(find(a,"Короб забран целиком"));assertNull(find(a,"Отобрать товар по ШК + КИЗ"));
                scan(screen,"123");assertTrue(writes.isEmpty());
                click(a,"К выбору отбора");idle(screen);click(a,"Частичный отбор");idle(screen);
                assertNull(find(a,"PALLET-W"));assertNotNull(find(a,"PALLET-P"));
                scan(screen,"PALLET-W");assertNotNull(find(a,"не требуется"));
                scan(screen,"PALLET-P");scan(screen,"PARTIAL");
                assertNotNull(find(a,"Отобрать товар по ШК + КИЗ"));assertNull(find(a,"Короб забран целиком"));
                assertFalse(find(a,"Завершить отбор").isEnabled());assertTrue(writes.isEmpty());
                assertEquals(0,plan.picked);assertEquals(0,plan.packed);assertEquals(2,plan.route.size());
                scan(screen,"123");assertFalse(find(a,"К выбору отбора").isEnabled());assertTrue(writes.isEmpty());
            } finally {screen.close();}
        }
    }
    // TEST: a refreshed/reclassified box leaves the active route without acknowledging or picking anything.
    @Test public void reclassifiedBoxCannotStaySelectedInWholeRoute() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();TsdFboPlan p=plan();List<Map<String,String>> writes=new ArrayList<>();
            FboTwoStageScreen s=open(a,p,writes,UUID.randomUUID().toString());
            try {idle(s);click(a,"Сборка целых коробов");idle(s);scan(s,"PALLET-W");scan(s,"WHOLE");
                p.route.get(0).wholeBox=false;click(a,"Обновить");idle(s);
                assertNull(find(a,"Короб забран целиком"));assertNotNull(find(a,"Нет коробов"));assertTrue(writes.isEmpty());
            }finally{s.close();}
        }
    }
    // TEST: upgrading with an unresolved pick preserves its payload and operation id, even across menu changes.
    @Test public void pendingPickRestoresWithoutLosingRetry() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        for(String action:Arrays.asList("PICK_BOX","PICK_UNIT"))try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();String user=UUID.randomUUID().toString();TsdFboPlan p=plan();
            Map<String,String> pending=new LinkedHashMap<>();pending.put("action",action);pending.put("operationId","original-id");
            pending.put("sourceBoxCode",action.equals("PICK_BOX")?"WHOLE":"PARTIAL");
            pending.put("palletCode",action.equals("PICK_BOX")?"PALLET-W":"PALLET-P");
            if(action.equals("PICK_UNIT")){pending.put("barcode","123");pending.put("kiz","KIZ");}
            a.getSharedPreferences("fbo-pending",0).edit().putString(user+":request",new org.json.JSONObject(pending).toString()).commit();
            List<Map<String,String>> writes=new ArrayList<>();FboTwoStageScreen s=open(a,p,writes,user);
            try{idle(s);assertFalse(find(a,"К выбору отбора").isEnabled());click(a,"Повторить отправку");idle(s);assertEquals(Collections.singletonList(pending),writes);}
            finally{s.close();}
        }
    }
    // TEST: each mode restores its own selected source; completing one route never completes the request.
    @Test public void selectedModeSurvivesReopeningAndCompletionRequiresAllUnits() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        for(boolean whole:Arrays.asList(true,false))try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();String user=UUID.randomUUID().toString();TsdFboPlan p=plan();List<Map<String,String>> writes=new ArrayList<>();
            FboTwoStageScreen s=open(a,p,writes,user);
            try{
                idle(s);choose(a,whole);scan(s,whole?"PALLET-W":"PALLET-P");scan(s,whole?"WHOLE":"PARTIAL");s.close();
                s=open(a,p,writes,user);idle(s);assertNotNull(find(a,whole?"Короб забран целиком":"Отобрать товар по ШК + КИЗ"));
                p.route.remove(whole?0:1);p.picked=whole?2:1;click(a,"Обновить");idle(s);
                assertFalse(find(a,"Завершить отбор").isEnabled());assertTrue(writes.isEmpty());
                p.route.clear();p.picked=p.needed;click(a,"Обновить");idle(s);click(a,"Завершить отбор");idle(s);
                assertEquals(1,writes.size());assertEquals("FINISH_PICK",writes.get(0).get("action"));
            }finally{s.close();}
        }
    }
    private static TsdFboPlan plan(){
        TsdFboPlan p=new TsdFboPlan();p.phase="PICKING";p.title="Request";p.needed=3;
        p.lines=new ArrayList<>();p.route=new ArrayList<>();p.boxes=new ArrayList<>();p.wholeBoxes=new ArrayList<>();
        for(boolean whole:Arrays.asList(true,false)){
            TsdFboPlan.Route r=new TsdFboPlan.Route();r.boxCode=whole?"WHOLE":"PARTIAL";r.pallet=whole?"PALLET-W":"PALLET-P";r.zone="Zone";r.wholeBox=whole;r.wholeBoxQuantity=whole?2:0;
            TsdFboPlan.Task t=new TsdFboPlan.Task();t.skuId="sku";t.barcode="123";t.name="Product";t.quantity=whole?2:1;t.requiresKiz=true;r.tasks=Collections.singletonList(t);p.route.add(r);
        }
        TsdFboPlan.Line l=new TsdFboPlan.Line();l.barcode="123";l.remaining=3;l.needed=3;l.requiresKiz=true;p.lines.add(l);return p;
    }
    private static FboTwoStageScreen open(Activity a,TsdFboPlan p,List<Map<String,String>> writes,String user){
        WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,v)->{
            if(!method.getName().equals("execute"))return null;
            if(m.getName().equals("actFbo"))writes.add(new LinkedHashMap<>((Map<String,String>)args[2]));return Response.success(p);
        }));
        return new FboTwoStageScreen(a,new TsdSession("token","Bearer","T","T",user,"Test",Collections.emptyList()),api,"https://example.invalid","request",false,()->{},null,null);
    }
    private static void scan(FboTwoStageScreen s,String value){assertNotNull(s.scannerField());s.scannerField().setText(value);s.submit();}
    // TEST: existing scan regressions explicitly enter the newly introduced menu.
    static void choose(Activity a,boolean whole){if("logoff".equals(BuildConfig.FLAVOR))click(a,whole?"Сборка целых коробов":"Частичный отбор");}
    private static void click(Activity a,String label){TextView v=find(a,label);assertNotNull(label,v);assertTrue(label,v.isEnabled());v.performClick();}
    private static TextView find(Activity a,String label){return find(a.findViewById(android.R.id.content),label);}
    private static TextView find(View v,String label){if(v instanceof TextView&&((TextView)v).getText().toString().contains(label))return (TextView)v;if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++){TextView hit=find(((ViewGroup)v).getChildAt(i),label);if(hit!=null)return hit;}return null;}
    private static void idle(FboTwoStageScreen s)throws Exception {var busy=FboTwoStageScreen.class.getDeclaredField("busy");busy.setAccessible(true);for(int i=0;i<300;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();if(!busy.getBoolean(s))return;Thread.sleep(10);}fail("Plan did not load");}
}
