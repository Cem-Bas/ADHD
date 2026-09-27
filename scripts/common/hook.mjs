import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdin, parseJson, writeStdoutJson, parseArgs, stderrLine } from './io.mjs';
import { resolveDataRoot, validateSessionId } from './paths.mjs';
import { appendDiagnostic } from './diagnostics.mjs';

export function pluginRootFromScript(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..');
}

export async function runHook({ name, importMetaUrl, argv = process.argv.slice(2), handler }) {
  let dataRoot = null;
  let sessionId = null;
  try {
    const { flags } = parseArgs(argv);
    dataRoot = resolveDataRoot({ flag: flags.data });
    const pluginRoot = pluginRootFromScript(importMetaUrl);
    const parsed = parseJson(await readStdin());
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      appendDiagnostic(dataRoot, 'unattributed', { code: 'MALFORMED_HOOK_INPUT', message: `${name}: ${parsed.ok ? 'input is not a JSON object' : parsed.error}` });
      return;
    }
    const input = parsed.value;
    try {
      sessionId = validateSessionId(input.session_id);
    } catch (error) {
      appendDiagnostic(dataRoot, 'unattributed', { code: 'INVALID_SESSION_ID', message: `${name}: ${error.message}` });
      return;
    }
    const output = await handler({ input, sessionId, dataRoot, pluginRoot, now: Date.now() });
    if (output) writeStdoutJson(output);
  } catch (error) {
    if (dataRoot) {
      try {
        appendDiagnostic(dataRoot, sessionId || 'unattributed', { code: error.code || 'HOOK_EXCEPTION', message: `${name}: ${error.message}` });
      } catch {
        // diagnostics are best effort
      }
    }
    stderrLine(`ADHD ${name} hook: ${error?.code || 'error'} — ${String(error?.message).slice(0, 200)}`);
  }
}
