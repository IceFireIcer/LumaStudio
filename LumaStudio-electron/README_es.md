# Luma Studio

> **[English](README.md) | [中文](README_zh.md) | [日本語](README_ja.md) | [한국어](README_ko.md) | [Français](README_fr.md) | [Deutsch](README_de.md)**

Visor de fotos y editor de imágenes **estilo Lightroom**, autoalojado. Sube una vez, conserva para siempre — tus fotos se almacenan como archivos reales en disco, no en el almacenamiento del navegador.

Luma Studio convierte tu máquina en un estudio fotográfico privado. Explora tu biblioteca en una elegante galería con tema blanco, luego pasa al editor completo para ajustar, transformar, recortar, redimensionar, recomprimir y reescribir metadatos EXIF — todo procesado en el servidor con [sharp](https://sharp.pixelplumbing.com/) (libvips).

---

## Características

### Galería
- Arrastrar y soltar o clic para subir (JPG / PNG / WebP / AVIF / GIF / TIFF / BMP)
- Miniaturas WebP en el servidor, cuadrícula masonry animada
- Acciones al pasar el ratón: editar, info, descargar, eliminar
- Lightbox a pantalla completa, navegación por teclado (`←` `→` `Esc`)
- Fotos persistentes como archivos reales en disco — sin pérdida de datos al reiniciar

### Editor (estilo Lightroom)
- **Preajustes**: Original, Vivido, Suave, Vintage, Mono, Alto contraste
- **Ajustes**: brillo, contraste, saturación, tono, nitidez, desenfoque, escala de grises — vista previa CSS en vivo
- **Deshacer / Rehacer**: `Ctrl+Z` / `Ctrl+Y` (pila de estados)
- **Transformación**: rotación 90°, volteo H/V, recorte interactivo (libre / 1:1 / 4:3 / 16:9 / 3:4)
- **Redimensionar**: píxeles exactos (relación bloqueada) + 25 / 50 / 75 / 100 %
- **Exportar**: JPEG / PNG / WebP / AVIF, deslizador de calidad, estimación de tamaño en vivo
- **Guardar como copia** o **sobrescribir original**
- **Descargar local** (sin guardar en servidor, devuelve bytes)

### Metadatos (EXIF)
- Ver: cámara, lente, apertura, velocidad, ISO, distancia focal, GPS, etc.
- Editar: artista / copyright / descripción / fecha (solo JPEG) — **UTF-8 / CJK completamente soportado**
- **Eliminar todos los metadatos** con un clic (protección de privacidad)

### Selección de fotos
- Valoración 1–5 estrellas (clic o teclado `1`–`5`, `0` para limpiar)
- Banderas Pick / Reject (`P` / `R`)
- Operaciones por lote: valorar, marcar, añadir a álbum, descargar ZIP, eliminar

### Álbumes
- Crear, renombrar, eliminar colecciones
- Añadir / quitar fotos
- Explorar contenido de álbumes

### Búsqueda, filtro y orden
- Búsqueda por nombre de archivo
- Filtrar por estrellas, banderas, formato de imagen
- Ordenar por nombre, fecha, tamaño o valoración

### Presentación de diapositivas
- Reproducción automática (intervalo 3 s), espacio para pausar/reanudar, teclas de flecha

### Configuración y Acerca de
- Formato y calidad de exportación por defecto, tamaño de miniaturas, color de acento del tema
- Info de runtime: versión de Node, versión sharp/libvips, recuento de fotos, espacio usado, tiempo activo

### Atajos de teclado

| Tecla | Acción |
|-------|--------|
| `1`–`5` | Valorar 1–5 estrellas |
| `0` | Limpiar valoración |
| `P` | Pick |
| `R` | Reject |
| `←` `→` | Navegación lightbox / diapositivas |
| `Ctrl+Z` | Deshacer (editor) |
| `Ctrl+Y` | Rehacer (editor) |
| `Espacio` | Pausar / reanudar diapositivas |
| `Esc` | Cerrar lightbox / diapositivas |

---

## Inicio rápido

### Requisitos previos
- [Node.js](https://nodejs.org/) **18+**

### Código fuente (desarrollo)

```bash
git clone https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm start
# Abrir http://localhost:8765 en el navegador
```

Puerto personalizado:

```bash
PORT=8080 npm start
```

### Instalador Windows (script bat)

```
git clone -b windows-releases https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
install.bat          # Instala en %LOCALAPPDATA%\LumaStudio + acceso directo en escritorio
```

Haz doble clic en el acceso directo del escritorio para iniciar. El script detecta e instala Node.js automáticamente si falta (vía winget o Chocolatey).

### Electron Desktop

```
git clone -b electron https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm run electron
```

> **Nota**: La versión Electron ya puede iniciarse y compilarse correctamente. El código fuente está en la rama `electron` y los artefactos de Windows en la rama `electron-releases`.

---

## Estructura del proyecto

```
LumaStudio/
├── server.js              # Backend Express + pipeline sharp + REST API
├── electron-main.cjs      # Punto de entrada Electron (CJS)
├── package.json
├── public/
│   ├── index.html         # Shell SPA
│   ├── style.css          # Sistema de diseño
│   └── app.js             # Lógica front-end
└── storage/               # Creado en tiempo de ejecución
    ├── uploads/            # Imágenes originales y procesadas
    ├── thumbs/             # Miniaturas WebP generadas
    └── data/               # db.json + settings.json
```

---

## Referencia API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/photos` | Lista de todas las fotos |
| `GET` | `/api/photos/:id` | Metadatos de una foto |
| `POST` | `/api/upload` | Subir imágenes |
| `DELETE` | `/api/photos/:id` | Eliminar una foto |
| `DELETE` | `/api/photos` | Eliminar todas |
| `GET` | `/api/photos/:id/exif` | Leer EXIF |
| `POST` | `/api/photos/:id/exif` | Escribir EXIF (JPEG) |
| `POST` | `/api/photos/:id/strip-exif` | Eliminar todos los metadatos |
| `POST` | `/api/photos/:id/process` | Aplicar y guardar |
| `POST` | `/api/photos/:id/render` | Aplicar y devolver bytes |
| `POST` | `/api/photos/:id/preview` | Estimar tamaño de salida |
| `POST` | `/api/photos/:id/rename` | Renombrar |
| `GET` | `/api/settings` | Obtener configuración |
| `POST` | `/api/settings` | Actualizar configuración |
| `GET` | `/api/stats` | Estadísticas de almacenamiento |
| `GET` | `/api/search` | Buscar/filtrar (`q`, `sort`, `stars`, `flag`, `format`, `album`) |
| `GET` | `/api/info` | Información del sistema |
| `POST` | `/api/photos/:id/stars` | Establecer valoración (0–5) |
| `POST` | `/api/photos/:id/flag` | Establecer bandera (`pick` / `reject` / `null`) |
| `POST` | `/api/photos/batch/stars` | Valoración por lote `{ ids, stars }` |
| `POST` | `/api/photos/batch/flag` | Banderas por lote `{ ids, flag }` |
| `POST` | `/api/photos/batch/delete` | Eliminación por lote `{ ids }` |
| `POST` | `/api/photos/download-zip` | Descargar ZIP `{ ids }` |
| `GET` | `/api/albums` | Lista de álbumes |
| `POST` | `/api/albums` | Crear álbum `{ name }` |
| `DELETE` | `/api/albums/:id` | Eliminar álbum |
| `POST` | `/api/albums/:id/rename` | Renombrar álbum |
| `POST` | `/api/albums/:id/add` | Añadir fotos `{ ids }` |
| `POST` | `/api/albums/:id/remove` | Quitar fotos `{ ids }` |
| `GET` | `/files/:file` | Servir original (`?download=1` para descarga forzada) |
| `GET` | `/thumbs/:id.webp` | Servir miniatura |

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | [Express](https://expressjs.com/) |
| Procesamiento de imagen | [sharp](https://sharp.pixelplumbing.com/) (libvips) |
| Lectura EXIF | [exifr](https://github.com/MikeKovarik/exifr) |
| Escritura EXIF | [piexifjs](https://github.com/hMatoba/piexifjs) |
| Subidas | [multer](https://github.com/expressjs/multer) |
| ZIP | [yazl](https://github.com/thejoshwolfe/yazl) |
| Escritorio | [Electron](https://www.electronjs.org/) |
| Front-end | Vanilla JavaScript / HTML / CSS (sin framework, sin paso de build) |

---

## Notas

- La **escritura EXIF** solo soporta JPEG (limitación del estándar EXIF). Los caracteres UTF-8 / CJK se preservan completamente.
- En **Windows**, la caché de sharp está desactivada (`sharp.cache(false)`) para evitar bloqueos de archivos.
- **Sin autenticación** — diseñado para uso local/personal. No exponer directamente a Internet sin proxy inverso.

---

## Hoja de ruta y contribuciones

Estado actual, problemas conocidos y funciones planificadas en [ROADMAP.md](ROADMAP.md).

---

## Licencia

[Apache License 2.0](LICENSE) © 2026 [IceFire_Icer](https://github.com/IceFireIcer)
