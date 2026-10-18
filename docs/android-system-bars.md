# Android system bars and a continuous bottom surface

The requested third option is **edge-to-edge**, not immersive fullscreen: the
app paints behind the navigation area while the status bar and its clock/battery
remain visible. Native Android apps can control their own window for this. An
installed PWA uses a browser-owned window and depends on that browser's support.

## What this change implements

Occlude already uses `viewport-fit=cover` and a `standalone` manifest. It does not
request HTML fullscreen or switch to a fullscreen manifest. Both appearance
manifests retain the same app ID, scope, start URL and icons.

The previous CSS deliberately stopped the glass surface above
`safe-area-inset-bottom` and filled that part with the page's solid background.
That created a visible material boundary even when the page could paint there.
The separate fill is removed. One glass surface now extends through the whole
bottom inset, with a 2px paint overrun to prevent a fractional-device-pixel seam.
The icons remain padded above the gesture area. Reduced-transparency and
no-backdrop-filter fallbacks use one continuous opaque surface instead.

This fixes the strip **inside the web viewport** and updates immediately with the
app appearance. It cannot paint over an area Android reserves outside that
viewport. Browser mobile emulation does not demonstrate native system-bar behavior.

## Browser support evidence

Chromium development sources inspected on 18 October 2026:

- [EdgeToEdgeUtils](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/android/edge_to_edge/java/src/org/chromium/chrome/browser/ui/edge_to_edge/EdgeToEdgeUtils.java)
  recognizes `viewport-fit=cover` as the page's bottom edge-to-edge opt-in.
- [BaseCustomTabActivity](https://github.com/chromium/chromium/blob/main/chrome/android/java/src/org/chromium/chrome/browser/customtabs/BaseCustomTabActivity.java)
  gates the coordinated installed-app path on `WebAppShortEdgesCutoutMode` and,
  for standalone apps, its `enable_standalone` parameter. Its navigation-bar
  update follows live page theme colors while drawing edge-to-edge.
- [ChromeFeatureList](https://github.com/chromium/chromium/blob/main/chrome/browser/flags/android/java/src/org/chromium/chrome/browser/flags/ChromeFeatureList.java)
  and [native feature defaults](https://github.com/chromium/chromium/blob/main/chrome/browser/flags/android/chrome_feature_list.cc)
  default this coordinated path/standalone parameter to disabled. Browser
  experiments and releases may override defaults. Development source is not
  proof that a particular installed Chrome version has the feature enabled.
- [CustomTabNavigationBarController](https://github.com/chromium/chromium/blob/main/chrome/android/java/src/org/chromium/chrome/browser/customtabs/features/CustomTabNavigationBarController.java)
  uses a transparent navigation bar when the host is drawing edge-to-edge;
  fitted windows use their intent/manifest colors instead.

There is no website API here to enable those browser feature parameters. Adding
an invented manifest field, forcing reloads, or changing the theme-color repeatedly
cannot grant control of the Android window. `unframed` is also not an Android
escape hatch: its [explainer](https://github.com/WICG/manifest-incubations/blob/gh-pages/unframed-explainer.md)
explicitly excludes mobile OSs and ordinary hosted PWAs.

## When a native Android host is needed

If an updated browser still reserves a separate area for an installed PWA,
guaranteed window control requires an Android app host, for example a WebView
shell. AndroidX provides
[WindowCompat.enableEdgeToEdge](https://github.com/androidx/androidx/blob/androidx-main/core/core/src/main/java/androidx/core/view/WindowCompat.java).
Such a host can retain visible status/navigation bars, draw the web content behind
them, pass safe insets to the layout, and update system-icon appearance with the
app theme. It requires an Android build/distribution, rather than a website-only
deployment. The subsequent native implementation is described below.

## Pixel 10 follow-up

The user reports that the updated page is seamless in the mobile browser, but
the strip persists after installation on a Pixel 10 with current Chrome and
Android. Occlude is dark while Android itself is light. This is a user-reported
device result, not a locally reproduced Android test; no exact build numbers or
native window measurements are available.

This distinction is consistent with the separate installed-app window path
described above. The web-viewport fix must not be described as a fix for the
remaining native strip. Another CSS inset, manifest identity change, or reinstall
does not provide the missing native window control. Keep the working browser
layout and visible status bar rather than introducing fullscreen as a workaround.

For reliable control independent of Chrome's installed-app rollout, the next
implementation would be a separately installed Android host. That is a packaging
and distribution change, not another website deployment. It would need to:

- Draw a WebView behind transparent system bars without hiding either bar.
- Supply current status, cutout, navigation and keyboard insets to the web layout.
- Match status/navigation icon appearance to Occlude's selected theme.
- Preserve uploads, Android Back navigation, local storage and account sync.
- Be built and checked on Android, including light Android with dark Occlude.

A separate WebView has its own storage, so it cannot silently inherit the Chrome
installation's local cards or login. Account sync would provide the transfer path.
The user subsequently chose the native-host option. A separate Android project
now lives in [`android/`](../android/README.md). It owns an edge-to-edge WebView,
keeps system bars visible, disables the native navigation contrast scrim, supplies
safe/keyboard insets and follows page appearance through an origin-restricted
AndroidX message channel. It loads the same hosted website and uses a separate
local workspace restored through account sync. This is a separate APK, not a
change to the existing Chrome installation. Build, installation and device-test
instructions are in the Android README; native test execution must be reported
separately from compilation and browser emulation.
