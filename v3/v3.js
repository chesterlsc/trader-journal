/* ==========================================================================
   TRADER JOURNAL v3 — THE SETTLEMENT DESK.  Vanilla, no deps, no build.
   A trade is not finished when it closes. It is finished when it is SEALED.
   ========================================================================== */
(function () {
  "use strict";

  var API = "/api/handler";
  var RM = window.matchMedia("(prefers-reduced-motion: reduce)");
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ---- sample book. Labelled SAMPLE in the chrome and never un-labelled
     unless a live quote actually lands. Figures are invented and plausible. -- */
  var MIN = 60000;
  var now = Date.now();
  var book = {
    unsettled: [
      { id: "4471", sym: "NQ",  side: "SHORT", net: -412.50,  closed: now - 251 * MIN,  last: null },
      { id: "4470", sym: "GC",  side: "LONG",  net:  188.00,  closed: now - 96 * MIN,   last: null },
      { id: "4466", sym: "ES",  side: "SHORT", net: -1240.00, closed: now - 1631 * MIN, last: null },
      { id: "4461", sym: "NQ",  side: "LONG",  net:   64.25,  closed: now - 3982 * MIN, last: null }
    ],
    tape: [
      { id: "4469", sym: "ES", side: "LONG",  net:  237.50, closed: now - 74 * MIN,  sealedIn: 6,   reason: "held the 4h level, size was right" },
      { id: "4468", sym: "NQ", side: "SHORT", net: -318.75, closed: now - 190 * MIN, sealedIn: 22,  reason: "waited for the retest" },
      { id: "4467", sym: "GC", side: "LONG",  net:  510.00, closed: now - 402 * MIN, sealedIn: 11,  reason: "london open continuation" },
      { id: "4465", sym: "ES", side: "SHORT", net:  -95.00, closed: now - 900 * MIN, sealedIn: 148, reason: "felt like a reversal" }
    ],
    /* THE ECHO CORPUS — every reason ever written, with what it earned. */
    echoes: [
      { text: "waited for the retest",    n: 14, w: 9, l: 5, pnl: 1204,  ev: 86 },
      { text: "felt like a reversal",     n: 6,  w: 1, l: 5, pnl: -1940, ev: -323 },
      { text: "held the 4h level",        n: 11, w: 8, l: 3, pnl: 1830,  ev: 166 },
      { text: "news spike, faded it",     n: 9,  w: 6, l: 3, pnl: 612,   ev: 68 },
      { text: "revenge, wanted it back",  n: 4,  w: 0, l: 4, pnl: -2115, ev: -529 },
      { text: "london open continuation", n: 7,  w: 5, l: 2, pnl: 940,   ev: 134 }
    ],
    /* one entry per trading day, newest last. sealed < total is a FRACTURE. */
    spine: [
      { d: "AUG 07", total: 3, sealed: 3 }, { d: "AUG 08", total: 5, sealed: 5 },
      { d: "AUG 11", total: 2, sealed: 2 }, { d: "AUG 12", total: 4, sealed: 4 },
      { d: "AUG 13", total: 6, sealed: 6 }, { d: "AUG 14", total: 3, sealed: 3 },
      { d: "AUG 15", total: 4, sealed: 4 }, { d: "AUG 18", total: 5, sealed: 5 },
      { d: "TODAY",  total: 6, sealed: 2 }
    ],
    target: null
  };

  /* ---- formatters ------------------------------------------------------- */
  function comma(n) { return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function money(n) { return (n < 0 ? "-$" : "+$") + comma(Math.abs(n)); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function hhmmss(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60);
  }
  function tplus(mins) {
    return "T+" + pad(Math.floor(mins / 60)) + ":" + pad(Math.round(mins) % 60);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---- RECALL INDEX: an invented capability. How much of the reasoning is
     estimated to survive the delay. 100 at T+0, decaying ~3.1pts/h after 2h,
     floored at 12. Deterministic, explained in the pane, never called data. */
  function recall(mins) {
    var h = mins / 60;
    return Math.max(12, Math.round(h <= 2 ? 100 - h * 4 : 92 - (h - 2) * 3.1));
  }
  function ageMins(t) { return (Date.now() - t.closed) / MIN; }

  /* ---- F1 UNSETTLED ------------------------------------------------------ */
  function rowHTML(t) {
    var r = recall(ageMins(t));
    var tone = t.net < 0 ? "is-neg" : "is-pos";
    return '<button class="v3-row" type="button" data-trade="' + esc(t.id) + '"' +
      ' aria-label="Trade ' + esc(t.id) + ' ' + esc(t.sym) + ' ' + esc(t.side.toLowerCase()) +
      ', unsealed. Attach a reason.">' +
      '<span class="v3-glyph" aria-hidden="true">&#9633;</span>' +
      '<span class="v3-id">' + esc(t.id) + '</span>' +
      '<span class="v3-sym">' + esc(t.sym) + '</span>' +
      '<span class="v3-side">' + esc(t.side) + '</span>' +
      '<span class="v3-net ' + tone + '">' + money(t.net) + '</span>' +
      '<span class="v3-legs" aria-hidden="true"><i class="v3-leg-a"></i><i class="v3-leg-b"></i></span>' +
      '<span class="v3-legtext">PRICE&nbsp;&#10003;&nbsp;/&nbsp;REASON&nbsp;&mdash;</span>' +
      '<span class="v3-last" data-last="' + esc(t.sym) + '">&mdash;</span>' +
      '<span class="v3-recall" title="Estimated share of your reasoning still recoverable">R' + r + '</span>' +
      '<span class="v3-age" data-age="' + t.closed + '">T+00:00:00</span>' +
      '</button>';
  }

  function renderUnsettled() {
    var host = $("#v3Unsettled");
    if (!host) return;
    host.innerHTML = book.unsettled.length
      ? book.unsettled.map(rowHTML).join("")
      : '<p class="v3-empty">Book is clean. Every closed trade carries a reason.</p>';

    // the aging ladder: back-office buckets, applied to reasons instead of cash
    var b = [0, 0, 0, 0];
    book.unsettled.forEach(function (t) {
      var h = ageMins(t) / 60;
      b[h < 24 ? 0 : h < 48 ? 1 : h < 72 ? 2 : 3] += 1;
    });
    var names = ["T+0h", "T+24h", "T+48h", "STALE"];
    var peak = Math.max(1, b[0], b[1], b[2], b[3]);
    $("#v3Ladder").innerHTML = b.map(function (n, i) {
      return '<span class="v3-bucket' + (i === 3 && n ? " is-stale" : "") + '">' +
        '<i style="height:' + Math.round(6 + (n / peak) * 26) + 'px"></i>' +
        '<b>' + n + '</b><em>' + names[i] + '</em></span>';
    }).join("");

    var c = $("#v3UnsCount");
    if (c) c.textContent = book.unsettled.length + " UNSEALED";
  }

  /* ---- F6 SETTLED TAPE --------------------------------------------------- */
  function renderTape() {
    var host = $("#v3Tape");
    if (!host) return;
    host.innerHTML = book.tape.map(function (t, i) {
      return '<p class="v3-tprint' + (i === 0 && t.fresh ? " is-fresh" : "") + '">' +
        '<span class="v3-glyph is-sealed" aria-hidden="true">&#9632;</span>' +
        '<span class="v3-id">' + esc(t.id) + '</span>' +
        '<span class="v3-sym">' + esc(t.sym) + '</span>' +
        '<span class="v3-net ' + (t.net < 0 ? "is-neg" : "is-pos") + '">' + money(t.net) + '</span>' +
        '<span class="v3-stamp">SEALED ' + tplus(t.sealedIn) + '</span>' +
        '<span class="v3-reason">&ldquo;' + esc(t.reason) + '&rdquo;</span></p>';
    }).join("");
  }

  /* ---- F4 STREAK SPINE + BREAK RISK -------------------------------------- */
  function renderSpine() {
    var host = $("#v3Spine");
    if (!host) return;
    host.innerHTML = book.spine.map(function (d) {
      var seg = "";
      for (var i = 0; i < d.total; i++) seg += '<i class="' + (i < d.sealed ? "is-on" : "") + '"></i>';
      return '<span class="v3-vert' + (d.sealed < d.total ? " is-fracture" : "") + '">' +
        '<span class="v3-vert-segs">' + seg + '</span><em>' + esc(d.d) + '</em></span>';
    }).join("");

    /* The streak counts back from the last day that is FINISHED. Today is
       still in progress, so an unsealed trade today does not zero the number
       yet — it puts it AT RISK, which is what BREAK RISK counts down. */
    var last = book.spine.length - 1;
    var today = book.spine[last];
    var streak = 0;
    var start = today.sealed === today.total ? last : last - 1;
    for (var i = start; i >= 0; i--) {
      if (book.spine[i].sealed === book.spine[i].total) streak++; else break;
    }
    $("#v3Streak").textContent = streak;

    var open = today.total - today.sealed;
    $("#v3BreakRisk").hidden = open === 0;
    $("#v3BreakOpen").textContent = open;
    $("#v3SpineHold").textContent = open === 0 ? "HELD" : "AT RISK";
    $("#v3SpineHold").className = "v3-hold " + (open === 0 ? "is-held" : "is-risk");
  }

  /* ---- F3 SEAL RATE / RECALL --------------------------------------------- */
  function renderRatio() {
    var sealed = book.tape.length, open = book.unsettled.length;
    var rate = sealed + open ? (sealed / (sealed + open)) * 100 : 100;
    $("#v3Rate").textContent = rate.toFixed(1) + "%";
    $("#v3RateBar").style.width = rate.toFixed(1) + "%";

    var med = book.tape.map(function (t) { return t.sealedIn; }).sort(function (a, b) { return a - b; });
    $("#v3Median").textContent = med.length ? tplus(med[Math.floor(med.length / 2)]) : "—";

    var live = book.unsettled.map(function (t) { return recall(ageMins(t)); });
    $("#v3Recall").textContent = live.length
      ? Math.round(live.reduce(function (a, b) { return a + b; }, 0) / live.length)
      : 100;
  }

  /* ---- F5 REASON ECHO ---------------------------------------------------- */
  function renderEchoBook() {
    var host = $("#v3EchoBook");
    if (!host) return;
    host.innerHTML = book.echoes.slice().sort(function (a, b) { return a.ev - b.ev; })
      .map(function (e) {
        var sunk = e.ev < 0;
        return '<p class="v3-echo-row' + (sunk ? " is-sunk" : "") + '">' +
          '<span class="v3-echo-t">&ldquo;' + esc(e.text) + '&rdquo;</span>' +
          '<span class="v3-echo-n">&times;' + e.n + '</span>' +
          '<span class="v3-echo-wl">' + e.w + 'W/' + e.l + 'L</span>' +
          '<span class="v3-echo-ev ' + (sunk ? "is-neg" : "is-pos") + '">EV ' + money(e.ev) + '</span>' +
          (sunk ? '<span class="v3-echo-flag">SUNK</span>' : "") + '</p>';
      }).join("");
  }

  function tokens(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .filter(function (w) { return w.length > 2; });
  }
  /* ponytail: bag-of-words overlap, not embeddings. Upgrade to stemming or a
     trigram index only if the corpus outgrows a few hundred reasons. */
  function matchEcho(text) {
    var a = tokens(text);
    if (a.length < 2) return null;
    var best = null;
    book.echoes.forEach(function (e) {
      var b = tokens(e.text), hit = 0;
      a.forEach(function (w) { if (b.indexOf(w) > -1) hit++; });
      var score = hit / Math.max(a.length, b.length);
      if (score >= 0.5 && (!best || score > best.score)) best = { e: e, score: score };
    });
    return best;
  }
  function renderEchoStrip(text) {
    var strip = $("#v3EchoStrip"), m = matchEcho(text);
    if (!m) { strip.hidden = true; strip.textContent = ""; return; }
    var e = m.e;
    strip.hidden = false;
    strip.className = "v3-strip " + (e.ev < 0 ? "is-warn" : "is-good");
    strip.textContent = "ECHO — this reason is on " + e.n + " trades · " + e.w + "W/" + e.l +
      "L · EV " + money(e.ev) + (e.ev < 0 ? " · you have said this before and it lost" : "");
  }

  /* ---- TARGETING --------------------------------------------------------- */
  function setTarget(id) {
    book.target = id || null;
    var t = book.unsettled.filter(function (x) { return x.id === id; })[0];
    var chip = $("#v3SealTarget"), input = $("#v3SealInput");
    document.querySelectorAll(".v3-row").forEach(function (r) {
      r.classList.toggle("is-target", r.dataset.trade === id);
    });
    if (!t) { chip.textContent = "no trade"; chip.classList.add("is-idle"); input.disabled = true; return; }
    chip.textContent = "#" + t.id + " " + t.sym + " " + t.side;
    chip.classList.remove("is-idle");
    input.disabled = false;
    input.focus();
  }

  /* ══ THE SEAL — the signature moment ═══════════════════════════════════
     Edge draws solid, reason leg fills, clock freezes to a stamp, row leaves
     and prints on the tape. Five instruments, one sentence, 420ms. */
  function seal(id, reason) {
    var i = -1;
    book.unsettled.forEach(function (t, n) { if (t.id === id) i = n; });
    if (i < 0 || !reason.trim()) return;

    var t = book.unsettled[i];
    var row = document.querySelector('.v3-row[data-trade="' + id + '"]');
    var mins = Math.round(ageMins(t));

    var finish = function () {
      book.unsettled.splice(i, 1);
      t.sealedIn = mins;
      t.reason = reason.trim();
      t.fresh = true;
      book.tape.unshift(t);
      book.tape.forEach(function (x, n) { if (n) x.fresh = false; });
      var today = book.spine[book.spine.length - 1];
      if (today.sealed < today.total) today.sealed += 1;
      renderUnsettled(); renderTape(); renderSpine(); renderRatio(); renderStatus();
      setTarget(book.unsettled.length ? book.unsettled[0].id : null);
    };

    // reduced motion: commit immediately, no half-drawn states
    if (!row || RM.matches) { finish(); return; }

    row.classList.add("is-sealing");
    var age = row.querySelector(".v3-age");
    if (age) { age.removeAttribute("data-age"); age.textContent = "SEALED " + tplus(mins); age.classList.add("is-stamp"); }
    var glyph = row.querySelector(".v3-glyph");
    if (glyph) glyph.innerHTML = "&#9632;";
    var leg = row.querySelector(".v3-legtext");
    if (leg) leg.innerHTML = "PRICE&nbsp;&#10003;&nbsp;/&nbsp;REASON&nbsp;&#10003;";
    setTimeout(finish, 420);
  }

  /* ---- STATUS BAR -------------------------------------------------------- */
  function renderStatus() {
    $("#v3StatUnsealed").textContent = book.unsettled.length;
    $("#v3StatSealed").textContent = book.tape.length;
  }

  /* ---- CLOCKS. One interval drives the UTC clock, every age counter and
     the break-risk countdown. -------------------------------------------- */
  function tick() {
    var d = new Date();
    var c = $("#v3Clock");
    if (c) c.textContent = pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) + "Z";
    document.querySelectorAll("[data-age]").forEach(function (el) {
      el.textContent = "T+" + hhmmss(Date.now() - Number(el.dataset.age));
    });
    var end = new Date(); end.setHours(23, 59, 59, 999);
    var br = $("#v3BreakClock");
    if (br) br.textContent = hhmmss(end - d);
  }

  /* ---- LIVE WIRING. The chrome says SAMPLE until a real quote lands, and
     only the last-price cells ever become live. Nothing else is relabelled,
     and a failure leaves the page honest rather than empty. --------------- */
  function pullPrices() {
    var syms = book.unsettled.concat(book.tape).map(function (t) { return t.sym; })
      .filter(function (s, i, a) { return a.indexOf(s) === i; }).join(",");
    if (!syms) return;
    fetch(API + "?action=live_prices&symbols=" + encodeURIComponent(syms), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok || !j.prices) return;
        var hit = 0;
        document.querySelectorAll("[data-last]").forEach(function (el) {
          var p = j.prices[el.dataset.last];
          if (p === undefined || p === null) return;
          el.textContent = Number(p).toFixed(2);
          el.classList.add("is-live");
          hit++;
        });
        if (!hit) return;
        var chip = $("#v3Feed");
        chip.textContent = "LAST PRICE LIVE";
        chip.className = "v3-chip is-live";
        var a = j.asOf && Object.keys(j.asOf).length ? Object.values(j.asOf)[0] : null;
        $("#v3FeedAsOf").textContent = a ? "quote " + String(a).slice(11, 19) + "Z" : "";
      })
      .catch(function () { /* stays SAMPLE. */ });
  }

  /* PUBLIC BOOK — another trader's published journal, labelled as such, never
     mixed into this desk's tape. Whitelisted fields only, pane hidden unless
     the endpoint actually returns rows. */
  function pullPublic() {
    fetch(API + "?action=public_recent_trades", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok || !j.trades || !j.trades.length) return;
        var host = $("#v3Public");
        host.hidden = false;
        host.insertAdjacentHTML("beforeend", j.trades.slice(0, 3).map(function (t) {
          return '<p class="v3-pub-row"><span class="v3-sym">' + esc(t.symbol || "—") + '</span>' +
            '<span class="v3-side">' + esc(String(t.direction || "").toUpperCase()) + '</span>' +
            '<span class="v3-pub-res is-' + esc(t.result || "flat") + '">' + esc((t.result || "open").toUpperCase()) + '</span>' +
            '<span class="v3-pub-d">' + esc(t.date || "") + '</span></p>';
        }).join(""));
      })
      .catch(function () { /* pane simply stays hidden. */ });
  }

  /* ---- WIRE UP ----------------------------------------------------------- */

  /* ---- THE PERMIT PLATE ---------------------------------------------------
     The governor, rendered from the same figures the rest of the desk uses.
     Deliberately NOT a demo: there is no button anywhere that fakes a breach.
     The state is derived from the book, so the only way to see SUSPENDED is
     for the book to actually be suspended — which is what makes the ARMED
     state mean anything. -------------------------------------------------- */
  var governor = {
    dayLimit: 600, weekLimit: 1800,
    dayUsed: 188, weekUsed: 820,
    medianLoser: 137,        // the honest denominator for "prints left"
    maxLossLimit: 2000, equityToLimit: 3412, consec: 2, consecCap: 3
  };

  function govState(g) {
    var dayLeft = Math.max(0, g.dayLimit - g.dayUsed);
    var weekLeft = Math.max(0, g.weekLimit - g.weekUsed);
    // The bar reports whichever governor is actually GOVERNING — the tighter
    // of the two — rather than an average, which would hide the binding one.
    var dayPct = dayLeft / g.dayLimit, weekPct = weekLeft / g.weekLimit;
    var governing = dayPct <= weekPct ? "day" : "week";
    var left = governing === "day" ? dayLeft : weekLeft;
    var pct = Math.min(dayPct, weekPct);
    // ONE DENOMINATOR. total and prints must come from the SAME budget or the
    // row reads "7 of 4": the governing budget is the only one whose room is
    // actually spendable, so it supplies both figures.
    var limit = governing === "day" ? g.dayLimit : g.weekLimit;
    var total = Math.max(1, Math.floor(limit / g.medianLoser));
    var prints = Math.min(total, Math.floor(left / g.medianLoser));
    var tight = pct <= 0.34;
    var streak = g.consec >= g.consecCap - 1;
    var state = prints <= 0 ? "suspended" : (tight || streak) ? "narrowed" : "armed";
    return { dayLeft: dayLeft, weekLeft: weekLeft, governing: governing, pct: pct,
             prints: prints, total: total, state: state, left: left,
             tight: tight, streak: streak };
  }

  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }

  function renderGovernor() {
    var g = governor, st = govState(g);
    var plate = $("#v3Plate");
    plate.dataset.state = st.state;

    $("#v3Bus").style.setProperty("--w", (st.pct * 100).toFixed(1) + "%");

    var word = { armed: "ARMED", narrowed: "NARROWED", suspended: "SUSPENDED" }[st.state];
    $("#v3StateWord").textContent = word;

    // COPY HONESTY. A narrowed permit has NOT spent the budget, and saying so
    // would be a lie the trader can check. Each branch states what is true.
    $("#v3StateLine").textContent =
      st.state === "suspended"
        ? "The desk is locked until tomorrow. Logging a trade asks one question first."
        : st.state === "narrowed"
          // Say WHICH narrowing. Two different causes with the same word is
          // how a trader learns to ignore the word.
          ? (st.streak
              ? g.consec + " losses in a row. One more and the desk stops, with " +
                money(st.left) + " of the budget still unissued."
              : "Narrowed allowance. " + money(st.left) + " left, under a third of the " +
                (st.governing === "day" ? "daily" : "weekly") + " budget.")
          : "Cleared to work. The governor is watching.";

    $("#v3StrikeLeft").textContent = st.prints;
    $("#v3StrikeTotal").textContent = st.total;

    // Capped at 12 cells: past that the row stops being countable at a glance
    // and the remainder is more honest as a figure. Three states, and none of
    // them rides on colour alone.
    var CAP = 12, shown = Math.min(st.total, CAP);
    var cells = "";
    for (var i = 0; i < shown; i++) {
      var spent = i >= st.prints;
      var held = !spent && st.state === "narrowed" && i >= st.prints - 1;
      cells += '<li class="v3-cell' + (spent ? " is-spent" : held ? " is-held" : "") + '"' +
               ' title="' + (spent ? "spent" : held ? "held back" : "available") + '"></li>';
    }
    var over = st.total - shown;
    $("#v3Cells").innerHTML = cells + (over > 0 ? '<li class="v3-cells-more">+' + over + ' more</li>' : "");
    $("#v3Cells").setAttribute("aria-label",
      st.prints + " of " + st.total + " prints left today" + (over > 0 ? ", " + shown + " shown" : ""));

    $("#v3StrikeSay").textContent =
      st.prints <= 0
        ? "No room left at your median loser of " + money(g.medianLoser) + "."
        : st.prints + " more " + (st.prints === 1 ? "loser" : "losers") +
          " at your median of " + money(g.medianLoser) + " and the desk locks until tomorrow.";

    $("#v3DayUsed").textContent = money(g.dayUsed);
    $("#v3WeekUsed").textContent = money(g.weekUsed);
    $("#v3DayFill").style.setProperty("--w", ((g.dayUsed / g.dayLimit) * 100).toFixed(1) + "%");
    $("#v3WeekFill").style.setProperty("--w", ((g.weekUsed / g.weekLimit) * 100).toFixed(1) + "%");
    $("#v3BudgetDay").classList.toggle("is-governing", st.governing === "day");
    $("#v3BudgetWeek").classList.toggle("is-governing", st.governing === "week");
    var govChip = $("#v3BudgetDay").querySelector(".v3-gov");
    if (govChip) govChip.hidden = st.governing !== "day";

    $("#v3Conseq").textContent =
      st.state === "suspended" ? "Locked. One question first." : "Desk locks. One question first.";
  }

  function boot() {
    renderUnsettled(); renderTape(); renderSpine(); renderRatio(); renderEchoBook(); renderStatus();
    renderGovernor();
    setTarget(book.unsettled.length ? book.unsettled[0].id : null);
    tick(); setInterval(tick, 1000);

    $("#v3Unsettled").addEventListener("click", function (e) {
      var row = e.target.closest(".v3-row");
      if (row) setTarget(row.dataset.trade);
    });

    var input = $("#v3SealInput");
    input.addEventListener("input", function () { renderEchoStrip(input.value); });

    $("#v3SealForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!book.target || !input.value.trim()) return;
      seal(book.target, input.value);
      input.value = "";
      renderEchoStrip("");
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement !== input) { e.preventDefault(); input.focus(); }
      if (e.key === "Escape" && document.activeElement === input) { input.blur(); }
    });

    pullPrices(); setInterval(pullPrices, 30000);
    pullPublic();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();