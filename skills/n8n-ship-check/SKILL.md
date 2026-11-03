---
name: n8n-ship-check
description: 'Lint an n8n workflow JSON before it is imported, shared or activated. Use whenever you create, edit, export or review an n8n workflow file, or the user says "check this workflow", "is this ready for production", "why does my expression print literally", or before handing workflow JSON to the user.'
---

# n8n ship check

Run the bundled linter on every workflow JSON you write or touch, fix what it reports, then run it again. Do not hand a workflow to the user while it reports errors.

```bash
node scripts/lint-workflow.mjs path/to/workflow.json            # human-readable
node scripts/lint-workflow.mjs wf1.json wf2.json --json          # machine-readable
node scripts/lint-workflow.mjs path/to/workflow.json --strict    # warnings fail too (use in CI)
```

Node 18+, no dependencies. Exit code 0 = no errors, 1 = errors (or warnings with `--strict`), 2 = unreadable input.

## What it catches

Errors (must fix):
- `expression-not-enabled`: a parameter contains `{{ }}` but does not start with `=`. n8n stores expressions as `"={{ $json.x }}"`; without the `=` the braces are sent as literal text. This is the most common mistake in hand-written or AI-written workflow JSON.
- `hardcoded-secret`: API keys, bot tokens, Bearer headers or private keys inside parameters. Move them into a credential.
- `duplicate-name`, `dangling-connection`: connections are keyed by node name, so a rename that missed the `connections` object silently breaks the graph.
- `missing-respond-node` / `respond-without-response-mode`: a Webhook set to "Using Respond to Webhook node" needs that node, and vice versa. Otherwise callers hang until timeout.
- `duplicate-webhook-path`, `unclosed-expression`.

Warnings (fix unless there is a reason):
- `no-retry` on external calls (HTTP Request, Sheets, Telegram, Slack, databases...).
- `retry-wait-cap` / `retry-max-cap`: n8n caps Wait Between Tries at 5000 ms and Max Tries at 5.
- `luxon-token`: `YYYY`, `DD`, `Do` are moment.js tokens. n8n dates are Luxon: `yyyy-MM-dd`. In Luxon `DD` is a localized date macro, so `YYYY-MM-DD` prints garbage, not a date.
- `webhook-no-auth`, `pin-data`, `no-error-workflow`, `orphan-node`, `code-require`, `logs-secret`.

Info: default node names, disabled nodes, legacy `$node["..."]` / `$items()`, credential ids that are instance-specific, missing sticky notes.

## Workflow JSON rules to follow while writing

1. Every expression value starts with `=`: `"text": "=Hello {{ $json.name }}"`.
2. Reference other nodes by name: `{{ $('Normalize order').item.json.orderId }}`. Renaming a node means updating every `$('...')` that points to it.
3. Set `"settings": {"executionOrder": "v1"}` on new workflows.
4. External calls get `"retryOnFail": true, "maxTries": 3, "waitBetweenTries": 2000` (node level, not inside `parameters`), or `"onError": "continueErrorOutput"` with a handled error branch.
5. Leave credentials as `{"<type>": {"id": "", "name": "Human readable name"}}` in shareable files.
6. Add one sticky note that lists required credentials and setup steps.

## Before activating

- Lint passes (warnings understood).
- An error workflow is set in Workflow Settings.
- Pinned data is removed (pinned data is ignored in production runs but it is saved in the JSON and often contains real customer data).
- Test with the **test** webhook URL first, then activate and hit the **production** URL once with a harmless payload.
