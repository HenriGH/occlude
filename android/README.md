# Occlude für Android

Dieser kleine Android-Container lädt denselben Webauftritt unter
`https://occlude.henschau2005.workers.dev/`. Er besitzt sein Android-Fenster selbst:
Die Webseite zeichnet hinter die transparenten Systemleisten, Uhr, Akku und
Gestenleiste bleiben sichtbar. Die Darstellung hängt dadurch nicht von Chromes
PWA-Fenster ab. Voraussetzung: Android 11 oder neuer und aktuelles Android System
WebView. Es gibt keine zusätzlichen Konten oder kostenpflichtigen Dienste.

## Test-APK installieren

1. `artifacts/occlude-android-preview.apk` auf das Pixel kopieren oder herunterladen.
2. Die APK in der Dateien-App öffnen. Falls Android fragt, die Installation für
   diese Quelle erlauben und **Installieren** wählen.
3. Occlude über das neue App-Icon öffnen. Das bisherige Chrome-App-Icon kann
   während des Tests bleiben; es ist eine getrennte Installation.
4. In Occlude unter **Einstellungen → Cloud** mit derselben E-Mail anmelden.
   Den E-Mail-Code **in dieser App** eingeben.

Der Android-Container hat einen eigenen lokalen Speicher. Karten und Login aus
Chrome werden nicht automatisch übernommen. Vorhandene Karten kommen über die
bestehende Synchronisation; Änderungen im bisherigen Browser müssen dafür schon
synchronisiert sein. Die App lädt ihre Oberfläche weiterhin von der Website:
Eine vollständig offline startbare App ist damit noch nicht implementiert.

Dies ist eine mit einem Entwicklungsschlüssel signierte **Test-APK**, keine
Play-Store-Veröffentlichung. Für eine dauerhafte Verteilung einen eigenen
Release-Schlüssel erstellen und sicher aufbewahren. Android verlangt denselben
Schlüssel für APK-Updates; Builds aus verschiedenen Entwicklungsumgebungen können
verschiedene Schlüssel haben. Die bisherige Installation nicht für ein Update
löschen, solange lokale Änderungen noch nicht synchronisiert sind.

## Bauen

In Android Studio den Ordner `android/` öffnen. JDK 21, Android SDK 36 und
Build-Tools 36.0.0 verwenden. Alternativ im Terminal mit eingerichteten
`JAVA_HOME` und `ANDROID_HOME`:

```sh
bash scripts/build-android-preview.sh
```

Vom Repository-Hauptverzeichnis aus erzeugt das Skript die APK und ihren
SHA-256-Prüfwert unter `artifacts/`. APKs, lokale SDK-Pfade und Schlüssel werden
nicht ins Git-Repository aufgenommen. Der Gradle Wrapper prüft seinen Download
gegen einen festgelegten SHA-256-Wert.

Im Codex-Cloud-Workspace:

```sh
python scripts/setup-android-cloud.py
source scripts/android-cloud-env.sh
bash scripts/build-android-preview.sh
```

Das Setup lädt geprüfte JDK-/SDK-Werkzeuge nach `/workspace/.tools`, verwendet
die bereitgestellte Netzwerk-Proxy-Konfiguration und verändert keine
Systempakete. Androids Werkzeuge können zusätzlich ihr festes
`~/.android`-Konfigurationsverzeichnis benötigen. Im Cloud-Workspace verweist es
auf `/workspace/.tools/android-user-home`; vorhandene Konfigurationen nicht
überschreiben und `HOME` nicht umsetzen.

Der Workflow **Android preview** in GitHub Actions baut eine APK und lädt sie
mit Prüfsumme als Workflow-Artefakt hoch. Er führt außerdem Instrumentationstests
mit Android 16, Gestennavigation und hellem Android aus. Ein Workflow im Repository
ist noch kein Nachweis eines erfolgreichen CI-Laufs; dessen Ergebnis separat
prüfen. Für dauerhafte Release-Builds muss die Signierung eigens eingerichtet
werden; der Workflow verwendet bewusst keine privaten Release-Schlüssel.

## Verhalten und Tests

- Android liefert Status-/Navigations-/Ausschnitt-Inset an das bestehende Layout.
  Die Bedienelemente liegen oberhalb des Gestenbereichs; die Glasfläche reicht
  durch diesen hindurch.
- Die native Systemleistenfarbe ist transparent, der zusätzliche
  Navigationsleisten-Kontrasthintergrund deaktiviert. Ein Theme-Wechsel der
  Webseite stellt die System-Icons direkt auf hell beziehungsweise dunkel um.
- Die Tastatur verkleinert die WebView und setzt deren unteren sicheren Inset
  auf null, damit Inhalte und Bedienelemente erreichbar bleiben.
- Bildauswahl nutzt Androids Dateiauswahl ohne pauschale Speicherberechtigung.
  Android-Zurück schließt zuerst Dialog, Editor oder Lernansicht, navigiert aus
  Unterordnern nach oben und legt die App erst auf der Übersicht in den Hintergrund.
- Nur die exakte Occlude-HTTPS-Origin bekommt den nativen Nachrichtenkanal.
  Fremde Links öffnen extern. Es gibt keine allgemeine JavaScript-Native-API,
  keine Freigabe von Dateipfaden und keine abgeschaltete TLS-Prüfung.

```sh
# Kompilierung einschließlich nativer Tests und Android Lint:
cd android
./gradlew :app:assembleDebug :app:lintDebug :app:assembleDebugAndroidTest

# Auf einem gestarteten Android-16-Testemulator mit hellem Systemmodus:
./gradlew connectedDebugAndroidTest
```

`EdgeToEdgeTest` prüft die echten Fenstermaße, sichtbare Systemleisten, Icon-Wechsel
und Pixel eines zusammengesetzten Android-Screenshots im unteren Systembereich.
Die HTML-Testseite kommt aus einer lokalen Fixture; sie sendet keine Auth-Mails
und schreibt keine Cloud-Daten. Ein physischer Pixel-10-Test bleibt zusätzlich
nötig. Die Browserprüfungen in `e2e/android-host.spec.ts` testen das tatsächliche
Document-Start-Skript, Inset-Umrechnung, Theme-Nachrichten und Zurück-Navigation
einschließlich Schutz ungespeicherter Entwürfe. Sie ersetzen keinen Android-Test.
