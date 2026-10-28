package pro.logoff.wms.tsd;

import java.util.*;
import org.junit.Test;
import pro.logoff.wms.tsd.network.TsdFboPlan;
import static org.junit.Assert.*;

public class LamodaPrintRefreshTest {
    private static class Clock implements LamodaPrintRefresh.Scheduler {
        final List<Runnable> queue = new ArrayList<>(); long delay;
        public void post(Runnable r,long ms){queue.add(r);delay=ms;}
        public void cancel(Runnable r){queue.remove(r);}
        void next(){assertEquals(1,queue.size());queue.remove(0).run();}
    }
    private TsdFboPlan plan(String status){
        TsdFboPlan p=new TsdFboPlan();p.marketplace="LAMODA";p.relabelRequired=true;
        TsdFboPlan.RelabelUnit u=new TsdFboPlan.RelabelUnit();u.printStatus=status;
        p.relabelUnits=Arrays.asList(u);return p;
    }
    // TEST: the printer's queued -> claimed -> printed progression needs no operator refresh.
    @Test public void completesAsynchronousPrintWithoutManualRefresh(){
        Clock c=new Clock();int[] reads={0};LamodaPrintRefresh[] loop=new LamodaPrintRefresh[1];
        loop[0]=new LamodaPrintRefresh(c,()->true,()->loop[0].observe(plan(++reads[0]==1?"CLAIMED":"PRINTED"),"logoff"));
        loop[0].observe(plan("QUEUED"),"logoff");c.next();c.next();
        assertEquals(2,reads[0]);assertTrue(c.queue.isEmpty());
    }
    // TEST: a scan/dialog/in-flight action defers reads instead of destroying input or overlapping.
    @Test public void defersWhileOperatorIsBusyAndNeverOverlaps(){
        Clock c=new Clock();boolean[] allowed={false};int[] reads={0};
        LamodaPrintRefresh loop=new LamodaPrintRefresh(c,()->allowed[0],()->reads[0]++);
        loop.observe(plan("QUEUED"),"logoff");loop.observe(plan("QUEUED"),"logoff");
        c.next();assertEquals(0,reads[0]);allowed[0]=true;c.next();assertEquals(1,reads[0]);assertTrue(c.queue.isEmpty());
    }
    // TEST: a failed GET retries reading with backoff; closing cancels pending work.
    @Test public void retriesReadFailuresAndStopsOnClose(){
        Clock c=new Clock();LamodaPrintRefresh[] loop=new LamodaPrintRefresh[1];
        loop[0]=new LamodaPrintRefresh(c,()->true,()->loop[0].failed());
        loop[0].observe(plan("QUEUED"),"logoff");c.next();assertEquals(4000,c.delay);
        c.next();assertEquals(8000,c.delay);loop[0].close();assertTrue(c.queue.isEmpty());
        loop[0].observe(plan("QUEUED"),"logoff");assertTrue(c.queue.isEmpty());
    }
    // TEST: terminal print errors are shown by the plan, with no automatic reprint or polling loop.
    @Test public void terminalStatesAndOtherClientsDoNotPoll(){
        Clock c=new Clock();LamodaPrintRefresh loop=new LamodaPrintRefresh(c,()->true,()->fail("Unexpected read"));
        for(String status:Arrays.asList(null,"PRINTED","FAILED","CANCELLED")){loop.observe(plan(status),"logoff");assertTrue(c.queue.isEmpty());}
        loop.observe(plan("QUEUED"),"ffullhab");assertTrue(c.queue.isEmpty());
        TsdFboPlan wb=plan("QUEUED");wb.marketplace="WILDBERRIES";loop.observe(wb,"logoff");assertTrue(c.queue.isEmpty());
    }
}
