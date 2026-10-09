package pro.logoff.wms.tsd;
import static org.junit.Assert.*;
import java.util.*;
import org.junit.Test;
import pro.logoff.wms.tsd.auth.TsdSession;
public class KizFoundPolicyTest {
 private TsdSession user(String role){return new TsdSession("token","Bearer","dev","TSD","u","Name",Collections.singletonList(role));}
 // TEST: no box or picking task required; return and permission remain separate actions.
 @Test public void foundWithoutBox(){Map<String,Object> row=new HashMap<>();row.put("status","OPEN");row.put("decision","REVIEW");row.put("snapshot",new HashMap<>());
  assertTrue(KizFoundPolicy.canAct("logoff",user("ADMIN"),"OPEN",null));
  for(String action:new String[]{"REUSE","RELABEL","RETURN","REJECT"})assertTrue(KizFoundPolicy.canAct("logoff",user("OWNER"),action,row));
  row.put("resolution","REUSE");assertFalse(KizFoundPolicy.canAct("logoff",user("OWNER"),"REUSE",row));assertTrue(KizFoundPolicy.canAct("logoff",user("OWNER"),"RETURN",row));assertFalse(KizFoundPolicy.canAct("logoff",user("OWNER"),"REJECT",row));
 }
 @Test public void soldAndWorkersDenied(){for(String flavor:new String[]{"ffullhab","platform"})assertFalse(KizFoundPolicy.canAct(flavor,user("OWNER"),"OPEN",null));assertFalse(KizFoundPolicy.canAct("logoff",user("WORKER"),"OPEN",null));}
 @Test public void retiredNeedsRelabel(){Map<String,Object> row=new HashMap<>();row.put("status","OPEN");row.put("decision","RELABEL");assertFalse(KizFoundPolicy.canAct("logoff",user("ADMIN"),"REUSE",row));assertTrue(KizFoundPolicy.canAct("logoff",user("ADMIN"),"RELABEL",row));}
}
