// Token Radar's scoring, written a second time from the same rules.
//
// A sealed snapshot of the protocol universe goes in; a ranked board comes out. The board
// holds the snapshot's watchlist (the floor, never a ceiling) and every rankable pre-token
// protocol below that floor — the early radar. A protocol counts as pre-token when its
// record carries no token at all: no market cap, no CoinGecko id, no symbol. Above the
// floor, the watchlist's own rule leaves out the wrapped, staked and bridged products of
// tokens that already trade, the versioned pools, and the protocols with a parent; this
// entry follows that rule rather than choosing.
//
// Implied value comes only from the snapshot's own numbers. The category multiple is the
// median market-cap-to-TVL ratio of the live-token protocols in the same category, worked
// out from this snapshot at run time, so a DEX is priced like a DEX and a lender like a
// lender. A category with too few live comparables falls back to the market-wide median,
// and the multiple is clamped so no single outlier can carry the board.
//
//   multiple  = median(mcap_usd / tvl_usd) over live-token peers in the category
//               (fewer than 3 peers: the market median; clamped to 0.02..1.5)
//   growth    = 1 + clamp(change_7d, -60, 120) / 100 * 0.5
//   maturity  = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age unknown: 365 days)
//   implied   = max(1, round(tvl_usd * multiple * growth * maturity))
//
// No protocol name is ever special-cased: one function scores every row, and the dashboard
// runs the same arithmetic on the page so the two can be read against each other.

/** One protocol as the sealed input carries it: exactly ten fields. */
export interface SnapshotProtocol {
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

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One step of a farm plan: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    comparables: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the dashboard keeps it, its farm plan generated on the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  comparables: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A protocol that already trades: the board shows the market's own value for it. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders: the board, the live set, the model behind them. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside: number;
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** The model's constants, in the order the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_comparables: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.02,
  multiple_cap: 1.5,
  min_comparables: 3,
};

/** The model's version label, as the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live token view carries. */
export const LIVE_ROWS = 24;

/** A snapshot this model cannot score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const MS_PER_DAY = 86_400_000;

/** The number when it is finite, else `fallback`. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when a date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** The middle of a sorted list of numbers. */
function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2;
}

/**
 * The category multiples, worked out from this snapshot's own live-token protocols. For each
 * category: the median market-cap-to-TVL ratio of the protocols in it that already trade. The
 * market-wide median rides along as the fallback. A category with fewer live comparables than
 * the model asks for falls back to the market median.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants): { byCategory: Map<string, { multiple: number; n: number }>; market: number } {
  const byCat = new Map<string, number[]>();
  const every: number[] = [];
  for (const proto of snapshot.protocols) {
    if (proto.mcap_usd === null || proto.tvl_usd <= 0 || proto.category === 'CEX') continue;
    const ratio = proto.mcap_usd / proto.tvl_usd;
    if (!Number.isFinite(ratio) || ratio < 0) continue;
    every.push(ratio);
    const cat = proto.category ?? 'Other';
    const bucket = byCat.get(cat) ?? [];
    bucket.push(ratio);
    byCat.set(cat, bucket);
  }
  every.sort((a, b) => a - b);
  const rawMarket = medianOf(every);
  const market = Number.isFinite(rawMarket) ? Math.min(model.multiple_cap, Math.max(model.multiple_floor, rawMarket)) : 0.25;
  const perCategory = new Map<string, { multiple: number; n: number }>();
  for (const [cat, bucket] of byCat) {
    bucket.sort((a, b) => a - b);
    const mid = medianOf(bucket);
    const multiple = bucket.length >= model.min_comparables && Number.isFinite(mid)
      ? Math.min(model.multiple_cap, Math.max(model.multiple_floor, mid))
      : market;
    perCategory.set(cat, { multiple, n: bucket.length });
  }
  return { byCategory: perCategory, market };
}

/** The multiple one protocol is scored with: its category's, or the market's when its category is short. */
export function multipleFor(category: string | null, multiples: { byCategory: Map<string, { multiple: number; n: number }>; market: number }): { multiple: number; n: number } {
  const found = multiples.byCategory.get(category ?? 'Other');
  if (found !== undefined) return found;
  return { multiple: multiples.market, n: 0 };
}

