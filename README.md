# The Retainer Burn Tracker — free tool (Build It With AI, Episode 43)

Two exports in — the retainer blocks your clients bought, and your worklog — and every
worked minute proves which block paid for it. The hours nobody paid for, the balances
sitting idle, the client working off no retainer at all: named, priced, refused-if-unreadable.
Fully offline — one HTML file, no account, nothing leaves your machine.

## Files

- **Retainer_Burn_Tracker.html** — the tool. Open in any browser; click *Load the
  Thistledown sample* or load your own two CSVs.
- **sample/retainers.csv + sample/worklog.csv** — Thistledown Digital, a fictional
  6-person web & marketing studio: 8 retainer clients plus one who never signed one,
  362 rows, Oct 2025 – Nov 2026. Every client is invented.
- **sample/wrecked_worklog.csv** — the same worklog with dates mangled, to show the
  DO NOT TRUST THIS AUDIT refusal.
- **v1.html / v2.html** — the two wrong builds from the episode, runnable, lies annotated
  in the source. v1 pools every client into one number ("You are 88.38 hours over. Bill
  somebody."). v2 invents a 30-day expiry rule and announces $40,982 "expired or owed" —
  about eight times the real figure. Don't run your business on either.
- **SPEC.md** — the law the real tool implements.
- **PROMPTS.md** — the three prompts, exactly as sent on camera.
- **checker.py** — an independent Python implementation written from SPEC.md alone, blind
  to the page's code. `python3 checker.py retainers.csv worklog.csv [roundMin expiryDays
  idleDays]` prints the full audit as JSON. Run both; they must agree.
- **engine.js / engine_v1.js / engine_v2.js** — the page engines as standalone files.

## Your own books

Export or paste your retainer purchases as `Client, Date, Hours, Rate, Ref` and your time
log as `Date, Client, Hours, Note` (extra columns are ignored; hours as decimals that land
on whole minutes — 1.25 is fine, 1.33 is refused on purpose). Then open the tool.

What it will not do: it reads lists, not contracts. Whether an overage gets billed,
forgiven, or renegotiated stays your call — the page only makes sure that call is made on
purpose, with the number in front of you.

## The numbers behind the episode

Audits are deterministic. The shipping build passed: 216 cross-implementation audits
(every dial combination × the sample + 7 edge/wreck set pairs), 26,178 values compared,
0 disagreements; 46 automated browser checks with the network blocked throughout; five
deliberate sabotages of the engine — FIFO flipped, expiry unhooked, duplicates disarmed,
overage dropped, rounding bent — each caught by the blind checker before the real engine
went back in.

Sample data is fictional. No warranty; audit your own books before acting on anything.
