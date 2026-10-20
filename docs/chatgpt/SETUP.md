# Occlude als öffentliche ChatGPT-App

Die Implementierung ist vorbereitet. Sie ist noch nicht im ChatGPT-App-Verzeichnis
veröffentlicht. Dafür sind die folgenden einmaligen Betreiber-Schritte und die
anschließende Prüfung durch OpenAI nötig. Normale Nutzer müssen später keine SQL-
Dateien ausführen, Dateien importieren oder API-Schlüssel eingeben.

## Gewünschter Ablauf

1. Nutzer verbindet die öffentliche Occlude-App in ChatGPT.
2. Er meldet sich am bestehenden Occlude-Konto an und bestätigt einmal den Zugriff.
3. Er schreibt etwa: „Erstelle mir acht Karten zu Logarithmusregeln und speichere
   sie in Occlude im Ordner Mathematik.“
4. ChatGPT erzeugt Frage/Antwort-Paare und ruft `create_flashcards` auf. ChatGPT kann
   dabei eine Bestätigung verlangen; diese Entscheidung liegt beim ChatGPT-Client.
5. Die Karten sind direkt im Konto gespeichert. Geöffnete, verbundene Occlude-
   Geräte laden sie im Hintergrund; andere Geräte beim nächsten Öffnen. Es gibt
   keinen zusätzlichen Import- oder Bestätigungsschritt in Occlude.

Die API stellt kein Modell bereit. Die Erstellung findet in ChatGPT statt.
Es wird kein OpenAI-API-Key benötigt und keine separate OpenAI-API-Anfrage von
Occlude aus ausgeführt. Verfügbare ChatGPT-Funktionen hängen vom Konto und den
aktuellen Freigaben von OpenAI ab.

## 1. Einmaliges Datenbank-Update

Im bestehenden Supabase-Projekt **SQL Editor → New query** öffnen und den gesamten
Inhalt von `supabase/migrations/202610200001_basic_cards_chatgpt.sql` einmal ausführen.
Die beiden älteren Migrationen müssen bereits angewendet sein und dürfen auf dem
bestehenden Projekt nicht erneut ausgeführt werden.

Das Update ergänzt normale Karten, eine eng begrenzte OAuth-Freigabe und passende
RPCs. Vorhandene Bildkarten und Bewertungen bleiben erhalten. Alte App-Versionen
bekommen weiterhin Bildkarten-Snapshots; aktualisierte Versionen verwenden die
neue Snapshot-Funktion. Fehlt das Update, bleiben neue Textkarten lokal und ihre
Synchronisierung wartet mit einer konkreten Meldung auf die Migration.

## 2. Website aktualisieren

Die Änderung wie bisher über Cloudflare veröffentlichen. `wrangler.jsonc` konfiguriert
statische Assets mit SPA-Routing, damit `/oauth/consent` auch beim direkten Aufruf
in einem neuen Browser funktioniert. Bestehende öffentliche Supabase-Variablen
beibehalten. Für die Web-App ist kein neuer geheimer Schlüssel erforderlich.

## 3. OAuth im Supabase-Dashboard aktivieren

Unter **Authentication → OAuth Server**:

- OAuth-2.1-Server einschalten.
- Authorization Path auf `/oauth/consent` setzen.
- Dynamic Client Registration aktivieren, damit ChatGPT seinen Client registrieren kann.

Unter **Authentication → URL Configuration** bleibt die Site URL:

`https://occlude.henschau2005.workers.dev/`

Die bestehenden, auf diese Domain begrenzten erlaubten Redirect URLs beibehalten.
Die Consent-Seite übernimmt `authorization_id`, meldet den Nutzer per vorhandenem
E-Mail-Code/Link an und lässt Supabase PKCE, Codes, Token-Erneuerung und registrierte
OAuth-Weiterleitungen verwalten. Auch der Anmeldelink erhält das Consent-Ziel.

