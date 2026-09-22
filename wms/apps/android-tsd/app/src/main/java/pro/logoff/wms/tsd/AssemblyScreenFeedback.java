package pro.logoff.wms.tsd;
// FIX: identical explicit status colors across our picking and packing screens.
final class AssemblyScreenFeedback {
    static int background(boolean enabled,boolean retrying,int feedback){
        if(!enabled)return 0xffffffff;
        if(retrying)return 0xffffffcc;
        if(feedback==0xfffecaca)return 0xffff9494;
        if(feedback==0xffbbf7d0)return 0xffccffcc;
        return 0xffffffff;
    }
    static String label(boolean retrying,int feedback){
        if(retrying)return "Повторная отправка запроса";
        if(feedback==0xfffecaca)return "Ошибка";
        if(feedback==0xffbbf7d0)return "Действие выполнено";
        return "";
    }
}
