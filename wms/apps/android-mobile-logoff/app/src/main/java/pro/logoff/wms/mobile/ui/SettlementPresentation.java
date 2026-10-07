package pro.logoff.wms.mobile.ui;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Locale;

// FIX: format server amounts without inventing balances or turning missing data into zero.
public final class SettlementPresentation {
    public static String money(Object amount) {
        if(amount==null) return "Нет данных";
        try { return NumberFormat.getCurrencyInstance(new Locale("ru","RU")).format(new BigDecimal(amount.toString())); }
        catch(NumberFormatException error) { return "Нет данных"; }
    }
    public static boolean validPeriod(String from,String to) {
        try { long days=ChronoUnit.DAYS.between(LocalDate.parse(from),LocalDate.parse(to));return days>=0 && days<366; }
        catch(RuntimeException error) {return false;}
    }
}
