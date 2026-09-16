package pro.logoff.wms.tsd;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Looper;
import android.view.View;
import android.widget.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import java.util.List;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28)
public class TsdUiTest {
    private Activity activity;
    private LinearLayout root;
    @Before public void setup(){
        activity=Robolectric.buildActivity(Activity.class).setup().get();
        root=new LinearLayout(activity);root.setOrientation(LinearLayout.VERTICAL);activity.setContentView(root);
        TsdUi.select(activity,"uz");
    }
    @After public void teardown(){activity.finish();}
    private void layout(){root.measure(View.MeasureSpec.makeMeasureSpec(480,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(800,View.MeasureSpec.EXACTLY));root.layout(0,0,480,800);}
    @Test public void screenshotUsesRussianAndRestoresLanguageInputFocusAndSelection() throws Exception {
        // TEST: capture actual Android views without touching scanner text or focused field.
        TextView label=new TsdUi.Label(activity);label.setText("Сканируйте ШК товара");root.addView(label);
        EditText scan=new EditText(activity);TsdUi.hint(scan,"Сканируйте КИЗ");root.addView(scan);
        String kiz="0104640684261753215apMFH%IhcZVg\u001d91EE12\u001d92a+/=";
        scan.setText(kiz);scan.setSelection(5);scan.requestFocus();layout();
        String visible=label.getText().toString(),hint=scan.getHint().toString();
        assertEquals("uz",TsdUi.language(activity));
        if(TsdUi.enabled())assertNotEquals("Сканируйте ШК товара",visible);
        TsdUi.russianSnapshot(root,()->{
            assertEquals("Сканируйте ШК товара",label.getText().toString());
            assertEquals("Сканируйте КИЗ",scan.getHint().toString());
            assertEquals(kiz,scan.getText().toString());
            root.draw(new Canvas(Bitmap.createBitmap(480,800,Bitmap.Config.ARGB_8888)));return null;
        });
        assertEquals(visible,label.getText().toString());assertEquals(hint,scan.getHint().toString());
        assertEquals(kiz,scan.getText().toString());assertTrue(scan.hasFocus());assertEquals(5,scan.getSelectionStart());
        assertEquals("uz",TsdUi.language(activity));
    }
    @Test public void drawingFailureStillRestoresScreenAndNextTranslationWorks() {
        TextView label=new TsdUi.Label(activity);label.setText("Назад");root.addView(label);layout();
        String before=label.getText().toString();
        assertThrows(IllegalStateException.class,()->TsdUi.russianSnapshot(root,()->{throw new IllegalStateException("bitmap failure");}));
        assertEquals(before,label.getText().toString());
        TsdUi.select(activity,"en");label.setText("Назад");assertEquals(TsdUi.enabled()?"Back":"Назад",label.getText().toString());
    }
    @Test public void dialogAndUnderlyingScreenAreBothRussianInMonitoringOnly() throws Exception {
        TextView label=new TsdUi.Label(activity);label.setText("Сканируйте ШК товара");root.addView(label);layout();
        AlertDialog dialog=new TsdUi.DialogBuilder(activity).setTitle("Ошибка сканирования").setMessage("Короб не найден")
            .setPositiveButton("Понятно",null).create();dialog.show();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        TextView message=dialog.findViewById(android.R.id.message);String visible=message.getText().toString();
        List<View> windows=TsdUi.monitorWindows(activity);
        assertEquals(TsdUi.enabled()?2:1,windows.size());
        if(TsdUi.enabled())TsdUi.russianSnapshot(windows,()->{
            assertEquals("Короб не найден",message.getText().toString());
            assertEquals("Понятно",dialog.getButton(DialogInterface.BUTTON_POSITIVE).getText().toString());
            return null;
        });
        assertEquals(visible,message.getText().toString());dialog.dismiss();
        assertEquals(1,TsdUi.monitorWindows(activity).size());
    }
    @Test public void productDataAndSpinnerValuesStayCanonical() {
        TextView product=new TsdUi.Label(activity);TsdUi.data(product,"Назад");assertEquals("Назад",product.getText().toString());
        TsdUi.StringAdapter adapter=new TsdUi.StringAdapter(activity,android.R.layout.simple_spinner_item,new String[]{"Назад"});
        assertEquals("Назад",adapter.getItem(0));
        TsdUi.select(activity,"en");TextView row=(TextView)adapter.getView(0,null,root);
        assertEquals(TsdUi.enabled()?"Back":"Назад",row.getText().toString());
    }
    @Test public void loginLanguageChoicePreservesEnteredCredentials() throws Exception {
        // TEST: exercise the real login screen, including its automatic spinner callback.
        try(org.robolectric.android.controller.ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class)) {
            MainActivity main=controller.setup().get();
            EditText login=(EditText)field(main,"deviceCodeInput"),password=(EditText)field(main,"deviceSecretInput");
            assertNotNull(login);assertNotNull(password);login.setText("local-test-user");password.setText("test-only-password");
            Spinner spinner=(Spinner)field(main,"languageSpinner");
            assertEquals(TsdUi.enabled()?3:2,spinner.getCount());
            if(TsdUi.enabled()) {
                spinner.setSelection(2);Shadows.shadowOf(Looper.getMainLooper()).idle();
                assertEquals("en",TsdUi.language(main));
                assertEquals("local-test-user",((EditText)field(main,"deviceCodeInput")).getText().toString());
                assertEquals("test-only-password",((EditText)field(main,"deviceSecretInput")).getText().toString());
                java.lang.reflect.Method monitor=MainActivity.class.getDeclaredMethod("buildMonitorPayload");monitor.setAccessible(true);
                @SuppressWarnings("unchecked") java.util.Map<String,Object> payload=(java.util.Map<String,Object>)monitor.invoke(main);
                assertEquals("Настройки",payload.get("screenLabel"));assertEquals("ru",payload.get("screenshotLanguage"));assertEquals("en",payload.get("uiLanguage"));
                assertEquals("Язык сохранён.",payload.get("lastAction"));
            }
        }
    }
    private Object field(Object instance,String name)throws Exception {java.lang.reflect.Field f=instance.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(instance);}
}
