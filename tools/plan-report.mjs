import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]))
    : entry);
const publicAddress = value => value.replace(/\["(?:\\.|[^"\\])*"\]/g,
  key => `["instance-${hash(key).slice(0, 12)}"]`);
const safeActions = new Set(['no-op', 'create', 'read', 'update', 'delete', 'forget']);

function configModule(module = {}) {
  return {
    resources: (module.resources || []).map(resource => ({
      address: publicAddress(resource.address), mode: resource.mode,
      type: resource.type, name: resource.name,
      expressions: Object.fromEntries(Object.entries(resource.expressions || {})
        .map(([key, expression]) => [key, {
          references: (expression.references || []).map(publicAddress),
        }])),
    })),
    module_calls: Object.fromEntries(Object.entries(module.module_calls || {})
      .map(([name, call]) => [name, { module: configModule(call.module) }])),
  };
}

export function createReport(plan, { root, exitcode, headSha, baseSha, runId, runAttempt = '1' }) {
  if (!['infrastructure', 'service'].includes(root)) throw new Error('Unknown plan root');
  if (![0, 2].includes(exitcode)) throw new Error('Plan did not succeed');
  if (!/^[a-f0-9]{40}$/.test(headSha) || !/^[a-f0-9]{40}$/.test(baseSha)) {
    throw new Error('Missing PR revision');
  }
  if (!/^\d+$/.test(String(runId))) throw new Error('Missing workflow run');
  if (!plan.configuration?.root_module) throw new Error('Missing plan configuration');
  const changes = (plan.resource_changes || []).map(resource => {
    if (!resource.change?.actions?.length ||
        resource.change.actions.some(action => !safeActions.has(action))) {
      throw new Error('Unknown Terraform action');
    }
    return {
      address: publicAddress(resource.address),
      module_address: publicAddress(resource.module_address || ''),
      mode: resource.mode, type: resource.type, name: resource.name,
      provider_name: resource.provider_name,
      change: {
        actions: resource.change.actions,
        before: resource.change.before === null ? null : {},
        after: resource.change.after === null ? null : {},
      },
    };
  });
  const resources = changes.filter(resource =>
    resource.change.actions.some(action => action !== 'no-op'))
    .map(resource => ({ address: resource.address, actions: resource.change.actions }));
  const outputChanges = Object.values(plan.output_changes || {})
    .filter(change => change.actions?.some(action => action !== 'no-op')).length;
  if (exitcode === 0 && (resources.length || outputChanges)) {
    throw new Error('Plan exit code contradicts resource changes');
  }
  const { timestamp, ...digestPlan } = plan;
  if (!/^[1-9]\d*$/.test(String(runAttempt))) throw new Error('Missing workflow attempt');
  const report = {
    version: 1, root, exitcode, headSha, baseSha, runId: String(runId),
    runAttempt: String(runAttempt),
    digest: hash(canonical(digestPlan)), resources, outputChanges,
  };
  const sanitized = {
    format_version: '1.2', terraform_version: plan.terraform_version,
    configuration: { root_module: configModule(plan.configuration.root_module) },
    resource_changes: changes,
  };
  return { report, sanitized };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, root, exitcode] = process.argv.slice(2);
  const result = createReport(JSON.parse(readFileSync(input, 'utf8')), {
    root, exitcode: Number(exitcode), headSha: process.env.PR_HEAD_SHA,
    baseSha: process.env.PR_BASE_SHA, runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  mkdirSync(output, { recursive: true });
  writeFileSync(`${output}/report.json`, JSON.stringify(result.report));
  writeFileSync(`${output}/plan.json`, JSON.stringify(result.sanitized));
}