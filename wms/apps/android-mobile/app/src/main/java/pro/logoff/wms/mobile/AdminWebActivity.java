package pro.logoff.wms.mobile;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

import com.squareup.moshi.Moshi;

import java.util.LinkedHashMap;
import java.util.Map;

import pro.logoff.wms.mobile.databinding.ActivityAdminWebBinding;

public class AdminWebActivity extends AppCompatActivity {
    private ActivityAdminWebBinding binding;
    private boolean sessionInjected;

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); binding = ActivityAdminWebBinding.inflate(getLayoutInflater()); setContentView(binding.getRoot());
        LogoffApplication app = (LogoffApplication) getApplication();
        binding.toolbar.setNavigationOnClickListener(view -> finish());
        binding.web.getSettings().setJavaScriptEnabled(true); binding.web.getSettings().setDomStorageEnabled(true); binding.web.getSettings().setDatabaseEnabled(false); binding.web.getSettings().setAllowFileAccess(false); binding.web.getSettings().setAllowContentAccess(false); binding.web.getSettings().setUserAgentString(binding.web.getSettings().getUserAgentString() + " LOGOffWmsMobile/" + BuildConfig.VERSION_NAME);
        binding.web.setWebChromeClient(new WebChromeClient() { @Override public void onProgressChanged(WebView view, int progress) { binding.progress.setProgress(progress); binding.progress.setVisibility(progress >= 100 ? android.view.View.GONE : android.view.View.VISIBLE); } });
        binding.web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !"wms.logoff.pro".equalsIgnoreCase(request.getUrl().getHost()); }
            @Override public void onPageFinished(WebView view, String url) {
                if (sessionInjected) return;
                sessionInjected = true;
                Map<String, Object> session = new LinkedHashMap<>(); session.put("accessToken", app.sessions().accessToken()); session.put("tokenType", "Bearer"); session.put("user", app.state().user());
                String json = new Moshi.Builder().build().adapter(Object.class).toJson(session);
                String script = "localStorage.setItem('logoff-wms-session', " + quote(json) + "); location.reload();";
                view.evaluateJavascript(script, null);
            }
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) { @Override public void handleOnBackPressed() { if (binding.web.canGoBack()) binding.web.goBack(); else finish(); } });
        binding.web.loadUrl("https://wms.logoff.pro/");
    }

    private String quote(String value) { return "'" + value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"; }
}
