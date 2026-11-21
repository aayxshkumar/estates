// Browser client: hot-seat play for humans and bots on one screen. The client
// never changes game state itself; it only calls apply() from the engine.

import { BOTS, type Bot } from '../bots/bots.js';
import { BOARD, DISTRICTS, HOTEL, mortgageValue, ownable, unmortgageCost, type Space } from '../engine/board.js';
import { card } from '../engine/cards.js';
import type { GameRecord } from '../engine/replay.js';
import { seedRng, type RngState } from '../engine/rng.js';
import { actor, apply, legalActions, newGame, totalOwed } from '../engine/rules.js';
import type { Action, GameEvent, GameState } from '../engine/types.js';
import { sounds } from './sound.js';

const TOKENS = ['red', 'blue', 'green', 'yellow', 'purple', 'black'] as const;
const CSS_COLORS = ['#d8443c', '#3b7dd8', '#3fa45b', '#e8c021', '#8a5bd1', '#2b2b2b'];
const SAVE_KEY = 'estates.save.v1';
const BOT_DELAY_MS = 380;

interface Seat { name: string; kind: 'human' | 'greedy' | 'random' }

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const tokenSrc = (seat: number): string => `assets/pieces/token-${TOKENS[seat]}.png`;
const houseSrc = 'assets/pieces/house.png';
const hotelSrc = 'assets/pieces/hotel.png';
const dieSrc = (n: number): string => `assets/dice/dieWhite_border${n}.png`;

// --------------------------------------------------------------------------
// Setup screen

let seats: Seat[] = [
  { name: 'You', kind: 'human' },
  { name: 'Marlow', kind: 'greedy' },
  { name: 'Iris', kind: 'greedy' },
];

function renderSeats(): void {
  const box = $('seats');
  box.innerHTML = '';
  seats.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'seat';
    row.innerHTML = `<img src="${tokenSrc(i)}" alt=""><input type="text" maxlength="14">
      <select><option value="human">Human</option><option value="greedy">Greedy bot</option><option value="random">Random bot</option></select>
      <button type="button" title="Remove">✕</button>`;
    const input = row.querySelector('input')!;
    const select = row.querySelector('select')!;
    const remove = row.querySelector('button')!;
    input.value = s.name;
    select.value = s.kind;
    input.oninput = () => { s.name = input.value || `Player ${i + 1}`; };
    select.onchange = () => { s.kind = select.value as Seat['kind']; };
    remove.disabled = seats.length <= 2;
    remove.onclick = () => { seats.splice(i, 1); renderSeats(); };
    box.append(row);
  });
  ($('addSeat') as HTMLButtonElement).disabled = seats.length >= 6;
}

// --------------------------------------------------------------------------
// Game session

interface Session {
  seats: Seat[];
  record: GameRecord;
  state: GameState;
  botRng: RngState;
  log: string[];
  lastCard: number | null;
}

let session: Session | null = null;
let botTimer: number | undefined;

function startSession(s: Seat[], seed: number, actions: Action[] = []): void {
  const players = s.map((x) => x.name);
  let state = newGame({ seed, players });
  const sess: Session = {
    seats: s, record: { format: 'estates-record-1', seed, players, actions: [] },
    state, botRng: seedRng(seed ^ 0x5bd1e995), log: [`New game, seed ${seed}.`], lastCard: null,
  };
  for (const a of actions) {
    const r = apply(state, a);
    state = r.state;
    sess.record.actions.push(a);
    describe(sess, r.events, state);
  }
  sess.state = state;
  session = sess;
  $('setup').hidden = true;
  $('game').hidden = false;
  buildBoard();
  render();
  scheduleBot();
}

function save(): void {
  if (!session) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ seats: session.seats, record: session.record }));
  } catch { /* storage unavailable: saving is a convenience only */ }
}

function loadSave(): { seats: Seat[]; record: GameRecord } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function act(a: Action): void {
  if (!session) return;
  const r = apply(session.state, a);
  session.state = r.state;
  session.record.actions.push(a);
  session.lastCard = null;
  describe(session, r.events, r.state);
  playSounds(r.events);
  save();
  render();
  scheduleBot();
}

