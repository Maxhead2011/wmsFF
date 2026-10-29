package pro.logoff.wms.tsd;

// FIX: account identity, not display name or device, selects the personal voice.
final class PersonalScanVoice {
    static final String ACCOUNT="8e175b30-8535-4881-9324-a875c9fd8c1d";
    static final String SOFIA_ACCOUNT="f89c0efe-dcd2-4dfa-9cea-e35c0c492f83";
    final boolean personal;
    private final boolean tanks;
    private String previousError;
    // FIX: Sofia's approved tank pack is restricted to her account in the LOGOFF flavor.
    PersonalScanVoice(String userId){
        boolean own="logoff".equals(BuildConfig.FLAVOR);
        tanks=own&&SOFIA_ACCOUNT.equals(userId);
        personal=tanks||(own&&ACCOUNT.equals(userId));
    }
    int resource(int common,int eleonora,int sofia){return tanks?sofia:personal?eleonora:common;}
    boolean repeated(String error){
        if(!personal)return false;
        boolean repeat=error!=null&&error.equals(previousError);
        previousError=error;
        return repeat;
    }
    void success(){previousError=null;}
}
