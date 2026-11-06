package pro.logoff.wms.tsd.auth;

import android.content.SharedPreferences;
import java.io.IOException;
import okhttp3.*;

/** FIX: only physical input changes activity; tokens remain stable for pending scan identity. */
public final class TsdIdleSession {
    public static final long TIMEOUT_MS=15*60_000L;
    public interface Clock { long elapsed(); long wall(); }
    private final SharedPreferences prefs;
    private final Clock clock;
    private final Runnable onExpired;
    private String authorization;
    private long lastInput, lastWall, acknowledgedInput, lastAttempt;
    private boolean locked;

    public TsdIdleSession(SharedPreferences prefs, Clock clock, Runnable onExpired, String authorization) {
        this.prefs=prefs; this.clock=clock; this.onExpired=onExpired; this.authorization=authorization;
        lastInput=prefs.getLong("elapsed",-1); lastWall=prefs.getLong("wall",-1);
        acknowledgedInput=prefs.getLong("acknowledged",-1);
        locked=authorization!=null&&!authorization.equals(prefs.getString("authorization",null));
    }
    public synchronized void login(String authorization) {
        this.authorization=authorization; locked=false;
        lastInput=clock.elapsed();lastWall=clock.wall();acknowledgedInput=lastInput;lastAttempt=0;
        persist();
    }
    public synchronized boolean check() {
        if(authorization==null) return true;
        long elapsed=clock.elapsed()-lastInput, wall=clock.wall()-lastWall;
        // FIX: process restart, screen sleep and clock rollback never create a fresh idle window.
        if(locked||lastInput<0||elapsed<0||wall<0||elapsed>=TIMEOUT_MS||wall>=TIMEOUT_MS){expire();return false;}
        return true;
    }
    public synchronized boolean input() {
        if(!check())return false;
        if(authorization==null)return true;
        lastInput=clock.elapsed();lastWall=clock.wall();persist();return true;
    }
    public synchronized void clear() {authorization=null;locked=false;prefs.edit().clear().commit();}
    private void persist(){prefs.edit().putString("authorization",authorization).putLong("elapsed",lastInput)
        .putLong("wall",lastWall).putLong("acknowledged",acknowledgedInput).apply();}
    private void expire(){boolean notify=!locked;locked=true;if(notify)onExpired.run();}
    public synchronized boolean locked(){return locked;}
    public synchronized boolean activeFor(String header){return header!=null&&header.equals(authorization)&&check();}
    public synchronized void notifyExpired(){locked=false;expire();}

    private static final class ActivityInput {
        final long time; final String auth;
        ActivityInput(long time,String auth){this.time=time;this.auth=auth;}
    }
    public synchronized Request activityRequest(HttpUrl base){
        if(authorization==null||!check()||lastInput<=acknowledgedInput)return null;
        // FIX: an input just before the server deadline must not wait behind the normal throttle.
        if(clock.elapsed()-lastAttempt<60_000&&clock.elapsed()-acknowledgedInput<TIMEOUT_MS-60_000)return null;
        lastAttempt=clock.elapsed();
        return new Request.Builder().url(base.resolve("/api/v1/tsd/session/activity")).header("Authorization",authorization)
            .tag(ActivityInput.class,new ActivityInput(lastInput,authorization))
            .post(RequestBody.create(MediaType.parse("application/json"),"{\"activityAgeMs\":"+(clock.elapsed()-lastInput)+"}")).build();
    }

    public Response intercept(Interceptor.Chain chain)throws IOException {
        Request request=chain.request();String header=request.header("Authorization");
        if(header==null)return chain.proceed(request);
        if(!activeFor(header))return unauthorized(request);
        ActivityInput explicit=request.tag(ActivityInput.class);
        Request activity=explicit==null?activityRequest(request.url()):null;
        if(activity!=null){
            try(Response response=chain.proceed(activity)){
                if(response.code()==401){synchronized(this){if(header.equals(authorization))expire();}return unauthorized(request);}
                if(response.isSuccessful())acknowledge(activity.tag(ActivityInput.class));
            }
        }
        if(!activeFor(header))return unauthorized(request);
        Response result=chain.proceed(request);
        if(result.isSuccessful()&&explicit!=null)acknowledge(explicit);
        if(result.code()==401)synchronized(this){if(header.equals(authorization))expire();}
        return result;
    }
    private synchronized void acknowledge(ActivityInput input){if(input.auth.equals(authorization)){
        acknowledgedInput=Math.max(acknowledgedInput,input.time);persist();
    }}
    private Response unauthorized(Request request){return new Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
        .code(401).message("TSD_SESSION_EXPIRED").body(ResponseBody.create(MediaType.parse("application/json"),
        "{\"message\":\"Войдите снова. Неподтверждённые сканы сохранены.\",\"statusCode\":401}")).build();}
}
