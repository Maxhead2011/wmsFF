package pro.logoff.wms.mobile.ui;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import androidx.fragment.app.Fragment;
import androidx.core.content.ContextCompat;
import com.google.android.material.button.MaterialButton;
import pro.logoff.wms.mobile.*;
import pro.logoff.wms.mobile.network.MobileApi;
import pro.logoff.wms.mobile.network.MobileRepository;
import retrofit2.*;
import java.util.*;

// FIX: durable server jobs replace the obsolete /wms-ai/chat route. Never repeat uncertain POSTs.
public class OpenClawFragment extends Fragment {
    private LinearLayout messages;
    private EditText input;
    private MaterialButton send,check,older;
    private TextView status;
    private MobileApi api;
    private SharedPreferences prefs;
    private String key,requestId,cursor;
    private boolean allowed;
    private final List<Call<?>> calls=new ArrayList<>();
    @Override public View onCreateView(LayoutInflater inflater,ViewGroup parent,Bundle saved){
        LogoffApplication app=(LogoffApplication)requireActivity().getApplication();api=app.repository().api();
        prefs=requireContext().getSharedPreferences("logoff_openclaw_jobs",0);key=AppState.string(app.state().user().get("id"));
        requestId=prefs.getString(key+".pending",null);
        LinearLayout root=column();status=text("Проверяю доступ к OpenClaw…");root.addView(status);
        check=button("Проверить результат / обновить историю");check.setOnClickListener(v->{if(requestId!=null)poll();else history(null);});root.addView(check);
        ScrollView scroll=new ScrollView(requireContext());messages=column();scroll.addView(messages);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        older=button("Более ранние сообщения");older.setVisibility(View.GONE);older.setOnClickListener(v->history(cursor));root.addView(older);
        input=new EditText(requireContext());input.setHint("Сообщение OpenClaw");input.setTextColor(color());input.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);input.setMaxLines(4);input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(4000)});root.addView(input);
        send=button("Отправить");send.setEnabled(false);send.setOnClickListener(v->submit());root.addView(send);
        request(api.openClawStatus(),new Result(){public void success(Map<String,Object> data){allowed=Boolean.TRUE.equals(data.get("allowed"));status.setText(allowed?"OpenClaw · права проверены сервером":"OpenClaw недоступен для этой учётной записи");update();if(allowed){history(null);if(requestId!=null)poll();}}});
        return root;
    }
    private void submit(){
        String message=input.getText().toString().trim();if(!allowed||requestId!=null||message.length()<2)return;
        requestId=UUID.randomUUID().toString();
        // Persist only opaque IDs, never messages or credentials. Failure to persist prevents submission.
        String conversation=prefs.getString(key+".conversation",null);if(conversation==null)conversation=UUID.randomUUID().toString();
        if(!prefs.edit().putString(key+".pending",requestId).putString(key+".conversation",conversation).commit()){requestId=null;status.setText("Не удалось сохранить номер операции. Сообщение не отправлено.");return;}
        Map<String,Object> body=new LinkedHashMap<>();body.put("requestId",requestId);body.put("conversationId",conversation);body.put("message",message);
        messages.addView(text("Вы: "+message));input.setText("");update();status.setText("Отправляю. Повторная отправка заблокирована.");
        request(api.submitOpenClaw(body),new Result(){
            public void success(Map<String,Object> data){job(data);}
            public void httpFailure(int code,String error){
                if(OpenClawResultPolicy.definitelyRejected(code)){
                    prefs.edit().remove(key+".pending").apply();requestId=null;input.setText(message);update();status.setText(error);
                }else failure(error);
            }
            public void failure(String error){status.setText(error+"\nИсход неизвестен. Нажмите «Проверить результат»; повторно не отправляйте.");}
        });
    }
    private void poll(){if(requestId==null||!allowed)return;status.setText("Проверяю сохранённую операцию…");request(api.openClawJob(requestId),new Result(){public void success(Map<String,Object> data){job(data);}});}
    private void job(Map<String,Object> data){String state=AppState.string(data.get("status"));
        if("DONE".equals(state)){messages.addView(text(AppState.string(data.get("answer"))));prefs.edit().remove(key+".pending").apply();requestId=null;status.setText("Ответ получен");}
        else status.setText("UNKNOWN".equals(state)?"Результат операции неизвестен. Автоматического повтора нет.":"OpenClaw выполняет запрос. Нажмите «Проверить результат» позже.");
        update();
    }
    private void history(String page){request(api.openClawHistory(page),new Result(){public void success(Map<String,Object> data){if(page==null)messages.removeAllViews();Object rows=data.get("items");if(rows instanceof List<?>)for(Object row:(List<?>)rows)if(row instanceof Map<?,?>){Map<?,?> item=(Map<?,?>)row;messages.addView(text(AppState.string(item.get("createdAt"))+" · "+AppState.string(item.get("userName"))+"\n"+AppState.string(item.get("message"))+"\n"+AppState.string(item.get("answer"))+"\n"+AppState.string(item.get("status"))));}cursor=data.get("nextCursor") instanceof String?(String)data.get("nextCursor"):null;older.setVisibility(cursor==null?View.GONE:View.VISIBLE);}});}
    private abstract class Result{abstract void success(Map<String,Object> data);void failure(String error){status.setText(error);}void httpFailure(int code,String error){failure(error);}}
    private void request(Call<Map<String,Object>> call,Result result){calls.add(call);call.enqueue(new Callback<Map<String,Object>>(){
        public void onResponse(Call<Map<String,Object>> c,Response<Map<String,Object>> response){calls.remove(c);if(messages==null||!isAdded())return;if(response.isSuccessful()&&response.body()!=null)result.success(response.body());else result.httpFailure(response.code(),MobileRepository.errorMessage(response));}
        public void onFailure(Call<Map<String,Object>> c,Throwable error){calls.remove(c);if(messages!=null&&!c.isCanceled())result.failure("Нет связи с сервером");}
    });}
    private void update(){send.setEnabled(allowed&&requestId==null);input.setEnabled(allowed&&requestId==null);check.setEnabled(allowed);}
    @Override public void onDestroyView(){messages=null;for(Call<?> c:new ArrayList<>(calls))c.cancel();calls.clear();super.onDestroyView();}
    private LinearLayout column(){LinearLayout v=new LinearLayout(requireContext());v.setOrientation(LinearLayout.VERTICAL);int p=Math.round(12*getResources().getDisplayMetrics().density);v.setPadding(p,p,p,p);return v;}
    private TextView text(String s){TextView t=new TextView(requireContext());t.setText(s);t.setTextSize(16);t.setTextColor(color());t.setPadding(0,8,0,16);t.setTextIsSelectable(true);return t;}
    private int color(){return ContextCompat.getColor(requireContext(),R.color.logoff_black);}
    private MaterialButton button(String s){MaterialButton b=new MaterialButton(requireContext());b.setText(s);b.setAllCaps(false);return b;}
}
