// Game records: the seed, the player names and the action list. Replaying a
// record must reproduce the final state exactly; hashState() makes that cheap
// to compare.

import { apply, newGame } from './rules.js';
import type { Action, GameState } from './types.js';

export interface GameRecord {
  format: 'estates-record-1';
  seed: number;
  players: string[];
  actions: Action[];
}

/** Key-order-independent JSON so equal states always serialise the same way. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/** FNV-1a 64-bit over the canonical JSON, as 16 hex digits. */
export function hashState(st: GameState): string {
  const s = canonicalJson(st);
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

export function replay(rec: GameRecord): GameState {
  let st = newGame({ seed: rec.seed, players: rec.players });
  for (const a of rec.actions) st = apply(st, a).state;
  return st;
}