Die OAuth-Identität verwendet den standardisierten Scope `email`. Dieser Scope
begrenzt bei Supabase **nicht** den Datenbankzugriff. Deshalb sperrt die Migration
OAuth-Clients für die normalen Tabellen, Storage und vollständigen Sync-RPCs.
Nur die ausdrücklich freigegebenen MCP-Funktionen dürfen Ordnernamen lesen und
neue Ordner/Karten anlegen. Ein Widerruf in den Einstellungen sperrt sofort diese
Datenbankfreigabe und widerruft zusätzlich den Supabase-OAuth-Grant.

Supabase empfiehlt asymmetrische JWT-Schlüssel (ES256/RS256); die SDK-Verifikation
prüft sie über JWKS. Bei symmetrischen Schlüsseln verwendet sie den Auth-Server.
Für diese Integration wird kein `openid`-Scope angefragt.

## 4. MCP-Funktion bereitstellen

Auf deinem Ubuntu-Rechner im aktualisierten Repository:

```sh
cd ~/occlude
git pull --ff-only
npm ci
npx supabase login
npx supabase functions deploy occlude-mcp --project-ref kinorxhnmqmwytxjcbbe
```

`supabase login` ist die einmalige Betreiber-Anmeldung für die Bereitstellung.
Zugangsdaten nur im eigenen Terminal beziehungsweise Supabase-Login eingeben.
Keine Admin-Tokens oder Secret Keys in ChatGPT, Git, Vite-Variablen oder die App kopieren.

Die Funktion verwendet die vom Supabase-Laufzeitsystem bereitgestellte Projekt-URL
und den öffentlichen Schlüssel (`SUPABASE_ANON_KEY`, alternativ
`SUPABASE_PUBLISHABLE_KEY`). Der vorhandene Service-Role-Key wird **nicht** verwendet.
`OCCLUDE_APP_URL` kann als Funktionsvariable gesetzt werden, wenn sich die Website-
Adresse ändert. Der Standard ist die oben genannte veröffentlichte Adresse.

`verify_jwt = false` in `supabase/config.toml` ist beabsichtigt: Die öffentliche OAuth-
Discovery muss erreichbar sein. Der Handler verifiziert jeden tatsächlichen MCP-
Zugriff selbst, verlangt ein OAuth-Client-Token und lässt alle Datenoperationen
zusätzlich von der Datenbank autorisieren. Bloßes Dekodieren eines JWT genügt nicht.

Öffentlicher MCP-Endpunkt:

`https://kinorxhnmqmwytxjcbbe.supabase.co/functions/v1/occlude-mcp/mcp`

Protected Resource Metadata:

`https://kinorxhnmqmwytxjcbbe.supabase.co/functions/v1/occlude-mcp/.well-known/oauth-protected-resource`

OAuth-Issuer:

`https://kinorxhnmqmwytxjcbbe.supabase.co/auth/v1`

Die Funktion ist ein zustandsloser Streamable-HTTP-MCP-Server mit dem offiziellen
MCP-SDK. JSON-Antworten reichen aus; ein dauerhaft laufender eigener Server ist
nicht erforderlich. Die Funktion fällt unter die normalen Supabase-Kontingente.

## 5. Öffentliche Einreichung bei OpenAI

`SUBMISSION.md` enthält Beschreibung, Tool-Verhalten, Testschritte und den Stand
der Veröffentlichung. Betreibername und Supportadresse sowie geprüfte öffentliche
Datenschutz-/Nutzungsbedingungen müssen vor der Einreichung ergänzt werden.
`PRIVACY-DRAFT.md` ist dafür eine sachliche Grundlage und kein bereits
veröffentlichter oder rechtlich freigegebener Text.

Eine öffentliche App wird im OpenAI-Entwicklerbereich eingereicht und erst nach
Freigabe im Verzeichnis verfügbar. Die Umsetzung im Repository und ein Git-Push
ersetzen weder die Supabase-Bereitstellung noch die OpenAI-Prüfung. Zum Test vor
Freigabe kann die vorbereitete App im ChatGPT-Entwicklermodus eingebunden werden.
Es wird dadurch noch keine öffentliche App veröffentlicht.

