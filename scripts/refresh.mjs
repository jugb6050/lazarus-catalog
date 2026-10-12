// Weekly refresh. Node 20+, no dependencies. Needs GITHUB_TOKEN for a usable rate limit.
//
//   node scripts/refresh.mjs            updates catalog.json metrics, writes candidates.md
//   node scripts/refresh.mjs --dry-run  prints what it would do, writes nothing
//
// It only ever updates numbers on items already in the catalog (stars, starsGain7d, archived).
// New items are NEVER added automatically: they are listed in candidates.md for a human to review.

import { readFileSync, writeFileSync } from "node:fs";

const dry = process.argv.includes("--dry-run");
const token = process.env.GITHUB_TOKEN;
const headers = { Accept: "application/vnd.github+json", "User-Agent": "lazarus-catalog", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const catalog = JSON.parse(readFileSync("catalog.json", "utf8"));
const dismissed = new Set(JSON.parse(readFileSync("dismissed.json", "utf8")));
const known = new Set(catalog.items.map((i) => i.repo?.toLowerCase()).filter(Boolean));
const problems = [];

// 1. Metrics for existing items. starsGain7d compares with the snapshot at least 6 days old.
for (const item of catalog.items) {
  if (!item.repo) continue;
  const repo = await gh(`/repos/${item.repo}`);
  if (!repo) { problems.push(`${item.id}: repo ${item.repo} not found`); continue; }
  const old = item.statsAt && (Date.parse(today) - Date.parse(item.statsAt)) / 864e5 >= 6;
  if (old || item.starsBase === undefined) { item.starsBase = item.stars ?? repo.stargazers_count; item.baseAt = item.statsAt ?? today; }
  item.starsGain7d = repo.stargazers_count - (item.starsBase ?? repo.stargazers_count);
  item.stars = repo.stargazers_count;
  item.created = repo.created_at.slice(0, 10);
  item.statsAt = today;
  if (repo.archived) { item.archived = true; problems.push(`${item.id}: ${item.repo} is archived`); } else delete item.archived;
}
catalog.updated = today;

// 2. Candidates: new and fast-rising repos that are not in the catalog yet.
const queries = {
  "MCP servers": [`topic:mcp-server created:>${daysAgo(45)} stars:>300`],
  "Skills": ["agent-skills", "claude-skills", "claude-code-skills"].map((t) => `topic:${t} pushed:>${daysAgo(14)} stars:>500`),
  "CLI tools": ["ai-coding-agent", "coding-agent", "claude-code"].map((t) => `topic:${t} created:>${daysAgo(60)} stars:>500`),
};
const sections = [];
for (const [label, qs] of Object.entries(queries)) {
  const seen = new Map();
  for (const q of qs) {
    const found = await gh(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=10`);
    for (const r of found?.items ?? []) seen.set(r.full_name.toLowerCase(), r);
  }
  const rows = [...seen.values()]
    .filter((r) => !known.has(r.full_name.toLowerCase()) && !dismissed.has(r.full_name.toLowerCase()) && !r.archived)
    .sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 10);
  sections.push(`## ${label}\n\n` + (rows.length
    ? rows.map((r) => `- [ ] **${r.full_name}** — ${r.stargazers_count.toLocaleString()} stars, created ${r.created_at.slice(0, 10)}. ${(r.description ?? "").slice(0, 200)}`).join("\n")
    : "_Nothing new._"));
}

// 3. Newly published servers in the official MCP registry (it has no popularity data, so show stars for those on GitHub).
try {
  const res = await fetch("https://registry.modelcontextprotocol.io/v0/servers?limit=100&version=latest", { headers: { "User-Agent": "lazarus-catalog" } });
  const recent = ((await res.json()).servers ?? []).filter((s) => s._meta?.["io.modelcontextprotocol.registry/official"]?.publishedAt >= daysAgo(7));
  const lines = [];
  for (const { server } of recent) {
    const m = /github\.com\/([^/]+\/[^/.]+)/.exec(server.repository?.url ?? "");
    if (!m || known.has(m[1].toLowerCase()) || dismissed.has(m[1].toLowerCase())) continue;
    const repo = await gh(`/repos/${m[1]}`);
    if (repo && repo.stargazers_count >= 100) lines.push(`- [ ] **${repo.full_name}** — ${repo.stargazers_count.toLocaleString()} stars, newly in the MCP registry. ${server.description ?? ""}`);
  }
  sections.push("## New in the MCP registry\n\n" + (lines.join("\n") || "_Nothing new._"));
} catch (e) { problems.push(`registry: ${e.message}`); }

const report = `# Catalog candidates — ${today}\n\nTick what looks worth adding, then ask Claude to draft the entries. Repos you reject go in \`dismissed.json\`.\n\n`
  + sections.join("\n\n") + (problems.length ? `\n\n## Problems\n\n${problems.map((p) => `- ${p}`).join("\n")}` : "") + "\n";

if (dry) { console.log(report); process.exit(0); }
writeFileSync("catalog.json", JSON.stringify(catalog, null, 2) + "\n");
writeFileSync("candidates.md", report);
console.log(report);
