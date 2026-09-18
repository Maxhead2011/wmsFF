package pro.logoff.wms.tsd;

import android.content.SharedPreferences;
import com.squareup.moshi.Moshi;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;

// FIX: freeze the task, scan, proposal and Ozon counter before any network request.
final class FbsPendingAction {
    String operationId,action,field,value;
    TsdFbsAssemblyResponse snapshot;
    Map<String,Object> payload;
    static FbsPendingAction create(String action,String field,String value,TsdFbsAssemblyResponse response,Map<String,Object> payload){
        Moshi gson=new Moshi.Builder().build();FbsPendingAction r=new FbsPendingAction();r.operationId=UUID.randomUUID().toString();
        r.action=action;r.field=field;r.value=value;try{r.snapshot=gson.adapter(TsdFbsAssemblyResponse.class).fromJson(gson.adapter(TsdFbsAssemblyResponse.class).toJson(response));}catch(java.io.IOException e){throw new IllegalStateException(e);}
        r.payload=new LinkedHashMap<>(payload);return r;
    }
    static FbsPendingAction read(SharedPreferences prefs,String owner){
        String json=prefs.getString(owner,"");if(json.isEmpty())return null;
        FbsPendingAction r;try{r=new Moshi.Builder().build().adapter(FbsPendingAction.class).fromJson(json);}catch(java.io.IOException e){throw new IllegalStateException(e);}
        if(r==null||r.snapshot==null||r.snapshot.task==null||r.snapshot.task.id==null||r.payload==null||r.operationId==null)
            throw new IllegalStateException("Не удалось прочитать сохранённый запрос ФБС. Обратитесь к менеджеру; повторно товар не сканируйте.");
        return r;
    }
    boolean save(SharedPreferences prefs,String owner){return prefs.edit().putString(owner,new Moshi.Builder().build().adapter(FbsPendingAction.class).toJson(this)).commit();}
    static boolean clear(SharedPreferences prefs,String owner){return prefs.edit().remove(owner).commit();}
    static boolean definitive(int status){return status>=400&&status<500&&status!=401&&status!=403&&status!=408&&status!=429;}
}
