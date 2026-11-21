import type { DeckId } from './board.js';
import type { RngState } from './rng.js';

export interface Player {
  id: number;
  name: string;
  cash: number;
  pos: number;
  inJail: boolean;
  /** Failed rolls made while in jail this stay (0..2). */
  jailTurns: number;
  /** Held "leave the cells" card ids. */
  jailCards: number[];
  bankrupt: boolean;
}

export interface Deed {
  owner: number | null;
  /** 0..4 houses, 5 = hotel. Always 0 for ferries and works. */
  houses: number;
  mortgaged: boolean;
}

/**
 * preRoll  – current player may manage, leave jail, then roll.
 * buy      – current player landed on an unowned space: buy or decline.
 * debt     – debts[0].debtor must raise cash and pay, or go bankrupt.
 * postRoll – current player may manage, then end the turn.
 * over     – one player left (or the game was stopped).
 */
export type Phase = 'preRoll' | 'buy' | 'debt' | 'postRoll' | 'over';

export interface Owed {
  /** null = the bank. */
  creditor: number | null;
  amount: number;
}

export interface Debt {
  debtor: number;
  owed: Owed[];
  reason: string;
}

/** What happens once the debt queue is empty. */
export type Resume = { kind: 'afterMove' } | { kind: 'jailMove'; steps: number };

export interface GameState {
  version: 1;
  seed: number;
  rng: RngState;
  players: Player[];
  /** One entry per board space; null for spaces that can't be owned. */
  deeds: (Deed | null)[];
  bank: { houses: number; hotels: number };
  /** Draw from the front, return to the back. Held jail cards are absent. */
  decks: Record<DeckId, number[]>;
  current: number;
  phase: Phase;
  /** Doubles rolled so far this turn. */
  doubles: number;
  /** The current roll was doubles and earns another roll. */
  extraRoll: boolean;
  lastRoll: [number, number] | null;
  pendingBuy: number | null;
  debts: Debt[];
  resume: Resume | null;
  turn: number;
  winner: number | null;
  /** Bank pay-outs minus bank receipts; sum of player cash = start total + bankNet. */
  bankNet: number;
}

export type Action =
  | { type: 'roll' }
  | { type: 'payJail' }
  | { type: 'useJailCard' }
  | { type: 'buy' }
  | { type: 'decline' }
  | { type: 'build'; index: number }
  | { type: 'sellBuilding'; index: number }
  | { type: 'mortgage'; index: number }
  | { type: 'unmortgage'; index: number }
  | { type: 'payDebt' }
  | { type: 'bankrupt' }
  | { type: 'endTurn' };

export type GameEvent =
  | { t: 'roll'; player: number; dice: [number, number] }
  | { t: 'move'; player: number; from: number; to: number; passedStart: boolean }
  | { t: 'salary'; player: number; amount: number }
  | { t: 'buy'; player: number; index: number; price: number }
  | { t: 'decline'; player: number; index: number }
  | { t: 'rent'; from: number; to: number; index: number; amount: number }
  | { t: 'pay'; from: number | null; to: number | null; amount: number; reason: string }
  | { t: 'card'; player: number; card: number }
  | { t: 'jail'; player: number; reason: string }
  | { t: 'leaveJail'; player: number; how: 'doubles' | 'fine' | 'card' | 'forced' }
  | { t: 'build'; player: number; index: number; houses: number }
  | { t: 'sellBuilding'; player: number; index: number; houses: number }
  | { t: 'mortgage'; player: number; index: number }
  | { t: 'unmortgage'; player: number; index: number }
  | { t: 'debt'; debtor: number; total: number; reason: string }
  | { t: 'bankrupt'; player: number; creditor: number | null }
  | { t: 'turn'; player: number; turn: number }
  | { t: 'gameOver'; winner: number | null };

export class IllegalAction extends Error {
  constructor(public readonly action: Action, reason: string) {
    super(`illegal action ${JSON.stringify(action)}: ${reason}`);
  }
}
