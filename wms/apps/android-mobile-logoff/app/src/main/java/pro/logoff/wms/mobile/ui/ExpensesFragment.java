package pro.logoff.wms.mobile.ui;

import android.app.DatePickerDialog;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.materialswitch.MaterialSwitch;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;

import java.text.NumberFormat;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import okhttp3.ResponseBody;
import pro.logoff.wms.mobile.AppState;
import pro.logoff.wms.mobile.LogoffApplication;
import pro.logoff.wms.mobile.R;
import pro.logoff.wms.mobile.databinding.FragmentExpensesBinding;
import pro.logoff.wms.mobile.files.DocumentSaver;
import pro.logoff.wms.mobile.network.MobileRepository;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class ExpensesFragment extends Fragment {
    private static final String OVERVIEW = "overview";
    private static final String MATERIALS = "materials";
    private static final String RULES = "rules";
    private static final String ENTRIES = "entries";
    private static final String DEBTS = "debts";
    private static final ZoneId MOSCOW = ZoneId.of("Europe/Moscow");
    private static final DateTimeFormatter INPUT_DATE = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final DateTimeFormatter DISPLAY_DATE = DateTimeFormatter.ofPattern("dd.MM.yyyy");

    private static final String[] CATEGORY_CODES = {
            "LOGISTICS", "PAYROLL_PICKERS", "HANDLING_PPR", "CONTRACT_WORK",
            "RENT", "UTILITIES", "TAXES", "SOFTWARE", "EQUIPMENT",
            "MARKETING", "OTHER"
    };
    private static final String[] CATEGORY_LABELS = {
            "Логистика", "ФОТ сборщиков", "ПРР", "Отдельные работы",
            "Аренда", "Коммунальные услуги", "Налоги", "ПО и сервисы",
            "Оборудование", "Маркетинг", "Прочее"
    };

    private FragmentExpensesBinding binding;
    private LogoffApplication app;
    private String section = OVERVIEW;
    private LocalDate dateFrom = LocalDate.now(MOSCOW).withDayOfMonth(1);
    private LocalDate dateTo = LocalDate.now(MOSCOW);
    private boolean currentClientOnly;
    private boolean canWrite;
    private Map<String, Object> reportData = Collections.emptyMap();
    private Map<String, Object> debtsData = Collections.emptyMap();
    private List<Map<String, Object>> materialsData = new ArrayList<>();
    private int overviewPending;
    private int loadGeneration;

    public static ExpensesFragment newInstance() {
        return new ExpensesFragment();
    }

    @Nullable
    @Override
    public View onCreateView(
            @NonNull LayoutInflater inflater,
            @Nullable ViewGroup container,
            @Nullable Bundle state
    ) {
        binding = FragmentExpensesBinding.inflate(inflater, container, false);
        app = (LogoffApplication) requireActivity().getApplication();
        canWrite = app.state().can("expenses:write");
        currentClientOnly = !app.state().isAdmin();
        binding.swipe.setOnRefreshListener(this::load);
        binding.dateFrom.setOnClickListener(view -> pickDate(true));
        binding.dateTo.setOnClickListener(view -> pickDate(false));
        binding.clientScope.setOnClickListener(view -> {
            if (!app.state().isAdmin()) return;
            currentClientOnly = !currentClientOnly;
            updateFilters();
            load();
        });
        binding.exportAction.setOnClickListener(view -> exportReport());
        binding.primaryAction.setOnClickListener(view -> {
            if (MATERIALS.equals(section)) showCreateMaterialDialog();
            else showCreateExpenseDialog();
        });
        renderSections();
        updateFilters();
        updateActions();
        load();
        return binding.getRoot();
    }

    public void refresh() {
        if (binding != null) {
            if (!app.state().isAdmin()) currentClientOnly = true;
            updateFilters();
            load();
        }
    }

    private void renderSections() {
        binding.sections.removeAllViews();
        addSectionButton(OVERVIEW, "Обзор");
        addSectionButton(MATERIALS, "Материалы");
        addSectionButton(RULES, "Настройки клиентов");
        addSectionButton(ENTRIES, "Все расходы");
        addSectionButton(DEBTS, "Долги");
    }

    private void addSectionButton(String id, String title) {
        MaterialButton button = new MaterialButton(
                requireContext(),
                null,
                id.equals(section)
                        ? com.google.android.material.R.attr.materialButtonStyle
                        : com.google.android.material.R.attr.materialButtonOutlinedStyle
        );
        button.setText(title);
        button.setAllCaps(false);
        button.setCornerRadius(dp(16));
        button.setOnClickListener(view -> {
            if (section.equals(id)) return;
            section = id;
            renderSections();
            updateActions();
            load();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(48));
        params.setMarginEnd(dp(8));
        binding.sections.addView(button, params);
    }

    private void updateActions() {
        boolean materialSection = MATERIALS.equals(section);
        boolean writableAction = canWrite && (materialSection || ENTRIES.equals(section) || OVERVIEW.equals(section));
        binding.primaryAction.setVisibility(writableAction ? View.VISIBLE : View.GONE);
        binding.primaryAction.setText(materialSection ? "Добавить материал" : "Добавить расход");
        binding.exportAction.setVisibility(
                OVERVIEW.equals(section) || ENTRIES.equals(section) || DEBTS.equals(section)
                        ? View.VISIBLE
                        : View.GONE
        );
        binding.clientScope.setVisibility(
                app.state().isAdmin() && !RULES.equals(section) ? View.VISIBLE : View.GONE
        );
        binding.heroSubtitle.setText(sectionSubtitle());
    }

    private String sectionSubtitle() {
        if (MATERIALS.equals(section)) return "Остатки, закупки, списания и история расходных материалов";
        if (RULES.equals(section)) return "Автосписание и отдельное начисление по выбранному клиенту";
        if (ENTRIES.equals(section)) return "Логистика, ФОТ, ПРР, работы и остальные затраты";
        if (DEBTS.equals(section)) return "Долг клиентов с расшифровкой по счетам и услугам";
        return "Материалы, логистика, ФОТ, ПРР и задолженность клиентов";
    }

    private void updateFilters() {
        if (binding == null) return;
        binding.dateFrom.setText("С " + DISPLAY_DATE.format(dateFrom));
        binding.dateTo.setText("По " + DISPLAY_DATE.format(dateTo));
        String clientName = AppState.string(app.state().selectedClient().get("name"));
        binding.clientScope.setText(
                currentClientOnly
                        ? "Только клиент: " + (clientName.isBlank() ? "не выбран" : clientName)
                        : "Все клиенты"
        );
    }

    private void pickDate(boolean from) {
        LocalDate current = from ? dateFrom : dateTo;
        new DatePickerDialog(
                requireContext(),
                (view, year, month, day) -> {
                    LocalDate picked = LocalDate.of(year, month + 1, day);
                    if (from) dateFrom = picked;
                    else dateTo = picked;
                    if (dateFrom.isAfter(dateTo)) {
                        if (from) dateTo = dateFrom;
                        else dateFrom = dateTo;
                    }
                    updateFilters();
                    load();
                },
                current.getYear(),
                current.getMonthValue() - 1,
                current.getDayOfMonth()
        ).show();
    }

    private void load() {
        if (binding == null) return;
        loadGeneration++;
        binding.swipe.setRefreshing(true);
        binding.progress.setVisibility(View.VISIBLE);
        binding.empty.setVisibility(View.GONE);
        binding.content.removeAllViews();
        if (OVERVIEW.equals(section)) loadOverview(loadGeneration);
        else if (MATERIALS.equals(section)) loadMaterials(loadGeneration);
        else if (RULES.equals(section)) loadRules(loadGeneration);
        else if (ENTRIES.equals(section)) loadEntries(loadGeneration);
        else loadDebts(loadGeneration);
    }

    private void loadOverview(int generation) {
        overviewPending = 3;
        reportData = Collections.emptyMap();
        debtsData = Collections.emptyMap();
        materialsData = new ArrayList<>();
        request(
                app.repository().api().expenseReport(
                        filterClientId(),
                        INPUT_DATE.format(dateFrom),
                        INPUT_DATE.format(dateTo),
                        null
                ),
                generation,
                value -> {
                    reportData = value;
                    finishOverview(generation);
                }
        );
        request(
                app.repository().api().expenseMaterials(),
                generation,
                value -> {
                    materialsData = value;
                    finishOverview(generation);
                }
        );
        request(
                app.repository().api().expenseDebts(filterClientId()),
                generation,
                value -> {
                    debtsData = value;
                    finishOverview(generation);
                }
        );
    }

    private void finishOverview(int generation) {
        if (generation != loadGeneration) return;
        overviewPending--;
        if (overviewPending > 0) return;
        stopLoading();
        renderOverview();
    }

    private void loadMaterials(int generation) {
        request(app.repository().api().expenseMaterials(), generation, value -> {
            materialsData = value;
            stopLoading();
            renderMaterials(value);
        });
    }

    private void loadRules(int generation) {
        String clientId = app.state().selectedClientId();
        if (clientId == null || clientId.isBlank()) {
            stopLoading();
            showEmpty("Выберите клиента в верхней части приложения.");
            return;
        }
        request(app.repository().api().expenseMaterialRules(clientId), generation, value -> {
            stopLoading();
            renderRules(value);
        });
    }

    private void loadEntries(int generation) {
        request(
                app.repository().api().expenseEntries(
                        filterClientId(),
                        INPUT_DATE.format(dateFrom),
                        INPUT_DATE.format(dateTo),
                        null,
                        500
                ),
                generation,
                value -> {
                    stopLoading();
                    renderEntries(value);
                }
        );
    }

    private void loadDebts(int generation) {
        request(app.repository().api().expenseDebts(filterClientId()), generation, value -> {
            debtsData = value;
            stopLoading();
            renderDebts(value);
        });
    }

    private void renderOverview() {
        Map<String, Object> totals = map(reportData.get("totals"));
        Map<String, Object> debtTotals = map(debtsData.get("totals"));
        LinearLayout metrics = horizontalWrap();
        metrics.addView(metric("Всего расходов", totals.get("totalRub"), R.color.logoff_red));
        metrics.addView(metric("Материалы", totals.get("materialsRub"), R.color.logoff_blue));
        metrics.addView(metric("Логистика", totals.get("logisticsRub"), R.color.logoff_warning));
        metrics.addView(metric("ФОТ сборщиков", totals.get("payrollPickersRub"), R.color.logoff_success));
        metrics.addView(metric("ПРР", totals.get("handlingPprRub"), R.color.logoff_red));
        metrics.addView(metric("Отдельные работы", totals.get("contractWorkRub"), R.color.logoff_blue));
        metrics.addView(metric("Долг клиентов", debtTotals.get("debtRub"), R.color.logoff_warning));
        binding.content.addView(metrics);

        List<Map<String, Object>> lowStock = new ArrayList<>();
        for (Map<String, Object> material : materialsData) {
            if (bool(material.get("isActive")) && bool(material.get("isLowStock"))) lowStock.add(material);
        }
        MaterialCardView stockCard = sectionCard("Контроль материалов");
        LinearLayout stockBody = cardBody(stockCard);
        if (lowStock.isEmpty()) {
            stockBody.addView(note("Все материалы выше минимального остатка.", R.color.logoff_success));
        } else {
            for (int index = 0; index < Math.min(8, lowStock.size()); index++) {
                Map<String, Object> item = lowStock.get(index);
                stockBody.addView(line(
                        "⚠ " + text(item.get("name")),
                        "Остаток " + quantity(item.get("stockQuantity")) + " " + text(item.get("unit"))
                                + " · минимум " + quantity(item.get("minStockQuantity")),
                        money(item.get("stockValueRub"))
                ));
            }
        }
        binding.content.addView(stockCard, cardParams());

        MaterialCardView workersCard = sectionCard("ФОТ и работы по исполнителям");
        LinearLayout workersBody = cardBody(workersCard);
        List<Map<String, Object>> workers = list(reportData.get("byWorker"));
        for (Map<String, Object> worker : workers) {
            workersBody.addView(line(
                    text(worker.get("workerName")),
                    "ФОТ " + money(worker.get("payrollPickersRub"))
                            + " · ПРР " + money(worker.get("handlingPprRub")),
                    money(worker.get("totalRub"))
            ));
        }
        if (workers.isEmpty()) workersBody.addView(note("Пока нет расходов с указанным исполнителем.", R.color.logoff_text_muted));
        binding.content.addView(workersCard, cardParams());

        MaterialCardView categoriesCard = sectionCard("Расходы по категориям");
        LinearLayout categoriesBody = cardBody(categoriesCard);
        for (Map<String, Object> category : list(reportData.get("byCategory"))) {
            if (numberValue(category.get("amountRub")) <= 0) continue;
            categoriesBody.addView(line(
                    categoryLabel(text(category.get("category"))),
                    integer(category.get("entriesCount")) + " записей",
                    money(category.get("amountRub"))
            ));
        }
        binding.content.addView(categoriesCard, cardParams());
        updateEmpty();
    }

    private void renderMaterials(List<Map<String, Object>> materials) {
        for (Map<String, Object> material : materials) {
            MaterialCardView card = sectionCard(text(material.get("name")));
            LinearLayout body = cardBody(card);
            body.addView(note(text(material.get("code")), R.color.logoff_text_muted));
            body.addView(line(
                    "Остаток",
                    quantity(material.get("stockQuantity")) + " " + text(material.get("unit"))
                            + " · минимум " + quantity(material.get("minStockQuantity")),
                    money(material.get("stockValueRub"))
            ));
            body.addView(line(
                    "Средняя себестоимость",
                    bool(material.get("isLowStock")) ? "Нужно пополнить" : "Остаток достаточный",
                    money(material.get("averageUnitCostRub"))
            ));
            LinearLayout actions = actionRow();
            if (canWrite) {
                actions.addView(action("Движение", () -> showStockDialog(material)), actionParams());
                actions.addView(action(
                        bool(material.get("isActive")) ? "Отключить" : "Включить",
                        () -> toggleMaterial(material)
                ), actionParams());
            }
            actions.addView(action("История", () -> showMaterialHistory(material)), actionParams());
            body.addView(actions);
            binding.content.addView(card, cardParams());
        }
        updateEmpty();
    }

    private void renderRules(Map<String, Object> data) {
        Map<String, Object> client = map(data.get("client"));
        binding.content.addView(heading(
                "Клиент: " + text(client.get("name")),
                "При закрытии заявки указанное количество автоматически списывается на каждую отправленную единицу."
        ));
        for (Map<String, Object> row : list(data.get("materials"))) {
            Map<String, Object> material = map(row.get("material"));
            MaterialCardView card = sectionCard(text(material.get("name")));
            LinearLayout body = cardBody(card);
            body.addView(note(
                    text(material.get("code")) + " · на складе "
                            + quantity(material.get("stockQuantity")) + " " + text(material.get("unit")),
                    R.color.logoff_text_muted
            ));
            MaterialSwitch enabled = new MaterialSwitch(requireContext());
            enabled.setText("Списывать автоматически");
            enabled.setChecked(bool(row.get("isEnabled")));
            enabled.setEnabled(canWrite);
            body.addView(enabled);
            TextInputEditText quantity = field(body, "На 1 отправленную единицу", decimal(row.get("quantityPerShippedUnit")), true);
            MaterialSwitch separate = new MaterialSwitch(requireContext());
            separate.setText("Начислять клиенту отдельно");
            separate.setChecked(bool(row.get("chargeSeparately")));
            separate.setEnabled(canWrite);
            body.addView(separate);
            TextInputEditText price = field(
                    body,
                    "Цена клиенту, ₽",
                    nullableDecimal(row.get("billingUnitPriceRub")),
                    true
            );
            TextInputEditText comment = field(body, "Комментарий", text(row.get("comment")), false);
            Runnable updateEnabled = () -> {
                quantity.setEnabled(canWrite && enabled.isChecked());
                separate.setEnabled(canWrite && enabled.isChecked());
                price.setEnabled(canWrite && enabled.isChecked() && separate.isChecked());
            };
            enabled.setOnCheckedChangeListener((button, checked) -> updateEnabled.run());
            separate.setOnCheckedChangeListener((button, checked) -> updateEnabled.run());
            updateEnabled.run();
            if (canWrite) {
                MaterialButton save = primaryAction("Сохранить правило");
                save.setOnClickListener(view -> {
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("isEnabled", enabled.isChecked());
                    payload.put("quantityPerShippedUnit", positiveOr(quantity, 1));
                    payload.put("chargeSeparately", separate.isChecked());
                    if (separate.isChecked()) payload.put("billingUnitPriceRub", positiveOr(price, 0));
                    if (!value(comment).isBlank()) payload.put("comment", value(comment));
                    save.setEnabled(false);
                    app.repository().api().updateExpenseMaterialRule(
                            app.state().selectedClientId(),
                            text(material.get("id")),
                            payload
                    ).enqueue(new Callback<>() {
                        @Override
                        public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                            runUi(() -> {
                                save.setEnabled(true);
                                if (response.isSuccessful()) {
                                    toast("Правило сохранено");
                                    refresh();
                                } else toast(errorMessage(response));
                            });
                        }

                        @Override
                        public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                            runUi(() -> {
                                save.setEnabled(true);
                                toast(MobileRepository.readable(error));
                            });
                        }
                    });
                });
                body.addView(save, fullButtonParams());
            }
            binding.content.addView(card, cardParams());
        }
        updateEmpty();
    }

    private void renderEntries(List<Map<String, Object>> entries) {
        for (Map<String, Object> entry : entries) {
            MaterialCardView card = sectionCard(text(entry.get("description")));
            LinearLayout body = cardBody(card);
            body.addView(line(
                    categoryLabel(text(entry.get("category"))),
                    displayDate(text(entry.get("expenseDate")))
                            + optional(" · " + nested(entry, "client", "name")),
                    money(entry.get("amountRub"))
            ));
            String calculation = "";
            if (entry.get("quantity") instanceof Number) {
                calculation = quantity(entry.get("quantity")) + " " + text(entry.get("unit"))
                        + " × " + money(entry.get("unitPriceRub"));
            }
            body.addView(note(
                    join(" · ", calculation, optionalWorker(entry), sourceLabel(text(entry.get("source")))),
                    R.color.logoff_text_muted
            ));
            if (canWrite
                    && "ACTIVE".equals(text(entry.get("status")))
                    && ("MANUAL".equals(text(entry.get("source")))
                    || "LOGISTICS".equals(text(entry.get("source"))))) {
                MaterialButton cancel = action("Отменить расход", () -> confirmCancelExpense(entry));
                cancel.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_red));
                body.addView(cancel, fullButtonParams());
            }
            binding.content.addView(card, cardParams());
        }
        updateEmpty();
    }

    private void renderDebts(Map<String, Object> report) {
        Map<String, Object> totals = map(report.get("totals"));
        binding.content.addView(heading(
                "Общий долг: " + money(totals.get("debtRub")),
                "Учтены проведённые оплаты и авансирование. Нажмите на клиента для расшифровки."
        ));
        for (Map<String, Object> client : list(report.get("clients"))) {
            Map<String, Object> clientInfo = map(client.get("client"));
            MaterialCardView card = sectionCard(text(clientInfo.get("name")));
            card.setClickable(true);
            card.setFocusable(true);
            card.setOnClickListener(view -> showDebtDetails(client));
            LinearLayout body = cardBody(card);
            body.addView(note(text(clientInfo.get("code")), R.color.logoff_text_muted));
            body.addView(line(
                    "Долг",
                    "Открыто счетов: " + integer(client.get("openInvoicesCount")),
                    money(client.get("debtRub"))
            ));
            body.addView(line(
                    "Просрочено",
                    "Аванс: " + money(client.get("advanceRub")),
                    money(client.get("overdueRub"))
            ));
            binding.content.addView(card, cardParams());
        }
        updateEmpty();
    }

    private void showCreateExpenseDialog() {
        LinearLayout form = dialogForm();
        Spinner category = spinner(form, CATEGORY_LABELS);
        TextInputEditText date = field(form, "Дата", INPUT_DATE.format(LocalDate.now(MOSCOW)), false);
        TextInputEditText description = field(form, "Описание", "", false);
        TextInputEditText amount = field(form, "Сумма, ₽", "", true);
        List<String> clientLabels = new ArrayList<>();
        clientLabels.add("Общий расход");
        for (Map<String, Object> client : app.state().clients()) {
            clientLabels.add(text(client.get("name")) + " (" + text(client.get("code")) + ")");
        }
        Spinner client = spinner(form, clientLabels.toArray(new String[0]));
        if (currentClientOnly) {
            int index = selectedClientIndex() + 1;
            if (index > 0 && index < clientLabels.size()) client.setSelection(index);
        }
        TextInputEditText worker = field(form, "Сборщик / исполнитель", "", false);
        TextInputEditText quantity = field(form, "Количество / часы", "", true);
        TextInputEditText unit = field(form, "Единица: час, рейс, смена", "", false);
        TextInputEditText rate = field(form, "Ставка, ₽", "", true);
        TextInputEditText comment = field(form, "Комментарий", "", false);
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle("Новый расход")
                .setView(scroll(form))
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Сохранить", (dialog, which) -> {
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("category", CATEGORY_CODES[category.getSelectedItemPosition()]);
                    payload.put("expenseDate", value(date));
                    payload.put("description", value(description));
                    double amountValue = positiveOr(amount, 0);
                    if (amountValue <= 0 && !value(quantity).isBlank() && !value(rate).isBlank()) {
                        amountValue = positiveOr(quantity, 0) * positiveOr(rate, 0);
                    }
                    payload.put("amountRub", amountValue);
                    if (client.getSelectedItemPosition() > 0) {
                        payload.put("clientId", text(app.state().clients().get(client.getSelectedItemPosition() - 1).get("id")));
                    }
                    putIfNotBlank(payload, "workerName", worker);
                    putNumberIfNotBlank(payload, "quantity", quantity);
                    putIfNotBlank(payload, "unit", unit);
                    putNumberIfNotBlank(payload, "unitPriceRub", rate);
                    putIfNotBlank(payload, "comment", comment);
                    performMap(
                            app.repository().api().createExpense(payload),
                            "Расход добавлен",
                            this::load
                    );
                })
                .show();
    }

    private void showCreateMaterialDialog() {
        LinearLayout form = dialogForm();
        TextInputEditText code = field(form, "Код материала", "", false);
        TextInputEditText name = field(form, "Название", "", false);
        TextInputEditText unit = field(form, "Единица измерения", "шт.", false);
        TextInputEditText initial = field(form, "Начальный остаток", "0", true);
        TextInputEditText cost = field(form, "Себестоимость единицы, ₽", "0", true);
        TextInputEditText minimum = field(form, "Минимальный остаток", "0", true);
        TextInputEditText comment = field(form, "Комментарий", "", false);
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle("Новый расходный материал")
                .setView(scroll(form))
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Сохранить", (dialog, which) -> {
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("code", value(code));
                    payload.put("name", value(name));
                    payload.put("unit", value(unit));
                    payload.put("initialQuantity", positiveOr(initial, 0));
                    payload.put("averageUnitCostRub", positiveOr(cost, 0));
                    payload.put("minStockQuantity", positiveOr(minimum, 0));
                    putIfNotBlank(payload, "comment", comment);
                    performMap(
                            app.repository().api().createExpenseMaterial(payload),
                            "Материал создан",
                            this::load
                    );
                })
                .show();
    }

    private void showStockDialog(Map<String, Object> material) {
        LinearLayout form = dialogForm();
        String[] labels = {"Закупка / приход", "Корректировка (+ или −)", "Списание"};
        String[] codes = {"PURCHASE", "ADJUSTMENT", "WRITE_OFF"};
        Spinner type = spinner(form, labels);
        TextInputEditText quantity = field(form, "Количество", "", true);
        TextInputEditText cost = field(
                form,
                "Цена за единицу, ₽",
                nullableDecimal(material.get("averageUnitCostRub")),
                true
        );
        TextInputEditText date = field(form, "Дата", INPUT_DATE.format(LocalDate.now(MOSCOW)), false);
        TextInputEditText comment = field(form, "Комментарий", "", false);
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle(text(material.get("name")))
                .setView(scroll(form))
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Провести", (dialog, which) -> {
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("type", codes[type.getSelectedItemPosition()]);
                    payload.put("quantity", signedNumber(quantity));
                    if (!value(cost).isBlank()) payload.put("unitCostRub", positiveOr(cost, 0));
                    payload.put("expenseDate", value(date));
                    putIfNotBlank(payload, "comment", comment);
                    performMap(
                            app.repository().api().updateExpenseMaterialStock(text(material.get("id")), payload),
                            "Движение проведено",
                            this::load
                    );
                })
                .show();
    }

    private void showMaterialHistory(Map<String, Object> material) {
        requestDialog(
                app.repository().api().expenseMaterialMovements(text(material.get("id"))),
                rows -> {
                    StringBuilder message = new StringBuilder();
                    for (Map<String, Object> row : rows) {
                        if (message.length() > 0) message.append("\n\n");
                        double qty = numberValue(row.get("quantity"));
                        message.append(displayDate(text(row.get("createdAt"))))
                                .append(" · ")
                                .append(movementLabel(text(row.get("type"))))
                                .append("\n")
                                .append(qty > 0 ? "+" : "")
                                .append(quantity(qty))
                                .append(" ")
                                .append(text(material.get("unit")));
                        String client = nested(row, "client", "name");
                        String request = nested(row, "request", "number");
                        if (!client.isBlank()) message.append(" · ").append(client);
                        if (!request.isBlank()) message.append(" · заявка №").append(request);
                        if (!text(row.get("comment")).isBlank()) message.append("\n").append(text(row.get("comment")));
                    }
                    new MaterialAlertDialogBuilder(requireContext())
                            .setTitle("История: " + text(material.get("name")))
                            .setMessage(message.length() == 0 ? "Движений пока нет." : message.toString())
                            .setPositiveButton("Закрыть", null)
                            .show();
                }
        );
    }

    private void toggleMaterial(Map<String, Object> material) {
        boolean active = bool(material.get("isActive"));
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("isActive", !active);
        performMap(
                app.repository().api().updateExpenseMaterial(text(material.get("id")), payload),
                active ? "Материал отключён" : "Материал включён",
                this::load
        );
    }

    private void confirmCancelExpense(Map<String, Object> entry) {
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle("Отменить расход?")
                .setMessage(text(entry.get("description")) + "\n" + money(entry.get("amountRub")))
                .setNegativeButton("Нет", null)
                .setPositiveButton("Отменить", (dialog, which) ->
                        performMap(
                                app.repository().api().cancelExpense(text(entry.get("id"))),
                                "Расход отменён",
                                this::load
                        )
                )
                .show();
    }

    private void showDebtDetails(Map<String, Object> client) {
        StringBuilder message = new StringBuilder();
        for (Map<String, Object> invoice : list(client.get("invoices"))) {
            if (numberValue(invoice.get("remainingRub")) <= 0) continue;
            if (message.length() > 0) message.append("\n\n");
            message.append("Счёт ").append(text(invoice.get("number")))
                    .append(" · осталось ").append(money(invoice.get("remainingRub")));
            for (Map<String, Object> item : list(invoice.get("items"))) {
                message.append("\n• ").append(text(item.get("description")))
                        .append(" — ").append(money(item.get("totalRub")));
            }
        }
        Map<String, Object> clientInfo = map(client.get("client"));
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle(text(clientInfo.get("name")))
                .setMessage(message.length() == 0 ? "Открытых счетов нет." : message.toString())
                .setPositiveButton("Закрыть", null)
                .show();
    }

    private void exportReport() {
        binding.exportAction.setEnabled(false);
        app.repository().api().expenseReportXlsx(
                filterClientId(),
                INPUT_DATE.format(dateFrom),
                INPUT_DATE.format(dateTo),
                null
        ).enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<ResponseBody> call, Response<ResponseBody> response) {
                if (!response.isSuccessful() || response.body() == null) {
                    runUi(() -> {
                        binding.exportAction.setEnabled(true);
                        toast(errorMessage(response));
                    });
                    return;
                }
                String file = "Расходы_" + INPUT_DATE.format(dateFrom) + "_" + INPUT_DATE.format(dateTo) + ".xlsx";
                DocumentSaver.save(
                        requireContext().getApplicationContext(),
                        file,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        response.body(),
                        new DocumentSaver.Callback() {
                            @Override
                            public void saved(Uri uri) {
                                runUi(() -> {
                                    if (binding != null) binding.exportAction.setEnabled(true);
                                    toast("Excel сохранён в загрузки: " + file);
                                });
                            }

                            @Override
                            public void failed(String message) {
                                runUi(() -> {
                                    if (binding != null) binding.exportAction.setEnabled(true);
                                    toast(message);
                                });
                            }
                        }
                );
            }

            @Override
            public void onFailure(Call<ResponseBody> call, Throwable error) {
                runUi(() -> {
                    if (binding != null) binding.exportAction.setEnabled(true);
                    toast(MobileRepository.readable(error));
                });
            }
        });
    }

    private <T> void request(Call<T> call, int generation, Success<T> success) {
        call.enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<T> request, Response<T> response) {
                runUi(() -> {
                    if (generation != loadGeneration || binding == null) return;
                    if (response.isSuccessful() && response.body() != null) {
                        success.accept(response.body());
                    } else {
                        if (OVERVIEW.equals(section)) finishOverview(generation);
                        else stopLoading();
                        toast(errorMessage(response));
                    }
                });
            }

            @Override
            public void onFailure(Call<T> request, Throwable error) {
                runUi(() -> {
                    if (generation != loadGeneration || binding == null) return;
                    if (OVERVIEW.equals(section)) finishOverview(generation);
                    else stopLoading();
                    toast(MobileRepository.readable(error));
                });
            }
        });
    }

    private <T> void requestDialog(Call<T> call, Success<T> success) {
        toast("Загружаю данные…");
        call.enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<T> request, Response<T> response) {
                runUi(() -> {
                    if (!isAdded()) return;
                    if (response.isSuccessful() && response.body() != null) success.accept(response.body());
                    else toast(errorMessage(response));
                });
            }

            @Override
            public void onFailure(Call<T> request, Throwable error) {
                runUi(() -> toast(MobileRepository.readable(error)));
            }
        });
    }

    private void performMap(Call<Map<String, Object>> call, String successMessage, Runnable after) {
        call.enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<Map<String, Object>> request, Response<Map<String, Object>> response) {
                runUi(() -> {
                    if (response.isSuccessful()) {
                        toast(successMessage);
                        after.run();
                    } else toast(errorMessage(response));
                });
            }

            @Override
            public void onFailure(Call<Map<String, Object>> request, Throwable error) {
                runUi(() -> toast(MobileRepository.readable(error)));
            }
        });
    }

    private void stopLoading() {
        if (binding == null) return;
        binding.swipe.setRefreshing(false);
        binding.progress.setVisibility(View.GONE);
    }

    private void updateEmpty() {
        if (binding == null) return;
        binding.empty.setVisibility(binding.content.getChildCount() == 0 ? View.VISIBLE : View.GONE);
    }

    private void showEmpty(String message) {
        binding.empty.setText(message);
        binding.empty.setVisibility(View.VISIBLE);
    }

    private MaterialCardView metric(String label, Object value, int accent) {
        MaterialCardView card = new MaterialCardView(requireContext());
        card.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.logoff_card));
        card.setStrokeColor(ContextCompat.getColor(requireContext(), R.color.logoff_border));
        card.setStrokeWidth(dp(1));
        card.setRadius(dp(18));
        card.setCardElevation(0);
        LinearLayout body = new LinearLayout(requireContext());
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(14), dp(13), dp(14), dp(13));
        TextView dot = textView("●  " + label, 12, accent, Typeface.BOLD);
        TextView amount = textView(money(value), 20, R.color.logoff_black, Typeface.BOLD);
        body.addView(dot);
        LinearLayout.LayoutParams amountParams = new LinearLayout.LayoutParams(-1, -2);
        amountParams.topMargin = dp(7);
        body.addView(amount, amountParams);
        card.addView(body);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1f);
        params.setMargins(dp(4), dp(4), dp(4), dp(4));
        card.setLayoutParams(params);
        return card;
    }

    private LinearLayout horizontalWrap() {
        LinearLayout outer = new LinearLayout(requireContext());
        outer.setOrientation(LinearLayout.VERTICAL);
        List<LinearLayout> rows = new ArrayList<>();
        for (int index = 0; index < 4; index++) {
            LinearLayout row = new LinearLayout(requireContext());
            row.setOrientation(LinearLayout.HORIZONTAL);
            rows.add(row);
            outer.addView(row);
        }
        outer.setTag(rows);
        return new MetricWrapLayout(outer, rows);
    }

    private final class MetricWrapLayout extends LinearLayout {
        private final LinearLayout outer;
        private final List<LinearLayout> rows;
        private int next;

        MetricWrapLayout(LinearLayout outer, List<LinearLayout> rows) {
            super(requireContext());
            this.outer = outer;
            this.rows = rows;
            setOrientation(VERTICAL);
            addView(outer);
        }

        @Override
        public void addView(View child) {
            if (child == outer) {
                super.addView(child);
                return;
            }
            rows.get(Math.min(next / 2, rows.size() - 1)).addView(child);
            next++;
        }
    }

    private MaterialCardView sectionCard(String title) {
        MaterialCardView card = new MaterialCardView(requireContext());
        card.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.logoff_card));
        card.setRadius(dp(20));
        card.setCardElevation(0);
        card.setStrokeWidth(dp(1));
        card.setStrokeColor(ContextCompat.getColor(requireContext(), R.color.logoff_border));
        LinearLayout body = new LinearLayout(requireContext());
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(16), dp(15), dp(16), dp(15));
        body.addView(textView(title, 17, R.color.logoff_black, Typeface.BOLD));
        card.addView(body);
        return card;
    }

    private LinearLayout cardBody(MaterialCardView card) {
        return (LinearLayout) card.getChildAt(0);
    }

    private View heading(String title, String subtitle) {
        MaterialCardView card = sectionCard(title);
        cardBody(card).addView(note(subtitle, R.color.logoff_text_muted));
        return card;
    }

    private View line(String title, String subtitle, String amount) {
        LinearLayout row = new LinearLayout(requireContext());
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(11), 0, dp(11));
        LinearLayout labels = new LinearLayout(requireContext());
        labels.setOrientation(LinearLayout.VERTICAL);
        labels.addView(textView(title, 14, R.color.logoff_black, Typeface.BOLD));
        if (!subtitle.isBlank()) labels.addView(textView(subtitle, 11, R.color.logoff_text_muted, Typeface.NORMAL));
        row.addView(labels, new LinearLayout.LayoutParams(0, -2, 1f));
        if (!amount.isBlank()) {
            TextView right = textView(amount, 14, R.color.logoff_black, Typeface.BOLD);
            right.setGravity(Gravity.END);
            row.addView(right, new LinearLayout.LayoutParams(-2, -2));
        }
        return row;
    }

    private TextView note(String value, int color) {
        TextView note = textView(value, 12, color, Typeface.NORMAL);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(6);
        note.setLayoutParams(params);
        return note;
    }

    private TextView textView(String value, int size, int color, int typeface) {
        TextView view = new TextView(requireContext());
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(ContextCompat.getColor(requireContext(), color));
        view.setTypeface(null, typeface);
        return view;
    }

    private LinearLayout actionRow() {
        LinearLayout row = new LinearLayout(requireContext());
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.END);
        return row;
    }

    private MaterialButton action(String title, Runnable action) {
        MaterialButton button = new MaterialButton(
                requireContext(),
                null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle
        );
        button.setText(title);
        button.setAllCaps(false);
        button.setCornerRadius(dp(13));
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private MaterialButton primaryAction(String title) {
        MaterialButton button = new MaterialButton(requireContext());
        button.setText(title);
        button.setAllCaps(false);
        button.setCornerRadius(dp(14));
        return button;
    }

    private LinearLayout dialogForm() {
        LinearLayout form = new LinearLayout(requireContext());
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(2), dp(4), dp(2), dp(12));
        return form;
    }

    private View scroll(View content) {
        android.widget.ScrollView scroll = new android.widget.ScrollView(requireContext());
        scroll.setFillViewport(true);
        scroll.addView(content);
        int height = Math.min(dp(600), getResources().getDisplayMetrics().heightPixels * 3 / 4);
        scroll.setLayoutParams(new ViewGroup.LayoutParams(-1, height));
        return scroll;
    }

    private TextInputEditText field(LinearLayout parent, String hint, String initial, boolean number) {
        TextInputLayout layout = new TextInputLayout(
                requireContext(),
                null,
                com.google.android.material.R.attr.textInputOutlinedStyle
        );
        layout.setHint(hint);
        layout.setBoxCornerRadii(dp(14), dp(14), dp(14), dp(14));
        TextInputEditText input = new TextInputEditText(requireContext());
        input.setText(initial);
        input.setSingleLine(!hint.toLowerCase(Locale.ROOT).contains("комментар"));
        if (number) {
            input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL | InputType.TYPE_NUMBER_FLAG_SIGNED);
        }
        layout.addView(input, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(10);
        parent.addView(layout, params);
        return input;
    }

    private Spinner spinner(LinearLayout parent, String[] values) {
        Spinner spinner = new Spinner(requireContext());
        ArrayAdapter<String> adapter = new ArrayAdapter<>(requireContext(), android.R.layout.simple_spinner_item, values);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(54));
        params.topMargin = dp(8);
        parent.addView(spinner, params);
        return spinner;
    }

    private LinearLayout.LayoutParams cardParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(10);
        return params;
    }

    private LinearLayout.LayoutParams actionParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(46), 1f);
        params.setMargins(dp(3), dp(10), dp(3), 0);
        return params;
    }

    private LinearLayout.LayoutParams fullButtonParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(48));
        params.topMargin = dp(12);
        return params;
    }

    private String filterClientId() {
        return currentClientOnly ? app.state().selectedClientId() : null;
    }

    private int selectedClientIndex() {
        String selected = app.state().selectedClientId();
        for (int index = 0; index < app.state().clients().size(); index++) {
            if (selected != null && selected.equals(text(app.state().clients().get(index).get("id")))) return index;
        }
        return -1;
    }

    private void putIfNotBlank(Map<String, Object> payload, String key, EditText value) {
        if (!value(value).isBlank()) payload.put(key, value(value));
    }

    private void putNumberIfNotBlank(Map<String, Object> payload, String key, EditText value) {
        if (!value(value).isBlank()) payload.put(key, signedNumber(value));
    }

    private String value(EditText input) {
        return input.getText() == null ? "" : input.getText().toString().trim().replace(',', '.');
    }

    private double positiveOr(EditText input, double fallback) {
        try {
            double value = Double.parseDouble(value(input));
            return value < 0 ? fallback : value;
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private double signedNumber(EditText input) {
        try {
            return Double.parseDouble(value(input));
        } catch (Exception ignored) {
            return 0;
        }
    }

    private String errorMessage(Response<?> response) {
        String raw = MobileRepository.errorMessage(response);
        int marker = raw.indexOf("\"message\"");
        if (marker >= 0) {
            int colon = raw.indexOf(':', marker);
            int start = raw.indexOf('"', colon + 1);
            int end = start < 0 ? -1 : raw.indexOf('"', start + 1);
            if (start >= 0 && end > start) return raw.substring(start + 1, end);
        }
        return raw.length() > 240 ? "Не удалось выполнить действие. Проверьте введённые данные." : raw;
    }

    private String categoryLabel(String code) {
        if ("MATERIALS".equals(code)) return "Расходные материалы";
        for (int index = 0; index < CATEGORY_CODES.length; index++) {
            if (CATEGORY_CODES[index].equals(code)) return CATEGORY_LABELS[index];
        }
        return code;
    }

    private String sourceLabel(String code) {
        if ("MATERIAL_PURCHASE".equals(code)) return "Закупка материала";
        if ("AUTO_MATERIAL_CONSUMPTION".equals(code)) return "Автосписание по заявке";
        if ("MATERIAL_WRITE_OFF".equals(code)) return "Списание материала";
        if ("LOGISTICS".equals(code)) return "Логистика";
        return "Внесено вручную";
    }

    private String movementLabel(String code) {
        if ("INITIAL".equals(code)) return "Начальный остаток";
        if ("PURCHASE".equals(code)) return "Закупка";
        if ("CONSUMPTION".equals(code)) return "Автосписание";
        if ("WRITE_OFF".equals(code)) return "Списание";
        return "Корректировка";
    }

    private String optionalWorker(Map<String, Object> entry) {
        String worker = text(entry.get("workerName"));
        return worker.isBlank() ? "" : "Исполнитель: " + worker;
    }

    private String optional(String value) {
        return value.endsWith(" · ") || value.trim().equals("·") ? "" : value;
    }

    private String join(String separator, String... values) {
        List<String> result = new ArrayList<>();
        for (String value : values) if (value != null && !value.isBlank()) result.add(value);
        return String.join(separator, result);
    }

    private String displayDate(String raw) {
        if (raw == null || raw.isBlank()) return "";
        try {
            return DISPLAY_DATE.format(Instant.parse(raw).atZone(MOSCOW).toLocalDate());
        } catch (Exception ignored) {
            try {
                return DISPLAY_DATE.format(LocalDate.parse(raw.substring(0, 10)));
            } catch (Exception ignoredAgain) {
                return raw;
            }
        }
    }

    private String money(Object value) {
        return NumberFormat.getCurrencyInstance(new Locale("ru", "RU")).format(numberValue(value));
    }

    private String quantity(Object value) {
        double number = numberValue(value);
        if (Math.abs(number - Math.rint(number)) < 0.0001) {
            return NumberFormat.getIntegerInstance(new Locale("ru", "RU")).format((long) number);
        }
        return NumberFormat.getNumberInstance(new Locale("ru", "RU")).format(number);
    }

    private String decimal(Object value) {
        return String.valueOf(numberValue(value));
    }

    private String nullableDecimal(Object value) {
        return value instanceof Number ? decimal(value) : "";
    }

    private long integer(Object value) {
        return value instanceof Number ? ((Number) value).longValue() : 0;
    }

    private double numberValue(Object value) {
        if (value instanceof Number) return ((Number) value).doubleValue();
        try {
            return Double.parseDouble(text(value).replace(',', '.'));
        } catch (Exception ignored) {
            return 0;
        }
    }

    private boolean bool(Object value) {
        return value instanceof Boolean ? (Boolean) value : "true".equalsIgnoreCase(text(value));
    }

    private String text(Object value) {
        return value == null || "null".equals(String.valueOf(value)) ? "" : String.valueOf(value).trim();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> ? (Map<String, Object>) value : Collections.emptyMap();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> list(Object value) {
        if (!(value instanceof List<?>)) return new ArrayList<>();
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : (List<?>) value) {
            if (item instanceof Map<?, ?>) result.add((Map<String, Object>) item);
        }
        return result;
    }

    private String nested(Map<String, Object> value, String object, String key) {
        return text(map(value.get(object)).get(key));
    }

    private void runUi(Runnable action) {
        if (getActivity() != null) getActivity().runOnUiThread(() -> {
            if (isAdded()) action.run();
        });
    }

    private void toast(String message) {
        if (isAdded()) Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onDestroyView() {
        binding = null;
        super.onDestroyView();
    }

    private interface Success<T> {
        void accept(T value);
    }
}