function scheduleBot(): void {
  window.clearTimeout(botTimer);
  if (!session || session.state.phase === 'over') return;
  const seat = session.seats[actor(session.state)]!;
  if (seat.kind === 'human') return;
  const bot: Bot = BOTS[seat.kind]!;
  botTimer = window.setTimeout(() => {
    if (!session) return;
    act(bot.choose(session.state, legalActions(session.state), session.botRng));
  }, BOT_DELAY_MS);
}

// --------------------------------------------------------------------------
// Text

function name(sess: Session, id: number | null): string {
  return id === null ? 'the bank' : sess.state.players[id]?.name ?? `P${id}`;
}

function describe(sess: Session, events: GameEvent[], st: GameState): void {
  const n = (id: number | null) => (id === null ? 'the bank' : st.players[id]!.name);
  for (const e of events) {
    let line: string | null = null;
    switch (e.t) {
      case 'roll': line = `${n(e.player)} rolled ${e.dice[0]} + ${e.dice[1]}.`; break;
      case 'move': line = e.to === e.from ? null : `${n(e.player)} → ${BOARD[e.to]!.name}.`; break;
      case 'salary': line = `${n(e.player)} collected ${e.amount} salary.`; break;
      case 'buy': line = `${n(e.player)} bought ${BOARD[e.index]!.name} for ${e.price}.`; break;
      case 'decline': line = `${n(e.player)} passed on ${BOARD[e.index]!.name}.`; break;
      case 'rent': line = `${n(e.from)} owes ${e.amount} rent to ${n(e.to)}.`; break;
      case 'card': line = `${n(e.player)} drew: “${card(e.card).text}”`; sess.lastCard = e.card; break;
      case 'jail': line = `${n(e.player)} went to the Holding Cells (${e.reason}).`; break;
      case 'leaveJail': line = `${n(e.player)} left the cells (${e.how}).`; break;
      case 'build': line = `${n(e.player)} built on ${BOARD[e.index]!.name} (${e.houses === HOTEL ? 'hotel' : `${e.houses} house${e.houses > 1 ? 's' : ''}`}).`; break;
      case 'sellBuilding': line = `${n(e.player)} sold a building on ${BOARD[e.index]!.name}.`; break;
      case 'mortgage': line = `${n(e.player)} mortgaged ${BOARD[e.index]!.name}.`; break;
      case 'unmortgage': line = `${n(e.player)} paid off ${BOARD[e.index]!.name}.`; break;
      case 'debt': line = `${n(e.debtor)} must raise ${e.total} (${e.reason}).`; break;
      case 'bankrupt': line = `${n(e.player)} is bankrupt${e.creditor === null ? '' : ` to ${n(e.creditor)}`}.`; break;
      case 'gameOver': line = `Game over. ${n(e.winner)} wins!`; break;
      case 'pay':
        if (e.reason === 'salary' || e.reason === 'buy' || e.reason === 'build' || e.reason === 'mortgage' || e.reason === 'unmortgage' || e.reason === 'sell building') line = null;
        else line = `${n(e.from)} paid ${e.amount} to ${n(e.to)}.`;
        break;
      default: line = null;
    }
    if (line) sess.log.push(line);
  }
  if (sess.log.length > 400) sess.log.splice(0, sess.log.length - 400);
}

function label(sess: Session, a: Action): string {
  switch (a.type) {
    case 'roll': return 'Roll dice';
    case 'payJail': return 'Pay 50 to leave';
    case 'useJailCard': return 'Use release card';
    case 'buy': return `Buy for ${ownable(sess.state.pendingBuy!).price}`;
    case 'decline': return 'Pass';
    case 'build': return `Build: ${BOARD[a.index]!.name}`;
    case 'sellBuilding': return `Sell building: ${BOARD[a.index]!.name}`;
    case 'mortgage': return `Mortgage ${BOARD[a.index]!.name} (+${mortgageValue(a.index)})`;
    case 'unmortgage': return `Pay off ${BOARD[a.index]!.name} (−${unmortgageCost(a.index)})`;
    case 'payDebt': return `Pay ${totalOwed(sess.state)}`;
    case 'bankrupt': return 'Declare bankruptcy';
    case 'endTurn': return 'End turn';
  }
}

