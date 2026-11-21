// The board of Port Meridian: 40 spaces, 8 districts, 4 ferry terminals and
// 2 works. All names and numbers are this project's own.

export type DistrictId =
  | 'docks' | 'market' | 'lantern' | 'mill'
  | 'garden' | 'clock' | 'heights' | 'summit';

export interface District {
  id: DistrictId;
  name: string;
  color: string;
  houseCost: number;
}

export const DISTRICTS: Record<DistrictId, District> = {
  docks:   { id: 'docks',   name: 'Old Docks',       color: '#8a5a3c', houseCost: 50 },
  market:  { id: 'market',  name: 'Market Row',      color: '#5fb4d9', houseCost: 50 },
  lantern: { id: 'lantern', name: 'Lantern Quarter', color: '#c2479c', houseCost: 100 },
  mill:    { id: 'mill',    name: 'Mill Street',     color: '#ee8a2b', houseCost: 100 },
  garden:  { id: 'garden',  name: 'Garden Ward',     color: '#d93b3b', houseCost: 150 },
  clock:   { id: 'clock',   name: 'Clocktower',      color: '#e6c229', houseCost: 150 },
  heights: { id: 'heights', name: 'Harbor Heights',  color: '#2f9e5b', houseCost: 200 },
  summit:  { id: 'summit',  name: 'Summit',          color: '#2a4fa8', houseCost: 200 },
};

export interface StreetSpace {
  kind: 'street';
  name: string;
  district: DistrictId;
  price: number;
  /** Rent with 0..4 houses, then with a hotel (index 5). */
  rent: [number, number, number, number, number, number];
}
export interface FerrySpace { kind: 'ferry'; name: string; price: number }
export interface WorksSpace { kind: 'works'; name: string; price: number }
export interface TaxSpace { kind: 'tax'; name: string; amount: number }
export interface CardSpace { kind: 'card'; name: string; deck: DeckId }
export interface CornerSpace { kind: 'start' | 'jail' | 'square' | 'arrest'; name: string }

export type DeckId = 'fortune' | 'ledger';
export type Space = StreetSpace | FerrySpace | WorksSpace | TaxSpace | CardSpace | CornerSpace;
export type OwnableSpace = StreetSpace | FerrySpace | WorksSpace;

const HOUSE_MULT = [5, 14, 38, 52, 65] as const;

function street(name: string, district: DistrictId, price: number): StreetSpace {
  const base = Math.round(price / 12.5);
  return {
    kind: 'street', name, district, price,
    rent: [base, base * HOUSE_MULT[0], base * HOUSE_MULT[1], base * HOUSE_MULT[2], base * HOUSE_MULT[3], base * HOUSE_MULT[4]],
  };
}

export const BOARD: readonly Space[] = [
  { kind: 'start', name: 'Start' },
  street('Rope Walk', 'docks', 60),
  { kind: 'card', name: 'Fortune', deck: 'fortune' },
  street('Tar Yard', 'docks', 60),
  { kind: 'tax', name: 'Harbor Levy', amount: 200 },
  { kind: 'ferry', name: 'North Ferry', price: 200 },
  street('Fishmonger Lane', 'market', 100),
  { kind: 'card', name: 'Ledger', deck: 'ledger' },
  street('Spice Alley', 'market', 100),
  street("Weaver's Court", 'market', 120),
  { kind: 'jail', name: 'Holding Cells' },
  street('Candle Street', 'lantern', 140),
  { kind: 'works', name: 'Gasworks', price: 150 },
  street('Lamplight Way', 'lantern', 140),
  street('Glassblowers Row', 'lantern', 160),
  { kind: 'ferry', name: 'East Ferry', price: 200 },
  street('Millrace Road', 'mill', 180),
  { kind: 'card', name: 'Fortune', deck: 'fortune' },
  street('Grain Exchange', 'mill', 180),
  street('Bakers Green', 'mill', 200),
  { kind: 'square', name: 'Town Square' },
  street('Rose Terrace', 'garden', 220),
  { kind: 'card', name: 'Ledger', deck: 'ledger' },
  street('Orchard Walk', 'garden', 220),
  street('Conservatory Rise', 'garden', 240),
  { kind: 'ferry', name: 'South Ferry', price: 200 },
  street('Bell Street', 'clock', 260),
  street('Gearwright Plaza', 'clock', 260),
  { kind: 'works', name: 'Waterworks', price: 150 },
  street('Chronicle Square', 'clock', 280),
  { kind: 'arrest', name: 'Arrested' },
  street("Admiral's Row", 'heights', 300),
  street('Lighthouse Hill', 'heights', 300),
  { kind: 'card', name: 'Fortune', deck: 'fortune' },
  street("Captain's Crescent", 'heights', 320),
  { kind: 'ferry', name: 'West Ferry', price: 200 },
  { kind: 'card', name: 'Ledger', deck: 'ledger' },
  street('Observatory Park', 'summit', 350),
  { kind: 'tax', name: 'Luxury Duty', amount: 100 },
  street('Crown Point', 'summit', 400),
];

export const BOARD_SIZE = 40;
export const JAIL_INDEX = 10;
export const START_SALARY = 200;
export const JAIL_FINE = 50;
export const STARTING_CASH = 1500;
export const BANK_HOUSES = 32;
export const BANK_HOTELS = 12;
export const HOTEL = 5;

export function isOwnable(space: Space): space is OwnableSpace {
  return space.kind === 'street' || space.kind === 'ferry' || space.kind === 'works';
}

export function space(index: number): Space {
  const s = BOARD[index];
  if (!s) throw new RangeError(`no space ${index}`);
  return s;
}

export function ownable(index: number): OwnableSpace {
  const s = space(index);
  if (!isOwnable(s)) throw new Error(`space ${index} (${s.name}) is not ownable`);
  return s;
}

export const OWNABLE_INDICES: readonly number[] = BOARD.flatMap((s, i) => (isOwnable(s) ? [i] : []));
export const FERRY_INDICES: readonly number[] = BOARD.flatMap((s, i) => (s.kind === 'ferry' ? [i] : []));
export const WORKS_INDICES: readonly number[] = BOARD.flatMap((s, i) => (s.kind === 'works' ? [i] : []));

export function districtMembers(d: DistrictId): number[] {
  return BOARD.flatMap((s, i) => (s.kind === 'street' && s.district === d ? [i] : []));
}

export function mortgageValue(index: number): number {
  return ownable(index).price / 2;
}

export function unmortgageCost(index: number): number {
  // Integer arithmetic: 200 * 1.1 is 220.00000000000003 in floating point.
  return Math.ceil((mortgageValue(index) * 11) / 10);
}