/** The multipliers and the implied value one protocol gets under `model` and `multiples`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: { byCategory: Map<string, { multiple: number; n: number }>; market: number },
): { implied: number; multiple: number; comparables: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, n } = multipleFor(protocol.category, multiples);
  const raw = numOr(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageUsed = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageUsed, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, comparables: n, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name that ends in a release is a pool of another protocol. */
const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol's record carries no token at all. */
export function isPreToken(proto: SnapshotProtocol): boolean {
  return proto.mcap_usd === null && proto.gecko_id === null && proto.symbol === null;
}

/** Whether the board may rank a protocol: pre-token, not an exchange, not a versioned pool. */
export function isRankable(proto: SnapshotProtocol): boolean {
  return isPreToken(proto) && proto.category !== 'CEX' && !VERSION_MARK.test(proto.name);
}

/** The snapshot's protocols, keyed by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((proto) => [proto.slug, proto]));
}

/** A number rounded to four decimal places, for the multipliers the board carries. */
const to4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, carrying ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const index = indexBySlug(snapshot.protocols);
  const picked = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries
  // (it cannot, but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const proto = index.get(slug);
    if (proto !== undefined) picked.set(slug, proto);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, by TVL. Never a
  // replacement for a watchlist row: a picked protocol stays picked. Protocols above the floor that
  // the watchlist leaves out stay out: they are wrapped, staked or bridged products, versioned pools
  // or protocols with a parent, and the watchlist's rule — not this entry — leaves them out.
  const early = snapshot.protocols
    .filter((proto) => !picked.has(proto.slug) && isRankable(proto) && proto.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const proto of early) picked.set(proto.slug, proto);

  const scored = [...picked.values()].map((proto) => {
    const v = impliedValue(proto, snapshot.as_of, model, multiples);
    return { proto, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.proto.slug < b.proto.slug ? -1 : a.proto.slug > b.proto.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.proto.slug,
    name: s.proto.name,
    category: s.proto.category,
    chains: s.proto.chains,
    tvl_usd: s.proto.tvl_usd,
    change_7d: s.proto.change_7d,
    mcap_usd: s.proto.mcap_usd,
    listed_at: s.proto.listed_at,
    gecko_id: s.proto.gecko_id,
    symbol: s.proto.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      comparables: s.comparables,
      growth_pct: s.growthPct,
      growth_multiplier: to4dp(s.growthMult),
      maturity_multiplier: to4dp(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.proto, s.age).map(stepText),
  }));
}

