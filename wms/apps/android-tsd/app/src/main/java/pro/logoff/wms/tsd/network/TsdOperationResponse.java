package pro.logoff.wms.tsd.network;

public class TsdOperationResponse {
    public String operationKey;
    public String operationType;
    public String status;
    public String message;
    public String reviewReason;
    public String resolutionMessage;
    public String serverTime;
    // FIX: retain per-operation conflicts beyond the two-message sync summary.
    public String code;
    public boolean duplicate;
    public TsdKizDuplicateInfo duplicateInfo;
    public String clientId;
    public String kiz;
    public String boxCode;
    public String sourceDocument;
}
