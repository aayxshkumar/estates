import assert from 'node:assert/strict';
import { test } from 'node:test';

import { greedyBot } from '../src/bots/bots.js';
import {
  BOARD, BOARD_SIZE, DISTRICTS, FERRY_INDICES, JAIL_INDEX, OWNABLE_INDICES, WORKS_INDICES,
  districtMembers, unmortgageCost,
} from '../src/engine/board.js';
import { CARDS } from '../src/engine/cards.js';
import { checkInvariants } from '../src/engine/invariants.js';
import { hashState, replay } from '../src/engine/replay.js';
import { nextInt, seedRng, shuffle } from '../src/engine/rng.js';
import { apply, canBuild, canMortgage, deed, legalActions, newGame, rentFor } from '../src/engine/rules.js';
import type { GameState } from '../src/engine/types.js';
import { runGame } from '../src/sim/run.js';

function game(n = 2, seed = 1): GameState {
  return newGame({ seed, players: Array.from({ length: n }, (_, i) => `p${i}`) });
}

function give(st: GameState, owner: number, ...indices: number[]): void {
  for (const i of indices) deed(st, i).owner = owner;
}

test('rng is deterministic and unbiased enough', () => {
  const a = seedRng(7);
  const b = seedRng(7);
  const xs = Array.from({ length: 1000 }, () => nextInt(a, 6));
  const ys = Array.from({ length: 1000 }, () => nextInt(b, 6));
  assert.deepEqual(xs, ys);
  const counts = [0, 0, 0, 0, 0, 0];
  for (const x of xs) counts[x]!++;
  for (const c of counts) assert.ok(c > 120 && c < 220, `face count ${c}`);
  const p = shuffle(seedRng(3), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([...p].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('board shape', () => {
  assert.equal(BOARD.length, BOARD_SIZE);
  assert.equal(OWNABLE_INDICES.length, 28);
  assert.equal(FERRY_INDICES.length, 4);
  assert.equal(WORKS_INDICES.length, 2);
  for (const d of Object.values(DISTRICTS)) {
    const n = districtMembers(d.id).length;
    assert.ok(n === 2 || n === 3, `${d.name} has ${n} streets`);
  }
  assert.equal(BOARD[JAIL_INDEX]!.kind, 'jail');
  assert.equal(CARDS.filter((c) => c.effect.kind === 'jailFree').length, 2);
});

test('street rent: base, whole district, houses, hotel', () => {
  const st = game();
  give(st, 0, 1);
  assert.equal(rentFor(st, 1, 7), 5);
  give(st, 0, 3);
  assert.equal(rentFor(st, 1, 7), 10);
  deed(st, 1).houses = 3;
  assert.equal(rentFor(st, 1, 7), 5 * 38);
  deed(st, 1).houses = 5;
  assert.equal(rentFor(st, 1, 7), 5 * 65);
  deed(st, 1).mortgaged = true;
  assert.equal(rentFor(st, 1, 7), 0);
});

test('ferry rent doubles with each ferry owned', () => {
  const st = game();
  const expected = [25, 50, 100, 200];
  FERRY_INDICES.forEach((f, k) => {
    give(st, 1, f);
    assert.equal(rentFor(st, FERRY_INDICES[0]!, 7), expected[k]);
  });
});

test('works rent is 4x dice, 10x with both', () => {
  const st = game();
  give(st, 1, WORKS_INDICES[0]!);
  assert.equal(rentFor(st, WORKS_INDICES[0]!, 9), 36);
});

test('building must be even across the district', () => {
  const st = game();
  give(st, 0, 1, 3);
  assert.ok(canBuild(st, 0, 1));
  const next = apply(st, { type: 'build', index: 1 }).state;
  assert.equal(deed(next, 1).houses, 1);
  assert.equal(next.bank.houses, 31);
  assert.equal(canBuild(next, 0, 1), false, 'second house before the first on Tar Yard');
  assert.ok(canBuild(next, 0, 3));
});

test('no building while any street in the district is mortgaged', () => {
  const st = game();
  give(st, 0, 1, 3);
  deed(st, 3).mortgaged = true;
  assert.equal(canBuild(st, 0, 1), false);
});

test('cannot mortgage while the district has buildings', () => {
  const st = game();
  give(st, 0, 1, 3);
  deed(st, 3).houses = 1;
  st.bank.houses--;
  assert.equal(canMortgage(st, 0, 1), false);
});

test('unmortgage costs the mortgage plus 10%, rounded up', () => {
  assert.equal(unmortgageCost(1), 33);
  assert.equal(unmortgageCost(39), 220);
});

test('passing Start pays the salary', () => {
  let st = game();
  st.players[0]!.pos = 38;
  st = apply(st, { type: 'roll' }).state;
  const p = st.players[0]!;
  if (p.pos < 38 && p.pos !== JAIL_INDEX) assert.ok(p.cash >= 1500 + 200 - 400, 'salary paid');
  assert.deepEqual(checkInvariants(st, 1500), []);
});

test('three doubles in one turn sends you to the holding cells', () => {
  // Find a seed whose first three rolls are doubles.
  for (let seed = 1; seed < 20000; seed++) {
    let st = game(2, seed);
    let doubles = 0;
    while (st.current === 0 && st.phase === 'preRoll' && doubles < 3) {
      st = apply(st, { type: 'roll' }).state;
      if (st.lastRoll![0] !== st.lastRoll![1]) break;
      doubles++;
      while (st.phase === 'buy') st = apply(st, { type: 'decline' }).state;
      if (st.phase === 'debt') break;
    }
    if (doubles === 3) {
      assert.equal(st.players[0]!.pos, JAIL_INDEX);
      assert.equal(st.players[0]!.inJail, true);
      assert.equal(st.phase, 'postRoll');
      return;
    }
  }
  assert.fail('no seed with three opening doubles');
});

test('bankruptcy to a player hands over cash and deeds', () => {
  let st = game(3);
  give(st, 1, 39);
  deed(st, 37).owner = 1;
  deed(st, 39).houses = 0;
  st.players[0]!.cash = 10;
  give(st, 0, 5);
  st.debts.push({ debtor: 0, owed: [{ creditor: 1, amount: 400 }], reason: 'test' });
  st.phase = 'debt';
  st.resume = { kind: 'afterMove' };
  st = apply(st, { type: 'bankrupt' }).state;
  assert.equal(st.players[0]!.bankrupt, true);
  assert.equal(st.players[0]!.cash, 0);
  assert.equal(st.players[1]!.cash, 1510);
  assert.equal(deed(st, 5).owner, 1);
  assert.equal(st.current, 1);
});

test('illegal actions are rejected', () => {
  const st = game();
  assert.throws(() => apply(st, { type: 'endTurn' }), /illegal action/);
  assert.throws(() => apply(st, { type: 'build', index: 1 }), /illegal action/);
  assert.deepEqual(legalActions(st).map((a) => a.type), ['roll']);
});

test('apply does not mutate its input', () => {
  const st = game();
  const before = hashState(st);
  apply(st, { type: 'roll' });
  assert.equal(hashState(st), before);
});

test('replay reproduces a recorded game exactly', () => {
  const r = runGame({ seed: 42, bots: [greedyBot, greedyBot, greedyBot], maxTurns: 300 });
  const again = replay(r.record);
  assert.equal(hashState(again), hashState(r.final));
  assert.deepEqual(checkInvariants(r.final, 1500), []);
});
