package pro.logoff.wms.mobile;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.util.Map;

import pro.logoff.wms.mobile.databinding.ActivityFullWmsBinding;
import pro.logoff.wms.mobile.files.DocumentSaver;

public class FullWmsActivity extends AppCompatActivity {
    private static final String ALLOWED_HOST = "wms.logoff.pro";
    private ActivityFullWmsBinding binding;
    private LogoffApplication app;
    private boolean sessionInjected;
    private ValueCallback<Uri[]> pendingFiles;
    private PermissionRequest pendingCameraRequest;

    private final ActivityResultLauncher<String[]> filePicker = registerForActivityResult(
            new ActivityResultContracts.OpenDocument(),
            uri -> {
                if (pendingFiles == null) return;
                pendingFiles.onReceiveValue(uri == null ? null : new Uri[]{uri});
                pendingFiles = null;
            }
    );

    private final ActivityResultLauncher<String> cameraPermission = registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            granted -> {
                if (pendingCameraRequest == null) return;
                if (granted) {
                    pendingCameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    pendingCameraRequest.deny();
                }
                pendingCameraRequest = null;
            }
    );

    @Override protected void onCreate(@Nullable Bundle state) {
        super.onCreate(state);
        app = (LogoffApplication) getApplication();
        if (!app.sessions().isLoggedIn() || app.state().bootstrap() == null) {
            finish();
            return;
        }
        binding = ActivityFullWmsBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        binding.toolbar.setNavigationOnClickListener(view -> navigateBack());
        configureWebView();
        binding.webView.loadUrl(BuildConfig.WEB_BASE_URL);
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = binding.webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " LOGOffWMSMobile/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(binding.webView, false);
        binding.webView.addJavascriptInterface(new MobileBridge(), "LogoffMobile");
        binding.webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isAllowed(uri)) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (!isAllowed(Uri.parse(url))) return;
                if (!sessionInjected) {
                    sessionInjected = true;
                    injectSession(view);
                    return;
                }
                injectMobileEnhancements(view);
            }
        });
        binding.webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) {
                binding.progress.setProgress(progress);
                binding.progress.setVisibility(progress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = filePathCallback;
                String[] accept = fileChooserParams.getAcceptTypes();
                if (accept == null || accept.length == 0 || (accept.length == 1 && accept[0].isBlank())) {
                    accept = new String[]{"*/*"};
                }
                filePicker.launch(accept);
                return true;
            }

            @Override public void onPermissionRequest(PermissionRequest request) {
                if (!isAllowed(request.getOrigin())) {
                    request.deny();
                    return;
                }
                boolean wantsCamera = false;
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) wantsCamera = true;
                }
                if (!wantsCamera) {
                    request.deny();
                    return;
                }
                if (ContextCompat.checkSelfPermission(FullWmsActivity.this, Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    pendingCameraRequest = request;
                    cameraPermission.launch(Manifest.permission.CAMERA);
                }
            }
        });
        binding.webView.setDownloadListener(this::downloadUrl);
    }

    private void injectSession(WebView view) {
        try {
            Map<String, Object> user = app.state().user();
            String userId = AppState.string(user.get("id"));
            JSONObject session = new JSONObject();
            session.put("accessToken", app.sessions().accessToken());
            session.put("tokenType", "Bearer");
            session.put("user", new JSONObject(user));
            String theme = ThemeStore.webTheme(this);
            if (ThemeStore.WING_X.equals(theme) && !ThemeStore.canUseWingX(userId)) {
                theme = ThemeStore.CLASSIC;
            }
            String script = "(function(){" +
                    "localStorage.setItem('logoff-wms-session'," + JSONObject.quote(session.toString()) + ");" +
                    "localStorage.setItem(" + JSONObject.quote("logoff-wms-ui-theme:" + userId) + "," + JSONObject.quote(theme) + ");" +
                    "location.replace('/');" +
                    "})();";
            view.evaluateJavascript(script, null);
        } catch (Exception error) {
            Toast.makeText(this, "Не удалось открыть полную WMS: " + error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void injectMobileEnhancements(WebView view) {
        String userId = AppState.string(app.state().user().get("id"));
        String themeKey = "logoff-wms-ui-theme:" + userId;
        String script = "(function(){" +
                "if(window.__logoffMobileReady)return;window.__logoffMobileReady=true;" +
                "var style=document.createElement('style');" +
                "style.textContent='html,body{overscroll-behavior:none}button,input,select,textarea{touch-action:manipulation}';" +
                "document.head.appendChild(style);" +
                "var original=Storage.prototype.setItem;" +
                "Storage.prototype.setItem=function(k,v){original.apply(this,arguments);" +
                "if(this===window.localStorage&&k===" + JSONObject.quote(themeKey) + "){window.LogoffMobile.saveTheme(String(v));}};" +
                "document.addEventListener('click',function(event){" +
                "var target=event.target&&event.target.closest?event.target.closest('a[download]'):null;" +
                "if(!target||!target.href||target.href.indexOf('blob:')!==0)return;" +
                "event.preventDefault();fetch(target.href).then(function(r){return r.blob();}).then(function(blob){" +
                "var reader=new FileReader();reader.onloadend=function(){var data=String(reader.result||'');" +
                "window.LogoffMobile.saveBase64(target.download||'download',blob.type||'application/octet-stream',data.split(',')[1]||'');};" +
                "reader.readAsDataURL(blob);});" +
                "},true);" +
                "})();";
        view.evaluateJavascript(script, null);
    }

    private void downloadUrl(String url, String userAgent, String disposition, String mimeType, long length) {
        if (url == null || url.startsWith("blob:")) return;
        try {
            Uri uri = Uri.parse(url);
            if (!isAllowed(uri)) {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return;
            }
            String fileName = URLUtil.guessFileName(url, disposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(uri)
                    .setTitle(fileName)
                    .setMimeType(mimeType)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .addRequestHeader("Authorization", "Bearer " + app.sessions().accessToken())
                    .addRequestHeader("User-Agent", userAgent == null ? "LOGOff WMS" : userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isBlank()) request.addRequestHeader("Cookie", cookie);
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "LOGOff WMS/" + fileName);
            } else {
                request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);
            }
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this, "Файл загружается: " + fileName, Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            Toast.makeText(this, "Не удалось скачать файл", Toast.LENGTH_LONG).show();
        }
    }

    private boolean isAllowed(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme()) && ALLOWED_HOST.equalsIgnoreCase(uri.getHost());
    }

    private void navigateBack() {
        if (binding.webView.canGoBack()) binding.webView.goBack();
        else finish();
    }

    @Override public void onBackPressed() {
        navigateBack();
    }

    @Override protected void onDestroy() {
        if (pendingFiles != null) pendingFiles.onReceiveValue(null);
        if (binding != null) {
            binding.webView.removeJavascriptInterface("LogoffMobile");
            binding.webView.stopLoading();
            binding.webView.destroy();
        }
        super.onDestroy();
    }

    private final class MobileBridge {
        @JavascriptInterface public void saveTheme(String theme) {
            if (ThemeStore.WING_X.equals(theme)
                    && !ThemeStore.canUseWingX(AppState.string(app.state().user().get("id")))) return;
            ThemeStore.setWebTheme(FullWmsActivity.this, theme);
        }

        @JavascriptInterface public void saveBase64(String fileName, String mimeType, String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                DocumentSaver.saveBytes(
                        FullWmsActivity.this,
                        fileName == null || fileName.isBlank() ? "download" : fileName,
                        mimeType == null || mimeType.isBlank() ? "application/octet-stream" : mimeType,
                        bytes,
                        new DocumentSaver.Callback() {
                            @Override public void saved(Uri uri) {
                                runOnUiThread(() -> Toast.makeText(
                                        FullWmsActivity.this,
                                        "Файл сохранён в Загрузки/LOGOff WMS",
                                        Toast.LENGTH_LONG
                                ).show());
                            }

                            @Override public void failed(String message) {
                                runOnUiThread(() -> Toast.makeText(
                                        FullWmsActivity.this,
                                        message,
                                        Toast.LENGTH_LONG
                                ).show());
                            }
                        }
                );
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(
                        FullWmsActivity.this,
                        "Не удалось сохранить файл",
                        Toast.LENGTH_LONG
                ).show());
            }
        }
    }
}
