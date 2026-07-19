package pro.logoff.wms.mobile.ui;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.google.android.material.button.MaterialButton;

import java.util.LinkedHashMap;
import java.util.Map;

import pro.logoff.wms.mobile.AppState;
import pro.logoff.wms.mobile.BuildConfig;
import pro.logoff.wms.mobile.LogoffApplication;
import pro.logoff.wms.mobile.MainActivity;
import pro.logoff.wms.mobile.databinding.FragmentMoreBinding;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class MoreFragment extends Fragment {
    private FragmentMoreBinding binding;
    private LogoffApplication app;
    @Nullable @Override public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle state) {
        binding = FragmentMoreBinding.inflate(inflater, container, false); app = (LogoffApplication) requireActivity().getApplication();
        binding.account.setText(AppState.string(app.state().user().get("name")));
        binding.roles.setText("Роли: " + AppState.string(app.state().user().get("roleCodes")));
        addModules();
        binding.checkUpdate.setOnClickListener(view -> checkUpdate());
        binding.logout.setOnClickListener(view -> logout());
        return binding.getRoot();
    }

    private void addModules() {
        if (app.state().isAdmin()) {
            addModuleIfAllowed("Склад и короба", "warehouse", "warehouse:read");
            addModuleIfAllowed("Инвентаризация", "inventory", "stock:read");
            addModuleIfAllowed("Товарооборот", "turnover", "stock:read");
            addModuleIfAllowed("Каталог и номенклатура", "catalog", "skus:read");
            addModuleIfAllowed("Остатки", "stock", "stock:read");
            addModuleIfAllowed("Клиенты", "clients", "clients:read");
            addModuleIfAllowed("Пользователи и доступы", "access", "users:read");
            addModuleIfAllowed("Логистика", "logistics", "logistics:read");
            addModuleIfAllowed("Услуги и тарифы", "services", "billing:read");
            addModuleIfAllowed("Импорт остатков", "imports", "imports:write");
            addModuleIfAllowed("Печать", "print", "print:write");
            addModuleIfAllowed("Сервис и контроль ТСД", "service", "system:admin");
            addModuleIfAllowed("Собственные компании", "own-companies", "billing:read");
        } else {
            addButton("Уведомления", () -> ((MainActivity) requireActivity()).show(ListFragment.newInstance(ListFragment.NOTIFICATIONS)));
            addModule("Остатки", "stock");
            addModule("Каталог товаров", "catalog");
            addModule("Короба и хранение", "warehouse");
            addModule("Товарооборот", "turnover");
            addModule("Логистика", "logistics");
            addModule("Услуги и тарифы", "services");
            addModule("Профиль компании", "profile");
        }
    }

    private void addModule(String title, String module) {
        addButton(title, () -> ((MainActivity) requireActivity()).showNative(NativeModuleFragment.newInstance(module, title), title));
    }

    private void addModuleIfAllowed(String title, String module, String permission) {
        if (app.state().can(permission)) addModule(title, module);
    }

    private void addButton(String title, Runnable action) {
        MaterialButton button = new MaterialButton(requireContext(), null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
        button.setText(title); button.setAllCaps(false); button.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL); button.setOnClickListener(view -> action.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(52)); params.bottomMargin = dp(8); binding.moduleButtons.addView(button, params);
    }

    private void checkUpdate() {
        app.repository().api().appVersion().enqueue(new Callback<>() {
            @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                if (!response.isSuccessful() || response.body() == null) return;
                String current = AppState.string(response.body().get("currentVersion"));
                if (BuildConfig.VERSION_NAME.equals(current)) Toast.makeText(requireContext(), "Установлена актуальная версия " + current, Toast.LENGTH_LONG).show();
                else new com.google.android.material.dialog.MaterialAlertDialogBuilder(requireContext()).setTitle("Доступно обновление " + current).setMessage(AppState.string(response.body().get("releaseNotes"))).setNegativeButton("Позже", null).setPositiveButton("Обновить", (dialog, which) -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.APK_URL)))).show();
            }
            @Override public void onFailure(Call<Map<String, Object>> call, Throwable error) { Toast.makeText(requireContext(), "Не удалось проверить обновление", Toast.LENGTH_SHORT).show(); }
        });
    }

    private void logout() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("allDevices", false);
        app.repository().api().logout(body).enqueue(new Callback<>() {
            @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) { ((MainActivity) requireActivity()).returnToLogin(); }
            @Override public void onFailure(Call<Map<String, Object>> call, Throwable error) { ((MainActivity) requireActivity()).returnToLogin(); }
        });
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
