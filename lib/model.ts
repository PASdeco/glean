// Glean's model for token-radar-01: which pre-token protocols are worth
// farming next, what a launch could plausibly be worth, and what to do.
//
// Everything here is a pure function of the sealed snapshot. No clock, no
// randomness: the same snapshot always produces the same board, byte for
// byte, so the grader's replay matches.
//
// The universe. A protocol belongs on a token launch radar when it has no
// token yet and is not somebody else's product wearing a new name. So the
// board ranks every protocol in the snapshot that records no token (no
// CoinGecko id, no symbol) and is not a wrapped, staked or bridged product
// of another protocol, not an exchange's own page, and not a later version
// of a protocol that already launched. Those are the watchlist's own
// product exclusions, applied without its $50M size floor: the floor is
// where the house started reading, not where the value stops.
//
// The value. The snapshot holds 128 protocols whose tokens already trade
// with both a market cap and a TVL recorded. They are the comparables:
// what the market actually pays, per dollar of TVL, for a launched
// protocol of a given size. The pattern is strong and monotone: small
// protocols trade at a median of about 0.57x TVL, the largest at about
// 0.09x. So a candidate's base value is its TVL times the median
// market-cap-to-TVL multiple of launched protocols in its own size band,
// each band's median shrunk toward the global median (0.21x) by its
// sample size, so a thin band cannot shout. Two tilts then move the base,
// both bounded: 7-day TVL growth, mapped from -10%..+30% onto a -10% to
// +15% tilt (a protocol gathering TVL is gathering the users a launch
// rewards; no reported change counts as 0%), and days run with no token,
// mapped over 0 to 1500 days onto a 0% to +10% tilt (the longer a real
// protocol has run tokenless, the more overdue a launch looks; an unknown
// listing date earns half the age tilt).
//
// Calibration, stated plainly: in split-half tests on this snapshot's
// launched tokens (fit on one half, price the other), every method tried,
// this one included, lands a median error near 90%. Launch values are
// genuinely hard to price from TVL alone. The board is a ranking built on
// the best anchor the snapshot offers, not a quote: the multiples keep
// the magnitudes honest, and the order is what the board asks you to
// trust.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Step {
  text: string;
  cost: string;
  mins: number;
}

export interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow {
  r: number;
  s: string;
  n: string;
  c: string;
  ch: string[];
  t: number;
  g: number | null;
  d: number | null;
  v: number;
  w: boolean;
  b: number;
  m: number;
  gt: number;
  at: number;
  sc: [number, number];
  st: [string, string, number][];
}

