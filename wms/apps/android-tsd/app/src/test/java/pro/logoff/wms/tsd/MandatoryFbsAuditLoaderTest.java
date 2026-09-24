package pro.logoff.wms.tsd;
import org.junit.Test;import static org.junit.Assert.*;import java.lang.reflect.Proxy;import java.io.IOException;import java.util.*;import java.util.concurrent.atomic.*;import pro.logoff.wms.tsd.network.*;import retrofit2.*;import okhttp3.ResponseBody;
public class MandatoryFbsAuditLoaderTest {
 interface Reply {Object run(String method)throws IOException;}
 WmsApi api(Reply reply){return (WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(p,m,a)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(q,n,b)->{if(n.getName().equals("execute"))return reply.run(m.getName());throw new AssertionError(n.getName());}));}
 TsdInventorySession session(){TsdInventorySession s=new TsdInventorySession();s.id="saved";return s;}
 MandatoryFbsAuditLoader.Result load(WmsApi api,String id,MandatoryFbsAuditLoader.Checkpoint c)throws IOException{return MandatoryFbsAuditLoader.load(api,"auth",id,"BOX",new HashMap<>(),c,r->"HTTP "+r.code());}
 // TEST: losing the box-open response must retry the saved session, not start another one.
 @Test public void resumesSameSessionAfterOpenFailure()throws Exception{
 AtomicReference<String> saved=new AtomicReference<>("");AtomicInteger starts=new AtomicInteger(),opens=new AtomicInteger();TsdInventorySession s=session();
 WmsApi api=api(method->{if(method.equals("startInventory")){starts.incrementAndGet();return Response.success(s);}if(method.equals("getInventory"))return Response.success(s);if(method.equals("openInventoryBox")){assertEquals("saved",saved.get());if(opens.incrementAndGet()==1)throw new IOException("offline");TsdInventoryBox b=new TsdInventoryBox();b.id="box";b.boxCode="BOX";return Response.success(b);}throw new AssertionError(method);});
 try{load(api,"",saved::set);fail();}catch(IOException e){assertEquals("offline",e.getMessage());}
 assertEquals("box",load(api,saved.get(),saved::set).box.id);assertEquals(1,starts.get());assertEquals(2,opens.get());
 }
 // TEST: server, authorization and not-found errors never silently reset the audit identifier.
 @Test public void readErrorsNeverStartReplacement()throws Exception{for(int status:new int[]{403,404,500,503}){AtomicReference<String> saved=new AtomicReference<>("saved");WmsApi api=api(m->{assertEquals("getInventory",m);return Response.error(status,ResponseBody.create(okhttp3.MediaType.parse("text/plain"),"failure"));});try{load(api,saved.get(),saved::set);fail();}catch(IOException e){assertEquals("HTTP "+status,e.getMessage());}assertEquals("saved",saved.get());}}
 // TEST: a retry discovers a box already opened by a request whose response was lost.
 @Test public void existingBoxNeedsNoSecondOpen()throws Exception{TsdInventorySession s=session();TsdInventoryBox b=new TsdInventoryBox();b.id="existing";b.boxCode="box";s.boxes.add(b);assertEquals("existing",load(api(m->{assertEquals("getInventory",m);return Response.success(s);}),"saved",id->{}).box.id);}
 // TEST: do not open a box if its session identifier could not be checkpointed.
 @Test public void checkpointFailureStopsNextMutation()throws Exception{try{load(api(m->{assertEquals("startInventory",m);return Response.success(session());}),"",id->{throw new IOException("disk");});fail();}catch(IOException e){assertEquals("disk",e.getMessage());}}
}
