# Kapazität: ein Hetzner-Server mit 4 GB

Gemessen am 29.10.2026 im Entwicklungs-Container (4 Kerne, Node 22, Postgres 16).
Hetzners geteilte vCPUs sind eher langsamer: unten ist mit Faktor 1,5 gerechnet.

## Datenbank

| Was | Gemessen | Hochgerechnet |
| --- | --- | --- |
| Sammlung (Karten) als jsonb pro Konto | 4,3 MB für 2.000 Spieler mit je 400 Printings | ~110 MB bei 50.000 Spielern |
| dieselbe Sammlung als eine Zeile pro Karte (vorher) | 115 MB für 2.000 Spieler | ~2,9 GB bei 50.000 (deshalb umgebaut, Migration 003) |
| Ledger (jede Coin-/Pack-Bewegung) | 11 MB für 100.000 Einträge | ~110 B pro Eintrag |
| Decks | 5,3 MB für 10.000 Decks | ~0,5 KB pro Deck |

Für einige zehntausend registrierte Spieler reicht die Datenbank auf 4 GB RAM gut aus.
Im Cache muss nur liegen, wer gerade spielt. Plattenplatz ist kein Thema (Hetzner hat ab 40 GB).
Postgres ist in `docker-compose.yml` auf 1,2 GB begrenzt und darauf eingestellt.

## Laufende Partien

| Was | Gemessen |
| --- | --- |
| Speicher pro laufender Partie (mitten im Spiel) | ~0,3 MB |
| eine Entscheidung ausführen (Engine) | ~2 ms |
| Ansicht für einen Spieler berechnen und als JSON verpacken | ~1 ms |
| Ansicht pro Update über die Leitung | 27 KB roh, 3,9 KB gzip (WebSocket-Kompression) |
| Computer-Gegner (Normal) pro Entscheidung | ~27 ms (läuft im Browser, nicht auf dem Server) |

Pro Entscheidung kostet eine Online-Partie also rund 4 bis 6 ms CPU.
Gerechnet sind darin die Engine und zwei Ansichten.
Bei Menschen ist das grob eine Entscheidung pro Sekunde und Partie.

- **Speicher:** kein Engpass. 1.000 gleichzeitige Partien brauchen ~300 MB.
- **CPU:** der Engpass. Ein Kern trägt ~150 bis 200 gleichzeitige Partien.
  Node nutzt von sich aus nur einen Kern. Deshalb laufen die Partien in Worker-Threads,
  einer pro Kern, ein Kern bleibt für Web und Datenbank frei.
  - CX22 (2 vCPU, 4 GB): ~150 bis 250 gleichzeitige Partien (300 bis 500 Spieler im Spiel).
  - CPX21 (3 vCPU, 4 GB): ~300 bis 400 gleichzeitige Partien.
- **Netz:** bei 500 Spielern im Spiel ~2 MB/s. Das sind höchstens ~5 TB im Monat bei Dauerlast.
  20 TB sind bei Hetzner inklusive.
- **Partien gegen den Computer und das Tutorial:** laufen ganz im Browser und kosten den Server nichts.

## Wann es nicht mehr reicht

Grob ist ein Zehntel der registrierten Spieler gleichzeitig online, davon etwa die Hälfte im Spiel.
10.000 registrierte Spieler sind also ~250 gleichzeitige Partien. Das ist auf einem 4-GB-Server mit 2 bis 3 vCPU machbar.
Darüber hinaus:

1. **Größerer Hetzner-Server**, z. B. CPX31 mit 4 vCPU und 8 GB.
   Das ist dieselbe `docker-compose.yml`, nur `mem_limit` und die Postgres-Werte hochsetzen.
   Der Umzug dauert Minuten.
2. **Zweiter Server nur für Partien**, mit derselben Datenbank. Der Aufbau lässt das zu:
   Partien liegen im Speicher eines Game-Workers, die Datenbank bekommt nur das Ergebnis und die Aufzeichnung.

Damit ein Neustart keine laufende Partie verliert, wird jede Partie als Liste ihrer Antworten mitgeschrieben.
Die Engine ist deterministisch, so lässt sich die Partie wiederherstellen.
