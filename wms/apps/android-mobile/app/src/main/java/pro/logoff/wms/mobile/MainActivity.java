package pro.logoff.wms.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.fragment.app.Fragment;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import pro.logoff.wms.mobile.databinding.ActivityMainBinding;
import pro.logoff.wms.mobile.network.DataCallback;
import pro.logoff.wms.mobile.push.NotificationCenter;
import pro.logoff.wms.mobile.push.NotificationWorker;
import pro.logoff.wms.mobile.ui.DashboardFragment;
import pro.logoff.wms.mobile.ui.ListFragment;
import pro.logoff.wms.mobile.ui.MoreFragment;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class MainActivity extends AppCompatActivity {
    private final Handler notificationHandler = new Handler(Looper.getMainLooper());
    private final Runnable notificationLoop = new Runnable() {
        @Override public void run() {
            NotificationWorker.enqueueNow(MainActivity.this);
            refreshNotificationBadge();
            notificationHandler.postDelayed(this, 45_000L);
        }
    };
    private ActivityMainBinding binding;
    private LogoffApplication app;
    private String pendingSection;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        app = (LogoffApplication) getApplication();
        if (!app.sessions().isLoggedIn()) { returnToLogin(); return; }
        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        captureIntent(getIntent());
        binding.notificationAction.setOnClickListener(view ->
                showNative(ListFragment.newInstance(ListFragment.NOTIFICATIONS), "Уведомления"));
        binding.bottomNavigation.setOnItemSelectedListener(item -> {
            getSupportFragmentManager().popBackStack(null, androidx.fragment.app.FragmentManager.POP_BACK_STACK_INCLUSIVE);
            restoreToolbar();
            if (item.getItemId() == R.id.nav_home) show(new DashboardFragment());
            else if (item.getItemId() == R.id.nav_requests) show(ListFragment.newInstance(ListFragment.REQUESTS));
            else if (item.getItemId() == R.id.nav_receipts) show(ListFragment.newInstance(ListFragment.RECEIPTS));
            else if (item.getItemId() == R.id.nav_finance) show(ListFragment.newInstance(ListFragment.INVOICES));
            else show(new MoreFragment());
            return true;
        });
        loadBootstrap();
        requestNotificationPermission();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureIntent(intent);
        if (app.state().bootstrap() != null) openPendingSection();
    }

    @Override protected void onResume() {
        super.onResume();
        notificationHandler.removeCallbacks(notificationLoop);
        notificationHandler.post(notificationLoop);
    }

    @Override protected void onPause() {
        notificationHandler.removeCallbacks(notificationLoop);
        super.onPause();
    }

    private void loadBootstrap() {
        app.repository().bootstrap(new DataCallback<>() {
            @Override public void onSuccess(Map<String, Object> value, boolean cached) {
                runOnUiThread(() -> {
                    app.state().setBootstrap(value);
                    configureRoleUi();
                    configureClients();
                    registerPushToken();
                    refreshNotificationBadge();
                    if (!openPendingSection()
                            && getSupportFragmentManager().findFragmentById(R.id.content) == null) {
                        show(new DashboardFragment());
                    }
                    if (cached) Toast.makeText(MainActivity.this, "Показаны сохраненные данные", Toast.LENGTH_SHORT).show();
                });
            }
            @Override public void onError(String message) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
            }
        });
    }

    private void configureRoleUi() {
        if (!app.state().isAdmin()) return;
        binding.bottomNavigation.getMenu().findItem(R.id.nav_home).setTitle(R.string.overview);
        binding.bottomNavigation.getMenu().findItem(R.id.nav_more).setTitle(R.string.management);
    }

    private void configureClients() {
        List<Map<String, Object>> clients = app.state().clients();
        if (clients.isEmpty()) {
            binding.clientCard.setVisibility(View.GONE);
            return;
        }
        List<String> labels = new ArrayList<>();
        for (Map<String, Object> client : clients) labels.add(AppState.string(client.get("name")));
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        binding.clientSelector.setAdapter(adapter);
        binding.clientCard.setVisibility(clients.size() > 1 ? View.VISIBLE : View.GONE);
        binding.clientSelector.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                String clientId = AppState.string(clients.get(position).get("id"));
                if (TextUtils.equals(clientId, app.state().selectedClientId())) return;
                app.state().selectClient(clientId);
                refreshNotificationBadge();
                Fragment current = getSupportFragmentManager().findFragmentById(R.id.content);
                if (current instanceof DashboardFragment) show(new DashboardFragment());
                else if (current instanceof ListFragment) ((ListFragment) current).refresh();
                else if (current instanceof pro.logoff.wms.mobile.ui.NativeModuleFragment) {
                    ((pro.logoff.wms.mobile.ui.NativeModuleFragment) current).refresh();
                }
            }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
        });
    }

    private void registerPushToken() {
        registerDevice("");
        if (FirebaseApp.getApps(this).isEmpty()) return;
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(this::registerDevice);
    }

    private void registerDevice(String fcmToken) {
        Map<String, Object> device = new LinkedHashMap<>();
        device.put("appVersion", BuildConfig.VERSION_NAME);
        if (fcmToken != null && !fcmToken.isBlank()) device.put("fcmToken", fcmToken);
        app.repository().api().registerDevice(device).enqueue(new EmptyCallback());
    }

    public void refreshNotificationBadge() {
        if (binding == null || !app.sessions().isLoggedIn()) return;
        app.repository().api().notifications(app.state().selectedClientId(), true, 100).enqueue(new Callback<>() {
            @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                if (!response.isSuccessful() || response.body() == null) return;
                Object data = response.body().get("data");
                int count = data instanceof List<?> ? ((List<?>) data).size() : 0;
                runOnUiThread(() -> setNotificationCount(count));
            }
            @Override public void onFailure(Call<Map<String, Object>> call, Throwable error) {}
        });
    }

    public void setNotificationCount(int count) {
        if (binding == null) return;
        binding.notificationBadge.setText(count > 99 ? "99+" : String.valueOf(count));
        binding.notificationBadge.setVisibility(count > 0 ? View.VISIBLE : View.GONE);
    }

    private void captureIntent(Intent intent) {
        if (intent != null) pendingSection = intent.getStringExtra(NotificationCenter.EXTRA_SECTION);
    }

    private boolean openPendingSection() {
        if (pendingSection == null || pendingSection.isBlank() || binding == null) return false;
        String section = pendingSection;
        pendingSection = null;
        if ("requests".equals(section)) {
            binding.bottomNavigation.setSelectedItemId(R.id.nav_requests);
        } else {
            showNative(ListFragment.newInstance(ListFragment.NOTIFICATIONS), "Уведомления");
        }
        return true;
    }

    public void show(Fragment fragment) {
        getSupportFragmentManager().beginTransaction().replace(R.id.content, fragment).commitAllowingStateLoss();
    }

    public void showNative(Fragment fragment, String title) {
        binding.toolbar.setTitle(title);
        binding.toolbar.setSubtitle(null);
        binding.toolbar.setNavigationIcon(R.drawable.ic_back);
        binding.toolbar.setNavigationOnClickListener(view -> getSupportFragmentManager().popBackStack());
        getSupportFragmentManager()
                .beginTransaction()
                .replace(R.id.content, fragment)
                .addToBackStack("native-module")
                .commitAllowingStateLoss();
        getSupportFragmentManager().addOnBackStackChangedListener(() -> {
            if (getSupportFragmentManager().getBackStackEntryCount() == 0) restoreToolbar();
        });
    }

    private void restoreToolbar() {
        if (binding == null) return;
        binding.toolbar.setTitle(R.string.app_name);
        binding.toolbar.setSubtitle("Фулфилмент в реальном времени");
        binding.toolbar.setNavigationIcon(null);
        binding.toolbar.setNavigationOnClickListener(null);
    }

    public void returnToLogin() {
        app.sessions().clear();
        startActivity(new Intent(this, LoginActivity.class));
        finish();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 42);
        }
    }

    @Override public void onRequestPermissionsResult(
            int requestCode,
            @NonNull String[] permissions,
            @NonNull int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 42 && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            NotificationWorker.enqueueNow(this);
        }
    }

    private static class EmptyCallback implements Callback<Map<String, Object>> {
        @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {}
        @Override public void onFailure(Call<Map<String, Object>> call, Throwable error) {}
    }
}
