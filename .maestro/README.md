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
maestro test --exclude-tags=destructive .maestro/   # the normal suite run
maestro test .maestro/06-clear-conversation.yaml    # a single flow
maestro studio                                      # interactive selector inspector
```

> **Always pass `--exclude-tags=destructive,setup` when running the folder.**
> Three flows are tagged `destructive` and must be run one at a time:
>
> - `01-smoke-launch` — `clearState: true` wipes imported books, saved notes
>   and your sign-in. Run it deliberately **before** setting up test data.
> - `07-auth-state` — signing out is the point, but it poisons `03`, `06` and
>   `09`, which need an account. Run it, then sign back in by hand.
> - `08-backend-failure` — needs a build pointed at a dead URL, so it is a
>   permanent red in a normal run. A test that always fails trains you to
>   ignore failures, which is worse than not having it.
>
> `setup-enable-whole-book-ai` is tagged `setup`: it triggers a one-time,
> paid indexing job, not a test.
>
> Naming a single file explicitly always runs it, tags or not.

`maestro studio` is the fastest way to fix a broken selector — it shows the live
view hierarchy and what each element is matchable by.

## The flows

| Flow | Needs | Covers |
|---|---|---|
| `01-smoke-launch` | nothing | cold start, first-run state, reader shell renders |
| `02-summarize-page` | nothing | full AI round-trip: app → backend → OpenAI → answer card |
| `03-ask-the-book` | signed in + indexed book | agentic ask, conversation history, follow-up turns |
| `04-save-and-export-notes` | nothing | note persistence + export reachability |
| `05-reading-position-persists` | **an imported book open** (not the sample) | position survives a full restart (guards the persistence layer) |
| `06-clear-conversation` | signed in + indexed book | clear is confirmed first; cancel cancels; thread empties |
| `07-auth-state` | starts signed in | sign-out leaves a working guest app |
| `08-backend-failure` | **build pointed at a dead URL** | fails loudly — named error + Retry, never a silent hang |
| `09-mind-map` | signed in + map already generated | opens, renders, chapter drill-down and back |

**Suggested order**, because `07-auth-state` signs you out and several flows need
an account: `01` (destructive, on its own) → set up test data → `02 03 04 05 06 09`
→ `07` last → `08` separately with its own build.

**Status: 01 and 02 pass against a real build (2026-08-13). 03-09 not yet run.**
Expect to fix a few selectors on the first pass — `maestro studio` is the fast
way to do that.

Two flows need a specially-built app rather than the normal one:

- `08-backend-failure` needs a build whose API URL points nowhere:
  `EXPO_PUBLIC_API_BASE_URL=https://127.0.0.1:9 npx expo run:ios`. The URL is
  baked in at build time, so this cannot be faked at runtime — and this flow
  will correctly fail against a healthy build.
- `09-mind-map` deliberately does not trigger generation. That is a multi-minute
  background job fanning out expensive `gpt-4o` calls; it belongs in backend
  tests and the manual checklist, not a UI loop.
- `05-reading-position-persists` needs an **imported** book open. For the bundled
  sample, `getReaderProgress()` returns hardcoded page/progress strings that
  never change while reading, so there would be no position to compare.

## A note on writing assertions here

Two traps worth avoiding, both hit while writing these flows:

1. **`optional: true` on the assertion that IS the test.** A flow whose only
   check is optional passes while verifying nothing. Reserve `optional` for
   incidental steps (a confirm dialog that may not appear), never for the thing
   you are actually proving.
2. **Matching by `id:` when the app has no `testID`s.** `App.tsx` currently has
   zero, so any `id:` selector silently matches nothing. Match on visible text or
   `accessibilityLabel` until testIDs exist.

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
