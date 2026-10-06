import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const marker = '<!-- mahn-ke-renovate-fleet-overview -->';

export function parseDashboard(body = '') {
  const pending = [];
  const problems = [];
  let section = '';
  for (const line of body.split('\n')) {
    if (line.startsWith('## ')) section = line.slice(3).trim();
    const approval = line.match(/^\s*- \[[ x]\] <!-- approve-branch=([^>]+) -->(.+)$/);
    if (approval) pending.push({ branch: approval[1], title: approval[2].trim() });
    if (section === 'Repository Problems' && /^\s*- /.test(line)) {
      problems.push(line.replace(/^\s*- /, '').trim());
    }
    if (/^>.*Renovate failed to look up/.test(line)) problems.push(line.replace(/^>\s*/, ''));
  }
  return { pending, problems };
}

function cell(value) {
  return String(value).replaceAll('|', '&#124;').replaceAll('\n', ' ');
}

export function renderOverview(rows, { now = new Date(), runUrl } = {}) {
  const sorted = rows.filter(row => row.problems.length || row.pending.length || row.prs.length)
    .sort((left, right) => right.pending.length - left.pending.length || left.name.localeCompare(right.name));
  const lines = [marker, '# Renovate Fleet Overview', '',
    `Updated: ${now.toISOString()}${runUrl ? ` | [Renovate run](${runUrl})` : ''}`, '',
    'Approvals remain on the native repository dashboards. This overview does not approve or merge updates.', '',
    '## Repositories', '', '| Repository | Pending Approvals | Open Renovate PRs | Problems | Dashboard |',
    '| --- | ---: | ---: | --- | --- |'];
  for (const row of sorted) {
    lines.push(`| [${cell(row.name)}](${row.url}) | ${row.pending.length} | ${row.prs.length} | ${row.problems.length || (row.dashboard ? 'None reported' : 'No dashboard')} | ${row.dashboard ? `[Open](${row.dashboard})` : '-'} |`);
  }
  lines.push('', '## Pending Approvals', '', '| Repository | Upgrade | Approval Dashboard |', '| --- | --- | --- |');
  const approvals = sorted.flatMap(row => row.pending.map(update => `| ${cell(row.name)} | ${cell(update.title)} | [Approve](${row.dashboard}) |`));
  lines.push(...(approvals.length ? approvals : ['| - | No pending approvals | - |']));
  lines.push('', '## Open Pull Requests', '', '| Repository | Update |', '| --- | --- |');
  const pulls = sorted.flatMap(row => row.prs.map(pull => `| ${cell(row.name)} | [${cell(pull.title)}](${pull.html_url}) |`));
  lines.push(...(pulls.length ? pulls : ['| - | No open Renovate pull requests |']));
  lines.push('', '## Problems', '');
  const problems = sorted.flatMap(row => row.problems.map(problem => `- **${cell(row.name)}:** ${cell(problem)}`));
  lines.push(...(problems.length ? problems : ['No problems reported by the repository dashboards.']));
  const body = lines.join('\n');
  if (body.length > 65000) throw new Error('Fleet overview exceeds the GitHub issue body limit');
  return body;
}

export async function upsertOverview(api, repository, body) {
  const issues = (await api(`repos/${repository}/issues?state=open&per_page=100`, { paginate: true })).flat();
  const existing = issues.find(issue => !issue.pull_request && issue.body?.startsWith(marker));
  const issue = await api(`repos/${repository}/issues${existing ? `/${existing.number}` : ''}`, {
    method: existing ? 'PATCH' : 'POST',
    data: { title: 'Renovate Fleet Overview', body },
  });
  if (!existing && issue.node_id) {
    try {
      const result = await api('graphql', {
        method: 'POST',
        data: { query: 'mutation($issueId: ID!) { pinIssue(input: {issueId: $issueId}) { clientMutationId } }', variables: { issueId: issue.node_id } },
      });
      if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '));
    } catch (error) {
      console.warn(`Overview created but could not be pinned: ${error.message}`);
    }
  }
  return issue;
}

async function githubApi(endpoint, { paginate = false, method, data } = {}) {
  const args = ['api', endpoint];
  if (paginate) args.push('--paginate', '--slurp');
  if (method) args.push('--method', method);
  if (data) args.push('--input', '-');
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errorOutput += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`GitHub API failed for ${endpoint}: ${errorOutput}`));
      try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
    });
    child.stdin.end(data ? JSON.stringify(data) : undefined);
  });
}

export async function main() {
  const repository = process.env.OVERVIEW_REPOSITORY || 'mahn-ke/.github';
  const owner = repository.split('/')[0];
  const repositories = (await githubApi(`orgs/${owner}/repos?per_page=100`, { paginate: true })).flat().filter(repo => !repo.archived);
  const rows = [];
  for (let offset = 0; offset < repositories.length; offset += 6) {
    await Promise.all(repositories.slice(offset, offset + 6).map(async repo => {
      const issues = (await githubApi(`repos/${repo.full_name}/issues?state=open&per_page=100`, { paginate: true })).flat();
      const dashboard = issues.find(issue => !issue.pull_request && issue.title === 'Dependency Dashboard');
      const pulls = (await githubApi(`repos/${repo.full_name}/pulls?state=open&per_page=100`, { paginate: true })).flat();
      rows.push({ name: repo.name, url: repo.html_url, dashboard: dashboard?.html_url,
        ...parseDashboard(dashboard?.body), prs: pulls.filter(pull => pull.head.ref.startsWith('renovate/')) });
    }));
  }
  const runUrl = process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined;
  const body = renderOverview(rows, { runUrl });
  if (process.argv.includes('--preview')) {
    console.log(body);
    return;
  }
  const issue = await upsertOverview(githubApi, repository, body);
  console.log(`Updated ${issue.html_url}: ${rows.length} repositories, ${rows.reduce((total, row) => total + row.pending.length, 0)} pending approvals`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}