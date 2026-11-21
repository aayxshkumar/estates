// Headless tournament: `npm run sim -- --games 1000 --bots greedy,greedy,greedy,greedy`

import { writeFileSync } from 'node:fs';
import { BOTS, type Bot } from '../bots/bots.js';
import { parseArgs, runGame } from './run.js';

const args = parseArgs(process.argv.slice(2));
const games = Number(args.get('games') ?? 500);
const seed0 = Number(args.get('seed') ?? 1);
const maxTurns = Number(args.get('max-turns') ?? 1000);
const names = (args.get('bots') ?? 'greedy,greedy,greedy,greedy').split(',');
const bots: Bot[] = names.map((n) => {
  const b = BOTS[n];
  if (!b) throw new Error(`unknown bot ${n}; have ${Object.keys(BOTS).join(', ')}`);
  return b;
});

const wins = new Array<number>(bots.length).fill(0);
let capped = 0;
let turns = 0;
let steps = 0;
const t0 = performance.now();
for (let g = 0; g < games; g++) {
  const r = runGame({ seed: seed0 + g, bots, maxTurns });
  if (r.winner !== null) wins[r.winner]!++;
  if (r.capped) capped++;
  turns += r.turns;
  steps += r.steps;
  if (g === 0 && args.has('record')) writeFileSync(args.get('record')!, JSON.stringify(r.record));
}
const secs = (performance.now() - t0) / 1000;

const summary = {
  games, seed: seed0, maxTurns, bots: names,
  winRate: wins.map((w) => +(w / games).toFixed(3)),
  cappedRate: +(capped / games).toFixed(3),
  avgTurns: +(turns / games).toFixed(1),
  stepsPerSec: Math.round(steps / secs),
  seconds: +secs.toFixed(2),
};
if (args.has('json')) {
  console.log(JSON.stringify(summary));
} else {
  console.log(`estates sim: ${games} games, seats ${names.join(' / ')}, cap ${maxTurns} turns`);
  names.forEach((n, i) => console.log(`  seat ${i} ${n.padEnd(8)} won ${(100 * summary.winRate[i]!).toFixed(1)}%`));
  console.log(`  hit the turn cap: ${(100 * summary.cappedRate).toFixed(1)}% (winner = net-worth leader)`);
  console.log(`  average length: ${summary.avgTurns} turns`);
  console.log(`  speed: ${summary.stepsPerSec} actions/s, ${summary.seconds} s`);
}
