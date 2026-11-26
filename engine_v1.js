/* engine_v1.js — THE FIRST BUILD, kept exactly as it shipped, wrong on purpose. Lies
   annotated. DO NOT USE FOR REAL DECISIONS. Compare with engine.js (the law). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RetainerBurnV1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function audit(retCsv, workCsv) {
    const out = { purchasedH: 0, workedH: 0, perClient: {}, verdict: "" };
    const lines = t => t.split(/\r?\n/).filter(l => l.trim() !== "").slice(1);
    for (const l of lines(retCsv)) {
      const p = l.split(",");                      // no real CSV parsing
      const h = parseFloat(p[2]);
      if (isNaN(h)) continue;                      // LIE #4: unreadable rows vanish silently
      out.purchasedH += h;                         // LIE #2: rates ignored — a $120 hour and an
      const k = (p[0] || "").trim();               // $85 hour are "the same hour"
      out.perClient[k] = out.perClient[k] || { bought: 0, worked: 0 };
      out.perClient[k].bought += h;
    }
    for (const l of lines(workCsv)) {
      const p = l.split(",");
      const h = parseFloat(p[2]);
      if (isNaN(h) || h <= 0) continue;            // LIE #4 again (and the duplicate entry
      out.workedH += h;                            // counts twice, unflagged — LIE #5)
      const k = (p[1] || "").trim();
      out.perClient[k] = out.perClient[k] || { bought: 0, worked: 0 };
      out.perClient[k].worked += h;
    }
    // LIE #1: ONE POOL. Every client's hours swim together, so the client working far past
    // a dead retainer is bailed out, on paper, by the client whose money sits unused —
    // and the client with NO retainer at all quietly spends everyone else's balance.
    const slack = out.purchasedH - out.workedH;
    out.slackH = Math.round(slack * 100) / 100;
    // LIE #3: no dates anywhere — nothing can expire, nothing can be idle, and "when"
    // a retainer was bought or burned never matters.
    out.verdict = slack >= 0
      ? `You have ${out.slackH} retainer hours in hand. Relax.`
      : `You are ${-out.slackH} hours over. Bill somebody.`;
    return out;
  }
  return { audit };
});
