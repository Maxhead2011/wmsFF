package pro.logoff.wms.mobile.ui;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
// TEST: native navigation and financial presentation regressions.
public class SoulPoliciesTest {
 @Test public void unknownPostOutcomesStayBlocked(){for(int code:new int[]{0,200,408,409,429,500,502,503,504})assertFalse(OpenClawResultPolicy.definitelyRejected(code));for(int code:new int[]{400,401,403})assertTrue(OpenClawResultPolicy.definitelyRejected(code));}
 @Test public void menuIsUnique(){Set<String> ids=new HashSet<>();for(SoulMenu.Item i:SoulMenu.items(true,p->true))assertTrue(ids.add(i.id));assertTrue(ids.containsAll(Arrays.asList("overview","requests","fbs","settlements","expenses","settings","warehouse","contracts","branches")));}
 @Test public void deniedModulesAreHidden(){for(SoulMenu.Item i:SoulMenu.items(false,p->false)){assertNotEquals("access",i.id);assertNotEquals("settlements",i.id);}}
 @Test public void allSevenGroupsRetained(){assertEquals(7,SoulMenu.GROUPS.length);}
 @Test public void missingMoneyIsNotZero(){assertEquals("Нет данных",SettlementPresentation.money(null));assertEquals("Нет данных",SettlementPresentation.money(Double.NaN));assertEquals("Нет данных",SettlementPresentation.money("bad"));assertNotEquals("Нет данных",SettlementPresentation.money(0));assertTrue(SettlementPresentation.money("100535.37").contains("535"));}
 @Test public void dateBounds(){assertFalse(SettlementPresentation.validPeriod("2026-02-30","2026-03-01"));assertFalse(SettlementPresentation.validPeriod("2026-10-04","2026-10-01"));assertFalse(SettlementPresentation.validPeriod("2024-01-01","2026-01-01"));assertTrue(SettlementPresentation.validPeriod("2026-09-01","2026-10-04"));}
}
