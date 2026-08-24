package pro.logoff.wms.tsd;

public final class FbsPalletHintFormatter {
    private FbsPalletHintFormatter() {
    }

    // FIX: Keep the employee hint aggregate-only so pallet, box and route details cannot leak.
    public static String format(int additionalPalletCount, boolean uzbek) {
        int safeCount = Math.max(0, additionalPalletCount);
        if (safeCount == 0) {
            return uzbek
                ? "Bu xonada bu yetkazib berish uchun boshqa pallet yo'q"
                : "В этом помещении больше нет паллет для этой поставки";
        }
        return uzbek
            ? "Bu xonada qolgan palletlar: " + safeCount
            : "В этом помещении осталось паллет: " + safeCount;
    }
}
