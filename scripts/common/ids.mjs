import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomToken(length = 16) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function randomTaskId() {
  return `t${randomToken(15)}`;
}

export function randomNonce() {
  return randomBytes(16).toString('hex');
}

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function digestOf(value) {
  return `sha256:${sha256Hex(JSON.stringify(value))}`;
}
