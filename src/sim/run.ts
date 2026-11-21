// Runs one bot-vs-bot game to completion or to a turn cap.

import type { Bot } from '../bots/bots.js';
import { seedRng } from '../engine/rng.js';
import { actor, apply, legalActions, netWorth, newGame } from '../engine/rules.js';
import type { GameRecord } from '../engine/replay.js';
import type { Action, GameEvent, GameState } from '../engine/types.js';

export interface GameResult {
  seed: number;
  /** Winner seat, or the net-worth leader if the cap was hit. */
  winner: number | null;
  capped: boolean;
  turns: number;
  steps: number;
  record: GameRecord;
  final: GameState;
}

export interface RunOptions {
  seed: number;
  bots: Bot[];
  maxTurns: number;
  onStep?: (st: GameState, action: Action, events: GameEvent[]) => void;
}

export function runGame(opts: RunOptions): GameResult {
  const players = opts.bots.map((b, i) => `${b.name}-${i}`);
  let st = newGame({ seed: opts.seed, players });
  const botRng = seedRng(opts.seed ^ 0x5bd1e995);
  const actions: Action[] = [];
  let steps = 0;
  while (st.phase !== 'over' && st.turn <= opts.maxTurns) {
    const legal = legalActions(st);
    if (legal.length === 0) throw new Error(`no legal actions in phase ${st.phase} (seed ${opts.seed})`);
    const action = opts.bots[actor(st)]!.choose(st, legal, botRng);
    const r = apply(st, action);
    st = r.state;
    actions.push(action);
    steps++;
    opts.onStep?.(st, action, r.events);
  }
  const capped = st.phase !== 'over';
  let winner = st.winner;
  if (capped) {
    let best = -1;
    for (const p of st.players) {
      const w = netWorth(st, p.id);
      if (w > best) { best = w; winner = p.id; }
    }
  }
  return {
    seed: opts.seed, winner, capped, turns: st.turn, steps,
    record: { format: 'estates-record-1', seed: opts.seed, players, actions },
    final: st,
  };
}

export function parseArgs(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) m.set(a.slice(2, eq), a.slice(eq + 1));
    else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--')) m.set(a.slice(2), argv[++i]!);
    else m.set(a.slice(2), 'true');
  }
  return m;
}
