# n8n production skills (free: n8n-ship-check)

A free Agent Skill that makes Claude Code, Codex and Cursor lint n8n workflow JSON before they hand it to you. It ships a zero-dependency linter (`node`, no install) that catches the mistakes AI-written workflows make most:

- `{{ }}` expressions missing the leading `=` (n8n sends them as literal text)
- hardcoded API keys, bot tokens and Bearer headers in node parameters
- connections pointing at renamed or missing nodes, duplicate node names
- Webhook set to "Respond to Webhook node" with no such node (callers hang)
- moment.js date tokens (`YYYY-MM-DD`) instead of Luxon (`yyyy-MM-dd`)
- external calls with no retry and no error branch, retry values above n8n's caps
- pinned data left in the export, missing error workflow, unauthenticated webhooks

```
$ node skills/n8n-ship-check/scripts/lint-workflow.mjs examples/broken-workflow.json

examples/broken-workflow.json  (dirty)  4 error(s), 7 warning(s)
  error dangling-connection          [HTTP Request] "HTTP Request" connects to missing node "Ghost".
  error missing-respond-node         [Webhook] responseMode is "responseNode" but there is no Respond to Webhook node. ...
  error hardcoded-secret             [HTTP Request] "headerParameters.parameters[0].value" looks like a hardcoded Bearer token. ...
  error expression-not-enabled       [HTTP Request] "jsonBody" contains {{ }} but does not start with "=", ...
  warn  luxon-token                  [HTTP Request] "jsonBody" uses moment.js tokens (YYYY/DD/Do). ...
  ...
```

Exit code is 1 when there are errors (`--strict` also fails on warnings), so it works in CI too. See `.github/workflows/lint-n8n.yml`.

## Install the skill

Clone, then copy the skill folder where your agent looks for skills.

```bash
git clone https://github.com/khmuhtadin/n8n-production-skills.git
cd n8n-production-skills
```

**Claude Code**: `mkdir -p ~/.claude/skills && cp -R skills/n8n-ship-check ~/.claude/skills/`

**Codex CLI**: `mkdir -p ~/.agents/skills && cp -R skills/n8n-ship-check ~/.agents/skills/`

**Cursor** (2.4+): `mkdir -p ~/.cursor/skills && cp -R skills/n8n-ship-check ~/.cursor/skills/`

For a single project use `.claude/skills/`, `.agents/skills/` or `.cursor/skills/` inside the repo instead. Restart the agent. It will run the linter whenever it writes or reviews workflow JSON, or you can ask: "run n8n-ship-check on workflows/".

Without an agent: `node skills/n8n-ship-check/scripts/lint-workflow.mjs path/to/*.json` (Node 18+).

## Use it with the other free n8n skills

This skill does one thing. For node configuration and expression basics, the free [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) and the official [n8n-io/skills](https://github.com/n8n-io/skills) are excellent and pair well with it.

## The paid pack

**n8n Production Skills** ($29 one-time) adds nine more skills on top of this one:

- scrubber for pin data, credential ids and secrets before you share or commit a workflow
- git exporter through the n8n API, plus a JSON-to-SDK converter so you can import plain workflow JSON through the official n8n MCP
- error workflows, retries and backoff loops, idempotent webhooks, rate limits, queue mode checklist
- tested templates and guides for Xendit payments, WhatsApp via WAHA, Telegram bots, Google Sheets as a database, AI Agent nodes, and Luxon dates

Details and checkout: https://shop.khaisa.studio/skills/n8n-production-skills/

Made by Khairul Muhtadin (Khaisa Studio), n8n Ambassador. Issues and pull requests for the linter are welcome.

## License

MIT for everything in this repository. The paid pack has its own license.
