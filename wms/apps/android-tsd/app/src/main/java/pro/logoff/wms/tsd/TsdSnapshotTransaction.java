package pro.logoff.wms.tsd;

import java.util.List;

/** FIX: a Russian monitoring image never commits a language or scanner-state change. */
final class TsdSnapshotTransaction {
    interface ViewState { void showRussian(); void restore(); }
    interface Capture<T> { T draw() throws Exception; }
    static <T> T capture(List<? extends ViewState> views,Capture<T> capture) throws Exception {
        int changed=0;
        try {
            for(ViewState view:views){changed++;view.showRussian();}
            return capture.draw();
        } finally {
            RuntimeException failure=null;
            for(int i=changed-1;i>=0;i--)try{views.get(i).restore();}
            catch(RuntimeException error){if(failure==null)failure=error;else failure.addSuppressed(error);}
            if(failure!=null)throw failure;
        }
    }
    private TsdSnapshotTransaction() {}
}
