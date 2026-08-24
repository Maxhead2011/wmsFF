package pro.logoff.wms.tsd;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

public class FbsPalletHintFormatterTest {
    // TEST: The worker sees only a short aggregate hint, never pallet or box details.
    @Test
    public void russianHintShowsOnlyAdditionalPalletCount() {
        String hint = FbsPalletHintFormatter.format(3, false);

        assertEquals("В этом помещении осталось паллет: 3", hint);
        assertFalse(hint.contains("PALET_SORT"));
        assertFalse(hint.contains("FFL_"));
    }

    // TEST: Zero has a dedicated completion message without route details.
    @Test
    public void russianHintExplainsThatNoAdditionalPalletsRemain() {
        assertEquals(
            "В этом помещении больше нет паллет для этой поставки",
            FbsPalletHintFormatter.format(0, false)
        );
    }
}
