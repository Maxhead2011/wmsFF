package pro.logoff.wms.mobile.ui;

import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.ColorRes;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import okhttp3.ResponseBody;
import pro.logoff.wms.mobile.AppState;
import pro.logoff.wms.mobile.LogoffApplication;
import pro.logoff.wms.mobile.R;
import pro.logoff.wms.mobile.databinding.FragmentOnlineAssemblyBinding;
import pro.logoff.wms.mobile.files.DocumentSaver;
import pro.logoff.wms.mobile.network.MobileRepository;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * Native online view of a WMS request. It intentionally reads the same API and
 * database as the web console: no mobile copy of assembly state is created.
 */
public class OnlineAssemblyFragment extends Fragment {
    private static final String ARG_REQUEST_ID = "requestId";
    private static final String ARG_TITLE = "title";
    private static final String ARG_CLIENT_ID = "clientId";
    private static final String ARG_NUMBER = "number";
    private static final long AUTO_REFRESH_MS = 15_000L;

    private final Handler refreshHandler = new Handler(Looper.getMainLooper());
    private final Runnable refreshLoop = new Runnable() {
        @Override public void run() {
            if (isAdded() && binding != null && !busy) load(false);
            refreshHandler.postDelayed(this, AUTO_REFRESH_MS);
        }
    };

    private FragmentOnlineAssemblyBinding binding;
    private LogoffApplication app;
    private String requestId;
    private String requestTitle;
    private String clientId;
    private String requestNumber;
    private boolean busy;
    private Map<String, Object> latestPlan = Collections.emptyMap();

    public static OnlineAssemblyFragment newInstance(
            String requestId,
            String title,
            String clientId,
            String requestNumber
    ) {
        OnlineAssemblyFragment fragment = new OnlineAssemblyFragment();
        Bundle args = new Bundle();
        args.putString(ARG_REQUEST_ID, requestId);
        args.putString(ARG_TITLE, title);
        args.putString(ARG_CLIENT_ID, clientId);
        args.putString(ARG_NUMBER, requestNumber);
        fragment.setArguments(args);
        return fragment;
    }

    @Nullable
    @Override
    public View onCreateView(
            @NonNull LayoutInflater inflater,
            @Nullable ViewGroup container,
            @Nullable Bundle state
    ) {
        binding = FragmentOnlineAssemblyBinding.inflate(inflater, container, false);
        app = (LogoffApplication) requireActivity().getApplication();
        Bundle args = getArguments();
        requestId = args == null ? "" : args.getString(ARG_REQUEST_ID, "");
        requestTitle = args == null ? "Онлайн-сборка" : args.getString(ARG_TITLE, "Онлайн-сборка");
        clientId = args == null ? "" : args.getString(ARG_CLIENT_ID, "");
        requestNumber = args == null ? "" : args.getString(ARG_NUMBER, "");
        binding.onlineSwipe.setOnRefreshListener(() -> load(true));
        load(true);
        return binding.getRoot();
    }

    @Override public void onResume() {
        super.onResume();
        refreshHandler.removeCallbacks(refreshLoop);
        refreshHandler.postDelayed(refreshLoop, AUTO_REFRESH_MS);
    }

    @Override public void onPause() {
        refreshHandler.removeCallbacks(refreshLoop);
        super.onPause();
    }

    private void load(boolean showSpinner) {
        if (requestId.isBlank() || busy || binding == null) return;
        if (showSpinner) binding.onlineSwipe.setRefreshing(true);
        app.repository().api().requestOnlineAssembly(requestId).enqueue(new Callback<>() {
            @Override
            public void onResponse(
                    Call<Map<String, Object>> call,
                    Response<Map<String, Object>> response
            ) {
                if (!isAdded() || binding == null) return;
                if (!response.isSuccessful() || response.body() == null) {
                    showError(MobileRepository.errorMessage(response));
                    return;
                }
                latestPlan = response.body();
                requireActivity().runOnUiThread(() -> render(latestPlan));
            }

            @Override public void onFailure(Call<Map<String, Object>> call, Throwable failure) {
                showError(MobileRepository.readable(failure));
            }
        });
    }

