package com.bruma.chat;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.ColorSpace;
import android.graphics.ImageDecoder;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.AnimatedImageDrawable;
import android.graphics.drawable.Animatable;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.LruCache;
import android.view.Gravity;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int BG = Color.rgb(20, 20, 20);
    private static final int PANEL = Color.rgb(29, 29, 29);
    private static final int CARD = Color.rgb(43, 39, 39);
    private static final int BUTTON = Color.rgb(59, 24, 24);
    private static final int DEEP_RED = Color.rgb(91, 0, 0);
    private static final int ACCENT = Color.rgb(184, 52, 52);
    private static final int TEXT = Color.rgb(244, 239, 239);
    private static final int MUTED = Color.rgb(183, 165, 165);
    private static final int GREEN = Color.rgb(85, 201, 161);
    private static final int RED = Color.rgb(240, 125, 137);
    private static final int IMAGE_PICK = 101;
    private static final int AVATAR_PICK = 102;
    private static final int AUDIO_PERMISSION = 103;
    private static final int AUDIO_PICK = 104;
    private static final int FILE_PICK = 105;
    private static final int NOTIFICATION_PERMISSION = 106;
    private static final int BANNER_PICK = 107;
    private String profileDraftOwner = "";
    private String profileDraftName = "", profileDraftUsername = "", profileDraftBio = "", profileDraftBanner = "";
    private Intent pendingNotification;
    private static final int MESSAGE_PAGE_SIZE = 40;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService textIo = Executors.newSingleThreadExecutor();
    private final ExecutorService readIo = Executors.newFixedThreadPool(3);
    private final ExecutorService mediaIo = Executors.newFixedThreadPool(2);
    private final ExecutorService preparationIo = Executors.newSingleThreadExecutor();
    private final ArrayList<PendingFile> pendingImages = new ArrayList<>();
    private int preparingImages;
    private volatile int attachmentGeneration;
    private final LruCache<String, Bitmap> imageCache = new LruCache<String, Bitmap>(4 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Bitmap bitmap) { return bitmap.getByteCount(); }
    };
    private final ArrayList<PendingFile> pendingFiles = new ArrayList<>();
    private final ArrayList<ImageView> displayedImages = new ArrayList<>();
    private final ArrayList<PendingMedia> deferredMedia = new ArrayList<>();
    private final HashMap<String, JSONArray> roomCache = new HashMap<>();
    private final LruCache<String, Bitmap> avatarCache = new LruCache<String, Bitmap>(4 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Bitmap value) { return value.getByteCount(); }
    };
    private final SimpleDateFormat clockFormat = new SimpleDateFormat("HH:mm", Locale.getDefault());
    private static final class PendingMedia {
        final ImageView view;
        final String address;
        final boolean avatar;
        PendingMedia(ImageView view, String address, boolean avatar) {
            this.view = view;
            this.address = address;
            this.avatar = avatar;
        }
    }
    private static final class PendingFile {
        final Uri uri;
        final String name;
        final String type;
        final long size;
        File preparedFile;
        PendingFile(Uri uri, String name, String type, long size) {
            this.uri = uri; this.name = name; this.type = type; this.size = size;
        }
    }
    private ApiClient api;
    private FrameLayout root;
    private FrameLayout overlay;
    private LinearLayout drawerContent;
    private ScrollView messageScroll;
    private LinearLayout messageList;
    private TextView roomTitle;
    private TextView connectionLabel;
    private TextView replyLabel;
    private TextView attachmentLabel;
    private TextView recordButton;
    private EditText input;
    private JSONObject account;
    private JSONObject friends = new JSONObject();
    private JSONArray messages = new JSONArray();
    private boolean loadingMessages = true;
    private int visibleMessageLimit = MESSAGE_PAGE_SIZE;
    private long renderedFingerprint = Long.MIN_VALUE;
    private int refreshGeneration;
    private int roomGeneration;
    private int eventGeneration;
    private String activeFriend = "";
    private String activeFriendName = "";
    private String replyToId = "";
    private String selectedGifUrl = "";
    private String pendingAudioData = "";
    private String giphyApiKey = "";
    private int gifSearchGeneration;
    private String guestName;
    private boolean connected;
    private boolean foreground;
    private final HashMap<String, PendingSend> outbox = new HashMap<>();
    private static final class PendingSend {
        final String room;
        final String identity;
        final JSONObject body;
        final JSONObject preview;
        final ArrayList<PendingFile> files;
        final JSONArray uploaded = new JSONArray();
        boolean running;
        boolean started;
        boolean cancelled;
        PendingSend(String room, String identity, JSONObject body, JSONObject preview, ArrayList<PendingFile> files) {
            this.room = room; this.identity = identity; this.body = body; this.preview = preview; this.files = files;
        }
    }
    private MediaPlayer player;
    private TextView activeAudioButton;
    private File activeAudioFile;
    private String activeAudioKey = "";
    private int audioGeneration;
    private MediaRecorder recorder;
    private File recordingFile;
    private boolean preparingAudio;
    private long recordingStartedAt;
    private final Runnable recordingClock = new Runnable() {
        @Override public void run() {
            if (recorder == null || recordButton == null) return;
            long seconds = (SystemClock.elapsedRealtime() - recordingStartedAt) / 1000;
            recordButton.setText(String.format(Locale.getDefault(), "■ %02d:%02d", seconds / 60, seconds % 60));
            if (seconds >= 60) stopRecording();
            else main.postDelayed(this, 500);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        api = new ApiClient(this);
        guestName = getPreferences(MODE_PRIVATE).getString("guest_name", "");
        if (guestName.isEmpty()) {
            guestName = "Invitado-" + UUID.randomUUID().toString().substring(0, 4);
            getPreferences(MODE_PRIVATE).edit().putString("guest_name", guestName).apply();
        }
        buildScreen();
        if (getIntent().hasExtra("notification_room")) pendingNotification = getIntent();
        refreshAll();
    }

    @Override public void onDestroy() {
        ++refreshGeneration;
        ++roomGeneration;
        ++eventGeneration;
        api.stopEvents();
        main.removeCallbacks(recordingClock);
        if (recorder != null) { recorder.release(); recorder = null; }
        if (recordingFile != null) recordingFile.delete();
        audioGeneration++;
        stopAudioPlayback();
        stopImageAnimations();
        io.shutdownNow();
        textIo.shutdownNow();
        readIo.shutdownNow();
        mediaIo.shutdownNow();
        preparationIo.shutdownNow();
        clearPendingImages();
        for (PendingSend send : outbox.values()) synchronized (send) {
            send.cancelled = true;
            if (!send.started) releasePreparedFiles(send);
        }
        super.onDestroy();
    }

    @Override protected void onStart() {
        super.onStart();
        foreground = true;
        NotificationService.appVisible = true;
        requestNotificationsOnFirstLaunch();
        startNotificationService();
        if (messageScroll != null) messageScroll.post(this::loadVisibleMedia);
    }

    @Override protected void onStop() {
        foreground = false;
        NotificationService.appVisible = false;
        stopImageAnimations();
        if (recorder != null) stopRecording();
        super.onStop();
    }

    private int d(float amount) { return Math.round(amount * getResources().getDisplayMetrics().density); }

    private GradientDrawable background(int color, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(d(radius));
        return shape;
    }

    private void styleDialog(AlertDialog dialog) {
        dialog.setOnShowListener(ignored -> {
            if (dialog.getWindow() != null) {
                dialog.getWindow().setBackgroundDrawable(background(CARD, 18));
            }
        });
    }

    private void showImageViewer(Drawable drawable) {
        if (drawable == null) return;
        Dialog dialog = new Dialog(this);
        FrameLayout frame = new FrameLayout(this);
        frame.setPadding(d(12), d(12), d(12), d(12));
        frame.setBackgroundColor(0xEE101010);

        ImageView image = new ImageView(this);
        image.setAdjustViewBounds(true);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setImageDrawable(drawable);
        frame.addView(image, new FrameLayout.LayoutParams(-1, -1));

        TextView close = label("×", 30, TEXT, true);
        close.setGravity(Gravity.CENTER);
        close.setBackground(background(0xCC5B0000, 22));
        close.setOnClickListener(v -> dialog.dismiss());
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(d(48), d(48), Gravity.TOP | Gravity.END);
        closeParams.setMargins(0, d(8), d(8), 0);
        frame.addView(close, closeParams);

        final float[] zoom = {1f};
        final float[] lastTouch = {0f, 0f};
        ScaleGestureDetector scaleDetector = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScale(ScaleGestureDetector detector) {
                float oldZoom = zoom[0];
                zoom[0] = Math.max(1f, Math.min(5f, zoom[0] * detector.getScaleFactor()));
                float factor = zoom[0] / oldZoom;
                float focusX = detector.getFocusX();
                float focusY = detector.getFocusY();
                image.setTranslationX(clampTranslation(image.getTranslationX() * factor + focusX * (1f - factor), image.getWidth(), zoom[0]));
                image.setTranslationY(clampTranslation(image.getTranslationY() * factor + focusY * (1f - factor), image.getHeight(), zoom[0]));
                image.setScaleX(zoom[0]);
                image.setScaleY(zoom[0]);
                return true;
            }
        });
        GestureDetector gestureDetector = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDoubleTap(MotionEvent event) {
                zoom[0] = zoom[0] > 1.1f ? 1f : 2.5f;
                image.setTranslationX(0f);
                image.setTranslationY(0f);
                image.setScaleX(zoom[0]);
                image.setScaleY(zoom[0]);
                return true;
            }
        });
        image.setOnTouchListener((view, event) -> {
            gestureDetector.onTouchEvent(event);
            scaleDetector.onTouchEvent(event);
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                lastTouch[0] = event.getX();
                lastTouch[1] = event.getY();
            } else if (event.getActionMasked() == MotionEvent.ACTION_MOVE
                    && event.getPointerCount() == 1 && !scaleDetector.isInProgress() && zoom[0] > 1.01f) {
                float deltaX = event.getX() - lastTouch[0];
                float deltaY = event.getY() - lastTouch[1];
                image.setTranslationX(clampTranslation(image.getTranslationX() + deltaX, image.getWidth(), zoom[0]));
                image.setTranslationY(clampTranslation(image.getTranslationY() + deltaY, image.getHeight(), zoom[0]));
                lastTouch[0] = event.getX();
                lastTouch[1] = event.getY();
            }
            return true;
        });
        if (drawable instanceof Animatable) ((Animatable) drawable).start();
        dialog.setOnDismissListener(ignored -> { if (drawable instanceof Animatable) ((Animatable) drawable).stop(); });

        dialog.setContentView(frame);
        dialog.setOnShowListener(ignored -> {
            if (dialog.getWindow() != null) {
                dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
                dialog.getWindow().setLayout(-1, -1);
            }
        });
        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
            dialog.getWindow().setLayout(-1, -1);
        }
    }

    private Drawable resultDrawable(Bitmap bitmap) {
        return new BitmapDrawable(getResources(), bitmap);
    }

    private float clampTranslation(float value, int size, float scale) {
        float limit = Math.max(0f, size * (scale - 1f) / 2f);
        return Math.max(-limit, Math.min(limit, value));
    }

    private LinearLayout column() {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL);
        return view;
    }

    private LinearLayout row() {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.HORIZONTAL);
        view.setGravity(Gravity.CENTER_VERTICAL);
        return view;
    }

    private TextView label(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER_VERTICAL);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private TextView action(String title, Runnable click) {
        TextView view = label(title, 15, TEXT, true);
        view.setGravity(Gravity.CENTER);
        view.setPadding(d(13), d(10), d(13), d(10));
        view.setBackground(background(BUTTON, 12));
        view.setOnClickListener(v -> click.run());
        return view;
    }

    private void buildScreen() {
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.statusBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets navigation = insets.getInsets(WindowInsets.Type.navigationBars());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(Math.max(bars.left, navigation.left), bars.top,
                        Math.max(bars.right, navigation.right), Math.max(navigation.bottom, keyboard.bottom));
                return insets;
            });
            root.requestApplyInsets();
        }
        LinearLayout screen = column();
        root.addView(screen, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout header = row();
        header.setPadding(d(12), d(10), d(12), d(10));
        header.setBackgroundColor(PANEL);
        screen.addView(header, new LinearLayout.LayoutParams(-1, d(68)));
        TextView menu = action("☰", () -> showDrawer(false));
        header.addView(menu, new LinearLayout.LayoutParams(d(48), d(48)));
        LinearLayout titles = column();
        titles.setPadding(d(12), 0, d(5), 0);
        header.addView(titles, new LinearLayout.LayoutParams(0, -2, 1));
        roomTitle = label("Sala del grupo", 18, TEXT, true);
        titles.addView(roomTitle);
        connectionLabel = label("Conectando…", 12, MUTED, false);
        titles.addView(connectionLabel);
        TextView info = action("ⓘ", () -> showDrawer(true));
        header.addView(info, new LinearLayout.LayoutParams(d(48), d(48)));
        View headerRule = new View(this);
        headerRule.setBackgroundColor(DEEP_RED);
        screen.addView(headerRule, new LinearLayout.LayoutParams(-1, d(2)));

        messageScroll = new ScrollView(this);
        messageScroll.setFillViewport(true);
        messageScroll.setClipToPadding(false);
        messageScroll.setPadding(d(12), d(12), d(12), d(12));
        messageScroll.setOnScrollChangeListener((view, left, top, oldLeft, oldTop) -> loadVisibleMedia());
        screen.addView(messageScroll, new LinearLayout.LayoutParams(-1, 0, 1));
        messageList = column();
        messageList.setGravity(Gravity.BOTTOM);
        messageScroll.addView(messageList, new ScrollView.LayoutParams(-1, -2));

        LinearLayout composer = column();
        composer.setPadding(d(12), d(8), d(12), d(10));
        composer.setBackgroundColor(DEEP_RED);
        screen.addView(composer, new LinearLayout.LayoutParams(-1, -2));
        replyLabel = label("", 13, ACCENT, true);
        replyLabel.setVisibility(View.GONE);
        replyLabel.setPadding(d(6), d(5), d(6), d(8));
        replyLabel.setTextColor(Color.rgb(211, 104, 104));
        replyLabel.setBackground(background(0x66300000, 10));
        replyLabel.setOnClickListener(v -> { replyToId = ""; updateComposerHints(); });
        composer.addView(replyLabel);
        attachmentLabel = label("", 12, MUTED, false);
        attachmentLabel.setVisibility(View.GONE);
        attachmentLabel.setPadding(d(6), d(3), d(6), d(7));
        attachmentLabel.setOnClickListener(v -> {
            clearPendingImages();
            pendingFiles.clear();
            pendingAudioData = "";
            selectedGifUrl = "";
            updateComposerHints();
        });
        composer.addView(attachmentLabel);
        LinearLayout tools = row();
        LinearLayout.LayoutParams toolsParams = new LinearLayout.LayoutParams(-1, -2);
        toolsParams.bottomMargin = d(7);
        composer.addView(tools, toolsParams);
        TextView attach = action("＋", this::showAttachmentMenu);
        tools.addView(attach, new LinearLayout.LayoutParams(-2, d(39)));
        TextView gif = action("GIF", this::showGifPicker);
        LinearLayout.LayoutParams gifParams = new LinearLayout.LayoutParams(-2, d(39));
        gifParams.leftMargin = d(8);
        tools.addView(gif, gifParams);
        recordButton = action("● Voz", this::toggleRecording);
        LinearLayout.LayoutParams voiceParams = new LinearLayout.LayoutParams(-2, d(39));
        voiceParams.leftMargin = d(8);
        tools.addView(recordButton, voiceParams);
        LinearLayout composeRow = row();
        composer.addView(composeRow);
        input = new EditText(this);
        input.setSingleLine(false);
        input.setMaxLines(4);
        input.setFilters(new android.text.InputFilter[] { new android.text.InputFilter.LengthFilter(500) });
        input.setTextSize(15);
        input.setTextColor(TEXT);
        input.setHintTextColor(MUTED);
        input.setHint("Escribe un mensaje…");
        input.setBackground(background(BG, 12));
        input.setPadding(d(12), d(9), d(12), d(9));
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(0, -2, 1);
        inputParams.setMargins(0, 0, d(8), 0);
        composeRow.addView(input, inputParams);
        TextView send = action("➤", this::sendMessage);
        send.setTextColor(TEXT);
        send.setBackground(background(ACCENT, 14));
        composeRow.addView(send, new LinearLayout.LayoutParams(d(48), d(48)));

        overlay = new FrameLayout(this);
        overlay.setVisibility(View.GONE);
        root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));
        View dim = new View(this);
        dim.setBackgroundColor(0xBB000000);
        dim.setOnClickListener(v -> hideDrawer());
        overlay.addView(dim, new FrameLayout.LayoutParams(-1, -1));
        renderMessages();
    }

    private void setConnection(boolean value) {
        connected = value;
        connectionLabel.setText(value ? "● En línea" : "● Sin conexión");
        connectionLabel.setTextColor(value ? GREEN : RED);
    }

    private void error(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private interface Work { void run() throws Exception; }

    private void run(Work work) {
        io.execute(() -> {
            try { work.run(); }
            catch (Exception failure) { main.post(() -> error(failure.getMessage() == null ? "No se pudo conectar." : failure.getMessage())); }
        });
    }

    private void refreshAll() {
        int generation = ++refreshGeneration;
        int roomRequest = ++roomGeneration;
        JSONArray previous = roomCache.get("");
        ++eventGeneration;
        api.stopEvents();
        connectionLabel.setText("● Conectando…");
        connectionLabel.setTextColor(MUTED);
        activeFriend = "";
        NotificationService.activeRoom = "";
        activeFriendName = "";
        roomTitle.setText("Sala del grupo");
        showRoomMessages("", roomCache.get(""));
        io.execute(() -> {
            try {
                JSONObject me = (JSONObject) api.request("GET", "/api/auth/me", null);
                Object raw = me.opt("account");
                JSONObject freshAccount = raw instanceof JSONObject ? (JSONObject) raw : null;
                main.post(() -> {
                    if (generation != refreshGeneration || isFinishing() || isDestroyed()) return;
                    account = freshAccount;
                    if (freshAccount == null) friends = new JSONObject();
                    startEvents();
                    main.postDelayed(() -> {
                        if (generation != refreshGeneration || roomRequest != roomGeneration
                                || roomCache.get("") != previous) return;
                        readIo.execute(() -> {
                            try {
                                JSONArray result = (JSONArray) api.request("GET", "/api/messages", null);
                                main.post(() -> {
                                    if (generation == refreshGeneration && roomRequest == roomGeneration
                                            && roomCache.get("") == previous) applyRoomMessages("", result);
                                });
                            } catch (Exception failure) {
                                main.post(() -> {
                                    if (generation == refreshGeneration && !connected && loadingMessages) setConnection(false);
                                });
                            }
                        });
                    }, 1500);
                });
                if (freshAccount != null) readIo.execute(() -> {
                    try {
                        JSONObject result = (JSONObject) api.request("GET", "/api/friends", null);
                        main.post(() -> {
                            if (generation != refreshGeneration) return;
                            friends = result;
                            if (overlay.getVisibility() == View.VISIBLE) renderDrawer();
                        });
                    } catch (Exception ignored) { }
                });
                readIo.execute(() -> {
                    try {
                        String key = ((JSONObject) api.request("GET", "/api/config", null)).optString("giphyApiKey");
                        main.post(() -> { if (generation == refreshGeneration) giphyApiKey = key; });
                    } catch (Exception ignored) { }
                });
            } catch (Exception failure) {
                main.post(() -> {
                    if (generation != refreshGeneration) return;
                    setConnection(false);
                    error(failure.getMessage() == null ? "No se pudo conectar con el servidor." : failure.getMessage());
                });
            }
        });
    }

    private void startEvents() {
        startNotificationService(); // Reconnect using the new cookies after login, logout or a server change.
        int generation = ++eventGeneration;
        api.startEvents(new ApiClient.EventListener() {
            @Override public void onEvent(String event, Object data) {
                main.post(() -> { if (generation == eventGeneration) handleEvent(event, data); });
            }
            @Override public void onConnection(boolean value) {
                main.post(() -> { if (generation == eventGeneration) setConnection(value); });
            }
        });
        consumeNotification();
    }

    private void requestNotificationsOnFirstLaunch() {
        android.content.SharedPreferences prefs = getSharedPreferences("bruma_native",MODE_PRIVATE);
        if (prefs.getBoolean("notification_onboarding_done",false)) return;
        prefs.edit().putBoolean("notification_onboarding_done",true).apply();
        // Preserve a notification choice made in an earlier version.
        if (prefs.contains("notifications_enabled")) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            prefs.edit().putBoolean("notifications_enabled",false).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},NOTIFICATION_PERMISSION);
        } else {
            prefs.edit().putBoolean("notifications_enabled",true).apply();
        }
    }

    private void startNotificationService() {
        if (!foreground || !getSharedPreferences("bruma_native",MODE_PRIVATE).getBoolean("notifications_enabled",false)) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        try { startForegroundService(new Intent(this,NotificationService.class)); }
        catch (RuntimeException failure) { error("No se pudo mantener la conexión de notificaciones."); }
    }

    private void toggleNotifications() {
        android.content.SharedPreferences prefs = getSharedPreferences("bruma_native",MODE_PRIVATE);
        if (prefs.getBoolean("notifications_enabled",false)) {
            prefs.edit().putBoolean("notifications_enabled",false).apply();
            stopService(new Intent(this,NotificationService.class));
            getSystemService(android.app.NotificationManager.class).cancelAll();
            renderDrawer(); return;
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},NOTIFICATION_PERMISSION); return;
        }
        prefs.edit().putBoolean("notifications_enabled",true).apply(); startNotificationService(); renderDrawer();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent); pendingNotification = intent; consumeNotification();
    }

    private void consumeNotification() {
        if (pendingNotification == null) return;
        Intent intent = pendingNotification; pendingNotification = null;
        if (intent.getBooleanExtra("notification_friends",false)) { refreshFriends(); showDrawer(false); }
        else { String room = intent.getStringExtra("notification_room"); if (room != null) openRoom(room,room); }
    }

    private void showRoomMessages(String room, JSONArray cached) {
        messages = cached == null ? new JSONArray() : cached;
        loadingMessages = cached == null;
        visibleMessageLimit = MESSAGE_PAGE_SIZE;
        renderedFingerprint = Long.MIN_VALUE;
        renderMessages();
    }

    private void applyRoomMessages(String room, JSONArray result) {
        for (int index = 0; index < result.length(); index++) {
            JSONObject item = result.optJSONObject(index);
            if (item != null && !item.optBoolean("pending")) outbox.remove(item.optString("clientId"));
        }
        for (PendingSend send : outbox.values()) {
            if (!send.room.equals(room)) continue;
            boolean found = false;
            for (int index = 0; index < result.length(); index++) {
                JSONObject item = result.optJSONObject(index);
                if (item != null && item.optString("clientId").equals(send.body.optString("clientId"))) { found = true; break; }
            }
            if (!found) result.put(send.preview);
        }
        roomCache.put(room, result);
        if (activeFriend.equals(room)) {
            messages = result;
            loadingMessages = false;
            renderMessages();
        }
    }

    private void addRoomMessage(String room, JSONObject message) {
        if (message == null || message.optString("id").isEmpty()) return;
        String clientId = message.optString("clientId");
        if (!message.optBoolean("pending") && !clientId.isEmpty()) outbox.remove(clientId);
        JSONArray current = roomCache.get(room);
        if (current == null) current = activeFriend.equals(room) ? messages : new JSONArray();
        JSONArray updated = new JSONArray();
        String replaced = "";
        for (int index = 0; index < current.length(); index++) {
            JSONObject item = current.optJSONObject(index);
            if (item != null && (message.optString("id").equals(item.optString("id"))
                    || !clientId.isEmpty() && clientId.equals(item.optString("clientId")))) {
                if (!item.optBoolean("pending") && !message.optBoolean("pending")) return;
                replaced = item.optString("id"); updated.put(message);
            } else updated.put(current.opt(index));
        }
        if (replaced.isEmpty()) updated.put(message);
        roomCache.put(room, updated);
        if (!activeFriend.equals(room)) return;
        int oldCount = messages.length();
        messages = updated;
        if (!loadingMessages && oldCount > 0 && (oldCount != visibleMessageLimit || !replaced.isEmpty())) {
            View old = replaced.isEmpty() ? null : messageList.findViewWithTag(replaced);
            if (!replaced.isEmpty() && old == null) return;
            boolean bottom = messageList.getHeight() - messageScroll.getScrollY() - messageScroll.getHeight() < d(64);
            int position = old == null ? -1 : messageList.indexOfChild(old);
            if (old != null) messageList.removeView(old);
            if (replaced.isEmpty() && oldCount > visibleMessageLimit && messageList.getChildCount() > 1) {
                messageList.removeViewAt(1); // Keep the history button and the last visible page.
            }
            addMessage(message);
            if (position >= 0) {
                View added = messageList.getChildAt(messageList.getChildCount()-1);
                messageList.removeView(added); messageList.addView(added, position);
            }
            renderedFingerprint = messageFingerprint();
            messageScroll.post(() -> { if (bottom) messageScroll.fullScroll(View.FOCUS_DOWN); loadVisibleMedia(); });
        } else { loadingMessages = false; renderMessages(); }
    }

    private void updateGroupMessage(JSONObject message) {
        if (message == null) return;
        JSONArray current = roomCache.get("");
        if (current == null) return;
        JSONArray updated = new JSONArray();
        boolean found = false;
        for (int index = 0; index < current.length(); index++) {
            JSONObject item = current.optJSONObject(index);
            if (item != null && message.optString("id").equals(item.optString("id"))) {
                updated.put(message);
                found = true;
            } else updated.put(current.opt(index));
        }
        if (found) applyRoomMessages("", updated);
    }

    private void deleteGroupMessage(String id) {
        JSONArray current = roomCache.get("");
        if (current == null) return;
        JSONArray updated = new JSONArray();
        boolean found = false;
        for (int index = 0; index < current.length(); index++) {
            JSONObject item = current.optJSONObject(index);
            if (item != null && id.equals(item.optString("id"))) found = true;
            else updated.put(current.opt(index));
        }
        if (found) applyRoomMessages("", updated);
    }

    private void handleEvent(String event, Object data) {
        if ("messages".equals(event) && data instanceof JSONArray) {
            applyRoomMessages("", (JSONArray) data);
        } else if ("message-created".equals(event) && data instanceof JSONObject) {
            addRoomMessage("", (JSONObject) data);
        } else if ("message-updated".equals(event) && data instanceof JSONObject) {
            updateGroupMessage((JSONObject) data);
        } else if ("message-deleted".equals(event) && data instanceof JSONObject) {
            deleteGroupMessage(((JSONObject) data).optString("id"));
        } else if ("private".equals(event) && data instanceof JSONObject) {
            JSONObject update = (JSONObject) data;
            String room = update.optString("friendUsername");
            String friendName = update.optString("friendDisplayName");
            if (room.equals(activeFriend) && !friendName.isEmpty()) {
                activeFriendName = friendName;
                roomTitle.setText(friendName);
            }
            JSONArray result = update.optJSONArray("messages");
            if (!room.isEmpty() && result != null) applyRoomMessages(room, result);
        } else if ("private-created".equals(event) && data instanceof JSONObject) {
            JSONObject update = (JSONObject) data;
            String room = update.optString("friendUsername");
            String friendName = update.optString("friendDisplayName");
            if (room.equals(activeFriend) && !friendName.isEmpty()) {
                activeFriendName = friendName;
                roomTitle.setText(friendName);
            }
            if (!room.isEmpty()) addRoomMessage(room, update.optJSONObject("message"));
        } else if ("private-deleted".equals(event) && data instanceof JSONObject) {
            JSONObject removed = (JSONObject) data;
            String room = removed.optString("friendUsername");
            JSONArray old = roomCache.get(room), remaining = new JSONArray();
            if (old != null) for (int i=0; i<old.length(); i++) {
                JSONObject item = old.optJSONObject(i);
                if (item != null && !item.optString("id").equals(removed.optString("id"))) remaining.put(item);
            }
            applyRoomMessages(room, remaining);
        } else if ("friends".equals(event)) refreshFriends();
    }

    private void refreshFriends() {
        if (account == null) return;
        run(() -> {
            JSONObject result = (JSONObject) api.request("GET", "/api/friends", null);
            main.post(() -> {
                friends = result;
                if (overlay.getVisibility() == View.VISIBLE) renderDrawer();
            });
        });
    }

    private void openRoom(String username, String displayName) {
        NotificationService.activeRoom = username;
        getSystemService(android.app.NotificationManager.class).cancel("bruma:"+username,2);
        hideDrawer();
        replyToId = "";
        clearPendingImages();
        pendingFiles.clear();
        pendingAudioData = "";
        selectedGifUrl = "";
        updateComposerHints();
        activeFriend = username;
        activeFriendName = displayName == null || displayName.trim().isEmpty() ? "Usuario" : displayName.trim();
        roomTitle.setText(username.isEmpty() ? "Sala del grupo" : activeFriendName);
        showRoomMessages(username, roomCache.get(username));
        String requested = username;
        int generation = ++roomGeneration;
        JSONArray previous = roomCache.get(requested);
        readIo.execute(() -> {
            try {
                String route = requested.isEmpty() ? "/api/messages" : "/api/private/messages/" + Uri.encode(requested);
                JSONArray result = (JSONArray) api.request("GET", route, null);
                main.post(() -> {
                    if (generation == roomGeneration && roomCache.get(requested) == previous) applyRoomMessages(requested, result);
                });
            } catch (Exception failure) {
                main.post(() -> { if (generation == roomGeneration) error(failure.getMessage()); });
            }
        });
    }

    private String identity() { return account == null ? "guest" : account.optString("email"); }
    private void sendMessage() {
        if (recorder != null || preparingAudio || preparingImages > 0) { error("Termina de preparar los adjuntos antes de enviar."); return; }
        if (outbox.size() >= 20) { error("Espera o reintenta los envíos pendientes."); return; }
        String text = input.getText().toString().trim();
        if (text.isEmpty() && pendingFiles.isEmpty() && pendingImages.isEmpty() && pendingAudioData.isEmpty() && selectedGifUrl.isEmpty()) return;
        try {
            String id = UUID.randomUUID().toString();
            String author = account == null ? guestName : account.optString("displayName");
            JSONObject body = new JSONObject().put("clientId", id).put("text", text);
            if (activeFriend.isEmpty()) body.put("author", author).put("replyToId", replyToId);
            else body.put("recipientUsername", activeFriend);
            if (!pendingAudioData.isEmpty()) body.put("audioData", pendingAudioData);
            if (!selectedGifUrl.isEmpty()) body.put("gifUrl", selectedGifUrl);
            JSONObject preview = new JSONObject();
            for (Iterator<String> keys = body.keys(); keys.hasNext();) {
                String key = keys.next(); preview.put(key, body.get(key));
            }
            preview.put("id", "pending-" + id).put("author", author).put("createdAt", System.currentTimeMillis()).put("pending", true);
            if (account != null) preview.put("avatarData", account.optString("avatarData"));
            ArrayList<PendingFile> attachments = new ArrayList<>(pendingImages);
            attachments.addAll(pendingFiles);
            JSONArray localImages = new JSONArray();
            for (PendingFile image : pendingImages) localImages.put(image.uri.toString());
            if (localImages.length() > 0) preview.put("images", localImages);
            PendingSend send = new PendingSend(activeFriend, identity(), body, preview, attachments);
            outbox.put(id, send);
            addRoomMessage(activeFriend, preview);
            input.setText(""); pendingImages.clear(); pendingFiles.clear(); pendingAudioData=""; selectedGifUrl=""; replyToId="";
            updateComposerHints();
            transmit(send);
        } catch (Exception failure) { error("No se pudo preparar el envío."); }
    }
    private void transmit(PendingSend send) {
        if (send.running) return;
        if (!send.identity.equals(identity())) { error("Vuelve a la cuenta que inició este envío."); return; }
        synchronized (send) {
            if (send.cancelled) return;
            send.started = false;
        }
        send.running = true;
        try { send.preview.put("failed", false); } catch (Exception ignored) { }
        addRoomMessage(send.room, send.preview);
        boolean textOnly = send.files.isEmpty() && send.body.optString("audioData").isEmpty();
        (textOnly ? textIo : io).execute(() -> {
            synchronized (send) {
                if (send.cancelled) return;
                send.started = true;
            }
            try {
                while (send.uploaded.length() < send.files.size()) {
                    PendingFile file = send.files.get(send.uploaded.length());
                    JSONObject uploaded = api.upload("/api/uploads", file.type, file.name, send.room, getContentResolver().openInputStream(file.uri), file.size);
                    send.uploaded.put(uploaded);
                    if (file.preparedFile != null) {
                        String localKey = api.baseUrl() + "|960|" + file.uri;
                        Bitmap previewBitmap = imageCache.remove(localKey);
                        if (previewBitmap != null) imageCache.put(api.baseUrl() + "|960|" + uploaded.optString("url"), previewBitmap);
                    }
                }
                if (send.uploaded.length() > 0) {
                    JSONArray references = new JSONArray();
                    for (int index = 0; index < send.uploaded.length(); index++)
                        references.put(new JSONObject().put("id", send.uploaded.getJSONObject(index).getString("id")));
                    send.body.put("files", references);
                }
                JSONObject sent = (JSONObject) api.request("POST", send.room.isEmpty() ? "/api/messages" : "/api/private/messages", send.body);
                main.post(() -> { send.running = false; releasePreparedFiles(send); if (!isDestroyed()) addRoomMessage(send.room, sent); });
            } catch (Exception failure) {
                if ("Uno de los archivos ya no está disponible.".equals(failure.getMessage())) {
                    while (send.uploaded.length() > 0) send.uploaded.remove(send.uploaded.length() - 1);
                }
                main.post(() -> {
                    send.running = false;
                    if (isDestroyed() || !outbox.containsKey(send.body.optString("clientId"))) { releasePreparedFiles(send); return; }
                    try { send.preview.put("failed", true); } catch (Exception ignored) { }
                    addRoomMessage(send.room, send.preview);
                    error(failure.getMessage() == null ? "No enviado. Toca Reintentar." : failure.getMessage());
                });
            }
        });
    }

    private void clearPendingImages() {
        attachmentGeneration++;
        preparingImages = 0;
        for (PendingFile file : pendingImages) if (file.preparedFile != null) file.preparedFile.delete();
        pendingImages.clear();
    }
    private void releasePreparedFiles(PendingSend send) {
        for (PendingFile file : send.files) if (file.preparedFile != null) file.preparedFile.delete();
    }

    private void updateComposerHints() {
        replyLabel.setText(replyToId.isEmpty() ? "" : "↪ Respondiendo · toca para cancelar");
        replyLabel.setVisibility(replyToId.isEmpty() ? View.GONE : View.VISIBLE);
        ArrayList<String> pieces = new ArrayList<>();
        if (!pendingImages.isEmpty()) {
            long bytes = 0; for (PendingFile image : pendingImages) bytes += image.size;
            pieces.add(pendingImages.size() + " imagen(es) · " + formatBytes(bytes));
        }
        if (preparingImages > 0) pieces.add("Preparando imágenes…");
        if (!selectedGifUrl.isEmpty()) pieces.add("GIF");
        if (!pendingAudioData.isEmpty()) pieces.add("Audio");
        if (!pendingFiles.isEmpty()) pieces.add(pendingFiles.size() + " archivo(s)");
        if (preparingAudio) pieces.add("Preparando audio…");
        attachmentLabel.setText(String.join(" · ", pieces) + " · toca para quitar");
        attachmentLabel.setVisibility(pieces.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private long messageFingerprint() {
        long fingerprint = 31L * activeFriend.hashCode() + visibleMessageLimit + (loadingMessages ? 1 : 0);
        int count = messages == null ? 0 : messages.length();
        fingerprint = 31 * fingerprint + count;
        int first = Math.max(0, count - visibleMessageLimit);
        for (int index = first; index < count; index++) {
            JSONObject item = messages.optJSONObject(index);
            if (item == null) continue;
            fingerprint = 31 * fingerprint + item.optString("id").hashCode();
            fingerprint = 31 * fingerprint + item.optString("text").hashCode();
            fingerprint = 31 * fingerprint + item.optString("gifUrl").hashCode();
            fingerprint = 31 * fingerprint + item.optLong("createdAt");
            fingerprint = 31 * fingerprint + (item.optBoolean("edited") ? 1 : 0);
            fingerprint = 31 * fingerprint + (item.optBoolean("pending") ? 1 : 0);
            fingerprint = 31 * fingerprint + (item.optBoolean("failed") ? 1 : 0);
            fingerprint = 31 * fingerprint + (item.optBoolean("canEdit") ? 1 : 0);
            JSONArray images = item.optJSONArray("images");
            fingerprint = 31 * fingerprint + (images == null ? 0 : images.length());
            fingerprint = 31 * fingerprint + item.optString("audioData").length();
            fingerprint = 31 * fingerprint + item.optString("avatarData").length();
        }
        return fingerprint;
    }
    private void renderMessages() {
        long fingerprint = messageFingerprint();
        int count = messages == null ? 0 : messages.length();
        int first = Math.max(0, count - visibleMessageLimit);
        if (fingerprint == renderedFingerprint) return;
        boolean wasAtBottom = renderedFingerprint == Long.MIN_VALUE
                || messageList.getHeight() - messageScroll.getScrollY() - messageScroll.getHeight() < d(64);
        int oldScrollY = messageScroll.getScrollY();
        renderedFingerprint = fingerprint;
        deferredMedia.clear();
        messageList.removeAllViews();
        if (messages == null || messages.length() == 0) {
            messageList.setGravity(Gravity.CENTER);
            if (loadingMessages) {
                messageList.addView(label("Cargando mensajes…", 14, MUTED, false));
                return;
            }
            LinearLayout empty = column();
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(d(20), d(24), d(20), d(24));
            TextView symbol = label("B", 34, TEXT, true);
            symbol.setGravity(Gravity.CENTER);
            symbol.setBackground(background(DEEP_RED, 18));
            empty.addView(symbol, new LinearLayout.LayoutParams(d(76), d(76)));
            TextView title = label("Aquí empieza la conversación", 17, TEXT, true);
            title.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(-1, -2);
            titleParams.topMargin = d(16);
            empty.addView(title, titleParams);
            TextView description = label("Todavía no hay mensajes. Deja el primero.", 13, MUTED, false);
            description.setGravity(Gravity.CENTER);
            empty.addView(description);
            messageList.addView(empty);
            return;
        }
        messageList.setGravity(Gravity.BOTTOM);
        if (first > 0) {
            TextView earlier = action("Mostrar mensajes anteriores", () -> {
                int oldHeight = messageList.getHeight();
                int anchor = messageScroll.getScrollY();
                visibleMessageLimit += MESSAGE_PAGE_SIZE;
                renderMessages();
                messageScroll.post(() -> messageScroll.scrollTo(0, anchor + messageList.getHeight() - oldHeight));
            });
            LinearLayout.LayoutParams earlierParams = new LinearLayout.LayoutParams(-1, d(44));
            earlierParams.bottomMargin = d(10);
            messageList.addView(earlier, earlierParams);
        }
        for (int index = first; index < messages.length(); index++) {
            JSONObject message = messages.optJSONObject(index);
            if (message != null) addMessage(message);
        }
        messageScroll.post(() -> {
            if (wasAtBottom) messageScroll.fullScroll(View.FOCUS_DOWN);
            else messageScroll.scrollTo(0, oldScrollY);
            loadVisibleMedia();
        });
    }

    private void stopImageAnimations() {
        for (ImageView image : displayedImages)
            if (image.getDrawable() instanceof Animatable) ((Animatable) image.getDrawable()).stop();
    }

    private void loadVisibleMedia() {
        displayedImages.removeIf(image -> !image.isAttachedToWindow());
        for (ImageView image : displayedImages) {
            if (!(image.getDrawable() instanceof Animatable)) continue;
            Animatable animation = (Animatable) image.getDrawable();
            if (foreground && image.getGlobalVisibleRect(new Rect())) animation.start(); else animation.stop();
        }
        Iterator<PendingMedia> iterator = deferredMedia.iterator();
        while (iterator.hasNext()) {
            PendingMedia pending = iterator.next();
            if (!pending.view.isAttachedToWindow()) { iterator.remove(); continue; }
            if (!pending.view.getGlobalVisibleRect(new Rect())) continue;
            iterator.remove();
            if (pending.avatar) loadAvatar(pending.view, pending.address);
            else loadImage(pending.view, pending.address, 960);
        }
    }

    private void addMessage(JSONObject message) {
        LinearLayout outer = column();
        outer.setTag(message.optString("id"));
        outer.setPadding(d(12), d(10), d(12), d(10));
        outer.setBackground(background(CARD, 16));
        LinearLayout.LayoutParams outerParams = new LinearLayout.LayoutParams(-1, -2);
        outerParams.setMargins(0, 0, 0, d(9));
        messageList.addView(outer, outerParams);
        LinearLayout head = row();
        outer.addView(head);
        String author = message.optString("author", "?");
        String avatarData = message.optString("avatarData");
        if (avatarData.isEmpty()) {
            TextView avatar = label(author.isEmpty() ? "?" : author.substring(0, 1).toUpperCase(Locale.ROOT), 17, TEXT, true);
            avatar.setGravity(Gravity.CENTER);
            avatar.setBackground(background(ACCENT, 19));
            head.addView(avatar, new LinearLayout.LayoutParams(d(38), d(38)));
        } else {
            ImageView avatar = new ImageView(this);
            avatar.setScaleType(ImageView.ScaleType.CENTER_CROP);
            avatar.setBackground(background(ACCENT, 19));
            head.addView(avatar, new LinearLayout.LayoutParams(d(38), d(38)));
            deferredMedia.add(new PendingMedia(avatar, avatarData, true));
        }
        LinearLayout heading = column();
        heading.setPadding(d(9), 0, 0, 0);
        head.addView(heading, new LinearLayout.LayoutParams(0, -2, 1));
        heading.addView(label(author + (message.optBoolean("isAccount") ? "  ★" : ""), 14, TEXT, true));
        String username = message.optString("username");
        String stamp = clockFormat.format(new Date(message.optLong("createdAt")));
        heading.addView(label((username.isEmpty() ? "" : username + " · ") + stamp + (message.optBoolean("edited") ? " · editado" : ""), 11, MUTED, false));
        if (message.optBoolean("isAccount") && !username.isEmpty()) {
            head.setContentDescription("Ver perfil de " + username);
            head.setOnClickListener(v -> showPublicProfile(username));
        }
        JSONObject reply = message.optJSONObject("replyTo");
        if (reply != null) {
            TextView preview = label("↪ " + reply.optString("author") + ": " + reply.optString("text"), 12, ACCENT, false);
            preview.setPadding(d(8), d(7), d(8), d(7));
            outer.addView(preview);
        }
        String text = message.optString("text");
        if (!text.isEmpty()) {
            TextView body = label(text, 15, TEXT, false);
            body.setPadding(0, d(10), 0, d(5));
            outer.addView(body);
        }
        JSONArray images = message.optJSONArray("images");
        if (images == null && !message.optString("imageData").isEmpty()) {
            images = new JSONArray();
            images.put(message.optString("imageData"));
        }
        if (images != null) for (int i = 0; i < images.length(); i++) addImage(outer, images.optString(i));
        if (!message.optString("gifUrl").isEmpty()) addImage(outer, message.optString("gifUrl"));
        if (!message.optString("audioData").isEmpty()) {
            String audio = message.optString("audioData");
            final TextView[] holder = new TextView[1];
            holder[0] = action("▶ Reproducir audio", () -> toggleAudio(audio, holder[0]));
            TextView play = holder[0];
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, -2);
            params.topMargin = d(8);
            outer.addView(play, params);
        }
        JSONArray files = message.optJSONArray("files");
        if (files != null) for (int index = 0; index < files.length(); index++) {
            JSONObject file = files.optJSONObject(index);
            if (file == null) continue;
            String name = file.optString("name", "Archivo");
            String token = file.optString("token");
            String path = "/api/uploads/" + Uri.encode(file.optString("id")) + (token.isEmpty() ? "" : "?token=" + Uri.encode(token));
            if (isImageType(file.optString("type"))) {
                addImage(outer, path); continue;
            }
            TextView download = action("📎 " + name + " · " + formatBytes(file.optLong("size")), () -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(api.baseUrl() + path));
                    startActivity(intent);
                } catch (Exception failure) { error("No hay una aplicación para abrir este archivo."); }
            });
            LinearLayout.LayoutParams fileParams = new LinearLayout.LayoutParams(-1, -2);
            fileParams.topMargin = d(8);
            outer.addView(download, fileParams);
        }
        if (message.optBoolean("pending")) {
            boolean failed = message.optBoolean("failed");
            TextView status = action(failed ? "No enviado · Reintentar" : "Enviando…", () -> {
                PendingSend send = outbox.get(message.optString("clientId"));
                if (send != null && !send.running) transmit(send);
            });
            status.setTextColor(failed ? RED : MUTED); outer.addView(status);
        }
        if (activeFriend.isEmpty() && !message.optBoolean("pending")) {
            LinearLayout actions = row();
            actions.setPadding(0, d(7), 0, 0);
            outer.addView(actions);
            TextView replyButton = label("Responder", 12, ACCENT, true);
            replyButton.setPadding(d(5), d(4), d(15), d(4));
            replyButton.setOnClickListener(v -> {
                replyToId = message.optString("id");
                updateComposerHints();
                input.requestFocus();
            });
            actions.addView(replyButton);
            if (message.optBoolean("canEdit")) {
                TextView edit = label("Editar", 12, MUTED, true);
                edit.setPadding(d(5), d(4), d(15), d(4));
                edit.setOnClickListener(v -> editMessage(message));
                actions.addView(edit);
                TextView delete = label("Borrar", 12, RED, true);
                delete.setPadding(d(5), d(4), d(5), d(4));
                delete.setOnClickListener(v -> deleteMessage(message.optString("id")));
                actions.addView(delete);
            }
        }
    }

    private Bitmap bitmap(String dataUrl, int maxDimension) {
        try {
            int comma = dataUrl.indexOf(',');
            byte[] bytes;
            if (dataUrl.startsWith("/api/media/")) bytes = api.mediaBytes(dataUrl, 400000);
            else { if (!dataUrl.startsWith("data:image/") || comma < 0) return null; bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT); }
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 1;
            while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > maxDimension) options.inSampleSize *= 2;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } catch (Exception ignored) { return null; }
    }

    private String formatBytes(long bytes) {
        if (bytes < 1024L * 1024L) return Math.max(1, Math.round(bytes / 1024f)) + " KB";
        return String.format(Locale.getDefault(), bytes >= 100L * 1024L * 1024L ? "%.0f MB" : "%.1f MB", bytes / (1024f * 1024f));
    }

    private void loadAvatar(ImageView target, String dataUrl) {
        trackAnimation(target);
        loadImage(target,dataUrl,128);
    }

    private void trackAnimation(ImageView view) {
        if (!displayedImages.contains(view)) displayedImages.add(view);
        view.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
            @Override public void onViewAttachedToWindow(View ignored) { }
            @Override public void onViewDetachedFromWindow(View ignored) {
                if (view.getDrawable() instanceof Animatable) ((Animatable)view.getDrawable()).stop();
            }
        });
    }

    private void addImage(LinearLayout parent, String address) {
        ImageView view = new ImageView(this);
        trackAnimation(view);
        view.setScaleType(ImageView.ScaleType.FIT_CENTER);
        view.setBackground(background(PANEL, 12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, d(170));
        params.topMargin = d(8);
        parent.addView(view, params);
        deferredMedia.add(new PendingMedia(view, address, false));
        view.setOnClickListener(v -> {
            Drawable shown = view.getDrawable();
            if (shown != null && shown.getConstantState() != null) shown = shown.getConstantState().newDrawable();
            showImageViewer(shown);
        });
    }

    private static boolean isImageType(String type) {
        return type.equals("image/jpeg") || type.equals("image/png") || type.equals("image/webp") || type.equals("image/gif");
    }

    private void loadImage(ImageView target, String address, int maxDimension) {
        // Do not retain a second giant Base64 string as a cache key for legacy messages.
        String key = address.startsWith("data:") ? null : api.baseUrl() + "|" + maxDimension + "|" + address;
        Bitmap cached = key == null ? null : imageCache.get(key);
        if (cached != null) { target.setImageBitmap(cached); return; }
        mediaIo.execute(() -> {
            if (!target.isAttachedToWindow() || isDestroyed()) return;
            File file = null; boolean temporary = false;
            try {
                byte[] bytes = null;
                if (address.startsWith("data:image/")) {
                    int comma = address.indexOf(','); if (comma < 0) return;
                    bytes = Base64.decode(address.substring(comma + 1), Base64.DEFAULT);
                } else if (address.startsWith("file:")) {
                    file = new File(Uri.parse(address).getPath());
                } else if (address.startsWith("https://") || address.startsWith("/api/media/") || address.startsWith("/api/uploads/")) {
                    file = api.mediaFile(address, getCacheDir(), () -> target.isAttachedToWindow() && !isDestroyed()); temporary = true;
                } else return;
                if (!target.isAttachedToWindow() || isDestroyed()) return;
                if (Build.VERSION.SDK_INT >= 28) {
                    ImageDecoder.Source source = file == null ? ImageDecoder.createSource(ByteBuffer.wrap(bytes)) : ImageDecoder.createSource(file);
                    Drawable drawable = ImageDecoder.decodeDrawable(source, (decoder, info, ignored) -> {
                        int w = info.getSize().getWidth(), h = info.getSize().getHeight();
                        double scale = Math.min(1d, maxDimension / (double) Math.max(w, h));
                        decoder.setTargetSize(Math.max(1, (int) Math.round(w * scale)), Math.max(1, (int) Math.round(h * scale)));
                        decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB));
                    });
                    if (key != null && drawable instanceof BitmapDrawable) imageCache.put(key, ((BitmapDrawable) drawable).getBitmap());
                    main.post(() -> {
                        if (!target.isAttachedToWindow() || isDestroyed()) return;
                        target.setImageDrawable(drawable);
                        if (foreground && drawable instanceof AnimatedImageDrawable && target.getGlobalVisibleRect(new Rect())) ((AnimatedImageDrawable) drawable).start();
                    });
                } else {
                    byte[] animationBytes = bytes;
                    if (animationBytes == null && file != null) animationBytes = Files.readAllBytes(file.toPath());
                    if (animationBytes != null && animationBytes.length > 6 && animationBytes[0]=='G' && animationBytes[1]=='I' && animationBytes[2]=='F') {
                        android.graphics.Movie movie = android.graphics.Movie.decodeByteArray(animationBytes,0,animationBytes.length);
                        if (movie != null && movie.width()>0 && movie.height()>0) {
                            GifDrawable drawable = new GifDrawable(movie);
                            main.post(() -> { if (target.isAttachedToWindow() && !isDestroyed()) { target.setImageDrawable(drawable); if (foreground) drawable.start(); } });
                            return;
                        }
                    }
                    BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                    if (file == null) BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                    else BitmapFactory.decodeFile(file.getPath(), bounds);
                    BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
                    while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > maxDimension) options.inSampleSize *= 2;
                    Bitmap bitmap = file == null ? BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options) : BitmapFactory.decodeFile(file.getPath(), options);
                    if (key != null && bitmap != null) imageCache.put(key, bitmap);
                    main.post(() -> { if (target.isAttachedToWindow() && !isDestroyed()) target.setImageBitmap(bitmap); });
                }
            } catch (Exception ignored) { }
            finally { if (temporary && file != null) file.delete(); }
        });
    }

    private void stopAudioPlayback() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { }
            player.release();
            player = null;
        }
        if (activeAudioButton != null) activeAudioButton.setText("▶ Reproducir audio");
        if (activeAudioFile != null) activeAudioFile.delete();
        activeAudioButton = null;
        activeAudioFile = null;
        activeAudioKey = "";
    }

    private void toggleAudio(String data, TextView button) {
        int generation = ++audioGeneration;
        if (player != null) {
            boolean same = data.equals(activeAudioKey);
            stopAudioPlayback();
            if (same) return;
        }
        if (data.startsWith("/api/media/")) {
            try {
                stopAudioPlayback();
                MediaPlayer next = new MediaPlayer(); player = next;
                activeAudioButton = button; activeAudioKey = data;
                next.setDataSource(api.baseUrl() + data);
                next.setOnPreparedListener(ready -> { if (player == ready && generation == audioGeneration) { ready.start(); button.setText("■ Detener audio"); } });
                next.setOnCompletionListener(done -> { if (player == done) stopAudioPlayback(); });
                next.setOnErrorListener((failed, what, extra) -> { if (player == failed) { stopAudioPlayback(); error("No se pudo abrir el audio."); } return true; });
                button.setText("Cargando audio…"); next.prepareAsync();
            } catch (Exception failure) { stopAudioPlayback(); error("No se pudo abrir el audio."); }
            return;
        }
        mediaIo.execute(() -> {
            try {
                int comma = data.indexOf(',');
                byte[] bytes = Base64.decode(data.substring(comma + 1), Base64.DEFAULT);
                String extension = data.startsWith("data:audio/webm") ? ".webm"
                        : data.startsWith("data:audio/ogg") ? ".ogg"
                        : data.startsWith("data:audio/mpeg") ? ".mp3"
                        : data.startsWith("data:audio/mp4") ? ".mp4" : ".wav";
                java.io.File file = java.io.File.createTempFile("bruma-audio-", extension, getCacheDir());
                try (java.io.FileOutputStream output = new java.io.FileOutputStream(file)) { output.write(bytes); }
                main.post(() -> {
                    if (generation != audioGeneration) { file.delete(); return; }
                    try {
                        stopAudioPlayback();
                        player = new MediaPlayer();
                        activeAudioButton = button;
                        activeAudioFile = file;
                        activeAudioKey = data;
                        player.setDataSource(file.getAbsolutePath());
                        player.setOnCompletionListener(done -> { if (player == done) stopAudioPlayback(); });
                        player.prepare();
                        player.start();
                        button.setText("■ Detener audio");
                    } catch (Exception failure) { file.delete(); error("No se pudo reproducir el audio."); }
                });
            } catch (Exception failure) { main.post(() -> error("Audio inválido.")); }
        });
    }

    private void editMessage(JSONObject message) {
        EditText field = new EditText(this);
        field.setSingleLine(false);
        field.setText(message.optString("text"));
        field.setSelection(field.length());
        new AlertDialog.Builder(this).setTitle("Editar mensaje").setView(field)
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Guardar", (dialog, which) -> run(() -> {
                    JSONObject body = new JSONObject().put("text", field.getText().toString().trim());
                    JSONObject updated = (JSONObject) api.request("PATCH", "/api/messages/" + Uri.encode(message.optString("id")), body);
                    main.post(() -> updateGroupMessage(updated));
                })).show();
    }

    private void deleteMessage(String id) {
        new AlertDialog.Builder(this).setTitle("¿Borrar mensaje?")
                .setMessage("Esta acción no se puede deshacer.")
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Borrar", (dialog, which) -> run(() -> {
                    api.request("DELETE", "/api/messages/" + Uri.encode(id), null);
                    main.post(() -> deleteGroupMessage(id));
                })).show();
    }

    private void showGifPicker() {
        LinearLayout panel = column();
        panel.setPadding(d(14), d(8), d(14), d(12));
        LinearLayout searchRow = row();
        panel.addView(searchRow);
        EditText query = field("Buscar GIFs", "");
        query.setTextColor(TEXT);
        query.setHintTextColor(MUTED);
        query.setFilters(new android.text.InputFilter[] { new android.text.InputFilter.LengthFilter(50) });
        searchRow.addView(query, new LinearLayout.LayoutParams(0, d(48), 1));
        TextView search = action("Buscar", () -> {});
        searchRow.addView(search, new LinearLayout.LayoutParams(-2, d(45)));
        TextView status = label("", 12, MUTED, false);
        status.setPadding(d(4), d(8), d(4), d(8));
        panel.addView(status);
        ScrollView scroll = new ScrollView(this);
        panel.addView(scroll, new LinearLayout.LayoutParams(-1, d(220)));
        GridLayout grid = new GridLayout(this);
        grid.setColumnCount(3);
        scroll.addView(grid);
        TextView fromPhone = action("Elegir GIF del teléfono", () -> {});
        LinearLayout.LayoutParams phoneParams = new LinearLayout.LayoutParams(-1, d(42));
        phoneParams.topMargin = d(8);
        panel.addView(fromPhone, phoneParams);
        TextView attribution = label("Powered By GIPHY", 12, MUTED, true);
        attribution.setGravity(Gravity.CENTER);
        attribution.setPadding(0, d(12), 0, 0);
        panel.addView(attribution);
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("GIFs")
                .setView(panel)
                .setNegativeButton("Cerrar", null)
                .create();
        styleDialog(dialog);
        dialog.setOnDismissListener(ignored -> gifSearchGeneration++);
        dialog.show();
        fromPhone.setOnClickListener(v -> {
            dialog.dismiss();
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.setType("image/gif");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            startActivityForResult(intent, IMAGE_PICK);
        });
        Runnable load = () -> {
            if (giphyApiKey.isEmpty()) {
                status.setText("Configura GIPHY_API_KEY en el servidor para buscar GIFs.");
                return;
            }
            String term = query.getText().toString().trim();
            int generation = ++gifSearchGeneration;
            status.setText(term.isEmpty() ? "Cargando GIFs populares…" : "Buscando…");
            grid.removeAllViews();
            readIo.execute(() -> {
                try {
                    JSONArray found = api.requestGifs(giphyApiKey, term).optJSONArray("data");
                    main.post(() -> {
                        if (dialog.isShowing() && generation == gifSearchGeneration) renderGifResults(grid, status, dialog, found);
                    });
                } catch (Exception failure) {
                    main.post(() -> {
                        if (dialog.isShowing() && generation == gifSearchGeneration) status.setText("No se pudo conectar con GIPHY.");
                    });
                }
            });
        };
        search.setOnClickListener(v -> load.run());
        query.setOnEditorActionListener((v, actionId, event) -> { load.run(); return true; });
        load.run();
    }

    private void renderGifResults(GridLayout grid, TextView status, AlertDialog dialog, JSONArray found) {
        grid.removeAllViews();
        if (found == null || found.length() == 0) {
            status.setText("No encontramos GIFs para esa búsqueda.");
            return;
        }
        status.setText("Toca un GIF para adjuntarlo.");
        int width = Math.min(d(136), (getResources().getDisplayMetrics().widthPixels - d(84)) / 3);
        for (int i = 0; i < found.length(); i++) {
            JSONObject gif = found.optJSONObject(i);
            if (gif == null) continue;
            JSONObject renditions = gif.optJSONObject("images");
            if (renditions == null) continue;
            JSONObject full = renditions.optJSONObject("fixed_width");
            JSONObject thumbnail = renditions.optJSONObject("fixed_width_small_still");
            if (thumbnail == null) thumbnail = renditions.optJSONObject("fixed_width_small");
            String address = full == null ? "" : full.optString("url");
            if (full != null && Build.VERSION.SDK_INT >= 28 && full.optString("webp").startsWith("https://")
                    && full.optLong("webp_size", Long.MAX_VALUE) < full.optLong("size", Long.MAX_VALUE)) address = full.optString("webp");
            final String selectedAddress = address;
            String previewAddress = thumbnail == null ? address : thumbnail.optString("url", address);
            if (!address.startsWith("https://") || !previewAddress.startsWith("https://")) continue;
            ImageView preview = new ImageView(this);
            preview.setScaleType(ImageView.ScaleType.CENTER_CROP);
            preview.setBackground(background(CARD, 10));
            GridLayout.LayoutParams cell = new GridLayout.LayoutParams();
            cell.width = width;
            cell.height = Math.max(d(82), Math.round(width * 0.72f));
            cell.setMargins(d(4), d(4), d(4), d(4));
            grid.addView(preview, cell);
            loadImage(preview, previewAddress, 320);
            preview.setContentDescription("Adjuntar GIF " + gif.optString("title"));
            preview.setOnClickListener(v -> {
                selectedGifUrl = selectedAddress;
                updateComposerHints();
                dialog.dismiss();
            });
        }
    }

    private void toggleRecording() {
        if (recorder != null) { stopRecording(); return; }
        if (preparingAudio) { error("Espera a que termine de preparar el audio."); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, AUDIO_PERMISSION);
            return;
        }
        startRecording();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                getSharedPreferences("bruma_native",MODE_PRIVATE).edit().putBoolean("notifications_enabled",true).apply(); startNotificationService(); renderDrawer();
            } else {
                getSharedPreferences("bruma_native",MODE_PRIVATE).edit().putBoolean("notifications_enabled",false).apply();
                stopService(new Intent(this,NotificationService.class));
                renderDrawer();
                error("Puedes activar las notificaciones en los ajustes de Android.");
            }
            return;
        }
        if (requestCode != AUDIO_PERMISSION) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) startRecording();
        else error("Activa el permiso del micrófono para enviar audios.");
    }

    private void startRecording() {
        try {
            File file = File.createTempFile("bruma-voice-", ".m4a", getCacheDir());
            MediaRecorder next = new MediaRecorder();
            try {
                next.setAudioSource(MediaRecorder.AudioSource.MIC);
                next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                next.setAudioEncodingBitRate(64000);
                next.setAudioSamplingRate(44100);
                next.setMaxDuration(61000);
                next.setMaxFileSize(6_000_000);
                next.setOutputFile(file.getAbsolutePath());
                next.prepare();
                next.start();
            } catch (Exception failure) {
                next.release();
                file.delete();
                throw failure;
            }
            pendingAudioData = "";
            updateComposerHints();
            recordingFile = file;
            recorder = next;
            recordingStartedAt = SystemClock.elapsedRealtime();
            recordButton.setBackground(background(ACCENT, 12));
            main.post(recordingClock);
        } catch (Exception failure) { error("No se pudo iniciar la grabación."); }
    }

    private void stopRecording() {
        MediaRecorder active = recorder;
        if (active == null) return;
        recorder = null;
        main.removeCallbacks(recordingClock);
        recordButton.setText("● Voz");
        recordButton.setBackground(background(BUTTON, 12));
        File file = recordingFile;
        recordingFile = null;
        boolean finished;
        try {
            active.stop();
            finished = file != null && file.length() > 0 && file.length() <= 6_000_000;
        } catch (Exception failure) {
            finished = false;
        } finally { active.release(); }
        if (!finished) {
            if (file != null) file.delete();
            error("Graba al menos un segundo antes de detener el audio.");
            return;
        }
        preparingAudio = true;
        updateComposerHints();
        String room = activeFriend;
        mediaIo.execute(() -> {
            try {
                String encoded = "data:audio/mp4;base64," + Base64.encodeToString(Files.readAllBytes(file.toPath()), Base64.NO_WRAP);
                main.post(() -> {
                    preparingAudio = false;
                    if (activeFriend.equals(room)) pendingAudioData = encoded;
                    updateComposerHints();
                    if (activeFriend.equals(room)) error("Audio adjunto. Toca enviar.");
                });
            } catch (Exception failure) {
                main.post(() -> { preparingAudio = false; updateComposerHints(); error("No se pudo preparar el audio."); });
            } finally { file.delete(); }
        });
    }

    private void pickImage() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("image/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(intent, IMAGE_PICK);
    }

    private void showAttachmentMenu() {
        new AlertDialog.Builder(this)
                .setTitle("Agregar contenido")
                .setItems(new String[]{"Imágenes", "Audios", "Archivos"}, (dialog, which) -> {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    if (which == 0) { intent.setType("image/*"); startActivityForResult(intent, IMAGE_PICK); }
                    else if (which == 1) { intent.setType("audio/*"); startActivityForResult(intent, AUDIO_PICK); }
                    else { intent.setType("*/*"); startActivityForResult(intent, FILE_PICK); }
                }).show();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        String type = getContentResolver().getType(uri);
        boolean avatar = request == AVATAR_PICK;
        if (request == BANNER_PICK) {
            preparationIo.execute(() -> {
                try {
                    String prepared = BannerPreparer.prepare(this,uri);
                    main.post(() -> { if (!isDestroyed() && account != null) { ensureProfileDraft(); profileDraftBanner = prepared; renderDrawer(); error("Banner listo. Pulsa Guardar perfil."); } });
                } catch (Exception failure) { main.post(() -> error(failure.getMessage())); }
            });
            return;
        }
        if (request == FILE_PICK) {
            String name = uri.getLastPathSegment() == null ? "archivo" : uri.getLastPathSegment();
            long size = -1;
            try (android.database.Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE);
                    if (index >= 0 && !cursor.isNull(index)) size = cursor.getLong(index);
                    int nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0) name = cursor.getString(nameIndex);
                }
            } catch (Exception ignored) { }
            long limit = type != null && (type.startsWith("image/") || type.startsWith("audio/")) ? 10_000_000 : 500_000_000;
            if (size > limit) { error("El archivo debe pesar como máximo " + (limit == 10_000_000 ? "10" : "500") + " MB."); return; }
            pendingFiles.add(new PendingFile(uri, name, type == null ? "application/octet-stream" : type, size));
            updateComposerHints();
            return;
        }
        if (request == AUDIO_PICK) {
            if (type == null || !type.startsWith("audio/")) { error("Selecciona un archivo de audio."); return; }
            mediaIo.execute(() -> {
                try (InputStream input = getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) throw new Exception("No se pudo abrir el audio.");
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) { output.write(buffer, 0, count); if (output.size() > 10_000_000) throw new Exception("El audio debe pesar como máximo 10 MB."); }
                    String encoded = "data:" + type + ";base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
                    main.post(() -> { pendingAudioData = encoded; updateComposerHints(); });
                } catch (Exception failure) { main.post(() -> error(failure.getMessage())); }
            });
            return;
        }
        if (!avatar && (type == null || !isImageType(type))) {
            error("Usa una imagen PNG, JPEG, WebP o GIF.");
            return;
        }
        if (!avatar) {
            if (pendingImages.size() + preparingImages >= 4) { error("Puedes adjuntar hasta 4 imágenes a la vez."); return; }
            int generation = attachmentGeneration;
            preparingImages++; updateComposerHints();
            preparationIo.execute(() -> {
                if (generation != attachmentGeneration || isDestroyed()) return;
                try {
                    ImagePreparer.Result resultImage = ImagePreparer.prepare(this, uri, type);
                    main.post(() -> {
                        if (isDestroyed() || generation != attachmentGeneration) { resultImage.file.delete(); return; }
                        preparingImages--;
                        String extension = resultImage.type.equals("image/webp") ? ".webp" : resultImage.type.equals("image/gif") ? ".gif" : resultImage.type.equals("image/png") ? ".png" : ".jpg";
                        PendingFile image = new PendingFile(Uri.fromFile(resultImage.file), "imagen" + extension, resultImage.type, resultImage.file.length());
                        image.preparedFile = resultImage.file;
                        pendingImages.add(image); updateComposerHints();
                    });
                } catch (Exception failure) {
                    main.post(() -> {
                        if (isDestroyed() || generation != attachmentGeneration) return;
                        preparingImages--; updateComposerHints(); error(failure.getMessage());
                    });
                }
            });
            return;
        }
        preparationIo.execute(() -> {
            try {
                String encoded = AvatarPreparer.prepare(this,uri);
                main.post(() -> { if (!isDestroyed()) saveAvatar(encoded); });
            } catch (Exception failure) { main.post(() -> error(failure.getMessage())); }
        });
    }

    private void saveAvatar(String encoded) {
        if (account == null) return;
        run(() -> {
            JSONObject body = new JSONObject()
                    .put("displayName", account.optString("displayName"))
                    .put("username", account.optString("username"))
                    .put("avatarData", encoded);
            JSONObject result = (JSONObject) api.request("PATCH", "/api/auth/profile", body);
            main.post(() -> { account = result.optJSONObject("account"); renderDrawer(); error("Foto actualizada."); });
        });
    }

    private void showDrawer(boolean details) {
        InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (keyboard != null) keyboard.hideSoftInputFromWindow(input.getWindowToken(), 0);
        input.clearFocus();
        overlay.removeViews(1, Math.max(0, overlay.getChildCount() - 1));
        ScrollView scroller = new ScrollView(this);
        scroller.setFillViewport(true);
        scroller.setBackgroundColor(DEEP_RED);
        int width = Math.min(d(340), getResources().getDisplayMetrics().widthPixels - d(45));
        FrameLayout.LayoutParams placement = new FrameLayout.LayoutParams(width, -1, details ? Gravity.END : Gravity.START);
        overlay.addView(scroller, placement);
        drawerContent = column();
        drawerContent.setPadding(d(16), d(19), d(16), d(24));
        scroller.addView(drawerContent);
        overlay.setTag(details ? "details" : "rooms");
        overlay.setVisibility(View.VISIBLE);
        renderDrawer();
    }

    private void hideDrawer() { overlay.setVisibility(View.GONE); }

    private void drawerHeading(String text) {
        TextView view = label(text, 12, MUTED, true);
        view.setPadding(d(4), d(18), 0, d(8));
        drawerContent.addView(view);
    }

    private void drawerItem(String title, String subtitle, Runnable click) {
        LinearLayout item = column();
        item.setPadding(d(13), d(12), d(13), d(12));
        GradientDrawable itemBackground = background(CARD, 13);
        itemBackground.setStroke(d(1), Color.rgb(105, 45, 45));
        item.setBackground(itemBackground);
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2);
        layout.bottomMargin = d(8);
        drawerContent.addView(item, layout);
        item.addView(label(title, 15, TEXT, true));
        if (subtitle != null && !subtitle.isEmpty()) item.addView(label(subtitle, 12, MUTED, false));
        item.setOnClickListener(v -> click.run());
    }

    private void renderDrawer() {
        if (overlay.getVisibility() != View.VISIBLE || drawerContent == null) return;
        drawerContent.removeAllViews();
        boolean details = "details".equals(overlay.getTag());
        TextView heading = label(details ? "Información" : "Bruma", 25, TEXT, true);
        drawerContent.addView(heading);
        if (details) renderDetails();
        else renderRooms();
    }

    private void renderRooms() {
        drawerHeading("CONVERSACIONES");
        drawerItem("# Sala del grupo", "Mensajes que desaparecen a medianoche", () -> openRoom("", ""));
        JSONArray list = friends.optJSONArray("friends");
        if (account != null && list != null) {
            for (int i = 0; i < list.length(); i++) {
                JSONObject friend = list.optJSONObject(i);
                if (friend == null) continue;
                String user = friend.optString("username");
                String name = friend.optString("displayName");
                if (name.trim().isEmpty()) name = "Usuario";
                final String friendUsername = user;
                final String friendDisplayName = name;
                drawerItem("◉ " + friendDisplayName, friendUsername + " · privado", () -> openRoom(friendUsername, friendDisplayName));
                drawerItem("Ver perfil", friendUsername, () -> showPublicProfile(friendUsername));
            }
            drawerHeading("AMISTADES");
            drawerItem("＋ Agregar amigo", "Busca a alguien por @usuario", this::addFriendDialog);
            JSONArray incoming = friends.optJSONArray("incoming");
            if (incoming != null) for (int i = 0; i < incoming.length(); i++) {
                JSONObject request = incoming.optJSONObject(i);
                if (request == null) continue;
                JSONObject from = request.optJSONObject("from");
                String name = from == null ? "Alguien" : from.optString("displayName", from.optString("username"));
                drawerItem("Solicitud de " + name, "Toca para aceptar o rechazar", () -> respondToRequest(request.optString("id"), name));
            }
            JSONArray outgoing = friends.optJSONArray("outgoing");
            if (outgoing != null) for (int i = 0; i < outgoing.length(); i++) {
                JSONObject request = outgoing.optJSONObject(i);
                if (request != null) {
                    JSONObject to = request.optJSONObject("to");
                    if (to != null) drawerItem("Pendiente: " + to.optString("username"), "Esperando respuesta", () -> {});
                }
            }
        }
    }

    private void renderDetails() {
        drawerHeading("SALA ACTUAL");
        drawerItem(activeFriend.isEmpty() ? "# Sala del grupo" : activeFriendName,
                activeFriend.isEmpty() ? "Los mensajes caducan a las 12 horas o en la limpieza de medianoche." : "Chat privado: los mensajes caducan a las 24 horas.", () -> {});
        drawerHeading("PERFIL");
        addProfilePreview();
        if (account == null) {
            drawerItem("Visitante: " + guestName, "Toca para cambiar tu nombre", this::guestNameDialog);
            drawerItem("Iniciar sesión / crear cuenta", "Guarda tu perfil y habla en privado", this::accountDialog);
        } else {
            addProfileEditor();
            drawerItem("Cambiar banner", "Imagen estática PNG, JPEG o WebP", () -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT); intent.setType("image/*"); intent.addCategory(Intent.CATEGORY_OPENABLE);
                startActivityForResult(intent,BANNER_PICK);
            });
            drawerItem("Quitar banner", "Se quitará al guardar el perfil", () -> { ensureProfileDraft(); profileDraftBanner = ""; renderDrawer(); });
            drawerItem("Cambiar foto de perfil", "PNG, JPEG, WebP o GIF · hasta 4 MB", () -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.setType("image/*");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                startActivityForResult(intent, AVATAR_PICK);
            });
            drawerItem("Cerrar sesión", account.optString("email"), this::logout);
        }
        drawerHeading("CONEXIÓN");
        boolean noticesEnabled = getSharedPreferences("bruma_native",MODE_PRIVATE).getBoolean("notifications_enabled",false);
        drawerItem(noticesEnabled ? "Desactivar notificaciones" : "Activar notificaciones", "Mensajes y solicitudes, también con la app minimizada",this::toggleNotifications);
        drawerItem("Servidor", api.baseUrl(), this::serverDialog);
        drawerItem("Actualizar", "Volver a cargar mensajes y cuenta", () -> { hideDrawer(); refreshAll(); });
    }

    private void ensureProfileDraft() {
        String owner = account == null ? "" : account.optString("email");
        if (owner.equals(profileDraftOwner)) return;
        profileDraftOwner = owner;
        profileDraftName = account == null ? guestName : account.optString("displayName");
        profileDraftUsername = account == null ? "" : account.optString("username");
        profileDraftBio = account == null ? "" : account.optString("bio");
        profileDraftBanner = account == null ? "" : account.optString("bannerData");
    }

    private void addProfilePreview() {
        ensureProfileDraft();
        JSONObject preview = new JSONObject();
        try {
            preview.put("displayName",account == null ? guestName : profileDraftName).put("username",account == null ? "Visitante" : profileDraftUsername)
                .put("avatarData",account == null ? "" : account.optString("avatarData")).put("bannerData",profileDraftBanner).put("bio",profileDraftBio);
        } catch (Exception ignored) { }
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1,-2); params.bottomMargin = d(14);
        drawerContent.addView(profileCard(preview),params);
    }

    private LinearLayout profileCard(JSONObject profile) {
        final int surface = 0xff2b2b2b;
        LinearLayout card = column(); card.setBackground(background(surface,14)); card.setClipToOutline(true);
        FrameLayout header = new FrameLayout(this);
        card.addView(header,new LinearLayout.LayoutParams(-1,d(176)));
        ImageView banner = new ImageView(this); banner.setScaleType(ImageView.ScaleType.CENTER_CROP); banner.setBackgroundColor(DEEP_RED);
        header.addView(banner,new FrameLayout.LayoutParams(-1,d(128)));
        String bannerData = profile.optString("bannerData");
        if (!bannerData.isEmpty()) banner.post(() -> loadImage(banner,bannerData,1200));
        String name = profile.optString("displayName"), avatarData = profile.optString("avatarData");
        View avatar;
        if (avatarData.isEmpty()) {
            TextView initial = label(name.isEmpty() ? "?" : name.substring(0,1).toUpperCase(Locale.ROOT),36,TEXT,true);
            initial.setGravity(Gravity.CENTER); avatar = initial;
        } else {
            ImageView image = new ImageView(this); image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            trackAnimation(image); image.post(() -> loadImage(image,avatarData,384)); avatar = image;
            image.setOnClickListener(v -> { Drawable shown = image.getDrawable(); if (shown != null && shown.getConstantState() != null) shown = shown.getConstantState().newDrawable(); showImageViewer(shown); });
        }
        GradientDrawable circle = new GradientDrawable(); circle.setShape(GradientDrawable.OVAL); circle.setColor(0xff151515); circle.setStroke(d(2),surface);
        avatar.setBackground(circle); avatar.setClipToOutline(true);
        FrameLayout.LayoutParams avatarParams = new FrameLayout.LayoutParams(d(96),d(96)); avatarParams.leftMargin = d(16); avatarParams.topMargin = d(80);
        header.addView(avatar,avatarParams);
        LinearLayout body = column(); body.setPadding(d(16),d(14),d(16),d(20)); card.addView(body,new LinearLayout.LayoutParams(-1,-2));
        TextView title = label(name,22,TEXT,true); body.addView(title,new LinearLayout.LayoutParams(-1,-2));
        TextView handle = label(profile.optString("username"),14,MUTED,false);
        LinearLayout.LayoutParams handleParams = new LinearLayout.LayoutParams(-1,-2); handleParams.topMargin = d(4); body.addView(handle,handleParams);
        String bio = profile.optString("bio");
        if (!bio.isEmpty()) {
            TextView biography = label(bio,14,TEXT,false); biography.setPadding(d(14),d(14),d(14),d(14)); biography.setBackground(background(0xff151515,8));
            biography.setLineSpacing(d(3),1f);
            LinearLayout.LayoutParams bioParams = new LinearLayout.LayoutParams(-1,-2); bioParams.topMargin = d(22); body.addView(biography,bioParams);
        }
        return card;
    }

    private void addProfileEditor() {
        ensureProfileDraft();
        drawerContent.addView(label("Nombre visible",12,MUTED,false));
        EditText name = field("Nombre visible",profileDraftName); name.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(30)});
        drawerContent.addView(name,new LinearLayout.LayoutParams(-1,d(52)));
        drawerContent.addView(label("Nombre de usuario",12,MUTED,false));
        EditText username = field("@usuario",profileDraftUsername); username.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(21)});
        drawerContent.addView(username,new LinearLayout.LayoutParams(-1,d(52)));
        drawerContent.addView(label("Biografía personal · hasta 2000 caracteres",12,MUTED,false));
        EditText bio = field("Cuéntanos algo sobre ti...",profileDraftBio); bio.setSingleLine(false); bio.setMinLines(3); bio.setGravity(Gravity.TOP);
        bio.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        bio.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(2000)});
        drawerContent.addView(bio,new LinearLayout.LayoutParams(-1,-2));
        watchProfileField(name,value -> profileDraftName=value); watchProfileField(username,value -> profileDraftUsername=value); watchProfileField(bio,value -> profileDraftBio=value);
        drawerItem("Guardar perfil","Nombre, usuario, biografía y banner",() -> {
            final String savedName = profileDraftName, savedUsername = profileDraftUsername, savedBio = profileDraftBio, savedBanner = profileDraftBanner;
            run(() -> {
                JSONObject body = new JSONObject().put("displayName",savedName).put("username",savedUsername).put("bio",savedBio).put("bannerData",savedBanner).put("avatarData",account.optString("avatarData"));
                JSONObject result = (JSONObject)api.request("PATCH","/api/auth/profile",body);
                main.post(() -> { account = result.optJSONObject("account"); profileDraftOwner = ""; ensureProfileDraft(); renderDrawer(); error("Perfil guardado."); });
            });
        });
    }

    private void watchProfileField(EditText field,java.util.function.Consumer<String> change) {
        field.addTextChangedListener(new android.text.TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value,int start,int count,int after) { }
            @Override public void onTextChanged(CharSequence value,int start,int before,int count) { change.accept(value.toString()); }
            @Override public void afterTextChanged(android.text.Editable value) { }
        });
    }

    private EditText field(String hint, String value) {
        EditText edit = new EditText(this);
        edit.setSingleLine(true);
        edit.setTextSize(15);
        edit.setHint(hint);
        edit.setText(value);
        return edit;
    }

    private LinearLayout form(EditText... inputs) {
        LinearLayout layout = column();
        layout.setPadding(d(20), d(6), d(20), d(6));
        for (EditText edit : inputs) layout.addView(edit, new LinearLayout.LayoutParams(-1, d(55)));
        return layout;
    }

    private void guestNameDialog() {
        hideDrawer();
        EditText name = field("Nombre visible", guestName);
        new AlertDialog.Builder(this).setTitle("Tu nombre de visitante").setView(form(name))
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Guardar", (dialog, which) -> {
                    String next = name.getText().toString().trim();
                    if (next.isEmpty()) { error("Escribe un nombre."); return; }
                    guestName = next.substring(0, Math.min(30, next.length()));
                    getPreferences(MODE_PRIVATE).edit().putString("guest_name", guestName).apply();
                }).show();
    }

    private void accountDialog() {
        hideDrawer();
        EditText email = field("Correo", "");
        email.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        EditText username = field("@usuario (solo para registro)", "");
        EditText password = field("Contraseña", "");
        password.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        AlertDialog accountDialog = new AlertDialog.Builder(this).setTitle("Tu cuenta de Bruma").setView(form(email, username, password))
                .setNegativeButton("Cancelar", null)
                .setNeutralButton("Crear cuenta", (dialog, which) -> authenticate(true, email, username, password))
                .setPositiveButton("Iniciar sesión", (dialog, which) -> authenticate(false, email, username, password)).create();
        styleDialog(accountDialog);
        accountDialog.show();
    }

    private void authenticate(boolean register, EditText email, EditText username, EditText password) {
        String address = email.getText().toString().trim();
        String user = username.getText().toString().trim();
        String secret = password.getText().toString();
        run(() -> {
            JSONObject body = new JSONObject().put("email", address).put("password", secret).put("username", user);
            JSONObject result = (JSONObject) api.request("POST", register ? "/api/auth/register" : "/api/auth/login", body);
            JSONObject newAccount = result.optJSONObject("account");
            JSONObject newFriends = (JSONObject) api.request("GET", "/api/friends", null);
            main.post(() -> {
                ++refreshGeneration;
                roomCache.clear();
                account = newAccount;
                friends = newFriends;
                startEvents();
                openRoom("", "");
                error("Sesión iniciada.");
            });
        });
    }

    private void logout() {
        hideDrawer();
        stopService(new Intent(this,NotificationService.class));
        getSystemService(android.app.NotificationManager.class).cancelAll();
        run(() -> {
            api.request("POST", "/api/auth/logout", null);
            JSONObject next = (JSONObject) api.request("GET", "/api/auth/me", null);
            main.post(() -> {
                ++refreshGeneration;
                roomCache.clear();
                account = next.optJSONObject("account");
                friends = new JSONObject();
                startEvents();
                openRoom("", "");
            });
        });
    }

    private void showPublicProfile(String username) {
        hideDrawer();
        run(() -> {
            JSONObject result = (JSONObject)api.request("GET","/api/profiles/"+Uri.encode(username),null);
            JSONObject profile = result.getJSONObject("profile");
            main.post(() -> {
                if (isFinishing() || isDestroyed()) return;
                String name = profile.optString("displayName"), handle = profile.optString("username");
                ScrollView scroll = new ScrollView(this); scroll.setFillViewport(false);
                scroll.addView(profileCard(profile),new ScrollView.LayoutParams(-1,-2));
                AlertDialog.Builder builder = new AlertDialog.Builder(this).setView(scroll).setNegativeButton("Cerrar",null);
                JSONArray list = friends.optJSONArray("friends"); boolean isFriend = false;
                if (list != null) for (int i=0;i<list.length();i++) { JSONObject friend = list.optJSONObject(i); if (friend != null && handle.equals(friend.optString("username"))) isFriend = true; }
                if (isFriend) builder.setPositiveButton("Abrir conversación",(dialog,which) -> openRoom(handle,name));
                AlertDialog dialog = builder.create(); dialog.show(); styleDialog(dialog);
            });
        });
    }

    private void addFriendDialog() {
        hideDrawer();
        EditText username = field("@usuario", "");
        new AlertDialog.Builder(this).setTitle("Agregar amigo").setView(form(username))
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Enviar", (dialog, which) -> run(() -> {
                    JSONObject body = new JSONObject().put("username", username.getText().toString().trim());
                    api.request("POST", "/api/friends/requests", body);
                    main.post(() -> error("Solicitud enviada."));
                    refreshFriends();
                })).show();
    }

    private void respondToRequest(String id, String name) {
        hideDrawer();
        new AlertDialog.Builder(this).setTitle("Solicitud de " + name)
                .setNegativeButton("Rechazar", (dialog, which) -> answerRequest(id, "reject"))
                .setNeutralButton("Cancelar", null)
                .setPositiveButton("Aceptar", (dialog, which) -> answerRequest(id, "accept")).show();
    }

    private void answerRequest(String id, String action) {
        run(() -> {
            api.request("PATCH", "/api/friends/requests/" + Uri.encode(id), new JSONObject().put("action", action));
            refreshFriends();
        });
    }

    private void serverDialog() {
        hideDrawer();
        EditText address = field("https://tu-dominio.up.railway.app", api.baseUrl());
        new AlertDialog.Builder(this).setTitle("Servidor de Bruma").setView(form(address))
                .setMessage("Usa el dominio HTTPS de tu proyecto Railway.")
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Conectar", (dialog, which) -> {
                    try {
                        api.setBaseUrl(address.getText().toString());
                        stopService(new Intent(this,NotificationService.class));
                        getSystemService(android.app.NotificationManager.class).cancelAll();
                        roomCache.clear();
                        avatarCache.evictAll();
                        account = null;
                        friends = new JSONObject();
                        messages = new JSONArray();
                        refreshAll();
                    } catch (Exception failure) { error(failure.getMessage()); }
                }).show();
    }

    @Override public void onBackPressed() {
        if (overlay.getVisibility() == View.VISIBLE) hideDrawer();
        else if (!activeFriend.isEmpty()) openRoom("", "");
        else super.onBackPressed();
    }
}
