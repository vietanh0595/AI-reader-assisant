# Maestro UI flows

End-to-end UI tests that drive the real app on a simulator or device.

Scope: **does the app work** — launches, navigates, renders, doesn't crash.
Whether an AI answer is any *good* is graded separately in `backend/evals/`.

## Setup

```bash
# one-time
curl -fsSL "https://get.maestro.mobile.dev" | bash
brew install openjdk                       # Maestro needs a JVM
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH:$HOME/.maestro/bin"
```

Maestro drives an *installed build*, so build to a simulator first:

```bash
npx expo run:ios          # first build is slow; subsequent runs are cached
```

Note this is a simulator build, not the TestFlight artifact — close, but not the
identical binary your testers install.

## Running

```bash
maestro test .maestro/01-smoke-launch.yaml     # single flow
maestro test .maestro/                         # everything
maestro studio                                 # interactive selector inspector
```

`maestro studio` is the fastest way to fix a broken selector — it shows the live
view hierarchy and what each element is matchable by.

## The flows

| Flow | Needs | Covers |
|---|---|---|
| `01-smoke-launch` | nothing | cold start, first-run state, reader shell renders |
| `02-summarize-page` | nothing | full AI round-trip: app → backend → OpenAI → answer card |
| `03-ask-the-book` | signed in + indexed book | agentic ask, conversation history, follow-up turns |
| `04-save-and-export-notes` | nothing | note persistence + export reachability |

Run `01` first. If it fails, nothing else is worth running.

## Known limitation: text selection is inside a WebView

The reader renders book text in a `react-native-webview`, and the select-text
gesture happens *inside* it. Maestro cannot reliably produce a native text
selection there, so the flows deliberately avoid the
`select text → Explain/Example/Rephrase` path even though it is the app's core
interaction.

Workarounds, in order of preference:

1. **`Summarize current page`** needs no selection and exercises the same
   backend path — that's why `02` uses it as the AI-pipeline canary.
2. Answer quality for every action *including* the selection-only ones is
   covered at the API layer in `backend/evals/`, which bypasses the UI entirely.
3. The selection gesture itself stays a manual test. Keep it on the pre-release
   manual checklist rather than pretending it's automated.

## Selectors

`App.tsx` has **zero `testID` props** today; these flows match on
`accessibilityLabel` strings ("Open library", "Ask the book", "Summarize current
page"). That works, but it means **renaming a label silently breaks a test**.

Worth doing as you touch the code: add `testID` to the controls these flows
depend on. It decouples tests from copy changes, and the accessibility labels
themselves benefit VoiceOver users — which matters for an app targeting academic
readers.

## What this can't tell you

Simulators have no real camera, so the Apple Vision OCR / camera-scan path is
untestable here and stays manual. Simulators also don't reproduce real-hardware
memory pressure or thermal behaviour — two failure modes that only show up on
actual devices under real reading sessions.
