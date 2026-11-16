package com.dsh.deepchat;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.provider.MediaStore;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/index.html";
    private static final int REQ_PICK = 2001;
    private static final int REQ_PERM = 2002;

    private WebView web;
    private ValueCallback<Uri[]> pendingFiles;
    private final Map<String, String> mime = new HashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        mime.put("html", "text/html");
        mime.put("css", "text/css");
        mime.put("js", "application/javascript");
        mime.put("json", "application/json");
        mime.put("svg", "image/svg+xml");
        mime.put("png", "image/png");
        mime.put("jpg", "image/jpeg");
        mime.put("webp", "image/webp");
        mime.put("woff", "font/woff");
        mime.put("woff2", "font/woff2");
        mime.put("ttf", "font/ttf");

        getWindow().setStatusBarColor(Color.parseColor("#0F1115"));
        getWindow().setNavigationBarColor(Color.parseColor("#0F1115"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0F1115"));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        try {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        } catch (Throwable ignored) {
        }
        s.setUserAgentString(s.getUserAgentString() + " DeepChat/1.0");

        web.addJavascriptInterface(new Bridge(), "App");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        setContentView(web);
        web.loadUrl(START_URL);
    }

    /* ---------- 页面资源 ---------- */
    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (u == null || !HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null) path = "/";
            if (path.startsWith("/assets/")) path = path.substring("/assets/".length());
            else if (path.equals("/")) path = "index.html";
            else if (path.startsWith("/")) path = path.substring(1);
            try {
                InputStream in = getAssets().open("www/" + path);
                return new WebResourceResponse(mimeOf(path), "utf-8", in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8",
                        new ByteArrayInputStream("404".getBytes()));
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (u == null) return true;
            if (HOST.equals(u.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (Exception ignored) {
            }
            return true;
        }
    }

    /* ---------- 相册选择 ---------- */
    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;

            String perm = Build.VERSION.SDK_INT >= 33
                    ? Manifest.permission.READ_MEDIA_IMAGES
                    : Manifest.permission.READ_EXTERNAL_STORAGE;
            if (checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{perm}, REQ_PERM);
            } else {
                openPicker();
            }
            return true;
        }
    }

    private void openPicker() {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("image/*");
        try {
            startActivityForResult(Intent.createChooser(i, "选择图片"), REQ_PICK);
        } catch (Exception e) {
            if (pendingFiles != null) {
                pendingFiles.onReceiveValue(null);
                pendingFiles = null;
            }
            Toast.makeText(this, "没有可用的相册应用", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_PERM) {
            // 允许与否都继续：系统选择器（SAF）本身不需要存储权限
            openPicker();
            return;
        }
        super.onRequestPermissionsResult(code, perms, results);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_PICK) {
            Uri uri = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
            if (pendingFiles != null) {
                pendingFiles.onReceiveValue(uri == null ? null : new Uri[]{uri});
                pendingFiles = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /* ---------- 桥接 ---------- */
    private class Bridge {
        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("deepchat", text));
                    Toast.makeText(MainActivity.this, "已复制", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public String saveText(String name, String text) {
            try {
                byte[] bytes = text.getBytes("UTF-8");
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    cv.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                    cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return "ERR:insert failed";
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os == null) return "ERR:no stream";
                    os.write(bytes);
                    os.flush();
                    os.close();
                    return uri.toString();
                }
                File dir = getExternalFilesDir(null);
                if (dir == null) return "ERR:no dir";
                File f = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(f);
                fos.write(bytes);
                fos.close();
                return f.getAbsolutePath();
            } catch (Exception e) {
                return "ERR:" + e.getMessage();
            }
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }
    }

    private String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        String ext = path.substring(dot + 1).toLowerCase(Locale.US);
        String m = mime.get(ext);
        return m == null ? "application/octet-stream" : m;
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(window.__onBack && window.__onBack()) ? '1' : '0'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (!"\"1\"".equals(v)) moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
