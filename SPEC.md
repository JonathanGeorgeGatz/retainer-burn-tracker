# The Retainer Burn Tracker — SPEC (the law)

A single-file, offline HTML tool for service businesses that sell blocks of hours. It takes
the two lists any retainer shop already keeps — hours purchased and hours worked — and makes
every worked minute prove which purchased block paid for it. It names the hours worked with
no money behind them, the money sitting idle with no work against it, the clients working
off no retainer at all, and it refuses what it cannot read, line by line.

## 1. Inputs

Two CSV files, each with a header row; columns matched case-insensitively after trimming;
extra columns ignored; rows processed in file order.

- **Retainers** (blocks purchased): `Client`, `Date`, `Hours`, `Rate`, `Ref`.
- **Worklog** (work performed): `Date`, `Client`, `Hours`, `Note`.

## 2. Row validation (refusals)

Time is held as INTEGER MINUTES, money as INTEGER CENTS. No floats in totals.

A row is REFUSED, with its file, line number and a canonical reason, on the first failing
check in this order:
1. `bad date` — not a real calendar date, `YYYY-MM-DD` or `M/D/YYYY` (leap rules apply).
2. `blank client` — Client empty after trimming.
3. `bad hours` — Hours does not parse: strip whitespace; must be a plain decimal with at
   most 2 decimal places; after × 60 it must land on a whole minute (`1.25` = 75 min is
   valid; `1.33` = 79.8 min is refused); negative values are refused with this reason too.
4. `zero hours` — parses to exactly 0 minutes.
5. `hours too large` — (Worklog only) a single work entry over 24 hours (1440 minutes).
   Retainer blocks may be any positive size.
6. `bad rate` — (Retainers only) Rate does not parse: strip `$`, `,`; plain decimal, max 2
   decimals, converted to cents; zero or negative refused with this reason.
A missing `Ref`/`Note` is allowed (empty string).

## 3. Client key

Trim, collapse internal whitespace runs to one space, uppercase. `alderbrook dental ` and
`Alderbrook  Dental` are the same client.

## 4. Duplicates (worklog)

In file order: a worklog row whose (client key, date, minutes, trimmed Note) all equal an
earlier kept, not-already-held worklog row's is HELD as a duplicate (each earlier row
explains at most one held row). Held rows are excluded from all burn math; they are listed
with both line numbers. Retainer rows are never held.

## 5. The burn (per client, FIFO)

Statement end = the latest date that parses as a real calendar date across both files' data
rows, whether or not the row is later refused on another check or held as a duplicate.
Date forms are strict: `YYYY-MM-DD` means zero-padded 4-2-2 (`2026-1-5` is `bad date`);
`M/D/YYYY` allows 1–2 digit month and day with a 4-digit year.

Per client: retainer blocks sorted by date (ties by file order), each with `remaining` =
its minutes; worklog entries sorted by date (ties by file order).

**Rounding dial**: each kept worklog entry's minutes are first rounded UP to the nearest
increment — 1 (none), 6, or 15 minutes. DEFAULT 1.

**Expiry dial** — 0 (never), 90, or 180 days; DEFAULT 0: a block expires `expiry` days
after its purchase date (work dated ≤ purchase date + expiry may draw from it; with 0, no
block ever expires).

Each worklog entry, in date order, draws its minutes from the oldest block that still has
remaining minutes and (under the dial) has not expired as of the ENTRY's date. A single
entry may span blocks. Minutes with no eligible block left are **OVERAGE minutes** for that
entry.

- An overage minute is priced at the rate of the client's most recent block dated on or
  before the entry's date; if the client's blocks all post-date the entry, the client's
  earliest block's rate.
- A client with worklog rows but NO retainer rows at all is **UNRETAINED**: its entries are
  listed with total minutes, priced at nothing (no rate exists), and excluded from overage.
- After all entries: each block's leftover minutes are `remaining` if the block is unexpired
  at statement end, otherwise **FORFEITED** (listed with the block, priced at its rate).

### Minute→money conversion (exact law)

A span of minutes at a block rate converts to cents as
`floor(minutes × rateCents / 60 + 0.5)` (round half up). The conversion is applied at the
finest grain and then summed: per (entry, block) draw segment for burned cents; per entry
for overage cents; per block for purchased, remaining and forfeited cents. Aggregates are
sums of these integers, never re-converted.

