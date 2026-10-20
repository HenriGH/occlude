# Öffentliche ChatGPT-App: Einreichungsentwurf

Status: Implementiert und lokal testbar; noch nicht öffentlich eingereicht/freigegeben.
Die Produktionsbereitstellung und ein tatsächlicher ChatGPT-Test sind vor Einreichung
zu bestätigen. Dieses Dokument ist kein automatisch registrierendes App-Manifest.

| Feld | Vorgeschlagener Inhalt |
| --- | --- |
| Name | Occlude |
| Kurzbeschreibung | Erstelle Lernkarten in ChatGPT und lerne sie mit Occlude auf deinen Geräten. |
| Website | https://occlude.henschau2005.workers.dev/ |
| Icon | https://occlude.henschau2005.workers.dev/icons/icon-512.png |
| MCP-URL | https://kinorxhnmqmwytxjcbbe.supabase.co/functions/v1/occlude-mcp/mcp |
| Authentifizierung | OAuth 2.1 mit Supabase, Scope `email`, PKCE und einmaliger expliziter Occlude-Freigabe |
| Betreiber | Vom Betreiber zu ergänzen, noch nicht angegeben |
| Support | Öffentliche Adresse vom Betreiber zu ergänzen |
| Datenschutz-URL | Nach Prüfung und Veröffentlichung der Datenschutzhinweise ergänzen |
| Nutzungsbedingungen-URL | Nach Prüfung und Veröffentlichung ergänzen |

## Beschreibung

Occlude hilft dir, Wissen mit Karteikarten zu wiederholen. Bitte ChatGPT, klare
Frage-Antwort-Karten zu einem Thema zu erstellen und in deinem Occlude-Konto zu
speichern. Du kannst einen bestehenden Ordner wählen oder einen neuen erstellen.
Die Karten erscheinen automatisch auf deinen verbundenen Geräten und verwenden
dieselbe Lernplanung und tägliche Streak wie selbst erstellte Karten. Mathematische
Formeln werden unterstützt. In Occlude kannst du zusätzlich Bildkarten mit
verdeckten Bereichen sowie normale Karten selbst erstellen und bearbeiten.

## Beispielanfragen

- Erstelle acht Karten zu den Logarithmusregeln und speichere sie in Occlude im Ordner Mathematik.
- Zeige mir meine Occlude-Ordner und speichere fünf Frage-Antwort-Karten zu Enzymkinetik im passenden Ordner.
- Erstelle drei Karten zum Basiswechsel bei Logarithmen, jeweils mit Voraussetzungen und einem Rechenbeispiel, und speichere sie in Occlude.

## Fähigkeiten und Grenzen

- `list_folders` liest ausschließlich Namen, IDs und Hierarchie der eigenen Ordner.
- `create_flashcards` erstellt bis zu 50 neue Karten pro Aufruf. Neue Ordner sind möglich.
- Schreibendes Tool: `readOnlyHint=false`, `destructiveHint=false`, `idempotentHint=true`.
- Keine Möglichkeit, vorhandene Karten, Bilder, Antworten oder Lernverläufe zu lesen,
  zu verändern oder zu löschen. Kein Zugriff auf andere Konten.
- Karten werden erst nach erfolgreichem Datenbank-Commit als gespeichert gemeldet.
- Wiederholungen nutzen dieselbe Anfrage-ID; kein doppelter Import.
- Keine externen Modell-API-Aufrufe, kein API-Key des Nutzers und kein Copy/Paste-Import.
- ChatGPT kann Schreibbestätigungen verlangen. Occlude versucht nicht, diese zu umgehen.
- Kein notwendiges ChatGPT-Widget: Rückmeldung erfolgt als strukturierte Tool-Antwort.

## Prüfanleitung

Die produktiven Schritte stehen in SETUP.md. Für die Review-Anmeldung muss der
Betreiber einen von OpenAI akzeptierten Testzugang beziehungsweise einen geeigneten
Anmeldeablauf bereitstellen. Der aktuelle Login verwendet E-Mail-Codes; keine
Testpasswörter, privaten E-Mail-Zugänge oder echten Tokens in dieses Dokument schreiben.

Testziel: Nach Verbindung und einem Auftrag müssen neue Karten ohne weitere
Interaktion in Occlude erscheinen. Dabei Konto-Isolation, Wiederholungsanfragen,
Widerruf und einen zweiten Geräte-Login prüfen. Ein neu erzeugter Testnutzer darf
keine bestehende private Bibliothek eines anderen Nutzers sehen.
