# Bohrpfahl-Verwaltung

Eigenständige Webseite zur Verwaltung von Bohrpfählen: Excel-Import der vorgeplanten Pfähle, Karte mit Ausführungsstand, Erfassung der Ausführung und Bohrprotokoll-Export.
**Benutzen:** `Bohrpfahl-Verwaltung.html` per Doppelklick im Browser öffnen (Chrome/Edge empfohlen). Kein Server, keine Installation.

## Login und Datenschutz
- Beim ersten Start Benutzername und Passwort festlegen (mind. 8 Zeichen).
- Die Daten werden mit dem Passwort verschlüsselt (PBKDF2 + AES-256-GCM) im Browser dieses Geräts gespeichert.
- Automatische Sperre nach 30 Minuten Inaktivität, manuell über „Sperren“.
- **Passwort vergessen = Daten nicht wiederherstellbar.** Deshalb regelmäßig „Mehr → Sicherung speichern“ (verschlüsselte Datei, nur mit dem Passwort lesbar).
- Die Daten liegen nur auf dem Gerät/Browser, auf dem die Datei geöffnet wurde. Für ein anderes Gerät: Sicherung speichern und dort „Sicherung laden“.
- Die Datei nicht an einen anderen Ort verschieben (Firefox speichert pro Dateipfad), oder vorher eine Sicherung anlegen.

## Benutzer und Rollen
Der erste Benutzer ist **Administrator**. Er legt unter „Benutzer“ weitere Benutzer an (Rolle **Borist** oder Administrator), setzt Passwörter zurück und ändert Rollen. Jeder Benutzer hat ein eigenes Passwort; alle Daten bleiben mit einem gemeinsamen Datenschlüssel verschlüsselt, den jeweils nur das eigene Passwort öffnet. Ein bisheriger Einzelbenutzer wird beim ersten Login automatisch zum Administrator.

| | Administrator | Borist |
|---|---|---|
| Excel-Import, Projektdaten, Sicherung laden, Benutzer | ja | nein |
| Planwerte (Soll), Stammdaten, Koordinaten ändern | ja | nein |
| Ist-Werte, Bodenaufschluss, Grundwasser, Wasserauflast, Abstichmaß, Betonverbrauch IST, Ausführungszeiten, Bemerkung | ja | **ja** |
| Grafische Übersicht, Karte, Protokolle (PDF), CSV | ja | ja |
| Importierte / vom Administrator angelegte Pfähle löschen oder kopieren | ja | **nein** |
| Neue eigene Pfähle anlegen (dann voll bearbeit-, kopier- und löschbar) | ja | ja |
| Pfähle als geprüft markieren | ja | nein |
| Geprüfte Pfähle ändern | ja | **nein** (gesperrt) |

Die Rechte werden beim Speichern auch auf Datenebene durchgesetzt. Sie steuern die Bedienung, sind aber **kein Schutz gegen technisch versierte Nutzer mit Zugriff auf dasselbe Gerät**.

**Verschiedene Geräte:** Der Administrator gibt dem Borist eine Sicherung („Mehr → Sicherung speichern“); der Borist meldet sich dort mit seinem Benutzer an. Nach der Arbeit speichert er „Rückmeldung an Administrator“ (nur seine geänderten Pfähle, verschlüsselt). Der Administrator lädt sie über „Eintragungen vom Borist einlesen“: Änderungen werden übernommen, sofern der Pfahl noch nicht geprüft ist und die Daten des Borist neuer sind.

**Borist – Sicht und Pflichtfelder:** Der Borist sieht nur die Reiter **Pfähle** und **Karte** (plus „Rückmeldung senden“ oben rechts); er hat kein „Mein Konto“ – Passwörter vergibt und ändert ausschließlich der Administrator in der Benutzerverwaltung. Im Pfahlformular sind für ihn diese Felder **Pflicht** und gelb markiert, solange sie leer sind: Ist-Höhen und -Längen, Verbrauch IST, Bohrgerät, jede Schicht des Bodenaufschlusses (Tiefe und Bodenart) sowie Datum/von/bis bei Bohren, Betonieren und – bei bewehrten Pfählen – Bewehren. „Speichern“ ist erst möglich, wenn alle ausgefüllt sind (Zähler am Button).

