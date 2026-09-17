package pro.logoff.wms.tsd;

import org.junit.Test;
import static org.junit.Assert.*;

// TEST: other users, servers and sold application flavors must never see the personal greeting.
public class PersonalLoginWelcomeStateTest {
    private static final String USER = "8e175b30-8535-4881-9324-a875c9fd8c1d";
    @Test public void onlyOurAuthenticatedAccountIsEligible() {
        assertTrue(PersonalLoginWelcomeState.shouldShow(USER, "logoff", "https://wms.logoff.pro/"));
        assertFalse(PersonalLoginWelcomeState.shouldShow("another", "logoff", "https://wms.logoff.pro/"));
        assertFalse(PersonalLoginWelcomeState.shouldShow(null, "logoff", "https://wms.logoff.pro/"));
        assertFalse(PersonalLoginWelcomeState.shouldShow(USER, "ffullhab", "https://wms.logoff.pro/"));
        assertFalse(PersonalLoginWelcomeState.shouldShow(USER, "platform", "https://wms.logoff.pro/"));
        assertFalse(PersonalLoginWelcomeState.shouldShow(USER, "logoff", "https://wms.ffullhab.ru/"));
        assertFalse(PersonalLoginWelcomeState.shouldShow(USER, "logoff", "https://wms.logoff.pro.example.org/"));
        assertFalse(PersonalLoginWelcomeState.shouldShow(USER, "logoff", "invalid address"));
    }
    @Test public void phraseIsTypedExactlyAndPausesAfterDots() {
        assertEquals("Инчантикс....волшебная пыль", PersonalLoginWelcomeState.TEXT);
        assertEquals("", PersonalLoginWelcomeState.textAt(0, false));
        assertEquals("Ин", PersonalLoginWelcomeState.textAt(400, false));
        assertEquals("Инчантикс....", PersonalLoginWelcomeState.textAt(1200, false));
        assertEquals("Инчантикс....", PersonalLoginWelcomeState.textAt(1350, false));
        assertEquals(PersonalLoginWelcomeState.TEXT, PersonalLoginWelcomeState.textAt(PersonalLoginWelcomeState.duration(false), false));
    }
    @Test public void reducedMotionHasNoTyping() {
        assertEquals(PersonalLoginWelcomeState.TEXT, PersonalLoginWelcomeState.textAt(0, true));
        assertTrue(PersonalLoginWelcomeState.duration(true) < PersonalLoginWelcomeState.duration(false));
    }
}
