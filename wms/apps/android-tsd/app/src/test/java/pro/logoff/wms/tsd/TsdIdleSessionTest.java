package pro.logoff.wms.tsd;
import static org.junit.Assert.*;
import android.content.SharedPreferences;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.auth.TsdIdleSession;
import okhttp3.*;
import java.lang.reflect.Proxy;
import java.util.*;

// TEST: inactivity, not heartbeat or eight-hour uptime, determines the terminal lock.
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class TsdIdleSessionTest {
    long time=1000000;int locks;SharedPreferences prefs;TsdIdleSession gate;
    TsdIdleSession.Clock clock=new TsdIdleSession.Clock(){public long elapsed(){return time;}public long wall(){return time+100000;}};
    @Before public void init(){prefs=RuntimeEnvironment.getApplication().getSharedPreferences("idle-test",0);prefs.edit().clear().commit();gate=new TsdIdleSession(prefs,clock,()->locks++,null);gate.login("Bearer A");}
    @Test public void backgroundChecksDoNotExtend(){for(int i=0;i<14;i++){time+=60000;assertTrue(gate.check());}time+=60000;assertFalse(gate.check());assertEquals(1,locks);}
    @Test public void inputAtExpiryCannotRevive(){time+=900000;assertFalse(gate.input());assertFalse(gate.activeFor("Bearer A"));}
    @Test public void activeShiftCanExceedEightHours(){for(int i=0;i<12*60;i++){time+=60000;assertTrue(gate.input());}assertEquals(0,locks);}
    @Test public void restartDoesNotResetDeadline(){time+=800000;gate=new TsdIdleSession(prefs,clock,()->locks++,"Bearer A");assertTrue(gate.check());time+=100000;assertFalse(gate.check());}
    @Test public void clockRollbackLocks(){time-=1000;assertFalse(gate.check());}
    @Test public void onlyOurBrandOptsIntoServerIdlePolicy(){
        Boolean expected="logoff".equals(BuildConfig.FLAVOR)?Boolean.TRUE:null;
        assertEquals(expected,new pro.logoff.wms.tsd.network.TsdLoginRequest().idleSession);
    }
    @Test public void oldEmployeeCannotSendAfterNewLogin(){gate.login("Bearer B");assertFalse(gate.activeFor("Bearer A"));assertTrue(gate.activeFor("Bearer B"));}
    @Test public void pendingScanIsPreserved(){SharedPreferences pending=RuntimeEnvironment.getApplication().getSharedPreferences("fbo-pending",0);pending.edit().putString("worker:request","original-operation-id").commit();time+=900000;gate.check();gate.clear();gate.login("Bearer B");assertEquals("original-operation-id",pending.getString("worker:request",null));}
    private Interceptor.Chain chain(Request request,List<Request> calls,int status){
        return (Interceptor.Chain)Proxy.newProxyInstance(Interceptor.Chain.class.getClassLoader(),new Class<?>[]{Interceptor.Chain.class},(p,m,args)->{
            if(m.getName().equals("request"))return request;
            if(m.getName().equals("proceed")){Request sent=(Request)args[0];calls.add(sent);
                return new Response.Builder().request(sent).protocol(Protocol.HTTP_1_1).code(status).message("test")
                    .body(ResponseBody.create(MediaType.parse("application/json"),"{}")).build();}
            throw new UnsupportedOperationException(m.getName());
        });
    }
    private Request request(){return new Request.Builder().url("https://test/api/v1/tsd/requests/1/fbo/actions/ack")
        .header("Authorization","Bearer A").header("X-Operation-Id","unchanged-operation").build();}
    @Test public void pollingNeverSendsActivity()throws Exception{
        List<Request> calls=new ArrayList<>();time+=60000;
        try(Response ignored=gate.intercept(chain(request(),calls,200))){}
        assertEquals(1,calls.size());assertEquals(request().url(),calls.get(0).url());
        time+=840000;assertFalse(gate.check());
    }
    @Test public void activityIsAcknowledgedWithoutChangingOperationIdentity()throws Exception{
        List<Request> calls=new ArrayList<>();time+=60000;gate.input();
        try(Response ignored=gate.intercept(chain(request(),calls,200))){}
        assertEquals(2,calls.size());assertEquals("/api/v1/tsd/session/activity",calls.get(0).url().encodedPath());
        assertEquals("unchanged-operation",calls.get(1).header("X-Operation-Id"));
        time+=60000;assertNull(gate.activityRequest(request().url()));
    }
    @Test public void unauthorizedActivityStopsBusinessRequest()throws Exception{
        List<Request> calls=new ArrayList<>();time+=60000;gate.input();
        try(Response result=gate.intercept(chain(request(),calls,401))){assertEquals(401,result.code());}
        assertEquals(1,calls.size());assertTrue(gate.locked());
    }
    @Test public void expiredInputDoesNotReachServer()throws Exception{
        List<Request> calls=new ArrayList<>();time+=900000;
        try(Response result=gate.intercept(chain(request(),calls,200))){assertEquals(401,result.code());}
        assertTrue(calls.isEmpty());
    }
    @Test public void lateInputBypassesThrottleNearServerDeadline(){
        time+=850000;gate.input();assertNotNull(gate.activityRequest(request().url()));
        time+=10000;gate.input();assertNotNull(gate.activityRequest(request().url()));
    }
}