**Fotos:** Bei „Bemerkung“ lassen sich bis zu 8 Fotos je Pfahl anhängen (verkleinert auf max. 1280 px, JPEG). Im PDF-Export („mit Fotos“) folgt auf das Protokoll eine eigene Seite mit Logo, Baustelle, Ort, Pfahl-Nr. und den Fotos; „ohne Fotos“ lässt diese Seiten weg. Der Browser-Speicher ist auf ca. 5 MB begrenzt – die Anwendung verweigert weitere Fotos, wenn er fast voll ist.

## Ablauf
1. **Projektdaten** eintragen (Baustelle Nr., Baustelle, Ort, Höhenbezug, optional Logo).
2. **Import** der Pfahlaufteilung aus Excel: alle vorgeplanten Pfähle werden mit Nummer, Maßen, Koordinaten und Planhöhen (SOLL) angelegt und erscheinen auf der **Karte als „Noch offen“**.
3. Bei der **Ausführung** ergänzt der Borist pro Pfahl Ist-Werte, Bodenaufschluss, Grundwasser und Ausführungszeiten (mit der **grafischen Übersicht** als Kontrolle). Der Ausführungsstand auf der Karte ändert sich automatisch.
4. Der Administrator **prüft** die ausgeführten Pfähle und markiert sie als geprüft (Häkchen in der Tabelle, im Pfahlformular oder im Karten-Popup,). Geprüfte Pfähle erscheinen **violett** auf der Karte und sind für den Borist gesperrt.
5. **Bohrprotokolle** als PDF ausgeben (einzeln oder alle).

## Auswertung
Reiter „Auswertung“ (für alle Benutzer): Stückzahl, Bohrlänge, Pfahllänge, Leerbohrung, Bohren im GW, Beton IST/SOLL und Bohrzeit **je Tag, Woche (Kalenderwoche) oder Monat**, als Kennzahlen, Diagramm (Kennzahl wählbar) und Tabelle mit Summe.
- **Zuordnung:** nach Bohrdatum (erste Bohren-Zeile) oder Betondatum (Betonieren). Pfähle ohne Zeiten sind nicht enthalten.
- Filter: Zeitraum von/bis und Bohrgerät. Eine zweite Tabelle zeigt die Auswertung **je Bohrgerät**.
- Längen sind Ist-Werte; fehlt der Ist-Wert, wird der Soll-Wert genommen (der Hinweis unter der Auswertung zählt das mit). Betonverbrauch ist der erfasste „Verbrauch IST“.
- „Auswertung als CSV“ exportiert die Tabelle.

## Bohrgeräte
Der Administrator legt unter „Projektdaten“ die Bohrgeräte an (Gerätetyp, Inventarnummer, Kommentar). Im Pfahlformular (ganz oben, neben „Typ / Verfahren“) wählt der Borist das Gerät. Typ und Inventarnummer stehen im Bohrprotokoll unter „Abstichmaß Überbeton“ („Bohrgerät: …“) und in der CSV; ein später gelöschtes Gerät bleibt am Pfahl erhalten.

## Grafische Übersicht
Im Pfahlformular (rechts neben den Feldern, auf dem Handy oben) zeigt ein Schnitt live: Arbeitsebene, Pfahl-OK und -UK als Soll (gestrichelt) und Ist (gefüllt), das Bodenaufschluss-Profil mit Schichten (Boden / Bohrhindernis / harte Bodenschicht), das Grundwasser und „Bohren im GW“ als Markierung am Pfahl. Beschriftungen zeigen S = Soll und I = Ist.
Die Grafik wandert beim Scrollen im Formular mit. Sie zeigt die Bodenarten mit **Farbe und Zeichen** (Schraffur) wie in der Vorlage und eine Legende der verwendeten Bodenarten.

**Bodenaufschluss:** Er beginnt bei **0,00 = Arbeitsebene** und endet bei der **Pfahl-Unterkante**. Die letzte Tiefe wird automatisch aus der Bohrlänge übernommen (Ist, sonst Soll) und folgt Änderungen, bis Sie sie überschreiben. Dazwischen tragen Sie die Schichten ein („+ Schicht“ fügt vor der letzten Zeile ein): Tiefe der Unterkante und Bodenart aus der Liste (Hauptanteile lt. Vorlage: Blöcke, Steine, Kies, Sand, Schluff, Ton, organischer Boden, Faulschlamm, Torf, Humus, Mutterboden, Anschüttung, Löß, Lößlehm, Kohle). Untervarianten (gerundet/kantig, Grob-/Mittel-/Fein-) und Nebenanteile werden nicht verwendet. Zusätzlich gibt es die Arten „Bohrhindernis“ und „harte Bodenschicht“ mit Hinweistext (z. B. „Holz“).

