import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReport } from './plan-report.mjs';

export const pontoRevision = 'f015f501ac23d91aa6c09b201bc294157eb9d6a4';
export const pontoImage = `ponto-plan-review:${pontoRevision}`;

export function buildPonto() {
  execFileSync('docker', ['build', '--target', 'standard', '-t', pontoImage,
    `https://github.com/1stvamp/ponto.git#${pontoRevision}`],
  { timeout: 600000, stdio: 'inherit', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
}

export function renderPlan(plan, report, output) {
  const sanitized = createReport(plan, report).sanitized;
  const directory = mkdtempSync(join(tmpdir(), 'ponto-'));
  try {
    writeFileSync(join(directory, 'plan.json'), JSON.stringify(sanitized));
    execFileSync('docker', ['run', '--rm', '--network=none', '--memory=1g', '--cpus=2',
      '--pids-limit=256', '-v', `${directory}:/src`, pontoImage,
      '--gen-image', '--image-format', 'png', '--plan-json-path', 'plan.json', '--output', 'graph'],
    { timeout: 120000, stdio: 'pipe', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    const image = readFileSync(join(directory, 'graph.png'));
    if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        image.length < 100 || image.length > 10000000) throw new Error('Invalid Ponto PNG');
    writeFileSync(output, image);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}