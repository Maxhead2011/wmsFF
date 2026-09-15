package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdKizLocationResponse {
    public boolean found;
    public boolean ambiguous;
    public String identity;
    public List<Match> matches;
    public static class Match {
        public String id, client, status, boxCode, boxStatus, palletCode, room, warehouse, locationWarning;
        public Product product;
    }
    public static class Product {
        public String id, name, article, size, color;
    }
}
