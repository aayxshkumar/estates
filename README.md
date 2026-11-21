# estates

A property-trading board game set in the harbor city of Port Meridian, built as a **deterministic rules engine** first and a game second. Two to six players buy streets, ferries and works, collect rent, build houses and hotels evenly across a district, mortgage to survive, and try to bankrupt each other.

The engine is a pure function: `apply(state, action) → { state, events }`. All randomness comes from a seeded xoshiro128** generator stored inside the state, so a game is fully defined by its seed and its action list, and replaying that list reproduces the final state hash exactly. The browser client, the bots and the headless simulator all drive the same engine.

TypeScript (strict), Node 22+, no runtime dependencies. The only dev dependencies are `typescript` and `@types/node`.

## Quick start

```bash
npm install
npm test            # build + unit tests (node:test)
npm run check       # rules fuzzer: invariants after every action + replay determinism
npm run sim         # bot tournament
npm run serve       # play in the browser at http://localhost:8080
node tools/mutants.mjs   # plant rule bugs and see which ones the tests catch
```

## Layout

| Path | What |
|---|---|
| `src/engine/board.ts` | The 40 spaces, 8 districts, prices, rents, building costs |
| `src/engine/cards.ts` | The Fortune and Ledger decks |
| `src/engine/rules.ts` | `newGame`, `legalActions`, `apply`, rent, building, debt and bankruptcy |
| `src/engine/invariants.ts` | Properties that must hold after every action |
| `src/engine/replay.ts` | Game records, canonical JSON, FNV-1a state hash, replay |
| `src/engine/rng.ts` | Seeded xoshiro128** with unbiased `nextInt` and shuffle |
| `src/bots/bots.ts` | `random` (fuzzing) and `greedy` (buys and builds, never trades) |
| `src/sim/` | `cli.ts` tournament, `check.ts` rules fuzzer, `run.ts` game loop |
| `src/client/` | Hot-seat browser client (humans and bots on one screen) |
| `public/` | `index.html`, styles and assets |
| `tools/mutants.mjs` | Mutation testing for the rules |
| `tools/serve.mjs` | Zero-dependency static server |

## Rules implemented

- Move by two dice; doubles roll again; a third double in one turn goes to the Holding Cells.
- Passing or landing on Start pays 200. Card moves forward pay it too; moving back never does.
- Landing on an unowned street, ferry or works offers it at list price. You may mortgage or sell buildings to raise the money.
- Street rent doubles when one player owns the whole district and it has no buildings. Houses 1–4 and a hotel follow the rent table in `board.ts`.
- Ferry rent is 25 / 50 / 100 / 200 for 1–4 ferries owned. Works rent is 4× the dice, or 10× with both works.
- Building is even: a street can only get its next house when it has the fewest in its district. No building while any street in the district is mortgaged. The bank holds 32 houses and 12 hotels; a hotel returns 4 houses to the bank, and breaking one needs 4 houses back.
- Buildings sell back at half price. Mortgage pays half the price; paying it off costs that plus 10%, rounded up. No mortgaging while the district has buildings.
- Holding Cells: pay 50, use a release card, or try for doubles. After the third failed try you pay 50 and move by that roll.
- Money you can't pay becomes a debt. The debtor must mortgage or sell until they can pay, or go bankrupt. Bankrupt to one player hands that player all cash and deeds (buildings are sold to the bank first); bankrupt to the bank, or to several creditors, returns the deeds to the bank.
- Cards: advance to a space, nearest ferry (double rent) or works (10× dice), back three, go to the cells, release card, collect, pay, pay each player, collect from each player, repairs per house and hotel.

### Known gaps (printed by `npm run check`)

1. **Auctions.** A declined space stays unowned. The classic rule auctions it to everyone.
2. **Trading.** Players can't trade deeds, cash or release cards.
3. **Building shortage.** No auction when several players want the last houses.
4. **Bankruptcy interest.** Mortgaged deeds received in a bankruptcy skip the "pay 10% now or later" choice.

Gaps 1 and 2 are why most bot games never end (see below): without them, nobody completes a district.

## Where it stands (measured on an Apple M4, Node 25)

| Measurement | Result |
|---|---|
| Unit tests | 15/15 pass |
| `npm run check` (1000 games, random + greedy mixes) | invariants and replay pass on every action; 17/17 event kinds covered |
| `node tools/mutants.mjs` | **10/16 caught, 6 survive** |
| Greedy ×4, 1000-turn cap (`npm run sim`) | **72% of games hit the cap**; seats win 23–27% each |
| Greedy vs random, 2 players | greedy wins 99%; 7.5% capped |
| Engine speed | ~37,000 actions/s (every action is validated and the state is cloned) |

The six surviving mutants are all rule-semantics bugs that keep the game *consistent* while making it *wrong*: works rent never reaching 10×, salary paid when a card moves you back across Start, a fourth try in the Holding Cells, the naming-day card reversed, an extra roll after leaving the cells on doubles, and the nearest-ferry card not doubling rent. The fuzzer checks conservation laws (money, buildings, cards, ownership), so it can't see them. That's the first thing to fix.

## Roadmap

1. **Complete the rules and prove them.** Auctions (sealed or ascending, with every player able to bid), trades (any mix of deeds, cash and release cards, with validation), the building-shortage auction, and the bankruptcy interest choice. A rules oracle or scenario tests strong enough that every mutant is caught, including new ones for each new rule. The greedy tournament should stop hitting the cap.
2. **A real opponent.** A fast engine path (no clone-per-action) and a search bot (determinized Monte Carlo tree search over dice and card order) that beats greedy by a clear, statistically significant margin, plus a trading policy that doesn't give away districts.
3. **Networked multiplayer.** An authoritative Node server with rooms, reconnection, spectators and server-side replays; clients send actions, never state.
4. **The client.** Animated token movement, a trade and auction UI, property cards, a replay viewer that steps through a record.
5. **Rule variants as data.** House rules (free-parking pot, no rent in the cells, speed die) without forking the engine, each with its own invariants.

## Assets

All art and sound are CC0 from [Kenney](https://www.kenney.nl) (Boardgame Pack v2, Interface Sounds, Game Icons). The font is Fredoka (SIL Open Font License 1.1). See [`public/assets/CREDITS.md`](public/assets/CREDITS.md).

## Licence

MIT for the code. Assets keep their own licences (CC0 and OFL).
