package pro.logoff.wms.tsd;

import static org.junit.Assert.*;
import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.TsdKizLocationResponse;

public class KizLocationPolicyTest {
    private static final String CODE = "0104640569959539215eCUd%lbPYtuV";
    private TsdSession session(String role) {
        return new TsdSession("token", "Bearer", "device", "TSD", "user", "Admin", Collections.singletonList(role));
    }
    @Test public void onlyAdministratorsAndAboveInOurInstallationSeeMenu() {
        // TEST: UI roles mirror the API and all sold flavors stay unchanged.
        for (String role : Arrays.asList("ADMIN", "OWNER", "SUPER_ADMIN")) {
            assertTrue(KizLocationPolicy.canOpen("logoff", session(role)));
            assertFalse(KizLocationPolicy.canOpen("ffullhab", session(role)));
            assertFalse(KizLocationPolicy.canOpen("platform", session(role)));
        }
        for (String role : Arrays.asList("MANAGER", "CLIENT", "OPERATOR", "WAREHOUSE_KEEPER")) {
            assertFalse(KizLocationPolicy.canOpen("logoff", session(role)));
        }
        assertFalse(KizLocationPolicy.canOpen("logoff", null));
    }
    @Test public void autoSubmitWaitsForCompleteKizInsteadOfProductBarcode() {
        // TEST: scanner prefix, GS and parenthesized AI input all reach the same read-only search.
        assertTrue(KizLocationPolicy.readyToSubmit(CODE));
        assertTrue(KizLocationPolicy.readyToSubmit("]d2" + CODE + "\u001d91EE12\u001d92signature"));
        assertTrue(KizLocationPolicy.readyToSubmit(CODE + "<GS>91EE12<GS>92signature"));
        assertTrue(KizLocationPolicy.readyToSubmit("(01)04640569959539(21)5eCUd%lbPYtuV"));
        assertTrue(KizLocationPolicy.readyToSubmit("0104640569959539\u001d215eCUd%lbPYtuV"));
        assertFalse(KizLocationPolicy.readyToSubmit("2051610924437"));
        assertFalse(KizLocationPolicy.readyToSubmit(CODE.substring(0, 28)));
        assertFalse(KizLocationPolicy.readyToSubmit(null));
    }
    @Test public void formatsProductBoxPalletAndRoomWithoutInventingMissingLocations() {
        // TEST: all four requested facts appear, while missing placement stays explicit.
        TsdKizLocationResponse r = found();
        String text = KizLocationPolicy.describe(r);
        assertTrue(text.contains("Товар: Костюм Соул"));
        assertTrue(text.contains("Короб: FFL_BOX_25"));
        assertTrue(text.contains("Паллет: PALET_SORT_02"));
        assertTrue(text.contains("Помещение: Помещение 1"));
        r.matches.get(0).boxCode = null; r.matches.get(0).palletCode = null; r.matches.get(0).room = null;
        r.matches.get(0).status = "PACKING";
        text = KizLocationPolicy.describe(r);
        assertTrue(text.contains("без привязки к коробу")); assertTrue(text.contains("не назначен"));
        assertTrue(text.contains("Упаковка — уже отобран")); assertFalse(text.contains("PALET_SORT_02"));
    }
    @Test public void missingAndAmbiguousResponsesRemainDistinct() {
        // TEST: no stale previous product is shown for a not-found or failed lookup.
        assertEquals("КИЗ не найден в системе.", KizLocationPolicy.describe(new TsdKizLocationResponse()));
        assertTrue(KizLocationPolicy.describe(null).contains("Повторите"));
        TsdKizLocationResponse r = found(); r.ambiguous = true;
        assertTrue(KizLocationPolicy.describe(r).contains("нескольких записях"));
    }
    private TsdKizLocationResponse found() {
        TsdKizLocationResponse r = new TsdKizLocationResponse(); r.found = true;
        TsdKizLocationResponse.Match m = new TsdKizLocationResponse.Match();
        m.product = new TsdKizLocationResponse.Product(); m.product.name = "Костюм Соул"; m.product.size = "S / 42";
        m.boxCode = "FFL_BOX_25"; m.palletCode = "PALET_SORT_02"; m.room = "Помещение 1";
        m.warehouse = "ФФ Москва"; m.client = "Лукин"; m.status = "AVAILABLE";
        r.matches = Collections.singletonList(m); return r;
    }
    @Test public void historyDoesNotTurnAvailableStockIntoAutomaticRelabel() {
        // TEST: first request, exact event/time and REVIEW survive formatting without inventing a sale.
        TsdKizLocationResponse r=found();
        var reuse=new TsdKizLocationResponse.Reuse();reuse.decision="REVIEW";reuse.message="Нужна проверка";
        var history=new TsdKizLocationResponse.History();history.event="Архивная сборка";
        history.at="2026-09-04T14:36:38.000Z";history.orderId="5664720661";
        history.request=new TsdKizLocationResponse.Request();history.request.number=646;
        reuse.history=Collections.singletonList(history);r.matches.get(0).reuse=reuse;
        String text=KizLocationPolicy.describe(r);
        assertTrue(text.contains("Нужна проверка"));assertTrue(text.contains("646"));
        assertTrue(text.contains("04.09.2026 17:36:38 МСК"));assertFalse(text.contains("Нужна переклейка"));
    }
}
