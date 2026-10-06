package com.bruma.chat;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;
import org.json.JSONTokener;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

final class ApiClient {
    interface EventListener {
        void onEvent(String event, Object data);
        void onConnection(boolean connected);
    }

    private static final String DEFAULT_URL = "https://brumo-production.up.railway.app";
    private final SharedPreferences preferences;
    private final OkHttpClient http;
    private volatile HttpURLConnection eventConnection;
    private volatile int eventGeneration;

    ApiClient(Context context) {
        http = new OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS)
                .cache(new okhttp3.Cache(new java.io.File(context.getCacheDir(), "media-http"), 16L * 1024 * 1024))
                .followRedirects(false).retryOnConnectionFailure(false).build();
        preferences = context.getSharedPreferences("bruma_native", Context.MODE_PRIVATE);
    }

    String baseUrl() {
        return preferences.getString("server_url", DEFAULT_URL);
    }

    void setBaseUrl(String input) throws Exception {
        URL parsed = new URL(input.trim());
        if (!"https".equals(parsed.getProtocol()) || parsed.getHost().isEmpty()
                || !parsed.getPath().isEmpty() && !"/".equals(parsed.getPath())
                || parsed.getQuery() != null || parsed.getRef() != null) {
            throw new Exception("Escribe la dirección HTTPS principal de Railway.");
        }
        preferences.edit().putString("server_url", parsed.getProtocol() + "://" + parsed.getAuthority()).apply();
        clearCookies();
        stopEvents();
    }

    void clearCookies() {
        preferences.edit().remove("guest_cookie").remove("session_cookie").apply();
    }

    private synchronized String cookieHeader() {
        String guest = preferences.getString("guest_cookie", "");
        String session = preferences.getString("session_cookie", "");
        return (guest.isEmpty() ? "" : "bruma-guest=" + guest)
                + (session.isEmpty() ? "" : (guest.isEmpty() ? "" : "; ") + "bruma-session=" + session);
    }

    private synchronized void rememberCookies(HttpURLConnection connection) {
        for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
            if (header.getKey() != null && header.getKey().equalsIgnoreCase("Set-Cookie")) rememberCookies(header.getValue());
        }
    }

    private synchronized void rememberCookies(List<String> headers) {
        SharedPreferences.Editor edit = preferences.edit();
        for (String value : headers) {
                String pair = value.split(";", 2)[0].trim();
                int separator = pair.indexOf('=');
                if (separator < 0) continue;
                String name = pair.substring(0, separator);
                String cookieValue = pair.substring(separator + 1);
                if (name.equals("bruma-guest")) {
                    if (cookieValue.isEmpty()) edit.remove("guest_cookie");
                    else edit.putString("guest_cookie", cookieValue);
                } else if (name.equals("bruma-session")) {
                    if (cookieValue.isEmpty()) edit.remove("session_cookie");
                    else edit.putString("session_cookie", cookieValue);
                }
        }
        edit.apply();
    }

    private HttpURLConnection open(String path) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl() + path).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept", "application/json");
        String cookies = cookieHeader();
        if (!cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);
        return connection;
    }

    Object request(String method, String path, JSONObject body) throws Exception {
        byte[] encoded = body == null ? null : body.toString().getBytes(StandardCharsets.UTF_8);
        boolean compressed = encoded != null && encoded.length > 16384;
        if (compressed) {
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
            try (java.util.zip.GZIPOutputStream gzip = new java.util.zip.GZIPOutputStream(output)) { gzip.write(encoded); }
            encoded = output.toByteArray();
        }
        RequestBody payload = encoded == null ? null : RequestBody.create(encoded, MediaType.get("application/json; charset=utf-8"));
        if ("POST".equals(method) && payload == null) payload = RequestBody.create("", MediaType.get("application/json"));
        Request.Builder builder = new Request.Builder().url(baseUrl() + path).method(method, payload).header("Accept", "application/json").header("X-Bruma-Version", "3");
        if (compressed) builder.header("Content-Encoding", "gzip");
        String cookies = cookieHeader();
        if (!cookies.isEmpty()) builder.header("Cookie", cookies);
        try (Response response = http.newCall(builder.build()).execute()) {
            int status = response.code();
            rememberCookies(response.headers("Set-Cookie"));
            String text = response.body() == null ? "" : response.body().string();
            Object result = text.isEmpty() ? new JSONObject() : new JSONTokener(text).nextValue();
            if (status >= 400) {
                String message = result instanceof JSONObject
                        ? ((JSONObject) result).optString("error", "Error " + status) : "Error " + status;
                throw new Exception(message);
            }
            return result;
        }
    }

    JSONObject upload(String path, String contentType, String name, String recipient, java.io.InputStream input, long length) throws Exception {
        if (input == null) throw new Exception("No se pudo abrir el archivo.");
        if (length >= 0 && length <= 10_000_000) {
            try (java.io.InputStream stream = input) {
                RequestBody payload = new RequestBody() {
                    @Override public MediaType contentType() { return MediaType.get(contentType); }
                    @Override public long contentLength() { return length; }
                    @Override public void writeTo(okio.BufferedSink sink) throws java.io.IOException {
                        byte[] buffer = new byte[16384]; int count;
                        while ((count = stream.read(buffer)) != -1) sink.write(buffer, 0, count);
                    }
                };
                Request.Builder builder = new Request.Builder().url(baseUrl() + "/api/uploads").post(payload)
                        .header("X-Bruma-File-Name", java.net.URLEncoder.encode(name, "UTF-8"));
                if (recipient != null && !recipient.isEmpty()) builder.header("X-Bruma-Recipient", recipient);
                String cookies = cookieHeader(); if (!cookies.isEmpty()) builder.header("Cookie", cookies);
                try (Response response = http.newCall(builder.build()).execute()) {
                    rememberCookies(response.headers("Set-Cookie"));
                    JSONObject result = new JSONObject(response.body() == null ? "{}" : response.body().string());
                    if (!response.isSuccessful()) throw new Exception(result.optString("error", "No se pudo subir el archivo."));
                    return result;
                }
            }
        }
        JSONObject startBody = new JSONObject().put("name", name).put("type", contentType).put("size", length);
        if (recipient != null && !recipient.isEmpty()) startBody.put("recipientUsername", recipient);
        JSONObject started = (JSONObject) request("POST", "/api/uploads/start", startBody);
        String id = started.getString("id");
        try (java.io.InputStream stream = input) {
            byte[] buffer = new byte[2 * 1024 * 1024];
            while (true) {
                int used = 0;
                while (used < buffer.length) {
                    int count = stream.read(buffer, used, buffer.length - used);
                    if (count < 0) break;
                    used += count;
                }
                if (used == 0) break;
                uploadChunk(id, java.util.Arrays.copyOf(buffer, used));
                if (used < buffer.length) break;
            }
        }
        return (JSONObject) request("POST", "/api/uploads/" + id + "/finish", null);
    }

    private void uploadChunk(String id, byte[] bytes) throws Exception {
        RequestBody payload = RequestBody.create(bytes, MediaType.get("application/octet-stream"));
        Request.Builder builder = new Request.Builder().url(baseUrl() + "/api/uploads/" + id + "/chunk").post(payload).header("Accept", "application/json");
        String cookies = cookieHeader();
        if (!cookies.isEmpty()) builder.header("Cookie", cookies);
        try (Response response = http.newCall(builder.build()).execute()) {
            rememberCookies(response.headers("Set-Cookie"));
            String text = response.body() == null ? "" : response.body().string();
            JSONObject result = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            if (!response.isSuccessful()) throw new Exception(result.optString("error", "No se pudo subir una parte del archivo."));
        }
    }

    byte[] mediaBytes(String address, int maximum) throws Exception {
        String target = address.startsWith("/api/media/") ? baseUrl() + address : address;
        if (!target.startsWith("https://")) throw new Exception("Dirección multimedia inválida.");
        try (Response response = http.newCall(new Request.Builder().url(target).get().build()).execute()) {
            if (!response.isSuccessful() || response.body() == null || response.body().contentLength() > maximum) throw new Exception("Contenido no disponible.");
            try (java.io.InputStream stream = response.body().byteStream(); java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
                byte[] buffer = new byte[16384]; int count;
                while ((count = stream.read(buffer)) != -1) {
                    if (output.size() + count > maximum) throw new Exception("Contenido demasiado grande.");
                    output.write(buffer, 0, count);
                }
                return output.toByteArray();
            }
        }
    }

    JSONObject requestGifs(String apiKey, String query) throws Exception {
        HttpUrl url = new HttpUrl.Builder()
                .scheme("https")
                .host("api.giphy.com")
                .addPathSegments(query.isEmpty() ? "v1/gifs/trending" : "v1/gifs/search")
                .addQueryParameter("api_key", apiKey)
                .addQueryParameter("limit", "12")
                .addQueryParameter("rating", "g")
                .build();
        if (!query.isEmpty()) url = url.newBuilder().addQueryParameter("q", query).addQueryParameter("lang", "es").build();
        try (Response response = http.newCall(new Request.Builder().url(url).get().build()).execute()) {
            if (!response.isSuccessful() || response.body() == null) throw new Exception("No se pudo consultar GIPHY.");
            return new JSONObject(response.body().string());
        }
    }

    synchronized void startEvents(EventListener listener) {
        stopEvents();
        int generation = eventGeneration;
        Thread thread = new Thread(() -> streamEvents(listener, generation), "bruma-events");
        thread.setDaemon(true);
        thread.start();
    }

    synchronized void stopEvents() {
        eventGeneration++;
        if (eventConnection != null) eventConnection.disconnect();
        eventConnection = null;
    }

    private void streamEvents(EventListener listener, int generation) {
        int failures = 0;
        while (generation == eventGeneration) {
            HttpURLConnection connection = null;
            try {
                connection = open("/api/events?v=3");
                connection.setRequestProperty("Accept", "text/event-stream");
                connection.setReadTimeout(0);
                eventConnection = connection;
                if (connection.getResponseCode() != 200) throw new Exception("No se pudo abrir el canal de eventos.");
                rememberCookies(connection);
                listener.onConnection(true);
                failures = 0;
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    String event = "message";
                    StringBuilder data = new StringBuilder();
                    while (generation == eventGeneration && (line = reader.readLine()) != null) {
                        if (line.isEmpty()) {
                            if (data.length() > 0) {
                                try { listener.onEvent(event, new JSONTokener(data.toString()).nextValue()); }
                                catch (Exception ignored) { }
                            }
                            event = "message";
                            data.setLength(0);
                        } else if (line.startsWith("event:")) event = line.substring(6).trim();
                        else if (line.startsWith("data:")) {
                            if (data.length() > 0) data.append('\n');
                            data.append(line.substring(5).trim());
                        }
                    }
                }
            } catch (Exception ignored) {
                // La reconexión se hace abajo; la interfaz muestra el estado desconectado.
            } finally {
                if (connection != null) connection.disconnect();
                if (eventConnection == connection) eventConnection = null;
            }
            if (generation != eventGeneration) break;
            listener.onConnection(false);
            try { Thread.sleep(Math.min(1000L * (1L << Math.min(failures++, 4)), 15000L)); }
            catch (InterruptedException ignored) { break; }
        }
    }
}
