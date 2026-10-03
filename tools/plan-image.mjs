import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReport } from './plan-report.mjs';
import { buildPonto, renderPlan } from './render-plan.mjs';

export function createPlanImage(plan, context, output, renderer = { buildPonto, renderPlan }) {
  if (context.exitcode === 0) return false;
  const { report, sanitized } = createReport(plan, context);
  mkdirSync(output, { recursive: true });
  renderer.buildPonto();
  renderer.renderPlan(sanitized, report, `${output}/${context.root}.png`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, root, exitcode] = process.argv.slice(2);
  createPlanImage(JSON.parse(readFileSync(input, 'utf8')), {
    root, exitcode: Number(exitcode), headSha: process.env.PLAN_HEAD_SHA,
    baseSha: process.env.PLAN_BASE_SHA, runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  }, output);
}