/** One step as a single string: its action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(proto: SnapshotProtocol): string {
  return proto.chains.length > 0 ? proto.chains[0]! : 'its main chain';
}

/** A second chain where the protocol runs on more than one, for a cross-chain step. */
function otherChain(proto: SnapshotProtocol): string | null {
  return proto.chains.length > 1 ? proto.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function stakeFor(proto: SnapshotProtocol): number {
  if (proto.tvl_usd >= 5_000_000_000) return 250;
  if (proto.tvl_usd >= 1_000_000_000) return 150;
  if (proto.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's primary action, in words a farmer can follow. */
function mainAction(proto: SnapshotProtocol, stake: number, chainName: string): string {
  const cat = (proto.category ?? '').toLowerCase();
  const protoName = proto.name;
  if (cat.includes('liquid staking') || cat.includes('liquid restaking') || cat.includes('restaked btc')) return `Stake $${stake} of the chain's staking asset through ${protoName} on ${chainName} and hold the receipt token in the same wallet.`;
  if (cat.includes('restak') || cat.includes('staking pool')) return `Restake $${stake} of staked assets through ${protoName} on ${chainName} and keep the position receipt.`;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) return `Supply $${stake} of USDC to ${protoName} on ${chainName}, then borrow $20 of the same asset and repay it the same week.`;
  if (cat.includes('dex') || cat.includes('leveraged farm')) return `Provide $${stake} of liquidity to ${protoName}'s deepest pool on ${chainName} and keep the LP tokens.`;
  if (cat.includes('yield aggregator') || cat.includes('yield') || cat.includes('farm')) return `Deposit $${stake} of USDC into ${protoName}'s highest-yield vault on ${chainName} and leave the shares untouched.`;
  if (cat.includes('canonical bridge') || cat.includes('bridge')) return `Bridge $${stake} of USDC to ${chainName} through ${protoName}, then use the bridged funds once inside its app.`;
  if (cat.includes('perpetual') || cat.includes('derivative') || cat.includes('basis trad')) return `Deposit $${stake} of USDC as margin on ${protoName} and open one small hedged position, then close it.`;
  if (cat.includes('prediction')) return `Fund $${stake} and place one small market position on ${protoName}, then settle it.`;
  if (cat.includes('curator') || cat.includes('allocator') || cat.includes('onchain capital')) return `Deposit $${stake} into a ${protoName} vault on ${chainName} and hold the vault shares.`;
  if (cat.includes('stable')) return `Mint or deposit $${stake} of the stable asset through ${protoName} on ${chainName} and hold it.`;
  if (cat.includes('rwa')) return `Mint $${stake} of the protocol's yield-bearing asset on ${chainName} and hold it in the farming wallet.`;
  if (cat.includes('insurance')) return `Buy $${stake} of cover from ${protoName} on ${chainName} and keep the policy active.`;
  if (cat.includes('liquidity manager')) return `Deposit $${stake} into a ${protoName} managed position on ${chainName} and keep it open.`;
  if (cat.includes('cedefi') || cat.includes('central')) return `Deposit $${stake} through ${protoName}'s on-chain product on ${chainName} and keep the position receipt.`;
  if (cat.includes('chain')) return `Use ${protoName} on ${chainName} for one on-chain action worth $${stake} and keep the receipt.`;
  return `Deposit $${stake} of USDC into ${protoName} on ${chainName} and keep the position open.`;
}

/** The category's second qualifying action: a different interaction than the primary one. */
function secondAction(proto: SnapshotProtocol, stake: number, chainName: string): string {
  const cat = (proto.category ?? '').toLowerCase();
  const protoName = proto.name;
  const second = otherChain(proto);
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm') || cat.includes('farm')) return `Swap $25 through ${protoName} on ${chainName} once, in a different pool than the deposit.`;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) return `Borrow $10 against the supplied collateral on ${protoName}, hold it a day, then repay it in full.`;
  if (cat.includes('bridge') || cat.includes('canonical bridge')) return second === null ? `Send a second, smaller bridge of $25 through ${protoName} on a different day.` : `Bridge $25 through ${protoName} to ${second} as well, so the wallet is active on two chains.`;
  if (cat.includes('staking') || cat.includes('restak')) return `Claim or restake the staking rewards ${protoName} issues, even if they are only a few cents.`;
  if (cat.includes('perpetual') || cat.includes('derivative') || cat.includes('basis trad')) return `Close the hedged position and open a second one in the opposite direction with $25 of margin.`;
  if (cat.includes('prediction')) return `Place a second market position on ${protoName} with $10 and let it settle.`;
  if (cat.includes('curator') || cat.includes('allocator') || cat.includes('onchain capital')) return `Deposit a further $25 into a second ${protoName} vault on ${chainName}.`;
  if (cat.includes('rwa')) return `Top up the yield-bearing position by $25 and check the accrued yield it shows.`;
  if (cat.includes('stable')) return `Swap $25 between the stable asset and USDC through ${protoName} on ${chainName}.`;
  if (cat.includes('insurance')) return `Open a second, smaller cover position of $25 with ${protoName} on ${chainName}.`;
  return `Do one more on-chain action on ${protoName} — a swap, a vote or a claim — worth at least $10.`;
}

/** The category's main risk, in one line a farmer can act on. */
function mainRisk(proto: SnapshotProtocol): string {
  const cat = (proto.category ?? '').toLowerCase();
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm') || cat.includes('farm') || cat.includes('liquidity manager')) return `Liquidity positions can lose value to impermanent loss when prices move, so size the position to what you can afford to hold.`;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) return `A borrowed position can be liquidated if the collateral's price falls, so keep the borrow small against the supply.`;
  if (cat.includes('perpetual') || cat.includes('derivative') || cat.includes('basis trad')) return `Leveraged positions can be liquidated in a fast move, so keep the margin small and the position hedged.`;
  if (cat.includes('bridge') || cat.includes('canonical bridge')) return `Bridged funds sit in a bridge contract, so bridge only what you can afford to have locked while it is in transit.`;
  if (cat.includes('staking') || cat.includes('restak')) return `Staked assets can be slashed or depeg from the underlying, so check the receipt token's price before adding more.`;
  if (cat.includes('rwa')) return `Real-world-asset tokens carry the issuer's custody and redemption risk, so read the issuer's terms before minting.`;
  return `Smart contracts can fail, so never farm with funds you cannot afford to lose.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(proto: SnapshotProtocol, age: number | null): FarmStep[] {
  const chainName = firstChain(proto);
  const stake = stakeFor(proto);
  const hold = holdFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: mainAction(proto, stake, chainName),
      cost: `$${stake} of capital and about $${stake >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(proto, stake, chainName),
      cost: 'about $25 of capital and $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet stays active.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${stake} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `${mainRisk(proto)} Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((proto) => !isPreToken(proto) && proto.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((proto) => ({
      slug: proto.slug,
      name: proto.name,
      category: proto.category,
      chains: proto.chains,
      tvl_usd: proto.tvl_usd,
      mcap_usd: proto.mcap_usd,
      change_7d: proto.change_7d,
    }));
}

