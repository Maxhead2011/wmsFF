package pro.logoff.wms.tsd;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class FbsArticleDisplayTest {
  private String text(View view) {
    StringBuilder s=new StringBuilder(view instanceof TextView ? ((TextView)view).getText() : "");
    if(view instanceof ViewGroup) for(int i=0;i<((ViewGroup)view).getChildCount();i++) s.append(text(((ViewGroup)view).getChildAt(i)));
    return s.toString();
  }
  // TEST: render actual relabel screen; source/target articles remain, marketplace names disappear.
  @Test public void articlesReplaceMarketplaceTitles() throws Exception {
    try(var controller=Robolectric.buildActivity(MainActivity.class).setup()) {
      var activity=controller.get();var response=new TsdFbsAssemblyResponse();
      response.state="SCAN_SOURCE_BARCODE";response.task=new TsdFbsAssemblyResponse.Task();
      response.task.id="article-display";response.task.marketplace="WILDBERRIES";
      response.task.product=new TsdFbsAssemblyResponse.Product();
      response.task.product.name="LONG_TARGET_MARKETPLACE_TITLE";response.task.product.article="TARGET_ARTICLE";
      response.task.product.size="XS / 42";response.task.product.barcodes=Arrays.asList("123456789");
      response.task.relabeling=new TsdFbsAssemblyResponse.Relabeling();response.task.relabeling.required=true;
      response.task.relabeling.sourceProduct=new TsdFbsAssemblyResponse.Product();
      response.task.relabeling.sourceProduct.name="LONG_SOURCE_MARKETPLACE_TITLE";
      response.task.relabeling.sourceProduct.article="SOURCE_ARTICLE";
      var field=MainActivity.class.getDeclaredField("fbsAssembly");field.setAccessible(true);field.set(activity,response);
      var render=MainActivity.class.getDeclaredMethod("renderFbsAssemblyScreen");render.setAccessible(true);render.invoke(activity);
      String actual=text(activity.getWindow().getDecorView());
      assertTrue(actual.contains("TARGET_ARTICLE"));assertTrue(actual.contains("SOURCE_ARTICLE"));
      assertTrue(actual.contains("XS / 42"));assertFalse(actual.contains("LONG_TARGET_MARKETPLACE_TITLE"));assertFalse(actual.contains("LONG_SOURCE_MARKETPLACE_TITLE"));
    }
  }
}
