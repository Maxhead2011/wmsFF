package pro.logoff.wms.tsd;
import org.junit.Test;
import static org.junit.Assert.*;
import static pro.logoff.wms.tsd.FboPackingVoice.Cue.*;
public class FboPackingVoiceTest {
    // TEST: an acknowledgement retry or redraw cannot announce the same carton twice.
    @Test public void packedBoxSuccessIsAcknowledgedOnce() {
        FboPackingVoice v=new FboPackingVoice();
        assertNull(v.boxAccepted(null));
        assertEquals(PACKED_BOX,v.boxAccepted("box1"));
        assertNull(v.boxAccepted("box1"));
        v.step(false,true,"","");
        assertNull(v.boxAccepted("box1"));
        assertEquals(PACKED_BOX,v.boxAccepted("box2"));
    }
    // TEST: confirmed close speaks once, never on pending work or a repeated acknowledgement.
    @Test public void closureWaitsForConfirmationAndSurvivesRedraw() {
        FboPackingVoice v=new FboPackingVoice();
        assertEquals(BARCODE,v.step(true,true,"TARGET",""));
        assertNull(v.step(true,false,"TARGET",""));
        assertNull(v.closed(null));
        assertEquals(CLOSED,v.closed("close1"));
        assertNull(v.step(true,true,"",""));
        assertNull(v.closed("close1"));
        assertEquals(BARCODE,v.step(true,true,"NEXT",""));
        assertEquals(CLOSED,v.closed("close2"));
    }
    // TEST: redraws and pending network requests cannot claim successful packing.
    @Test public void transitionsAndAcknowledgementsAreDistinct() {
        FboPackingVoice v=new FboPackingVoice();
        assertEquals(BOX,v.step(true,true,"",""));
        assertNull(v.step(true,true,"",""));
        assertNull(v.step(true,false,"BOX",""));
        assertEquals(BARCODE,v.step(true,true,"BOX",""));
        assertEquals(KIZ,v.step(true,true,"BOX","123"));
        assertNull(v.step(true,false,"BOX","123"));
        assertNull(v.step(true,true,"BOX","123"));
        assertEquals(PUT,v.accepted("op1"));
        assertNull(v.step(true,true,"BOX",""));
        assertNull(v.accepted("op1"));
        assertEquals(KIZ,v.step(true,true,"BOX","123"));
        assertEquals(PUT,v.accepted("op2"));
        assertEquals(BOX,v.step(true,true,"",""));
        assertNull(v.step(false,true,"",""));
        assertEquals(BOX,v.step(true,true,"",""));
    }
}
