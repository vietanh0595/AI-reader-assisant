# AI Book Reader Handoff

## Project Context

This is an Expo React Native app for an AI-assisted book reader. The core idea is
low-friction reading help: users select text in a book and get fast actions like
Explain, Example, Rephrase, Ask, and Copy without leaving the reading flow.

Current architecture:

- Frontend: Expo + React Native + TypeScript.
- Native reader: `react-native-webview` for iOS/Android text selection.
- Backend: FastAPI under `backend/app`.
- AI endpoint: `POST /ai/assist`.
- OCR endpoint: `POST /ocr/extract` remains available as a cloud fallback.
- iOS camera scans use the local Expo module under `modules/apple-vision-ocr`
  and Apple's Vision `VNRecognizeTextRequest`, so normal iPhone scans do not
  upload the page or depend on OpenAI OCR.
- iOS PDF imports use the local Expo module under `modules/apple-pdf-import`.
  PDFKit extracts selectable text and document outlines; image-only pages fall
  back to on-device Vision OCR. Imported blocks retain page labels, page indices,
  and normalized bounding boxes.
- PDF reflow uses line geometry and relative text height for headings. Dense
  all-caps contents pages are emitted as compact headings/list items, PDFKit
  fragments on the same visual line are merged, and decorative cover/publisher
  signup pages are omitted from the text stream.
- EPUB import/parser: `epub.ts`.
- Imported EPUB content is converted into paragraph blocks with `blockKind`.
- Table of contents navigation uses EPUB nav/NCX `href#anchor` targets when available.
- Reader state now persists as a small local library of books, not only one
  current book. Each library item stores its own reading location and saved
  insights.
- Bottom navigation includes scoped search across Book, Notes, or All with
  paragraph-level jump results and saved-note jump results.
- Saved notes can be filtered by action type, searched, edited with a personal
  note, copied/exported to the clipboard, deleted, and reopened from the
  saved-notes sheet.
- Reader document source typing now allows `epub`, `pdf`, `scan`, and `sample`
  sources. Reader paragraphs, reading locations, search hits, saved notes, and
  copied note exports carry source references so OCR/PDF chunks can later point
  back to pages, blocks, or bounding boxes.
- Unsupported image file imports show an intentional camera-scan message instead
  of falling through to EPUB parser errors.
- Camera scan capture is implemented for one-page OCR imports. On iOS, captured
  pages are recognized on-device with Apple Vision, grouped into paragraphs,
  and loaded as `scan` source books in the same reader/search/save flow. Other
  platforms retain the backend OCR fallback.

Current limitations:

- Local persistence is still MVP JSON-file storage, not a scalable library database.
  Source references are stored there for now, but large scanned/PDF libraries
  should move to a database.
- EPUB rendering is basic and does not implement full Apple Books-style pagination.
- Table of contents display is flat, even when the EPUB has nested sections.
- Saved-note export is clipboard-based only; file/share export is not implemented yet.
- PDF import is currently iOS-only. Image-only PDFs are limited to 40 OCR pages
  per import so a large scanned book does not block the app for several minutes.
- OCR is one captured page at a time; multi-page scan/PDF workflows and page
  thumbnails are not implemented yet. Apple Vision scan blocks include
  normalized bounding boxes for future source-image navigation.

## Local Setup

Do not commit real `.env` files. They are intentionally ignored by `.gitignore`.

Install dependencies:

```bash
npm install
```

Create the root `.env` file:

```env
EXPO_PUBLIC_API_BASE_URL=http://<your-computer-wifi-ip>:8000
```

For a Mac on Wi-Fi, get the local IP with:

```bash
ipconfig getifaddr en0
```

If that returns nothing, try:

```bash
ipconfig getifaddr en1
```

Create `backend/.env`:

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5-mini
OPENAI_REASONING_EFFORT=minimal
CORS_ALLOW_ORIGINS=*
```

Set up Python backend dependencies on macOS or Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

Set up Python backend dependencies on Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

Start the backend:

```bash
npm run backend
```

In a second terminal, start Expo:

```bash
npm start
```

For Expo Go on a physical iPhone, the phone and computer must be on the same
Wi-Fi network, and `EXPO_PUBLIC_API_BASE_URL` should use the computer's LAN IP,
not `localhost`.

## Verification

Run TypeScript validation:

```bash
npm run typecheck
```

Run a web export smoke check:

```bash
npx expo export --platform web
```

Check the backend health endpoint:

```bash
curl http://localhost:8000/health
```

## Codex Notes

When continuing in Codex on another machine, open this repository folder in
Local mode. Important files to inspect first:

- `App.tsx` - main reader UI, WebView rendering, selection actions, EPUB import.
- `epub.ts` - EPUB parsing, TOC mapping, block-kind inference.
- `backend/app/main.py` - FastAPI app and routes.
- `backend/app/openai_assistant.py` - OpenAI Responses API integration.
- `backend/app/schemas.py` - backend request/response contracts.
- `README.md` - user-facing setup and current scope.

Preserve the current low-friction reading UX: AI help should appear as an
inline reader action, not as a chat-first experience.
