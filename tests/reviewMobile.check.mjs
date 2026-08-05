// Trade Review must fit a 375px phone. The audit found #journal 852px wide
// inside a 375px viewport, and every "overflowing" header element (.rev-head,
// .rev-chips, .rev-search, .rev-more) was just 100% of that 852px box. The
// single cause: clay-v2's `#journal table { min-width: 820px }` out-specified
// the `table { min-width: 0 }` that styles.css's <=900px card transform relies
// on, so the desktop table floor survived into the card layout.
//
// That is invisible to every other test here — nothing else reads the CSS — and
// it is exactly the kind of rule someone re-adds unconditionally. So: a width
// floor bigger than a phone must live inside a min-width media query.
// Run: node tests/reviewMobile.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PHONE = 375;
const css = readFileSync(new URL("../clay-v2.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

// Walk the sheet, carrying the @media conditions each rule is nested under.
const rules = [];
const stack = [];
let cursor = 0;
for (let i = 0; i < css.length; i += 1) {
  if (css[i] === "{") {
    const prelude = css.slice(cursor, i).trim();
    const block = {
      selector: prelude,
      start: i + 1,
      media: stack.filter((b) => b.selector.startsWith("@")).map((b) => b.selector),
    };
    stack.push(block);
    if (!prelude.startsWith("@")) rules.push(block);
    cursor = i + 1;
  } else if (css[i] === "}") {
    const block = stack.pop();
    if (block) block.body = css.slice(block.start, i);
    cursor = i + 1;
  }
}
assert.equal(stack.length, 0, "clay-v2.css has unbalanced braces");

const desktopOnly = (media) =>
  media.some((m) => {
    const min = /min-width:\s*(\d+)px/.exec(m);
    return Boolean(min) && Number(min[1]) > PHONE;
  });

// 1. No width floor wider than a phone escapes into phone widths.
for (const rule of rules) {
  const floor = /(?:^|[;{\s])min-width:\s*(\d+)px/.exec(rule.body || "");
  if (!floor || Number(floor[1]) <= PHONE) continue;
  assert.ok(
    desktopOnly(rule.media),
    `"${rule.selector}" sets min-width:${floor[1]}px with no min-width media guard — ` +
      `at 375px that forces the view wider than the viewport.`
  );
}

// 2. The chip strip must not bleed past the page gutter. .app-layout is
//    min(100%, 100vw - 12px) on phones, i.e. 6px per side — a -12px
//    margin-inline pushed the strip 6px past the viewport on each edge.
const chipMobile = rules.filter(
  (r) => r.selector === ".rev-chips" && r.media.some((m) => /max-width:\s*(760|375)px/.test(m))
);
assert.ok(chipMobile.length > 0, ".rev-chips has no phone-width rule at all");
for (const rule of chipMobile) {
  assert.ok(
    !/margin-inline:\s*calc\([^)]*\*\s*-1\)/.test(rule.body || "") &&
      !/margin-inline:\s*-/.test(rule.body || ""),
    ".rev-chips must not use a negative margin-inline at phone widths — there is no gutter to bleed into"
  );
  assert.match(
    rule.body || "",
    /overflow-x:\s*auto/,
    ".rev-chips must stay a horizontal scroll strip, not force page width"
  );
  assert.match(
    rule.body || "",
    /mask-image:\s*linear-gradient/,
    ".rev-chips needs its fade affordance — iOS overlay scrollbars are invisible"
  );
}

// 3. The row card transform depends on .table-wrap NOT clipping: overflow-x:auto
//    would compute overflow-y to auto too and cut off the per-row clay depth
//    that encodes win/loss.
for (const rule of rules) {
  if (!/\.table-wrap/.test(rule.selector)) continue;
  if (!rule.media.some((m) => /max-width:\s*(900|760|375)px/.test(m))) continue;
  assert.ok(
    !/overflow-x:\s*auto/.test(rule.body || ""),
    `"${rule.selector}" clips the row cards' depth shadows at phone widths`
  );
}

console.log("reviewMobile.check.mjs: OK — %d rules scanned", rules.length);
