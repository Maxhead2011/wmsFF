package pro.logoff.wms.tsd;
import org.junit.Test;
import java.util.Arrays;
import pro.logoff.wms.tsd.network.TsdFboPlan;
import static org.junit.Assert.*;

// TEST: old servers, assigned shops and ambiguous requests have distinct labels.
public class FboStoreContextTest {
    @Test public void preservesLegacyAndShowsUnknown() {
        TsdFboPlan p=new TsdFboPlan();assertEquals("",FboStoreContext.label(p));
        p.storeState="UNASSIGNED";assertEquals("Магазин не определён",FboStoreContext.label(p));
    }
    @Test public void neverChoosesOneOfTwoShops() {
        TsdFboPlan p=new TsdFboPlan();p.storeState="MIXED";p.storeNames=Arrays.asList("Монларти","Брайбо");
        assertEquals("Магазин: Монларти, Брайбо · несколько магазинов",FboStoreContext.label(p));
    }
}
