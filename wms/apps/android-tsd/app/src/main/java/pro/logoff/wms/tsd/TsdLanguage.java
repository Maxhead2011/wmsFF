package pro.logoff.wms.tsd;

// FIX: stable stored codes; translated captions never become protocol values.
final class TsdLanguage {
    static final String[] CODES = {"ru", "uz", "en"};
    static final String[] NAMES = {"Русский", "O‘zbekcha", "English"};
    static String normalize(String code) {
        for (String supported : CODES) if (supported.equals(code)) return supported;
        return "ru";
    }
    static int index(String code) {
        for (int i=0;i<CODES.length;i++) if(CODES[i].equals(code)) return i;
        return 0;
    }
    static String selected(int index) { return index>=0 && index<CODES.length ? CODES[index] : "ru"; }
    static boolean enabled(String flavor) { return "logoff".equals(flavor); }
    private TsdLanguage() {}
}
