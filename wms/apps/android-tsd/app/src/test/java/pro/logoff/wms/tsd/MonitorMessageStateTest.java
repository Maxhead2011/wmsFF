package pro.logoff.wms.tsd;
import org.junit.Test;
import static org.junit.Assert.*;

// TEST: repeated polls never close/reopen a message or confirm a scan as read.
public class MonitorMessageStateTest {
    @Test public void pollIsNotAcknowledgement() {
        MonitorMessageState state = new MonitorMessageState();
        assertTrue(state.offer("token", "one"));
        assertFalse(state.offer("token", "one"));
        assertFalse(state.offer("token", "two"));
        assertTrue(state.beginAck());
        assertFalse(state.beginAck());
        state.ackFailed();
        assertTrue(state.beginAck());
        state.ackSucceeded();
        assertFalse(state.offer("token", "one"));
        assertTrue(state.offer("token", "two"));
    }
    @Test public void accountChangeDiscardsOldMessage() {
        MonitorMessageState state = new MonitorMessageState();
        state.offer("old", "one");
        state.reset();
        assertFalse(state.beginAck());
        assertTrue(state.offer("new", "one"));
    }
}
