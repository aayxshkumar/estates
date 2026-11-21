// The rules engine. `apply(state, action)` is pure: it clones the state,
// validates the action against `legalActions`, and returns the new state plus
// the events that happened. All randomness comes from state.rng.

import {
  BANK_HOTELS, BANK_HOUSES, BOARD, BOARD_SIZE, DISTRICTS, FERRY_INDICES, HOTEL,
  JAIL_FINE, JAIL_INDEX, OWNABLE_INDICES, START_SALARY, STARTING_CASH, WORKS_INDICES,
  districtMembers, mortgageValue, ownable, space, unmortgageCost,
  type DeckId, type StreetSpace,
} from './board.js';
import { card, deckCardIds } from './cards.js';
import { nextInt, seedRng, shuffle } from './rng.js';
import {
  IllegalAction,
  type Action, type Deed, type GameEvent, type GameState, type Owed, type Phase, type Player,
} from './types.js';

export interface NewGameOptions {
  seed: number;
  players: string[];
  startingCash?: number;
}

export function newGame(opts: NewGameOptions): GameState {
  if (opts.players.length < 2 || opts.players.length > 6) {
    throw new RangeError('estates needs 2 to 6 players');
  }
  const rng = seedRng(opts.seed);
  const cash = opts.startingCash ?? STARTING_CASH;
  const players: Player[] = opts.players.map((name, id) => ({
    id, name, cash, pos: 0, inJail: false, jailTurns: 0, jailCards: [], bankrupt: false,
  }));
  const deeds: (Deed | null)[] = BOARD.map((_, i) =>
    OWNABLE_INDICES.includes(i) ? { owner: null, houses: 0, mortgaged: false } : null);
  const decks = {
    fortune: shuffle(rng, deckCardIds('fortune')),
    ledger: shuffle(rng, deckCardIds('ledger')),
  };
  return {
    version: 1, seed: opts.seed, rng, players, deeds,
    bank: { houses: BANK_HOUSES, hotels: BANK_HOTELS },
    decks, current: 0, phase: 'preRoll', doubles: 0, extraRoll: false, lastRoll: null,
    pendingBuy: null, debts: [], resume: null, turn: 1, winner: null, bankNet: 0,
  };
}

// ---------------------------------------------------------------------------
// Queries

export function deed(st: GameState, index: number): Deed {
  const d = st.deeds[index];
  if (!d) throw new Error(`space ${index} has no deed`);
  return d;
}