## 6. Idle balances

**Idle dial** — 30, 60, or 90 days; DEFAULT 60: a client whose unexpired remaining balance
is > 0 minutes and whose latest kept worklog entry (if any) is more than `idle` days before
statement end — or who has no worklog at all — is IDLE. Report remaining minutes and value
(Σ remaining minutes × their own block's rate).

## 7. Totals and the banner

Per client and portfolio-wide, in cents and minutes: purchased (Σ block minutes × rate),
burned (minutes drawn × their block's rate), overage (minutes and $ as priced in §5),
remaining value, forfeited value, unretained minutes.

**Banner: when overage dollars exceed 10.0% of purchased dollars (integer-exact:
`overage × 10 > purchased`), the page prints DO NOT EAT THESE HOURS.**

## 8. Self-audit (trust pass)

ALL must hold, or the page prints **DO NOT TRUST THIS AUDIT** and withholds every finding
(refusals stay visible). Withheld output shape: `clients`, `overage`, `idle`, `unretained`,
`forfeits`, `duplicates` emptied to `[]`, `totals` null, `banner` false, `withheld: true`;
`rows`, `refusals`, `selfAudit`, `statementEnd` stay.
1. Refused rows ≤ 10% of all data rows (both files combined).
2. Minutes conservation, recomputed from the lists: for every client,
   burned + overage = Σ kept rounded worklog minutes, and
   burned + remaining + forfeited = Σ purchased minutes.
3. Portfolio purchased cents recomputed a second way (per-block conversions summed flat
   across all blocks, vs summed per client and then across clients) match to the cent.
4. Every held duplicate's explaining row exists, is distinct, used at most once.

## 9. Output

Pure function: `audit(retainersCsv, worklogCsv, {roundMin, expiryDays, idleDays})` →

```
{
  rows: {total, kept, refused, held},
  refusals: [{file: "retainers"|"worklog", line, reason}],
  clients: [{key, purchasedMin, purchasedCents, workedMin, burnedCents, overageMin,
             overageCents, remainingMin, remainingCents, forfeitedMin, forfeitedCents,
             lastWorkDate|null, idle, blocks:[{line, date, minutes, rateCents, remaining,
             forfeited}]}],   // blocks[].forfeited = forfeited MINUTES (integer, 0 when
                              // none); remaining = unexpired leftover minutes (0 when the
                              // block's leftover was forfeited)
  overage: [{key, minutes, cents}],            // clients with overage > 0
  idle: [{key, remainingMin, remainingCents, lastWorkDate|null}],
  unretained: [{key, minutes, entries}],
  forfeits: [{key, blockLine, blockDate, minutes, cents}],
  duplicates: [{key, heldLine, matchedLine, date, minutes}],
  totals: {purchasedCents, burnedCents, overageMin, overageCents, remainingCents,
           forfeitedCents, unretainedMin, overagePct},
  banner: true|false,
  selfAudit: {pass, checks: [{name, pass}]},
  statementEnd: "YYYY-MM-DD"
}
```

The `clients` array contains ONLY clients with at least one kept retainer block; a client
with worklog rows and no blocks appears only in `unretained`.
Sorting: refusals by (file: retainers first, then worklog; line); clients by overageCents
desc, then purchasedCents desc, then key; overage by cents desc then key; idle by
remainingCents desc then key; unretained, forfeits, duplicates by key then line. Dates as
`YYYY-MM-DD`. `overagePct` = overage/purchased × 100, rounded half-away-from-zero to one
decimal (`floor(x*10+0.5)/10`); 0 when purchased = 0. Self-audit check names, exactly:
`refusal rate <= 10%`, `minutes conservation`, `purchased cross-check`,
`duplicate explainers`.

Errors: `{"error": "empty file: <which>"}` for an empty/whitespace-only input ("retainers"
or "worklog"), `{"error": "missing required column: <Name> (<which>)"}` for the first
missing column, checking Retainers' columns (Client, Date, Hours, Rate) then Worklog's
(Date, Client, Hours).

## 10. No network, no accounts

One HTML file, fully offline; the test suite runs it with the network blocked.
