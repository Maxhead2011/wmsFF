package pro.logoff.wms.mobile.ui;

import android.os.Bundle;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import androidx.fragment.app.Fragment;
import androidx.core.content.ContextCompat;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import pro.logoff.wms.mobile.*;
import retrofit2.*;
import java.util.*;

// FIX: fresh, scoped native SKU editing with preflight and explicit confirmation.
// Preflight is not atomic CAS: the existing server API has no revision precondition.
public final class SkuEditorFragment extends Fragment {
 private LogoffApplication app;
 private LinearLayout root, form;
 private TextView status;
 private MaterialButton save, reload;
 private String id, scope, clientId;
 private int generation;
 private boolean busy, loaded;
 private Call<Map<String,Object>> call;
 private Map<String,Object> original=new LinkedHashMap<>();
 private final Map<String,EditText> inputs=new LinkedHashMap<>();

 public static SkuEditorFragment create(String id){
  SkuEditorFragment fragment=new SkuEditorFragment();Bundle args=new Bundle();args.putString("id",id);fragment.setArguments(args);return fragment;
 }
 @Override public View onCreateView(LayoutInflater inflater,ViewGroup parent,Bundle state){
  generation++;app=(LogoffApplication)requireActivity().getApplication();id=requireArguments().getString("id");
  scope=currentScope();busy=false;loaded=false;inputs.clear();
  ScrollView scroll=new ScrollView(requireContext());root=column();scroll.addView(root);
  status=label("");status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);root.addView(status);
  reload=button("Перечитать карточку");root.addView(reload);
  reload.setOnClickListener(v->new MaterialAlertDialogBuilder(requireContext()).setTitle("Перечитать с сервера?")
   .setMessage("Несохранённый ввод будет заменён. После ошибки связи проверьте результат по свежим данным — не повторяйте запись вслепую.")
   .setNegativeButton("Отмена",null).setPositiveButton("Перечитать",(d,w)->load()).show());
  form=column();root.addView(form);save=button("Проверить и сохранить");root.addView(save);save.setOnClickListener(v->confirm());load();return scroll;
 }
 private String currentScope(){return AppState.string(app.state().user().get("id"))+":"+AppState.string(app.state().user().get("activeWarehouseId"))+":"+app.state().selectedClientId();}
 private boolean valid(){return app.state().can("skus:write")&&!AppState.string(app.state().user().get("id")).isEmpty()&&Objects.equals(scope,currentScope());}
 private boolean alive(int epoch){return root!=null&&isAdded()&&epoch==generation;}
 private boolean identity(Map<String,Object> value){return value!=null&&id.equals(AppState.string(value.get("id")))&&Objects.equals(clientId,AppState.string(value.get("clientId")));}
 private void controls(){if(root==null)return;boolean enabled=loaded&&!busy&&valid();save.setEnabled(enabled);reload.setEnabled(!busy&&valid());for(EditText input:inputs.values())input.setEnabled(enabled);}
 private void load(){
  if(root==null||busy)return;
  if(!valid()){status.setText("Недостаточно прав или изменился клиент/филиал. Откройте товар заново.");controls();return;}
  int epoch=++generation;busy=true;loaded=false;form.removeAllViews();inputs.clear();controls();status.setText("Загружаю актуальный товар…");
  call=app.repository().api().skuDetails(id);call.enqueue(new Callback<Map<String,Object>>(){
   public void onResponse(Call<Map<String,Object>> c,Response<Map<String,Object>> response){
    if(!alive(epoch))return;busy=false;Map<String,Object> value=response.body();
    if(!valid()||!response.isSuccessful()||value==null||!id.equals(AppState.string(value.get("id")))||AppState.string(value.get("clientId")).isEmpty()){
     status.setText("Товар не загружен ("+response.code()+"). Изменения заблокированы.");controls();return;
    }
    original=new LinkedHashMap<>(value);clientId=AppState.string(value.get("clientId"));loaded=true;
    for(String[] field:SkuEditPolicy.FIELDS){
     // Missing fields from an older server must never acquire default values.
     if(!original.containsKey(field[0]))continue;
     form.addView(label(field[1]));EditText input=new EditText(requireContext());input.setText(SkuEditPolicy.text(original.get(field[0])));
     input.setContentDescription(field[1]);input.setTextSize(16);input.setTextColor(ContextCompat.getColor(requireContext(),R.color.logoff_black));
     if(!field[2].equals("text"))input.setInputType(InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
     form.addView(input);inputs.put(field[0],input);
    }
    status.setText("Товар: "+AppState.string(value.get("name"))+"\nSKU: "+AppState.string(value.get("internalSku"))+"\nОстатки, штрихкоды и КИЗ не меняются. Габариты могут влиять на расчёт хранения.");controls();
   }
   public void onFailure(Call<Map<String,Object>> c,Throwable error){if(alive(epoch)){busy=false;status.setText("Ошибка загрузки. Перечитайте карточку.");controls();}}
  });
 }
 private void confirm(){
  if(!loaded||busy||!valid())return;
  Map<String,String> entered=new LinkedHashMap<>();for(Map.Entry<String,EditText> e:inputs.entrySet())entered.put(e.getKey(),e.getValue().getText().toString());
  Map<String,Object> delta;
  try{delta=SkuEditPolicy.delta(original,entered);}catch(IllegalArgumentException error){status.setText(error.getMessage());return;}
  if(delta.isEmpty()){status.setText("Нет изменений");return;}
  StringBuilder summary=new StringBuilder(AppState.string(original.get("name"))+"\n");
  for(String[] f:SkuEditPolicy.FIELDS)if(delta.containsKey(f[0]))summary.append(f[1]).append(": ").append(SkuEditPolicy.text(original.get(f[0]))).append(" → ").append(SkuEditPolicy.text(delta.get(f[0])).isEmpty()?"(очистить)":delta.get(f[0])).append("\n");
  int epoch=generation;
  new MaterialAlertDialogBuilder(requireContext()).setTitle("Сохранить изменения товара?").setMessage(summary)
   .setNegativeButton("Отмена",null).setPositiveButton("Сохранить",(d,w)->{if(alive(epoch))preflight(delta,epoch);}).show();
 }
 private void preflight(Map<String,Object> delta,int epoch){
  if(busy||!loaded||!valid())return;busy=true;controls();status.setText("Сверяю изменяемые поля…");
  Map<String,Object> expected=new LinkedHashMap<>();for(String key:delta.keySet())expected.put(key,original.get(key));
  call=app.repository().api().skuDetails(id);call.enqueue(new Callback<Map<String,Object>>(){
   public void onResponse(Call<Map<String,Object>> c,Response<Map<String,Object>> response){
    if(!alive(epoch))return;
    if(!valid()||!response.isSuccessful()||!identity(response.body())||!SkuEditPolicy.matches(expected,response.body())){
     busy=false;loaded=false;status.setText("Товар изменился или недоступен. Перечитайте карточку перед редактированием.");controls();return;
    }
    patch(delta,epoch);
   }
   public void onFailure(Call<Map<String,Object>> c,Throwable error){if(alive(epoch)){busy=false;status.setText("Сверка не выполнена. Изменения не отправлялись.");controls();}}
  });
 }
 private void patch(Map<String,Object> delta,int epoch){
  status.setText("Сохраняю…");call=app.repository().api().updateSkuDetails(id,delta);call.enqueue(new Callback<Map<String,Object>>(){
   public void onResponse(Call<Map<String,Object>> c,Response<Map<String,Object>> response){
    if(!alive(epoch))return;busy=false;loaded=false;
    if(valid()&&response.isSuccessful()&&identity(response.body())&&SkuEditPolicy.matches(delta,response.body()))status.setText("Изменения сохранены. Перечитайте карточку перед следующим редактированием.");
    else status.setText("Сохранение не подтверждено ("+response.code()+"). Перечитайте карточку и проверьте результат.");controls();
   }
   public void onFailure(Call<Map<String,Object>> c,Throwable error){if(alive(epoch)){busy=false;loaded=false;status.setText("Результат неизвестен: связь прервана. Перечитайте товар и проверьте поля. Автоматического повтора нет.");controls();}}
  });
 }
 @Override public void onDestroyView(){generation++;if(call!=null)call.cancel();inputs.clear();root=null;super.onDestroyView();}
 private LinearLayout column(){LinearLayout view=new LinearLayout(requireContext());view.setOrientation(LinearLayout.VERTICAL);int p=Math.round(12*getResources().getDisplayMetrics().density);view.setPadding(p,p,p,p);return view;}
 private TextView label(String text){TextView view=new TextView(requireContext());view.setText(text);view.setTextSize(16);view.setTextColor(ContextCompat.getColor(requireContext(),R.color.logoff_black));return view;}
 private MaterialButton button(String text){MaterialButton view=new MaterialButton(requireContext());view.setText(text);view.setAllCaps(false);view.setMinHeight(Math.round(48*getResources().getDisplayMetrics().density));return view;}
}
