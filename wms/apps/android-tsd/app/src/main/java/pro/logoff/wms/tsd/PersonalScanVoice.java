package pro.logoff.wms.tsd;

// FIX: account identity, not display name or device, selects the personal voice.
final class PersonalScanVoice {
    static final String ACCOUNT="8e175b30-8535-4881-9324-a875c9fd8c1d";
    final boolean personal;
    private String previousError;
    PersonalScanVoice(String userId){personal="logoff".equals(BuildConfig.FLAVOR)&&ACCOUNT.equals(userId);}
    boolean repeated(String error){
        if(!personal)return false;
        boolean repeat=error!=null&&error.equals(previousError);
        previousError=error;
        return repeat;
    }
    void success(){previousError=null;}
}
