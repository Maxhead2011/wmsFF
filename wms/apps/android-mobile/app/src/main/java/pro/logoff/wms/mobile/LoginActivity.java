package pro.logoff.wms.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.EditorInfo;

import androidx.appcompat.app.AppCompatActivity;

import java.util.LinkedHashMap;
import java.util.Map;

import pro.logoff.wms.mobile.databinding.ActivityLoginBinding;
import pro.logoff.wms.mobile.network.MobileRepository;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class LoginActivity extends AppCompatActivity {
    private ActivityLoginBinding binding;
    private LogoffApplication app;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        app = (LogoffApplication) getApplication();
        if (app.sessions().isLoggedIn()) { openMain(); return; }
        binding = ActivityLoginBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        binding.loginButton.setOnClickListener(view -> login());
        binding.password.setOnEditorActionListener((view, action, event) -> {
            if (action == EditorInfo.IME_ACTION_DONE) { login(); return true; }
            return false;
        });
    }

    private void login() {
        String login = text(binding.login);
        String password = text(binding.password);
        if (login.isEmpty() || password.isEmpty()) { showError("Введите логин и пароль."); return; }
        setLoading(true);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("login", login);
        body.put("password", password);
        body.put("installationId", app.sessions().installationId());
        body.put("deviceName", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
        body.put("appVersion", BuildConfig.VERSION_NAME);
        app.repository().api().login(body).enqueue(new Callback<>() {
            @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                setLoading(false);
                if (!response.isSuccessful() || response.body() == null) { showError(MobileRepository.errorMessage(response)); return; }
                Map<String, Object> result = response.body();
                app.sessions().save(value(result, "accessToken"), value(result, "refreshToken"), value(result, "deviceId"));
                openMain();
            }
            @Override public void onFailure(Call<Map<String, Object>> call, Throwable error) { setLoading(false); showError(MobileRepository.readable(error)); }
        });
    }

    private void setLoading(boolean loading) {
        binding.loginButton.setEnabled(!loading);
        binding.loginButton.setText(loading ? "" : getString(R.string.login_button));
        binding.progress.setVisibility(loading ? View.VISIBLE : View.GONE);
        binding.error.setVisibility(View.GONE);
    }

    private void showError(String message) { binding.error.setText(message); binding.error.setVisibility(View.VISIBLE); }
    private String text(android.widget.TextView view) { return view.getText() == null ? "" : view.getText().toString().trim(); }
    private String value(Map<String, Object> map, String key) { return map.get(key) == null ? "" : String.valueOf(map.get(key)); }
    private void openMain() { startActivity(new Intent(this, MainActivity.class)); finish(); }
}
