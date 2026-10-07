package pro.logoff.wms.mobile.ui;

import android.os.Bundle;
import android.view.*;
import android.widget.*;
import androidx.fragment.app.Fragment;
import androidx.core.content.ContextCompat;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import pro.logoff.wms.mobile.*;
import java.util.List;

// FIX: native grouped Soul home; no embedded website and no invented API destinations.
public class SoulHomeFragment extends Fragment {
    private int expanded=-1;
    private LinearLayout groups;
    @Override public View onCreateView(LayoutInflater inflater, ViewGroup parent, Bundle saved) {
        if(saved!=null) expanded=saved.getInt("group",-1);
        ScrollView scroll=new ScrollView(requireContext());
        groups=new LinearLayout(requireContext()); groups.setOrientation(LinearLayout.VERTICAL);
        groups.setPadding(dp(12),dp(12),dp(12),dp(20)); scroll.addView(groups);
        render(); return scroll;
    }
    @Override public void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); state.putInt("group",expanded); }
    @Override public void onDestroyView() { groups=null; super.onDestroyView(); }
    private void render() {
        groups.removeAllViews();
        TextView brand=new TextView(requireContext());
        android.text.SpannableString text=new android.text.SpannableString("WMS LOGOff");
        text.setSpan(new android.text.style.UnderlineSpan(),4,text.length(),0);
        brand.setText(text); brand.setTextSize(28); brand.setTypeface(android.graphics.Typeface.SERIF,android.graphics.Typeface.BOLD);
        brand.setTextColor(color(R.color.logoff_red)); brand.setPadding(dp(8),dp(8),dp(8),dp(18)); groups.addView(brand);
        if(expanded>=0) groups.addView(button("Все разделы",()->{expanded=-1;render();}));
        LogoffApplication app=(LogoffApplication)requireActivity().getApplication();
        List<SoulMenu.Item> items=SoulMenu.items(app.state().isAdmin(),app.state()::can);
        int[] accents={R.color.logoff_blue,R.color.logoff_warning,R.color.logoff_success,R.color.logoff_red,R.color.logoff_blue,R.color.logoff_success,R.color.logoff_warning};
        for(int group=0;group<SoulMenu.GROUPS.length;group++) {
            final int index=group;
            if(items.stream().noneMatch(i->i.group==index)) continue;
            MaterialCardView card=new MaterialCardView(requireContext());
            card.setCardBackgroundColor(color(R.color.logoff_card)); card.setRadius(dp(16));
            card.setStrokeWidth(dp(1));card.setStrokeColor(color(accents[group]));
            LinearLayout body=new LinearLayout(requireContext());body.setOrientation(LinearLayout.VERTICAL);body.setPadding(dp(10),dp(6),dp(10),dp(8));
            MaterialButton heading=button(SoulMenu.GROUPS[group]+(expanded==group?"  ▾":"  ›"),()->{expanded=expanded==index?-1:index;render();});
            heading.setTextColor(color(accents[group]));body.addView(heading);
            if(expanded<0 || expanded==group) for(SoulMenu.Item item:items) if(item.group==group) body.addView(button(item.title+"  ↗",()->open(item)));
            card.addView(body); LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.bottomMargin=dp(12);groups.addView(card,p);
        }
    }
    private void open(SoulMenu.Item item) {
        Fragment page;
        switch(item.id) {
            case "overview": page=new DashboardFragment();break;
            case "requests": page=ListFragment.newInstance(ListFragment.REQUESTS);break;
            case "receipts": page=ListFragment.newInstance(ListFragment.RECEIPTS);break;
            case "invoices": page=ListFragment.newInstance(ListFragment.INVOICES);break;
            case "notifications": page=ListFragment.newInstance(ListFragment.NOTIFICATIONS);break;
            case "fbs":page=FbsFragment.newInstance();break;
            case "expenses":page=ExpensesFragment.newInstance();break;
            case "settings":page=new MoreFragment();break;
            case "settlements":page=new SettlementsFragment();break;
            case "ai":page=new OpenClawFragment();break;
            default:page=NativeModuleFragment.newInstance(item.id,item.title);
        }
        expanded=item.group;
        ((MainActivity)requireActivity()).showNative(page,item.title);
    }
    private MaterialButton button(String label,Runnable action) {
        MaterialButton b=new MaterialButton(requireContext(),null,com.google.android.material.R.attr.materialButtonOutlinedStyle);
        b.setText(label);b.setAllCaps(false);b.setTextSize(16);b.setMinHeight(dp(48));
        b.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);b.setTextColor(color(R.color.logoff_black));
        b.setOnClickListener(v->action.run());return b;
    }
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private int color(int id){return ContextCompat.getColor(requireContext(),id);}
}
