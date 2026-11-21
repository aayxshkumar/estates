// Rules fuzzer: plays seeded games with a mix of random and greedy bots,
// checks every invariant after every action, and checks that replaying each
// game's record reproduces the exact final state.
//
//   npm run check -- --games 2000 --seed 1

import { BOTS } from '../bots/bots.js';
import { STARTING_CASH } from '../engine/board.js';
import { checkInvariants } from '../engine/invariants.js';
import { hashState, replay } from '../engine/replay.js';
import { parseArgs, runGame } from './run.js';

const args = parseArgs(process.argv.slice(2));
const games = Number(args.get('games') ?? 1000);
const seed0 = Number(args.get('seed') ?? 1);
const maxTurns = Number(args.get('max-turns') ?? 400);

/** Rules that are deliberately missing. Each one is a roadmap item. */
const KNOWN_GAPS = [
  'auction: a declined space stays unowned instead of being auctioned',
  'trading: players cannot trade deeds, cash or jail cards',
  'building shortage: no auction when houses run short',
  'bankruptcy to a player: mortgaged deeds arrive without the 10% interest choice',
];

let failures = 0;
let steps = 0;
let bankruptcies = 0;
let over = 0;
const seen = new Set<string>();
const t0 = performance.now();

for (let g = 0; g < games && failures < 5; g++) {
  const seed = seed0 + g;
  const mix = g % 3 === 0 ? ['random', 'random'] : g % 3 === 1 ? ['random', 'greedy', 'random'] : ['greedy', 'random', 'greedy', 'random'];
  let failedAt: string | null = null;
  const r = runGame({
    seed, bots: mix.map((n) => BOTS[n]!), maxTurns,
    onStep(st, action, events) {
      steps++;
      for (const e of events) {
        seen.add(e.t === 'pay' ? `pay:${e.reason}` : e.t);
        if (e.t === 'bankrupt') bankruptcies++;
      }
      if (failedAt) return;
      const errs = checkInvariants(st, STARTING_CASH);
      if (errs.length > 0) failedAt = `after ${JSON.stringify(action)} on turn ${st.turn}: ${errs.join('; ')}`;
    },
  });
  if (r.final.phase === 'over') over++;
  if (!failedAt) {
    const again = replay(r.record);
    if (hashState(again) !== hashState(r.final)) failedAt = 'replay produced a different final state';
  }
  if (failedAt) {
    failures++;
    console.log(`FAIL seed ${seed} [${mix.join(',')}] ${failedAt}`);
  }
}

const secs = (performance.now() - t0) / 1000;
console.log(`estates check: ${games} games, ${steps} actions, ${(steps / secs / 1000).toFixed(0)}k actions/s`);
console.log(`  invariants + replay: ${failures === 0 ? 'all passed' : `${failures} game(s) failed`}`);
console.log(`  games finished: ${over}, bankruptcies: ${bankruptcies}`);
const expected = ['roll', 'move', 'salary', 'buy', 'decline', 'rent', 'card', 'jail', 'leaveJail', 'build',
  'sellBuilding', 'mortgage', 'unmortgage', 'debt', 'bankrupt', 'turn', 'gameOver'];
const missing = expected.filter((t) => !seen.has(t));
console.log(`  event coverage: ${expected.length - missing.length}/${expected.length}${missing.length ? ` (never seen: ${missing.join(', ')})` : ''}`);
console.log(`  known gaps (${KNOWN_GAPS.length}):`);
for (const gap of KNOWN_GAPS) console.log(`    - ${gap}`);
process.exitCode = failures === 0 && missing.length === 0 ? 0 : 1;
