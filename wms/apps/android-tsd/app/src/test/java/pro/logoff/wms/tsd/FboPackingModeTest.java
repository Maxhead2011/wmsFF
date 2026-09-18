package pro.logoff.wms.tsd;
import android.app.Activity;
import android.os.Looper;
import android.view.*;
import android.widget.TextView;
import java.lang.reflect.Proxy;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.*;
import retrofit2.*;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class FboPackingModeTest {
    private TextView find(View v,String title){
        if(v instanceof TextView && title.equals(((TextView)v).getText().toString()))return (TextView)v;
        if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++){TextView t=find(((ViewGroup)v).getChildAt(i),title);if(t!=null)return t;}return null;
    }
    private void idle(FboTwoStageScreen s)throws Exception{var f=FboTwoStageScreen.class.getDeclaredField("busy");f.setAccessible(true);for(int i=0;i<300;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();if(!f.getBoolean(s))return;Thread.sleep(10);}fail("timeout");}
    // TEST: new boxes can be packed before whole boxes; finishing the mode never finishes the request.
    @Test public void separateModesPackNewThenWholeAndPreserveSoldFlow()throws Exception{
        try(var controller=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=controller.get();TsdFboPlan p=new TsdFboPlan();p.phase="PACKING";p.title="Request";p.needed=2;p.picked=2;
            p.boxes=new ArrayList<>();p.lines=new ArrayList<>();p.route=new ArrayList<>();p.wholeBoxes=new ArrayList<>(Arrays.asList("WHOLE"));
            TsdFboPlan.Line l=new TsdFboPlan.Line();l.barcode="123";l.picked=1;l.remaining=0;l.requiresKiz=true;p.lines.add(l);
            List<Map<String,String>> writes=new ArrayList<>();
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,v)->{
                if(!method.getName().equals("execute"))return null;
                if(m.getName().equals("actFbo")){
                    Map<String,String> data=new LinkedHashMap<>((Map<String,String>)args[2]);writes.add(data);
                    switch(data.get("action")){
                        case "OPEN_BOX":TsdFboPlan.Box b=new TsdFboPlan.Box();b.code=data.get("targetBoxCode");p.boxes.add(b);break;
                        case "PACK_UNIT":assertEquals("KIZ-1",data.get("kiz"));p.boxes.get(0).quantity=1;l.packed=1;p.packed=1;break;
                        case "CLOSE_BOX":p.boxes.get(0).closed=true;break;
                        case "PACK_BOX":assertEquals("WHOLE",data.get("sourceBoxCode"));p.wholeBoxes.clear();p.packed=2;break;
                        default:fail("Unexpected mutation "+data);
                    }
                }return Response.success(p);
            }));
            FboTwoStageScreen s=new FboTwoStageScreen(a,new TsdSession("token","Bearer","T","T",UUID.randomUUID().toString(),"Test",Collections.emptyList()),api,"https://example.invalid","request",true,()->{});
            try{idle(s);View root=a.findViewById(android.R.id.content);
                if(!"logoff".equals(BuildConfig.FLAVOR)){assertNull(find(root,"Собрать новые короба"));assertNotNull(s.scannerField());s.scannerField().setText("NEW");s.submit();assertTrue(writes.isEmpty());return;}
                assertNotNull(find(root,"Собрать новые короба"));assertNotNull(find(root,"Отсканировать целые короба"));assertNull(s.scannerField());assertTrue(writes.isEmpty());assertFalse(find(root,"Сканировать все короба поставки").isEnabled());
                find(root,"Собрать новые короба").performClick();s.scannerField().setText("NEW");s.submit();idle(s);assertEquals("OPEN_BOX",writes.get(0).get("action"));
                assertFalse(find(a.findViewById(android.R.id.content),"Завершить формирование новых коробов").isEnabled());
                s.scannerField().setText("123");s.submit();assertEquals(1,writes.size());s.scannerField().setText("KIZ-1");s.submit();idle(s);
                find(a.findViewById(android.R.id.content),"Закрыть короб").performClick();idle(s);
                find(a.findViewById(android.R.id.content),"Завершить формирование новых коробов").performClick();assertEquals(3,writes.size());assertEquals("PACKING",p.phase);assertNull(s.scannerField());
                find(a.findViewById(android.R.id.content),"Отсканировать целые короба").performClick();s.scannerField().setText("WRONG");s.submit();assertEquals(3,writes.size());
                s.scannerField().setText("WHOLE");s.submit();idle(s);assertEquals(4,writes.size());
                find(a.findViewById(android.R.id.content),"Завершить сканирование целых коробов").performClick();assertNull(s.scannerField());assertEquals("PACKING",p.phase);assertTrue(find(a.findViewById(android.R.id.content),"Сканировать все короба поставки").isEnabled());
            }finally{s.close();}
        }
    }

    // TEST: reopening either mode after an unknown response keeps its original operation id.
    @Test public void pendingPackingSurvivesRestartWithoutAllowingModeExit()throws Exception{
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        for(String action:new String[]{"OPEN_BOX","PACK_BOX"})try(var controller=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=controller.get();String userId=UUID.randomUUID().toString();
            Map<String,String> pending=new LinkedHashMap<>();pending.put("action",action);pending.put("operationId","same-operation");
            pending.put(action.equals("OPEN_BOX")?"targetBoxCode":"sourceBoxCode",action.equals("OPEN_BOX")?"NEW":"WHOLE");
            a.getSharedPreferences("fbo-pending",0).edit().putString(userId+":request",new org.json.JSONObject(pending).toString()).commit();
            TsdFboPlan p=new TsdFboPlan();p.phase="PACKING";p.title="Request";p.needed=2;p.picked=2;
            p.boxes=new ArrayList<>();p.lines=new ArrayList<>();p.route=new ArrayList<>();p.wholeBoxes=new ArrayList<>(Arrays.asList("WHOLE"));
            List<Map<String,String>> writes=new ArrayList<>();
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,v)->{
                if(!method.getName().equals("execute"))return null;
                if(m.getName().equals("actFbo")){writes.add(new LinkedHashMap<>((Map<String,String>)args[2]));
                    if(writes.size()==1)return Response.error(503,okhttp3.ResponseBody.create(okhttp3.MediaType.parse("application/json"),"{}"));
                    if(action.equals("OPEN_BOX")){TsdFboPlan.Box b=new TsdFboPlan.Box();b.code="NEW";p.boxes.add(b);}else p.wholeBoxes.clear();
                }return Response.success(p);
            }));
            FboTwoStageScreen screen=new FboTwoStageScreen(a,new TsdSession("token","Bearer","T","T",userId,"Test",Collections.emptyList()),api,"https://example.invalid","request",true,()->{});
            try{idle(screen);String finish=action.equals("OPEN_BOX")?"Завершить формирование новых коробов":"Завершить сканирование целых коробов";
                assertFalse(find(a.findViewById(android.R.id.content),finish).isEnabled());assertTrue(writes.isEmpty());
                find(a.findViewById(android.R.id.content),"Повторить неподтверждённый запрос").performClick();idle(screen);
                assertFalse(find(a.findViewById(android.R.id.content),finish).isEnabled());
                find(a.findViewById(android.R.id.content),"Повторить неподтверждённый запрос").performClick();idle(screen);
                assertEquals(Arrays.asList(pending,pending),writes);
                assertFalse(a.getSharedPreferences("fbo-pending",0).contains(userId+":request"));
                assertEquals(action.equals("PACK_BOX"),find(a.findViewById(android.R.id.content),finish).isEnabled());
            }finally{screen.close();}
        }
    }

    // TEST: final control is explicit; omitted, foreign and repeated scans never add quantities.
    @Test public void scanAllBoxesThenExposeBothFiles()throws Exception{
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var controller=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=controller.get();TsdFboPlan p=new TsdFboPlan();p.phase="PACKING";p.title="Request";p.needed=2;p.picked=2;p.packed=2;
            p.boxes=new ArrayList<>();p.lines=new ArrayList<>();p.route=new ArrayList<>();p.wholeBoxes=new ArrayList<>();
            for(String code:new String[]{"NEW","WHOLE"}){TsdFboPlan.Box b=new TsdFboPlan.Box();b.code=code;b.quantity=1;b.closed=true;p.boxes.add(b);}
            List<String> actions=new ArrayList<>();
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,v)->{
                if(!method.getName().equals("execute"))return null;
                if(m.getName().equals("actFbo")){
                    Map<String,String> data=(Map<String,String>)args[2];String action=data.get("action");actions.add(action);
                    if(action.equals("SORTED"))p.phase="CONTROL";
                    else if(action.equals("CONFIRM_BOX")){
                        TsdFboPlan.Box box=null;for(TsdFboPlan.Box b:p.boxes)if(b.code.equals(data.get("targetBoxCode")))box=b;
                        if(box==null||box.confirmed)return Response.error(409,okhttp3.ResponseBody.create(okhttp3.MediaType.parse("application/json"),"{}"));
                        box.confirmed=true;
                    }else if(action.equals("FINISH")){assertTrue(p.boxes.stream().allMatch(b->b.confirmed));p.phase="COMPLETED";}else fail(action);
                }return Response.success(p);
            }));
            FboTwoStageScreen screen=new FboTwoStageScreen(a,new TsdSession("token","Bearer","T","T",UUID.randomUUID().toString(),"Test",Collections.emptyList()),api,"https://example.invalid","request",true,()->{});
            try{idle(screen);find(a.findViewById(android.R.id.content),"Сканировать все короба поставки").performClick();idle(screen);
                String finish="Завершить проверку и сформировать файлы WB";
                assertFalse(find(a.findViewById(android.R.id.content),finish).isEnabled());
                assertNotNull(find(a.findViewById(android.R.id.content),"Осталось отсканировать: NEW, WHOLE"));
                for(String code:new String[]{"FOREIGN","NEW","NEW"}){screen.scannerField().setText(code);screen.submit();idle(screen);}
                assertFalse(find(a.findViewById(android.R.id.content),finish).isEnabled());assertEquals(2,p.packed);
                screen.scannerField().setText("WHOLE");screen.submit();idle(screen);find(a.findViewById(android.R.id.content),finish).performClick();idle(screen);
                assertEquals("COMPLETED",p.phase);assertNotNull(find(a.findViewById(android.R.id.content),"Скачать состав для WB"));assertNotNull(find(a.findViewById(android.R.id.content),"Скачать распределение по коробам для WB"));
                assertEquals(Arrays.asList("SORTED","CONFIRM_BOX","CONFIRM_BOX","CONFIRM_BOX","CONFIRM_BOX","FINISH"),actions);
            }finally{screen.close();}
        }
    }
}