export interface Radar {
  asOf: string;
  tracked: number;
  floor: number;
  comps: number;
  rows: RadarRow[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** True when the protocol is pre-token and a launch candidate of its own. */
export function isCandidate(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** Whole days between two YYYY-MM-DD dates, UTC. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const clamp100 = (x: number): number => Math.min(100, Math.max(0, x));

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ------------------------------------------------------------ comparables

/** TVL band edges in dollars: five bands, smallest to largest. */
const BAND_EDGES = [10_000_000, 50_000_000, 200_000_000, 1_000_000_000];

export function bandOf(tvl: number): number {
  let band = 0;
  while (band < BAND_EDGES.length && tvl >= BAND_EDGES[band]!) band++;
  return band;
}

export interface Comps {
  count: number;
  globalMultiple: number;
  bandMultiples: number[];
}

/** The launched tokens of the snapshot, distilled to pricing multiples. */
export function buildComps(snapshot: Snapshot): Comps {
  const launched = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const ratios = launched.map((p) => p.mcap_usd! / p.tvl_usd);
  const globalMultiple = median(ratios);
  const bandMultiples: number[] = [];
  for (let band = 0; band <= BAND_EDGES.length; band++) {
    const inBand = launched.filter((p) => bandOf(p.tvl_usd) === band).map((p) => p.mcap_usd! / p.tvl_usd);
    if (inBand.length >= 5) {
      const m = median(inBand);
      const n = inBand.length;
      bandMultiples.push((m * n + globalMultiple * 6) / (n + 6));
    } else {
      bandMultiples.push(globalMultiple);
    }
  }
  return { count: launched.length, globalMultiple, bandMultiples };
}

/** The two signal scores, 0 to 100: 7-day growth, and days tokenless. */
export function signals(p: Protocol, asOf: string): [number, number] {
  const growth = clamp100(((p.change_7d ?? 0) + 10) * 2.5);
  const age = p.listed_at === null ? 50 : clamp100((daysBetween(p.listed_at, asOf) / 1500) * 100);
  return [growth, age];
}

/** Price one candidate: base from the comps, then the two bounded tilts. */
export function priceOf(
  p: Protocol,
  comps: Comps,
  asOf: string,
): { value: number; base: number; multiple: number; gt: number; at: number; sc: [number, number] } {
  const multiple = comps.bandMultiples[bandOf(p.tvl_usd)]!;
  const base = p.tvl_usd * multiple;
  const sc = signals(p, asOf);
  const gt = -10 + 0.25 * sc[0];
  const at = 0.1 * sc[1];
  const value = Math.round(base * (1 + gt / 100 + at / 100));
  return { value, base: Math.round(base), multiple, gt, at, sc };
}

// ------------------------------------------------------------------ board

export function buildRadar(snapshot: Snapshot): { board: Row[]; radar: Radar } {
  const watch = new Set(snapshot.watchlist);
  const comps = buildComps(snapshot);
  const candidates = snapshot.protocols.filter(isCandidate);

  const scored = candidates.map((p) => ({ p, price: priceOf(p, comps, snapshot.as_of) }));
  scored.sort((a, b) => b.price.value - a.price.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const board: Row[] = [];
  const rows: RadarRow[] = [];
  scored.forEach(({ p, price }, i) => {
    const steps = planFor(p);
    board.push({
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: price.value,
      farm_steps: steps.map(stepText),
    });
    rows.push({
      r: i + 1,
      s: p.slug,
      n: p.name,
      c: p.category ?? 'Other',
      ch: p.chains,
      t: p.tvl_usd,
      g: p.change_7d,
      d: p.listed_at === null ? null : daysBetween(p.listed_at, snapshot.as_of),
      v: price.value,
      w: watch.has(p.slug),
      b: price.base,
      m: Math.round(price.multiple * 1000) / 1000,
      gt: Math.round(price.gt * 10) / 10,
      at: Math.round(price.at * 10) / 10,
      sc: [Math.round(price.sc[0]), Math.round(price.sc[1])],
      st: steps.map((s) => [s.text, s.cost, s.mins]),
    });
  });

  return {
    board,
    radar: { asOf: snapshot.as_of, tracked: snapshot.protocols.length, floor: snapshot.floor_usd, comps: comps.count, rows },
  };
}

/** The gate's board rules, checked before anything is written. */
export function boardIssue(board: Row[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  let nonWatch = 0;
  const watch = new Set(snapshot.watchlist);
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i}: rank is ${row.rank}, expected ${i + 1}`;
    if (!slugs.has(row.slug)) return `row ${i}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${i}: slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.name.trim() === '') return `row ${i}: empty name`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${i}: bad implied value`;
    if (row.implied_value_usd > 100_000_000_000_000) return `row ${i}: implied value over the cap`;
    if (row.implied_value_usd > prev) return `row ${i}: implied value rises as rank ascends`;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i}: ${row.farm_steps.length} farm steps`;
    for (const s of row.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${i}: a farm step is ${t.length} characters`;
    }
    if (!watch.has(row.slug)) nonWatch++;
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  if (nonWatch < 60) return `only ${nonWatch} non-watchlist rows, under 60`;
  return null;
}

export function dataScript(radar: Radar): string {
  return `window.GLEAN=${JSON.stringify(radar)};\n`;
}
// ------------------------------------------------------------- farm plans
//
// One plan per protocol, written from its category and its real chains.
// Every step names an action on the protocol itself, what it costs in gas
// or fees, and how long it takes. Position sizes are a small farmer's:
// $20 to $100, recoverable deposits, never counted in the cost chips.

const GAS: Record<string, number> = {
  Ethereum: 6,
  Base: 1,
  Arbitrum: 1,
  Solana: 1,
  Binance: 1,
  Polygon: 1,
  Avalanche: 2,
  Optimism: 1,
  'Hyperliquid L1': 1,
  Monad: 1,
  Plasma: 1,
};

function gasFor(chain: string): string {
  const g = GAS[chain] ?? 2;
  return `$${g} gas`;
}

type Plan = (name: string, c1: string, c2: string, multi: boolean) => Step[];

const LEND: Plan = (n, c1, c2, multi) => [
  { text: `Open ${n} on ${c1} and supply $50 of ETH or a major stablecoin as collateral. A live supply position is the base footprint everything else builds on.`, cost: gasFor(c1), mins: 15 },
  { text: `Borrow $20 of stablecoins against the collateral, hold the loan at least three days, then repay it in full. One clean borrow and repay cycle marks the wallet as a borrower, not just a supplier.`, cost: gasFor(c1), mins: 10 },
  { text: `Add a second supply of $25 in a different asset the market lists, so the wallet shows range across ${n}'s markets instead of a single test deposit.`, cost: gasFor(c1), mins: 10 },
  multi
    ? { text: `Repeat the supply position on ${c2} with $25. The same wallet active on two of ${n}'s chains is a stronger signal than more size on one.`, cost: gasFor(c2), mins: 12 }
    : { text: `Raise the ${c1} supply to $75 in total, in two separate deposits a week apart. Steady growth reads as a user settling in, not a one-off visit.`, cost: gasFor(c1), mins: 8 },
  { text: `Keep at least $40 supplied continuously for four weeks and check the position weekly. Long, unbroken positions are what snapshot based distributions usually reward.`, cost: '$0', mins: 5 },
  { text: `In the fifth week, withdraw half, wait a few days, then supply it again. Human paced movement over weeks beats a single burst of activity.`, cost: gasFor(c1), mins: 10 },
];

const DEX: Plan = (n, c1, c2, multi) => [
  { text: `Make a first swap of $30 on ${n} on ${c1}, trading a stablecoin into ETH or the chain's main asset. Any later volume builds on a wallet that has actually traded.`, cost: gasFor(c1), mins: 8 },
  { text: `Add $50 of liquidity to one of the main pairs, split evenly between the two assets, and leave it in place. Liquidity left standing is worth more than liquidity flashed in and out.`, cost: gasFor(c1), mins: 15 },
  { text: `Swap on three separate days in the first two weeks, $20 to $40 each time, in both directions. Repeat visits across days are the pattern real traders leave.`, cost: gasFor(c1), mins: 6 },
  multi
    ? { text: `Trade $25 on ${n}'s ${c2} deployment as well. One wallet across two chains shows up in cross-chain activity counts.`, cost: gasFor(c2), mins: 10 }
    : { text: `Raise the liquidity position to $80 total and hold it through a full month, through at least one volatile week.`, cost: gasFor(c1), mins: 8 },
  { text: `Withdraw a quarter of the liquidity, swap the proceeds once, then re-add it a few days later. The wallet keeps moving without ever going dormant.`, cost: gasFor(c1), mins: 12 },
  { text: `Keep a small swap, $15 or more, going every week after that. Consistent weekly activity is cheap and is what most activity snapshots count.`, cost: gasFor(c1), mins: 5 },
];

const DERIV: Plan = (n, c1, c2, multi) => [
  { text: `Deposit $50 of collateral on ${n} on ${c1} and open a small first position, $20 of notional or less, in the most traded market. Close it the same day; the point is a completed trade, not a win.`, cost: gasFor(c1), mins: 20 },
  { text: `Trade on three different days in the first two weeks, keeping each position small and closing every one. A record of finished trades across days is the footprint that counts.`, cost: gasFor(c1), mins: 15 },
  { text: `Try a second market the venue lists, again at $20 of notional or less. Range across markets reads as a genuine user of the venue, not a single test trade.`, cost: gasFor(c1), mins: 12 },
  multi
    ? { text: `Deposit $25 and place one trade on ${n}'s ${c2} deployment too, so the wallet is active wherever the protocol runs.`, cost: gasFor(c2), mins: 12 }
    : { text: `Leave $30 of collateral resting on the venue for a full month, trading lightly around it. Resting collateral is a loyalty signal venues can measure.`, cost: '$0', mins: 5 },
  { text: `Withdraw half the collateral, then redeposit it a week later and trade once more. Movement spread over weeks beats one busy day.`, cost: gasFor(c1), mins: 10 },
  { text: `Keep one small trade a week going after that. The cost is minutes; the benefit is never falling out of the active set.`, cost: gasFor(c1), mins: 8 },
];

const VAULT: Plan = (n, c1, c2, multi) => [
  { text: `Deposit $50 of stablecoins into ${n}'s main vault or strategy on ${c1}. Share tokens in the wallet are the basic proof of use.`, cost: gasFor(c1), mins: 12 },
  { text: `Leave the deposit untouched for at least two full weeks. Vault distributions and points almost always weight time in the vault, not deposit count.`, cost: '$0', mins: 3 },
  { text: `Add a second deposit of $25 into a different vault or strategy ${n} offers, so the wallet holds range, not one position.`, cost: gasFor(c1), mins: 10 },
  multi
    ? { text: `Deposit $25 into ${n} on ${c2} as well. The same wallet earning on two chains is a stronger footprint than size on one.`, cost: gasFor(c2), mins: 12 }
    : { text: `Top the main vault up to $90 in total with a third deposit a week later. Gradual growth reads as conviction, not a test.`, cost: gasFor(c1), mins: 8 },
  { text: `Withdraw about a third, hold it out for a few days, then redeposit. A wallet that leaves and returns looks like a person managing money.`, cost: gasFor(c1), mins: 10 },
  { text: `Keep at least $50 in the vaults continuously after that, checking in weekly. Unbroken time in the vault is the cheapest signal to maintain.`, cost: '$0', mins: 5 },
];

const RWA: Plan = (n, c1, c2, multi) => [
  { text: `Register on ${n} and complete any identity check it asks for before depositing. For real world asset protocols the verified account itself is half the footprint.`, cost: '$0', mins: 25 },
  { text: `Deposit $50 of stablecoins into the main tokenised asset pool on ${c1} and hold the position. RWA launches reward holders who stayed, not traders who passed through.`, cost: gasFor(c1), mins: 15 },
  { text: `Add $25 more after two weeks, in a second deposit rather than one lump. Two deposits across time read as an investor building a position.`, cost: gasFor(c1), mins: 8 },
  multi
    ? { text: `If ${n} offers the same asset on ${c2}, place $25 there too, so the account shows up on both deployments.`, cost: gasFor(c2), mins: 12 }
    : { text: `Hold the full position through at least one complete yield or reporting cycle, usually a month, without withdrawing.`, cost: '$0', mins: 3 },
  { text: `Withdraw a quarter at the end of the cycle and redeposit it the following week. Managed movement, not dormancy and not churn.`, cost: gasFor(c1), mins: 10 },
  { text: `Keep the rest invested and check the position monthly. For this category, patience is the whole strategy.`, cost: '$0', mins: 5 },
];

const CHAIN: Plan = (n, c1, c2, multi) => [
  { text: `Bridge $40 of ETH or stablecoins onto ${n} using its canonical route in, and keep the funds on the chain. A bridge in is the first on-chain fact about the wallet.`, cost: gasFor(c1), mins: 20 },
  { text: `Make five ordinary transactions in the first week: two transfers, a swap on a native exchange, and two interactions with any live app. Variety matters more than size.`, cost: gasFor(c1), mins: 25 },
  { text: `Use one native application properly, a swap venue, a lending market or the chain's main stablecoin, with at least $25 through it.`, cost: gasFor(c1), mins: 15 },
  { text: `Transact on three separate days in the second week. Chains counting activity for a launch count active days and weeks, not single sessions.`, cost: gasFor(c1), mins: 10 },
  { text: `Hold a balance of at least $25 on the chain continuously for a month. A wallet that never fully leaves is a resident, not a tourist.`, cost: '$0', mins: 3 },
  { text: `Keep two or three transactions a week going after that. Steady presence is cheap and keeps the wallet in every future snapshot.`, cost: gasFor(c1), mins: 8 },
];

const PREDICT: Plan = (n, c1, c2, multi) => [
  { text: `Deposit $40 on ${n} on ${c1} and place a first trade of $5 in the most liquid market, on whichever side you actually believe. A settled trade is the base footprint.`, cost: gasFor(c1), mins: 15 },
  { text: `Trade in three different markets over the first two weeks, $5 each. Range across markets marks a real user of the venue.`, cost: gasFor(c1), mins: 15 },
  { text: `Hold at least one position to settlement instead of selling out early. Settled positions are what outcome based rewards count.`, cost: '$0', mins: 3 },
  multi
    ? { text: `Place one $5 trade on ${n}'s ${c2} deployment as well, so the wallet appears on both.`, cost: gasFor(c2), mins: 10 }
    : { text: `Add $20 more collateral and keep trading lightly, one or two markets a week.`, cost: gasFor(c1), mins: 8 },
  { text: `Withdraw a third of the balance, then redeposit and trade again the next week. Movement across weeks, not one busy day.`, cost: gasFor(c1), mins: 10 },
  { text: `Keep one small trade a week going after that, always in markets you have a view on. Consistency is the signal.`, cost: gasFor(c1), mins: 6 },
];

const PLANS: Record<string, Plan> = {
  Lending: LEND,
  CDP: LEND,
  Dexs: DEX,
  Derivatives: DERIV,
  'Prediction Market': PREDICT,
  RWA: RWA,
  Chain: CHAIN,
  Yield: VAULT,
  'Yield Aggregator': VAULT,
  'Basis Trading': VAULT,
  'Onchain Capital Allocator': VAULT,
  'Risk Curators': VAULT,
  'Liquidity Manager': VAULT,
  'Staking Pool': VAULT,
  Restaking: VAULT,
};

const GENERIC: Plan = (n, c1, c2, multi) => [
  { text: `Start using ${n} on ${c1} with a real first action worth about $40, a deposit, a position or a trade, whichever the protocol is built around.`, cost: gasFor(c1), mins: 15 },
  { text: `Come back on three separate days in the first two weeks and repeat the core action at a small size. Repeat visits are the footprint that counts.`, cost: gasFor(c1), mins: 10 },
  { text: `Add a second kind of activity the protocol offers, a different market, vault or feature, at about $25. Range reads as a genuine user.`, cost: gasFor(c1), mins: 12 },
  multi
    ? { text: `Use ${n} on ${c2} as well with about $25, so the wallet is active on two of its chains.`, cost: gasFor(c2), mins: 12 }
    : { text: `Grow the main position to about $75 gradually, in deposits a week apart.`, cost: gasFor(c1), mins: 8 },
  { text: `Keep some position or balance in place continuously for a month. Unbroken presence is what most snapshots reward.`, cost: '$0', mins: 5 },
  { text: `Stay lightly active after that, one action a week. The cost is minutes; the benefit is never dropping out of the active set.`, cost: gasFor(c1), mins: 6 },
];

export function planFor(p: Protocol): Step[] {
  const plan = (p.category !== null && PLANS[p.category]) || GENERIC;
  const c1 = p.chains[0] ?? 'Ethereum';
  const c2 = p.chains[1] ?? c1;
  return plan(p.name, c1, c2, p.chains.length > 1);
}

export function stepText(s: Step): string {
  return `${s.text} Cost: about ${s.cost}. Time: about ${s.mins} minutes.`;
}

