#!/usr/bin/env node
// n8n workflow linter. Zero dependencies, Node 18+.
// Usage: node lint-workflow.mjs <workflow.json> [more.json ...] [--json] [--strict]
// Exit code: 0 = no errors, 1 = errors found (or warnings with --strict), 2 = bad input.
import fs from 'node:fs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const strict = args.includes('--strict');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('usage: node lint-workflow.mjs <workflow.json> [--json] [--strict]'); process.exit(2); }

const SECRET_PATTERNS = [
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/, 'OpenAI/Anthropic-style API key'],
  [/\bxnd_(?:development|production)_[A-Za-z0-9]{20,}/, 'Xendit secret key'],
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, 'Telegram bot token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/, 'hardcoded Bearer token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
];
const MOMENT_TOKENS = /\.(?:toFormat|format)\(\s*['"`][^'"`]*(?:YYYY|YY(?!Y)|DD|Do)[^'"`]*['"`]/;
const TRIGGER_RE = /(Trigger$|\.webhook$|\.formTrigger$|\.chatTrigger$|\.mcpTrigger$|\.cron$|\.interval$)/i;
const EXTERNAL_RE = /(\.httpRequest$|\.googleSheets$|\.telegram$|\.slack$|\.gmail$|\.openAi$|\.postgres$|\.mySql$|\.airtable$|\.notion$|\.hubspot$)/;
const DEFAULT_NAME_RE = /^(HTTP Request|Code|Set|Edit Fields|If|Switch|Merge|Function|Webhook|Google Sheets|Telegram|No Operation, do nothing)\d*$/;

function walkStrings(obj, path, cb) {
  if (typeof obj === 'string') return cb(obj, path);
  if (Array.isArray(obj)) return obj.forEach((v, i) => walkStrings(v, `${path}[${i}]`, cb));
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) walkStrings(v, path ? `${path}.${k}` : k, cb);
}

