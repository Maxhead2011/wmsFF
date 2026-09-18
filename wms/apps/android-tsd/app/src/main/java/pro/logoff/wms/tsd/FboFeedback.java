package pro.logoff.wms.tsd;

import java.util.Map;
import pro.logoff.wms.tsd.network.TsdFboPlan;

// FIX: acknowledge server acceptance separately from barcode recognition and unknown delivery.
final class FboFeedback {
    static String phase(String phase) {
        if("NOT_STARTED".equals(phase))return "Ожидает начала отбора";
        if("PICKING".equals(phase))return "Отбор товара";
        if("PACKING".equals(phase))return "Упаковка";
        if("CONTROL".equals(phase))return "Проверка коробов";
        if("COMPLETED".equals(phase))return "Завершена";
        return "Загрузка заявки";
    }
    static int confirmed(TsdFboPlan plan) {
        int n=0;if(plan!=null&&plan.boxes!=null)for(TsdFboPlan.Box b:plan.boxes)if(b.confirmed)n++;return n;
    }
    static String accepted(Map<String,String> request,TsdFboPlan plan) {
        String action=request.get("action");
        if("PICK_UNIT".equals(action))return "Принято: 1 шт. Товар отобран.";
        if("PACK_UNIT".equals(action))return "Принято: 1 шт. Товар упакован.";
        if("PICK_BOX".equals(action))return "Короб принят: "+request.get("confirmedQuantity")+" шт.";
        if("PACK_BOX".equals(action)&&plan!=null&&plan.boxes!=null)for(TsdFboPlan.Box b:plan.boxes)
            if(b.code.equals(request.get("sourceBoxCode")))return "Короб упакован: "+b.quantity+" шт.";
        if("CONFIRM_BOX".equals(action))return "Короб проверен: "+request.get("targetBoxCode");
        if("FINISH_PICK".equals(action))return "Отбор завершён. Передайте товар на упаковку.";
        if("SORTED".equals(action))return "Упаковка завершена. Сканируйте короба для проверки.";
        if("FINISH".equals(action))return "Проверка завершена. Все короба подтверждены.";
        return "Операция принята";
    }
    static boolean definitiveRejection(int code) {
        return code>=400&&code<500&&code!=401&&code!=403&&code!=408&&code!=429;
    }
}
