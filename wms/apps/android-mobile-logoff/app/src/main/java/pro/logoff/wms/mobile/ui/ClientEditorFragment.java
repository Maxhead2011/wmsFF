package pro.logoff.wms.mobile.ui;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import androidx.fragment.app.Fragment;
import androidx.core.content.ContextCompat;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import pro.logoff.wms.mobile.*;
import retrofit2.*;
import java.util.*;

// FIX: native contact/requisite editing, fresh read before PATCH, no blind retry on timeout.
public class ClientEditorFragment extends Fragment {
 private LogoffApplication app;private LinearLayout root,form;private TextView status;private MaterialButton save,reload;
 private String id,scope;private int generation;private boolean busy,loaded;private Call<Map<String,Object>> call;
 private Map<String,Object> original=new LinkedHashMap<>();private final Map<String,EditText> inputs=new LinkedHashMap<>();
 private final Map<String,CheckBox> flags=new LinkedHashMap<>();private final Map<String,Spinner> choices=new LinkedHashMap<>();
 public static ClientEditorFragment create(String id){ClientEditorFragment f=new ClientEditorFragment();Bundle b=new Bundle();b.putString("id",id);f.setArguments(b);return f;}
 @Override public View onCreateView(LayoutInflater i,ViewGroup p,Bundle state){
  generation++;app=(LogoffApplication)requireActivity().getApplication();id=requireArguments().getString("id");scope=currentScope();busy=false;loaded=false;inputs.clear();
  ScrollView scroll=new ScrollView(requireContext());root=column();scroll.addView(root);status=label("");status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);root.addView(status);
  reload=button("Сверить / перечитать с сервера");root.addView(reload);reload.setOnClickListener(v->new MaterialAlertDialogBuilder(requireContext()).setTitle("Перечитать карточку?").setMessage("Несохранённый ввод будет заменён текущими данными сервера. После ошибки связи это позволяет проверить результат без повторной записи.").setNegativeButton("Отмена",null).setPositiveButton("Перечитать",(d,w)->load()).show());
  form=column();root.addView(form);save=button("Проверить и сохранить изменения");root.addView(save);save.setOnClickListener(v->confirm());load();return scroll;
 }
 private String currentScope(){return AppState.string(app.state().user().get("id"))+":"+AppState.string(app.state().user().get("activeWarehouseId"));}
 private boolean valid(){return app.state().can("clients:write")&&!AppState.string(app.state().user().get("id")).isEmpty()&&Objects.equals(scope,currentScope());}
 private boolean alive(int epoch){return root!=null&&isAdded()&&epoch==generation;}
 private void controls(){if(root==null)return;save.setEnabled(loaded&&!busy&&valid());reload.setEnabled(!busy&&valid());for(EditText e:inputs.values())e.setEnabled(loaded&&!busy&&valid());for(CheckBox e:flags.values())e.setEnabled(loaded&&!busy&&valid());for(Spinner e:choices.values())e.setEnabled(loaded&&!busy&&valid());}
 private void load(){
  if(root==null||busy)return;if(!valid()){status.setText("Нет права редактирования или изменился филиал. Откройте карточку заново.");controls();return;}
  int epoch=++generation;busy=true;loaded=false;form.removeAllViews();inputs.clear();flags.clear();choices.clear();controls();status.setText("Загружаю актуальную карточку…");call=app.repository().api().clientDetails(id);
  call.enqueue(new Callback<Map<String,Object>>(){
   public void onResponse(Call<Map<String,Object>> c,Response<Map<String,Object>> r){if(!alive(epoch))return;busy=false;if(!valid()||!r.isSuccessful()||r.body()==null||!id.equals(AppState.string(r.body().get("id")))){status.setText("Карточка недоступна ("+r.code()+"). Изменения заблокированы.");controls();return;}original=new LinkedHashMap<>(r.body());loaded=true;
    for(String[] field:ClientEditPolicy.FIELDS){form.addView(label(field[1]));EditText edit=new EditText(requireContext());edit.setText(ClientEditPolicy.value(original.get(field[0])));edit.setContentDescription(field[1]);edit.setTextSize(16);edit.setTextColor(ContextCompat.getColor(requireContext(),R.color.logoff_black));form.addView(edit);inputs.put(field[0],edit);}
    addSettings();status.setText("Клиент "+AppState.string(original.get("code"))+" · "+AppState.string(original.get("name"))+"\nСохраняются только изменённые поля. Настройки учёта влияют на остатки и выставление счетов; проверьте подтверждение. Числовые тарифы и права не меняются.");controls();}
   public void onFailure(Call<Map<String,Object>> c,Throwable e){if(alive(epoch)){busy=false;status.setText("Карточка не загружена. Проверьте связь и перечитайте данные.");controls();}}
  });
 }
 private void confirm(){
  if(!loaded||busy||!valid())return;Map<String,String> entered=new LinkedHashMap<>();for(Map.Entry<String,EditText> e:inputs.entrySet())entered.put(e.getKey(),e.getValue().getText().toString());
  Map<String,Object> delta;try{delta=ClientEditPolicy.delta(original,entered);delta.putAll(ClientSettingsPolicy.delta(original,settingsInput()));}catch(IllegalArgumentException e){status.setText(e.getMessage());return;}if(delta.isEmpty()){status.setText("Нет изменений");return;}
  int epoch=generation;StringBuilder summary=new StringBuilder(AppState.string(original.get("name"))+"\n");for(String[] field:ClientEditPolicy.FIELDS)if(delta.containsKey(field[0]))summary.append(field[1]).append(": ").append(ClientEditPolicy.value(delta.get(field[0])).isEmpty()?"(очистить)":delta.get(field[0])).append("\n");
  for(Map.Entry<String,Object> entry:delta.entrySet())if(ClientSettingsPolicy.supported(entry.getKey(),entry.getValue()))summary.append(ClientSettingsPolicy.title(entry.getKey())).append(": ").append(ClientSettingsPolicy.display(entry.getKey(),original.get(entry.getKey()))).append(" → ").append(ClientSettingsPolicy.display(entry.getKey(),entry.getValue())).append("\n");
  new MaterialAlertDialogBuilder(requireContext()).setTitle("Подтвердить изменения?").setMessage(summary).setNegativeButton("Отмена",null).setPositiveButton("Сохранить",(d,w)->{if(alive(epoch))checkThenSave(delta);}).show();
 }
 // FIX: controls are rendered only for settings understood from a fresh server response.
 private void addSettings(){
  form.addView(label("Складские и расчётные настройки"));
  for(String[] f:ClientSettingsPolicy.FLAGS){if(!ClientSettingsPolicy.supported(f[0],original.get(f[0]))){form.addView(label(f[1]+": недоступно в ответе сервера"));continue;}CheckBox box=new CheckBox(requireContext());box.setText(f[1]);box.setTextColor(ContextCompat.getColor(requireContext(),R.color.logoff_black));box.setChecked(Boolean.TRUE.equals(original.get(f[0])));box.setMinHeight(Math.round(48*getResources().getDisplayMetrics().density));form.addView(box);flags.put(f[0],box);}
  for(String[] f:ClientSettingsPolicy.CHOICES){form.addView(label(f[1]));if(!ClientSettingsPolicy.supported(f[0],original.get(f[0]))){form.addView(label("Неизвестное значение сервера — настройка не изменяется"));continue;}Spinner picker=new Spinner(requireContext());List<String> labels=new ArrayList<>();int selected=0;for(int n=2;n<f.length;n+=2){labels.add(f[n+1]);if(f[n].equals(original.get(f[0])))selected=(n-2)/2;}ArrayAdapter<String> adapter=new ArrayAdapter<>(requireContext(),android.R.layout.simple_spinner_item,labels);adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);picker.setAdapter(adapter);picker.setSelection(selected);picker.setContentDescription(f[1]);picker.setMinimumHeight(Math.round(48*getResources().getDisplayMetrics().density));form.addView(picker);choices.put(f[0],picker);}
 }
 private Map<String,Object> settingsInput(){Map<String,Object> out=new LinkedHashMap<>();for(Map.Entry<String,CheckBox> e:flags.entrySet())out.put(e.getKey(),e.getValue().isChecked());for(String[] f:ClientSettingsPolicy.CHOICES){Spinner picker=choices.get(f[0]);if(picker!=null&&picker.getSelectedItemPosition()>=0)out.put(f[0],f[2+2*picker.getSelectedItemPosition()]);}return out;}
 private void checkThenSave(Map<String,Object> delta){
  if(busy||!valid()||!loaded)return;int epoch=generation;busy=true;controls();status.setText("Сверяю изменяемые поля с сервером…");Map<String,Object> expected=new LinkedHashMap<>();for(String key:delta.keySet())expected.put(key,original.get(key));call=app.repository().api().clientDetails(id);
  call.enqueue(new Callback<Map<String,Object>>(){
   public void onResponse(Call<Map<String,Object>> c,Response<Map<String,Object>> r){if(!alive(epoch))return;if(!valid()||!r.isSuccessful()||r.body()==null||!ClientEditPolicy.matches(expected,r.body())){busy=false;loaded=false;status.setText("Данные изменились или недоступны. Перечитайте карточку перед редактированием.");controls();return;}patch(delta,epoch);}
   public void onFailure(Call<Map<String,Object>> c,Throwable e){if(alive(epoch)){busy=false;status.setText("Сверка не выполнена. Изменения не отправлялись.");controls();}}
  });
 }
 private void patch(Map<String,Object> delta,int epoch){
  status.setText("Сохраняю…");call=app.repository().api().updateClientDetails(id,delta);call.enqueue(new Callback<Map<String,Object>>(){
   public void onResponse(Call<Map<String,Object>> c,Response<Map<String,Object>> r){if(!alive(epoch))return;busy=false;loaded=false;
    if(r.isSuccessful()&&r.body()!=null&&id.equals(AppState.string(r.body().get("id")))&&ClientEditPolicy.matches(delta,r.body()))status.setText("Изменения сохранены. Перечитайте карточку перед следующим редактированием.");
    else status.setText("Сохранение не подтверждено ("+r.code()+"). Перечитайте карточку; запрос автоматически не повторяется.");controls();}
   public void onFailure(Call<Map<String,Object>> c,Throwable e){if(alive(epoch)){busy=false;loaded=false;status.setText("Связь прервана. Результат неизвестен. Перечитайте карточку и проверьте поля — не повторяйте запись вслепую.");controls();}}
  });
 }
 @Override public void onDestroyView(){generation++;if(call!=null)call.cancel();root=null;super.onDestroyView();}
 private LinearLayout column(){LinearLayout v=new LinearLayout(requireContext());v.setOrientation(LinearLayout.VERTICAL);int p=Math.round(12*getResources().getDisplayMetrics().density);v.setPadding(p,p,p,p);return v;}
 private TextView label(String s){TextView v=new TextView(requireContext());v.setText(s);v.setTextSize(16);v.setTextColor(ContextCompat.getColor(requireContext(),R.color.logoff_black));return v;}
 private MaterialButton button(String s){MaterialButton v=new MaterialButton(requireContext());v.setText(s);v.setAllCaps(false);v.setMinHeight(Math.round(48*getResources().getDisplayMetrics().density));return v;}
}
