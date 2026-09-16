package pro.logoff.wms.tsd;

import android.app.AlertDialog;
import android.app.Activity;
import android.app.Application;
import android.app.Dialog;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.DialogInterface;
import android.graphics.Canvas;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.TextView;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.lang.ref.WeakReference;
import java.util.*;

/** FIX: localization belongs to display widgets, never to scans, API payloads or monitoring state. */
final class TsdUi {
    private static final Map<TextView,Original> originals=new WeakHashMap<>();
    private static TsdTextCatalog catalog;
    private static boolean drawingRussian;
    private static boolean installed;
    private static WeakReference<Activity> foreground=new WeakReference<>(null);
    private static final List<WeakReference<View>> dialogs=new ArrayList<>();
    static void install(Activity activity) {
        if(!enabled()||installed)return;
        installed=true;
        activity.getApplication().registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
            public void onActivityResumed(Activity current){foreground=new WeakReference<>(current);}
            public void onActivityPaused(Activity current){if(foreground.get()==current)foreground.clear();}
            public void onActivityCreated(Activity a,Bundle b){}
            public void onActivityStarted(Activity a){}
            public void onActivityStopped(Activity a){}
            public void onActivitySaveInstanceState(Activity a,Bundle b){}
            public void onActivityDestroyed(Activity a){}
        });
    }
    static void track(Dialog dialog) {
        if(!enabled()||dialog.getWindow()==null)return;
        View root=dialog.getWindow().getDecorView();
        dialogs.add(new WeakReference<>(root));
    }
    private static Activity activity(Context context){
        while(context instanceof ContextWrapper){if(context instanceof Activity)return (Activity)context;context=((ContextWrapper)context).getBaseContext();}
        return null;
    }
    static List<View> monitorWindows(Activity fallback) {
        Activity current=enabled()?foreground.get():fallback;
        if(current==null||current.isFinishing()||current.isDestroyed())current=fallback;
        List<View> windows=new ArrayList<>();windows.add(current.getWindow().getDecorView().getRootView());
        if(enabled())for(Iterator<WeakReference<View>> it=dialogs.iterator();it.hasNext();) {
            View view=it.next().get();
            if(view==null){it.remove();continue;}
            if(view.isAttachedToWindow()&&view.getVisibility()==View.VISIBLE&&activity(view.getContext())==current)windows.add(view);
        }
        return windows;
    }
    static void drawWindows(List<View> windows,Canvas canvas) {
        int[] base=new int[2];windows.get(0).getLocationOnScreen(base);
        for(int i=0;i<windows.size();i++) {
            View view=windows.get(i);int[] position=new int[2];view.getLocationOnScreen(position);
            if(i>0)canvas.drawColor(0x66000000);
            int save=canvas.save();canvas.translate(position[0]-base[0],position[1]-base[1]);view.draw(canvas);canvas.restoreToCount(save);
        }
    }
    static boolean enabled(){return TsdLanguage.enabled(BuildConfig.FLAVOR);}
    static String language(Context context){return TsdLanguage.normalize(context.getSharedPreferences("tsd_ui_preferences",Context.MODE_PRIVATE).getString("language","ru"));}
    static void select(Context context,String code){context.getSharedPreferences("tsd_ui_preferences",Context.MODE_PRIVATE).edit().putString("language",TsdLanguage.normalize(code)).apply();}
    static String text(Context context,CharSequence raw) {
        if(raw==null)return "";
        if(!enabled()||drawingRussian)return raw.toString();
        synchronized(TsdUi.class) {
            if(catalog==null)try {
                catalog=TsdTextCatalog.load(new InputStreamReader(context.getAssets().open("tsd-translations.tsv"),StandardCharsets.UTF_8),new InputStreamReader(context.getAssets().open("tsd-templates.tsv"),StandardCharsets.UTF_8));
            }catch(IOException error){throw new IllegalStateException("TSD translations are missing",error);}
        }
        return catalog.text(raw.toString(),language(context));
    }
    private static CharSequence display(TextView view,CharSequence raw) {
        if(!enabled()||drawingRussian)return raw;
        Original record=originals.computeIfAbsent(view,v->new Original());record.text=raw==null?"":raw.toString();
        return text(view.getContext(),raw);
    }
    static void hint(EditText view,CharSequence canonical) {
        if(enabled())originals.computeIfAbsent(view,v->new Original()).hint=canonical==null?"":canonical.toString();
        view.setHint(text(view.getContext(),canonical));
    }
    static void label(TextView view,CharSequence canonical){view.setText(display(view,canonical));}
    static void data(TextView view,CharSequence value) {
        // FIX: product names, codes and operator-entered text are never UI translation inputs.
        boolean previous=drawingRussian;drawingRussian=true;
        try{originals.remove(view);view.setText(value);}finally{drawingRussian=previous;}
    }
    static final class Label extends TextView {
        Label(Context context){super(context);}
        @Override public void setText(CharSequence value,BufferType type){super.setText(display(this,value),type);}
    }
    static final class Button extends android.widget.Button {
        Button(Context context){super(context);}
        @Override public void setText(CharSequence value,BufferType type){super.setText(display(this,value),type);}
    }
    static final class CheckBox extends android.widget.CheckBox {
        CheckBox(Context context){super(context);}
        @Override public void setText(CharSequence value,BufferType type){super.setText(display(this,value),type);}
    }
    static final class StringAdapter extends android.widget.ArrayAdapter<String> {
        StringAdapter(Context context,int layout,String[] values){super(context,layout,values);}
        StringAdapter(Context context,int layout,List<String> values){super(context,layout,values);}
        private View translated(View view,int position) {
            if(view instanceof TextView){TextView label=(TextView)view;label.setText(display(label,getItem(position)));}
            return view;
        }
        @Override public View getView(int position,View view,ViewGroup parent){return translated(super.getView(position,view,parent),position);}
        @Override public View getDropDownView(int position,View view,ViewGroup parent){return translated(super.getDropDownView(position,view,parent),position);}
    }
    static final class DialogBuilder extends AlertDialog.Builder {
        private String title,message,positive,negative,neutral;
        DialogBuilder(Context context){super(context);}
        @Override public AlertDialog.Builder setTitle(CharSequence value){title=value==null?"":value.toString();return super.setTitle(text(getContext(),value));}
        @Override public AlertDialog.Builder setMessage(CharSequence value){message=value==null?"":value.toString();return super.setMessage(text(getContext(),value));}
        @Override public AlertDialog.Builder setPositiveButton(CharSequence value,DialogInterface.OnClickListener action){positive=value==null?"":value.toString();return super.setPositiveButton(text(getContext(),value),action);}
        @Override public AlertDialog.Builder setNegativeButton(CharSequence value,DialogInterface.OnClickListener action){negative=value==null?"":value.toString();return super.setNegativeButton(text(getContext(),value),action);}
        @Override public AlertDialog.Builder setNeutralButton(CharSequence value,DialogInterface.OnClickListener action){neutral=value==null?"":value.toString();return super.setNeutralButton(text(getContext(),value),action);}
        @Override public AlertDialog.Builder setItems(CharSequence[] values,DialogInterface.OnClickListener action){
            String[] strings=new String[values.length];for(int i=0;i<values.length;i++)strings[i]=String.valueOf(values[i]);
            return super.setAdapter(new StringAdapter(getContext(),android.R.layout.simple_list_item_1,strings),action);
        }
        @Override public AlertDialog create() {
            AlertDialog dialog=super.create();
            track(dialog);
            if(enabled())dialog.getWindow().getDecorView().addOnAttachStateChangeListener(new View.OnAttachStateChangeListener(){
                public void onViewAttachedToWindow(View view){
                    remember(dialog.findViewById(android.R.id.message),message);
                    int id=getContext().getResources().getIdentifier("alertTitle","id","android");remember(dialog.findViewById(id),title);
                    remember(dialog.getButton(DialogInterface.BUTTON_POSITIVE),positive);remember(dialog.getButton(DialogInterface.BUTTON_NEGATIVE),negative);remember(dialog.getButton(DialogInterface.BUTTON_NEUTRAL),neutral);
                }
                public void onViewDetachedFromWindow(View view){}
            });
            return dialog;
        }
    }
    private static void remember(TextView view,String raw){if(view!=null&&raw!=null)originals.computeIfAbsent(view,v->new Original()).text=raw;}
    static <T> T russianSnapshot(View root,TsdSnapshotTransaction.Capture<T> draw) throws Exception {
        return russianSnapshot(Collections.singletonList(root),draw);
    }
    static <T> T russianSnapshot(List<View> roots,TsdSnapshotTransaction.Capture<T> draw) throws Exception {
        if(!enabled())return draw.draw();
        List<TsdSnapshotTransaction.ViewState> states=new ArrayList<>();List<ScrollPosition> scrolls=new ArrayList<>();for(View root:roots)collect(root,states,scrolls);
        boolean previous=drawingRussian;drawingRussian=true;
        try{return TsdSnapshotTransaction.capture(states,()->{for(View root:roots)layout(root);for(ScrollPosition p:scrolls)p.restore();return draw.draw();});}
        finally{drawingRussian=previous;for(View root:roots)layout(root);for(ScrollPosition p:scrolls)p.restore();}
    }
    private static void collect(View view,List<TsdSnapshotTransaction.ViewState> states,List<ScrollPosition> scrolls) {
        scrolls.add(new ScrollPosition(view));
        if(view instanceof TextView) {
            TextView label=(TextView)view;Original raw=originals.get(label);
            if(raw!=null) {
                CharSequence visible=label.getText(),hint=label.getHint();boolean editable=label instanceof EditText;
                states.add(new TsdSnapshotTransaction.ViewState(){
                    public void showRussian(){if(!editable&&raw.text!=null)label.setText(raw.text);if(raw.hint!=null)label.setHint(raw.hint);}
                    public void restore(){if(!editable&&raw.text!=null)label.setText(visible);if(raw.hint!=null)label.setHint(hint);}
                });
            }
        }
        if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)collect(group.getChildAt(i),states,scrolls);}
    }
    private static void layout(View root){int w=root.getWidth(),h=root.getHeight();if(w>0&&h>0){root.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY));root.layout(root.getLeft(),root.getTop(),root.getLeft()+w,root.getTop()+h);}}
    private static final class Original {String text,hint;}
    private static final class ScrollPosition {final View view;final int x,y;ScrollPosition(View view){this.view=view;x=view.getScrollX();y=view.getScrollY();}void restore(){view.scrollTo(x,y);}}
    private TsdUi(){}
}
