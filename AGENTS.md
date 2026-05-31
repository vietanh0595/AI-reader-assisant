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
- EPUB import/parser: `epub.ts`.
- Imported EPUB content is converted into paragraph blocks with `blockKind`.
- Table of contents navigation uses EPUB nav/NCX `href#anchor` targets when available.

Current limitations:

- Imported books are not persisted yet.
- Reading position is not persisted yet.
- PDF import is not supported yet.
- EPUB rendering is basic and does not implement full Apple Books-style pagination.
- Table of contents display is flat, even when the EPUB has nested sections.

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
