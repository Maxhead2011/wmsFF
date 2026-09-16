package pro.logoff.wms.tsd;

import android.app.Activity;
import android.graphics.*;
import android.view.View;
import android.widget.*;
import java.io.*;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.*;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class TsdRussianScreenshotTest {
    @Test public void russianCaptureMatchesRussianPixelsAndRestoresWorkerPixels() throws Exception {
        // TEST: real bitmap rendering verifies the monitoring image, not only translation strings.
        try(org.robolectric.android.controller.ActivityController<Activity> controller=Robolectric.buildActivity(Activity.class)) {
            Activity activity=controller.setup().get();TsdUi.select(activity,"ru");
            LinearLayout root=new LinearLayout(activity);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(18,18,18,18);root.setBackgroundColor(Color.WHITE);
            String[] labels={"Сборка FBS","Сканируйте короб","ПАЛЛЕТ-СОРТ: PALET_SORT_1000","Короб: FFL_LKBS0709_11","Осталось отобрать 2","Сканируйте ШК товара","Назад"};
            List<TextView> views=new ArrayList<>();
            for(String value:labels){TextView text=new TsdUi.Label(activity);text.setTextColor(Color.BLACK);text.setTextSize(21);text.setPadding(0,12,0,12);text.setText(value);root.addView(text);views.add(text);}
            activity.setContentView(root);layout(root);Bitmap russian=draw(root);write(russian,"ru");
            for(String language:new String[]{"uz","en"}) {
                TsdUi.select(activity,language);for(int i=0;i<labels.length;i++)views.get(i).setText(labels[i]);layout(root);
                if(TsdUi.enabled())for(TextView view:views)assertFalse(view.getText().toString(),view.getText().toString().matches("(?s).*[А-Яа-яЁё].*"));
                Bitmap worker=draw(root);write(worker,language);
                Bitmap monitoring=TsdUi.russianSnapshot(root,()->draw(root));write(monitoring,"monitor-"+language);
                assertArrayEquals(pixels(russian),pixels(monitoring));
                assertArrayEquals(pixels(worker),pixels(draw(root)));
                if(TsdUi.enabled())assertFalse(Arrays.equals(pixels(worker),pixels(monitoring)));
                assertEquals(language,TsdUi.language(activity));
            }
        }
    }
    private void layout(View view){view.measure(View.MeasureSpec.makeMeasureSpec(480,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(800,View.MeasureSpec.EXACTLY));view.layout(0,0,480,800);}
    private Bitmap draw(View root){Bitmap bitmap=Bitmap.createBitmap(480,800,Bitmap.Config.ARGB_8888);root.draw(new Canvas(bitmap));return bitmap;}
    private int[] pixels(Bitmap bitmap){int[] pixels=new int[480*800];bitmap.getPixels(pixels,0,480,0,0,480,800);return pixels;}
    private void write(Bitmap bitmap,String name)throws IOException {
        File dir=new File("build/reports/tsd-language-screenshots/"+BuildConfig.FLAVOR);dir.mkdirs();
        try(FileOutputStream out=new FileOutputStream(new File(dir,name+".png"))){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}
    }
}
