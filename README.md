# AI Book Reader

Prototype for a low-friction AI reading assistant. The current app focuses on the core MVP interaction:

```text
Select a confusing word, phrase, or passage
-> Explain | Example | Rephrase | Ask
-> short inline response
-> optional follow-up or saved note
```

## Run

```bash
npm install
npm run web
```

For mobile testing:

```bash
npm run android
npm run ios
```

The iOS command needs either macOS tooling or Expo's iOS device workflow. From Windows, use Expo Go or EAS Build for iOS testing.

## Backend Setup

The Expo app calls a local FastAPI backend for AI responses. Keep the OpenAI key on the backend only.

### macOS / Linux

```bash
docker compose up -d postgres
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
```

Edit `backend/.env` and fill in your real values (at minimum `OPENAI_API_KEY`). Then run the migration:

```bash
alembic -c backend/alembic.ini upgrade head
```

Start the API:

```bash
npm run backend
```

Check it:

```bash
curl http://localhost:8000/health
```

### Windows (PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
```

Edit `backend\.env` and set `OPENAI_API_KEY`. Then:

```powershell
npm run backend
Invoke-WebRequest http://localhost:8000/health
```

### Frontend environment

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to your machine's LAN IP:

```env
EXPO_PUBLIC_API_BASE_URL=http://<your-computer-wifi-ip>:8000
```

OIDC sign-in is optional. The sample book is always available without it. To enable personal imports and camera scan, also set the three `EXPO_PUBLIC_OIDC_*` variables in `.env`. The native callback URL is `aibookreader://`.

### Running tests

```bash
# Backend unit and integration tests (requires postgres-test container)
docker compose --profile test up -d postgres-test
pytest -c backend/pytest.ini backend/tests -v

# Frontend tests and type checking
npm test
npm run typecheck

# Web export smoke check
npx expo export --platform web
```

## Run On iPhone From Windows

1. Install Expo Go from the iPhone App Store.
2. Make sure the iPhone and Windows machine are on the same Wi-Fi.
3. Find your Windows machine's Wi-Fi IPv4 address:

   ```powershell
   ipconfig
   ```

4. Start or restart Expo from this project folder. Expo reads `EXPO_PUBLIC_API_BASE_URL` from the root `.env`:

   ```powershell
   npm start
   ```

   If that does not work, restart Expo with the backend URL set explicitly:

   ```powershell
   $env:EXPO_PUBLIC_API_BASE_URL="http://<your-windows-ip>:8000"
   npm start
   ```

5. Scan the QR code with the iPhone Camera app or Expo Go.
6. In the reader, long-press text, adjust the iOS selection handles, then release. The AI action bar should appear above the bottom navigation.
7. Tap the upload icon in the top-right reader toolbar to import an `.epub` file from Files.

If Expo says port `8081` is already in use, either accept the next suggested port or stop the old Expo process:

```powershell
Get-NetTCPConnection -LocalPort 8081 | Select-Object OwningProcess
Stop-Process -Id <OwningProcess>
```

If the iPhone cannot connect over Wi-Fi, restart Expo with tunnel mode:

```bash
npx expo start --tunnel
```

## Current Scope

- Expo + React Native + TypeScript.
- Sample reading passage.
- EPUB import from the device file picker.
- iOS PDF import with PDFKit text extraction, outline navigation, page-aware
  progress, and local Vision OCR fallback for image-only pages.
- Camera scan capture for one-page OCR imports.
- On-device Apple Vision OCR for iOS camera scans, with paragraph grouping and
  normalized source bounding boxes.
- Imported EPUB content is persisted locally after parsing.
- Library screen for multiple imported books, per-book resume progress, note counts, and imported-book removal.
- Table of contents sheet for imported EPUB chapter navigation using EPUB nav/NCX `href#anchor` targets when available.
- Basic EPUB block styling for chapter titles, section headings, quotes, lists, and body text.
- WebView-based native reader surface on iOS/Android for real text selection.
- Native selection is captured into an app highlight so iOS menus do not stay on screen.
- Web fallback reader for browser preview.
- Last visible paragraph is tracked and restored as the reading location for imported books.
- FastAPI backend for OpenAI-backed explanations.
- Reader-style chrome with title, text settings, page progress, and bottom navigation.
- Quick actions for `Explain`, `Example`, `Rephrase`, `Ask`, and `Copy`.
- Inline explanation card designed to keep the reader on the page.
- Optional ask-more sheet and saved-notes sheet.
- Saved explanations are persisted per book, can be filtered, searched, edited with a personal note, copied/exported to the clipboard, deleted, and reopened from the bottom bookmark tab.
- Reader search from the bottom navigation supports `Book`, `Notes`, and `All` scopes with paragraph-level jump results and saved-note jump results.
- Reader paragraphs, reading locations, search hits, saved notes, and copied note exports carry source metadata so future EPUB, PDF, scanned document, and sample content can share one anchor model.
- iOS scans are OCRed locally with Apple Vision and loaded into the same reader/search/save flow as EPUB/sample content. The backend OCR route remains a fallback for other platforms.
- Unsupported image file imports direct the user to the camera scanner instead of producing parser errors.

## Next Steps

1. Improve EPUB table-of-contents display for nested sections.
2. Add model routing so quick explanations stay cheap and deep discussion is deliberate.
3. Add file/share export for saved notes beyond clipboard copy.
4. Replace JSON-file persistence with a scalable database before large scanned/PDF libraries.
5. Add page thumbnails and source-PDF navigation to the PDF reader flow.
6. Expand camera OCR from one captured page to a multi-page scan workflow.
