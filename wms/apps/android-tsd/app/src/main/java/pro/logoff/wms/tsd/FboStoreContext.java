package pro.logoff.wms.tsd;
import pro.logoff.wms.tsd.network.TsdFboPlan;

// FIX: an unknown or mixed seller is explicit; SKU ownership cannot identify the shop.
public final class FboStoreContext {
    private FboStoreContext() {}
    public static String label(TsdFboPlan plan) {
        if (plan == null || plan.storeState == null) return "";
        if ("UNASSIGNED".equals(plan.storeState) || plan.storeNames == null || plan.storeNames.isEmpty()) return "Магазин не определён";
        StringBuilder names=new StringBuilder();
        for(String name:plan.storeNames){if(names.length()>0)names.append(", ");names.append(name);}
        return "Магазин: " + names + ("MIXED".equals(plan.storeState) ? " · несколько магазинов" : "");
    }
}
