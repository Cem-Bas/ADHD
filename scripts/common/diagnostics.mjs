import path from 'node:path';
import { appendLine } from './fsx.mjs';
import { diagnosticsFile, dataPaths } from './paths.mjs';
import { redact } from './evidence.mjs';

export function appendDiagnostic(root, sessionId, { level = 'warn', code, message, details = null }, { now = Date.now() } = {}) {
  let file;
  try {
    file = diagnosticsFile(root, sessionId);
  } catch {
    file = path.join(dataPaths(root).diagnostics, 'unattributed.jsonl');
  }
  const entry = { at: new Date(now).toISOString(), level, code: String(code).slice(0, 64), message: redact(String(message)).slice(0, 500) };
  if (details !== null) {
    let serialized;
    try {
      serialized = JSON.stringify(details);
    } catch {
      serialized = String(details);
    }
    entry.details = redact(serialized).slice(0, 2000);
  }
  try {
    appendLine(file, JSON.stringify(entry));
  } catch {
    // diagnostics must never throw
  }
  return entry;
}
