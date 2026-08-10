# AI response quality evals

Automated grading of what the assistant actually *says* — not whether buttons work.

## Why this is separate from the UI tests

Answer quality is evaluated by calling the HTTP API directly, never by driving
the app. The UI contributes nothing to whether an answer is good, but it costs a
simulator, a WebView and ~30s per case. Splitting them means:

| Question | Tool |
|---|---|
| Does the app work? (crashes, flows, rendering) | `.maestro/` |
| Is the answer any good? (grounded, on-task, concise) | this directory |

## Running

```bash
export OPENAI_API_KEY=...          # used by the judge
python -m backend.evals.run_evals --base-url http://localhost:8000

# or against production (counts toward the 20 req / 10 min per-IP limit)
python -m backend.evals.run_evals --base-url https://ai-reader-api-h93e.onrender.com

# useful flags
--only groundedness-trap-undefined-term   # single case
--limit 3                                 # first N cases
--report out.json                         # machine-readable results
```

Exit code is non-zero if any case fails, so this can gate a release.

Whole-book **Ask** cases are opt-in — they need auth and an indexed book:

```bash
export EVAL_ACCESS_TOKEN=...   # a real bearer token
export EVAL_BOOK_ID=...        # an indexed book's UUID
```

## How grading works

`judge.py` sends a stronger model (default `gpt-4o`) the answer **plus the exact
context the app had**, and asks for scores 1-5 on:

- **groundedness** — every claim traceable to the supplied context
- **task_fit** — did it perform the *requested* action (`explain` ≠ `example` ≠ `rephrase`)
- **concision** — respects the app's compact-answer rule
- **clarity** — plain language, not condescending

Plus a `spoiler_free` boolean. A case passes on `groundedness >= 4`, `task_fit >= 4`,
`clarity >= 3`, and no spoiler. Concision is *tracked but not gating* — a slightly
long answer is a P2; an ungrounded one is a correctness bug.

Giving the judge the source context is the whole point. A judge that sees only the
answer can tell you it reads well; it cannot tell you the model invented a
definition the passage never gave.

## The cases

`cases.json` holds normal cases plus deliberate **traps** for failure modes this
codebase has actually shipped:

- `groundedness-trap-undefined-term` — a passage that *names* a concept while
  explicitly deferring its explanation. A model that supplies a confident outside
  definition fails. **This currently fails** — see the note in the release plan.
- `spoiler-trap-forward-reference` — asks what happens later; the prompt forbids it.
- `example-abstract-concept` — the passage draws a distinction; a lazy example
  picks the excluded side.
- `ask-hybrid-must-not-refuse` — regression guard for the bug in
  `docs/superpowers/specs/2026-06-29-hybrid-quick-ask-design.md`, where
  example-intent chips wrongly returned "not enough information".
- `ask-unanswerable-should-refuse` — the inverse: grounded mode *must* refuse.

The last two matter together. Grounding is a trade-off, not a score to maximise:
tightening it causes wrong refusals, loosening it causes confabulation. Testing
both directions is what stops a prompt tweak from silently fixing one and
breaking the other.

## Extending

Add cases as you find real failures — an eval case is the cheapest possible
regression test for prompt changes, which are otherwise untestable. Passages in
`cases.json` are self-contained on purpose so they don't drift when the sample
book changes.

## Cost

Each case is one app call plus one judge call. The 8 default assist cases run for
roughly $0.10. Keep that in mind before wiring this into a per-commit CI job —
nightly, or pre-release, is the sensible cadence.