## 6. Abnahme vor Einreichung

- Konto A verbinden und „Erstelle und speichere drei Logarithmus-Karten“ anfordern.
- Prüfen, dass sie in Occlude ohne Import erscheinen und direkt lernbar sind.
- Dieselbe Erstellung bei einem Netzwerkfehler mit derselben `request_id` wiederholen:
  gleiche IDs, keine zusätzlichen Karten.
- Auf einem zweiten verbundenen Gerät prüfen; dann eine Karte bearbeiten und lernen.
- Mit Konto B prüfen: keine Ordner oder Karten von A sichtbar.
- Unter **Einstellungen → ChatGPT** trennen; weitere Tool-Aufrufe müssen abgewiesen
  werden, auch solange ein vorheriges Access Token noch nicht abgelaufen ist.
- Neu verbinden, Cloud-Seite neu laden und einen zweiten Auftrag ausführen.

Lokal geprüft werden diese Abläufe mit echten PostgreSQL-RPCs und getrennten
Geräte-Datenbanken sowie Browser-Fixtures. Eine erfolgreiche OpenAI-Verzeichnis-
Freigabe oder ein tatsächlich ausgeführter Hosted-ChatGPT-Aufruf wird damit nicht
behauptet. Dieser Cloud-Container hat keine Supabase-Admin-Anmeldung und konnte
die gehostete Website/das Projekt wegen einer Proxy-Sperre nicht direkt aufrufen.

## Entwicklungsprüfungen

### Fehler bei der Verbindung

- **„Requested path is invalid“:** Die Site URL muss vollständig mit `https://`
  beginnen. In **Authentication → URL Configuration** gehört
  `https://occlude.henschau2005.workers.dev` hinein; der Authorization Path bleibt
  `/oauth/consent`. Nach dem Speichern die Verbindung in ChatGPT neu starten.
- **Leere Antwort mit HTTP 204 bei `occlude_authorize_chatgpt`:** Das ist die
  erfolgreiche Antwort der Freigabe-Funktion. Ältere Frontend-Versionen behandeln
  sie in Chrome wegen eines Fehlers im Netzwerk-Wrapper als fehlgeschlagen.
  Die aktuelle Website-Version veröffentlichen und die Verbindung neu starten.
  Dafür keine Migration erneut ausführen und keine OAuth-Endpunkte ändern.
- Die aktualisierte Consent-Seite zeigt bei tatsächlichen Fehlern einen HTTP-
  beziehungsweise Netzwerkcode direkt an. Dieser Code genügt für die erste
  Diagnose; geheime Schlüssel, Authorization-Headers und Anmeldelinks sind unnötig.

### Befehle

```sh
npm run build
TZ=Europe/Berlin npm test -- --maxWorkers=2
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
DENO_DIR=/tmp/occlude-deno-cache npm exec --yes --package=deno@2.9.6 -- deno check --config supabase/functions/occlude-mcp/deno.json supabase/functions/occlude-mcp/index.ts
DENO_DIR=/tmp/occlude-deno-cache npm exec --yes --package=deno@2.9.6 -- deno run --config supabase/functions/occlude-mcp/deno.json scripts/check-mcp-runtime.ts
```

Der letzte Befehl nutzt ausschließlich eine lokale Protokoll-Fixture; er erzeugt
keine echten Karten in Supabase und ruft keine OpenAI-API auf.

Offizielle Grundlagen, geprüft anhand des offiziellen Beispiel-Repositorys und der
Supabase-Dokumentationsquellen am 20.10.2026:

- https://github.com/openai/openai-apps-sdk-examples
- https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
- https://supabase.com/docs/guides/auth/oauth-server/getting-started
- https://supabase.com/docs/guides/auth/oauth-server/token-security
