package pro.logoff.wms.tsd;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import pro.logoff.wms.tsd.network.TsdFboPlan;

// FIX: barcode and KIZ are a pair; an unanswered command keeps its original id.
final class FboScanState {
    String pallet = "", source = "", target = "", barcode = "";
    private Map<String,String> pending;
    Map<String,String> prepare(String action, String kiz) {
        if (pending != null) return new LinkedHashMap<>(pending);
        Map<String,String> p = new LinkedHashMap<>(); p.put("action",action); p.put("operationId",UUID.randomUUID().toString());
        if (!pallet.isEmpty()) p.put("palletCode",pallet);
        if (!source.isEmpty()) p.put("sourceBoxCode",source);
        if (!target.isEmpty()) p.put("targetBoxCode",target);
        if (!barcode.isEmpty()) p.put("barcode",barcode);
        if (kiz != null && !kiz.isEmpty()) p.put("kiz",kiz);
        pending = p; return new LinkedHashMap<>(p);
    }
    void restore(Map<String,String> value) {
        pending = value == null ? null : new LinkedHashMap<>(value);
        if(value!=null){pallet=value.getOrDefault("palletCode","");source=value.getOrDefault("sourceBoxCode","");target=value.getOrDefault("targetBoxCode","");barcode=value.getOrDefault("barcode","");}
    }
    boolean scanLocation(TsdFboPlan plan,String code) {
        if(pallet.isEmpty())for(TsdFboPlan.Route r:plan.route)if(!r.pallet.isEmpty()&&r.pallet.equalsIgnoreCase(code.trim())){pallet=r.pallet;source="";return true;}
        for(TsdFboPlan.Route r:plan.route)if(r.pallet.equals(pallet)&&r.boxCode.equalsIgnoreCase(code.trim())){source=r.boxCode;return true;}
        return false;
    }
    void reconcile(TsdFboPlan plan) {
        boolean hasPallet=false,hasSource=false,hasTarget=false;
        for(TsdFboPlan.Route r:plan.route){if(r.pallet.equals(pallet))hasPallet=true;if(r.pallet.equals(pallet)&&r.boxCode.equals(source))hasSource=true;}
        for(TsdFboPlan.Box b:plan.boxes)if(b.code.equals(target)&&!b.closed)hasTarget=true;
        if(!hasPallet)pallet="";
        if(!hasSource)source="";
        if(!hasTarget||!"PACKING".equals(plan.phase))target="";
    }
    Map<String,String> pending() { return pending == null ? null : new LinkedHashMap<>(pending); }
    void accepted() { pending=null; barcode=""; }
    void rejected() { pending=null; }
}
