import fs from 'node:fs';
import { getDb } from '../api/_lib/firebaseAdminHelper.ts';
import { refreshPerformanceBaseline } from '../api/_lib/performanceBaselineAdmin.ts';

const DEFAULT_TEAM_ID = 'jwnm5emo8mdG3gjIlh7CctiVvQO2';

const loadEnv = (path: string) => {
  if (!fs.existsSync(path)) return;
  for (const rawLine of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
};

const getArg = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
};

loadEnv('.env.local');

const shouldWrite = process.argv.includes('--write');
const result = await refreshPerformanceBaseline(getDb(), {
  teamId: getArg('teamId') || DEFAULT_TEAM_ID,
  rangeFrom: getArg('from'),
  rangeTo: getArg('to'),
  dryRun: !shouldWrite,
  force: process.argv.includes('--force'),
  finalize: process.argv.includes('--finalize'),
  trigger: 'cli',
});

console.log(`[performance-baseline] ${result.status} team=${result.teamId} range=${result.rangeFrom}..${result.rangeTo}`);
console.log('[performance-baseline] source', result.stats);
console.table(result.summaries);
if (result.status === 'dry-run') {
  console.log(`[performance-baseline] Dry run complete. Add --write to store ${result.bucketCount} buckets.`);
} else if (result.status === 'skipped') {
  console.log(`[performance-baseline] Skipped: ${result.reason}.`);
} else {
  console.log(`[performance-baseline] Wrote ${result.bucketCount} buckets and deleted ${result.deletedCount} stale buckets in range.`);
}