    private void render(Map<String, Object> plan) {
        if (binding == null) return;
        binding.onlineSwipe.setRefreshing(false);
        LinearLayout content = binding.onlineContent;
        content.removeAllViews();

        Map<String, Object> fbs = map(plan.get("fbsAssembly"));
        long total = integer(fbs.get("totalOrders"));
        long completed = integer(fbs.get("completedOrders"));
        long remaining = Math.max(0, total - completed);
        int percent = total > 0 ? (int) Math.min(100, Math.round(completed * 100d / total)) : 0;

        content.addView(heroCard(
                requestLabel(),
                fbs.isEmpty()
                        ? "Складская заявка синхронизирована с общей WMS"
                        : "Готово " + completed + " из " + total + " · осталось " + remaining,
                fbs.isEmpty() ? "ONLINE" : percent + "%"
        ));
        content.addView(actionButton("Обновить сейчас", R.color.logoff_blue, view -> load(true)));
        if (app.state().can("stock:write")) {
            content.addView(actionButton("Синхронизировать с ТСД", R.color.logoff_black, view -> syncTsd()));
        }
        content.addView(actionButton("Документы и выгрузки", R.color.logoff_ink_soft, view -> showDownloads()));

        if (fbs.isEmpty()) {
            renderRegularAssembly(content, plan);
            return;
        }

        renderKizConflicts(content, listOfMaps(fbs.get("kizConflicts")));
        renderReturnRequired(content, map(fbs.get("returnRequired")));
        renderNotCollected(content, map(fbs.get("notCollected")));
        renderWmsBoxes(content, map(fbs.get("wmsBoxes")));
        renderDuplicateKiz(content, listOfMaps(fbs.get("duplicateKizScans")));
        renderAssemblyRows(content, listOfMaps(fbs.get("rows")));
    }

    private void renderRegularAssembly(LinearLayout content, Map<String, Object> plan) {
        section(content, "Ход складской сборки", "Актуальное состояние ТСД и операций");
        List<Map<String, Object>> processes = listOfMaps(plan.get("activeTsdProcesses"));
        if (processes.isEmpty()) {
            content.addView(infoCard(
                    "Активных действий ТСД нет",
                    "Нажмите «Синхронизировать с ТСД», если заявка ещё не появилась на терминале.",
                    R.color.logoff_blue_soft,
                    null
            ));
        } else {
            for (Map<String, Object> process : processes) {
                content.addView(infoCard(
                        fallback(process.get("stageLabel"), "Операция ТСД"),
                        fallback(process.get("progressText"), "Выполняется") +
                                "\nСотрудник: " + fallback(process.get("workerName"), fallback(process.get("deviceCode"), "не указан")),
                        R.color.logoff_success_surface,
                        null
                ));
            }
        }

        List<Map<String, Object>> searchBoxes = listOfMaps(plan.get("searchBoxes"));
        if (!searchBoxes.isEmpty()) {
            long found = searchBoxes.stream().filter(row ->
                    Boolean.TRUE.equals(row.get("found")) || Boolean.TRUE.equals(row.get("isFound"))).count();
            content.addView(infoCard(
                    "Поиск коробов · " + found + "/" + searchBoxes.size(),
                    joinCodes(searchBoxes, "boxCode", 20),
                    R.color.logoff_card,
                    null
            ));
        }
        Map<String, Object> movement = map(plan.get("movementProgress"));
        if (!movement.isEmpty()) {
            content.addView(infoCard(
                    "Перемещения",
                    "Перемещено: " + integer(movement.get("totalMoved")) +
                            " · осталось: " + integer(movement.get("totalRemaining")),
                    R.color.logoff_card,
                    null
            ));
        }
    }

