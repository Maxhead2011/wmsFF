package pro.logoff.wms.tsd;
import java.io.IOException;
import java.util.Map;
import pro.logoff.wms.tsd.network.*;
import retrofit2.Response;

// FIX: persist the server session before opening its box; failed reads never create a replacement.
final class MandatoryFbsAuditLoader {
 interface Checkpoint { void save(String id) throws IOException; }
 interface ErrorText { String message(Response<?> response); }
 static final class Result {
  final TsdInventorySession session; final TsdInventoryBox box;
  Result(TsdInventorySession s,TsdInventoryBox b){session=s;box=b;}
 }
 static Result load(WmsApi api,String auth,String sessionId,String boxCode,Map<String,Object> request,Checkpoint checkpoint,ErrorText errors)throws IOException {
  Response<TsdInventorySession> response=sessionId.isEmpty()?api.startInventory(auth,request).execute():api.getInventory(auth,sessionId,false).execute();
  if(!response.isSuccessful()||response.body()==null)throw new IOException(errors.message(response));
  TsdInventorySession session=response.body();
  if(session.id==null||session.id.isEmpty())throw new IOException("Сервер не вернул номер проверки. Повторите открытие.");
  checkpoint.save(session.id);
  TsdInventoryBox box=null;
  if(session.boxes!=null)for(TsdInventoryBox b:session.boxes)if(b!=null&&boxCode.equalsIgnoreCase(b.boxCode)){box=b;break;}
  if(box==null){
   Response<TsdInventoryBox> opened=api.openInventoryBox(auth,session.id,java.util.Collections.singletonMap("boxCode",boxCode)).execute();
   if(!opened.isSuccessful()||opened.body()==null)throw new IOException(errors.message(opened));
   box=opened.body();
  }
  return new Result(session,box);
 }
}
