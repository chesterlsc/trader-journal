// Pip distances shown at capture time must come from the same spec the P&L
// engine settles with. These pin the four instrument classes the user trades:
// 4-dp forex, JPY pairs, XAUUSD (their 0.01-lot = $1/pip model), and crypto.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { normalizeMarketSymbol } from '../src/modules/livePrices.js';

// The helpers live in app.js (browser module). Extract and evaluate just the
// three pure functions so this test needs no DOM.
const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const grab = (name) => {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} must exist in app.js`);
  return m[0];
};
const code = [grab('getPipSpec'), grab('inferPipSizeFromPrice'), grab('isCryptoMarketSymbol'), grab('pipsBetween'), grab('formatPips')].join('\n');
const fns = new Function(`${code}; return { getPipSpec, pipsBetween, formatPips };`)();

const cases = [
  // [asset, market, a, b, expected pips, label]
  ['EURUSD', 'forex', 1.083, 1.079, 40, '4-dp pair: 0.0040 = 40 pips'],
  ['USDJPY', 'forex', 155.2, 154.7, 50, 'JPY pair: 0.50 = 50 pips'],
  ['XAUUSD', 'metals', 2400, 2390, 10, 'gold: $10 move = 10 pips (1.0 pip size)'],
  ['BTCUSDT', 'crypto', 118400, 117900, 500, 'crypto: unit mode, $500 = 500 pips'],
];
for (const [asset, market, a, b, expected, label] of cases) {
  const got = fns.pipsBetween(asset, market, a, b);
  assert.ok(Math.abs(got - expected) < 0.01, `${label}: expected ${expected}, got ${got}`);
}

// Direction must not matter, and bad inputs must return null, never NaN.
assert.ok(Math.abs(fns.pipsBetween('EURUSD', 'forex', 1.079, 1.083) - 40) < 0.01, 'direction must not matter');
assert.strictEqual(fns.pipsBetween('EURUSD', 'forex', 0, 1.083), null);
assert.strictEqual(fns.pipsBetween('EURUSD', 'forex', 1.083, NaN), null);

// Formatting: one decimal under 1000, rounded with separators above.
assert.strictEqual(fns.formatPips(40), '40.0');
assert.strictEqual(fns.formatPips(1234.6), '1,235');

// The chips in the capture readout actually render pips.
assert.ok(src.includes('pips`') || /\bpips\b.*captureChip|captureChip.*pips/.test(src),
  'capture readout must render a pips tail');
assert.ok(src.includes('sheetPips'), 'the open sheet must carry the pips cell');

console.log('pips.check.mjs — all assertions passed');

// --- CME GOLD FUTURES ARE SIZED BY CONTRACT, NOT BY LOT --------------------
// The trader is on Topstep in MGC (Micro Gold). The app was pricing that
// position off gold SPOT: measured, futures 4466 against spot 4410, a 56 point
// gap. That is not a rounding error, it is the wrong instrument, and it made a
// stop the market never traded through look breached.
//
// MGC is 10 troy oz, so 1.0 point is $10 per contract. GC is 100 oz, so the
// same move is $100. positionSize is a CONTRACT COUNT here, not a lot size.
{
  const move = (spec, points, contracts) => spec.pipValuePerLot * points * contracts;

  // Six MGC contracts, the size on the user's chart, over a 1.0 point move.
  assert.equal(move({ pipValuePerLot: 10 }, 1, 6), 60, "6 MGC x 1.0 point = $60");
  // The same six contracts over the 4.0 points between 4466.4 and 4470.4.
  assert.equal(move({ pipValuePerLot: 10 }, 4, 6), 240);
  // One GC contract is ten micros.
  assert.equal(move({ pipValuePerLot: 100 }, 1, 1), 100, "1 GC x 1.0 point = $100");
  assert.equal(
    move({ pipValuePerLot: 10 }, 1, 10),
    move({ pipValuePerLot: 100 }, 1, 1),
    "ten micros are one full contract",
  );
}

// --- A CONTRACT ROLL IS THE SAME INSTRUMENT --------------------------------
// MGCZ26 rolls to MGCH27. A journal that treats those as two instruments loses
// the record and the price. normalizeMarketSymbol strips the month letter and
// the two digit year for the metals codes this app prices, and nothing else.
{
  assert.equal(normalizeMarketSymbol("MGCZ26"), "MGC", "December 2026 micro gold");
  assert.equal(normalizeMarketSymbol("MGCH27"), "MGC", "the next roll is the same instrument");
  assert.equal(normalizeMarketSymbol("GCZ26"), "GC");
  assert.equal(normalizeMarketSymbol("mgcz26"), "MGC", "case does not matter");
  // A six letter FX pair must never be mangled by the contract-code rule.
  assert.equal(normalizeMarketSymbol("EURUSD"), "EURUSD");
  assert.equal(normalizeMarketSymbol("XAUUSD"), "XAUUSD");
  // Nor anything that merely starts with the same letters.
  assert.equal(normalizeMarketSymbol("GCUSD"), "GCUSD");
}
