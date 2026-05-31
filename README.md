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

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
```

Edit `backend\.env` and set:

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5-mini
OPENAI_REASONING_EFFORT=minimal
CORS_ALLOW_ORIGINS=*
```

For Expo Go on iPhone, keep the frontend API URL in the root `.env`:

```env
EXPO_PUBLIC_API_BASE_URL=http://<your-windows-ip>:8000
```

Start the API:

```powershell
npm run backend
```

Check it:

```powershell
Invoke-WebRequest http://localhost:8000/health
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
- Table of contents sheet for imported EPUB chapter navigation using EPUB nav/NCX `href#anchor` targets when available.
- Basic EPUB block styling for chapter titles, section headings, quotes, lists, and body text.
- WebView-based native reader surface on iOS/Android for real text selection.
- Native selection is captured into an app highlight so iOS menus do not stay on screen.
- Web fallback reader for browser preview.
- FastAPI backend for OpenAI-backed explanations.
- Reader-style chrome with title, text settings, page progress, and bottom navigation.
- Quick actions for `Explain`, `Example`, `Rephrase`, `Ask`, and `Copy`.
- Inline explanation card designed to keep the reader on the page.
- Optional ask-more sheet and save count.

## Next Steps

1. Persist imported books, highlights, notes, and saved explanations.
2. Persist chapter position and restore the last opened location.
3. Improve EPUB table-of-contents display for nested sections.
4. Add model routing so quick explanations stay cheap and deep discussion is deliberate.
5. Add PDF import after the EPUB reading flow is stable.
