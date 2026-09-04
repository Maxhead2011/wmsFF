package pro.logoff.wms.tsd.network;

public class TsdInventoryLine {
    public String id;
    public String skuId;
    public String skuName;
    public String internalSku;
    public String barcode;
    public int expectedQuantity;
    public int countedQuantity;
    public int difference;
    public String decision;
    // ADDED: optional response fields for LOGOFF barcode/KIZ counting.
    public String scanState;
    public boolean duplicate;
}