## Aussehen
Farben und Logo stammen von [kellergrundbau.at](https://www.kellergrundbau.at/): Marineblau `#003366`, Dunkelblau `#011343`, Gelb `#FDC600` für Hauptbuttons, Hellgrau `#EDF1F4`. Navigation: Titel mit Symbol und Anzahl, rechts „CSV-Export“, „PDF-Export“, „Abmelden“; darunter die Reiter Pfähle, Karte, Auswertung und (nur Administrator) das Menü „Verwaltung“ mit Projektdaten, Import, Benutzer und Passwörtern, Sicherung und Mein Konto. Im Bohrprotokoll erscheint das Keller-Logo, sofern unter „Projektdaten“ kein eigenes Logo hinterlegt ist.

## Import aus Excel („Import“)
Die Datei wird so gelesen, wie die Pfahlaufteilung aufgebaut ist: Überschriftenzeile, darunter eine **Einheitenzeile** (`[cm]`, `[m]`, `[müA]`), dann ein Pfahl je Zeile. Die Einheitenzeile wird nicht als Pfahl gelesen.
- Die Spalten werden anhand der Überschriften zugeordnet (Pfahl-Nr., Pfahl Ø, Pfahllänge, Y-/X-Koordinate, Pfahl UK/OK, Arbeitsebene, Pfahlart, Neigung, Bew Typ, lt. Plan Nr., Bewehrung [kg], Betongüte, Konsistenz). Die Zuordnung lässt sich in der Vorschau per Auswahlliste ändern. Ist die Neigung nicht angegeben, wird sie automatisch mit 0° angelegt.
- Höhen/Längen ohne Zusatz gelten als **Planwerte (SOLL)**; mit „Ist“ in der Überschrift als IST. Bohrlänge, Pfahllänge und Leerbohrung werden berechnet, wenn sie fehlen.
- **Koordinaten:** Das Koordinatensystem wird aus den Werten erkannt (z. B. MGI GK West) und lässt sich ändern. Y = Rechtswert, X = Hochwert bei Landesvermessung. Eine Kontrollzeile zeigt, wo der erste Punkt liegt.
- Pfähle mit vorhandener Pfahl-Nr. werden übersprungen oder aktualisiert (nur Spalten mit Inhalt werden überschrieben).
- Nach dem Import wechselt die Ansicht auf die Karte.
- Im Import-Dialog gibt es eine **Excel-Vorlage** im selben Aufbau.
- Kleine Vereinheitlichungen beim Import: „Block00“ → „Block 00“, „C25-30“ → „C25/30“, Ø in mm → cm (wenn „mm“ dabei steht).

## Karte
Reiter „Karte“ über der Tabelle. Zeigt die Pfähle der aktuellen Auswahl (Suche/Typ-Filter gelten auch hier), eingefärbt nach **Ausführungsstand**, der aus den Ausführungszeiten folgt:
**rot** = noch nicht ausgeführt (keine Zeiten), **orange** = in Ausführung (irgendeine Zeit erfasst), **grün** = ausgeführt (Betonieren mit Ende erfasst), **blau** = durch Bauleitung geprüft. Die Zahl bei „Ausgeführt“ zählt geprüfte Pfähle mit, sie springt beim Prüfen also nicht auf 0. Ein Filter „Alle Stände“ in der Werkzeugleiste wirkt auf Tabelle und Karte.
Klick auf einen Pfahl öffnet ein Popup mit „Bearbeiten“ und „Protokoll“. Pfahlnummern erscheinen bei starkem Zoom. In der Tabelle zeigt das Karten-Symbol einen Pfahl direkt auf der Karte.
- **Hintergrund:** OpenStreetMap (mit automatischem Ausweichen auf OpenStreetMap Deutschland/basemap.at, falls ein Server nicht erreichbar ist), basemap.at Karte, Luftbild von basemap.at (nur Österreich) oder ohne Hintergrund (offline). Für die Hintergründe wird der Kartenausschnitt aus dem Internet abgefragt, Pfahldaten werden nicht übertragen.
- **Koordinatensysteme** (Projektdaten): WGS84, ETRS89/UTM 32N/33N, MGI Österreich (GK West/Central/East, M28/M31/M34, Lambert), Gauß-Krüger Zone 2–4, CH1903+/LV95. Gespeichert werden die Werte unverändert, umgerechnet wird nur für die Karte (proj4, Genauigkeit für MGI etwa 1–2 m).

## Erfasste Felder je Pfahl (wie im Bohrprotokoll V02)
- **Pfahl:** Pfahl-Nr., Pfahlart, Pfahl-Ø [cm], Typ/Verfahren, Neigung [°], Wasserauflast
- **Lage:** Rechtswert/Ost, Hochwert/Nord
- **Höhen und Längen:** Arbeitsebene, Pfahl-OK, Pfahl-UK, Bohrlänge, Pfahllänge, Leerbohrung – jeweils **Soll (Plan)** und **Ist (ausgeführt)**; „Soll übernehmen“ kopiert die Planhöhen in die Ist-Spalte. Dazu Grundwasser ab [m unter Bohrebene], Bohren im GW, Abstichmaß Überbeton [m ab AE]
- **Schichtenfolge:** Tiefe der Unterkante, Bodenart und Art (Boden / Bohrhindernis / harte Bodenschicht mit Hinweistext)
- **Pfahlbewehrung:** Bew. Typ, lt. Plan Nr., Masse [kg]
- **Pfahlbeton:** Betongüte, Konsistenz, Verbrauch SOLL (berechnet) / IST
- **Ausführungszeiten:** Bohren (2 Zeilen), Bohrhindernis (2), harte Bodenschicht (2), Bewehren, Betonieren – je Datum, von, bis („Jetzt“-Knopf)
- **Bemerkung**

Automatisch berechnet (überschreibbar, Feld leeren = wieder automatisch): Bohrlänge = Arbeitsebene − UK, Pfahllänge = OK − UK, Leerbohrung = Arbeitsebene − OK (je Soll und Ist), Bohren im GW = Bohrlänge − Grundwasser ab, Verbrauch SOLL = Pfahllänge × π × r², Summe harte Bodenschichten, Summe Bohrhindernisse (aus den Zeiten).
Höhen und Längen werden mit 3 Nachkommastellen geführt. Beginn, Ende und Dauer der Tabelle ergeben sich aus den Ausführungszeiten.
Frühere Angaben zu Zement, Zusatzmittel, Zusatzstoff und „Entsanden“ werden nicht mehr angezeigt (bleiben aber in den Daten erhalten).

## Export
- **PDF → Bohrprotokolle:** je Pfahl eine A4-Seite im Layout der Vorlage V02, gestaltet im Keller-Design (marineblaues Titelband, gelber Akzentstreifen, blaue Abschnittsbänder, Logo, Fußzeile) (Soll/Ist-Spalten, Schichtenfolge **mit Farbe und Zeichen der Bodenart**, gezeichneter **Bohrpfahl** (Leerbohrung, Beton, Bewehrungskorb) neben der Schichtenfolge, Bohrgerät, Ausführungszeiten, Unterschriftenzeile AN-ZBm / AG/ÖBA / GEO-ZBm). Sind Fotos angehängt, folgt je Pfahl eine Fotoseite (Menü „mit/ohne Fotos“). Über das PDF-Symbol in der Zeile nur für einen Pfahl.
- **PDF → Übersichtsliste:** Tabelle im Querformat mit Summen.
- **CSV:** alle Felder (Semikolon, Dezimalkomma, UTF-8 mit BOM, öffnet direkt in Excel).
- Exportiert wird immer, was in der Tabelle gerade angezeigt wird (Suche/Typ-Filter beachtet).

## Entwicklung
Quellcode in `src/` (`index.html`, `pile-dialog.html`, `import-dialog.html`, `users-dialog.html`, `app.js`, `protokoll.js`, `graphic.js`, `brand.js`, `map.js`, `stats.js`, `import.js`), Bibliotheken in `vendor/` (jsPDF 2.5.1, jsPDF-AutoTable 3.8.2, SheetJS 0.18.5, proj4js 2.9.2, Leaflet 1.9.4).
Das Protokoll-Layout steht in `src/protokoll.js` (Koordinaten in Punkt, aus dem PDF `Beispiel Bohrpfahlprotokoll_V02.pdf` ausgelesen).
Neu bauen nach Änderungen:

```
powershell -ExecutionPolicy Bypass -File build.ps1
```
