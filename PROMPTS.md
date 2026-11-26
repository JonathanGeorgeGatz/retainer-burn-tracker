# The three prompts, exactly as sent (Build It With AI — Episode 43)

## Prompt 1 — the opening ask (produces v1.html, kept in this kit)

> Here are two CSVs from my studio: the retainer blocks clients have bought (Client, Date,
> Hours, Rate, Ref) and our worklog (Date, Client, Hours, Note). Build one self-contained
> HTML file, fully offline, that tells me where we stand on retainers — who's used what,
> what's left, and whether we're working hours nobody paid for.

## Prompt 2 — spelling it out (produces v2.html, kept in this kit)

> Rebuild it per client, never one pool. Track each retainer block separately with its own
> rate and date. Match work to blocks over time, show hours worked past the purchased money
> priced in dollars, flag balances going stale, and point out clients whose records look
> wrong. Make it strict.

## Prompt 3 — the law (produces Retainer_Burn_Tracker.html)

> Start over from this spec sheet and implement it exactly — it is the law, not a
> suggestion. Time lives as whole minutes, money as whole cents. A row you cannot read — an
> impossible date, hours typed as words, a blank client, a broken rate — is refused aloud
> with its line number, never silently dropped. An exact duplicate work entry is held and
> named, not counted twice. Work burns each client's oldest block first, oldest money
> spends first, and a single entry may span blocks. A minute with no block behind it is
> overage, priced at that client's own rate — and a client with no retainer on file is its
> own list, not somebody else's problem. Three dials stay with the owner: the rounding
> increment, whether blocks expire, and what counts as idle. When overage passes ten
> percent of everything purchased, print DO NOT EAT THESE HOURS. The page re-checks its own
> arithmetic every run, and when more than a tenth of the file is unreadable it refuses to
> vouch for anything: DO NOT TRUST THIS AUDIT, findings withheld. Full spec attached:
> SPEC.md.

*(The independent Python checker in this kit — checker.py — was written by a separate
session from SPEC.md alone, blind to the page's code; the two implementations ran 216
complete audits head to head, 26,178 values compared, zero disagreements.)*
