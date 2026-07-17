package pro.logoff.wms.mobile.network;

public interface DataCallback<T> {
    void onSuccess(T value, boolean cached);
    void onError(String message);
}