/** How many pre-token protocols above the floor the watchlist leaves out (set aside, not ranked). */
export function setAsideCount(snapshot: Snapshot, board: BoardRow[]): number {
  const onBoard = new Set(board.map((row) => row.slug));
  return snapshot.protocols.filter((proto) => isPreToken(proto) && !onBoard.has(proto.slug) && proto.tvl_usd >= snapshot.floor_usd).length;
}

/** A board row's compact form for data.js, its farm plan generated on the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    comparables: row.model.comparables,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((row) => !snapshot.watchlist.includes(row.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside: setAsideCount(snapshot, board),
    watchlist: [...snapshot.watchlist],
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof doc.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = doc.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const entry = v as Record<string, unknown>;
    if (typeof entry.slug !== 'string' || typeof entry.name !== 'string' || typeof entry.tvl_usd !== 'number' || !Number.isFinite(entry.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: entry.slug,
      name: entry.name,
      category: typeof entry.category === 'string' ? entry.category : null,
      chains: Array.isArray(entry.chains) ? entry.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: entry.tvl_usd,
      change_7d: typeof entry.change_7d === 'number' && Number.isFinite(entry.change_7d) ? entry.change_7d : null,
      mcap_usd: typeof entry.mcap_usd === 'number' && Number.isFinite(entry.mcap_usd) ? entry.mcap_usd : null,
      listed_at: typeof entry.listed_at === 'string' ? entry.listed_at : null,
      gecko_id: typeof entry.gecko_id === 'string' ? entry.gecko_id : null,
      symbol: typeof entry.symbol === 'string' ? entry.symbol : null,
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((row) => row.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${row.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
    if (row.implied_value_usd > 100_000_000_000_000) return `${row.slug} has implied value over the cap`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
