/* engine_v2.js — THE REBUILD THAT ACCUSES EVERYONE, kept exactly as it shipped, wrong on
   purpose. Lies annotated. DO NOT USE FOR REAL DECISIONS. Compare with engine.js. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RetainerBurnV2 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function ep(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null;
  }
  function audit(retCsv, workCsv) {
    const lines = t => t.split(/\r?\n/).filter(l => l.trim() !== "").slice(1);
    const blocks = [], works = [];
    let maxRate = 0;
    for (const l of lines(retCsv)) {
      const p = l.split(","); const h = parseFloat(p[2]); const rate = parseFloat(String(p[3]).replace(/[$,]/g, ""));
      const e = ep(p[1]);
      if (isNaN(h) || isNaN(rate) || e === null) continue;  // bad rows still vanish silently
      blocks.push({ key: p[0].trim().toUpperCase(), ep: e, min: Math.round(h * 60), rate, left: Math.round(h * 60) });
      if (rate > maxRate) maxRate = rate;
    }
    for (const l of lines(workCsv)) {
      const p = l.split(","); const h = parseFloat(p[2]); const e = ep(p[0]);
      if (isNaN(h) || h <= 0 || e === null) continue;        // the duplicate stays — LIE #3
      works.push({ key: p[1].trim().toUpperCase(), ep: e, min: Math.round(h * 60) });
    }
    const out = { expired: [], owed: [], missed: [], totalExpiredC: 0, totalOwedC: 0, verdict: "" };
    const byKey = {};
    for (const b of blocks) (byKey[b.key] = byKey[b.key] || { blocks: [], works: [] }).blocks.push(b);
    for (const w of works) (byKey[w.key] = byKey[w.key] || { blocks: [], works: [] }).works.push(w);
    for (const key in byKey) {
      const g = byKey[key];
      g.blocks.sort((a, b) => b.ep - a.ep);  // LIE #1: NEWEST FIRST. Old blocks are starved on
      // purpose, so they "expire" under the invented rule below even when honest FIFO would
      // have spent them long ago.
      let overMin = 0;
      for (const w of g.works.sort((a, b) => a.ep - b.ep)) {
        let need = w.min;
        for (const b of g.blocks) {
          if (!need) break;
          if (w.ep - b.ep > 30) continue;    // LIE #2: EVERY block "expires" in 30 days —
          if (b.ep > w.ep) continue;         // a rule nobody agreed to, invented by the build
          const take = Math.min(need, b.left); b.left -= take; need -= take;
        }
        overMin += need;
      }
      for (const b of g.blocks) if (b.left > 0) {
        const c = Math.round(b.left * b.rate / 60 * 100);
        out.expired.push({ key, date: b.ep, minutes: b.left, cents: c });
        out.totalExpiredC += c;
      }
      if (overMin > 0) {
        // LIE #4: hours past the money are billed at the PORTFOLIO'S TOP RATE, whoever's
        // client they belong to — and the no-retainer client gets the same treatment.
        const c = Math.round(overMin * maxRate / 60 * 100);
        out.owed.push({ key, minutes: overMin, cents: c });
        out.totalOwedC += c;
      }
      // LIE #5: a fabricated obligation — every client is scolded for each calendar month
      // without a retainer purchase, as if "monthly" were in anyone's contract.
      if (g.blocks.length) {
        const first = Math.min(...g.blocks.map(b => b.ep)), last = Math.max(...g.blocks.map(b => b.ep));
        const months = Math.round((last - first) / 30) + 1;
        const missed = months - g.blocks.length;
        if (missed > 0) out.missed.push({ key, missed });
      }
    }
    out.verdict = "$" + ((out.totalExpiredC + out.totalOwedC) / 100).toFixed(2) +
      " of client money has expired or is owed to you. Start the awkward phone calls.";
    return out;
  }
  return { audit };
});
