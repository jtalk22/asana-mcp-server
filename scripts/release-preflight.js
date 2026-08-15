#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const checks = [
  ['Version parity', process.execPath, ['scripts/check-version-parity.js']],
  ['Public wording', 'bash', ['scripts/check-public-language.sh']],
  ['Unit tests', 'npm', ['test']],
  ['Package contents', 'npm', ['pack', '--dry-run']],
];

for (const [label, command, args] of checks) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nRelease preflight passed.');
