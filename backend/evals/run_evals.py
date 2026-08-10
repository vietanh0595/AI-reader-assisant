"""Run AI-quality evals against a running backend.

Deliberately hits the HTTP API directly rather than driving the app UI: the UI
adds a simulator, a WebView and ~30s per case while telling you nothing extra
about answer quality. Maestro covers "does the app work"; this covers "is the
answer any good".

Usage:
    export OPENAI_API_KEY=...            # for the judge
    python -m backend.evals.run_evals --base-url http://localhost:8000

    # against production (counts against the per-IP rate limit on /ai/assist)
    python -m backend.evals.run_evals --base-url https://ai-reader-api-h93e.onrender.com

Whole-book Ask cases additionally need a signed-in token and an indexed book:
    export EVAL_ACCESS_TOKEN=...  EVAL_BOOK_ID=...
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path
from typing import Any

import httpx
from openai import OpenAI

from .judge import DEFAULT_JUDGE_MODEL, Verdict, judge_answer, judge_ask_answer


CASES_PATH = Path(__file__).parent / "cases.json"
REQUEST_TIMEOUT = 120.0


def build_assist_payload(case: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "action": case["action"],
        "author": case["author"],
        "bookTitle": case["bookTitle"],
        "contextBlocks": case.get("contextBlocks", []),
        "contextScope": case.get("contextScope", "paragraph"),
    }

    # selectedText/selectionKind are required by the API unless action is summarize.
    for optional in ("selectedText", "selectionKind", "question"):
        if case.get(optional) is not None:
            payload[optional] = case[optional]

    return payload


def run_assist_case(client: httpx.Client, base_url: str, case: dict[str, Any]) -> dict[str, Any]:
    response = client.post(
        f"{base_url}/ai/assist",
        json=build_assist_payload(case),
        timeout=REQUEST_TIMEOUT,
    )

    if response.status_code == 429:
        raise RuntimeError(
            "Rate limited by /ai/assist (20 requests / 10 min per IP). "
            "Re-run with --limit, raise --delay, or wait out the window."
        )

    response.raise_for_status()
    return response.json()


def run_ask_case(
    client: httpx.Client,
    base_url: str,
    book_id: str,
    token: str,
    case: dict[str, Any],
) -> dict[str, Any]:
    response = client.post(
        f"{base_url}/library/books/{book_id}/ask",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "question": case["question"],
            "currentParagraphId": case.get("currentParagraphId", "p1"),
            "currentReadingOrder": case.get("currentReadingOrder", 0),
            "includeWholeBook": case.get("includeWholeBook", True),
            "allowGeneralKnowledge": case.get("allowGeneralKnowledge", False),
        },
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def format_row(case_id: str, verdict: Verdict) -> str:
    mark = "PASS" if verdict.passed else "FAIL"
    scores = verdict.scores
    compact = " ".join(f"{name[:4]}={value}" for name, value in scores.items())
    spoiler = "" if verdict.spoiler_free else " SPOILER"
    return f"  [{mark}] {case_id:<34} {compact}{spoiler}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.getenv("EVAL_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--cases", type=Path, default=CASES_PATH)
    parser.add_argument("--judge-model", default=os.getenv("EVAL_JUDGE_MODEL", DEFAULT_JUDGE_MODEL))
    parser.add_argument("--limit", type=int, default=None, help="Only run the first N assist cases")
    parser.add_argument("--only", default=None, help="Run a single case by id")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between API calls")
    parser.add_argument("--report", type=Path, default=None, help="Write a JSON report here")
    args = parser.parse_args()

    if not os.getenv("OPENAI_API_KEY"):
        print("OPENAI_API_KEY must be set (used by the judge).", file=sys.stderr)
        return 2

    cases = json.loads(args.cases.read_text())
    assist_cases = cases.get("assist", [])

    if args.only:
        assist_cases = [c for c in assist_cases if c["id"] == args.only]
    if args.limit:
        assist_cases = assist_cases[: args.limit]

    openai_client = OpenAI()
    results: list[dict[str, Any]] = []

    print(f"\nBackend: {args.base_url}")
    print(f"Judge:   {args.judge_model}\n")
    print(f"Assist cases ({len(assist_cases)}):")

    with httpx.Client() as http_client:
        for case in assist_cases:
            try:
                answer = run_assist_case(http_client, args.base_url, case)
            except Exception as error:  # noqa: BLE001 - surfaced in the report
                print(f"  [ERROR] {case['id']:<34} {error}")
                results.append({"id": case["id"], "error": str(error), "passed": False})
                continue

            body = answer.get("body", "")
            beyond_book = answer.get("beyond_book")
            verdict = judge_answer(
                openai_client, case, body, model=args.judge_model, beyond_book=beyond_book
            )

            # Deterministic check, not left to the judge: when a case declares the
            # expected attribution, a mismatch is a hard failure regardless of how
            # good the prose is.
            expected_flag = case.get("expectBeyondBook")
            flag_ok = expected_flag is None or beyond_book == expected_flag
            passed = verdict.passed and flag_ok

            mark = "PASS" if passed else "FAIL"
            compact = " ".join(f"{k[:4]}={v}" for k, v in verdict.scores.items())
            flag_note = f" beyond_book={beyond_book}"
            print(f"  [{mark}] {case['id']:<34} {compact}{flag_note}")

            if not flag_ok:
                print(f"         ↳ expected beyond_book={expected_flag}, got {beyond_book}")
            if not verdict.passed:
                print(f"         ↳ {verdict.rationale}")
                print(f"         ↳ answer: {body[:160]}")

            results.append(
                {
                    "id": case["id"],
                    "action": case["action"],
                    "eyebrow": answer.get("eyebrow"),
                    "answer": body,
                    "beyond_book": beyond_book,
                    "expected_beyond_book": expected_flag,
                    "passed": passed,
                    "scores": verdict.scores,
                    "spoiler_free": verdict.spoiler_free,
                    "rationale": verdict.rationale,
                }
            )
            time.sleep(args.delay)

    # Whole-book Ask cases need auth + an indexed book, so they are opt-in.
    token = os.getenv("EVAL_ACCESS_TOKEN")
    book_id = os.getenv("EVAL_BOOK_ID")
    ask_cases = cases.get("ask", [])

    if token and book_id and ask_cases:
        print(f"\nAsk cases ({len(ask_cases)}):")
        with httpx.Client() as http_client:
            for case in ask_cases:
                try:
                    payload = run_ask_case(http_client, args.base_url, book_id, token, case)
                except Exception as error:  # noqa: BLE001
                    print(f"  [ERROR] {case['id']:<34} {error}")
                    results.append({"id": case["id"], "error": str(error), "passed": False})
                    continue

                verdict = judge_ask_answer(
                    openai_client,
                    question=case["question"],
                    answer=payload.get("answer", ""),
                    citations=payload.get("sources", []),
                    expect_refusal=case.get("expectRefusal"),
                    model=args.judge_model,
                )
                print(format_row(case["id"], verdict))

                if not verdict.passed:
                    print(f"         ↳ {verdict.rationale}")

                results.append(
                    {
                        "id": case["id"],
                        "question": case["question"],
                        "answer": payload.get("answer", ""),
                        "citation_count": len(payload.get("sources", [])),
                        "passed": verdict.passed,
                        "scores": verdict.scores,
                        "rationale": verdict.rationale,
                    }
                )
                time.sleep(args.delay)
    elif ask_cases:
        print("\nAsk cases skipped — set EVAL_ACCESS_TOKEN and EVAL_BOOK_ID to run them.")

    scored = [r for r in results if "scores" in r]
    passed = [r for r in scored if r["passed"]]

    print("\n" + "=" * 62)
    print(f"Passed {len(passed)}/{len(results)} cases")

    if scored:
        for dimension in ("groundedness", "task_fit", "concision", "clarity"):
            mean = statistics.mean(r["scores"][dimension] for r in scored)
            print(f"  mean {dimension:<13} {mean:.2f}")

    if args.report:
        args.report.write_text(json.dumps(results, indent=2))
        print(f"\nReport written to {args.report}")

    return 0 if len(passed) == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
