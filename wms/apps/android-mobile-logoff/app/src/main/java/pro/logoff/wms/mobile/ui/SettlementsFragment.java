package pro.logoff.wms.mobile.ui;

import android.app.DatePickerDialog;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import androidx.fragment.app.Fragment;
import androidx.core.content.ContextCompat;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import pro.logoff.wms.mobile.*;
import retrofit2.*;
import java.time.LocalDate;
import java.util.*;

// FIX: lifecycle-safe native financial report. No writes, WebView or locally calculated debt.
public class SettlementsFragment extends Fragment {
    private String from=LocalDate.now().withDayOfMonth(1).toString(),to=LocalDate.now().toString();
    private LinearLayout results;
    private TextView status;
    private Call<Map<String,Object>> pending;
    private Call<List<Map<String,Object>>> historyCall;
    private int generation;
    @Override public View onCreateView(LayoutInflater inflater,ViewGroup parent,Bundle saved) {
        if(saved!=null){from=saved.getString("from",from);to=saved.getString("to",to);}
        ScrollView scroll=new ScrollView(requireContext());LinearLayout content=column();scroll.addView(content);
        MaterialButton start=button("С: "+from),end=button("По: "+to);
        start.setOnClickListener(v->pick(true,start));end.setOnClickListener(v->pick(false,end));
        content.addView(start);content.addView(end);
        MaterialButton reload=button("Обновить расчёты");reload.setOnClickListener(v->refresh());content.addView(reload);
        MaterialButton history=button("Закрытые периоды");history.setOnClickListener(v->history(false));content.addView(history);
        MaterialButton corrections=button("История корректировок счетов");corrections.setOnClickListener(v->history(true));content.addView(corrections);
        if(((LogoffApplication)requireActivity().getApplication()).state().can("billing:write")){
            MaterialButton actions=button("Исправить счёт / закрыть период");
            actions.setOnClickListener(v->((MainActivity)requireActivity()).showNative(FinancialActionsFragment.create(from,to),"Финансовые операции"));content.addView(actions);
        }
        status=text("",15);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);content.addView(status);
        results=column();content.addView(results);refresh();return scroll;
    }
    @Override public void onSaveInstanceState(Bundle b){super.onSaveInstanceState(b);b.putString("from",from);b.putString("to",to);}
    @Override public void onDestroyView(){generation++;if(pending!=null)pending.cancel();if(historyCall!=null)historyCall.cancel();results=null;status=null;super.onDestroyView();}
    private void pick(boolean first,MaterialButton button){LocalDate date=LocalDate.parse(first?from:to);new DatePickerDialog(requireContext(),(picker,y,m,d)->{
        String value=LocalDate.of(y,m+1,d).toString();if(first)from=value;else to=value;
        button.setText((first?"С: ":"По: ")+value);refresh();
    },date.getYear(),date.getMonthValue()-1,date.getDayOfMonth()).show();}
    public void refresh(){
        if(results==null)return;
        int request=++generation;if(pending!=null)pending.cancel();if(historyCall!=null)historyCall.cancel();results.removeAllViews();
        LogoffApplication app=(LogoffApplication)requireActivity().getApplication();
        if(!app.state().can("billing:read")){status.setText("Нет доступа к расчётам");return;}
        if(!SettlementPresentation.validPeriod(from,to)){status.setText("Укажите период от одного дня до года");return;}
        status.setText("Загружаю расчёты выбранного клиента…");
        pending=app.repository().api().settlements(from,to,app.state().selectedClientId());
        pending.enqueue(new Callback<Map<String,Object>>(){
            @Override public void onResponse(Call<Map<String,Object>> c,Response<Map<String,Object>> response){
                if(results==null||request!=generation||!isAdded())return;
                if(!response.isSuccessful()||response.body()==null){status.setText("Расчёты не загружены ("+response.code()+"). Проверьте доступ и выбранный филиал; суммы не показаны.");return;}
                render(response.body());
            }
            @Override public void onFailure(Call<Map<String,Object>> c,Throwable error){if(results!=null&&request==generation&&!c.isCanceled())status.setText("Нет связи с сервером. Нажмите «Обновить расчёты».");}
        });
    }
    private void history(boolean corrections){
        LogoffApplication app=(LogoffApplication)requireActivity().getApplication();
        String client=app.state().selectedClientId();
        if(!app.state().can("billing:read")||client==null||client.isEmpty()||!SettlementPresentation.validPeriod(from,to)){status.setText("Выберите клиента, доступный период и проверьте права");return;}
        int current=++generation;if(pending!=null)pending.cancel();if(historyCall!=null)historyCall.cancel();results.removeAllViews();status.setText(corrections?"Загружаю корректировки счетов…":"Загружаю историю закрытия периодов…");
        historyCall=corrections?app.repository().api().invoiceCorrections(client,from,to):app.repository().api().closedPeriods(client,from,to);
        historyCall.enqueue(new Callback<List<Map<String,Object>>>(){
            public void onResponse(Call<List<Map<String,Object>>> c,Response<List<Map<String,Object>>> response){
                if(results==null||current!=generation||!isAdded())return;
                if(!response.isSuccessful()||response.body()==null){status.setText("История не загружена ("+response.code()+"). Проверьте доступ и филиал.");return;}
                if(corrections){
                    // FIX: endpoint returns latest 2000 rows across all dates, not the selected report period.
                    status.setText("Последние корректировки за все даты · выбранный клиент и филиал\n"+
                        (response.body().isEmpty()?"Корректировок нет.":"Получено: "+response.body().size())+
                        "\nСервер возвращает до 2000 последних записей. Фильтр дат расчётов здесь не применяется.");
                    correctionPage(response.body(),0,current);return;
                }
                status.setText("Закрытые периоды: "+response.body().size()+"\n"+from+" — "+to);
                for(Map<String,Object> row:response.body())results.addView(text(AppState.string(row.get("periodFrom"))+" — "+AppState.string(row.get("periodTo"))+"\nПричина: "+AppState.string(row.get("reason"))+"\nЗакрыт: "+AppState.string(row.get("createdAt"))+"\nСчетов: "+list(row.get("invoiceIds")).size(),16));
            }
            public void onFailure(Call<List<Map<String,Object>>> c,Throwable e){if(results!=null&&current==generation&&!c.isCanceled())status.setText("Нет связи с сервером. История не загружена.");}
        });
    }
    private void correctionPage(List<Map<String,Object>> rows,int offset,int current){
        if(results==null||current!=generation||!isAdded())return;
        List<Map<String,Object>> page=CorrectionHistoryPresentation.page(rows,offset);
        for(Map<String,Object> row:page){
            MaterialCardView card=new MaterialCardView(requireContext());card.setRadius(dp(14));
            card.setCardBackgroundColor(color(R.color.logoff_card));card.setStrokeWidth(dp(1));card.setStrokeColor(color(R.color.logoff_border));
            LinearLayout body=column();TextView description=text(CorrectionHistoryPresentation.describe(row),16);description.setTextIsSelectable(true);body.addView(description);card.addView(body);
            LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.bottomMargin=dp(12);results.addView(card,p);
        }
        int next=offset+page.size();
        if(next<rows.size()){
            MaterialButton more=button("Показать ещё · "+next+" из "+rows.size());results.addView(more);
            more.setOnClickListener(v->{if(results==null||current!=generation)return;results.removeView(more);correctionPage(rows,next,current);});
        }
    }
    private void render(Map<String,Object> report){
        if(!Boolean.TRUE.equals(report.get("enabled"))){status.setText("Расчёты недоступны на сервере");return;}
        List<?> rows=list(report.get("rows"));
        status.setText(AppState.string(report.get("warehouseName"))+" · "+from+" — "+to+"\n"+(rows.isEmpty()?"Нет незавершённых расчётов за выбранный период.":"Клиентов: "+rows.size())+"\nОбновлено: "+AppState.string(report.get("calculatedAt")));
        for(Object value:rows){Map<?,?> row=map(value),client=map(row.get("client"));
            MaterialCardView card=new MaterialCardView(requireContext());card.setRadius(dp(14));card.setCardBackgroundColor(color(R.color.logoff_card));card.setStrokeWidth(dp(1));card.setStrokeColor(color(R.color.logoff_border));
            LinearLayout body=column();body.addView(text(AppState.string(client.get("name")),20));
            String[][] fields={{"unbilledRub","Не выставлено"},{"draftRub","Черновики"},{"debtRub","Долг"},{"overdueRub","Просрочено"},{"clientAdvanceRub","Аванс клиента"},{"clientCreditRub","Корректировки в пользу клиента"},{"reviewRub","Требует проверки"}};
            for(String[] field:fields)if(row.containsKey(field[0]))body.addView(text(field[1]+": "+SettlementPresentation.money(row.get(field[0])),16));
            body.addView(text("Неучтённые операции: "+AppState.string(row.get("missingWorkCount")),16));
            MaterialButton details=button("Расшифровка");details.setOnClickListener(v->details(list(row.get("lines"))));body.addView(details);
            card.addView(body);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.bottomMargin=dp(12);results.addView(card,p);
        }
        List<?> issues=list(report.get("issues"));if(!issues.isEmpty()){
            MaterialButton issuesButton=button("Проверки: "+issues.size());issuesButton.setOnClickListener(v->{StringBuilder message=new StringBuilder();for(Object value:issues){Map<?,?> issue=map(value);message.append(AppState.string(issue.get("clientName"))).append("\n").append(AppState.string(issue.get("reason"))).append("\n").append(AppState.string(issue.get("action"))).append("\n\n");}showText("Требует проверки",message.toString());});results.addView(issuesButton);
        }
    }
    private void details(List<?> lines){StringBuilder message=new StringBuilder();for(Object value:lines){Map<?,?> line=map(value);message.append(AppState.string(line.get("date"))).append(" · ").append(AppState.string(line.get("description"))).append("\n").append(SettlementPresentation.money(line.get("totalRub"))).append("\n");for(Object inv:list(line.get("invoices")))message.append("Счёт ").append(AppState.string(map(inv).get("number"))).append("\n");message.append("\n");}showText("Расшифровка сервера",message.length()==0?"Нет строк":message.toString());}
    private void showText(String title,String message){new MaterialAlertDialogBuilder(requireContext()).setTitle(title).setMessage(message).setPositiveButton("Закрыть",null).show();}
    private LinearLayout column(){LinearLayout v=new LinearLayout(requireContext());v.setOrientation(LinearLayout.VERTICAL);v.setPadding(dp(12),dp(10),dp(12),dp(10));return v;}
    private TextView text(String label,int size){TextView t=new TextView(requireContext());t.setText(label);t.setTextSize(size);t.setTextColor(color(R.color.logoff_black));t.setPadding(0,dp(5),0,dp(5));return t;}
    private MaterialButton button(String label){MaterialButton b=new MaterialButton(requireContext());b.setText(label);b.setAllCaps(false);b.setMinHeight(dp(48));return b;}
    private static Map<?,?> map(Object v){return v instanceof Map?(Map<?,?>)v:Collections.emptyMap();}
    private static List<?> list(Object v){return v instanceof List?(List<?>)v:Collections.emptyList();}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private int color(int id){return ContextCompat.getColor(requireContext(),id);}
}
