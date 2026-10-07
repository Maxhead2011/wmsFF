package pro.logoff.wms.mobile.ui;
// FIX: these responses reject before job creation in the verified WMS controller/service.
public final class OpenClawResultPolicy {
    public static boolean definitelyRejected(int code){return code==400||code==401||code==403;}
}
