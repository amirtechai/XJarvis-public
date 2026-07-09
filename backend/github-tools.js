/**
 * GitHub araçları — repo/kod arama, dosya okuma, commit/issue listeleme.
 * Env: GITHUB_TOKEN.
 */
const enabled = () => !!process.env.GITHUB_TOKEN;
async function gh(path, params) {
  const url = 'https://api.github.com' + path + (params ? ('?' + new URLSearchParams(params)) : '');
  const r = await fetch(url, { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'XJarvis', Accept: 'application/vnd.github+json' } });
  const j = await r.json();
  if (j && j.message && !r.ok) throw new Error(j.message);
  return j;
}

const TOOLS = [
  { name: 'github_my_repos', description: 'Kullanıcının GitHub repolarını listele (özel dahil).', input_schema: { type: 'object', properties: {} } },
  { name: 'github_search_repos', description: 'GitHub\'da repo ara.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'github_search_code', description: 'GitHub\'da kod ara (örn. "repo:owner/name fonksiyon").', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'github_read_file', description: 'Bir repodaki dosyanın içeriğini oku.', input_schema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' }, ref: { type: 'string' } }, required: ['owner', 'repo', 'path'] } },
  { name: 'github_list_commits', description: 'Bir reponun son commitlerini listele.', input_schema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, limit: { type: 'number' } }, required: ['owner', 'repo'] } },
  { name: 'github_list_issues', description: 'Bir reponun issue/PR listesini getir.', input_schema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string' } }, required: ['owner', 'repo'] } },
];

const TOOL_IMPL = {
  github_my_repos: async () => {
    const j = await gh('/user/repos', { affiliation: 'owner,collaborator,organization_member', sort: 'updated', per_page: '30' });
    if (!Array.isArray(j) || !j.length) return 'repo yok';
    return j.map((r) => `• ${r.full_name}${r.private ? ' 🔒' : ''} — ${r.description || ''} (${r.language || '?'}, ★${r.stargazers_count})`).join('\n');
  },
  github_search_repos: async ({ query }) => {
    const j = await gh('/search/repositories', { q: query, per_page: '8' });
    return (j.items || []).map((r) => `• ${r.full_name} ★${r.stargazers_count} — ${r.description || ''}`).join('\n') || 'sonuç yok';
  },
  github_search_code: async ({ query }) => {
    const j = await gh('/search/code', { q: query, per_page: '8' });
    return (j.items || []).map((r) => `• ${r.repository?.full_name}: ${r.path}`).join('\n') || 'sonuç yok';
  },
  github_read_file: async ({ owner, repo, path, ref }) => {
    const j = await gh(`/repos/${owner}/${repo}/contents/${path}`, ref ? { ref } : undefined);
    if (j.content) return Buffer.from(j.content, 'base64').toString('utf-8').slice(0, 8000);
    if (Array.isArray(j)) return 'klasör: ' + j.map((x) => x.name).join(', ');
    return '(içerik yok)';
  },
  github_list_commits: async ({ owner, repo, limit = 10 }) => {
    const j = await gh(`/repos/${owner}/${repo}/commits`, { per_page: String(Math.min(limit, 30)) });
    return (j || []).map((c) => `• ${c.sha.slice(0, 7)} ${c.commit?.message?.split('\n')[0]} — ${c.commit?.author?.name}`).join('\n') || 'commit yok';
  },
  github_list_issues: async ({ owner, repo, state = 'open' }) => {
    const j = await gh(`/repos/${owner}/${repo}/issues`, { state, per_page: '15' });
    return (j || []).map((i) => `#${i.number} [${i.pull_request ? 'PR' : 'issue'}] ${i.title} (${i.state})`).join('\n') || 'issue yok';
  },
};

module.exports = { TOOLS, TOOL_IMPL, enabled };
