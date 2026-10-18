package dev.henschau.occlude;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;

public class MainActivity extends ComponentActivity {
    static final String APP_ORIGIN = "https://occlude.henschau2005.workers.dev";
    private static final int PICK_IMAGE = 42;
    FrameLayout root;
    WebView webView;
    private LinearLayout errorPanel;
    private JavaScriptReplyProxy pageChannel;
    private Insets safeInsets = Insets.NONE;
    private ValueCallback<Uri[]> fileResult;
    private boolean dark;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        dark = getPreferences(MODE_PRIVATE).getBoolean("dark", true);
        // These APIs keep the bars visible. No immersive/fullscreen flags are used.
        getWindow().setDecorFitsSystemWindows(false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarDividerColor(Color.TRANSPARENT);
        getWindow().setNavigationBarContrastEnforced(false);
        getWindow().setStatusBarContrastEnforced(false);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        WindowManager.LayoutParams attributes = getWindow().getAttributes();
        attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        getWindow().setAttributes(attributes);

        root = new FrameLayout(this);
        setContentView(root);
        applyAppearance(dark);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            int keyboard = insets.isVisible(WindowInsets.Type.ime()) ? insets.getInsets(WindowInsets.Type.ime()).bottom : 0;
            safeInsets = Insets.of(bars.left, bars.top, bars.right, keyboard > 0 ? 0 : bars.bottom);
            if (webView != null) {
                FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) webView.getLayoutParams();
                if (layout.bottomMargin != keyboard) { layout.bottomMargin = keyboard; webView.setLayoutParams(layout); }
            }
            if (errorPanel != null) errorPanel.setPadding(bars.left + dp(24), bars.top + dp(24), bars.right + dp(24), Math.max(bars.bottom, keyboard) + dp(24));
            sendInsets();
            // The host supplies CSS insets explicitly, avoiding a second WebView inset.
            return WindowInsets.CONSUMED;
        });
        createWebView();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { handleBack(); }
        });
        root.requestApplyInsets();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        webView.setBackgroundColor(background());
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileResult != null) fileResult.onReceiveValue(null);
                fileResult = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/png", "image/jpeg", "image/webp"});
                try { startActivityForResult(intent, PICK_IMAGE); }
                catch (ActivityNotFoundException e) { fileResult.onReceiveValue(null); fileResult = null; }
                return true;
            }
            @Override public boolean onJsBeforeUnload(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage("Ungespeicherte Änderungen verwerfen?")
                    .setPositiveButton("Verwerfen", (dialog, which) -> result.confirm())
                    .setNegativeButton("Bleiben", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isAppUri(request.getUrl())) return false;
                if (request.isForMainFrame()) openExternal(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                pageChannel = null;
                if (errorPanel != null) errorPanel.setVisibility(View.GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("Occlude konnte nicht geladen werden. Prüfe deine Internetverbindung.", true);
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showError("Occlude ist gerade nicht erreichbar. Versuche es erneut.", true);
            }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                pageChannel = null;
                root.removeView(view);
                view.destroy();
                webView = null;
                showError("Occlude muss neu geöffnet werden. Deine gespeicherten Karten bleiben erhalten.", true);
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "OccludeHost", Set.of(APP_ORIGIN), (view, message, origin, mainFrame, reply) -> {
                if (!mainFrame || !isAppUri(origin)) return;
                try {
                    JSONObject data = new JSONObject(message.getData());
                    if ("ready".equals(data.optString("type"))) {
                        pageChannel = reply;
                        if (errorPanel != null) errorPanel.setVisibility(View.GONE);
                        sendInsets();
                    }
                    if ("appearance".equals(data.optString("type")) && data.opt("dark") instanceof Boolean) applyAppearance(data.getBoolean("dark"));
                } catch (JSONException ignored) { /* Ignore malformed messages without granting native capabilities. */ }
            });
        } else {
            showError("Bitte aktualisiere Android System WebView im Play Store und öffne Occlude erneut.", false);
            return;
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try { WebViewCompat.addDocumentStartJavaScript(webView, readHostScript(), Set.of(APP_ORIGIN)); }
            catch (IOException e) { showError("Die App-Installation ist unvollständig. Bitte installiere Occlude erneut.", false); return; }
        } else {
            showError("Bitte aktualisiere Android System WebView im Play Store und öffne Occlude erneut.", false);
            return;
        }
        webView.loadUrl(APP_ORIGIN + "/");
    }

    static boolean isAppUri(Uri uri) {
        return "https".equals(uri.getScheme()) && Uri.parse(APP_ORIGIN).getHost().equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme) && !"mailto".equals(scheme)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException ignored) { /* An external handler may not be installed. */ }
    }

    private void applyAppearance(boolean useDark) {
        dark = useDark;
        getPreferences(MODE_PRIVATE).edit().putBoolean("dark", dark).apply();
        if (root != null) root.setBackgroundColor(background());
        if (webView != null) webView.setBackgroundColor(background());
        WindowInsetsController controller = getWindow().getInsetsController();
        if (controller != null) {
            int lightIcons = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            controller.setSystemBarsAppearance(dark ? 0 : lightIcons, lightIcons);
            controller.show(WindowInsets.Type.systemBars());
        }
    }

    private void sendInsets() {
        if (pageChannel == null || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        pageChannel.postMessage("{\"type\":\"insets\",\"insets\":{\"top\":" + safeInsets.top
            + ",\"right\":" + safeInsets.right + ",\"bottom\":" + safeInsets.bottom + ",\"left\":" + safeInsets.left + "}}");
    }

    private void handleBack() {
        if (webView == null || pageChannel == null) { moveTaskToBack(true); return; }
        webView.evaluateJavascript("window.dispatchEvent(new Event('occlude-android-back', {cancelable: true}))", unhandled -> {
            if (!"true".equals(unhandled)) return;
            if (webView != null && webView.canGoBack()) webView.goBack();
            else moveTaskToBack(true);
        });
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_IMAGE || fileResult == null) return;
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        fileResult.onReceiveValue(uri != null && "content".equals(uri.getScheme()) ? new Uri[]{uri} : null);
        fileResult = null;
    }

    private void showError(String message, boolean retry) {
        if (errorPanel != null) root.removeView(errorPanel);
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(24) + safeInsets.left, dp(24) + safeInsets.top, dp(24) + safeInsets.right, dp(24) + safeInsets.bottom);
        errorPanel.setBackgroundColor(background());
        TextView text = new TextView(this);
        text.setText(message); text.setTextSize(17); text.setTextColor(dark ? Color.WHITE : Color.BLACK); text.setGravity(Gravity.CENTER);
        errorPanel.addView(text);
        if (retry) {
            Button button = new Button(this); button.setText(R.string.retry);
            button.setOnClickListener(view -> {
                errorPanel.setVisibility(View.GONE);
                if (webView == null) { createWebView(); root.requestApplyInsets(); } else webView.reload();
            });
            errorPanel.addView(button);
        }
        root.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
    }

    private String readHostScript() throws IOException {
        try (InputStream stream = getAssets().open("host.js"); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
            return bytes.toString(StandardCharsets.UTF_8.name());
        }
    }

    private int background() { return dark ? Color.BLACK : Color.rgb(245, 245, 247); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override protected void onDestroy() {
        if (fileResult != null) { fileResult.onReceiveValue(null); fileResult = null; }
        pageChannel = null;
        if (webView != null) { root.removeView(webView); webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
