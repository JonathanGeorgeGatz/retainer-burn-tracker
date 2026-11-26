#!/usr/bin/env python3
"""Retainer Burn Tracker -- independent rival implementation, written only from
/home/claude/ep43/rival/SPEC.md. Integer minutes and integer cents throughout.

CLI: python3 checker.py <retainers.csv> <worklog.csv> [roundMin expiryDays idleDays]
Defaults: roundMin=1, expiryDays=0, idleDays=60. Prints the audit result as JSON.
"""

import csv
import io
import json
import re
import sys
from datetime import date, timedelta

# ----------------------------------------------------------------------------
# Parsing primitives
# ----------------------------------------------------------------------------

_YMD = re.compile(r"(\d{4})-(\d{2})-(\d{2})$")
_MDY = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})$")
_DEC = re.compile(r"(-?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$")


def parse_date(s):
    """Real calendar date, YYYY-MM-DD or M/D/YYYY (leap rules). None if bad."""
    s = s.strip()
    m = _YMD.match(s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = _MDY.match(s)
        if not m:
            return None
        mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def _parse_plain_decimal(t):
    """Plain decimal, at most 2 decimal places. -> (neg, whole, fracstr) or None."""
    m = _DEC.match(t)
    if not m:
        return None
    neg = m.group(1) == "-"
    whole = int(m.group(2) or 0)
    frac = m.group(3) if m.group(3) is not None else (m.group(4) or "")
    if len(frac) > 2:
        return None
    return neg, whole, frac


def hours_to_minutes(s):
    """Signed integer minutes, or None if unparseable or not a whole minute."""
    p = _parse_plain_decimal(s.strip())
    if p is None:
        return None
    neg, whole, frac = p
    mins = whole * 60
    if frac:
        num = int(frac) * 60
        den = 10 ** len(frac)
        if num % den:
            return None  # e.g. 1.33 -> 79.8 min: not a whole minute
        mins += num // den
    return -mins if neg else mins


def rate_to_cents(s):
    """Signed integer cents, or None if unparseable (after stripping $ and ,)."""
    t = s.strip().replace("$", "").replace(",", "")
    p = _parse_plain_decimal(t)
    if p is None:
        return None
    neg, whole, frac = p
    cents = whole * 100 + int((frac + "00")[:2])
    return -cents if neg else cents


def client_key(s):
    """Trim, collapse internal whitespace runs to one space, uppercase."""
    return re.sub(r"\s+", " ", s.strip()).upper()


def cv(minutes, rate_cents):
    """Minute->money law: floor(minutes * rateCents / 60 + 0.5), integers only."""
    return (minutes * rate_cents + 30) // 60


def iso(d):
    return d.isoformat() if d is not None else None


# ----------------------------------------------------------------------------
# The audit (pure function)
# ----------------------------------------------------------------------------

def audit(retainers_csv, worklog_csv, round_min=1, expiry_days=0, idle_days=60):
    # ---- hard errors ------------------------------------------------------
    if retainers_csv.strip() == "":
        return {"error": "empty file: retainers"}
    if worklog_csv.strip() == "":
        return {"error": "empty file: worklog"}

    ret_rows = list(csv.reader(io.StringIO(retainers_csv)))
    wl_rows = list(csv.reader(io.StringIO(worklog_csv)))

    def header_map(rows):
        hm = {}
        if rows:
            for i, col in enumerate(rows[0]):
                k = col.strip().lower()
                if k not in hm:
                    hm[k] = i
        return hm

    rh = header_map(ret_rows)
    wh = header_map(wl_rows)
    for name in ("Client", "Date", "Hours", "Rate"):
        if name.lower() not in rh:
            return {"error": "missing required column: %s (retainers)" % name}
    for name in ("Date", "Client", "Hours"):
        if name.lower() not in wh:
            return {"error": "missing required column: %s (worklog)" % name}

    def field(row, idx):
        return row[idx] if idx is not None and idx < len(row) else ""

    refusals = []
    valid_dates = []
    total_rows = 0

    # ---- retainers --------------------------------------------------------
    blocks = []
    for ln, row in enumerate(ret_rows[1:], start=2):
        if not row:
            continue  # completely blank line: not a data row
        total_rows += 1
        d = parse_date(field(row, rh.get("date")))
        if d is None:
            refusals.append({"file": "retainers", "line": ln, "reason": "bad date"})
            continue
        valid_dates.append(d)
        client = field(row, rh.get("client")).strip()
        if client == "":
            refusals.append({"file": "retainers", "line": ln, "reason": "blank client"})
            continue
        mins = hours_to_minutes(field(row, rh.get("hours")))
        if mins is None or mins < 0:
            refusals.append({"file": "retainers", "line": ln, "reason": "bad hours"})
            continue
        if mins == 0:
            refusals.append({"file": "retainers", "line": ln, "reason": "zero hours"})
            continue
        cents = rate_to_cents(field(row, rh.get("rate")))
        if cents is None or cents <= 0:
            refusals.append({"file": "retainers", "line": ln, "reason": "bad rate"})
            continue
        blocks.append({"key": client_key(client), "date": d, "minutes": mins,
                       "rate": cents, "line": ln, "ord": len(blocks)})

    # ---- worklog (with exact-duplicate holding) ---------------------------
    kept_wl = []   # kept entries, file order; each carries a 'used' explainer flag
    held = []      # held duplicates
    for ln, row in enumerate(wl_rows[1:], start=2):
        if not row:
            continue
        total_rows += 1
        d = parse_date(field(row, wh.get("date")))
        if d is None:
            refusals.append({"file": "worklog", "line": ln, "reason": "bad date"})
            continue
        valid_dates.append(d)
        client = field(row, wh.get("client")).strip()
        if client == "":
            refusals.append({"file": "worklog", "line": ln, "reason": "blank client"})
            continue
        mins = hours_to_minutes(field(row, wh.get("hours")))
        if mins is None or mins < 0:
            refusals.append({"file": "worklog", "line": ln, "reason": "bad hours"})
            continue
        if mins == 0:
            refusals.append({"file": "worklog", "line": ln, "reason": "zero hours"})
            continue
        if mins > 1440:
            refusals.append({"file": "worklog", "line": ln, "reason": "hours too large"})
            continue
        note = field(row, wh.get("note")).strip() if "note" in wh else ""
        key = client_key(client)
        sig = (key, d, mins, note)
        explainer = None
        for e in kept_wl:
            if not e["used"] and e["sig"] == sig:
                explainer = e
                break
        if explainer is not None:
            explainer["used"] = True
            held.append({"key": key, "heldLine": ln,
                         "matchedLine": explainer["line"], "date": d, "minutes": mins})
        else:
            kept_wl.append({"sig": sig, "key": key, "date": d, "minutes": mins,
                            "line": ln, "used": False, "ord": len(kept_wl)})

    statement_end = max(valid_dates) if valid_dates else None

    # ---- the burn, per client, FIFO ---------------------------------------
    def round_up(m):
        return ((m + round_min - 1) // round_min) * round_min

    by_client = {}
    for b in blocks:
        by_client.setdefault(b["key"], {"blocks": [], "entries": []})["blocks"].append(b)
    for e in kept_wl:
        by_client.setdefault(e["key"], {"blocks": [], "entries": []})["entries"].append(e)

    clients_out = []
    unretained_out = []
    unretained_checks = []   # conservation bookkeeping for block-less clients
    forfeits_out = []

    for key, data in by_client.items():
        bl = sorted(data["blocks"], key=lambda b: (b["date"], b["ord"]))
        for b in bl:
            b["remaining_m"] = b["minutes"]
        ents = sorted(data["entries"], key=lambda e: (e["date"], e["ord"]))

        worked = 0
        burned_cents = 0
        over_min = 0
        over_cents = 0

        for e in ents:
            rm = round_up(e["minutes"])
            worked += rm
            need = rm
            for b in bl:
                if need == 0:
                    break
                if b["remaining_m"] <= 0:
                    continue
                if expiry_days and e["date"] > b["date"] + timedelta(days=expiry_days):
                    continue  # block expired as of the entry's date
                draw = min(need, b["remaining_m"])
                b["remaining_m"] -= draw
                need -= draw
                burned_cents += cv(draw, b["rate"])  # per (entry, block) segment
            if need > 0 and bl:
                over_min += need
                price = None
                for b in bl:  # sorted asc: last match = most recent on/before
                    if b["date"] <= e["date"]:
                        price = b["rate"]
                if price is None:
                    price = bl[0]["rate"]  # all blocks post-date the entry
                over_cents += cv(need, price)  # per entry

        purch_min = purch_cents = 0
        rem_min = rem_cents = 0
        forf_min = forf_cents = 0
        blocks_out = []
        for b in bl:
            purch_min += b["minutes"]
            purch_cents += cv(b["minutes"], b["rate"])  # per block
            left = b["remaining_m"]
            expired_at_end = (expiry_days > 0 and statement_end is not None and
                              statement_end > b["date"] + timedelta(days=expiry_days))
            if expired_at_end:
                b_rem, b_forf = 0, left
            else:
                b_rem, b_forf = left, 0
            rem_min += b_rem
            rem_cents += cv(b_rem, b["rate"])          # per block
            forf_min += b_forf
            forf_cents += cv(b_forf, b["rate"])        # per block
            blocks_out.append({"line": b["line"], "date": iso(b["date"]),
                               "minutes": b["minutes"], "rateCents": b["rate"],
                               "remaining": b_rem, "forfeited": b_forf})
            if b_forf > 0:
                forfeits_out.append({"key": key, "blockLine": b["line"],
                                     "blockDate": iso(b["date"]), "minutes": b_forf,
                                     "cents": cv(b_forf, b["rate"])})

        last_work = max((e["date"] for e in ents), default=None)
        idle_flag = bool(rem_min > 0 and (last_work is None or
                         (statement_end - last_work).days > idle_days))

        if bl:
            # §9 (clarified): clients[] holds ONLY clients with >= 1 kept block.
            clients_out.append({
                "key": key,
                "purchasedMin": purch_min, "purchasedCents": purch_cents,
                "workedMin": worked, "burnedCents": burned_cents,
                "overageMin": over_min, "overageCents": over_cents,
                "remainingMin": rem_min, "remainingCents": rem_cents,
                "forfeitedMin": forf_min, "forfeitedCents": forf_cents,
                "lastWorkDate": iso(last_work),
                "idle": idle_flag,
                "blocks": blocks_out,
            })
        else:
            unretained_out.append({"key": key, "minutes": worked, "entries": len(ents)})
            unretained_checks.append({"key": key, "workedMin": worked,
                                      "overageMin": over_min,
                                      "burnedCents": burned_cents})

    # ---- sorting -----------------------------------------------------------
    clients_out.sort(key=lambda c: (-c["overageCents"], -c["purchasedCents"], c["key"]))
    overage_out = sorted(
        [{"key": c["key"], "minutes": c["overageMin"], "cents": c["overageCents"]}
         for c in clients_out if c["overageMin"] > 0],
        key=lambda o: (-o["cents"], o["key"]))
    idle_out = sorted(
        [{"key": c["key"], "remainingMin": c["remainingMin"],
          "remainingCents": c["remainingCents"], "lastWorkDate": c["lastWorkDate"]}
         for c in clients_out if c["idle"]],
        key=lambda i: (-i["remainingCents"], i["key"]))
    unretained_out.sort(key=lambda u: u["key"])
    forfeits_out.sort(key=lambda f: (f["key"], f["blockLine"]))
    held.sort(key=lambda h: (h["key"], h["heldLine"]))
    duplicates_out = [{"key": h["key"], "heldLine": h["heldLine"],
                       "matchedLine": h["matchedLine"], "date": iso(h["date"]),
                       "minutes": h["minutes"]} for h in held]

    # ---- totals and banner -------------------------------------------------
    tot_purch = sum(c["purchasedCents"] for c in clients_out)
    tot_burned = sum(c["burnedCents"] for c in clients_out)
    tot_over_min = sum(c["overageMin"] for c in clients_out)
    tot_over_cents = sum(c["overageCents"] for c in clients_out)
    tot_rem = sum(c["remainingCents"] for c in clients_out)
    tot_forf = sum(c["forfeitedCents"] for c in clients_out)
    tot_unret = sum(u["minutes"] for u in unretained_out)
    if tot_purch > 0:
        # floor((overage/purchased*100)*10 + 0.5) / 10, integer-exact
        pct = ((tot_over_cents * 2000 + tot_purch) // (2 * tot_purch)) / 10
    else:
        pct = 0.0
    totals = {"purchasedCents": tot_purch, "burnedCents": tot_burned,
              "overageMin": tot_over_min, "overageCents": tot_over_cents,
              "remainingCents": tot_rem, "forfeitedCents": tot_forf,
              "unretainedMin": tot_unret, "overagePct": pct}
    banner = tot_over_cents * 10 > tot_purch

    # ---- self-audit (trust pass) ------------------------------------------
    # 1. refusal rate <= 10%  (integer-exact: refused*10 <= total data rows)
    c1 = len(refusals) * 10 <= total_rows

    # 2. minutes conservation, recomputed from the output lists
    c2 = True
    unret_by_key = {u["key"]: u["minutes"] for u in unretained_out}
    for c in clients_out:
        burned_min = sum(b["minutes"] - b["remaining"] - b["forfeited"]
                         for b in c["blocks"])
        if burned_min + c["overageMin"] != c["workedMin"]:
            c2 = False
        if burned_min + c["remainingMin"] + c["forfeitedMin"] != c["purchasedMin"]:
            c2 = False
    for u in unretained_checks:
        # unretained: excluded from overage; their worked minutes are unretained
        if (u["overageMin"] != 0 or u["burnedCents"] != 0 or
                unret_by_key.get(u["key"], 0) != u["workedMin"]):
            c2 = False

    # 3. purchased cross-check: flat per-block sum vs per-client-then-portfolio
    flat = sum(cv(b["minutes"], b["rateCents"])
               for c in clients_out for b in c["blocks"])
    c3 = flat == tot_purch

    # 4. duplicate explainers: exist, distinct, used at most once
    kept_lines = {e["line"] for e in kept_wl}
    used = set()
    c4 = True
    for h in held:
        ml = h["matchedLine"]
        if ml not in kept_lines or ml == h["heldLine"] or ml in used:
            c4 = False
        used.add(ml)

    sa_pass = c1 and c2 and c3 and c4
    self_audit = {"pass": sa_pass, "checks": [
        {"name": "refusal rate <= 10%", "pass": c1},
        {"name": "minutes conservation", "pass": c2},
        {"name": "purchased cross-check", "pass": c3},
        {"name": "duplicate explainers", "pass": c4},
    ]}

    rows = {"total": total_rows, "kept": len(blocks) + len(kept_wl),
            "refused": len(refusals), "held": len(held)}

    if sa_pass:
        return {
            "rows": rows,
            "refusals": refusals,
            "clients": clients_out,
            "overage": overage_out,
            "idle": idle_out,
            "unretained": unretained_out,
            "forfeits": forfeits_out,
            "duplicates": duplicates_out,
            "totals": totals,
            "banner": banner,
            "selfAudit": self_audit,
            "statementEnd": iso(statement_end),
        }
    # DO NOT TRUST THIS AUDIT: withhold every finding; refusals stay visible.
    return {
        "rows": rows,
        "refusals": refusals,
        "clients": [],
        "overage": [],
        "idle": [],
        "unretained": [],
        "forfeits": [],
        "duplicates": [],
        "totals": None,
        "banner": False,
        "withheld": True,
        "selfAudit": self_audit,
        "statementEnd": iso(statement_end),
    }


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------

def main(argv):
    if len(argv) < 3 or len(argv) > 6:
        sys.stderr.write("usage: python3 checker.py <retainers.csv> <worklog.csv> "
                         "[roundMin expiryDays idleDays]\n")
        return 2
    with open(argv[1], encoding="utf-8-sig", newline="") as f:
        ret_text = f.read()
    with open(argv[2], encoding="utf-8-sig", newline="") as f:
        wl_text = f.read()
    dials = [1, 0, 60]
    for i, a in enumerate(argv[3:6]):
        dials[i] = int(a)
    result = audit(ret_text, wl_text, dials[0], dials[1], dials[2])
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
