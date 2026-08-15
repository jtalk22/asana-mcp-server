#!/usr/bin/env node
// Version parity: package.json, package-lock.json (root + packages[""]), server.json
// (top-level + packages[0]) must all carry the SAME version. Release tags vN.N.N must
// match too (publish.yml asserts that side). Fails red on any drift.
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const pkg = read('package.json');
const lock = read('package-lock.json');
const server = read('server.json');

const spots = {
  'package.json .version': pkg.version,
  'package-lock.json .version': lock.version,
  'package-lock.json packages[""].version': lock.packages?.['']?.version,
  'server.json .version': server.version,
  'server.json packages[0].version': server.packages?.[0]?.version,
};
const versions = new Set(Object.values(spots));
for (const [spot, v] of Object.entries(spots)) console.log(`${v ?? 'MISSING'}  ${spot}`);
if (versions.size !== 1 || versions.has(undefined)) {
  console.error(`\nVERSION DRIFT: ${[...versions].join(' vs ')}`);
  process.exit(1);
}
if (server.packages[0].identifier !== pkg.name) {
  console.error(`server.json identifier ${server.packages[0].identifier} != package name ${pkg.name}`);
  process.exit(1);
}
if (pkg.mcpName !== server.name) {
  console.error(`package.json mcpName ${pkg.mcpName} != server.json name ${server.name}`);
  process.exit(1);
}
console.log('\nversion parity OK:', pkg.version);