    private void renderKizConflicts(LinearLayout content, List<Map<String, Object>> conflicts) {
        if (conflicts.isEmpty()) return;
        section(content, "КИЗ требуют решения · " + conflicts.size(),
                "Проверка выполняется непосредственно по WMS и WB");
        for (Map<String, Object> conflict : conflicts) {
            String id = string(conflict.get("id"));
            String body =
                    "Заказ WB №" + fallback(conflict.get("orderId"), "—") + "\n" +
                    fallback(conflict.get("productName"), "Товар") +
                    optional(" · арт. ", conflict.get("article")) +
                    optional("\nКороб: ", conflict.get("sourceBoxCode")) +
                    "\nКИЗ: " + fallback(conflict.get("kiz"), "—") +
                    "\n\n" + fallback(conflict.get("message"), "Требуется проверка");
            content.addView(infoCard(
                    "Проблемный КИЗ",
                    body,
                    R.color.logoff_red_soft,
                    app.state().can("stock:write")
                            ? new CardAction("Проверить и исправить", () -> resolveKiz(id))
                            : null
            ));
        }
    }

    private void renderReturnRequired(LinearLayout content, Map<String, Object> block) {
        List<Map<String, Object>> rows = listOfMaps(block.get("rows"));
        if (rows.isEmpty()) return;
        section(content, "Изменения после начала сборки · " + rows.size(),
                "Товар нужно вернуть либо подтвердить решение менеджера");
        for (Map<String, Object> row : rows) {
            content.addView(infoCard(
                    "Заказ WB №" + fallback(row.get("orderId"), "—"),
                    productLine(row) +
                            optional("\nКороб: ", row.get("sourceBoxCode")) +
                            optional("\nКИЗ: ", row.get("kiz")) +
                            optional("\nПричина: ", row.get("syncIssue")),
                    R.color.logoff_red_soft,
                    null
            ));
        }
    }

    private void renderNotCollected(LinearLayout content, Map<String, Object> block) {
        List<Map<String, Object>> rows = listOfMaps(block.get("rows"));
        long remainingOrders = integer(block.get("remainingOrders"));
        section(content, "Ещё не собрано · " + remainingOrders + " заказов",
                "Осталось единиц: " + integer(block.get("remainingUnits")));
        if (rows.isEmpty()) {
            content.addView(infoCard(
                    "Сборка выполнена на 100%",
                    "Все товары найдены и обработаны.",
                    R.color.logoff_success_surface,
                    null
            ));
            return;
        }
        for (Map<String, Object> row : rows) {
            List<Map<String, Object>> boxes = listOfMaps(row.get("availableBoxes"));
            List<String> orders = stringList(row.get("orderIds"));
            content.addView(infoCard(
                    fallback(row.get("name"), "Товар") + optional(" · ", row.get("size")),
                    optional("Арт. ", row.get("article")) +
                            optional("\nШК: ", row.get("barcode")) +
                            "\nНе собрано: " + integer(row.get("remainingQuantity")) +
                            (orders.isEmpty() ? "" : "\nЗаказы: №" + String.join(", №", orders)) +
                            (boxes.isEmpty() ? "\nДоступные короба не найдены" :
                                    "\nГде лежит: " + boxQuantities(boxes)),
                    R.color.logoff_card,
                    null
            ));
        }
        if (app.state().can("stock:write")) {
            List<Map<String, Object>> orders = collectOrders(rows);
            if (!orders.isEmpty()) {
                content.addView(actionButton(
                        "Перенести все несобранные заказы в новую поставку",
                        R.color.logoff_warning,
                        view -> confirmMoveOrders(orders)
                ));
            }
        }
    }

