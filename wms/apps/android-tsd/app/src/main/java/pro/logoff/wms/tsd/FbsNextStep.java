package pro.logoff.wms.tsd;
import java.util.Locale;
final class FbsNextStep {
    static boolean changed(String code,String message){
        String lower=message==null?"":message.toLowerCase(Locale.ROOT);
        return "FBS_TASK_STALE".equals(code)||lower.contains("не требуется собирать")||lower.contains("заказ изменился")||lower.contains("заказ отменён")||lower.contains("заказ перенесён");
    }
    // FIX: explain distinct physical situations without inventing returns or changing stock.
    static String explain(String code,String message,boolean taken){
        String text=message==null?"":message;String lower=text.toLowerCase(Locale.ROOT);
        if(changed(code,message))
            return text+"\n"+(taken?"Уже взятый товар отложите отдельно с номером заказа. Не возвращайте его в короб без решения менеджера.":"Товар для этого задания больше не отбирайте.")+" Откройте список заявок и выберите актуальное задание.";
        if(lower.contains("зарезервирован")||lower.contains("занят другой сборкой"))
            return text+"\nОстаток занят другой сборкой — это не означает, что товара физически нет. Обновите маршрут; если свободного источника нет, обратитесь к менеджеру.";
        return text;
    }
}
