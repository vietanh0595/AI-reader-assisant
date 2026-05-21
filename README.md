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

## Run On iPhone From Windows

1. Install Expo Go from the iPhone App Store.
2. Make sure the iPhone and Windows machine are on the same Wi-Fi.
3. Start or restart Expo from this project folder:

   ```bash
   npm start
   ```

4. Scan the QR code with the iPhone Camera app or Expo Go.
5. In the reader, long-press text, adjust the iOS selection handles, then release. The AI action bar should appear above the bottom navigation.

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
- Mock reading passage.
- WebView-based native reader surface on iOS/Android for real text selection.
- Native selection menu is reduced to a single `Copy` item; AI actions stay in the app bar.
- Web fallback reader for browser preview.
- Reader-style chrome with title, text settings, page progress, and bottom navigation.
- Quick actions for `Explain`, `Example`, `Rephrase`, and `Ask`.
- Inline explanation card designed to keep the reader on the page.
- Optional ask-more sheet and save count.

## Next Steps

1. Replace mock responses with an AI service boundary.
2. Add EPUB/PDF import and text extraction.
3. Persist highlights, notes, and saved explanations.
4. Add model routing so quick explanations stay cheap and deep discussion is deliberate.
