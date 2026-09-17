package pro.logoff.wms.tsd;

import android.app.Activity;
import android.app.AlertDialog;
import org.robolectric.shadows.ShadowAlertDialog;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
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
public class FboTwoStageScreenTest {
    // TEST: successful whole-box picks and rejected stale routes both remove the old source from widgets.
    @Test public void wholeBoxSuccessAndRouteConflictReconcileTheScreen() throws Exception {
        for(boolean conflict:new boolean[]{false,true})try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();TsdFboPlan initial=plan("PICKING");initial.route.get(0).wholeBox=true;initial.route.get(0).wholeBoxQuantity=2;
            TsdFboPlan next=plan("PICKING");next.route.get(0).boxCode="BOX_2";next.picked=conflict?0:1;
            AtomicInteger reads=new AtomicInteger(),writes=new AtomicInteger();
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)-> {
                final boolean write=m.getName().equals("actFbo");
                return Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,values)-> {
                    if(!method.getName().equals("execute"))return null;
                    if(write){assertEquals("2",((Map<?,?>)args[2]).get("confirmedQuantity"));writes.incrementAndGet();if(conflict)return Response.error(409,okhttp3.ResponseBody.create(okhttp3.MediaType.parse("application/json"),"{\"message\":\"Маршрут изменился\"}"));return Response.success(next);}
                    return Response.success(reads.incrementAndGet()==1?initial:next);
                });
            });
            FboTwoStageScreen s=new FboTwoStageScreen(a,new TsdSession("test","Bearer","T","T",UUID.randomUUID().toString(),"Test",Collections.emptyList()),api,"https://example.invalid","request",false,()->{});
            try {
                waitIdle(s);s.scannerField().setText("PL_1");s.submit();s.scannerField().setText("BOX_1");s.submit();
                find(a.findViewById(android.R.id.content),"Короб забран целиком").performClick();
                AlertDialog dialog=ShadowAlertDialog.getLatestAlertDialog();
                assertEquals(0,writes.get());
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();assertEquals(0,writes.get());
                s.scannerField().setText("1");dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();assertEquals(0,writes.get());
                s.scannerField().setText("2");dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();waitIdle(s);
                View root=a.findViewById(android.R.id.content);assertNull(find(root,"BOX_1"));assertNotNull(find(root,"BOX_2"));
                assertNotNull(find(root,"Отобрано "+next.picked));assertEquals(1,writes.get());assertEquals(conflict?2:1,reads.get());
            }finally{s.close();}
        }
    }
    // TEST: opening transfers is navigation only, without an implicit pick or stock mutation.
    @Test public void pickerCanChooseScansOrTransferRemainder() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();TsdFboPlan p=plan("PICKING");p.route.get(0).remainderQuantity=3;
            AtomicInteger writes=new AtomicInteger(),moves=new AtomicInteger();
            FboTwoStageScreen s=open(a,p,false,writes,moves::incrementAndGet);
            try {
                s.scannerField().setText("PL_1");s.submit();s.scannerField().setText("BOX_1");s.submit();
                find(a.findViewById(android.R.id.content),"Отобрать товар по ШК + КИЗ").performClick();
                assertEquals(0,writes.get());assertEquals(0,moves.get());
                find(a.findViewById(android.R.id.content),"Переместить ненужный остаток").performClick();
                assertEquals(1,moves.get());assertEquals(0,writes.get());
            }finally{s.close();}
        }
    }
    private void waitIdle(FboTwoStageScreen s) throws Exception {
        java.lang.reflect.Field field=FboTwoStageScreen.class.getDeclaredField("busy");field.setAccessible(true);
        for(int i=0;i<200;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();if(!field.getBoolean(s))return;Thread.sleep(10);}
        fail("FBO request did not finish");
    }
    // TEST: grouped menus retain role restrictions and the required main-menu order.
    @Test public void migrationAndKizGroupsPreserveExistingAccess() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        for(String role:new String[]{"OWNER","ADMIN","OPERATOR","WAREHOUSE_KEEPER"})try(var controller=Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity a=controller.get();var prefs=a.getSharedPreferences("logoff_wms_tsd_session",0);
            prefs.edit().putString("access_token","test").putString("device_code","TEST").putString("user_id","test").putString("user_name","Test").putString("role_codes",role).commit();
            java.lang.reflect.Method render=MainActivity.class.getDeclaredMethod("renderMainScreen");render.setAccessible(true);render.invoke(a);
            View root=a.findViewById(android.R.id.content);TextView migration=find(root,"МИГРАЦИЯ"),inventory=find(root,"Инвентаризация"),kiz=find(root,"КИЗЫ");
            assertNotNull(migration);assertNotNull(inventory);ViewGroup parent=(ViewGroup)migration.getParent();assertEquals(parent.indexOfChild(migration)+1,parent.indexOfChild(inventory));
            assertNull(find(root,"Сортировка и перемещение"));assertNull(find(root,"Перемещения"));
            if(!role.equals("WAREHOUSE_KEEPER")){assertNotNull(kiz);assertEquals(parent.indexOfChild(inventory)+1,parent.indexOfChild(kiz));}
            else assertNull(kiz);
            migration.performClick();root=a.findViewById(android.R.id.content);assertNotNull(find(root,"Перемещения"));
            assertEquals(role.equals("OWNER")||role.equals("ADMIN"),find(root,"Сортировка и перемещение")!=null);
            if(kiz!=null){render.invoke(a);find(a.findViewById(android.R.id.content),"КИЗЫ").performClick();root=a.findViewById(android.R.id.content);assertNotNull(find(root,"Поиск КИЗ"));assertEquals(!role.equals("OPERATOR"),find(root,"Проверка КИЗ")!=null);}
            prefs.edit().clear().commit();
        }
    }
    // TEST: product feedback is independent of the previously scanned box and does not pick before KIZ.
    @Test public void productBarcodeIsGreenAndUnneededBarcodeIsRedInBothStages() throws Exception {
        for(boolean packing:new boolean[]{false,true})try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();AtomicInteger mutations=new AtomicInteger();TsdFboPlan p=plan(packing?"PACKING":"PICKING");
            TsdFboPlan.Line line=new TsdFboPlan.Line();line.barcode="2051234567890";line.requiresKiz=true;line.remaining=1;line.picked=1;p.lines.add(line);
            if(packing){TsdFboPlan.Box box=new TsdFboPlan.Box();box.code="TARGET";p.boxes.add(box);}
            FboTwoStageScreen s=open(a,p,packing,mutations);
            try {
                java.lang.reflect.Field field=FboTwoStageScreen.class.getDeclaredField("state");field.setAccessible(true);
                FboScanState state=(FboScanState)field.get(s);
                if(packing)state.target="TARGET";else{state.pallet="PL_1";state.source="BOX_1";}
                s.scannerField().setText("WRONG_PRODUCT");s.submit();
                TextView bad=find(a.findViewById(android.R.id.content),"Этот ШК не требуется");assertNotNull(bad);
                assertEquals(Color.rgb(254,202,202),((ColorDrawable)bad.getBackground()).getColor());assertEquals("",state.barcode);
                s.scannerField().setText(line.barcode);s.submit();
                TextView good=find(a.findViewById(android.R.id.content),"Нужный товар");assertNotNull(good);
                assertEquals(Color.rgb(187,247,208),((ColorDrawable)good.getBackground()).getColor());
                assertEquals(line.barcode,state.barcode);assertNotNull(find(a.findViewById(android.R.id.content),"КИЗ товара"));assertEquals(0,mutations.get());
            }finally{s.close();}
        }
    }
    // TEST: only our installation replaces packing and nests Ozon; sold variants retain their menu.
    @Test public void menuIsSeparatedOnlyInOurInstallation() throws Exception {
        try(var controller=Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity a=controller.get();
            a.getSharedPreferences("logoff_wms_tsd_session",0).edit().putString("access_token","test")
                .putString("device_code","TEST").putString("user_id","test").putString("user_name","Test")
                .putString("role_codes","ADMIN").commit();
            java.lang.reflect.Method render=MainActivity.class.getDeclaredMethod("renderMainScreen");render.setAccessible(true);render.invoke(a);
            View root=a.findViewById(android.R.id.content);
            if("logoff".equals(BuildConfig.FLAVOR)) {
                assertNotNull(find(root,"Сборка FBO"));assertNotNull(find(root,"Упаковка FBO"));assertNull(find(root,"Упаковка FBS"));assertNull(find(root,"Сборка FBO Ozon"));
                find(root,"Сборка FBO").performClick();root=a.findViewById(android.R.id.content);
                assertNotNull(find(root,"FBO WB"));assertNotNull(find(root,"FBO Ozon"));
            } else {assertNotNull(find(root,"Упаковка FBS"));assertNotNull(find(root,"Сборка FBO Ozon"));assertNull(find(root,"Упаковка FBO"));}
            a.getSharedPreferences("logoff_wms_tsd_session",0).edit().clear().commit();
        }
    }
    // TEST: a whole-box instruction includes its total before any stock mutation; sold apps keep their UI.
    @Test public void wholeBoxInstructionShowsQuantityOnlyForWholeBox() throws Exception {
        for(boolean whole:new boolean[]{true,false})try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();AtomicInteger mutations=new AtomicInteger();TsdFboPlan p=plan("PICKING");
            p.route.get(0).wholeBox=whole;p.route.get(0).wholeBoxQuantity=35;
            FboTwoStageScreen s=open(a,p,false,mutations);
            try {
                s.scannerField().setText("PL_1");s.submit();s.scannerField().setText("BOX_1");s.submit();
                TextView notice=find(a.findViewById(android.R.id.content),"Короб уезжает целиком");
                if(whole&&"logoff".equals(BuildConfig.FLAVOR)) {
                    assertNotNull(notice);assertTrue(notice.getText().toString().contains("35"));
                    assertEquals(Color.rgb(187,247,208),((ColorDrawable)notice.getBackground()).getColor());
                } else assertNull(notice);
                assertEquals(0,mutations.get());
            }finally{s.close();}
        }
    }
    // TEST: only a product barcode speaks; location scans, KIZ, refreshes and packing are silent.
    @Test public void voiceIsOnlyForPickingBarcodesAndNeverKiz() throws Exception {
        for(boolean packing:new boolean[]{false,true})for(boolean requiresKiz:new boolean[]{true,false})
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();AtomicInteger mutations=new AtomicInteger();List<Boolean> spoken=new ArrayList<>();
            AtomicInteger closed=new AtomicInteger();
            FboScanFeedback feedback=new FboScanFeedback(){public void play(boolean hit){spoken.add(hit);}public void close(){closed.incrementAndGet();}};
            TsdFboPlan p=plan(packing?"PACKING":"PICKING");
            TsdFboPlan.Line line=new TsdFboPlan.Line();line.barcode="2051234567890";line.requiresKiz=requiresKiz;line.remaining=1;line.picked=1;p.lines.add(line);
            if(packing){TsdFboPlan.Box b=new TsdFboPlan.Box();b.code="TARGET";p.boxes.add(b);}
            FboTwoStageScreen screen=open(a,p,packing,mutations,null,feedback);
            try {
                if(packing){screen.scannerField().setText("TARGET");screen.submit();waitIdle(screen);}
                else {
                    for(String code:new String[]{"WRONG_PALLET","PL_1","WRONG_BOX","BOX_1"}){screen.scannerField().setText(code);screen.submit();}
                }
                assertTrue(spoken.isEmpty());
                screen.scannerField().setText("WRONG_PRODUCT");screen.submit();
                screen.scannerField().setText(line.barcode);screen.submit();waitIdle(screen);
                List<Boolean> expected=!packing&&"logoff".equals(BuildConfig.FLAVOR)?Arrays.asList(false,true):Collections.emptyList();
                assertEquals(expected,spoken);
                if(requiresKiz){screen.scannerField().setText("010123456789012321SERIAL");screen.submit();waitIdle(screen);}
                assertEquals(expected,spoken);
                find(a.findViewById(android.R.id.content),"Обновить").performClick();waitIdle(screen);
                assertEquals(expected,spoken);
            }finally{screen.close();}
            assertEquals(1,closed.get());
        }
    }
    private TsdFboPlan plan(String phase) {
        TsdFboPlan p=new TsdFboPlan();p.phase=phase;p.title="Test";p.needed=2;
        p.lines=new ArrayList<>();p.route=new ArrayList<>();p.boxes=new ArrayList<>();p.wholeBoxes=new ArrayList<>();
        TsdFboPlan.Route r=new TsdFboPlan.Route();r.boxCode="BOX_1";r.pallet="PL_1";r.zone="Zone";r.tasks=new ArrayList<>();p.route.add(r);return p;
    }
    private FboTwoStageScreen open(Activity a,TsdFboPlan p,boolean packing,AtomicInteger mutations) throws Exception {
        return open(a,p,packing,mutations,null);
    }
    private FboTwoStageScreen open(Activity a,TsdFboPlan p,boolean packing,AtomicInteger mutations,Runnable move) throws Exception {
        return open(a,p,packing,mutations,move,null);
    }
    private FboTwoStageScreen open(Activity a,TsdFboPlan p,boolean packing,AtomicInteger mutations,Runnable move,FboScanFeedback feedback) throws Exception {
        WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->{
            if(m.getName().equals("actFbo"))mutations.incrementAndGet();
            return Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,values)->{
                if(method.getName().equals("execute"))return Response.success(p);return null;
            });
        });
        FboTwoStageScreen s=new FboTwoStageScreen(a,new TsdSession("test","Bearer","T","T",UUID.randomUUID().toString(),"Test",Collections.emptyList()),api,"https://example.invalid","request",packing,()->{},move,feedback);
        java.lang.reflect.Field field=FboTwoStageScreen.class.getDeclaredField("busy");field.setAccessible(true);
        for(int i=0;i<200;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();if(!field.getBoolean(s))return s;Thread.sleep(10);}
        fail("Plan did not load");return s;
    }
    private TextView find(View v,String text){
        if(v instanceof TextView && ((TextView)v).getText().toString().contains(text))return (TextView)v;
        if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++){TextView r=find(((ViewGroup)v).getChildAt(i),text);if(r!=null)return r;}return null;
    }
    // TEST: real widgets show yellow route, red rejection, green accepted box; location scans never write stock.
    @Test public void palletAndBoxFeedbackDoesNotMutateStock() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=controller.get();AtomicInteger mutations=new AtomicInteger();FboTwoStageScreen s=open(a,plan("PICKING"),false,mutations);
            try{
                s.scannerField().setText("PL_1");s.submit();
                TextView box=find(a.findViewById(android.R.id.content),"→ BOX_1");assertNotNull(box);
                assertEquals(Color.rgb(254,240,138),((ColorDrawable)box.getBackground()).getColor());
                s.scannerField().setText("WRONG");s.submit();
                TextView rejection=find(a.findViewById(android.R.id.content),"не требуется");assertNotNull(rejection);
                assertEquals(Color.rgb(254,202,202),((ColorDrawable)rejection.getBackground()).getColor());
                s.scannerField().setText("BOX_1");s.submit();
                TextView accepted=find(a.findViewById(android.R.id.content),"Нужный короб");assertNotNull(accepted);
                assertEquals(Color.rgb(187,247,208),((ColorDrawable)accepted.getBackground()).getColor());assertEquals(0,mutations.get());
            }finally{s.close();}
        }
    }
    // TEST: wrong entry point cannot expose a scanner, and whole boxes precede loose packing.
    @Test public void packingCannotPickAndMustScanWholeBoxesFirst() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=controller.get();AtomicInteger mutations=new AtomicInteger();FboTwoStageScreen s=open(a,plan("PICKING"),true,mutations);
            assertNull(s.scannerField());s.close();
            TsdFboPlan p=plan("PACKING");p.wholeBoxes.add("WHOLE");s=open(a,p,true,mutations);
            try{s.scannerField().setText("NEW_BOX");s.submit();assertEquals(0,mutations.get());assertNotNull(find(a.findViewById(android.R.id.content),"Сначала отсканируйте целые короба"));}finally{s.close();}
        }
    }
}
