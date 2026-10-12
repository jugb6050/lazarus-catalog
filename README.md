# Lazarus catalog

The data behind **Settings → Discover** in Lazarus: recommended, trending and upcoming skills, MCP servers and CLI tools.

- `catalog.json` is what the app downloads. Entries are added by hand.
- Every Monday a GitHub Action updates star counts (which drive *Trending*) and opens an issue listing new candidates. Nothing is added automatically.
- `dismissed.json` lists repos (lowercase `owner/name`) that should not show up as candidates again.

Item fields: `id`, `kind` (`mcp` | `skill` | `cli`), `name`, `summary`, optional `why`, `recommended`, `added`, `repo`, `status` (`beta` | `soon`), and `install`:

- mcp: `{ transport: "stdio", command: "npx"|"uvx", args, secrets }` or `{ transport: "http", url, secrets }`
- skill: `{ repo: "owner/name", paths: ["skills/foo"] }`
- cli: `{ command, check }` (shown to the user to copy; the app never runs it)

Run locally: `GITHUB_TOKEN=$(gh auth token) node scripts/refresh.mjs --dry-run`
