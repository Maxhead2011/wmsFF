package pro.logoff.wms.tsd;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class OzonLabelSafetyTest {
    // TEST: only our app bypasses both PDF and bitmap rendering entirely.
    @Test
    public void usesTextOnlyForOurTerminals() {
        assertTrue(OzonLabelSafety.usesTextInstruction("logoff"));
        assertFalse(OzonLabelSafety.usesTextInstruction("ffullhab"));
        assertFalse(OzonLabelSafety.usesTextInstruction("platform"));
    }
    // TEST: PDF must never reach Android PdfRenderer on an ATOL terminal.
    @Test
    public void rejectsPdfContentTypes() {
        assertFalse(OzonLabelSafety.canRenderOnTsd("application/pdf"));
        assertFalse(OzonLabelSafety.canRenderOnTsd("Application/PDF; charset=binary"));
        assertFalse(OzonLabelSafety.canRenderOnTsd(null));
    }

    // TEST: the server-rendered PNG remains printable on the terminal.
    @Test
    public void acceptsPngContentType() {
        assertTrue(OzonLabelSafety.canRenderOnTsd("image/png"));
    }
}
