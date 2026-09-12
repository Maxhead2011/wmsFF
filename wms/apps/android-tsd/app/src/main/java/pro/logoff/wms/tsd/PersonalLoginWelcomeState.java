package pro.logoff.wms.tsd;

import java.net.URI;

// FIX: identity comes from the successful server response, never a typed login or display name.
final class PersonalLoginWelcomeState {
    static final String TEXT = "Инчантикс....волшебная пыль";
    private static final String ACCOUNT = "8e175b30-8535-4881-9324-a875c9fd8c1d";
    private static final int PREFIX_LENGTH = "Инчантикс....".length();
    private static final long LETTER_DELAY = 70L;

    static boolean shouldShow(String userId, String flavor, String baseUrl) {
        if (!ACCOUNT.equals(userId) || !"logoff".equals(flavor) || baseUrl == null) return false;
        try {
            return "wms.logoff.pro".equalsIgnoreCase(new URI(baseUrl).getHost());
        } catch (Exception ignored) {
            return false;
        }
    }

    static String textAt(long elapsed, boolean reducedMotion) {
        if (reducedMotion) return TEXT;
        long typingTime = Math.max(0L, elapsed - 250L);
        long pausedTime = typingTime > PREFIX_LENGTH * LETTER_DELAY
            ? Math.max(PREFIX_LENGTH * LETTER_DELAY, typingTime - 350L) : typingTime;
        return TEXT.substring(0, (int) Math.min(TEXT.length(), pausedTime / LETTER_DELAY));
    }

    static long duration(boolean reducedMotion) {
        return reducedMotion ? 1400L : 250L + TEXT.length() * LETTER_DELAY + 350L + 900L;
    }
}
