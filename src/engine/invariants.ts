// Properties that must hold after every action of every game. The checker in
// src/sim/check.ts runs these after each step of thousands of seeded games.

import { BANK_HOTELS, BANK_HOUSES, BOARD_SIZE, HOTEL, OWNABLE_INDICES, districtMembers, space } from './board.js';
import { CARDS } from './cards.js';
import type { GameState } from './types.js';

export function checkInvariants(st: GameState, startingCash: number): string[] {
  const errs: string[] = [];
  const n = st.players.length;

  const cash = st.players.reduce((a, p) => a + p.cash, 0);
  if (cash !== startingCash * n + st.bankNet) {
    errs.push(`money: players hold ${cash}, expected ${startingCash * n + st.bankNet}`);
  }
  for (const p of st.players) {
    if (p.cash < 0) errs.push(`player ${p.id} has negative cash ${p.cash}`);
    if (!Number.isInteger(p.cash)) errs.push(`player ${p.id} has fractional cash ${p.cash}`);
    if (p.pos < 0 || p.pos >= BOARD_SIZE) errs.push(`player ${p.id} off the board at ${p.pos}`);
    if (p.bankrupt && p.cash !== 0) errs.push(`bankrupt player ${p.id} still holds ${p.cash}`);
  }

  let houses = 0;
  let hotels = 0;
  for (const i of OWNABLE_INDICES) {
    const d = st.deeds[i]!;
    if (d.owner !== null) {
      const o = st.players[d.owner];
      if (!o) errs.push(`deed ${i} owned by unknown player ${d.owner}`);
      else if (o.bankrupt) errs.push(`deed ${i} owned by bankrupt player ${d.owner}`);
    }
    if (d.houses === HOTEL) hotels++;
    else houses += d.houses;
    const s = space(i);
    if (s.kind !== 'street') {
      if (d.houses !== 0) errs.push(`buildings on non-street ${i}`);
      continue;
    }
    if (d.houses > 0 && d.mortgaged) errs.push(`buildings on mortgaged ${i}`);
    if (d.houses > 0 && d.owner === null) errs.push(`buildings on unowned ${i}`);
    if (d.houses > 0 && !districtMembers(s.district).every((j) => st.deeds[j]!.owner === d.owner)) {
      errs.push(`buildings on ${i} without the whole district`);
    }
  }
  if (houses + st.bank.houses !== BANK_HOUSES) errs.push(`houses: ${houses} placed + ${st.bank.houses} in bank != ${BANK_HOUSES}`);
  if (hotels + st.bank.hotels !== BANK_HOTELS) errs.push(`hotels: ${hotels} placed + ${st.bank.hotels} in bank != ${BANK_HOTELS}`);
  if (st.bank.houses < 0 || st.bank.hotels < 0) errs.push('bank building supply went negative');

  const held = st.players.flatMap((p) => p.jailCards);
  const inDecks = [...st.decks.fortune, ...st.decks.ledger];
  const all = [...held, ...inDecks].sort((a, b) => a - b);
  if (all.length !== CARDS.length || all.some((id, k) => id !== k)) errs.push('cards lost or duplicated');

  if (st.phase === 'debt' && st.debts.length === 0) errs.push('debt phase with no debts');
  if (st.phase !== 'debt' && st.debts.length > 0) errs.push(`debts outstanding in phase ${st.phase}`);
  if (st.phase === 'buy' && st.pendingBuy === null) errs.push('buy phase with nothing to buy');
  if (st.phase !== 'over' && st.players[st.current]?.bankrupt) errs.push('current player is bankrupt');
  return errs;
}
