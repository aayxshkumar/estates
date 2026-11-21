// Tiny sound bank over HTMLAudioElement. OGG files from Kenney's CC0 packs.

const FILES = {
  dice: ['dieThrow1.ogg', 'dieThrow2.ogg'],
  card: ['cardSlide1.ogg'],
  coins: ['chipsCollide1.ogg', 'chipsCollide2.ogg'],
  build: ['drop_002.ogg'],
  click: ['click_001.ogg'],
  error: ['error_004.ogg'],
  win: ['confirmation_002.ogg'],
} as const;

type SoundName = keyof typeof FILES;

let enabled = true;
let flip = 0;

export const sounds = {
  play(name: SoundName): void {
    if (!enabled) return;
    const list = FILES[name];
    const file = list[flip++ % list.length]!;
    const audio = new Audio(`assets/sounds/${file}`);
    audio.volume = 0.5;
    audio.play().catch(() => { /* autoplay blocked until the first click */ });
  },
  toggle(): boolean {
    enabled = !enabled;
    return enabled;
  },
};