    private void renderWmsBoxes(LinearLayout content, Map<String, Object> block) {
        List<Map<String, Object>> boxes = listOfMaps(block.get("boxes"));
        List<Map<String, Object>> notPacked = listOfMaps(block.get("notPacked"));
        section(content, "Короба WMS · " + boxes.size(),
                "Упаковано: " + integer(block.get("packedUnits")) +
                        " · ещё без короба: " + integer(block.get("remainingUnits")));
        for (Map<String, Object> box : boxes) {
            List<Map<String, Object>> items = listOfMaps(box.get("items"));
            content.addView(infoCard(
                    fallback(box.get("code"), "Короб WMS"),
                    "Статус: " + fallback(box.get("status"), "—") +
                            " · товаров: " + items.stream().mapToLong(item ->
                                    Math.max(1, integer(item.get("quantity")))).sum() +
                            optional("\nОткрыл: ", box.get("openedByName")) +
                            optional("\nЗакрыл: ", box.get("closedByName")),
                    "CLOSED".equals(string(box.get("status")))
                            ? R.color.logoff_success_surface
                            : R.color.logoff_blue_soft,
                    new CardAction("Показать содержимое", () -> showBoxContents(box))
            ));
        }
        if (!notPacked.isEmpty()) {
            StringBuilder value = new StringBuilder();
            for (Map<String, Object> row : notPacked) {
                if (value.length() > 0) value.append("\n\n");
                value.append("№").append(fallback(row.get("orderId"), "—"))
                        .append(" · ").append(fallback(row.get("productName"), "Товар"))
                        .append(optional(" · ", row.get("size")))
                        .append("\n").append(fallback(row.get("assemblyStatusLabel"), "Не собрано"));
            }
            content.addView(infoCard(
                    "Ещё не уложено в короба WMS",
                    value.toString(),
                    R.color.logoff_red_soft,
                    null
            ));
        }
    }

    private void renderDuplicateKiz(LinearLayout content, List<Map<String, Object>> events) {
        if (events.isEmpty()) return;
        section(content, "Повторные сканы КИЗ · " + events.size(),
                "История времени, заявок, заказов, коробов и сотрудников");
        content.addView(actionButton(
                "Открыть историю повторных КИЗ",
                R.color.logoff_warning,
                view -> showDuplicateHistory(events)
        ));
    }

    private void renderAssemblyRows(LinearLayout content, List<Map<String, Object>> rows) {
        if (rows.isEmpty()) return;
        section(content, "Все действия сборки · " + rows.size(),
                "Фактически обработанные и текущие заказы");
        int shown = 0;
        for (Map<String, Object> row : rows) {
            if (shown++ >= 150) break;
            boolean completed = "COMPLETED".equals(string(row.get("status")));
            content.addView(infoCard(
                    "Заказ WB №" + fallback(row.get("orderId"), "—") +
                            " · " + fallback(row.get("statusLabel"), string(row.get("status"))),
                    productLine(row) +
                            optional("\nКороб: ", row.get("sourceBoxCode")) +
                            optional("\nШК WB: ", row.get("wbStickerPartB")) +
                            optional("\nКИЗ: ", row.get("kiz")) +
                            optional("\nСотрудник: ", row.get("workerName")),
                    completed ? R.color.logoff_success_surface : R.color.logoff_card,
                    null
            ));
        }
    }

    private void resolveKiz(String conflictId) {
        if (busy || conflictId.isBlank()) return;
        busy = true;
        binding.onlineSwipe.setRefreshing(true);
        app.repository().api().resolveFbsKizConflict(requestId, conflictId).enqueue(new Callback<>() {
            @Override public void onResponse(
                    Call<Map<String, Object>> call,
                    Response<Map<String, Object>> response
            ) {
                busy = false;
                if (!response.isSuccessful() || response.body() == null) {
                    showError(MobileRepository.errorMessage(response));
                    return;
                }
                String message = fallback(response.body().get("message"), "Проверка выполнена.");
                requireActivity().runOnUiThread(() ->
                        new MaterialAlertDialogBuilder(requireContext())
                                .setTitle(Boolean.TRUE.equals(response.body().get("resolved"))
                                        ? "КИЗ исправлен"
                                        : "Требуется решение менеджера")
                                .setMessage(message)
                                .setPositiveButton("Обновить", (dialog, which) -> load(true))
                                .show());
            }

            @Override public void onFailure(Call<Map<String, Object>> call, Throwable failure) {
                busy = false;
                showError(MobileRepository.readable(failure));
            }
        });
    }

