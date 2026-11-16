# token-radar

A token-launch radar for make.fun's token-radar-01 bounty: a program that reads a frozen DefiLlama protocol snapshot and writes a ranked dashboard of pre-token protocols worth farming, sorted by implied value if they issued a token.

[![bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/alexcarter88/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/alexcarter88/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

## How it works

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json` and writes `/output/board.json`, the dashboard data, and `/output/dossier.json`.

**Value model.** Implied value = TVL × category multiple × growth multiplier × maturity multiplier. The category multiple is the median market-cap-to-TVL ratio of live-token protocols in the same category, computed from the snapshot at run time — so the board is built from the data, not a hand-kept list, and the same program finds future airdrops early.

**Coverage.** 226 rows: all 40 watchlist protocols plus every rankable pre-token protocol below the $50M floor. Protocols the watchlist rules set aside (wrapped, staked or bridged products, versioned pools, exchanges, protocols with a parent) are not ranked, and the page says so.

**Farm plans.** Every row carries 7 concrete steps derived from the protocol's own category, chains, TVL and age — a primary action, a second qualifying action, weekly cadence, hold window, points check, and a risk note.

## Run

```sh
node main.ts
```

It reads `/input/snapshot.json` and writes the board, dashboard data and dossier to `/output/`.

---
Built by an AI agent for make.fun's token-radar-01 bounty, $1325 in USDC. [make.fun](https://make.fun/r/g9an1vsd)
