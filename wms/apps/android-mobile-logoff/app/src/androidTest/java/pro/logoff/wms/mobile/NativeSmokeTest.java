package pro.logoff.wms.mobile;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.core.app.ActivityScenario;
import org.junit.Test;
import org.junit.runner.RunWith;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.*;
import static org.junit.Assert.*;
import java.util.Collections;
import pro.logoff.wms.mobile.ui.ClientSettingsPolicy;
import pro.logoff.wms.mobile.ui.SkuEditPolicy;

// TEST: clean emulator only; no credentials and no production writes.
@RunWith(AndroidJUnit4.class)
public class NativeSmokeTest {
 @Test public void emptyLoginIsRejectedLocally(){
  try(ActivityScenario<LoginActivity> screen=ActivityScenario.launch(LoginActivity.class)){
   onView(withId(R.id.loginButton)).check(matches(isDisplayed())).perform(click());
   onView(withId(R.id.error)).check(matches(withText("Введите логин и пароль.")));
   onView(withId(R.id.loginButton)).check(matches(isEnabled()));
  }
 }
 @Test public void noPermissionsWithoutBootstrap(){assertFalse(new AppState().can("clients:write"));assertFalse(new AppState().can("skus:write"));}
 @Test public void nativePoliciesRunOnAndroid(){
  assertEquals(Boolean.FALSE,ClientSettingsPolicy.delta(Collections.singletonMap("relabelingEnabled",true),Collections.singletonMap("relabelingEnabled",false)).get("relabelingEnabled"));
  assertEquals(12.5,SkuEditPolicy.delta(Collections.emptyMap(),Collections.singletonMap("lengthCm","12,5")).get("lengthCm"));
 }
}
