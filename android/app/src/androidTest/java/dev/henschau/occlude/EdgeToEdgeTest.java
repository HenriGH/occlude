package dev.henschau.occlude;

import static org.junit.Assert.*;

import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.SystemClock;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

@RunWith(AndroidJUnit4.class)
public class EdgeToEdgeTest {
    @Test public void darkPageOnLightAndroidDrawsUnderVisibleSystemBars() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<MainActivity> activity = new AtomicReference<>();
            scenario.onActivity(a -> {
                activity.set(a);
                assertEquals(Configuration.UI_MODE_NIGHT_NO, a.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK);
                // Serve a deterministic fixture locally. No Auth or Supabase calls.
                a.webView.stopLoading();
                a.webView.setWebViewClient(new WebViewClient() {
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        String html = "<!doctype html><html class='dark'><head><meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'>"
                            + "<style>html,body{margin:0;height:100%;background:#123456;color:white}</style></head><body>Edge-to-edge fixture</body></html>";
                        return new WebResourceResponse("text/html", "UTF-8", new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                    }
                });
                a.webView.loadUrl(MainActivity.APP_ORIGIN + "/__native-test__");
            });
            MainActivity a = activity.get();
            await(() -> "true".equals(js(a, "document.documentElement.hasAttribute('data-android-host') && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) > 0")));
            await(() -> "true".equals(js(a, "document.readyState === 'complete' && document.body && getComputedStyle(document.body).backgroundColor === 'rgb(18, 52, 86)'")));
            await(() -> {
                AtomicReference<Boolean> ready = new AtomicReference<>(false);
                scenario.onActivity(current -> {
                    int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    ready.set((current.getWindow().getInsetsController().getSystemBarsAppearance() & mask) == 0);
                });
                return ready.get();
            });
            scenario.onActivity(current -> {
                Rect screen = current.getWindowManager().getCurrentWindowMetrics().getBounds();
                int[] origin = new int[2]; current.webView.getLocationOnScreen(origin);
                assertEquals(0, origin[0]); assertEquals(0, origin[1]);
                assertEquals(screen.width(), current.webView.getWidth());
                assertEquals(screen.height(), current.webView.getHeight());
                WindowInsets insets = current.getWindow().getDecorView().getRootWindowInsets();
                assertTrue(insets.isVisible(WindowInsets.Type.statusBars()));
                assertTrue(insets.isVisible(WindowInsets.Type.navigationBars()));
                assertFalse(current.getWindow().isNavigationBarContrastEnforced());
            });
            // Capture the composed Android screen, including the native navigation area.
            // Sample away from the centered gesture handle and rounded screen corners.
            SystemClock.sleep(300);
            Bitmap screen = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            int bottom = screen.getPixel(screen.getWidth() / 4, screen.getHeight() - 4);
            assertEquals(0x12, Color.red(bottom), 3);
            assertEquals(0x34, Color.green(bottom), 3);
            assertEquals(0x56, Color.blue(bottom), 3);
            screen.recycle();

            js(a, "document.documentElement.classList.remove('dark')");
            await(() -> {
                AtomicReference<Boolean> light = new AtomicReference<>(false);
                scenario.onActivity(current -> {
                    int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    light.set((current.getWindow().getInsetsController().getSystemBarsAppearance() & mask) == mask);
                });
                return light.get();
            });
        }
    }

    @Test public void nativeChannelAllowsOnlyTheExactAppOrigin() {
        assertTrue(MainActivity.isAppUri(Uri.parse(MainActivity.APP_ORIGIN + "/")));
        assertTrue(MainActivity.isAppUri(Uri.parse(MainActivity.APP_ORIGIN + ":443/path")));
        assertFalse(MainActivity.isAppUri(Uri.parse("http://occlude.henschau2005.workers.dev/")));
        assertFalse(MainActivity.isAppUri(Uri.parse(MainActivity.APP_ORIGIN + ".example.test/")));
        assertFalse(MainActivity.isAppUri(Uri.parse(MainActivity.APP_ORIGIN + ":8443/")));
        assertFalse(MainActivity.isAppUri(Uri.parse("https://user@occlude.henschau2005.workers.dev/")));
        assertFalse(MainActivity.isAppUri(Uri.parse("file:///etc/passwd")));
    }

    private static String js(MainActivity activity, String source) {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.webView.evaluateJavascript(source, value -> { result.set(value); latch.countDown(); }));
        try { assertTrue("WebView JavaScript callback timed out", latch.await(5, TimeUnit.SECONDS)); }
        catch (InterruptedException e) { throw new AssertionError(e); }
        return result.get();
    }

    private static void await(BooleanSupplier condition) {
        long until = SystemClock.uptimeMillis() + 10_000;
        while (SystemClock.uptimeMillis() < until) {
            if (condition.getAsBoolean()) return;
            SystemClock.sleep(50);
        }
        fail("Native edge-to-edge state did not become ready");
    }
}
