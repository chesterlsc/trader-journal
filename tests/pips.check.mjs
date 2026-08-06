// Pip distances shown at capture time must come from the same spec the P&L
// engine settles with. These pin the four instrument classes the user trades:
// 4-dp forex, JPY pairs, XAUUSD (their 0.01-lot = $1/pip model), and crypto.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

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