    private void syncTsd() {
        if (busy) return;
        busy = true;
        binding.onlineSwipe.setRefreshing(true);
        app.repository().api().syncRequestToTsd(requestId).enqueue(new Callback<>() {
            @Override public void onResponse(
                    Call<Map<String, Object>> call,
                    Response<Map<String, Object>> response
            ) {
                busy = false;
                if (!response.isSuccessful()) {
                    showError(MobileRepository.errorMessage(response));
                    return;
                }
                Toast.makeText(requireContext(), "Заявка синхронизирована с ТСД", Toast.LENGTH_SHORT).show();
                load(true);
            }

            @Override public void onFailure(Call<Map<String, Object>> call, Throwable failure) {
                busy = false;
                showError(MobileRepository.readable(failure));
            }
        });
    }

    private void confirmMoveOrders(List<Map<String, Object>> orders) {
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle("Перенести хвост сборки?")
                .setMessage(
                        "Будет перенесено заказов: " + orders.size() +
                                ". WB создаст новую поставку, WMS создаст новую заявку и пересчитает текущую."
                )
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Перенести", (dialog, which) -> moveOrders(orders))
                .show();
    }

    private void moveOrders(List<Map<String, Object>> orders) {
        if (busy) return;
        busy = true;
        binding.onlineSwipe.setRefreshing(true);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("clientId", clientId.isBlank() ? app.state().selectedClientId() : clientId);
        body.put("orders", orders);
        app.repository().api().moveFbsOrdersToNewSupply(body).enqueue(new Callback<>() {
            @Override public void onResponse(
                    Call<Map<String, Object>> call,
                    Response<Map<String, Object>> response
            ) {
                busy = false;
                if (!response.isSuccessful() || response.body() == null) {
                    showError(MobileRepository.errorMessage(response));
                    return;
                }
                Map<String, Object> target = map(response.body().get("targetRequest"));
                String message = "Заказы перенесены в заявку №" +
                        String.format(Locale.US, "%06d", integer(target.get("number"))) + ".";
                Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
                load(true);
            }

            @Override public void onFailure(Call<Map<String, Object>> call, Throwable failure) {
                busy = false;
                showError(MobileRepository.readable(failure));
            }
        });
    }

    private void showDownloads() {
        boolean fbsRequest = !map(latestPlan.get("fbsAssembly")).isEmpty();
        String[] labels = fbsRequest
                ? new String[]{
                        "Лист подбора FBS, PDF",
                        "Короба WMS, Excel",
                        "Содержимое коробов, Excel",
                        "Перемещения, Excel"
                }
                : new String[]{
                        "Короба WMS, Excel",
                        "Содержимое коробов, Excel",
                        "Перемещения, Excel"
                };
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle("Документы заявки")
                .setItems(labels, (dialog, which) -> {
                    if (fbsRequest && which == 0) {
                        download(app.repository().api().fbsRequestPickList(requestId),
                                "Лист_подбора_FBS_" + safeNumber() + ".pdf");
                    } else if (which == (fbsRequest ? 1 : 0)) {
                        download(app.repository().api().requestOutgoingBoxes(requestId),
                                "Короба_WMS_" + safeNumber() + ".xlsx");
                    } else if (which == (fbsRequest ? 2 : 1)) {
                        download(app.repository().api().requestOutgoingContents(requestId),
                                "Содержимое_коробов_" + safeNumber() + ".xlsx");
                    } else {
                        download(app.repository().api().requestMovements(requestId),
                                "Перемещения_" + safeNumber() + ".xlsx");
                    }
                })
                .setNegativeButton("Закрыть", null)
                .show();
    }

