package pro.logoff.wms.soswb;

final class PrintStationSelection {
    private PrintStationSelection() {}

    // FIX: задание можно направлять только агенту, который сейчас подтверждает связь с WMS.
    static boolean isSelectable(boolean online) {
        return online;
    }
}
