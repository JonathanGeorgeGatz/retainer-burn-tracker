/* The Retainer Burn Tracker - engine (the law). Pure function, no DOM, no network.
   audit(retainersCsv, worklogCsv, {roundMin, expiryDays, idleDays}) per SPEC.md */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RetainerBurn = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function parseCSV(text) {
    const rows = []; let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); }
    return rows;
  }

  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  function parseDate(s) {
    s = s.trim(); let y, m, d, mm;
    if ((mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
    else if ((mm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) { m = +mm[1]; d = +mm[2]; y = +mm[3]; }
    else return null;
    if (m < 1 || m > 12 || d < 1) return null;
    const max = m === 2 && leap(y) ? 29 : DAYS[m - 1];
    if (d > max) return null;
    return { y, m, d };
  }
  function epochDays(dt) {
    let { y, m, d } = dt; y -= m <= 2 ? 1 : 0;
    const era = Math.floor(y / 400), yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
  }
  const iso = dt => `${String(dt.y).padStart(4, "0")}-${String(dt.m).padStart(2, "0")}-${String(dt.d).padStart(2, "0")}`;

  function parseHoursToMin(s) { // -> minutes int, or null; negative -> {neg:true}
    s = String(s).trim();
    const mm = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!mm) return null;
    const frac = (mm[3] || "").padEnd(2, "0");
    const hund = parseInt(mm[2], 10) * 100 + parseInt(frac || "0", 10); // hours*100
    if (hund * 60 % 100 !== 0) return { badMinute: true };
    const min = hund * 60 / 100;
    return { min, neg: mm[1] === "-" };
  }
  function parseRateCents(s) {
    s = String(s).trim().replace(/\$/g, "").replace(/,/g, "");
    const mm = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!mm) return null;
    const cents = parseInt(mm[2], 10) * 100 + parseInt((mm[3] || "").padEnd(2, "0") || "0", 10);
    return mm[1] === "-" ? -cents : cents;
  }
  const ckey = s => s.trim().replace(/\s+/g, " ").toUpperCase();
  const toCents = (minutes, rateCents) => Math.floor(minutes * rateCents / 60 + 0.5);
  const round1 = x => Math.floor(x * 10 + 0.5) / 10;

  function audit(retCsv, workCsv, opts) {
    const roundMin = opts && opts.roundMin !== undefined ? opts.roundMin : 1;
    const expiryDays = opts && opts.expiryDays !== undefined ? opts.expiryDays : 0;
    const idleDays = opts && opts.idleDays !== undefined ? opts.idleDays : 60;

    const rRaw = parseCSV(retCsv), wRaw = parseCSV(workCsv);
    if (!rRaw.length || rRaw.every(r => r.join("").trim() === "")) return { error: "empty file: retainers" };
    if (!wRaw.length || wRaw.every(r => r.join("").trim() === "")) return { error: "empty file: worklog" };
    const rh = rRaw[0].map(h => h.trim().toLowerCase());
    const wh = wRaw[0].map(h => h.trim().toLowerCase());
    for (const [col, name] of [["client", "Client"], ["date", "Date"], ["hours", "Hours"], ["rate", "Rate"]])
      if (rh.indexOf(col) < 0) return { error: `missing required column: ${name} (retainers)` };
    for (const [col, name] of [["date", "Date"], ["client", "Client"], ["hours", "Hours"]])
      if (wh.indexOf(col) < 0) return { error: `missing required column: ${name} (worklog)` };
    const rc = { client: rh.indexOf("client"), date: rh.indexOf("date"), hours: rh.indexOf("hours"), rate: rh.indexOf("rate"), ref: rh.indexOf("ref") };
    const wc = { date: wh.indexOf("date"), client: wh.indexOf("client"), hours: wh.indexOf("hours"), note: wh.indexOf("note") };

    const refusals = [], blocks = [], entries = [];
    let endEp = null, endDt = null;
    function checkRow(file, line, dateS, clientS, hoursS, rateS, capMinutes) {
      const dt = parseDate(dateS || "");
      if (!dt) { refusals.push({ file, line, reason: "bad date" }); return null; }
      const ep0 = epochDays(dt);
      if (endEp === null || ep0 > endEp) { endEp = ep0; endDt = dt; }
      if ((clientS || "").trim() === "") { refusals.push({ file, line, reason: "blank client" }); return null; }
      const h = parseHoursToMin(hoursS || "");
      if (h === null || h.badMinute || h.neg) { refusals.push({ file, line, reason: "bad hours" }); return null; }
      if (h.min === 0) { refusals.push({ file, line, reason: "zero hours" }); return null; }
      if (capMinutes && h.min > capMinutes) { refusals.push({ file, line, reason: "hours too large" }); return null; }
      let rate = undefined;
      if (rateS !== undefined) {
        rate = parseRateCents(rateS || "");
        if (rate === null || rate <= 0) { refusals.push({ file, line, reason: "bad rate" }); return null; }
      }
      return { dt, ep: epochDays(dt), key: ckey(clientS), min: h.min, rate };
    }
    for (let i = 1; i < rRaw.length; i++) {
      const r = rRaw[i];
      const v = checkRow("retainers", i + 1, r[rc.date], r[rc.client], r[rc.hours], r[rc.rate] || "", 0);
      if (v) blocks.push({ ...v, line: i + 1, remaining: v.min, idx: blocks.length });
    }
    for (let i = 1; i < wRaw.length; i++) {
      const r = wRaw[i];
      const v = checkRow("worklog", i + 1, r[wc.date], r[wc.client], r[wc.hours], undefined, 1440);
      if (v) entries.push({ ...v, line: i + 1, note: (wc.note >= 0 ? r[wc.note] || "" : "").trim(), held: false, idx: entries.length });
    }
    const totalRows = (rRaw.length - 1) + (wRaw.length - 1);

    // statement end was tracked during validation (any row whose date parses)

    // duplicates (worklog, file order)
    const dupOut = [];
    const usedBase = new Set();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      for (let j = 0; j < i; j++) {
        const b = entries[j];
        if (b.held || usedBase.has(b) || b.key !== e.key || b.ep !== e.ep || b.min !== e.min || b.note !== e.note) continue;
        e.held = true; usedBase.add(b);
        dupOut.push({ key: e.key, heldLine: e.line, matchedLine: b.line, date: iso(e.dt), minutes: e.min });
        break;
      }
    }

    const byDate = (a, b) => a.ep - b.ep || a.idx - b.idx;
    const byKey = new Map();
    for (const b of blocks) { if (!byKey.has(b.key)) byKey.set(b.key, { blocks: [], entries: [] }); byKey.get(b.key).blocks.push(b); }
    for (const e of entries) { if (e.held) continue; if (!byKey.has(e.key)) byKey.set(e.key, { blocks: [], entries: [] }); byKey.get(e.key).entries.push(e); }

    const clients = [], overOut = [], idleOut = [], unretOut = [], forfOut = [];
    let totPurch = 0, totPurch2 = 0, totBurn = 0, totOverMin = 0, totOverC = 0, totRem = 0, totForf = 0, totUnret = 0;

    const sortedKeys = [...byKey.keys()];
    for (const key of sortedKeys) {
      const g = byKey.get(key);
      g.blocks.sort(byDate); g.entries.sort(byDate);
      if (!g.blocks.length) { // unretained
        const mins = g.entries.reduce((s, e) => s + (roundMin > 1 ? Math.ceil(e.min / roundMin) * roundMin : e.min), 0);
        unretOut.push({ key, minutes: mins, entries: g.entries.length });
        totUnret += mins;
        continue;
      }
      let purchC = 0, burnedC = 0, overMin = 0, overC = 0, workedMin = 0;
      for (const b of g.blocks) { const c = toCents(b.min, b.rate); purchC += c; totPurch2 += c; }
      for (const e of g.entries) {
        let need = roundMin > 1 ? Math.ceil(e.min / roundMin) * roundMin : e.min;
        workedMin += need;
        for (const b of g.blocks) {
          if (need === 0) break;
          if (b.remaining === 0) continue;
          if (expiryDays > 0 && e.ep > b.ep + expiryDays) continue;
          const take = Math.min(need, b.remaining);
          b.remaining -= take; need -= take;
          burnedC += toCents(take, b.rate);
        }
        if (need > 0) {
          // price at most recent block dated on/before entry; else earliest block
          let rb = null;
          for (const b of g.blocks) if (b.ep <= e.ep) rb = b; // blocks date-sorted
          if (!rb) rb = g.blocks[0];
          overMin += need; overC += toCents(need, rb.rate);
        }
      }
      let remMin = 0, remC = 0, forfMin = 0, forfC = 0;
      for (const b of g.blocks) {
        if (b.remaining === 0) { b.forfeited = false; continue; }
        const expired = expiryDays > 0 && endEp > b.ep + expiryDays;
        const c = toCents(b.remaining, b.rate);
        if (expired) { b.forfeited = true; forfMin += b.remaining; forfC += c; forfOut.push({ key, blockLine: b.line, blockDate: iso(b.dt), minutes: b.remaining, cents: c }); }
        else { b.forfeited = false; remMin += b.remaining; remC += c; }
      }
      const lastWork = g.entries.length ? g.entries[g.entries.length - 1] : null;
      const idle = remMin > 0 && (lastWork === null || endEp - lastWork.ep > idleDays);
      if (idle) idleOut.push({ key, remainingMin: remMin, remainingCents: remC, lastWorkDate: lastWork ? iso(lastWork.dt) : null });
      if (overMin > 0) overOut.push({ key, minutes: overMin, cents: overC });
      clients.push({
        key, purchasedMin: g.blocks.reduce((s, b) => s + b.min, 0), purchasedCents: purchC,
        workedMin, burnedCents: burnedC, overageMin: overMin, overageCents: overC,
        remainingMin: remMin, remainingCents: remC, forfeitedMin: forfMin, forfeitedCents: forfC,
        lastWorkDate: lastWork ? iso(lastWork.dt) : null, idle,
        blocks: g.blocks.map(b => ({ line: b.line, date: iso(b.dt), minutes: b.min, rateCents: b.rate, remaining: b.forfeited ? 0 : b.remaining, forfeited: b.forfeited ? b.remaining : 0 }))
      });
      totPurch += purchC; totBurn += burnedC; totOverMin += overMin; totOverC += overC; totRem += remC; totForf += forfC;
    }

    const banner = totPurch > 0 && totOverC * 10 > totPurch;
    const overagePct = totPurch > 0 ? round1(totOverC / totPurch * 100) : 0;

    // self-audit
    const checks = [];
    checks.push({ name: "refusal rate <= 10%", pass: totalRows === 0 ? false : refusals.length * 10 <= totalRows });
    let consOk = true;
    for (const c of clients) {
      const kept = byKey.get(c.key).entries;
      const worked = kept.reduce((s, e) => s + (roundMin > 1 ? Math.ceil(e.min / roundMin) * roundMin : e.min), 0);
      const burnedMin = c.purchasedMin - c.remainingMin - c.forfeitedMin;
      if (burnedMin + c.overageMin !== worked) consOk = false;
    }
    checks.push({ name: "minutes conservation", pass: consOk });
    checks.push({ name: "purchased cross-check", pass: totPurch === totPurch2 });
    checks.push({ name: "duplicate explainers", pass: new Set(dupOut.map(d => d.matchedLine)).size === dupOut.length && dupOut.every(d => d.matchedLine !== d.heldLine) });
    const pass = checks.every(c => c.pass);

    // sort outputs
    refusals.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file === "retainers" ? -1 : 1));
    clients.sort((a, b) => b.overageCents - a.overageCents || b.purchasedCents - a.purchasedCents || (a.key < b.key ? -1 : 1));
    overOut.sort((a, b) => b.cents - a.cents || (a.key < b.key ? -1 : 1));
    idleOut.sort((a, b) => b.remainingCents - a.remainingCents || (a.key < b.key ? -1 : 1));
    const kl = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : (a.blockLine || a.heldLine || 0) - (b.blockLine || b.heldLine || 0));
    unretOut.sort((a, b) => (a.key < b.key ? -1 : 1)); forfOut.sort(kl); dupOut.sort(kl);

    const result = {
      rows: { total: totalRows, kept: blocks.length + entries.filter(e => !e.held).length, refused: refusals.length, held: dupOut.length },
      refusals, clients, overage: overOut, idle: idleOut, unretained: unretOut, forfeits: forfOut,
      duplicates: dupOut,
      totals: { purchasedCents: totPurch, burnedCents: totBurn, overageMin: totOverMin, overageCents: totOverC, remainingCents: totRem, forfeitedCents: totForf, unretainedMin: totUnret, overagePct },
      banner, selfAudit: { pass, checks }, statementEnd: endDt ? iso(endDt) : null
    };
    if (!pass) {
      result.clients = []; result.overage = []; result.idle = []; result.unretained = [];
      result.forfeits = []; result.duplicates = []; result.totals = null; result.banner = false; result.withheld = true;
    }
    return result;
  }

  return { audit, ckey, parseHoursToMin, parseRateCents };
});
