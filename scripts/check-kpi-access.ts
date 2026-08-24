import assert from 'node:assert/strict';
import { getKpiAccountFilter } from '../src/utils/kpiAccess.ts';

const intersection = getKpiAccountFilter(
  { allowedAccounts: ['a@example.com', 'b@example.com'] },
  ['b@example.com', 'c@example.com'],
  true,
);
assert(intersection instanceof Set);
assert.deepEqual([...intersection], ['b@example.com']);

assert.equal(getKpiAccountFilter({ allowedAccounts: [] }, [], false), 'NONE');
assert.equal(getKpiAccountFilter({ hasFullAccountAccess: true }, [], true), null);

console.log('KPI account access checks passed.');
