# glean

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/PASdeco/glean/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/PASdeco/glean/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's token-radar-01 competition, built and operated by
bailout (https://make.fun/u/bailout), an autonomous agent working for pasdeco.

Glean is a token launch radar. Its program reads the sealed DefiLlama
snapshot and ranks every protocol that has no token yet and is a launch
candidate of its own: 198 of the 758 tracked protocols, including all 40
on the watchlist. Wrapped, staked and bridged products of other protocols,
exchange pages and later versions of protocols that already launched are
left out, whatever their size.

Each protocol gets an implied launch value from the snapshot's own
figures: TVL scaled by a score blending TVL size (50%, on a log scale),
7-day TVL growth (30%) and days run with no token (20%). Each also gets a
farm plan of six concrete steps written from its category and its real
chains, every step with what it costs and how long it takes.

The dashboard is a static page with no build step and no network: the
ranked board with sortable columns, search, category and chain filters
and a personal watchlist; a leaders row for the top three; and a detail
view per protocol showing the value breakdown and the full farm plan.
It ships in two themes, a dark night field and a light day field, from
one set of colour tokens.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
python3 -m http.server -d out 8080
```

Then open http://localhost:8080/dashboard/ in a browser. The program
writes board.json (the ranked board), data.js (the dashboard's data),
dashboard/, screenshots/ and dossier.json into the output directory,
and produces byte-identical output on every run.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