    private void download(Call<ResponseBody> call, String fileName) {
        call.enqueue(new Callback<>() {
            @Override public void onResponse(Call<ResponseBody> source, Response<ResponseBody> response) {
                if (!response.isSuccessful() || response.body() == null) {
                    showError(MobileRepository.errorMessage(response));
                    return;
                }
                DocumentSaver.save(
                        requireContext().getApplicationContext(),
                        fileName,
                        response.body(),
                        new DocumentSaver.Callback() {
                            @Override public void saved(android.net.Uri uri) {
                                if (getActivity() != null) requireActivity().runOnUiThread(() ->
                                        Toast.makeText(requireContext(),
                                                "Файл сохранён в Загрузки/LOGOff WMS",
                                                Toast.LENGTH_LONG).show());
                            }

                            @Override public void failed(String message) { showError(message); }
                        }
                );
            }

            @Override public void onFailure(Call<ResponseBody> source, Throwable failure) {
                showError(MobileRepository.readable(failure));
            }
        });
    }

    private void showBoxContents(Map<String, Object> box) {
        List<Map<String, Object>> items = listOfMaps(box.get("items"));
        StringBuilder message = new StringBuilder();
        for (Map<String, Object> item : items) {
            if (message.length() > 0) message.append("\n\n");
            message.append("Заказ №").append(fallback(item.get("orderId"), "—"))
                    .append("\n").append(fallback(item.get("productName"), "Товар"))
                    .append(optional(" · ", item.get("size")))
                    .append(optional("\nАрт. ", item.get("article")))
                    .append(optional("\nШК: ", item.get("productBarcode")))
                    .append(optional("\nШК WB: ", item.get("wbStickerPartB")))
                    .append(optional("\nКИЗ: ", item.get("kiz")));
        }
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle(fallback(box.get("code"), "Короб WMS"))
                .setMessage(message.length() == 0 ? "Короб пока пуст." : message.toString())
                .setPositiveButton("Закрыть", null)
                .show();
    }

    private void showDuplicateHistory(List<Map<String, Object>> events) {
        StringBuilder message = new StringBuilder();
        for (Map<String, Object> event : events) {
            Map<String, Object> attempt = map(event.get("attempt"));
            Map<String, Object> existing = map(event.get("existing"));
            if (message.length() > 0) message.append("\n\n────────────\n\n");
            message.append("КИЗ: ").append(fallback(event.get("kiz"), "—"))
                    .append("\nПовтор: заявка ").append(requestRef(attempt))
                    .append(", заказ №").append(fallback(attempt.get("orderId"), "—"))
                    .append(optional(", короб ", attempt.get("boxCode")))
                    .append(optional("\nСотрудник: ", attempt.get("workerName")))
                    .append(optional("\nВремя: ", attempt.get("scannedAt")))
                    .append("\n\nПервый скан: заявка ").append(requestRef(existing))
                    .append(", заказ №").append(fallback(existing.get("orderId"), "—"))
                    .append(optional(", короб ", existing.get("boxCode")))
                    .append(optional("\nСотрудник: ", existing.get("workerName")))
                    .append(optional("\nВремя: ", existing.get("scannedAt")));
        }
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle("История повторных КИЗ")
                .setMessage(message.toString())
                .setPositiveButton("Закрыть", null)
                .show();
    }

