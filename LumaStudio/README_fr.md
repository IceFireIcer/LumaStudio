# Luma Studio

> **[English](README.md) | [中文](README_zh.md) | [日本語](README_ja.md) | [한국어](README_ko.md) | [Español](README_es.md) | [Deutsch](README_de.md)**

Visionneuse photo et éditeur d'images **style Lightroom**, auto-hébergé. Uploadez une fois, conservez pour toujours — vos photos sont stockées en tant que fichiers réels sur le disque, pas dans le stockage du navigateur.

Luma Studio transforme votre machine en un atelier photo privé. Parcourez votre bibliothèque dans une galerie élégante au thème blanc, puis passez à un éditeur complet pour ajuster, transformer, recadrer, redimensionner, recompresser et réécrire les métadonnées EXIF — le tout traité côté serveur avec [sharp](https://sharp.pixelplumbing.com/) (libvips).

---

## Fonctionnalités

### Galerie
- Glisser-déposer ou clic pour uploader (JPG / PNG / WebP / AVIF / GIF / TIFF / BMP)
- Miniatures WebP côté serveur, grille masonry animée
- Actions au survol : éditer, info, télécharger, supprimer
- Lightbox plein écran, navigation clavier (`←` `→` `Esc`)
- Photos persistantes en fichiers réels sur le disque — aucune perte au redémarrage

### Éditeur (style Lightroom)
- **Préréglages** : Original, Vivide, Doux, Vintage, Mono, Haut contraste
- **Ajustements** : luminosité, contraste, saturation, teinte, netteté, flou, niveaux de gris — aperçu CSS en direct
- **Annuler / Rétablir** : `Ctrl+Z` / `Ctrl+Y` (pile d'états)
- **Transformation** : rotation 90°, retournement H/V, recadrage interactif (libre / 1:1 / 4:3 / 16:9 / 3:4)
- **Redimensionnement** : pixels exacts (ratio verrouillé) + 25 / 50 / 75 / 100 %
- **Export** : JPEG / PNG / WebP / AVIF, curseur de qualité, estimation de taille en direct
- **Enregistrer en copie** ou **écraser l'original**
- **Télécharger en local** (sans sauvegarde serveur, retour de bytes)

### Métadonnées (EXIF)
- Affichage : appareil, objectif, ouverture, vitesse, ISO, focale, GPS, etc.
- Édition : artiste / copyright / description / date (JPEG uniquement) — **UTF-8 / CJK entièrement supporté**
- **Suppression de toutes les métadonnées** en un clic (protection de la vie privée)

### Tri de photos
- Note 1–5 étoiles (clic ou clavier `1`–`5`, `0` pour effacer)
- Drapeaux Pick / Reject (`P` / `R`)
- Opérations par lot : noter, marquer, ajouter à un album, télécharger ZIP, supprimer

### Albums
- Créer, renommer, supprimer des collections
- Ajouter / retirer des photos
- Parcourir le contenu des albums

### Recherche, filtre et tri
- Recherche par nom de fichier
- Filtrage par étoiles, drapeaux, format d'image
- Tri par nom, date, taille ou note

### Diaporama
- Lecture automatique (intervalle 3 s), espace pour pause/reprendre, touches fléchées

### Paramètres et à propos
- Format et qualité d'export par défaut, taille des miniatures, couleur d'accent du thème
- Informations runtime : version Node, version sharp/libvips, nombre de photos, espace utilisé, temps de fonctionnement

### Raccourcis clavier

| Touche | Action |
|--------|--------|
| `1`–`5` | Noter 1–5 étoiles |
| `0` | Effacer la note |
| `P` | Pick |
| `R` | Reject |
| `←` `→` | Navigation lightbox / diaporama |
| `Ctrl+Z` | Annuler (éditeur) |
| `Ctrl+Y` | Rétablir (éditeur) |
| `Espace` | Pause / reprendre diaporama |
| `Échap` | Fermer lightbox / diaporama |

---

## Démarrage rapide

### Prérequis
- [Node.js](https://nodejs.org/) **18+**

### Code source (développement)

```bash
git clone https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm start
# Ouvrir http://localhost:3000 dans le navigateur
```

Port personnalisé :

```bash
PORT=8080 npm start
```

### Installateur Windows (script bat)

```
git clone -b windows-releases https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
install.bat          # Installe dans %LOCALAPPDATA%\LumaStudio + raccourci bureau
```

Double-cliquez sur le raccourci bureau pour lancer. Le script détecte et installe automatiquement Node.js si nécessaire (via winget ou Chocolatey).

### Electron (en développement)

```
git clone -b electron https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm run electron
```

> **Note** : Le build Electron est actuellement bloqué. Voir [ROADMAP.md](ROADMAP.md) pour les détails.

---

## Structure du projet

```
LumaStudio/
├── server.js              # Backend Express + pipeline sharp + REST API
├── electron-main.mjs      # Point d'entrée Electron (ESM)
├── package.json
├── public/
│   ├── index.html         # Shell SPA
│   ├── style.css          # Système de design
│   └── app.js             # Logique front-end
└── storage/               # Créé à l'exécution
    ├── uploads/            # Images originales et traitées
    ├── thumbs/             # Miniatures WebP générées
    └── data/               # db.json + settings.json
```

---

## Référence API

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/photos` | Liste de toutes les photos |
| `GET` | `/api/photos/:id` | Métadonnées d'une photo |
| `POST` | `/api/upload` | Upload d'images |
| `DELETE` | `/api/photos/:id` | Supprimer une photo |
| `DELETE` | `/api/photos` | Tout supprimer |
| `GET` | `/api/photos/:id/exif` | Lire EXIF |
| `POST` | `/api/photos/:id/exif` | Écrire EXIF (JPEG) |
| `POST` | `/api/photos/:id/strip-exif` | Supprimer toutes les métadonnées |
| `POST` | `/api/photos/:id/process` | Appliquer et sauvegarder |
| `POST` | `/api/photos/:id/render` | Appliquer et retourner les bytes |
| `POST` | `/api/photos/:id/preview` | Estimer la taille de sortie |
| `POST` | `/api/photos/:id/rename` | Renommer |
| `GET` | `/api/settings` | Paramètres |
| `POST` | `/api/settings` | Mettre à jour les paramètres |
| `GET` | `/api/stats` | Statistiques de stockage |
| `GET` | `/api/search` | Recherche/filtre (`q`, `sort`, `stars`, `flag`, `format`, `album`) |
| `GET` | `/api/info` | Informations système |
| `POST` | `/api/photos/:id/stars` | Définir note (0–5) |
| `POST` | `/api/photos/:id/flag` | Définir drapeau (`pick` / `reject` / `null`) |
| `POST` | `/api/photos/batch/stars` | Notes par lot `{ ids, stars }` |
| `POST` | `/api/photos/batch/flag` | Drapeaux par lot `{ ids, flag }` |
| `POST` | `/api/photos/batch/delete` | Suppression par lot `{ ids }` |
| `POST` | `/api/photos/download-zip` | Télécharger en ZIP `{ ids }` |
| `GET` | `/api/albums` | Liste des albums |
| `POST` | `/api/albums` | Créer un album `{ name }` |
| `DELETE` | `/api/albums/:id` | Supprimer un album |
| `POST` | `/api/albums/:id/rename` | Renommer un album |
| `POST` | `/api/albums/:id/add` | Ajouter des photos `{ ids }` |
| `POST` | `/api/albums/:id/remove` | Retirer des photos `{ ids }` |
| `GET` | `/files/:file` | Servir l'original (`?download=1` pour forcer le téléchargement) |
| `GET` | `/thumbs/:id.webp` | Servir la miniature |

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Backend | [Express](https://expressjs.com/) |
| Traitement d'image | [sharp](https://sharp.pixelplumbing.com/) (libvips) |
| Lecture EXIF | [exifr](https://github.com/MikeKovarik/exifr) |
| Écriture EXIF | [piexifjs](https://github.com/hMatoba/piexifjs) |
| Uploads | [multer](https://github.com/expressjs/multer) |
| ZIP | [yazl](https://github.com/thejoshwolfe/yazl) |
| Bureau | [Electron](https://www.electronjs.org/) |
| Front-end | Vanilla JavaScript / HTML / CSS (aucun framework, aucune étape de build) |

---

## Notes

- L'**écriture EXIF** est limitée au JPEG (contrainte de la norme EXIF). Les caractères UTF-8 / CJK sont entièrement préservés.
- Sous **Windows**, le cache sharp est désactivé (`sharp.cache(false)`) pour éviter les verrous de fichiers.
- **Aucune authentification** — conçu pour un usage local/personnel. Ne pas exposer directement sur Internet sans proxy inverse.

---

## Feuille de route et contributions

État actuel, problèmes connus et fonctionnalités prévues dans [ROADMAP.md](ROADMAP.md).

---

## Licence

[Apache License 2.0](LICENSE) © 2026 [IceFire_Icer](https://github.com/IceFireIcer)
