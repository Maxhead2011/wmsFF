package pro.logoff.wms.tsd;

import org.junit.Test;
import java.util.Arrays;
import static org.junit.Assert.*;

public class TsdSnapshotTransactionTest {
    private static final class Label implements TsdSnapshotTransaction.ViewState {
        final String ru,selected;String shown;
        Label(String ru,String selected){this.ru=ru;this.selected=selected;shown=selected;}
        public void showRussian(){shown=ru;}
        public void restore(){shown=selected;}
    }
    @Test public void capturesRussianAndRestoresBothEnglishAndUzbek() throws Exception {
        // TEST: the original screenshot captured the worker's foreign-language labels.
        Label a=new Label("Назад","Back"),b=new Label("Проверить","Tekshirish");
        String screenshot=TsdSnapshotTransaction.capture(Arrays.asList(a,b),()->a.shown+" / "+b.shown);
        assertEquals("Назад / Проверить",screenshot);assertEquals("Back",a.shown);assertEquals("Tekshirish",b.shown);
    }
    @Test public void restoresSelectedLanguageEvenWhenDrawingFails() {
        Label a=new Label("Сборка ФБО","FBO picking");
        assertThrows(Exception.class,()->TsdSnapshotTransaction.capture(Arrays.asList(a),()->{throw new Exception("bitmap allocation failed");}));
        assertEquals("FBO picking",a.shown);
    }
    @Test public void restoresOtherLabelsEvenIfOneRestoreThrows() {
        Label a=new Label("Назад","Back");
        TsdSnapshotTransaction.ViewState broken=new TsdSnapshotTransaction.ViewState(){public void showRussian(){}public void restore(){throw new IllegalStateException("detached view");}};
        assertThrows(IllegalStateException.class,()->TsdSnapshotTransaction.capture(Arrays.asList(a,broken),()->null));
        assertEquals("Back",a.shown);
    }
}
