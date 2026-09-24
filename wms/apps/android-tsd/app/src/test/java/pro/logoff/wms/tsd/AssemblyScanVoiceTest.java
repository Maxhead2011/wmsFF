package pro.logoff.wms.tsd;

import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class AssemblyScanVoiceTest {
    // TEST: an HTTP-200 pallet without needed boxes is a miss, for WB and Ozon alike.
    @Test public void successfulPalletResponseCanStillBeAMiss() {
        var r=new TsdFbsAssemblyResponse();r.palletScan=new TsdFbsAssemblyResponse.PalletScan();r.palletScan.code="PL_01";
        assertEquals(false,AssemblyScanVoice.fbs("scan-any","SCAN_BOX","pl_01",200,r));
        r.palletScan.neededBoxes=2;
        assertEquals(true,AssemblyScanVoice.fbs("scan-box","PALLET_BOXES","PL_01",200,r));
    }
    // TEST: a response must actually confirm the scanned box/product, including switching to another order.
    @Test public void acceptedBoxesAndProductsSpeakForBothMarketplaces() {
        for(String marketplace:new String[]{"WILDBERRIES","OZON"}) {
            var r=new TsdFbsAssemblyResponse();r.task=new TsdFbsAssemblyResponse.Task();r.task.marketplace=marketplace;
            r.task.scannedBoxCode="BOX_1";r.task.scannedBarcode="2051234567890";
            assertEquals(true,AssemblyScanVoice.fbs("scan-box","SCAN_BOX","box_1",200,r));
            assertEquals(true,AssemblyScanVoice.fbs("scan-any","SCAN_BARCODE","2051234567890",200,r));
            assertNull(AssemblyScanVoice.fbs("scan-any","SCAN_BARCODE","OTHER",200,r));
        }
    }
    // TEST: wrong codes speak; network/auth/rate-limit failures never masquerade as a wrong product.
    @Test public void businessRejectionsSpeakButTransportAndAccessFailuresDoNot() {
        for(int status:new int[]{400,404,409,422})assertEquals(false,AssemblyScanVoice.fbs("scan-box","SCAN_BOX","WRONG",status,null));
        for(int status:new int[]{401,403,408,429,500,503})assertNull(AssemblyScanVoice.fbs("scan-box","SCAN_BOX","BOX_1",status,null));
    }
    // TEST: all KIZ paths, malformed KIZ at its own step and universal-scanner KIZ stay silent.
    @Test public void kizAndNonScanActionsNeverSpeak() {
        String kiz="0104680992599759215SERIAL\u001d91EE12";
        for(int status:new int[]{200,400,409}) {
            assertNull(AssemblyScanVoice.fbs("scan-any","SCAN_BARCODE",kiz,status,null));
            assertNull(AssemblyScanVoice.fbs("scan-any","SCAN_BOX","]d20104680992599759215SERIAL",status,null));
            for(String state:new String[]{"SCAN_KIZ","SCAN_NEW_KIZ"})assertNull(AssemblyScanVoice.fbs("scan-any",state,"BAD",status,null));
            for(String action:new String[]{"scan-kiz","scan-kiz-move","undo-kiz","release","complete"})assertNull(AssemblyScanVoice.fbs(action,"SCAN_BARCODE","BAD",status,null));
        }
    }
    private void set(MainActivity a,String field,Object value) throws Exception {
        var f=MainActivity.class.getDeclaredField(field);f.setAccessible(true);f.set(a,value);
    }
    private void screen(MainActivity a,String value) throws Exception {
        var f=MainActivity.class.getDeclaredField("screen");f.setAccessible(true);f.set(a,Enum.valueOf((Class)f.getType(),value));
    }
    // TEST: the real activity routes voices only to assembly screens in our flavor and releases them on pause.
    @Test public void activityVoiceHonorsScreenFlavorKizAndPause() throws Exception {
        try(var c=Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity a=c.get();List<Boolean> spoken=new ArrayList<>();int[] closed={0};
            set(a,"assemblyScanVoice",new FboScanFeedback(){public void play(boolean hit){spoken.add(hit);}public void close(){closed[0]++;}});
            var method=MainActivity.class.getDeclaredMethod("speakAssemblyScan",Boolean.class,String.class);method.setAccessible(true);
            for(String screen:new String[]{"FBS_ASSEMBLY","OZON_FBO_BOXES","OZON_FBO_ASSEMBLY"}) {
                screen(a,screen);method.invoke(a,true,"BOX_1");method.invoke(a,false,"WRONG");
                method.invoke(a,true,"0104680992599759215SERIAL");method.invoke(a,null,"BOX_1");
            }
            assertEquals("logoff".equals(BuildConfig.FLAVOR)?Arrays.asList(true,false,true,false,true,false):Collections.emptyList(),spoken);
            int count=spoken.size();c.pause();method.invoke(a,true,"BOX_1");assertEquals(count,spoken.size());assertEquals(1,closed[0]);
        }
    }
}
