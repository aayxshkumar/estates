// Baseline bots. Each bot gets its own RNG so its choices never consume the
// game's random stream.

import { DISTRICTS, ownable, space, unmortgageCost } from '../engine/board.js';
import { nextInt, type RngState } from '../engine/rng.js';
import { actor, totalOwed } from '../engine/rules.js';
import type { Action, GameState } from '../engine/types.js';

export interface Bot {
  readonly name: string;
  choose(st: GameState, legal: Action[], rng: RngState): Action;
}

function pick<T>(rng: RngState, xs: T[]): T {
  return xs[nextInt(rng, xs.length)]!;
}

function find(legal: Action[], type: Action['type']): Action | undefined {
  return legal.find((a) => a.type === type);
}

/** Uniformly random among sensible moves; used to fuzz the rules. */
export const randomBot: Bot = {
  name: 'random',
  choose(st, legal, rng) {
    if (st.phase === 'debt') {
      const pay = find(legal, 'payDebt');
      if (pay && nextInt(rng, 10) > 0) return pay;
      const raise = legal.filter((a) => a.type === 'sellBuilding' || a.type === 'mortgage');
      if (raise.length > 0 && nextInt(rng, 10) > 0) return pick(rng, raise);
      return pay ?? find(legal, 'bankrupt')!;
    }
    // Mostly keep the game moving; sometimes manage property.
    const progress = legal.filter((a) => ['roll', 'endTurn', 'buy', 'decline'].includes(a.type));
    if (nextInt(rng, 3) > 0 || progress.length === legal.length) return pick(rng, progress);
    return pick(rng, legal.filter((a) => !progress.includes(a)));
  },
};

const BUY_RESERVE = 150;
const BUILD_RESERVE = 250;
const UNMORTGAGE_RESERVE = 400;

function costOf(a: Action): number {
  if (a.type === 'build') {
    const s = space(a.index);
    return s.kind === 'street' ? DISTRICTS[s.district].houseCost : 0;
  }
  if (a.type === 'unmortgage') return unmortgageCost(a.index);
  return 0;
}

/** Buys everything it can afford, builds evenly, never trades. */
export const greedyBot: Bot = {
  name: 'greedy',
  choose(st, legal) {
    const me = st.players[actor(st)]!;
    if (st.phase === 'debt') {
      const pay = find(legal, 'payDebt');
      if (pay) return pay;
      const sell = legal.find((a) => a.type === 'sellBuilding');
      if (sell) return sell;
      const mortgages = legal.filter((a): a is Extract<Action, { type: 'mortgage' }> => a.type === 'mortgage');
      if (mortgages.length > 0 && totalOwed(st) > me.cash) {
        mortgages.sort((x, y) => ownable(x.index).price - ownable(y.index).price);
        return mortgages[0]!;
      }
      return find(legal, 'bankrupt')!;
    }
    if (st.phase === 'buy') {
      const buy = find(legal, 'buy');
      const price = ownable(st.pendingBuy!).price;
      if (buy && me.cash - price >= BUY_RESERVE) return buy;
      return find(legal, 'decline')!;
    }
    if (st.phase === 'preRoll' && me.inJail) {
      const card = find(legal, 'useJailCard');
      if (card) return card;
      const pay = find(legal, 'payJail');
      if (pay && me.cash > 500) return pay;
    }
    const build = legal.find((a) => a.type === 'build' && me.cash - costOf(a) >= BUILD_RESERVE);
    if (build) return build;
    const unm = legal.find((a) => a.type === 'unmortgage' && me.cash - costOf(a) >= UNMORTGAGE_RESERVE);
    if (unm) return unm;
    return find(legal, 'roll') ?? find(legal, 'endTurn')!;
  },
};

export const BOTS: Record<string, Bot> = { random: randomBot, greedy: greedyBot };
