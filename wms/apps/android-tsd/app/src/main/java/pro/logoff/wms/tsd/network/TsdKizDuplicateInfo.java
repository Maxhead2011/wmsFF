package pro.logoff.wms.tsd.network;

/** FIX: authoritative receipt provenance, distinct from the current stock location. */
public class TsdKizDuplicateInfo {
    public String identity;
    public String firstReceivedAt;
    public String firstBoxCode;
    public String productName;
    public String barcode;
    public String currentStatus;
    public String currentBoxCode;
    public String reviewId;
}