function player(st: GameState, id: number): Player {
  const p = st.players[id];
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

/** The player who must act now. */
export function actor(st: GameState): number {
  if (st.phase === 'debt') return st.debts[0]!.debtor;
  return st.current;
}

export function ownsDistrict(st: GameState, owner: number, index: number): boolean {
  const s = space(index) as StreetSpace;
  return districtMembers(s.district).every((i) => deed(st, i).owner === owner);
}

export function rentFor(st: GameState, index: number, diceTotal: number): number {
  const d = deed(st, index);
  if (d.owner === null || d.mortgaged) return 0;
  const s = ownable(index);
  if (s.kind === 'street') {
    if (d.houses > 0) return s.rent[d.houses]!;
    return ownsDistrict(st, d.owner, index) ? s.rent[0] * 2 : s.rent[0];
  }
  if (s.kind === 'ferry') {
    const n = FERRY_INDICES.filter((i) => deed(st, i).owner === d.owner).length;
    return 25 * 2 ** (n - 1);
  }
  const both = WORKS_INDICES.every((i) => deed(st, i).owner === d.owner);
  return diceTotal * (both ? 10 : 4);
}

export function canBuild(st: GameState, pid: number, index: number): boolean {
  const s = space(index);
  if (s.kind !== 'street') return false;
  const d = deed(st, index);
  if (d.owner !== pid || d.houses >= HOTEL) return false;
  const members = districtMembers(s.district);
  if (!members.every((i) => deed(st, i).owner === pid && !deed(st, i).mortgaged)) return false;
  const min = Math.min(...members.map((i) => deed(st, i).houses));
  if (d.houses !== min) return false;
  if (d.houses === 4 ? st.bank.hotels < 1 : st.bank.houses < 1) return false;
  return player(st, pid).cash >= DISTRICTS[s.district].houseCost;
}

export function canSellBuilding(st: GameState, pid: number, index: number): boolean {
  const s = space(index);
  if (s.kind !== 'street') return false;
  const d = deed(st, index);
  if (d.owner !== pid || d.houses === 0) return false;
  const max = Math.max(...districtMembers(s.district).map((i) => deed(st, i).houses));
  if (d.houses !== max) return false;
  // Breaking a hotel back into 4 houses needs 4 houses in the bank.
  if (d.houses === HOTEL && st.bank.houses < 4) return false;
  return true;
}

export function canMortgage(st: GameState, pid: number, index: number): boolean {
  const d = deed(st, index);
  if (d.owner !== pid || d.mortgaged) return false;
  const s = ownable(index);
  if (s.kind === 'street' && districtMembers(s.district).some((i) => deed(st, i).houses > 0)) return false;
  return true;
}

export function canUnmortgage(st: GameState, pid: number, index: number): boolean {
  const d = deed(st, index);
  return d.owner === pid && d.mortgaged && player(st, pid).cash >= unmortgageCost(index);
}

export function totalOwed(st: GameState): number {
  const debt = st.debts[0];
  return debt ? debt.owed.reduce((a, o) => a + o.amount, 0) : 0;
}

export function legalActions(st: GameState): Action[] {
  if (st.phase === 'over') return [];
  const pid = actor(st);
  const p = player(st, pid);
  const out: Action[] = [];
  const owned = OWNABLE_INDICES.filter((i) => deed(st, i).owner === pid);

  if (st.phase === 'debt') {
    if (p.cash >= totalOwed(st)) out.push({ type: 'payDebt' });
    for (const i of owned) if (canSellBuilding(st, pid, i)) out.push({ type: 'sellBuilding', index: i });
    for (const i of owned) if (canMortgage(st, pid, i)) out.push({ type: 'mortgage', index: i });
    out.push({ type: 'bankrupt' });
    return out;
  }

  if (st.phase === 'buy') {
    if (p.cash >= ownable(st.pendingBuy!).price) out.push({ type: 'buy' });
    out.push({ type: 'decline' });
    for (const i of owned) if (canSellBuilding(st, pid, i)) out.push({ type: 'sellBuilding', index: i });
    for (const i of owned) if (canMortgage(st, pid, i)) out.push({ type: 'mortgage', index: i });
    return out;
  }

  if (st.phase === 'preRoll') {
    out.push({ type: 'roll' });
    if (p.inJail && p.cash >= JAIL_FINE) out.push({ type: 'payJail' });
    if (p.inJail && p.jailCards.length > 0) out.push({ type: 'useJailCard' });
  } else {
    out.push({ type: 'endTurn' });
  }
  for (const i of owned) if (canBuild(st, pid, i)) out.push({ type: 'build', index: i });
  for (const i of owned) if (canSellBuilding(st, pid, i)) out.push({ type: 'sellBuilding', index: i });
  for (const i of owned) if (canMortgage(st, pid, i)) out.push({ type: 'mortgage', index: i });
  for (const i of owned) if (canUnmortgage(st, pid, i)) out.push({ type: 'unmortgage', index: i });
  return out;
}

// ---------------------------------------------------------------------------
// Transitions

interface Ctx {
  st: GameState;
  ev: GameEvent[];
}

function transfer(c: Ctx, from: number | null, to: number | null, amount: number, reason: string): void {
  if (amount <= 0) return;
  if (from !== null) player(c.st, from).cash -= amount;
  else c.st.bankNet += amount;
  if (to !== null) player(c.st, to).cash += amount;
  else c.st.bankNet -= amount;
  c.ev.push({ t: 'pay', from, to, amount, reason });
}

/** Pays the debts now if possible, otherwise queues a debt. */
function charge(c: Ctx, debtor: number, owed: Owed[], reason: string): void {
  const live = owed.filter((o) => o.amount > 0 && (o.creditor === null || !player(c.st, o.creditor).bankrupt));
  const total = live.reduce((a, o) => a + o.amount, 0);
  if (total === 0) return;
  if (player(c.st, debtor).cash >= total && c.st.debts.length === 0) {
    for (const o of live) transfer(c, debtor, o.creditor, o.amount, reason);
    return;
  }
  c.st.debts.push({ debtor, owed: live, reason });
  c.ev.push({ t: 'debt', debtor, total, reason });
  if (c.st.phase !== 'debt') {
    c.st.resume ??= { kind: 'afterMove' };
    c.st.phase = 'debt';
  }
}

function sendToJail(c: Ctx, pid: number, reason: string): void {
  const p = player(c.st, pid);
  c.ev.push({ t: 'move', player: pid, from: p.pos, to: JAIL_INDEX, passedStart: false });
  p.pos = JAIL_INDEX;
  p.inJail = true;
  p.jailTurns = 0;
  c.st.doubles = 0;
  c.st.extraRoll = false;
  c.ev.push({ t: 'jail', player: pid, reason });
}

function moveTo(c: Ctx, pid: number, to: number, forward: boolean): void {
  const p = player(c.st, pid);
  const passedStart = forward && to < p.pos;
  c.ev.push({ t: 'move', player: pid, from: p.pos, to, passedStart });
  p.pos = to;
  if (passedStart) {
    transfer(c, null, pid, START_SALARY, 'salary');
    c.ev.push({ t: 'salary', player: pid, amount: START_SALARY });
  }
}

interface LandOpts {
  ferryMultiplier?: number;
  worksMultiplier?: number;
}

function land(c: Ctx, pid: number, opts: LandOpts = {}): void {
  const st = c.st;
  const p = player(st, pid);
  const s = space(p.pos);
  const dice = st.lastRoll ? st.lastRoll[0] + st.lastRoll[1] : 0;
  switch (s.kind) {
    case 'street':
    case 'ferry':
    case 'works': {
      const d = deed(st, p.pos);
      if (d.owner === null) {
        st.pendingBuy = p.pos;
        st.phase = 'buy';
        return;
      }
      if (d.owner === pid || d.mortgaged || player(st, d.owner).bankrupt) return;
      let rent = rentFor(st, p.pos, dice);
      if (s.kind === 'ferry' && opts.ferryMultiplier) rent *= opts.ferryMultiplier;
      if (s.kind === 'works' && opts.worksMultiplier) rent = dice * opts.worksMultiplier;
      c.ev.push({ t: 'rent', from: pid, to: d.owner, index: p.pos, amount: rent });
      charge(c, pid, [{ creditor: d.owner, amount: rent }], `rent on ${s.name}`);
      return;
    }
    case 'tax':
      charge(c, pid, [{ creditor: null, amount: s.amount }], s.name);
      return;
    case 'card':
      drawCard(c, pid, s.deck);
      return;
    case 'arrest':
      sendToJail(c, pid, 'arrested');
      return;
    default:
      return;
  }
}

function drawCard(c: Ctx, pid: number, deckId: DeckId): void {
  const st = c.st;
  const deck = st.decks[deckId];
  const id = deck.shift();
  if (id === undefined) return; // every card of this deck is held as a jail card
  const cd = card(id);
  c.ev.push({ t: 'card', player: pid, card: id });
  const p = player(st, pid);
  const e = cd.effect;
  if (e.kind === 'jailFree') {
    p.jailCards.push(id);
    return;
  }
  deck.push(id);
  const others = st.players.filter((o) => o.id !== pid && !o.bankrupt);
  switch (e.kind) {
    case 'advanceTo':
      moveTo(c, pid, e.index, true);
      land(c, pid);
      return;
    case 'advanceToNearest': {
      const targets = e.target === 'ferry' ? FERRY_INDICES : WORKS_INDICES;
      const to = targets.find((i) => i > p.pos) ?? targets[0]!;
      moveTo(c, pid, to, true);
      land(c, pid, e.target === 'ferry' ? { ferryMultiplier: 2 } : { worksMultiplier: 10 });
      return;
    }
    case 'moveBack':
      moveTo(c, pid, (p.pos - e.steps + BOARD_SIZE) % BOARD_SIZE, false);
      land(c, pid);
      return;
    case 'goToJail':
      sendToJail(c, pid, 'card');
      return;
    case 'collect':
      transfer(c, null, pid, e.amount, 'card');
      return;
    case 'pay':
      charge(c, pid, [{ creditor: null, amount: e.amount }], 'card');
      return;
    case 'payEachPlayer':
      charge(c, pid, others.map((o) => ({ creditor: o.id, amount: e.amount })), 'card');
      return;
    case 'collectFromEachPlayer':
      for (const o of others) charge(c, o.id, [{ creditor: pid, amount: e.amount }], 'card');
      return;
    case 'repairs': {
      let houses = 0;
      let hotels = 0;
      for (const i of OWNABLE_INDICES) {
        const d = deed(st, i);
        if (d.owner !== pid) continue;
        if (d.houses === HOTEL) hotels++;
        else houses += d.houses;
      }
      charge(c, pid, [{ creditor: null, amount: houses * e.perHouse + hotels * e.perHotel }], 'repairs');
      return;
    }
  }
}

function afterMovePhase(st: GameState): Phase {
  const p = player(st, st.current);
  return st.extraRoll && !p.inJail ? 'preRoll' : 'postRoll';
}

/** Moves by a dice roll and resolves the landing; sets the next phase. */
function moveAndLand(c: Ctx, pid: number, steps: number): void {
  const p = player(c.st, pid);
  moveTo(c, pid, (p.pos + steps) % BOARD_SIZE, true);
  c.st.phase = 'postRoll'; // placeholder: land() may switch to buy/debt
  land(c, pid);
  if (c.st.phase === 'postRoll') c.st.phase = afterMovePhase(c.st);
}

function rollDice(st: GameState): [number, number] {
  const d: [number, number] = [nextInt(st.rng, 6) + 1, nextInt(st.rng, 6) + 1];
  st.lastRoll = d;
  return d;
}

function doRoll(c: Ctx): void {
  const st = c.st;
  const pid = st.current;
  const p = player(st, pid);
  const d = rollDice(st);
  c.ev.push({ t: 'roll', player: pid, dice: d });
  const isDouble = d[0] === d[1];
  const steps = d[0] + d[1];

  if (p.inJail) {
    st.extraRoll = false;
    if (isDouble) {
      p.inJail = false;
      p.jailTurns = 0;
      c.ev.push({ t: 'leaveJail', player: pid, how: 'doubles' });
      moveAndLand(c, pid, steps);
      return;
    }
    p.jailTurns++;
    if (p.jailTurns < 3) {
      st.phase = 'postRoll';
      return;
    }
    p.inJail = false;
    p.jailTurns = 0;
    c.ev.push({ t: 'leaveJail', player: pid, how: 'forced' });
    st.phase = 'postRoll';
    charge(c, pid, [{ creditor: null, amount: JAIL_FINE }], 'jail fine');
    if ((st.phase as Phase) === 'debt') {
      st.resume = { kind: 'jailMove', steps };
      return;
    }
    moveAndLand(c, pid, steps);
    return;
  }

  if (isDouble) {
    st.doubles++;
    if (st.doubles === 3) {
      sendToJail(c, pid, 'three doubles');
      st.phase = 'postRoll';
      return;
    }
  }
  st.extraRoll = isDouble;
  moveAndLand(c, pid, steps);
}

function liquidateBuildings(c: Ctx, pid: number): void {
  const st = c.st;
  for (const i of OWNABLE_INDICES) {
    const d = deed(st, i);
    if (d.owner !== pid || d.houses === 0) continue;
    const s = space(i) as StreetSpace;
    const cost = DISTRICTS[s.district].houseCost;
    if (d.houses === HOTEL) st.bank.hotels++;
    else st.bank.houses += d.houses;
    transfer(c, null, pid, (d.houses * cost) / 2, 'liquidation');
    d.houses = 0;
  }
}

function goBankrupt(c: Ctx): void {
  const st = c.st;
  const debt = st.debts.shift()!;
  const pid = debt.debtor;
  const p = player(st, pid);
  liquidateBuildings(c, pid);
  const single = debt.owed.length === 1 ? debt.owed[0]!.creditor : null;
  const owned = OWNABLE_INDICES.filter((i) => deed(st, i).owner === pid);
  if (single !== null) {
    transfer(c, pid, single, p.cash, 'bankruptcy');
    for (const i of owned) deed(st, i).owner = single;
  } else {
    for (const o of debt.owed) {
      if (o.creditor !== null) transfer(c, pid, o.creditor, Math.min(o.amount, p.cash), 'bankruptcy');
    }
    transfer(c, pid, null, p.cash, 'bankruptcy');
    for (const i of owned) {
      const d = deed(st, i);
      d.owner = null;
      d.mortgaged = false;
    }
  }
  for (const id of p.jailCards) st.decks[card(id).deck].push(id);
  p.jailCards = [];
  p.bankrupt = true;
  p.inJail = false;
  c.ev.push({ t: 'bankrupt', player: pid, creditor: single });
}

function payDebt(c: Ctx): void {
  const debt = c.st.debts.shift()!;
  for (const o of debt.owed) transfer(c, debt.debtor, o.creditor, o.amount, debt.reason);
}

function checkGameOver(c: Ctx): boolean {
  const alive = c.st.players.filter((p) => !p.bankrupt);
  if (alive.length > 1) return false;
  c.st.phase = 'over';
  c.st.winner = alive[0]?.id ?? null;
  c.ev.push({ t: 'gameOver', winner: c.st.winner });
  return true;
}

function nextTurn(c: Ctx): void {
  const st = c.st;
  if (checkGameOver(c)) return;
  let next = st.current;
  do next = (next + 1) % st.players.length;
  while (player(st, next).bankrupt);
  st.current = next;
  st.doubles = 0;
  st.extraRoll = false;
  st.pendingBuy = null;
  st.phase = 'preRoll';
  st.turn++;
  c.ev.push({ t: 'turn', player: next, turn: st.turn });
}

function finishDebts(c: Ctx): void {
  const st = c.st;
  if (st.debts.length > 0) return;
  const resume = st.resume ?? { kind: 'afterMove' };
  st.resume = null;
  if (checkGameOver(c)) return;
  if (player(st, st.current).bankrupt) {
    nextTurn(c);
    return;
  }
  if (resume.kind === 'jailMove') {
    moveAndLand(c, st.current, resume.steps);
    return;
  }
  st.phase = afterMovePhase(st);
}

function build(c: Ctx, pid: number, index: number): void {
  const st = c.st;
  const d = deed(st, index);
  const s = space(index) as StreetSpace;
  transfer(c, pid, null, DISTRICTS[s.district].houseCost, 'build');
  if (d.houses === 4) {
    st.bank.hotels--;
    st.bank.houses += 4;
  } else {
    st.bank.houses--;
  }
  d.houses++;
  c.ev.push({ t: 'build', player: pid, index, houses: d.houses });
}

function sellBuilding(c: Ctx, pid: number, index: number): void {
  const st = c.st;
  const d = deed(st, index);
  const s = space(index) as StreetSpace;
  if (d.houses === HOTEL) {
    st.bank.hotels++;
    st.bank.houses -= 4;
  } else {
    st.bank.houses++;
  }
  d.houses--;
  transfer(c, null, pid, DISTRICTS[s.district].houseCost / 2, 'sell building');
  c.ev.push({ t: 'sellBuilding', player: pid, index, houses: d.houses });
}

function sameAction(a: Action, b: Action): boolean {
  return a.type === b.type && ('index' in a ? a.index : -1) === ('index' in b ? b.index : -1);
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

export function apply(prev: GameState, action: Action): ApplyResult {
  if (!legalActions(prev).some((a) => sameAction(a, action))) {
    throw new IllegalAction(action, `not legal in phase ${prev.phase} for player ${actor(prev)}`);
  }
  const st = structuredClone(prev);
  const c: Ctx = { st, ev: [] };
  const pid = actor(st);
  const p = player(st, pid);

  switch (action.type) {
    case 'roll':
      doRoll(c);
      break;
    case 'payJail':
      transfer(c, pid, null, JAIL_FINE, 'jail fine');
      p.inJail = false;
      p.jailTurns = 0;
      c.ev.push({ t: 'leaveJail', player: pid, how: 'fine' });
      break;
    case 'useJailCard': {
      const id = p.jailCards.shift()!;
      st.decks[card(id).deck].push(id);
      p.inJail = false;
      p.jailTurns = 0;
      c.ev.push({ t: 'leaveJail', player: pid, how: 'card' });
      break;
    }
    case 'buy': {
      const index = st.pendingBuy!;
      const price = ownable(index).price;
      transfer(c, pid, null, price, 'buy');
      deed(st, index).owner = pid;
      st.pendingBuy = null;
      c.ev.push({ t: 'buy', player: pid, index, price });
      st.phase = afterMovePhase(st);
      break;
    }
    case 'decline': {
      // Known gap: the classic rule auctions a declined space. Here it stays unowned.
      const index = st.pendingBuy!;
      st.pendingBuy = null;
      c.ev.push({ t: 'decline', player: pid, index });
      st.phase = afterMovePhase(st);
      break;
    }
    case 'build':
      build(c, pid, action.index);
      break;
    case 'sellBuilding':
      sellBuilding(c, pid, action.index);
      break;
    case 'mortgage':
      deed(st, action.index).mortgaged = true;
      transfer(c, null, pid, mortgageValue(action.index), 'mortgage');
      c.ev.push({ t: 'mortgage', player: pid, index: action.index });
      break;
    case 'unmortgage':
      transfer(c, pid, null, unmortgageCost(action.index), 'unmortgage');
      deed(st, action.index).mortgaged = false;
      c.ev.push({ t: 'unmortgage', player: pid, index: action.index });
      break;
    case 'payDebt':
      payDebt(c);
      finishDebts(c);
      break;
    case 'bankrupt':
      goBankrupt(c);
      finishDebts(c);
      break;
    case 'endTurn':
      nextTurn(c);
      break;
  }
  return { state: st, events: c.ev };
}

/** Net worth used to rank players when a game is stopped early. */
export function netWorth(st: GameState, pid: number): number {
  const p = player(st, pid);
  if (p.bankrupt) return 0;
  let worth = p.cash;
  for (const i of OWNABLE_INDICES) {
    const d = deed(st, i);
    if (d.owner !== pid) continue;
    worth += d.mortgaged ? 0 : mortgageValue(i);
    const s = space(i);
    if (s.kind === 'street') worth += (d.houses * DISTRICTS[s.district].houseCost) / 2;
  }
  return worth;
}
