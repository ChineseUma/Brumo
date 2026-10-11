package com.bruma.chat;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import org.json.JSONObject;
import java.util.LinkedHashSet;

/** Opt-in live connection. A foreground service keeps receiving while the app is minimized. */
public final class NotificationService extends Service {
    static volatile boolean appVisible;
    static volatile String activeRoom = "";
    private ApiClient api;
    private final LinkedHashSet<String> seen = new LinkedHashSet<>();
    private static final String CONNECTION = "bruma_connection";
    private static final String MESSAGES = "bruma_messages";
    private static final int CONNECTION_ID = 1;

    @Override public void onCreate() {
        super.onCreate();
        api = new ApiClient(this);
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CONNECTION,"Conexión para notificaciones",NotificationManager.IMPORTANCE_LOW));
        manager.createNotificationChannel(new NotificationChannel(MESSAGES,"Mensajes y solicitudes",NotificationManager.IMPORTANCE_DEFAULT));
    }

    private PendingIntent open(String room, boolean friends) {
        Intent intent = new Intent(this,MainActivity.class).putExtra("notification_room",room).putExtra("notification_friends",friends)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this,(friends ? "friends" : room).hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if (!getSharedPreferences("bruma_native",MODE_PRIVATE).getBoolean("notifications_enabled",false)
                || (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)) {
            stopSelf(); return START_NOT_STICKY;
        }
        Notification notification = new Notification.Builder(this,CONNECTION).setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("Bruma · notificaciones activas").setContentText("Recibiendo mensajes en segundo plano")
                .setContentIntent(open("",false)).setOngoing(true).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(CONNECTION_ID,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        else startForeground(CONNECTION_ID,notification);
        api.startEvents(new ApiClient.EventListener() {
            @Override public void onConnection(boolean connected) { }
            @Override public void onEvent(String event,Object data) {
                if (!(data instanceof JSONObject)) return;
                JSONObject payload = (JSONObject)data;
                JSONObject message;
                String room = ""; boolean own = false; boolean request = false;
                if ("message-created".equals(event)) { message = payload; own = payload.optBoolean("canEdit"); }
                else if ("private-created".equals(event)) { message = payload.optJSONObject("message"); room = payload.optString("friendUsername"); own = payload.optBoolean("isOwn"); }
                else if ("friend-request".equals(event)) { message = payload; room = "#friends"; request = true; }
                else return; // Never notify history, reconnection snapshots, edits or deletions.
                if (message == null || own) return;
                String id = (request ? "friend:" : "message:") + message.optString("id");
                synchronized (seen) {
                    if (!seen.add(id)) return;
                    if (seen.size() > 1000) seen.remove(seen.iterator().next());
                }
                if (appVisible && !request && activeRoom.equals(room)) return;
                JSONObject from = payload.optJSONObject("from");
                String title = request ? "Solicitud de " + (from == null ? "amistad" : from.optString("displayName"))
                        : (room.isEmpty() ? "Sala del grupo · " : "Mensaje de ") + message.optString("author","Alguien");
                String body = request ? "Toca para ver tus solicitudes de amistad." : message.optString("text");
                if (body.isEmpty()) body = "Ha compartido contenido multimedia.";
                Notification notification = new Notification.Builder(NotificationService.this,MESSAGES)
                        .setSmallIcon(android.R.drawable.stat_notify_chat).setContentTitle(title).setContentText(body)
                        .setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE)
                        .setContentIntent(open(room,request)).build();
                try { getSystemService(NotificationManager.class).notify("bruma:"+room,2,notification); }
                catch (SecurityException ignored) { }
            }
        });
        return START_STICKY;
    }

    @Override public void onDestroy() { api.stopEvents(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
