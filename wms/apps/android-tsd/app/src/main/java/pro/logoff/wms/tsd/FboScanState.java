package pro.logoff.wms.tsd;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import pro.logoff.wms.tsd.network.TsdFboPlan;

// FIX: barcode and KIZ are a pair; an unanswered command keeps its original id.
final class FboScanState {
    // FIX: use the selected carton's destination, not the demand of the whole request.
    static String packingDirectionError(TsdFboPlan plan, String boxCode, String barcode) {
        String direction=null;
        if(plan.boxes!=null)for(TsdFboPlan.Box box:plan.boxes)
            if(boxCode.equals(box.code)&&!box.closed)direction=box.direction;
        if(direction==null||plan.directions==null)return "Обновите план: направление короба не найдено.";
        for(TsdFboPlan.Direction d:plan.directions)if(direction.equals(d.name)){
            if(d.items==null)return "Обновите план: состав направления не загружен.";
            boolean required=false;int remaining=0;
            for(TsdFboPlan.DirectionItem i:d.items)if(barcode.equals(i.barcode)&&i.quantity>0){required=true;remaining+=Math.max(0,i.quantity-i.packed);}
            if(!required)return "Товар не нужен в направлении «"+direction+"»";
            if(remaining==0)return "В направлении «"+direction+"» этот товар уже упакован полностью";
            return null;
        }
        return "Обновите план: направление короба не найдено.";
    }
    // FIX: manual additions intentionally reopen a closed carton; ordinary packing must report duplicates.
    static boolean alreadyPackedBox(TsdFboPlan plan, String code, boolean manual) {
        if (!plan.reusablePackingEnabled || manual || code == null || plan.boxes == null) return false;
        for (TsdFboPlan.Box box : plan.boxes)
            if (box.closed && box.quantity > 0 && code.trim().equalsIgnoreCase(box.code)) return true;
        return false;
    }
    // FIX: picking every unit from a shelf bin does not mean taking the bin itself.
    static boolean reusableBin(TsdFboPlan plan, String code) {
        return plan.reusablePackingEnabled && code != null && code.toUpperCase(java.util.Locale.ROOT).startsWith("FFL_LKBBOX_");
    }
    static String wholePickTitle(TsdFboPlan plan, String code) {
        return reusableBin(plan, code) ? "Весь товар из бокса отобран" : "Короб забран целиком";
    }
    // FIX: changing entry point never changes the persisted phase or performs a stock operation.
    static boolean phaseAllowed(boolean packing,String phase) {
        return packing ? "PACKING".equals(phase)||"CONTROL".equals(phase)||"COMPLETED".equals(phase)
            : "NOT_STARTED".equals(phase)||"PICKING".equals(phase);
    }
    // FIX: a scanned product survives restart before a box has been scanned.
    boolean productMode, productReady;
    String lastPackingOperation="", lastPackingBox="", lastPackingBarcode="";
    String productKiz = "";
    String direction = "";
    String pallet = "", source = "", target = "", barcode = "";
    // FIX: navigation survives reopening; pending stock commands are stored independently.
    Map<String,String> checkpoint() {
        Map<String,String> p=new LinkedHashMap<>();p.put("palletCode",pallet);p.put("sourceBoxCode",source);
        p.put("productMode",String.valueOf(productMode));p.put("productReady",String.valueOf(productReady));p.put("productKiz",productKiz);
        p.put("lastPackingOperation",lastPackingOperation);p.put("lastPackingBox",lastPackingBox);p.put("lastPackingBarcode",lastPackingBarcode);
        p.put("targetBoxCode",target);p.put("barcode",barcode);p.put("direction",direction);return p;
    }
    void restoreCheckpoint(Map<String,String> value) {
        if(value==null)return;lastPackingOperation=value.getOrDefault("lastPackingOperation","");lastPackingBox=value.getOrDefault("lastPackingBox","");lastPackingBarcode=value.getOrDefault("lastPackingBarcode","");productMode=Boolean.parseBoolean(value.get("productMode"));productReady=Boolean.parseBoolean(value.get("productReady"));productKiz=value.getOrDefault("productKiz","");direction=value.getOrDefault("direction","");pallet=value.getOrDefault("palletCode","");source=value.getOrDefault("sourceBoxCode","");
        target=value.getOrDefault("targetBoxCode","");barcode=value.getOrDefault("barcode","");
    }
    private Map<String,String> pending;
    Map<String,String> prepare(String action, String kiz) { return prepare(action, kiz, null); }
    // FIX: persist quantity together with the operation id so a retry cannot change it.
    Map<String,String> prepare(String action, String kiz, Integer confirmedQuantity) {
        if (pending != null) return new LinkedHashMap<>(pending);
        Map<String,String> p = new LinkedHashMap<>(); p.put("action",action); p.put("operationId",UUID.randomUUID().toString());
        if ("UNDO_PACK_UNIT".equals(action)) p.put("undoOperationId",lastPackingOperation);
        if (!direction.isEmpty()) p.put("direction",direction);
        if (!pallet.isEmpty()) p.put("palletCode",pallet);
        if (!source.isEmpty()) p.put("sourceBoxCode",source);
        if (!target.isEmpty()) p.put("targetBoxCode",target);
        if (!barcode.isEmpty()) p.put("barcode",barcode);
        if (kiz != null && !kiz.isEmpty()) p.put("kiz",kiz);
        if (confirmedQuantity != null) p.put("confirmedQuantity", String.valueOf(confirmedQuantity));
        pending = p; return new LinkedHashMap<>(p);
    }
    // FIX: save accepted packing identity with the same commit that clears the pending command.
    Map<String,String> confirmedPosition(Map<String,String> payload) {
        Map<String,String> p=checkpoint();p.put("barcode","");p.put("productKiz","");p.put("productReady","false");
        String action=payload.get("action");
        if("PACK_UNIT".equals(action)||"PACK_PRODUCT".equals(action)) {
            p.put("lastPackingOperation",payload.get("operationId"));p.put("lastPackingBox",payload.getOrDefault("targetBoxCode",""));p.put("lastPackingBarcode",payload.getOrDefault("barcode",""));
        } else {
            p.put("lastPackingOperation","");p.put("lastPackingBox","");p.put("lastPackingBarcode","");
        }
        return p;
    }
    void restore(Map<String,String> value) {
        pending = value == null ? null : new LinkedHashMap<>(value);
        if(value!=null){if("PACK_PRODUCT".equals(value.get("action"))){productMode=true;productReady=true;productKiz=value.getOrDefault("kiz","");}direction=value.getOrDefault("direction","");pallet=value.getOrDefault("palletCode","");source=value.getOrDefault("sourceBoxCode","");target=value.getOrDefault("targetBoxCode","");barcode=value.getOrDefault("barcode","");}
    }
    boolean scanLocation(TsdFboPlan plan,String code) {
        return scanLocation(plan.route,code);
    }
    // FIX: accept only locations in the active picking route; legacy callers retain the full route.
    boolean scanLocation(java.util.List<TsdFboPlan.Route> route,String code) {
        if(pallet.isEmpty())for(TsdFboPlan.Route r:route)if(!r.pallet.isEmpty()&&r.pallet.equalsIgnoreCase(code.trim())){pallet=r.pallet;source="";return true;}
        for(TsdFboPlan.Route r:route)if(r.pallet.equals(pallet)&&r.boxCode.equalsIgnoreCase(code.trim())){source=r.boxCode;return true;}
        return false;
    }
    // FIX: workflow selection never changes the persisted collection phase.
    static String screenPhase(TsdFboPlan plan, boolean packing) {
        return packing && plan.parallelPackingSupported && plan.picked > 0 && "PICKING".equals(plan.phase) ? "PACKING" : plan.phase;
    }
    void reconcile(TsdFboPlan plan) { reconcile(plan, false); }
    void reconcile(TsdFboPlan plan, boolean packing) {
        String phase = screenPhase(plan, packing);
        boolean hasPallet=false,hasSource=false,hasTarget=false;
        for(TsdFboPlan.Route r:plan.route){if(r.pallet.equals(pallet))hasPallet=true;if(r.pallet.equals(pallet)&&r.boxCode.equals(source))hasSource=true;}
        for(TsdFboPlan.Box b:plan.boxes)if(b.code.equals(target)&&!b.closed)hasTarget=true;
        if(!hasPallet)pallet="";
        if(!hasSource)source="";
        if(!hasTarget||!"PACKING".equals(phase))target="";
        if(("PICKING".equals(phase)&&source.isEmpty())||("PACKING".equals(phase)&&target.isEmpty()&&!productMode))barcode="";
        if(!barcode.isEmpty()){
            boolean needed=false;if(plan.lines!=null)for(TsdFboPlan.Line line:plan.lines)
                if(barcode.equals(line.barcode)&&("PICKING".equals(phase)?line.remaining>0:"PACKING".equals(phase)&&line.picked>line.packed))needed=true;
            if(!needed)barcode="";
        }
    }
    Map<String,String> pending() { return pending == null ? null : new LinkedHashMap<>(pending); }
    void accepted() { pending=null; barcode=""; productKiz=""; productReady=false; }
    void rejected() { pending=null; }
}
