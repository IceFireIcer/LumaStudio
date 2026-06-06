# Luma Studio

> **[English](README_en.md) | [中文](README.md) | [日本語](README_ja.md) | [한국어](README_ko.md) | [Français](README_fr.md) | [Español](README_es.md)**

Selbst-gehosteter Foto-Viewer und **Lightroom-Stil Bildeditor**. Einmal hochladen, für immer behalten — Ihre Fotos werden als echte Dateien auf der Festplatte gespeichert, nicht im Browser-Speicher.

Luma Studio verwandelt Ihren Computer in ein privates Fotostudio. Durchstöbern Sie Ihre Bibliothek in einer eleganten weißen Galerie und wechseln dann zum Vollbild-Editor zum Anpassen, Transformieren, Zuschneiden, Skalieren, Komprimieren und Bearbeiten von EXIF-Metadaten — alles serverseitig verarbeitet mit [sharp](https://sharp.pixelplumbing.com/) (libvips).

---

## Funktionen

### Galerie
- Drag-and-Drop oder Klick zum Hochladen (JPG / PNG / WebP / AVIF / GIF / TIFF / BMP)
- Serverseitige WebP-Thumbnails, animiertes Masonry-Grid
- Hover-Aktionen: Bearbeiten, Info, Herunterladen, Löschen
- Vollbild-Lightbox, Tastaturnavigation (`←` `→` `Esc`)
- Fotos werden als echte Dateien auf der Festplatte gespeichert — kein Datenverlust bei Neustart

### Editor (Lightroom-Stil)
- **Voreinstellungen**: Original, Lebendig, Weich, Vintage, Mono, Hoher Kontrast
- **Anpassungen**: Helligkeit, Kontrast, Sättigung, Farbton, Schärfe, Unschärfe, Graustufen — Live-CSS-Vorschau
- **Rückgängig / Wiederholen**: `Ctrl+Z` / `Ctrl+Y` (Zustandsstapel)
- **Transformation**: 90° drehen, horizontal/vertikal spiegeln, interaktives Zuschneiden (Frei / 1:1 / 4:3 / 16:9 / 3:4)
- **Skalierung**: Exakte Pixel (Seitenverhältnis gesperrt) + 25 / 50 / 75 / 100 % Schnellskalierung
- **Export**: JPEG / PNG / WebP / AVIF, Qualitätsschieberegler, Live-Größenschätzung
- **Als Kopie speichern** oder **Original überschreiben**
- **Lokal herunterladen** (ohne Server-Speicherung, gibt Bytes zurück)

### Metadaten (EXIF)
- Anzeigen: Kamera, Objektiv, Blende, Verschlusszeit, ISO, Brennweite, GPS usw.
- Bearbeiten: Autor / Copyright / Beschreibung / Datum (nur JPEG) — **UTF-8 / CJK vollständig unterstützt**
- **Alle Metadaten entfernen** mit einem Klick (Datenschutz)

### Foto-Auswahl
- 1–5 Sterne-Bewertung (Klick oder Tastatur `1`–`5`, `0` zum Löschen)
- Pick / Reject Markierungen (`P` / `R` Tasten)
- Stapelverarbeitung: Bewerten, Markieren, zum Album hinzufügen, ZIP herunterladen, Löschen

### Alben
- Sammlungen erstellen, umbenennen, löschen
- Fotos hinzufügen / entfernen
- Album-Inhalte durchsuchen

### Suche, Filter & Sortierung
- Suche nach Dateiname
- Filtern nach Sternen, Markierungen, Bildformat
- Sortieren nach Name, Datum, Größe oder Bewertung

### Diashow
- Automatische Wiedergabe (3 s Intervall), Leertaste zum Pausieren/Fortsetzen, Pfeiltasten

### Einstellungen & Über
- Standard-Exportformat und Qualität, Thumbnail-Größe, Akzentfarbe des Themas
- Laufzeitinformationen: Node-Version, sharp/libvips-Version, Fotoanzahl, belegter Speicher, Betriebszeit

### Tastenkürzel

| Taste | Aktion |
|-------|--------|
| `1`–`5` | 1–5 Sterne bewerten |
| `0` | Bewertung löschen |
| `P` | Pick |
| `R` | Reject |
| `←` `→` | Lightbox / Diashow Navigation |
| `Ctrl+Z` | Rückgängig (Editor) |
| `Ctrl+Y` | Wiederholen (Editor) |
| `Leertaste` | Diashow pausieren/fortsetzen |
| `Esc` | Lightbox / Diashow schließen |

---

## Schnellstart

### Voraussetzungen
- [Node.js](https://nodejs.org/) **18+**

### Quellcode (Entwicklung)

```bash
git clone https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm start
# http://localhost:3000 im Browser öffnen
```

Eigener Port:

```bash
PORT=8080 npm start
```

### Windows-Installer (bat-Skript)

```
git clone -b windows-releases https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
install.bat          # Installiert nach %LOCALAPPDATA%\LumaStudio + Desktop-Verknüpfung
```

Doppelklick auf die Desktop-Verknüpfung zum Starten. Das Skript erkennt und installiert Node.js automatisch bei Bedarf (über winget oder Chocolatey).

### Electron Desktop

```
git clone -b electron https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm run electron
```

> **Hinweis**: Die Electron-Version kann jetzt erfolgreich gestartet und gebaut werden. Der Quellcode liegt im Branch `electron`, die Windows-Build-Artefakte im Branch `electron-releases`.

---

## Projektstruktur

```
LumaStudio/
├── server.js              # Express-Backend + sharp-Pipeline + REST-API
├── electron-main.cjs      # Electron-Einstiegspunkt (CJS)
├── package.json
├── public/
│   ├── index.html         # SPA-Shell
│   ├── style.css          # Design-System
│   └── app.js             # Frontend-Logik
└── storage/               # Wird zur Laufzeit erstellt
    ├── uploads/            # Originale und bearbeitete Bilder
    ├── thumbs/             # Generierte WebP-Thumbnails
    └── data/               # db.json + settings.json
```

---

## API-Referenz

| Methode | Endpunkt | Beschreibung |
|---------|----------|-------------|
| `GET` | `/api/photos` | Alle Fotos auflisten |
| `GET` | `/api/photos/:id` | Foto-Metadaten |
| `POST` | `/api/upload` | Bilder hochladen |
| `DELETE` | `/api/photos/:id` | Foto löschen |
| `DELETE` | `/api/photos` | Alle löschen |
| `GET` | `/api/photos/:id/exif` | EXIF lesen |
| `POST` | `/api/photos/:id/exif` | EXIF schreiben (JPEG) |
| `POST` | `/api/photos/:id/strip-exif` | Alle Metadaten entfernen |
| `POST` | `/api/photos/:id/process` | Bearbeitung anwenden & speichern |
| `POST` | `/api/photos/:id/render` | Bearbeitung anwenden & Bytes zurückgeben |
| `POST` | `/api/photos/:id/preview` | Ausgabegröße schätzen |
| `POST` | `/api/photos/:id/rename` | Umbenennen |
| `GET` | `/api/settings` | Einstellungen abrufen |
| `POST` | `/api/settings` | Einstellungen aktualisieren |
| `GET` | `/api/stats` | Speicherstatistik |
| `GET` | `/api/search` | Suchen/filtern (`q`, `sort`, `stars`, `flag`, `format`, `album`) |
| `GET` | `/api/info` | Systeminformationen |
| `POST` | `/api/photos/:id/stars` | Bewertung setzen (0–5) |
| `POST` | `/api/photos/:id/flag` | Markierung setzen (`pick` / `reject` / `null`) |
| `POST` | `/api/photos/batch/stars` | Stapelbewertung `{ ids, stars }` |
| `POST` | `/api/photos/batch/flag` | Stapelmarkierung `{ ids, flag }` |
| `POST` | `/api/photos/batch/delete` | Stapel-Löschung `{ ids }` |
| `POST` | `/api/photos/download-zip` | ZIP herunterladen `{ ids }` |
| `GET` | `/api/albums` | Alben auflisten |
| `POST` | `/api/albums` | Album erstellen `{ name }` |
| `DELETE` | `/api/albums/:id` | Album löschen |
| `POST` | `/api/albums/:id/rename` | Album umbenennen |
| `POST` | `/api/albums/:id/add` | Fotos hinzufügen `{ ids }` |
| `POST` | `/api/albums/:id/remove` | Fotos entfernen `{ ids }` |
| `GET` | `/files/:file` | Original bereitstellen (`?download=1` für erzwungenen Download) |
| `GET` | `/thumbs/:id.webp` | Thumbnail bereitstellen |

---

## Technologie-Stack

| Schicht | Technologie |
|---------|------------|
| Backend | [Express](https://expressjs.com/) |
| Bildverarbeitung | [sharp](https://sharp.pixelplumbing.com/) (libvips) |
| EXIF-Lesung | [exifr](https://github.com/MikeKovarik/exifr) |
| EXIF-Schreib | [piexifjs](https://github.com/hMatoba/piexifjs) |
| Uploads | [multer](https://github.com/expressjs/multer) |
| ZIP | [yazl](https://github.com/thejoshwolfe/yazl) |
| Desktop | [Electron](https://www.electronjs.org/) |
| Frontend | Vanilla JavaScript / HTML / CSS (kein Framework, kein Build-Schritt) |

---

## Hinweise

- **EXIF-Schreibvorgänge** sind nur für JPEG möglich (EXIF-Standard-Einschränkung). UTF-8 / CJK-Zeichen werden vollständig erhalten.
- Unter **Windows** ist der sharp-Cache deaktiviert (`sharp.cache(false)`), um Dateihandle-Sperren zu vermeiden.
- **Keine Authentifizierung** — für lokalen / persönlichen Gebrauch konzipiert. Nicht direkt im öffentlichen Internet ohne Reverse-Proxy aussetzen.

---

## Roadmap & Beiträge

Aktueller Status, bekannte Probleme und geplante Funktionen in [ROADMAP.md](ROADMAP.md).

---

## Lizenz

[Apache License 2.0](LICENSE) © 2026 [IceFire_Icer](https://github.com/IceFireIcer)