function lint(wf) {
  const out = [];
  const add = (level, rule, msg, node) => out.push({ level, rule, node: node || null, msg });
  if (!wf || !Array.isArray(wf.nodes) || typeof wf.connections !== 'object') {
    add('error', 'shape', 'Not an n8n workflow export: needs "nodes" array and "connections" object.');
    return out;
  }
  const nodes = wf.nodes;
  const byName = new Map();
  for (const n of nodes) {
    if (byName.has(n.name)) add('error', 'duplicate-name', `Two nodes are named "${n.name}". Connections are keyed by name, so one of them will be lost.`, n.name);
    byName.set(n.name, n);
  }
  // connections
  const hasIn = new Set(), hasOut = new Set();
  for (const [src, types] of Object.entries(wf.connections)) {
    if (!byName.has(src)) add('error', 'dangling-connection', `Connection from "${src}", which is not a node in this workflow.`, src);
    for (const outs of Object.values(types || {})) for (const targets of outs || []) for (const t of targets || []) {
      if (!byName.has(t.node)) add('error', 'dangling-connection', `"${src}" connects to missing node "${t.node}".`, src);
      hasOut.add(src); hasIn.add(t.node);
    }
  }
  const real = nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
  const triggers = real.filter((n) => TRIGGER_RE.test(n.type) || n.type === 'n8n-nodes-base.manualTrigger');
  if (!triggers.length && !real.some((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger')) add('warn', 'no-trigger', 'No trigger node. The workflow can only run as a sub-workflow or manually.');
  for (const n of real) {
    const isTrig = triggers.includes(n);
    const isSub = /langchain\.(lm|memory|tool|outputParser|embeddings|vectorStore|textSplitter|document)/.test(n.type);
    if (!isTrig && !isSub && !hasIn.has(n.name) && !hasOut.has(n.name)) add('warn', 'orphan-node', 'Node is not connected to anything.', n.name);
    if (n.disabled) add('info', 'disabled-node', 'Node is disabled. Delete it or enable it before shipping.', n.name);
    if (DEFAULT_NAME_RE.test(n.name)) add('info', 'default-name', 'Default node name. Rename it to say what it does (expressions like $("Name") depend on names).', n.name);

    // parameters: expressions, secrets, moment tokens
    walkStrings(n.parameters || {}, '', (s, p) => {
      if (s.includes('{{') && s.includes('}}') && !s.startsWith('=') && n.type !== 'n8n-nodes-base.stickyNote' && !/jsCode|pythonCode|functionCode|html$/.test(p))
        add('error', 'expression-not-enabled', `"${p}" contains {{ }} but does not start with "=", so n8n treats it as plain text.`, n.name);
      if (s.startsWith('=') && /\{\{[^}]*$/.test(s)) add('error', 'unclosed-expression', `"${p}" opens {{ without closing }}.`, n.name);
      if (MOMENT_TOKENS.test(s)) add('warn', 'luxon-token', `"${p}" uses moment.js tokens (YYYY/DD/Do). n8n uses Luxon: yyyy = year, dd = day, MM = month, mm = minutes.`, n.name);
      for (const [re, label] of SECRET_PATTERNS) if (re.test(s)) add('error', 'hardcoded-secret', `"${p}" looks like a ${label}. Move it into an n8n credential.`, n.name);
      if (/\$node\[["']/.test(s)) add('info', 'legacy-node-ref', `"${p}" uses $node["..."]. Prefer $("Node Name").item.json.`, n.name);
    });
    const params = n.parameters || {};
    if (n.type === 'n8n-nodes-base.code' || n.type === 'n8n-nodes-base.function') {
      const code = params.jsCode || params.functionCode || '';
      if (/\brequire\(/.test(code)) add('warn', 'code-require', 'Code node calls require(). This fails unless NODE_FUNCTION_ALLOW_BUILTIN/EXTERNAL allow the module.', n.name);
      if (/\$items\(/.test(code)) add('info', 'legacy-items', 'Code uses $items(). Prefer $input.all() / $("Node").all().', n.name);
      if (/console\.log\(.*(token|secret|password|apiKey)/i.test(code)) add('warn', 'logs-secret', 'Code logs something that looks like a secret.', n.name);
    }
    if (n.type === 'n8n-nodes-base.webhook') {
      if (!params.authentication || params.authentication === 'none') add('warn', 'webhook-no-auth', 'Public webhook with no authentication. Use header auth, or verify a signature/token right after the trigger.', n.name);
      if (params.responseMode === 'responseNode' && !real.some((m) => m.type === 'n8n-nodes-base.respondToWebhook'))
        add('error', 'missing-respond-node', 'responseMode is "responseNode" but there is no Respond to Webhook node. Callers will hang until timeout.', n.name);
    }
    if (n.type === 'n8n-nodes-base.respondToWebhook' && !real.some((m) => m.type === 'n8n-nodes-base.webhook' && m.parameters?.responseMode === 'responseNode'))
      add('error', 'respond-without-response-mode', 'Respond to Webhook node exists but no Webhook node uses responseMode "responseNode".', n.name);
    if (EXTERNAL_RE.test(n.type) && !n.retryOnFail && !n.onError)
      add('warn', 'no-retry', 'External call with no retry and no error output. Set retryOnFail (maxTries/waitBetweenTries) or onError.', n.name);
    if (n.retryOnFail && n.waitBetweenTries > 5000) add('warn', 'retry-wait-cap', 'waitBetweenTries above 5000 ms is capped by n8n. Use a Wait node loop for longer backoff.', n.name);
    if (n.retryOnFail && n.maxTries > 5) add('warn', 'retry-max-cap', 'maxTries above 5 is capped by n8n.', n.name);
    if (n.credentials) for (const [k, c] of Object.entries(n.credentials)) if (c && c.id) add('info', 'credential-id', `Credential "${k}" carries an instance-specific id. Run the scrubber before sharing.`, n.name);
  }
  const names = real.filter((n) => n.type === 'n8n-nodes-base.webhook').map((n) => `${n.parameters?.httpMethod || 'GET'} ${n.parameters?.path}`);
  names.forEach((k, i) => { if (names.indexOf(k) !== i) add('error', 'duplicate-webhook-path', `Two webhook nodes share ${k}.`); });
  if (wf.pinData && Object.keys(wf.pinData).length) add('warn', 'pin-data', `pinData present on ${Object.keys(wf.pinData).length} node(s). Pinned data can contain real customer data. Scrub before sharing.`);
  const s = wf.settings || {};
  if (!s.errorWorkflow && triggers.some((t) => t.type !== 'n8n-nodes-base.manualTrigger' && t.type !== 'n8n-nodes-base.errorTrigger')) add('warn', 'no-error-workflow', 'settings.errorWorkflow is not set. Failures in production will be silent.');
  if (s.executionOrder && s.executionOrder !== 'v1') add('info', 'execution-order', `settings.executionOrder is "${s.executionOrder}". New workflows use "v1".`);
  if (!nodes.some((n) => n.type === 'n8n-nodes-base.stickyNote')) add('info', 'no-sticky', 'No sticky notes. A short note on setup and required credentials helps the next person.');
  return out;
}

let failed = false;
const report = [];
for (const f of files) {
  let wf;
  try { wf = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.error(`${f}: cannot read/parse JSON (${e.message})`); process.exit(2); }
  const items = lint(wf);
  const errors = items.filter((i) => i.level === 'error').length, warns = items.filter((i) => i.level === 'warn').length;
  if (errors || (strict && warns)) failed = true;
  report.push({ file: f, name: wf.name, errors, warnings: warns, items });
}
if (asJson) console.log(JSON.stringify(report, null, 2));
else for (const r of report) {
  console.log(`\n${r.file}  (${r.name || 'unnamed'})  ${r.errors} error(s), ${r.warnings} warning(s)`);
  for (const i of r.items) console.log(`  ${i.level.padEnd(5)} ${i.rule.padEnd(28)} ${i.node ? `[${i.node}] ` : ''}${i.msg}`);
}
process.exit(failed ? 1 : 0);
