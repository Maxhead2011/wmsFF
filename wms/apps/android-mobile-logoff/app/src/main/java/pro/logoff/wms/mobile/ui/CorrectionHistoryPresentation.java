package pro.logoff.wms.mobile.ui;

import java.util.*;

// FIX: display server values verbatim; page locally without recalculating invoice balances.
public final class CorrectionHistoryPresentation {
    private CorrectionHistoryPresentation() {}
    public static <T> List<T> page(List<T> rows,int offset) {
        if(offset<0 || offset>=rows.size())return Collections.emptyList();
        return new ArrayList<>(rows.subList(offset,Math.min(rows.size(),offset+25)));
    }
    public static String describe(Map<String,Object> row) {
        String kind=value(row,"kind");
        if("LATE_WORK".equals(kind))kind="Поздние работы";
        else if("ADJUSTMENT".equals(kind))kind="Корректировка";
        return "Счёт: "+value(row,"invoiceNumber")+"\n"+kind+": "+SettlementPresentation.money(row.get("amountRub"))+
            "\nОснование: "+value(row,"reason")+"\nАвтор: "+value(row,"author")+"\nДата: "+value(row,"createdAt");
    }
    private static String value(Map<String,Object> row,String key) {
        Object value=row.get(key);return value==null||value.toString().trim().isEmpty()?"Нет данных":value.toString();
    }
}
