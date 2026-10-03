import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPonto, renderPlan } from './render-plan.mjs';

test('Ponto exports a nonempty graph from value-free plan JSON',
  { skip: process.env.TEST_PONTO !== 'true' }, () => {
    buildPonto();
    const directory = mkdtempSync(join(tmpdir(), 'ponto-test-'));
    try {
      const resources = ['first', 'second'].map(name => ({ address: `random_id.${name}`,
        mode: 'managed', type: 'random_id', name, provider_name: 'registry.terraform.io/hashicorp/random',
        change: { actions: ['create'], before: null, after: { secret: 'SECRET_CANARY' } } }));
      const plan = { format_version: '1.2', terraform_version: '1.14.0',
        configuration: { root_module: { resources: resources.map(resource => ({
          address: resource.address, mode: resource.mode, type: resource.type, name: resource.name,
          expressions: resource.name === 'second' ? { dependency: { references: ['random_id.first'] } } : {},
        })) } }, resource_changes: resources };
      const output = join(directory, 'graph.png');
      renderPlan(plan, { root: 'infrastructure', exitcode: 2,
        headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), runId: '123' }, output);
      const png = readFileSync(output);
      assert.ok(png.readUInt32BE(16) > 100);
      assert.ok(png.readUInt32BE(20) > 100);
      assert.ok(png.length > 2000);
      console.log(`Rendered graph: ${output}`);
    } finally {
      if (!process.env.PONTO_PREVIEW) rmSync(directory, { recursive: true, force: true });
    }
  });