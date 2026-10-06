import assert from 'node:assert/strict';
import { test } from 'node:test';
import { marker, parseDashboard, renderOverview, upsertOverview } from './renovate-overview.mjs';

test('extracts approvals and problems without the approve-all checkbox', () => {
  const result = parseDashboard(`## Repository Problems\n - WARN: Registry unavailable\n## Pending Approval\n - [ ] <!-- approve-branch=renovate/postgres-18.x -->Update postgres to v18\n - [ ] <!-- approve-all-pending-prs -->Create all\n## Detected Dependencies\n - postgres 17\n> Renovate failed to look up a digest`);
  assert.deepEqual(result.pending, [{ branch: 'renovate/postgres-18.x', title: 'Update postgres to v18' }]);
  assert.deepEqual(result.problems, ['WARN: Registry unavailable', 'Renovate failed to look up a digest']);
  assert.deepEqual(parseDashboard(), { pending: [], problems: [] });
});

test('renders tables by approvals descending then name and escapes delimiters', () => {
  const body = renderOverview([
    { name: 'zeta', url: 'https://github.com/org/zeta', dashboard: undefined, pending: [], prs: [], problems: ['Registry failed'] },
    { name: 'beta', url: 'https://github.com/org/beta', dashboard: undefined, pending: [], prs: [{ title: 'Patch image', html_url: 'https://github.com/org/beta/pull/2' }], problems: [] },
    { name: 'omega', url: 'https://github.com/org/omega', dashboard: 'https://github.com/org/omega/issues/1',
      pending: [{ title: 'Upgrade first' }, { title: 'Upgrade second' }], prs: [], problems: [] },
    { name: 'alpha', url: 'https://github.com/org/alpha', dashboard: 'https://github.com/org/alpha/issues/1',
      pending: [{ title: 'Upgrade | postgres' }], prs: [{ title: 'Patch | image', html_url: 'https://github.com/org/alpha/pull/2' }], problems: ['Registry failed'] },
  ], { now: new Date('2026-10-04T00:00:00Z'), runUrl: 'https://github.com/org/.github/actions/runs/1' });
  assert.ok(body.startsWith(marker));
  assert.ok(body.indexOf('[omega]') < body.indexOf('[alpha]'));
  assert.ok(body.indexOf('[alpha]') < body.indexOf('[zeta]'));
  assert.ok(body.indexOf('[beta]') < body.indexOf('[zeta]'));
  assert.ok(body.includes('Upgrade &#124; postgres'));
  assert.ok(body.includes('No dashboard'));
  assert.ok(body.includes('[Approve](https://github.com/org/alpha/issues/1)'));
  assert.ok(!body.includes('- [ ]'));
});

test('omits repositories with no problems, approvals, or Renovate PRs', () => {
  const rows = [
    { name: 'clean', url: 'https://github.com/org/clean', dashboard: 'https://github.com/org/clean/issues/1', pending: [], prs: [], problems: [] },
    { name: 'missing-dashboard', url: 'https://github.com/org/missing-dashboard', dashboard: undefined, pending: [], prs: [], problems: [] },
  ];
  const body = renderOverview(rows);
  assert.ok(!body.includes('https://github.com/org/clean'));
  assert.ok(!body.includes('missing-dashboard'));
  assert.ok(body.includes('No pending approvals'));
  assert.ok(body.includes('No open Renovate pull requests'));
  assert.ok(body.includes('No problems reported by the repository dashboards.'));
  assert.equal(rows.length, 2);
});

test('updates only an overview identified by its marker', async () => {
  const calls = [];
  const api = async (endpoint, options) => {
    calls.push({ endpoint, options });
    if (calls.length === 1) return [[{ number: 1, title: 'Renovate Fleet Overview', body: 'Human issue' }, { number: 2, body: `${marker}\nOld overview` }]];
    return { html_url: 'https://github.com/org/.github/issues/2' };
  };
  await upsertOverview(api, 'org/.github', 'New overview');
  assert.equal(calls[1].endpoint, 'repos/org/.github/issues/2');
  assert.equal(calls[1].options.method, 'PATCH');
});

test('creates one overview when no marked issue exists', async () => {
  const calls = [];
  const api = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return calls.length === 1 ? [[]] : { html_url: 'https://github.com/org/.github/issues/3', node_id: 'issue-node' };
  };
  await upsertOverview(api, 'org/.github', marker);
  assert.equal(calls[1].endpoint, 'repos/org/.github/issues');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[2].endpoint, 'graphql');
  assert.equal(calls[2].options.data.variables.issueId, 'issue-node');
});