// --------------------------------------------------------------------------
// Board

/** Grid cell for a board index; Start is the bottom-right corner. */
function cellOf(i: number): { row: number; col: number; side: string } {
  if (i <= 10) return { row: 11, col: 11 - i, side: 'bottom' };
  if (i <= 20) return { row: 11 - (i - 10), col: 1, side: 'left' };
  if (i <= 30) return { row: 1, col: 1 + (i - 20), side: 'top' };
  return { row: 1 + (i - 30), col: 11, side: 'right' };
}

function iconFor(s: Space): string | null {
  switch (s.kind) {
    case 'ferry': return 'assets/pieces/ferry.png';
    case 'works': return 'assets/icons/gear.png';
    case 'card': return s.deck === 'fortune' ? 'assets/icons/question.png' : 'assets/icons/information.png';
    case 'tax': return 'assets/icons/exclamation.png';
    case 'jail': return 'assets/icons/locked.png';
    case 'start': return 'assets/icons/next.png';
    case 'square': return 'assets/icons/star.png';
    case 'arrest': return 'assets/icons/warning.png';
    default: return null;
  }
}

function buildBoard(): void {
  const board = $('board');
  board.querySelectorAll('.space').forEach((el) => el.remove());
  BOARD.forEach((s, i) => {
    const { row, col, side } = cellOf(i);
    const el = document.createElement('div');
    const corner = i % 10 === 0;
    el.className = `space side-${side}${corner ? ' corner' : ''}`;
    el.id = `space-${i}`;
    el.style.gridRow = String(row);
    el.style.gridColumn = String(col);
    const band = s.kind === 'street' ? `<div class="band" style="background:${DISTRICTS[s.district].color}"></div>` : '';
    const icon = iconFor(s);
    const price = 'price' in s ? `<div class="price">${s.price}</div>` : s.kind === 'tax' ? `<div class="price">pay ${s.amount}</div>` : '';
    el.innerHTML = `${band}<div class="label"><div class="name">${s.name}</div>${icon ? `<img class="icon" src="${icon}" alt="">` : ''}${price}</div>
      <div class="buildings"></div><div class="tokens"></div><div class="owner"></div>`;
    el.title = s.name;
    board.append(el);
  });
}

