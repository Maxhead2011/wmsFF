package pro.logoff.wms.mobile.ui;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.InputFilter;
import android.view.*;
import android.widget.*;
import androidx.fragment.app.Fragment;
import androidx.core.content.ContextCompat;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.squareup.moshi.*;
import pro.logoff.wms.mobile.*;
import pro.logoff.wms.mobile.network.MobileApi;
import retrofit2.*;
import java.util.*;

// FIX: native preview -> explicit confirmation -> durable idempotent operation.
public class FinancialActionsFragment extends Fragment {
 private LinearLayout content,form;
 private TextView status;
 private EditText reason,amount;
 private Spinner invoice,kind;
 private MaterialButton retry;
 private LogoffApplication app;
 private MobileApi api;
 private SharedPreferences prefs;
 private JsonAdapter<Map<String,Object>> adapter;
 private String scope,user,client,from,to;
 private boolean busy,enabled;
 private int generation;
 private final List<Call<?>> calls=new ArrayList<>();
 private List<Map<String,Object>> invoices=new ArrayList<>(),eligible=new ArrayList<>();
 public static FinancialActionsFragment create(String from,String to){FinancialActionsFragment f=new FinancialActionsFragment();Bundle b=new Bundle();b.putString("from",from);b.putString("to",to);f.setArguments(b);return f;}
 @Override public View onCreateView(LayoutInflater i,ViewGroup p,Bundle saved){
  generation++;busy=false;enabled=false;
  app=(LogoffApplication)requireActivity().getApplication();api=app.repository().api();
  user=AppState.string(app.state().user().get("id"));client=app.state().selectedClientId();scope=currentScope();
  from=requireArguments().getString("from");to=requireArguments().getString("to");
  prefs=requireContext().getSharedPreferences("logoff_financial_pending",0);
  adapter=new Moshi.Builder().build().adapter(Types.newParameterizedType(Map.class,String.class,Object.class));
  ScrollView scroll=new ScrollView(requireContext());content=column();scroll.addView(content);
  content.addView(text("Клиент: "+AppState.string(app.state().selectedClient().get("name"))+"\nПериод: "+from+" — "+to+"\nФилиал: "+AppState.string(app.state().user().get("activeWarehouseId"))));
  status=text("");status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);content.addView(status);
  retry=button("Проверить повтором сохранённого запроса");content.addView(retry);
  retry.setOnClickListener(v->new MaterialAlertDialogBuilder(requireContext()).setTitle("Проверить результат?").setMessage("Будет повторён только прежний запрос с тем же ключом. Сервер не создаст второй документ. Выбранные клиент и филиал должны совпадать с исходными.").setNegativeButton("Отмена",null).setPositiveButton("Проверить",(d,w)->sendSaved()).show());
  form=column();content.addView(form);
  if(!validScope()||!SettlementPresentation.validPeriod(from,to)){status.setText("Выберите клиента, филиал, корректный период и проверьте право billing:write.");retry.setEnabled(false);return scroll;}
  load();return scroll;
 }
 private String currentScope(){String u=AppState.string(app.state().user().get("id")),c=app.state().selectedClientId(),w=AppState.string(app.state().user().get("activeWarehouseId"));return u.isEmpty()||c==null||c.isEmpty()||w.isEmpty()?"":u+":"+c+":"+w;}
 private boolean validScope(){return app.state().can("billing:write")&&FinancialActionPolicy.sameScope(scope,currentScope());}
 private boolean alive(){return content!=null&&isAdded();}
 private boolean pending(){return prefs.contains(user);}
 private void controls(){if(!alive())return;setEnabled(form,enabled&&!busy&&!pending()&&validScope());retry.setVisibility(pending()?View.VISIBLE:View.GONE);retry.setEnabled(enabled&&!busy&&validScope());}
 private void setEnabled(View v,boolean value){v.setEnabled(value);if(v instanceof ViewGroup)for(int n=0;n<((ViewGroup)v).getChildCount();n++)setEnabled(((ViewGroup)v).getChildAt(n),value);}
 private void load(){
  int epoch=generation;
  busy=true;controls();status.setText("Проверяю доступность операций…");
  Call<Map<String,Object>> call=api.financialCapabilities();calls.add(call);call.enqueue(new Callback<Map<String,Object>>(){
   public void onResponse(Call<Map<String,Object>> c,Response<Map<String,Object>> r){if(!alive()||epoch!=generation)return;busy=false;enabled=r.isSuccessful()&&r.body()!=null&&Boolean.TRUE.equals(r.body().get("enabled"));if(!enabled){status.setText("Финансовые операции недоступны на сервере");controls();return;}buildForm();loadInvoices();}
   public void onFailure(Call<Map<String,Object>> c,Throwable e){if(alive()&&epoch==generation){busy=false;status.setText("Не удалось проверить доступность. Откройте экран повторно.");controls();}}
  });
 }
 private void buildForm(){
  reason=new EditText(requireContext());reason.setHint("Основание операции (обязательно)");reason.setFilters(new InputFilter[]{new InputFilter.LengthFilter(1000)});form.addView(reason);
  MaterialButton close=button("Проверить закрытие выбранного периода");form.addView(close);close.setOnClickListener(v->preview(true));
  form.addView(text("Исправление сохраняется отдельным документом. Плюс — доначисление, минус — уменьшение. Исходная сумма счёта не перезаписывается."));
  kind=new Spinner(requireContext());kind.setAdapter(new ArrayAdapter<>(requireContext(),android.R.layout.simple_spinner_dropdown_item,new String[]{"Доначисление / уменьшение","Поздняя работа — выставить черновик"}));form.addView(kind);
  invoice=new Spinner(requireContext());form.addView(invoice);
  amount=new EditText(requireContext());amount.setHint("Изменение суммы, ₽ (например −100,50)");amount.setInputType(android.text.InputType.TYPE_CLASS_NUMBER|android.text.InputType.TYPE_NUMBER_FLAG_SIGNED|android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);form.addView(amount);
  kind.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> p,View v,int pos,long id){populateInvoices();}public void onNothingSelected(AdapterView<?> p){}});
  MaterialButton correct=button("Рассчитать исправление счёта");form.addView(correct);correct.setOnClickListener(v->preview(false));
 }
 private void loadInvoices(){
  int epoch=generation;
  busy=true;controls();Call<List<Map<String,Object>>> call=api.correctionInvoices(client);calls.add(call);call.enqueue(new Callback<List<Map<String,Object>>>(){
   public void onResponse(Call<List<Map<String,Object>>> c,Response<List<Map<String,Object>>> r){if(!alive()||epoch!=generation)return;busy=false;if(!validScope()){status.setText("Клиент или филиал изменён. Откройте экран заново.");controls();return;}if(r.isSuccessful()&&r.body()!=null){invoices=r.body();populateInvoices();status.setText(pending()?"Есть незавершённый запрос. Сначала проверьте его результат.":"Выберите операцию. Сохранение возможно только после предварительного расчёта.");}else status.setText("Счета не загружены ("+r.code()+"). Для повторной загрузки откройте экран заново.");controls();}
   public void onFailure(Call<List<Map<String,Object>>> c,Throwable e){if(alive()&&epoch==generation){busy=false;status.setText("Нет связи. Счета не загружены.");controls();}}
  });
 }
 private void populateInvoices(){
  if(invoice==null)return;eligible=new ArrayList<>();List<String> labels=new ArrayList<>();labels.add("Выберите счёт");boolean late=kind.getSelectedItemPosition()==1;
  for(Map<String,Object> row:invoices){String s=AppState.string(row.get("status"));if(late?"DRAFT".equals(s):"ISSUED".equals(s)||"PAID".equals(s)){eligible.add(row);labels.add(AppState.string(row.get("number"))+" · "+SettlementPresentation.money(row.get("totalRub")));}}
  invoice.setAdapter(new ArrayAdapter<>(requireContext(),android.R.layout.simple_spinner_dropdown_item,labels));amount.setVisibility(late?View.GONE:View.VISIBLE);
 }
 private void preview(boolean close){
  int epoch=generation;
  if(busy||pending()||!enabled||!validScope()){status.setText("Операция недоступна. Проверьте незавершённый запрос и выбранного клиента/филиал.");return;}
  String why=reason.getText().toString().trim();if(why.isEmpty()){reason.setError("Укажите основание");return;}
  Map<String,Object> body=new LinkedHashMap<>();
  if(close){body.put("clientId",client);body.put("periodFrom",from);body.put("periodTo",to);}
  else{int pos=invoice.getSelectedItemPosition()-1;if(pos<0||pos>=eligible.size()){status.setText("Выберите счёт");return;}body.put("invoiceId",eligible.get(pos).get("id"));boolean late=kind.getSelectedItemPosition()==1;body.put("kind",late?"LATE_WORK":"ADJUSTMENT");try{body.put("amountRub",late?"0":FinancialActionPolicy.amount(amount.getText().toString()));}catch(IllegalArgumentException e){amount.setError(e.getMessage());return;}body.put("reason",why);}
  busy=true;controls();status.setText("Выполняю предварительный расчёт…");Call<Map<String,Object>> call=close?api.previewPeriodClose(body):api.previewInvoiceCorrection(body);calls.add(call);
  call.enqueue(new Callback<Map<String,Object>>(){
   public void onResponse(Call<Map<String,Object>> c,Response<Map<String,Object>> r){if(!alive()||epoch!=generation)return;busy=false;controls();if(!validScope()){status.setText("Контекст изменился. Повторите операцию из расчётов.");return;}if(!r.isSuccessful()||r.body()==null){error(r.code());return;}Map<String,Object> plan=r.body();String hash=AppState.string(plan.get("previewHash"));if(!hash.matches("[a-f0-9]{64}")){status.setText("Сервер не вернул корректный предварительный расчёт");return;}
    if(close&&!Boolean.TRUE.equals(plan.get("canClose"))){status.setText("Закрытие запрещено: "+String.valueOf(plan.get("issues")));return;}
    Map<String,Object> saved=new LinkedHashMap<>(body);saved.put("reason",why);saved.put("previewHash",hash);if(!close)saved.put("operationKey",UUID.randomUUID().toString());
    String summary=close?"Закрыть период "+from+" — "+to+"?\nСчетов: "+(plan.get("snapshots") instanceof List?((List<?>)plan.get("snapshots")).size():"нет данных"):"Счёт "+AppState.string(plan.get("invoiceNumber"))+"\nИзменение: "+SettlementPresentation.money(plan.get("amountRub"))+"\n"+balance(plan.get("after"));
    summary+="\nОснование: "+why+"\nКлиент: "+AppState.string(app.state().selectedClient().get("name"));
    new MaterialAlertDialogBuilder(requireContext()).setTitle("Подтверждение операции").setMessage(summary).setNegativeButton("Отмена",null).setPositiveButton("Подтвердить",(d,w)->{if(epoch==generation)persist(close,saved);}).show();status.setText("Предварительный расчёт готов. Без подтверждения ничего не изменяется.");
   }
   public void onFailure(Call<Map<String,Object>> c,Throwable e){if(alive()&&epoch==generation){busy=false;status.setText("Расчёт не получен. Изменения не отправлялись.");controls();}}
  });
 }
 private String balance(Object value){if(!(value instanceof Map))return "Нет данных об итоге";Map<?,?> b=(Map<?,?>)value;return "Итого: "+SettlementPresentation.money(b.get("effectiveTotalRub"))+"\nК оплате: "+SettlementPresentation.money(b.get("remainingRub"))+"\nПереплата: "+SettlementPresentation.money(b.get("overpaymentRub"));}
 private void persist(boolean close,Map<String,Object> body){
  if(!alive()||busy||pending()||!validScope())return;
  Map<String,Object> record=new LinkedHashMap<>();record.put("scope",scope);record.put("close",close);record.put("body",body);
  if(!prefs.edit().putString(user,adapter.toJson(record)).commit()){status.setText("Не удалось сохранить защиту от повтора. Запрос не отправлен.");return;}
  sendSaved();
 }
 @SuppressWarnings("unchecked") private void sendSaved(){
  int epoch=generation;
  if(!alive()||busy||!enabled||!validScope()||!pending())return;
  Map<String,Object> record;
  try{record=adapter.fromJson(prefs.getString(user,""));if(record==null||!FinancialActionPolicy.sameScope(scope,AppState.string(record.get("scope")))){status.setText("Сохранённый запрос относится к другому клиенту/филиалу. Вернитесь к исходному контексту.");return;}}catch(Exception e){status.setText("Сохранённый запрос повреждён. Нужна сверка с администратором; новые операции заблокированы.");return;}
  if(!(record.get("body") instanceof Map)){status.setText("Не удалось прочитать сохранённый запрос. Нужна сверка.");return;}
  boolean close=Boolean.TRUE.equals(record.get("close"));Map<String,Object> body=(Map<String,Object>)record.get("body");
  busy=true;controls();status.setText("Сохраняю операцию…");Call<Map<String,Object>> call=close?api.closePeriod(body):api.correctInvoice(body);calls.add(call);
  call.enqueue(new Callback<Map<String,Object>>(){
   public void onResponse(Call<Map<String,Object>> c,Response<Map<String,Object>> r){
    if(!alive()||epoch!=generation)return;
    boolean success=r.isSuccessful()&&r.body()!=null&&r.body().get(close?"period":"correction") instanceof Map;
    boolean clear=success||FinancialActionPolicy.rejected(r.code());boolean cleared=!clear||prefs.edit().remove(user).commit();
    if(!alive())return;busy=false;
    if(!cleared)status.setText("Ответ получен, но локальная отметка не очищена. Проверьте сохранённый запрос повтором.");
    else if(success)status.setText("Операция сохранена. Вернитесь в расчёты и обновите данные.");
    else if(clear)error(r.code());else status.setText("Результат пока неизвестен. Проверьте сохранённый запрос; новую операцию не создавайте.");controls();
   }
   public void onFailure(Call<Map<String,Object>> c,Throwable e){if(alive()&&epoch==generation){busy=false;status.setText("Связь прервана. Результат неизвестен; сохранённый запрос оставлен для проверки.");controls();}}
  });
 }
 private void error(int code){status.setText("Сервер отклонил операцию ("+code+"). Проверьте права, статус счёта и повторите предварительный расчёт.");}
 @Override public void onDestroyView(){generation++;for(Call<?> call:calls)call.cancel();calls.clear();content=null;super.onDestroyView();}
 private LinearLayout column(){LinearLayout v=new LinearLayout(requireContext());v.setOrientation(LinearLayout.VERTICAL);v.setPadding(16,12,16,12);return v;}
 private TextView text(String s){TextView v=new TextView(requireContext());v.setText(s);v.setTextSize(16);v.setTextColor(ContextCompat.getColor(requireContext(),R.color.logoff_black));return v;}
 private MaterialButton button(String s){MaterialButton v=new MaterialButton(requireContext());v.setText(s);v.setAllCaps(false);v.setMinHeight(Math.round(48*getResources().getDisplayMetrics().density));return v;}
}
