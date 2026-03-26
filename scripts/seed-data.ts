/**
 * Parses the two Salesforce CSVs and writes pre-built JSON indexes to data/.
 * Run once: npx tsx scripts/seed-data.ts <sheet15.csv> <optout.csv>
 */
import fs from 'fs';
import path from 'path';
import { buildSheet15Index, buildOptOutIndex } from '../src/lib/indexer.js';

const [, , sheet15Arg, optoutArg] = process.argv;
if (!sheet15Arg || !optoutArg) {
  console.error('Usage: npx tsx scripts/seed-data.ts <sheet15.csv> <optout.csv>');
  process.exit(1);
}

const DATA_DIR = path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// --- Sheet15 ---
console.log('Parsing Sheet15...');
const sheet15Text = fs.readFileSync(sheet15Arg, 'utf-8');
const s15 = buildSheet15Index(sheet15Text);
if (s15.error) { console.error('Sheet15 error:', s15.error); process.exit(1); }
fs.writeFileSync(path.join(DATA_DIR, 'sheet15-index.json'), JSON.stringify(s15.index));
console.log(`  ${s15.rowCount} rows, ${s15.uniqueDomains} unique domains, ${s15.skippedRows} skipped`);

// --- Opt-out ---
console.log('Parsing Opt-out...');
const optoutText = fs.readFileSync(optoutArg, 'utf-8');
const oo = buildOptOutIndex(optoutText);
if (oo.error) { console.error('Opt-out error:', oo.error); process.exit(1); }
fs.writeFileSync(path.join(DATA_DIR, 'optout-index.json'), JSON.stringify(oo.index));
console.log(`  ${oo.rowCount} rows, ${oo.uniqueDomains} unique domains, ${oo.skippedRows} skipped`);

// --- Metadata ---
const metadata = {
  sheet15: { loaded: true, rowCount: s15.rowCount, uniqueDomains: s15.uniqueDomains, lastUpdated: new Date().toISOString() },
  optout:  { loaded: true, rowCount: oo.rowCount,  uniqueDomains: oo.uniqueDomains,  lastUpdated: new Date().toISOString() },
};
fs.writeFileSync(path.join(DATA_DIR, 'metadata.json'), JSON.stringify(metadata));

console.log('\nDone. Files written to data/');
