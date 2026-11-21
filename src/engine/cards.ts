import type { DeckId } from './board.js';

export type CardEffect =
  | { kind: 'advanceTo'; index: number }
  | { kind: 'advanceToNearest'; target: 'ferry' | 'works' }
  | { kind: 'moveBack'; steps: number }
  | { kind: 'goToJail' }
  | { kind: 'jailFree' }
  | { kind: 'collect'; amount: number }
  | { kind: 'pay'; amount: number }
  | { kind: 'payEachPlayer'; amount: number }
  | { kind: 'collectFromEachPlayer'; amount: number }
  | { kind: 'repairs'; perHouse: number; perHotel: number };

export interface Card {
  id: number;
  deck: DeckId;
  text: string;
  effect: CardEffect;
}

const FORTUNE: Omit<Card, 'id' | 'deck'>[] = [
  { text: 'A tailwind carries you to Start. Collect your salary.', effect: { kind: 'advanceTo', index: 0 } },
  { text: 'Take the tram to Crown Point.', effect: { kind: 'advanceTo', index: 39 } },
  { text: 'You are summoned to Bell Street.', effect: { kind: 'advanceTo', index: 26 } },
  { text: 'Walk to Candle Street.', effect: { kind: 'advanceTo', index: 11 } },
  { text: 'Catch the nearest ferry. If it is owned, pay its owner twice the fare.', effect: { kind: 'advanceToNearest', target: 'ferry' } },
  { text: 'Catch the nearest ferry. If it is owned, pay its owner twice the fare.', effect: { kind: 'advanceToNearest', target: 'ferry' } },
  { text: 'Inspect the nearest works. If owned, pay ten times the dice.', effect: { kind: 'advanceToNearest', target: 'works' } },
  { text: 'You took a wrong turn. Go back three spaces.', effect: { kind: 'moveBack', steps: 3 } },
  { text: 'Caught smuggling lanterns. Go straight to the Holding Cells.', effect: { kind: 'goToJail' } },
  { text: 'The harbormaster owes you a favour. Keep this card to leave the cells.', effect: { kind: 'jailFree' } },
  { text: 'Your ship came in. Collect 150.', effect: { kind: 'collect', amount: 150 } },
  { text: 'Dockside fine for loitering. Pay 15.', effect: { kind: 'pay', amount: 15 } },
  { text: 'Elected harbor warden. Pay each player 50.', effect: { kind: 'payEachPlayer', amount: 50 } },
  { text: 'Storm damage: pay 25 per house and 100 per hotel.', effect: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
];

const LEDGER: Omit<Card, 'id' | 'deck'>[] = [
  { text: 'Back to Start. Collect your salary.', effect: { kind: 'advanceTo', index: 0 } },
  { text: 'An audit finds a refund in your favour. Collect 200.', effect: { kind: 'collect', amount: 200 } },
  { text: 'Doctor’s visit. Pay 50.', effect: { kind: 'pay', amount: 50 } },
  { text: 'You sold old ropes. Collect 50.', effect: { kind: 'collect', amount: 50 } },
  { text: 'Clerical error at the Holding Cells. Keep this card to walk out free.', effect: { kind: 'jailFree' } },
  { text: 'Tax inspectors arrive. Go to the Holding Cells.', effect: { kind: 'goToJail' } },
  { text: 'It is your naming day. Collect 10 from each player.', effect: { kind: 'collectFromEachPlayer', amount: 10 } },
  { text: 'Guild dividend. Collect 100.', effect: { kind: 'collect', amount: 100 } },
  { text: 'School fees. Pay 100.', effect: { kind: 'pay', amount: 100 } },
  { text: 'Street repairs: pay 40 per house and 115 per hotel.', effect: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
  { text: 'Prize at the harvest fair. Collect 10.', effect: { kind: 'collect', amount: 10 } },
  { text: 'Inheritance from a sea captain. Collect 100.', effect: { kind: 'collect', amount: 100 } },
];

export const CARDS: readonly Card[] = [
  ...FORTUNE.map((c, i) => ({ ...c, id: i, deck: 'fortune' as const })),
  ...LEDGER.map((c, i) => ({ ...c, id: FORTUNE.length + i, deck: 'ledger' as const })),
];

export function card(id: number): Card {
  const c = CARDS[id];
  if (!c) throw new RangeError(`no card ${id}`);
  return c;
}

export function deckCardIds(deck: DeckId): number[] {
  return CARDS.filter((c) => c.deck === deck).map((c) => c.id);
}
