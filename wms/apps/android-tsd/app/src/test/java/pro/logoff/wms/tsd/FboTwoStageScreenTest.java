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
    // TEST: closing a real packing widget speaks only after the server response.
    @Test public void closingBoxAnnouncesConfirmedClose() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();TsdFboPlan p=plan("PACKING");
            TsdFboPlan.Box box=new TsdFboPlan.Box();box.code="TARGET";p.boxes.add(box);
            List<FboPackingVoice.Cue> spoken=new ArrayList<>();
            FboScanFeedback feedback=new FboScanFeedback(){public void play(boolean hit){}public void close(){}public void prompt(FboPackingVoice.Cue cue){spoken.add(cue);}};
            FboTwoStageScreen screen=open(a,p,true,new AtomicInteger(),()->{},feedback);
            try {
                screen.scannerField().setText("TARGET");screen.submit();waitIdle(screen);
                assertFalse(spoken.contains(FboPackingVoice.Cue.CLOSED));
                box.closed=true; // response supplied by the test API
                find(a.findViewById(android.R.id.content),"Закрыть короб").performClick();waitIdle(screen);
                assertEquals(FboPackingVoice.Cue.CLOSED,spoken.get(spoken.size()-1));
                assertEquals(1,Collections.frequency(spoken,FboPackingVoice.Cue.CLOSED));
            }finally{screen.close();}
        }
    }

    private TextView findAction(View v,String title){
        if(v instanceof android.widget.Button&&((TextView)v).getText().toString().equals(title))return (TextView)v;
        if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++){TextView found=findAction(((ViewGroup)v).getChildAt(i),title);if(found!=null)return found;}return null;
    }
    // TEST: opening either marketplace renders loading before the first server response exists.
    @Test public void fbsRequestsCanRenderBeforeFirstResponse() throws Exception {
        for(String market:new String[]{"WILDBERRIES","OZON"})try(var controller=Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity a=controller.get();
            java.lang.reflect.Field filter=MainActivity.class.getDeclaredField("fbsMarketplaceFilter");filter.setAccessible(true);filter.set(a,market);
            java.lang.reflect.Field busy=MainActivity.class.getDeclaredField("fbsRequestsBusy");busy.setAccessible(true);busy.setBoolean(a,true);
            java.lang.reflect.Field data=MainActivity.class.getDeclaredField("fbsRequests");data.setAccessible(true);data.set(a,null);
            java.lang.reflect.Method render=MainActivity.class.getDeclaredMethod("renderFbsRequestSelectionScreen");render.setAccessible(true);
            render.invoke(a);
            assertNotNull(find(a.findViewById(android.R.id.content),"Подождите, загружаю список заявок"));
            busy.setBoolean(a,false);render.invoke(a);
            assertNotNull(find(a.findViewById(android.R.id.content),"Открытых FBS-заявок пока нет"));
        }
    }
    // TEST: FBS feedback covers the viewport and sold variants retain their existing background.
    @Test public void fbsFeedbackColorsCoverViewport() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var controller=Robolectric.buildActivity(MainActivity.class).setup()){
            MainActivity a=controller.get();
            java.lang.reflect.Field color=MainActivity.class.getDeclaredField("fbsFeedbackColor");color.setAccessible(true);
            java.lang.reflect.Field busy=MainActivity.class.getDeclaredField("fbsBusy");busy.setAccessible(true);
            java.lang.reflect.Method render=MainActivity.class.getDeclaredMethod("renderFbsAssemblyScreen");render.setAccessible(true);
            for(int[] pair:new int[][]{{0xfffecaca,0xffff9494},{0xffbbf7d0,0xffccffcc}}){
                busy.setBoolean(a,false);color.setInt(a,pair[0]);render.invoke(a);
                ViewGroup root=a.findViewById(android.R.id.content);android.widget.ScrollView viewport=(android.widget.ScrollView)root.getChildAt(0);
                assertEquals(pair[1],((ColorDrawable)viewport.getBackground()).getColor());assertTrue(viewport.isFillViewport());
            }
        }
    }
    // TEST: carton lists start collapsed, preserve scanner input, and failures color the entire viewport.
    @Test public void packingListsCollapseWithoutResettingScanner() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var controller=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=controller.get();TsdFboPlan p=plan("PACKING");p.wholeBoxes.add("WHOLE_A");
            TsdFboPlan.Box b=new TsdFboPlan.Box();b.code="WHOLE_B";b.wholeBox=true;b.closed=true;b.quantity=12;p.boxes.add(b);
            FboTwoStageScreen screen=open(a,p,true,new AtomicInteger(),()->{});
            try {
                View root=a.findViewById(android.R.id.content);
                assertNotNull(find(root,"Целые короба: отсканировано 1 из 2 · осталось 1"));
                TextView code=find(root,"WHOLE_A");assertEquals(View.GONE,((View)code.getParent()).getVisibility());
                android.widget.EditText scanner=screen.scannerField();scanner.setText("PARTIAL");
                find(root,"Целые короба к добавлению").performClick();
                assertEquals(View.VISIBLE,((View)code.getParent()).getVisibility());assertSame(scanner,screen.scannerField());assertEquals("PARTIAL",scanner.getText().toString());
                scanner.setText("WRONG");screen.submit();
                ViewGroup container=a.findViewById(android.R.id.content);android.widget.ScrollView viewport=(android.widget.ScrollView)container.getChildAt(0);
                assertEquals(0xffff9494,((ColorDrawable)viewport.getBackground()).getColor());assertTrue(viewport.isFillViewport());
            }finally{screen.close();}
        }
    }
    // TEST: real packing widgets announce box/barcode/KIZ and only confirmed acceptance.
    @Test public void newBoxPackingSpeaksStepsAfterServerConfirmation() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();TsdFboPlan p=plan("PACKING");
            TsdFboPlan.Line line=new TsdFboPlan.Line();line.barcode="2051234567890";line.requiresKiz=true;line.remaining=2;line.picked=2;p.lines.add(line);
            TsdFboPlan.Box box=new TsdFboPlan.Box();box.code="TARGET";p.boxes.add(box);
            List<FboPackingVoice.Cue> spoken=new ArrayList<>();
            FboScanFeedback feedback=new FboScanFeedback(){public void play(boolean hit){fail("Picking sound in packing");}public void close(){}public void prompt(FboPackingVoice.Cue cue){spoken.add(cue);}};
            FboTwoStageScreen screen=open(a,p,true,new AtomicInteger(),()->{},feedback);
            try {
                screen.scannerField().setText("TARGET");screen.submit();waitIdle(screen);
                screen.scannerField().setText(line.barcode);screen.submit();
                if("logoff".equals(BuildConfig.FLAVOR))assertEquals(Arrays.asList(FboPackingVoice.Cue.BOX,FboPackingVoice.Cue.BARCODE,FboPackingVoice.Cue.KIZ),spoken);
                screen.scannerField().setText("TEST-KIZ");screen.submit();waitIdle(screen);
                if("logoff".equals(BuildConfig.FLAVOR))assertEquals(Arrays.asList(FboPackingVoice.Cue.BOX,FboPackingVoice.Cue.BARCODE,FboPackingVoice.Cue.KIZ,FboPackingVoice.Cue.PUT),spoken);
                else assertTrue(spoken.isEmpty());
            }finally{screen.close();}
        }
    }
    // TEST: failed and uncertain PACK_UNIT requests never tell the operator to put the item away.
    @Test public void packingErrorsStaySilentUntilRetryIsConfirmed() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        for(boolean timeout:new boolean[]{false,true})try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();TsdFboPlan p=plan("PACKING");
            TsdFboPlan.Line line=new TsdFboPlan.Line();line.barcode="123";line.requiresKiz=true;line.picked=2;line.remaining=2;p.lines.add(line);
            TsdFboPlan.Box box=new TsdFboPlan.Box();box.code="TARGET";p.boxes.add(box);
            List<FboPackingVoice.Cue> spoken=new ArrayList<>();AtomicInteger attempts=new AtomicInteger();List<String> ids=new ArrayList<>();
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->
                Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,values)->{
                    if(!method.getName().equals("execute"))return null;
                    if(m.getName().equals("actFbo")&&"PACK_UNIT".equals(((Map<?,?>)args[2]).get("action"))){
                        ids.add((String)((Map<?,?>)args[2]).get("operationId"));
                        if(attempts.getAndIncrement()==0){if(timeout)throw new java.io.IOException("lost response");return Response.error(400,okhttp3.ResponseBody.create(okhttp3.MediaType.parse("application/json"),"{}"));}
                    }
                    return Response.success(p);
                }));
            FboScanFeedback feedback=new FboScanFeedback(){public void play(boolean hit){}public void close(){}public void prompt(FboPackingVoice.Cue cue){spoken.add(cue);}};
            FboTwoStageScreen screen=new FboTwoStageScreen(a,new TsdSession("test","Bearer","T","T",UUID.randomUUID().toString(),"Test",Collections.emptyList()),api,"https://example.invalid","request",true,()->{},()->{},feedback);
            try {
                waitIdle(screen);find(a.findViewById(android.R.id.content),"Собрать новые короба").performClick();
                screen.scannerField().setText("TARGET");screen.submit();waitIdle(screen);
                screen.scannerField().setText("123");screen.submit();screen.scannerField().setText("KIZ");screen.submit();waitIdle(screen);
                assertFalse(spoken.contains(FboPackingVoice.Cue.PUT));
                if(timeout)findAction(a.findViewById(android.R.id.content),"Повторить отправку").performClick();
                else{screen.scannerField().setText("KIZ");screen.submit();}
                waitIdle(screen);assertEquals(1,Collections.frequency(spoken,FboPackingVoice.Cue.PUT));
                if(timeout)assertEquals(ids.get(0),ids.get(1));
            }finally{screen.close();}
        }
    }
    // TEST: manual packing accepts a product outside the plan, but never writes before its KIZ.
    @Test public void manualPackingUsesTargetBoxAndBarcodeKizPair() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();TsdFboPlan p=plan("PACKING");p.manualPackingEnabled=true;
            TsdFboPlan.Box box=new TsdFboPlan.Box();box.code="TARGET";p.boxes.add(box);
            List<Map<String,String>> commands=new ArrayList<>();List<FboPackingVoice.Cue> spoken=new ArrayList<>();
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->{
                if(m.getName().equals("actFbo"))commands.add(new LinkedHashMap<>((Map<String,String>)args[2]));
                return Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,values)->method.getName().equals("execute")?Response.success(p):null);
            });
            FboScanFeedback feedback=new FboScanFeedback(){public void play(boolean hit){}public void close(){}public void prompt(FboPackingVoice.Cue cue){spoken.add(cue);}};
            FboTwoStageScreen screen=new FboTwoStageScreen(a,new TsdSession("test","Bearer","T","T",UUID.randomUUID().toString(),"Test",Collections.emptyList()),api,"https://example.invalid","request",true,()->{},()->{},feedback);
            try {
                waitIdle(screen);TextView manual=find(a.findViewById(android.R.id.content),"Добавить товар вручную");
                if(!"logoff".equals(BuildConfig.FLAVOR)){assertNull(manual);return;}
                assertNotNull(manual);manual.performClick();
                screen.scannerField().setText("TARGET");screen.submit();waitIdle(screen);
                assertEquals("MANUAL_OPEN_BOX",commands.get(0).get("action"));
                screen.scannerField().setText("OUTSIDE-PLAN");screen.submit();assertEquals(1,commands.size());
                screen.scannerField().setText("PHYSICAL-KIZ");screen.submit();waitIdle(screen);
                assertEquals("MANUAL_PACK_UNIT",commands.get(1).get("action"));
                assertEquals("TARGET",commands.get(1).get("targetBoxCode"));
                assertEquals("OUTSIDE-PLAN",commands.get(1).get("barcode"));
                assertEquals("PHYSICAL-KIZ",commands.get(1).get("kiz"));
                assertFalse(commands.get(1).containsKey("sourceBoxCode"));
                assertEquals(Arrays.asList(FboPackingVoice.Cue.BOX,FboPackingVoice.Cue.BARCODE,FboPackingVoice.Cue.KIZ,FboPackingVoice.Cue.PUT),spoken);
            }finally{screen.close();}
        }
    }
    // TEST: old servers and disabled deployments do not advertise the manual action.
    @Test public void manualPackingMenuRequiresServerCapability() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();TsdFboPlan p=plan("PACKING");
            FboTwoStageScreen screen=open(a,p,true,new AtomicInteger(),()->{});
            try {
                if("logoff".equals(BuildConfig.FLAVOR))find(a.findViewById(android.R.id.content),"Завершить формирование новых коробов").performClick();
                assertNull(find(a.findViewById(android.R.id.content),"Добавить товар вручную"));
            }finally{screen.close();}
        }
    }
    // TEST: scanner Enter may finish after render and move focus; the KIZ field must reclaim it without a tap.
    @Test public void barcodeMovesFocusToKizAfterScannerEnterCompletes() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();AtomicInteger writes=new AtomicInteger();TsdFboPlan p=plan("PICKING");
            TsdFboPlan.Line line=new TsdFboPlan.Line();line.barcode="2051234567890";line.requiresKiz=true;line.remaining=1;p.lines.add(line);
            FboTwoStageScreen s=open(a,p,false,writes);
            try {
                s.scannerField().setText("PL_1");s.submit();s.scannerField().setText("BOX_1");s.submit();
                Shadows.shadowOf(Looper.getMainLooper()).idle();
                s.scannerField().setText(line.barcode);s.submit();
                android.widget.EditText kiz=s.scannerField();
                View confirm=find(a.findViewById(android.R.id.content),"Подтвердить скан");
                confirm.setFocusableInTouchMode(true);confirm.requestFocus();assertFalse(kiz.hasFocus());
                Shadows.shadowOf(Looper.getMainLooper()).idle();
                assertTrue(kiz.hasFocus());assertEquals("",kiz.getText().toString());assertEquals(0,writes.get());
            }finally{s.close();}
        }
    }
    // TEST: packing and final box checks expose separate progress and preserve the selected phase.
    @Test public void monitorAndScreenSeparateUnitsFromBoxVerification() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            TsdFboPlan p=plan("CONTROL");p.picked=2;p.packed=2;
            TsdFboPlan.Box box=new TsdFboPlan.Box();box.code="T";box.closed=true;box.confirmed=true;p.boxes.add(box);
            FboTwoStageScreen s=open(controller.get(),p,true,new AtomicInteger());
            try {Map<?,?> monitor=s.monitorPayload();assertEquals("CONTROL",monitor.get("stage"));assertEquals(1,monitor.get("total"));assertEquals(1,monitor.get("completed"));
                View root=controller.get().findViewById(android.R.id.content);assertNotNull(find(root,"Отобрано 2 из 2"));assertNotNull(find(root,"Упаковано 2 из 2"));assertNotNull(find(root,"Проверено коробов 1 из 1"));
            }finally{s.close();}
        }
    }
    // TEST: monitor must use the active FBO screen even when stale FBS state still exists.
    @Test public void monitorUsesFboRequestRatherThanStaleFbs() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var controller=Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity a=controller.get();FboTwoStageScreen s=open(a,plan("PICKING"),false,new AtomicInteger());
            try {
                java.lang.reflect.Field screen=MainActivity.class.getDeclaredField("screen");screen.setAccessible(true);
                screen.set(a,Enum.valueOf((Class)screen.getType(),"FBO_TWO_STAGE"));
                java.lang.reflect.Field fbo=MainActivity.class.getDeclaredField("fboTwoStageScreen");fbo.setAccessible(true);fbo.set(a,s);
                java.lang.reflect.Field fbs=MainActivity.class.getDeclaredField("fbsAssembly");fbs.setAccessible(true);fbs.set(a,new TsdFbsAssemblyResponse());
                java.lang.reflect.Method monitor=MainActivity.class.getDeclaredMethod("buildMonitorPayload");monitor.setAccessible(true);
                Map<?,?> payload=(Map<?,?>)monitor.invoke(a);
                assertEquals("request",payload.get("requestId"));assertEquals("PICKING",payload.get("stage"));assertEquals(2,payload.get("total"));
            }finally{s.close();}
        }
    }
    // TEST: a restarted screen can resend the exact persisted KIZ without scanning it again.
    @Test public void lostResponseCanBeRetriedAfterRestartWithoutRescanning() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();TsdFboPlan p=plan("PICKING");
            TsdFboPlan.Line line=new TsdFboPlan.Line();line.barcode="2051234567890";line.requiresKiz=true;line.remaining=2;p.lines.add(line);
            List<Map<String,String>> sent=new ArrayList<>();
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->
                Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,values)->{
                    if(!method.getName().equals("execute"))return null;
                    if(m.getName().equals("actFbo")){sent.add(new LinkedHashMap<>((Map<String,String>)args[2]));if(sent.size()==1)throw new java.io.IOException("lost response");p.picked=1;}
                    return Response.success(p);
                }));
            TsdSession session=new TsdSession("test","Bearer","T","T",UUID.randomUUID().toString(),"Test",Collections.emptyList());
            FboTwoStageScreen s=new FboTwoStageScreen(a,session,api,"https://example.invalid","request",false,()->{});
            try {
                waitIdle(s);s.scannerField().setText("PL_1");s.submit();s.scannerField().setText("BOX_1");s.submit();s.scannerField().setText(line.barcode);s.submit();s.scannerField().setText("kiz");s.submit();waitIdle(s);
                assertNotNull(find(a.findViewById(android.R.id.content),"Подтверждение не получено"));assertFalse(s.scannerField().isEnabled());s.close();
                s=new FboTwoStageScreen(a,session,api,"https://example.invalid","request",false,()->{});waitIdle(s);
                findAction(a.findViewById(android.R.id.content),"Повторить отправку").performClick();waitIdle(s);
                assertEquals(2,sent.size());assertEquals(sent.get(0),sent.get(1));assertNotNull(find(a.findViewById(android.R.id.content),"Принято: 1 шт."));
                assertNull(find(a.findViewById(android.R.id.content),"Повторить отправку"));
            }finally{s.close();}
        }
    }
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
            View root=a.findViewById(android.R.id.content);TextView migration=find(root,"Миграции"),inventory=find(root,"Инвентаризация"),kiz=find(root,"КИЗЫ");
            assertNotNull(migration);assertNotNull(inventory);ViewGroup parent=(ViewGroup)migration.getParent();assertEquals(parent.indexOfChild(migration)+1,parent.indexOfChild(inventory));
            assertNull(find(root,"Сортировка и перемещение"));assertNull(find(root,"Перемещения"));assertNull(find(root,"Сборка паллетов"));
            if(!role.equals("WAREHOUSE_KEEPER")){assertNotNull(kiz);assertEquals(parent.indexOfChild(inventory)+1,parent.indexOfChild(kiz));}
            else assertNull(kiz);
            migration.performClick();root=a.findViewById(android.R.id.content);assertNotNull(find(root,"Перемещения"));assertNotNull(find(root,"Сборка паллетов"));
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
                assertNotNull(find(root,"FBO"));assertNotNull(find(root,"FBS"));assertNull(find(root,"Сборка FBO"));assertNull(find(root,"Упаковка FBO"));assertNull(find(root,"Упаковка FBS"));assertNull(find(root,"Сборка FBO Ozon"));
                find(root,"FBS").performClick();root=a.findViewById(android.R.id.content);
                assertNotNull(find(root,"WB"));assertNotNull(find(root,"Ozon"));
                a.onBackPressed();root=a.findViewById(android.R.id.content);
                find(root,"FBO").performClick();root=a.findViewById(android.R.id.content);
                assertNotNull(find(root,"Сборка FBO"));assertNotNull(find(root,"Упаковка FBO"));
                find(root,"Сборка FBO").performClick();root=a.findViewById(android.R.id.content);
                assertNotNull(find(root,"FBO WB"));assertNotNull(find(root,"FBO Ozon"));
                a.onBackPressed();assertNotNull(find(a.findViewById(android.R.id.content),"Упаковка FBO"));
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
    // TEST: locations and products speak during picking; KIZ, refreshes and packing stay silent.
    @Test public void voiceIncludesPickingLocationsAndBarcodesButNeverKiz() throws Exception {
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
                assertEquals(!packing&&"logoff".equals(BuildConfig.FLAVOR)?Arrays.asList(false,true,false,true):Collections.emptyList(),spoken);
                screen.scannerField().setText("WRONG_PRODUCT");screen.submit();
                screen.scannerField().setText(line.barcode);screen.submit();waitIdle(screen);
                List<Boolean> expected=!packing&&"logoff".equals(BuildConfig.FLAVOR)?Arrays.asList(false,true,false,true,false,true):Collections.emptyList();
                assertEquals(expected,spoken);
                if(requiresKiz){screen.scannerField().setText("010123456789012321SERIAL");screen.submit();waitIdle(screen);}
                assertEquals(expected,spoken);
                find(a.findViewById(android.R.id.content),"Обновить").performClick();waitIdle(screen);
                assertEquals(expected,spoken);
            }finally{screen.close();}
            assertEquals(1,closed.get());
        }
    }
    // TEST: a rejected KIZ leaves barcode recovery available; cancel is local, manual uses the preserved pair.
    @Test public void rejectedPackingScanCanBeCancelledOrAddedManually() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var controller=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=controller.get();TsdFboPlan p=plan("PACKING");p.manualPackingEnabled=true;
            TsdFboPlan.Line line=new TsdFboPlan.Line();line.barcode="123";line.requiresKiz=true;line.picked=3;line.remaining=3;p.lines.add(line);
            TsdFboPlan.Box box=new TsdFboPlan.Box();box.code="TARGET";p.boxes.add(box);
            List<Map<String,String>> commands=new ArrayList<>();
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,values)->{
                if(!method.getName().equals("execute"))return null;
                if(m.getName().equals("actFbo")){
                    Map<String,String> payload=new LinkedHashMap<>((Map<String,String>)args[2]);commands.add(payload);
                    if("PACK_UNIT".equals(payload.get("action")))return Response.error(409,okhttp3.ResponseBody.create(okhttp3.MediaType.parse("application/json"),"{\"message\":\"КИЗ отсутствует. Нужна актуализация.\"}"));
                }
                return Response.success(p);
            }));
            FboTwoStageScreen screen=new FboTwoStageScreen(a,new TsdSession("test","Bearer","T","T",UUID.randomUUID().toString(),"Test",Collections.emptyList()),api,"https://example.invalid","request",true,()->{},()->{},null);
            try{
                waitIdle(screen);find(a.findViewById(android.R.id.content),"Собрать новые короба").performClick();
                screen.scannerField().setText("TARGET");screen.submit();waitIdle(screen);
                screen.scannerField().setText("123");screen.submit();screen.scannerField().setText("BAD-KIZ");screen.submit();waitIdle(screen);
                TextView cancel=find(a.findViewById(android.R.id.content),"Отменить скан");assertNotNull(cancel);assertTrue(cancel.isEnabled());
                int before=commands.size();cancel.performClick();assertEquals(before,commands.size());assertEquals("ШК товара",screen.scannerField().getHint().toString());
                screen.scannerField().setText("123");screen.submit();find(a.findViewById(android.R.id.content),"Добавить КИЗ вручную").performClick();
                assertEquals(before,commands.size());screen.scannerField().setText("REAL-KIZ");screen.submit();waitIdle(screen);
                assertEquals("MANUAL_PACK_UNIT",commands.get(before).get("action"));assertEquals("123",commands.get(before).get("barcode"));assertEquals("REAL-KIZ",commands.get(before).get("kiz"));
                assertEquals("TARGET",commands.get(before).get("targetBoxCode"));assertNotEquals(commands.get(1).get("operationId"),commands.get(before).get("operationId"));
                screen.scannerField().setText("123");screen.submit();screen.scannerField().setText("NEXT-KIZ");screen.submit();waitIdle(screen);
                assertEquals("PACK_UNIT",commands.get(before+1).get("action"));
            }finally{screen.close();}
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
        for(int i=0;i<200;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();if(!field.getBoolean(s)){
 if(packing&&"logoff".equals(BuildConfig.FLAVOR)&&"PACKING".equals(FboScanState.screenPhase(p,true)))find(a.findViewById(android.R.id.content),p.wholeBoxes.isEmpty()?"Собрать новые короба":"Отсканировать целые короба").performClick();
 return s;}Thread.sleep(10);}
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
            try{s.scannerField().setText("NEW_BOX");s.submit();assertEquals(0,mutations.get());assertNotNull(find(a.findViewById(android.R.id.content),"logoff".equals(BuildConfig.FLAVOR)?"Этот короб не ожидается":"Сначала отсканируйте целые короба"));}finally{s.close();}
        }
    }
}