function render(): void {
  if (!session) return;
  const sess = session;
  const st = sess.state;
  const who = actor(st);

  BOARD.forEach((s, i) => {
    const el = $(`space-${i}`);
    const d = st.deeds[i];
    el.classList.toggle('mortgaged', !!d?.mortgaged);
    el.classList.toggle('highlight', st.players[st.current]!.pos === i && st.phase !== 'over');
    (el.querySelector('.owner') as HTMLElement).style.background = d && d.owner !== null ? CSS_COLORS[d.owner]! : 'transparent';
    const b = el.querySelector('.buildings')!;
    b.innerHTML = d && d.houses > 0
      ? (d.houses === HOTEL ? `<img src="${hotelSrc}" alt="hotel">` : `<img src="${houseSrc}" alt="house">`.repeat(d.houses))
      : '';
    const t = el.querySelector('.tokens')!;
    t.innerHTML = st.players.filter((p) => !p.bankrupt && p.pos === i)
      .map((p) => `<img src="${tokenSrc(p.id)}" class="${p.id === st.current ? 'active' : ''}" alt="${p.name}">`).join('');
  });

  const roll = st.lastRoll ?? [1, 1];
  ($('die0') as HTMLImageElement).src = dieSrc(roll[0]);
  ($('die1') as HTMLImageElement).src = dieSrc(roll[1]);

  const me = st.players[who]!;
  let status: string;
  if (st.phase === 'over') status = `${name(sess, st.winner)} wins after ${st.turn} turns.`;
  else if (st.phase === 'debt') status = `${me.name} owes ${totalOwed(st)} and has ${me.cash}.`;
  else if (st.phase === 'buy') status = `${me.name} landed on ${BOARD[st.pendingBuy!]!.name}.`;
  else status = `Turn: ${me.name}${me.inJail ? ' (in the Holding Cells)' : ''}.`;
  $('status').textContent = status;

  const actions = $('actions');
  actions.innerHTML = '';
  const human = st.phase !== 'over' && sess.seats[who]!.kind === 'human';
  if (human) {
    for (const a of legalActions(st)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label(sess, a);
      if (a.type === 'roll' || a.type === 'buy' || a.type === 'payDebt' || a.type === 'endTurn') btn.className = 'primary';
      btn.onclick = () => act(a);
      actions.append(btn);
    }
  }

  const cardBox = $('cardText');
  cardBox.hidden = sess.lastCard === null;
  if (sess.lastCard !== null) cardBox.textContent = card(sess.lastCard).text;

  const players = $('players');
  players.innerHTML = '';
  for (const p of st.players) {
    const div = document.createElement('div');
    div.className = `player${p.id === st.current && st.phase !== 'over' ? ' current' : ''}${p.bankrupt ? ' out' : ''}`;
    const deeds = st.deeds.map((d, i) => (d && d.owner === p.id ? i : -1)).filter((i) => i >= 0)
      .map((i) => {
        const s = BOARD[i]!;
        const color = s.kind === 'street' ? DISTRICTS[s.district].color : '#999';
        return `<span title="${s.name}" style="background:${color};opacity:${st.deeds[i]!.mortgaged ? 0.35 : 1}"></span>`;
      }).join('');
    div.innerHTML = `<img src="${tokenSrc(p.id)}" alt=""><span>${p.name}${sess.seats[p.id]!.kind === 'human' ? '' : ' 🤖'}${p.jailCards.length ? ' 🗝' : ''}</span>
      <span class="cash">${p.bankrupt ? 'out' : p.cash}</span><div class="deeds">${deeds}</div>`;
    players.append(div);
  }

  const log = $('log');
  log.innerHTML = sess.log.slice(-120).map((l) => `<li>${l.replace(/</g, '&lt;')}</li>`).join('');
  log.scrollTop = log.scrollHeight;
}

function playSounds(events: GameEvent[]): void {
  const kinds = new Set(events.map((e) => e.t));
  if (kinds.has('gameOver')) sounds.play('win');
  else if (kinds.has('bankrupt')) sounds.play('error');
  else if (kinds.has('jail')) sounds.play('error');
  else if (kinds.has('card')) sounds.play('card');
  else if (kinds.has('build')) sounds.play('build');
  else if (kinds.has('buy') || kinds.has('rent')) sounds.play('coins');
  else if (kinds.has('roll')) sounds.play('dice');
  else sounds.play('click');
}

// --------------------------------------------------------------------------
// Wiring

renderSeats();
$('addSeat').onclick = () => {
  const names = ['Marlow', 'Iris', 'Teo', 'Wren', 'Sable', 'Juno'];
  seats.push({ name: names[seats.length] ?? `Player ${seats.length + 1}`, kind: 'greedy' });
  renderSeats();
};
$('start').onclick = () => {
  const seed = Number(($('seed') as HTMLInputElement).value) >>> 0;
  startSession(seats.map((s) => ({ ...s })), seed);
};
const saved = loadSave();
if (saved) {
  const resume = $('resume') as HTMLButtonElement;
  resume.hidden = false;
  resume.onclick = () => startSession(saved.seats, saved.record.seed, saved.record.actions);
}
$('newGame').onclick = () => {
  window.clearTimeout(botTimer);
  session = null;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  $('game').hidden = true;
  $('setup').hidden = false;
  ($('resume') as HTMLButtonElement).hidden = true;
};
$('download').onclick = () => {
  if (!session) return;
  const blob = new Blob([JSON.stringify(session.record, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `estates-seed${session.record.seed}-turn${session.state.turn}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('mute').onclick = () => {
  const on = sounds.toggle();
  ($('mute').querySelector('img') as HTMLImageElement).src = on ? 'assets/icons/audioOn.png' : 'assets/icons/audioOff.png';
};
