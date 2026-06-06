# Luma Studio

> **[English](README_en.md) | [中文](README.md) | [한국어](README_ko.md) | [Français](README_fr.md) | [Español](README_es.md) | [Deutsch](README_de.md)**

セルフホスト型フォトビューアー＆**Lightroom スタイル画像エディタ**。一度アップロードすれば永久保存——写真はブラウザのストレージではなく、ディスク上の実ファイルとして保存されます。

Luma Studio はあなたのマシンをプライベートフォトワークショップに変えます。洗練された白を基調としたギャラリーで写真を閲覧し、フルエディタで調整・変形・トリミング・リサイズ・圧縮・EXIF メタデータの編集が可能——すべて [sharp](https://sharp.pixelplumbing.com/) (libvips) によるサーバーサイド処理です。

---

## 機能

### ギャラリー
- ドラッグ＆ドロップまたはクリックでアップロード（JPG / PNG / WebP / AVIF / GIF / TIFF / BMP）
- サーバーサイド WebP サムネイル、アニメーションメーソングリッド
- ホバーアクション：編集、情報、ダウンロード、削除
- フルスクリーンライトボックス、キーボードナビゲーション（`←` `→` `Esc`）
- 写真はディスク上の実ファイルとして永続化——再起動してもデータ消失なし

### エディタ（Lightroom スタイル）
- **プリセット**：オリジナル、ビビッド、ソフト、ビンテージ、モノクロ、ハイコントラスト
- **調整**：明るさ、コントラスト、彩度、色相、シャープ、ぼかし、グレースケール——ライブ CSS プレビュー
- **元に戻す / やり直し**：`Ctrl+Z` / `Ctrl+Y`（ステートスタック方式）
- **変形**：90°回転、水平/垂直反転、インタラクティブクロップ（フリー / 1:1 / 4:3 / 16:9 / 3:4）
- **リサイズ**：ピクセル指定（アスペクト比ロック）+ 25 / 50 / 75 / 100 % クイックスケール
- **エクスポート**：JPEG / PNG / WebP / AVIF、品質スライダー、ライブサイズ推定
- **コピーとして保存**または**オリジナルを上書き**
- **ローカルにダウンロード**（サーバーに保存せずにバイト列を返却）

### メタデータ（EXIF）
- カメラ、レンズ、絞り、シャッター速度、ISO、焦点距離、GPS などを表示
- アーティスト / 著作権 / 説明 / 撮影日を編集（JPEG のみ）——**UTF-8 / CJK 完全対応**
- ワンクリックで**全メタデータを除去**（プライバシー保護）

### 写真選別
- 1〜5 星評価（クリックまたはキーボード `1`〜`5`、`0` でクリア）
- ピック / リジェクトフラグ（`P` / `R` キー）
- バッチ操作：評価、フラグ、アルバム追加、ZIP ダウンロード、削除

### アルバム
- コレクションの作成・名前変更・削除
- 写真の追加・削除
- アルバム内容の閲覧

### 検索・フィルター・ソート
- ファイル名で検索
- 星評価、ピック/リジェクトフラグ、画像形式でフィルター
- 名前、日付、サイズ、評価でソート

### スライドショー
- 自動再生（3 秒間隔）、スペースキーで一時停止/再開、矢印キーで操作

### 設定＆バージョン情報
- デフォルトエクスポート形式・品質、サムネイルサイズ、テーマアクセントカラー
- ランタイム情報：Node バージョン、sharp/libvips バージョン、写真数、使用容量、稼働時間

### キーボードショートカット

| キー | アクション |
|------|-----------|
| `1`〜`5` | 1〜5 星評価 |
| `0` | 評価クリア |
| `P` | ピック |
| `R` | リジェクト |
| `←` `→` | ライトボックス / スライドショー ナビゲーション |
| `Ctrl+Z` | 元に戻す（エディタ） |
| `Ctrl+Y` | やり直し（エディタ） |
| `Space` | スライドショー 一時停止/再開 |
| `Esc` | ライトボックス / スライドショーを閉じる |

---

## クイックスタート

### 前提条件
- [Node.js](https://nodejs.org/) **18+**

### ソースコード（開発用）

```bash
git clone https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm start
# ブラウザで http://localhost:3000 を開く
```

カスタムポート：

```bash
PORT=8080 npm start
```

### Windows インストーラー（bat スクリプト）

```
git clone -b releases https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
install.bat          # %LOCALAPPDATA%\LumaStudio にインストール + デスクトップショートカット作成
```

デスクトップショートカットをダブルクリックで起動。スクリプトは Node.js が未インストールの場合、自動的に検出・インストールします（winget または Chocolatey 経由）。

### Electron デスクトップ版（開発中）

```
git clone -b electron https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm run electron
```

> **注意**: Electron ビルドは現在ブロックされています。詳細は [ROADMAP.md](ROADMAP.md) をご覧ください。

---

## プロジェクト構成

```
LumaStudio/
├── server.js              # Express バックエンド + sharp パイプライン + REST API
├── electron-main.mjs      # Electron メインプロセス（ESM）
├── package.json
├── public/
│   ├── index.html         # SPA シェル
│   ├── style.css          # デザインシステム
│   └── app.js             # フロントエンドロジック
└── storage/               # 実行時に自動作成
    ├── uploads/            # オリジナル＆処理済み画像
    ├── thumbs/             # 生成された WebP サムネイル
    └── data/               # db.json + settings.json
```

---

## API リファレンス

| メソッド | エンドポイント | 説明 |
|---------|--------------|------|
| `GET` | `/api/photos` | 全写真リスト |
| `GET` | `/api/photos/:id` | 写真メタデータ取得 |
| `POST` | `/api/upload` | 画像アップロード |
| `DELETE` | `/api/photos/:id` | 写真削除 |
| `DELETE` | `/api/photos` | 全写真削除 |
| `GET` | `/api/photos/:id/exif` | EXIF 読み取り |
| `POST` | `/api/photos/:id/exif` | EXIF 書き込み（JPEG のみ） |
| `POST` | `/api/photos/:id/strip-exif` | 全メタデータ除去 |
| `POST` | `/api/photos/:id/process` | 編集を適用して保存 |
| `POST` | `/api/photos/:id/render` | 編集を適用してバイト列を返却 |
| `POST` | `/api/photos/:id/preview` | 出力サイズ推定 |
| `POST` | `/api/photos/:id/rename` | 写真の名前変更 |
| `GET` | `/api/settings` | 設定取得 |
| `POST` | `/api/settings` | 設定更新 |
| `GET` | `/api/stats` | ストレージ統計 |
| `GET` | `/api/search` | 検索/フィルター（`q`, `sort`, `stars`, `flag`, `format`, `album`） |
| `GET` | `/api/info` | システム情報 |
| `POST` | `/api/photos/:id/stars` | 星評価設定（0–5） |
| `POST` | `/api/photos/:id/flag` | フラグ設定（`pick` / `reject` / `null`） |
| `POST` | `/api/photos/batch/stars` | 一括評価 `{ ids, stars }` |
| `POST` | `/api/photos/batch/flag` | 一括フラグ `{ ids, flag }` |
| `POST` | `/api/photos/batch/delete` | 一括削除 `{ ids }` |
| `POST` | `/api/photos/download-zip` | ZIP ダウンロード `{ ids }` |
| `GET` | `/api/albums` | アルバム一覧 |
| `POST` | `/api/albums` | アルバム作成 `{ name }` |
| `DELETE` | `/api/albums/:id` | アルバム削除 |
| `POST` | `/api/albums/:id/rename` | アルバム名変更 |
| `POST` | `/api/albums/:id/add` | 写真追加 `{ ids }` |
| `POST` | `/api/albums/:id/remove` | 写真削除 `{ ids }` |
| `GET` | `/files/:file` | オリジナル配信（`?download=1` で強制ダウンロード） |
| `GET` | `/thumbs/:id.webp` | サムネイル配信 |

### Process / Render リクエストボディ

```jsonc
{
  "adjust":    { "brightness": 1.1, "contrast": 1.2, "saturation": 1.4,
                 "hue": 0, "sharpen": 2, "blur": 0, "grayscale": false },
  "transform": { "rotate": 90, "flipH": false, "flipV": false,
                 "crop": { "left": 100, "top": 50, "width": 400, "height": 300 } },
  "resize":    { "width": 1280, "height": 720 },
  "output":    { "format": "webp", "quality": 80 },
  "mode":      "copy"   // または "overwrite"
}
```

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| バックエンド | [Express](https://expressjs.com/) |
| 画像処理 | [sharp](https://sharp.pixelplumbing.com/) (libvips) |
| EXIF 読み取り | [exifr](https://github.com/MikeKovarik/exifr) |
| EXIF 書き込み | [piexifjs](https://github.com/hMatoba/piexifjs) |
| アップロード | [multer](https://github.com/expressjs/multer) |
| ZIP | [yazl](https://github.com/thejoshwolfe/yazl) |
| デスクトップ | [Electron](https://www.electronjs.org/) |
| フロントエンド | Vanilla JavaScript / HTML / CSS（フレームワーク・ビルドステップ不要） |

---

## 注意事項

- **EXIF 書き込み**は JPEG のみ対応（EXIF 仕様の制約）。UTF-8 / CJK テキストは完全保持。
- **Windows** ではファイルハンドルロック回避のため、sharp キャッシュが無効化されています（`sharp.cache(false)`）。
- **認証なし**——ローカル / パーソナルユース向け設計。公開インターネットに直接公開せず、リバースプロキシーの背後に配置してください。

---

## ロードマップ＆コントリビュート

現在のステータス、既知の問題、予定機能は [ROADMAP.md](ROADMAP.md) をご覧ください。

---

## ライセンス

[Apache License 2.0](LICENSE) © 2026 [IceFire_Icer](https://github.com/IceFireIcer)
