package pro.logoff.wms.tsd.network;

public class TsdSkuInfo {
    public String id;
    public String skuId;
    public String internalSku;
    public String clientSku;
    public String article;
    public String name;
    public String color;
    public String size;
    public String barcode;
    public boolean needsChestnyZnak;
    public boolean isUnmarked;
    public boolean isDraft;
    public String imageUrl;
    public String photoUrl;

    public String displayName(String fallbackBarcode) {
        String title = name == null || name.trim().isEmpty() ? "Новый товар: " + fallbackBarcode : name.trim();
        String details = joinNonEmpty(article, color, size);
        return details.isEmpty() ? title : title + "\n" + details;
    }

    private static String joinNonEmpty(String first, String second, String third) {
        StringBuilder builder = new StringBuilder();
        append(builder, first);
        append(builder, second);
        append(builder, third);
        return builder.toString();
    }

    private static void append(StringBuilder builder, String value) {
        if (value == null || value.trim().isEmpty()) {
            return;
        }
        if (builder.length() > 0) {
            builder.append(" · ");
        }
        builder.append(value.trim());
    }
}
