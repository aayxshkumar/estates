#!/usr/bin/env node
// Plants one rules bug at a time in a scratch copy of the repo, rebuilds, and
// runs the unit tests and the rules fuzzer. A mutant is "caught" if either
// fails. Surviving mutants show where the tests are blind.
//
//   node tools/mutants.mjs            all mutants
//   node tools/mutants.mjs ferry      only mutants whose name contains "ferry"

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CHECK_GAMES = process.env.MUTANT_CHECK_GAMES ?? '200';

const MUTANTS = [
  { name: 'even-build-off-by-one', file: 'src/engine/rules.ts',
    find: 'if (d.houses !== min) return false;', replace: 'if (d.houses > min + 1) return false;' },
  { name: 'district-rent-not-doubled', file: 'src/engine/rules.ts',
    find: 'ownsDistrict(st, d.owner, index) ? s.rent[0] * 2 : s.rent[0]', replace: 's.rent[0]' },
  { name: 'ferry-rent-linear', file: 'src/engine/rules.ts',
    find: 'return 25 * 2 ** (n - 1);', replace: 'return 25 * n;' },
  { name: 'works-both-still-4x', file: 'src/engine/rules.ts',
    find: '(both ? 10 : 4)', replace: '(both ? 4 : 4)' },
  { name: 'four-doubles-to-jail', file: 'src/engine/rules.ts',
    find: 'if (st.doubles === 3) {', replace: 'if (st.doubles === 4) {' },
  { name: 'salary-when-moving-back', file: 'src/engine/rules.ts',
    find: 'const passedStart = forward && to < p.pos;', replace: 'const passedStart = to < p.pos;' },
  { name: 'hotel-keeps-its-houses', file: 'src/engine/rules.ts',
    find: '    st.bank.hotels--;\n    st.bank.houses += 4;', replace: '    st.bank.hotels--;' },
  { name: 'unmortgage-no-interest', file: 'src/engine/board.ts',
    find: '(mortgageValue(index) * 11) / 10', replace: '(mortgageValue(index) * 10) / 10' },
  { name: 'jail-four-tries', file: 'src/engine/rules.ts',
    find: 'if (p.jailTurns < 3) {', replace: 'if (p.jailTurns < 4) {' },
  { name: 'bankrupt-deeds-to-bank', file: 'src/engine/rules.ts',
    find: 'for (const i of owned) deed(st, i).owner = single;', replace: 'for (const i of owned) deed(st, i).owner = null;' },
  { name: 'mortgage-under-houses', file: 'src/engine/rules.ts',
    find: "if (s.kind === 'street' && districtMembers(s.district).some((i) => deed(st, i).houses > 0)) return false;",
    replace: "if (s.kind === 'street' && deed(st, index).houses > 0) return false;" },
  { name: 'naming-day-reversed', file: 'src/engine/rules.ts',
    find: "for (const o of others) charge(c, o.id, [{ creditor: pid, amount: e.amount }], 'card');",
    replace: "for (const o of others) charge(c, pid, [{ creditor: o.id, amount: e.amount }], 'card');" },
  { name: 'jail-card-also-returned', file: 'src/engine/rules.ts',
    find: "  if (e.kind === 'jailFree') {\n    p.jailCards.push(id);\n    return;\n  }\n  deck.push(id);",
    replace: "  deck.push(id);\n  if (e.kind === 'jailFree') {\n    p.jailCards.push(id);\n    return;\n  }" },
  { name: 'jail-doubles-roll-again', file: 'src/engine/rules.ts',
    find: '  if (p.inJail) {\n    st.extraRoll = false;', replace: '  if (p.inJail) {\n    st.extraRoll = isDouble;' },
  { name: 'nearest-ferry-not-doubled', file: 'src/engine/rules.ts',
    find: "if (s.kind === 'ferry' && opts.ferryMultiplier) rent *= opts.ferryMultiplier;", replace: '' },
  { name: 'sell-hotel-free-houses', file: 'src/engine/rules.ts',
    find: '    st.bank.hotels++;\n    st.bank.houses -= 4;\n  } else {\n    st.bank.houses++;\n  }\n  d.houses--;',
    replace: '    st.bank.hotels++;\n  } else {\n    st.bank.houses++;\n  }\n  d.houses--;' },
];

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000 });
  return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

const filter = process.argv[2];
const selected = MUTANTS.filter((m) => !filter || m.name.includes(filter));
const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tsc)) {
  console.error('typescript is not installed: run npm install first');
  process.exit(2);
}

const results = [];
for (const m of selected) {
  const dir = mkdtempSync(join(tmpdir(), 'estates-mutant-'));
  try {
    for (const p of ['src', 'test', 'tsconfig.json', 'package.json']) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
    const path = join(dir, m.file);
    const text = readFileSync(path, 'utf8');
    const count = text.split(m.find).length - 1;
    if (count !== 1) {
      results.push({ m, verdict: 'BROKEN', by: `pattern found ${count} times` });
      continue;
    }
    writeFileSync(path, text.replace(m.find, m.replace));
    const build = run(process.execPath, [tsc, '-p', 'tsconfig.json'], dir);
    if (!build.ok) {
      results.push({ m, verdict: 'BROKEN', by: 'does not compile' });
      continue;
    }
    const tests = run(process.execPath, ['--test', 'dist/test/engine.test.js'], dir);
    const check = run(process.execPath, ['dist/src/sim/check.js', '--games', CHECK_GAMES], dir);
    const by = [!tests.ok && 'unit tests', !check.ok && 'fuzzer'].filter(Boolean).join(' + ');
    results.push({ m, verdict: by ? 'caught' : 'SURVIVED', by: by || '-' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const r = results.at(-1);
  console.log(`${r.verdict.padEnd(9)} ${m.name.padEnd(28)} ${r.by}`);
}

const caught = results.filter((r) => r.verdict === 'caught').length;
const survived = results.filter((r) => r.verdict === 'SURVIVED').length;
const broken = results.filter((r) => r.verdict === 'BROKEN').length;
console.log(`\n${caught}/${results.length} caught, ${survived} survived${broken ? `, ${broken} broken` : ''}`);
process.exitCode = broken > 0 ? 2 : 0;
