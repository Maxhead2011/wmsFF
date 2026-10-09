package pro.logoff.wms.tsd;
import java.util.Map;
import pro.logoff.wms.tsd.auth.TsdSession;
final class KizFoundPolicy {
    // FIX: sold flavor and ordinary pickers cannot submit administrator decisions.
    static boolean canAct(String flavor,TsdSession session,String action,Map<String,Object> row){
        if(!KizLocationPolicy.canOpen(flavor,session))return false;
        if("OPEN".equals(action))return row==null;
        if(row==null||!java.util.Arrays.asList("OPEN","APPROVED").contains(row.get("status")))return false;
        Map<?,?> snapshot=row.get("snapshot") instanceof Map?(Map<?,?>)row.get("snapshot"):java.util.Collections.emptyMap();
        boolean returned=Boolean.TRUE.equals(snapshot.get("returned")),decided=row.get("resolution")!=null;
        if("REUSE".equals(action))return !decided&&!"RELABEL".equals(row.get("decision"));
        if("RELABEL".equals(action))return !decided||"REUSE".equals(row.get("resolution"));
        if("RETURN".equals(action))return !returned;
        if("REJECT".equals(action))return !decided&&!returned;
        return false;
    }
    static String caption(String action){switch(action){case "OPEN":return "Товар у меня — отправить на разбор";case "REUSE":return "Разрешить использовать КИЗ";case "RELABEL":return "Разрешить переклейку";case "RETURN":return "Вернуть на склад";case "REJECT":return "Отклонить обращение";default:return action;}}
}
