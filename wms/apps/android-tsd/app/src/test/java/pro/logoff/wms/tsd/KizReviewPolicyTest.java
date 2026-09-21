package pro.logoff.wms.tsd;
import static org.junit.Assert.*;
import java.util.Collections;
import org.junit.Test;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.TsdKizLocationResponse.Review;

public class KizReviewPolicyTest {
    private TsdSession user(String role){return new TsdSession("token","Bearer","dev","TSD","u","Name",Collections.singletonList(role));}
    @Test public void provenUseOnlyOffersRelabelToAdministrators(){
        // TEST: both choices exist, but permissions and evidence determine the available action.
        Review r=new Review();r.active=true;r.status="OPEN";r.decision="RELABEL";
        assertFalse(KizReviewPolicy.canDecide("logoff",user("OWNER"),null,"REUSE"));
        assertFalse(KizReviewPolicy.canDecide("logoff",user("ADMIN"),r,"REUSE"));
        for(String role:new String[]{"ADMIN","OWNER","SUPER_ADMIN"})assertTrue(KizReviewPolicy.canDecide("logoff",user(role),r,"RELABEL"));
        for(String role:new String[]{"OPERATOR","CLIENT","MANAGER"})assertFalse(KizReviewPolicy.canDecide("logoff",user(role),r,"RELABEL"));
        assertFalse(KizReviewPolicy.canDecide("platform",user("OWNER"),r,"RELABEL"));
        r.decision="REVIEW";assertTrue(KizReviewPolicy.canDecide("logoff",user("OWNER"),r,"REUSE"));
        assertFalse(KizReviewPolicy.canDecide("logoff",user("OWNER"),r,"RELABEL"));
        r.status="APPROVED";assertFalse(KizReviewPolicy.canDecide("logoff",user("OWNER"),r,"REUSE"));
        r.status="OPEN";r.active=false;assertFalse(KizReviewPolicy.canDecide("logoff",user("OWNER"),r,"REUSE"));
    }
}
