# Luma Studio

> **[English](README.md) | [中文](README_zh.md) | [日本語](README_ja.md) | [Français](README_fr.md) | [Español](README_es.md) | [Deutsch](README_de.md)**

셀프 호스팅 포토 뷰어 및 **Lightroom 스타일 이미지 편집기**. 한 번 업로드하면 영구 보관 — 사진은 브라우저 스토리지가 아닌 디스크의 실제 파일로 저장됩니다.

Luma Studio는 당신의 컴퓨터를 프라이빗 포토 워크숍으로 바꿔줍니다. 세련된 화이트 테마 갤러리에서 사진을 탐색하고, 풀 편집기에서 조정·변형·자르기·리사이즈·압축·EXIF 메타데이터 편집을 수행하세요 — [sharp](https://sharp.pixelplumbing.com/) (libvips)로 서버 사이드에서 처리됩니다.

---

## 기능

### 갤러리
- 드래그 앤 드롭 또는 클릭으로 업로드 (JPG / PNG / WebP / AVIF / GIF / TIFF / BMP)
- 서버 사이드 WebP 썸네일, 애니메이션 메이슨리 그리드
- 호버 액션: 편집, 정보, 다운로드, 삭제
- 풀스크린 라이트박스, 키보드 내비게이션 (`←` `→` `Esc`)
- 사진은 디스크의 실제 파일로 영구 저장 — 재시작 시 데이터 손실 없음

### 편집기 (Lightroom 스타일)
- **프리셋**: 오리지널, 비비드, 소프트, 빈티지, 모노, 하이컨트라스트
- **조정**: 밝기, 대비, 채도, 색조, 선명도, 블러, 그레이스케일 — 실시간 CSS 미리보기
- **실행 취소 / 다시 실행**: `Ctrl+Z` / `Ctrl+Y` (스택 방식)
- **변형**: 90° 회전, 수평/수직 반전, 인터랙티브 크롭 (자유 / 1:1 / 4:3 / 16:9 / 3:4)
- **리사이즈**: 픽셀 입력 (비율 잠금) + 25 / 50 / 75 / 100 % 빠른 스케일
- **내보내기**: JPEG / PNG / WebP / AVIF, 품질 슬라이더, 실시간 크기 추정
- **사본 저장** 또는 **원본 덮어쓰기**
- **로컬 다운로드** (서버 저장 없이 바이트 반환)

### 메타데이터 (EXIF)
- 카메라, 렌즈, 조리개, 셔터, ISO, 초점거리, GPS 등 표시
- 아티스트 / 저작권 / 설명 / 촬영일 편집 (JPEG만) — **UTF-8 / CJK 완전 지원**
- 원클릭 **전체 메타데이터 제거** (개인정보 보호)

### 사진 선별
- 1–5 별점 (클릭 또는 키보드 `1`–`5`, `0`으로 초기화)
- 픽 / 리젝트 플래그 (`P` / `R` 키)
- 일괄 작업: 평점, 플래그, 앨범 추가, ZIP 다운로드, 삭제

### 앨범
- 컬렉션 생성 / 이름 변경 / 삭제
- 사진 추가 / 제거
- 앨범 내용 탐색

### 검색, 필터, 정렬
- 파일명으로 검색
- 별점, 픽/리젝트 플래그, 이미지 포맷으로 필터
- 이름, 날짜, 크기, 평점으로 정렬

### 슬라이드 쇼
- 자동 재생 (3초 간격), 스페이스바로 일시정지/재개, 화살표 키로 탐색

### 설정 및 정보
- 기본 내보내기 포맷/품질, 썸네일 크기, 테마 악센트 색상
- 런타임 정보: Node 버전, sharp/libvips 버전, 사진 수, 사용 용량, 가동 시간

### 키보드 단축키

| 키 | 동작 |
|----|------|
| `1`–`5` | 1–5 별점 |
| `0` | 평점 초기화 |
| `P` | 픽 |
| `R` | 리젝트 |
| `←` `→` | 라이트박스 / 슬라이드 쇼 내비게이션 |
| `Ctrl+Z` | 실행 취소 (편집기) |
| `Ctrl+Y` | 다시 실행 (편집기) |
| `Space` | 슬라이드 쇼 일시정지/재개 |
| `Esc` | 라이트박스 / 슬라이드 쇼 닫기 |

---

## 빠른 시작

### 사전 요구사항
- [Node.js](https://nodejs.org/) **18+**

### 소스 (개발용)

```bash
git clone https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm start
# 브라우저에서 http://localhost:8765 열기
```

커스텀 포트:

```bash
PORT=8080 npm start
```

### Windows 설치 프로그램 (bat 스크립트)

```
git clone -b windows-releases https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
install.bat          # %LOCALAPPDATA%\LumaStudio에 설치 + 바탕화면 바로가기 생성
```

바탕화면 바로가기를 더블클릭하여 시작. 스크립트는 Node.js가 없으면 자동으로 감지하고 설치합니다 (winget 또는 Chocolatey 경유).

### Electron 데스크톱

```
git clone -b electron https://github.com/IceFireIcer/LumaStudio.git
cd LumaStudio
npm install
npm run electron
```

> **참고**: Electron 버전은 이제 실행 및 빌드가 가능합니다. 소스 코드는 `electron` 브랜치에 있고, Windows 빌드 산출물은 `electron-releases` 브랜치에 있습니다.

---

## 프로젝트 구조

```
LumaStudio/
├── server.js              # Express 백엔드 + sharp 파이프라인 + REST API
├── electron-main.cjs      # Electron 메인 프로세스 (CJS)
├── package.json
├── public/
│   ├── index.html         # SPA 셸
│   ├── style.css          # 디자인 시스템
│   └── app.js             # 프론트엔드 로직
└── storage/               # 런타임에 자동 생성
    ├── uploads/            # 원본 및 처리된 이미지
    ├── thumbs/             # 생성된 WebP 썸네일
    └── data/               # db.json + settings.json
```

---

## API 레퍼런스

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| `GET` | `/api/photos` | 전체 사진 목록 |
| `GET` | `/api/photos/:id` | 사진 메타데이터 |
| `POST` | `/api/upload` | 이미지 업로드 |
| `DELETE` | `/api/photos/:id` | 사진 삭제 |
| `DELETE` | `/api/photos` | 전체 삭제 |
| `GET` | `/api/photos/:id/exif` | EXIF 읽기 |
| `POST` | `/api/photos/:id/exif` | EXIF 쓰기 (JPEG) |
| `POST` | `/api/photos/:id/strip-exif` | 전체 메타데이터 제거 |
| `POST` | `/api/photos/:id/process` | 편집 적용 및 저장 |
| `POST` | `/api/photos/:id/render` | 편집 적용 및 바이트 반환 |
| `POST` | `/api/photos/:id/preview` | 출력 크기 추정 |
| `POST` | `/api/photos/:id/rename` | 사진 이름 변경 |
| `GET` | `/api/settings` | 설정 조회 |
| `POST` | `/api/settings` | 설정 업데이트 |
| `GET` | `/api/stats` | 스토리지 통계 |
| `GET` | `/api/search` | 검색/필터 (`q`, `sort`, `stars`, `flag`, `format`, `album`) |
| `GET` | `/api/info` | 시스템 정보 |
| `POST` | `/api/photos/:id/stars` | 별점 설정 (0–5) |
| `POST` | `/api/photos/:id/flag` | 플래그 설정 (`pick` / `reject` / `null`) |
| `POST` | `/api/photos/batch/stars` | 일괄 별점 `{ ids, stars }` |
| `POST` | `/api/photos/batch/flag` | 일괄 플래그 `{ ids, flag }` |
| `POST` | `/api/photos/batch/delete` | 일괄 삭제 `{ ids }` |
| `POST` | `/api/photos/download-zip` | ZIP 다운로드 `{ ids }` |
| `GET` | `/api/albums` | 앨범 목록 |
| `POST` | `/api/albums` | 앨범 생성 `{ name }` |
| `DELETE` | `/api/albums/:id` | 앨범 삭제 |
| `POST` | `/api/albums/:id/rename` | 앨범 이름 변경 |
| `POST` | `/api/albums/:id/add` | 사진 추가 `{ ids }` |
| `POST` | `/api/albums/:id/remove` | 사진 제거 `{ ids }` |
| `GET` | `/files/:file` | 원본 제공 (`?download=1` 강제 다운로드) |
| `GET` | `/thumbs/:id.webp` | 썸네일 제공 |

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 백엔드 | [Express](https://expressjs.com/) |
| 이미지 처리 | [sharp](https://sharp.pixelplumbing.com/) (libvips) |
| EXIF 읽기 | [exifr](https://github.com/MikeKovarik/exifr) |
| EXIF 쓰기 | [piexifjs](https://github.com/hMatoba/piexifjs) |
| 업로드 | [multer](https://github.com/expressjs/multer) |
| ZIP | [yazl](https://github.com/thejoshwolfe/yazl) |
| 데스크톱 | [Electron](https://www.electronjs.org/) |
| 프론트엔드 | Vanilla JavaScript / HTML / CSS (프레임워크 없음, 빌드 단계 없음) |

---

## 참고사항

- **EXIF 쓰기**는 JPEG만 지원 (EXIF 표준 제한). UTF-8 / CJK 텍스트 완전 보존.
- **Windows**에서는 파일 핸들 잠금 방지를 위해 sharp 캐시가 비활성화됩니다 (`sharp.cache(false)`).
- **인증 없음** — 로컬/개인 사용을 위해 설계. 공개 인터넷에 직접 노출하지 마세요.

---

## 로드맵 및 기여

현재 상태, 알려진 문제, 예정된 기능은 [ROADMAP.md](ROADMAP.md)를 참조하세요.

---

## 라이선스

[Apache License 2.0](LICENSE) © 2026 [IceFire_Icer](https://github.com/IceFireIcer)
