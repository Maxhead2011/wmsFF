package pro.logoff.wms.mobile.ui;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;

// FIX: native destinations only; permission checks supplement, never replace, server checks.
public final class SoulMenu {
    public static final String[] GROUPS = {"Клиентский контур", "Маркетплейсы", "Склад и операции", "Управление", "Контроль", "Логистика", "Финансы"};
    public static final class Item {
        public final int group;
        public final String id, title;
        Item(int group, String id, String title) { this.group=group; this.id=id; this.title=title; }
    }
    public static List<Item> items(boolean admin, Predicate<String> can) {
        List<Item> out = new ArrayList<>();
        add(out,0,"overview","Кабинет");
        if (!admin || can.test("skus:read")) add(out,0,"catalog","Каталог");
        if (admin && can.test("billing:read")) add(out,0,"contracts","Договоры");
        if (!admin) add(out,0,"profile","Профиль компании");
        add(out,1,"requests","Заявки"); add(out,1,"fbs","FBS");
        add(out,2,"receipts","Онлайн-приёмка");
        if (!admin || can.test("warehouse:read")) add(out,2,"warehouse","Склад и короба");
        if (!admin || can.test("stock:read")) { add(out,2,"stock","Остатки"); add(out,2,"turnover","Товарооборот"); }
        if (admin && can.test("stock:read")) add(out,2,"inventory","Инвентаризация");
        if (admin && can.test("system:admin")) add(out,2,"kiz","КИЗ · проблемные коды");
        if (admin && can.test("skus:read")) add(out,2,"relabeling","Переклейка");
        String[][] management={{"clients","Клиенты","clients:read"},{"access","Доступы","users:read"},{"branches","Филиалы","warehouse:read"},{"imports","Импорт","imports:write"},{"own-companies","Собственные компании","billing:read"},{"print","Печать","print:write"}};
        for(String[] item:management) if(admin && can.test(item[2])) add(out,3,item[0],item[1]);
        if(!admin || can.test("billing:read")) add(out,3,"services","Услуги");
        add(out,3,"settings","Настройки и профиль"); add(out,3,"notifications","Уведомления");
        if(admin && can.test("system:admin")) { add(out,4,"service","Сервис и контроль ТСД"); add(out,4,"administration","Администрирование"); }
        if(admin) add(out,4,"ai","ИИ · OpenClaw");
        if(!admin || can.test("logistics:read")) add(out,5,"logistics","Логистика");
        add(out,6,"invoices","Счета");
        if(can.test("billing:read")) add(out,6,"settlements","Клиенты и расчёты");
        if(admin && can.test("billing:read")) add(out,6,"billing","Биллинг");
        if(admin && can.test("expenses:read")) add(out,6,"expenses","Расходы");
        return out;
    }
    private static void add(List<Item> out,int group,String id,String title) { out.add(new Item(group,id,title)); }
}
