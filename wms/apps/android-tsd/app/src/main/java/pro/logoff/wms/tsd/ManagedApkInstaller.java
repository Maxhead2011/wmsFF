package pro.logoff.wms.tsd;

import android.content.*;
import android.content.pm.*;
import android.os.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import com.unitech.appctrlapi.aidl.*;

/** FIX: only verified self-updates use the preinstalled manufacturer's installer. */
final class ManagedApkInstaller {
    static String route(String manufacturer) {
        if ("urovo".equalsIgnoreCase(manufacturer)) return "urovo";
        if ("unitech".equalsIgnoreCase(manufacturer)) return "unitech";
        return "standard";
    }
    static boolean unitechSucceeded(int result) { return result == 0; }
    static boolean sameSigners(Signature[] current, Signature[] candidate) {
        if(current==null || candidate==null || current.length==0 || current.length!=candidate.length)return false;
        return new HashSet<>(Arrays.asList(current)).equals(new HashSet<>(Arrays.asList(candidate)));
    }
    @SuppressWarnings("deprecation")
    static void validate(Context context, File apk) throws Exception {
        PackageManager pm=context.getPackageManager();
        PackageInfo current=pm.getPackageInfo(context.getPackageName(),PackageManager.GET_SIGNATURES);
        PackageInfo candidate=pm.getPackageArchiveInfo(apk.getAbsolutePath(),PackageManager.GET_SIGNATURES);
        if(candidate==null || !context.getPackageName().equals(candidate.packageName)
            || candidate.versionCode<current.versionCode || !sameSigners(current.signatures,candidate.signatures))
            throw new SecurityException("Неверный пакет, версия или подпись обновления ТСД");
    }
    static boolean tryInstall(MainActivity activity, File apk) throws Exception {
        String route=route(Build.MANUFACTURER);
        if("standard".equals(route))return false;
        validate(activity,apk);
        Job job=new Job(activity,apk);
        if("urovo".equals(route))job.urovo();else job.unitech();
        return true;
    }
    private static final class Job {
        final MainActivity activity;final Context context;final File apk;
        final Handler main=new Handler(Looper.getMainLooper());
        final ExecutorService worker=Executors.newSingleThreadExecutor();
        final AtomicBoolean finished=new AtomicBoolean();
        boolean bound;
        final Runnable timeout=()->finish("Установка не подтверждена устройством за 90 секунд. Повторная отправка не выполнена.",true);
        final ServiceConnection connection=new ServiceConnection(){
            public void onServiceConnected(ComponentName name,IBinder binder){
                worker.execute(()->{
                    try(ParcelFileDescriptor fd=ParcelFileDescriptor.open(apk,ParcelFileDescriptor.MODE_READ_ONLY)){
                        if(finished.get())return;
                        IAppCtrlAidl api=IAppCtrlAidl.Stub.asInterface(binder);
                        String path=api.streamApk(fd,context.getPackageName());
                        if(path==null || path.isEmpty())throw new IOException("Unitech не подтвердил получение APK");
                        if(finished.get())return;
                        api.installApp(path,context.getPackageName(),new IAppCtrlAidlCallback.Stub(){
                            public void installAppCallback(String packageName,int result){
                                finish(unitechSucceeded(result)?"Обновление установлено.":"Unitech отклонил установку: "+result,!unitechSucceeded(result));
                            }
                        });
                    }catch(Exception error){finish("Ошибка установщика Unitech: "+error.getMessage(),true);}
                });
            }
            public void onServiceDisconnected(ComponentName name){/* Package replacement may disconnect the installer. */}
            public void onNullBinding(ComponentName name){finish("Сервис Unitech недоступен.",true);}
            public void onBindingDied(ComponentName name){finish("Соединение с установщиком Unitech прервано.",true);}
        };
        Job(MainActivity activity,File apk){this.activity=activity;this.context=activity.getApplicationContext();this.apk=apk;}
        void begin(){activity.managedUpdateStatus("Устанавливается обновление через сервис производителя…",false);main.postDelayed(timeout,90000);}
        void urovo(){
            begin();worker.execute(()->{
                try{
                    File directory=context.getExternalFilesDir(null);
                    if(directory==null)throw new IOException("Нет каталога для установщика Urovo");
                    File shared=new File(directory,"verified-tsd-update.apk");
                    try(InputStream in=new FileInputStream(apk);OutputStream out=new FileOutputStream(shared)){
                        byte[] bytes=new byte[32768];int n;while((n=in.read(bytes))!=-1)out.write(bytes,0,n);
                    }
                    validate(context,shared);
                    if(finished.get())return;
                    Class<?> type=Class.forName("android.device.DeviceManager");
                    Object accepted=type.getMethod("installApplication",String.class).invoke(type.getConstructor().newInstance(),shared.getAbsolutePath());
                    if(!Boolean.TRUE.equals(accepted))finish("Urovo не принял обновление. Установка не повторяется автоматически.",true);
                }catch(Exception error){finish("Ошибка установщика Urovo: "+error.getMessage(),true);}
            });
        }
        void unitech()throws Exception{
            ApplicationInfo info=context.getPackageManager().getApplicationInfo("com.unitech.appctrlservice",0);
            if((info.flags&ApplicationInfo.FLAG_SYSTEM)==0)throw new SecurityException("Установщик Unitech не является системным");
            Intent intent=new Intent("com.unitech.appctrlapi.aidl").setComponent(new ComponentName("com.unitech.appctrlservice","com.unitech.appctrlservice.AppCtrlService"));
            begin();bound=context.bindService(intent,connection,Context.BIND_AUTO_CREATE);
            if(!bound)finish("Не удалось подключиться к установщику Unitech.",true);
        }
        void finish(String text,boolean error){
            if(!finished.compareAndSet(false,true))return;
            main.post(()->{main.removeCallbacks(timeout);if(bound){context.unbindService(connection);bound=false;}activity.managedUpdateStatus(text,error);worker.shutdown();});
        }
    }
}
