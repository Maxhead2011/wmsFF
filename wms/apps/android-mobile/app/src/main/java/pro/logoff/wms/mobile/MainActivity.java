package pro.logoff.wms.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.fragment.app.Fragment;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import pro.logoff.wms.mobile.databinding.ActivityMainBinding;
import pro.logoff.wms.mobile.network.DataCallback;
import pro.logoff.wms.mobile.ui.DashboardFragment;
import pro.logoff.wms.mobile.ui.ListFragment;
import pro.logoff.wms.mobile.ui.MoreFragment;

public class MainActivity extends AppCompatActivity {
    private ActivityMainBinding binding;
    private LogoffApplication app;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        app = (LogoffApplication) getApplication();
        if (!app.sessions().isLoggedIn()) { returnToLogin(); return; }
        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        binding.toolbar.inflateMenu(R.menu.menu_toolbar);
        binding.toolbar.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == R.id.action_notifications) { show(ListFragment.newInstance(ListFragment.NOTIFICATIONS)); return true; }
            return false;
        });
        binding.bottomNavigation.setOnItemSelectedListener(item -> {
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

    private void loadBootstrap() {
        app.repository().bootstrap(new DataCallback<>() {
            @Override public void onSuccess(Map<String, Object> value, boolean cached) {
                runOnUiThread(() -> {
                    app.state().setBootstrap(value);
                    configureRoleUi();
                    configureClients();
                    registerPushToken();
                    if (getSupportFragmentManager().findFragmentById(R.id.content) == null) show(new DashboardFragment());
                    if (cached) Toast.makeText(MainActivity.this, "Показаны сохраненные данные", Toast.LENGTH_SHORT).show();
                });
            }
            @Override public void onError(String message) { runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show()); }
        });
    }

    private void configureRoleUi() {
        if (!app.state().isAdmin()) return;
        binding.bottomNavigation.getMenu().findItem(R.id.nav_home).setTitle(R.string.overview);
        binding.bottomNavigation.getMenu().findItem(R.id.nav_more).setTitle(R.string.management);
    }

    private void configureClients() {
        List<Map<String, Object>> clients = app.state().clients();
        if (clients.isEmpty()) { binding.clientSelector.setVisibility(View.GONE); return; }
        List<String> labels = new ArrayList<>();
        for (Map<String, Object> client : clients) labels.add(AppState.string(client.get("name")));
        binding.clientSelector.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, labels));
        binding.clientSelector.setVisibility(clients.size() > 1 ? View.VISIBLE : View.GONE);
        binding.clientSelector.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                String clientId = AppState.string(clients.get(position).get("id"));
                if (TextUtils.equals(clientId, app.state().selectedClientId())) return;
                app.state().selectClient(clientId);
                Fragment current = getSupportFragmentManager().findFragmentById(R.id.content);
                if (current instanceof DashboardFragment) show(new DashboardFragment());
            }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
        });
    }

    private void registerPushToken() {
        Map<String, Object> device = new LinkedHashMap<>();
        device.put("appVersion", BuildConfig.VERSION_NAME);
        app.repository().api().registerDevice(device).enqueue(new EmptyCallback());
    }

    public void show(Fragment fragment) { getSupportFragmentManager().beginTransaction().replace(R.id.content, fragment).commitAllowingStateLoss(); }
    public void returnToLogin() { app.sessions().clear(); startActivity(new Intent(this, LoginActivity.class)); finish(); }
    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 42);
    }

    private static class EmptyCallback implements retrofit2.Callback<Map<String, Object>> {
        @Override public void onResponse(retrofit2.Call<Map<String, Object>> call, retrofit2.Response<Map<String, Object>> response) {}
        @Override public void onFailure(retrofit2.Call<Map<String, Object>> call, Throwable error) {}
    }
}
