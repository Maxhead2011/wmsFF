package pro.logoff.wms.tsd;

import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;

// FIX: classify physical scan results, not HTTP success or translated error messages.
final class AssemblyScanVoice {
    static boolean isKiz(String value) {
        String code=clean(value);
        return code.indexOf('\u001d')>=0 || code.matches("(?is)^(?:\\]d2)?01[0-9]{14}21.+")
            || code.startsWith("(01)");
    }
    static boolean rejected(int status) { return status==400 || status==404 || status==409 || status==422; }
    static Boolean fbs(String action,String state,String value,int status,TsdFbsAssemblyResponse result) {
        if (clean(value).isEmpty() || isKiz(value) || "SCAN_KIZ".equals(state) || "SCAN_NEW_KIZ".equals(state)) return null;
        if (!"scan-any".equals(action) && !"scan-box".equals(action) && !"scan-barcode".equals(action)) return null;
        if (rejected(status)) return false;
        if (status<200 || status>=300 || result==null) return null;
        if (result.palletScan!=null && same(value,result.palletScan.code)) {
            return result.palletScan.neededBoxes>0 || (result.palletScan.neededBoxCodes!=null && !result.palletScan.neededBoxCodes.isEmpty());
        }
        if (result.task!=null && (same(value,result.task.scannedBoxCode) || same(value,result.task.scannedBarcode))) return true;
        return null;
    }
    private static boolean same(String a,String b) { return !clean(b).isEmpty() && clean(a).equalsIgnoreCase(clean(b)); }
    private static String clean(String s) { return s==null?"":s.trim(); }
    private AssemblyScanVoice() { }
}