    private MaterialCardView heroCard(String title, String subtitle, String badge) {
        MaterialCardView card = baseCard(R.color.logoff_black);
        LinearLayout row = new LinearLayout(requireContext());
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(18), dp(18), dp(18), dp(18));
        LinearLayout texts = new LinearLayout(requireContext());
        texts.setOrientation(LinearLayout.VERTICAL);
        TextView titleView = text(title, 20, R.color.logoff_white, Typeface.BOLD);
        TextView subtitleView = text(subtitle, 13, R.color.logoff_border, Typeface.NORMAL);
        subtitleView.setPadding(0, dp(5), dp(10), 0);
        texts.addView(titleView);
        texts.addView(subtitleView);
        row.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView badgeView = text(badge, 16, R.color.logoff_white, Typeface.BOLD);
        badgeView.setGravity(Gravity.CENTER);
        badgeView.setBackgroundResource(R.drawable.bg_badge);
        badgeView.setPadding(dp(12), dp(8), dp(12), dp(8));
        row.addView(badgeView);
        card.addView(row);
        return card;
    }

    private MaterialCardView infoCard(
            String title,
            String body,
            @ColorRes int background,
            @Nullable CardAction action
    ) {
        MaterialCardView card = baseCard(background);
        LinearLayout layout = new LinearLayout(requireContext());
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(16), dp(14), dp(16), dp(14));
        layout.addView(text(title, 16, R.color.logoff_black, Typeface.BOLD));
        TextView bodyView = text(body, 13, R.color.logoff_ink_soft, Typeface.NORMAL);
        bodyView.setPadding(0, dp(7), 0, 0);
        bodyView.setTextIsSelectable(true);
        layout.addView(bodyView);
        if (action != null) {
            MaterialButton button = actionButton(action.label(), R.color.logoff_red, view -> action.run().run());
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
            params.topMargin = dp(10);
            layout.addView(button, params);
        }
        card.addView(layout);
        return card;
    }

    private MaterialCardView baseCard(@ColorRes int background) {
        MaterialCardView card = new MaterialCardView(requireContext());
        card.setRadius(dp(20));
        card.setCardElevation(0);
        card.setCardBackgroundColor(ContextCompat.getColor(requireContext(), background));
        card.setStrokeColor(ContextCompat.getColor(requireContext(), R.color.logoff_border));
        card.setStrokeWidth(background == R.color.logoff_black ? 0 : dp(1));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.bottomMargin = dp(10);
        card.setLayoutParams(params);
        return card;
    }

    private MaterialButton actionButton(String label, @ColorRes int color, View.OnClickListener action) {
        MaterialButton button = new MaterialButton(requireContext());
        button.setText(label);
        button.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_white));
        button.setTextSize(14);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setCornerRadius(dp(16));
        button.setInsetTop(0);
        button.setInsetBottom(0);
        button.setBackgroundTintList(ContextCompat.getColorStateList(requireContext(), color));
        button.setOnClickListener(action);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(52)
        );
        params.bottomMargin = dp(10);
        button.setLayoutParams(params);
        return button;
    }

    private void section(LinearLayout content, String title, String subtitle) {
        TextView titleView = text(title, 18, R.color.logoff_black, Typeface.BOLD);
        titleView.setPadding(dp(2), dp(12), dp(2), 0);
        content.addView(titleView);
        TextView subtitleView = text(subtitle, 12, R.color.logoff_text_muted, Typeface.NORMAL);
        subtitleView.setPadding(dp(2), dp(3), dp(2), dp(10));
        content.addView(subtitleView);
    }

    private TextView text(String value, int size, @ColorRes int color, int style) {
        TextView view = new TextView(requireContext());
        view.setText(value == null ? "" : value);
        view.setTextSize(size);
        view.setTextColor(ContextCompat.getColor(requireContext(), color));
        view.setTypeface(Typeface.DEFAULT, style);
        view.setLineSpacing(0, 1.08f);
        return view;
    }

    private String requestLabel() {
        String number = safeNumber();
        return (number.isBlank() ? "" : "Заявка №" + number + "\n") + requestTitle;
    }

    private String safeNumber() {
        if (!requestNumber.isBlank() && !"0".equals(requestNumber)) {
            try {
                return String.format(Locale.US, "%06d", Long.parseLong(requestNumber));
            } catch (NumberFormatException ignored) {
                return requestNumber.replaceAll("[^A-Za-zА-Яа-я0-9_-]", "_");
            }
        }
        return requestId.length() >= 8 ? requestId.substring(0, 8) : requestId;
    }

    private String productLine(Map<String, Object> row) {
        return fallback(row.get("productName"), fallback(row.get("name"), "Товар")) +
                optional(" · размер ", row.get("size")) +
                optional("\nАрт. ", row.get("article")) +
                optional("\nШК: ", row.get("productBarcode")) +
                optional("\nШК: ", row.get("barcode"));
    }

    private String boxQuantities(List<Map<String, Object>> boxes) {
        List<String> values = new ArrayList<>();
        for (Map<String, Object> box : boxes) {
            values.add(fallback(box.get("boxCode"), "без короба") + " — " + integer(box.get("quantity")) + " шт.");
        }
        return String.join(", ", values);
    }

    private List<Map<String, Object>> collectOrders(List<Map<String, Object>> rows) {
        Map<String, Map<String, Object>> unique = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            for (Map<String, Object> order : listOfMaps(row.get("orders"))) {
                String id = string(order.get("id"));
                String connectionId = string(order.get("connectionId"));
                if (!id.isBlank() && !connectionId.isBlank()) {
                    Map<String, Object> value = new LinkedHashMap<>();
                    value.put("id", id);
                    value.put("connectionId", connectionId);
                    unique.put(connectionId + ":" + id, value);
                }
            }
        }
        return new ArrayList<>(unique.values());
    }

    private String joinCodes(List<Map<String, Object>> rows, String key, int limit) {
        Set<String> codes = new LinkedHashSet<>();
        for (Map<String, Object> row : rows) {
            String value = string(row.get(key));
            if (!value.isBlank()) codes.add(value);
            if (codes.size() >= limit) break;
        }
        return codes.isEmpty() ? "Короба не определены" : String.join("\n", codes);
    }

    private String requestRef(Map<String, Object> row) {
        long number = integer(row.get("requestNumber"));
        return number > 0 ? "№" + String.format(Locale.US, "%06d", number) : "без номера";
    }

    private void showError(String message) {
        if (getActivity() == null) return;
        requireActivity().runOnUiThread(() -> {
            if (binding == null || !isAdded()) return;
            binding.onlineSwipe.setRefreshing(false);
            Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
            if (latestPlan.isEmpty()) {
                binding.onlineContent.removeAllViews();
                binding.onlineContent.addView(infoCard(
                        "Онлайн-сборка недоступна",
                        message,
                        R.color.logoff_red_soft,
                        new CardAction("Повторить", () -> load(true))
                ));
            }
        });
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> ? (Map<String, Object>) value : Collections.emptyMap();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> listOfMaps(Object value) {
        if (!(value instanceof List<?> source)) return new ArrayList<>();
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : source) {
            if (item instanceof Map<?, ?>) result.add((Map<String, Object>) item);
        }
        return result;
    }

    private List<String> stringList(Object value) {
        if (!(value instanceof List<?> source)) return new ArrayList<>();
        List<String> result = new ArrayList<>();
        for (Object item : source) {
            String text = string(item);
            if (!text.isBlank()) result.add(text);
        }
        return result;
    }

    private String optional(String prefix, Object value) {
        String text = string(value).trim();
        return text.isEmpty() || "null".equalsIgnoreCase(text) ? "" : prefix + text;
    }

    private String fallback(Object value, String fallback) {
        String text = string(value).trim();
        return text.isEmpty() || "null".equalsIgnoreCase(text) ? fallback : text;
    }

    private String string(Object value) { return value == null ? "" : String.valueOf(value); }

    private long integer(Object value) {
        if (value instanceof Number number) return number.longValue();
        try { return Long.parseLong(string(value)); } catch (NumberFormatException ignored) { return 0; }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override public void onDestroyView() {
        refreshHandler.removeCallbacks(refreshLoop);
        binding = null;
        super.onDestroyView();
    }

    private record CardAction(String label, Runnable run) {}
}
