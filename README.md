# CSV Simple Editor

CSV-Editor und CSV-Viewer für Visual Studio Code: CSV- und TSV-Dateien als Tabelle anzeigen und bearbeiten. Das Trennzeichen wird automatisch erkannt; Zellen lassen sich bearbeiten, Zeilen und Spalten sortieren und filtern.

## Funktionen

- Erkennt Komma, Semikolon, Tabulator oder senkrechten Strich und erhält das Trennzeichen beim Speichern.
- Öffnet CSV- und TSV-Dateien in der Tabellenansicht im selben Editor-Tab.
- Passt Spaltenbreiten an den Inhalt an und begrenzt sehr breite Spalten.
- Sortiert per Spaltenkopf oder Rechtsklick und filtert direkt am Trichtersymbol oder über das Kontextmenü.
- Behält die ursprünglichen Zeilennummern bei, auch wenn die Ansicht sortiert wird.
- Verwendet `Strg+F` für die native VS-Code-Suche in allen Tabellenzeilen.
- Bearbeitet Zellen per Doppelklick, `Enter` oder `F2`; `Tab` springt zur nächsten Zelle.
- Kopiert eine Zelle mit `Strg+C` oder über das Rechtsklick-Menü. Ganze Zeilen lassen sich ebenfalls kopieren.
- Fügt Zeilen und Spalten hinzu und löscht ausgewählte Zeilen oder einzelne Spalten.
- Übernimmt Änderungen in das normale VS-Code-Dokument. Speichern funktioniert mit `Strg+S`.
- Bietet Trennzeichenwahl sowie Filter- und Sortierreset im kompakten Drei-Punkte-Menü.

## Installation

1. `csv-grid-editor-1.2.0.vsix` über **Erweiterungen: Aus VSIX installieren…** öffnen.
2. Eine CSV- oder TSV-Datei öffnen. Sie startet direkt in der Tabellenansicht.
3. Über das Editor-Symbol **CSV als Text öffnen** zur Textansicht wechseln. Dort bringt das CSV-Symbol wieder die Tabelle.

Alternativ kannst du die Erweiterung im Entwicklungsmodus laden: Diesen Ordner in VS Code öffnen und `F5` drücken.

## Bedienung

- Zelle doppelklicken oder mit `Enter` beziehungsweise `F2` bearbeiten.
- Auf den Spaltennamen klicken, um aufsteigend zu sortieren. Erneutes Klicken wechselt die Richtung.
- Mit Rechtsklick auf eine Zelle kannst du sie oder die ganze Zeile kopieren, nach ihrem Text filtern oder die Spalte sortieren.
- Mit Rechtsklick auf eine Spaltenüberschrift kannst du den Filter öffnen, sortieren, die Überschrift bearbeiten oder die Spalte löschen.
- Das Trichtersymbol im Spaltenkopf öffnet direkt den passenden Filter.
- Die Zeilennummer links bleibt beim Sortieren an ihrem ursprünglichen Datensatz.
- Mit dem Kästchen links Zeilen auswählen und über das Papierkorbsymbol löschen.
- Über das Drei-Punkte-Menü Filter zurücksetzen, Sortierung zurücksetzen, das Trennzeichen ändern oder die Textansicht öffnen.

Die Oberfläche übernimmt die Farben des aktiven VS-Code-Designs und hält Tabelle und Werkzeugleiste kompakt.
