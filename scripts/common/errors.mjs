export class AdhdError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AdhdError';
    this.code = code;
    this.details = details;
  }
}

export function isAdhdError(error, code) {
  return error instanceof AdhdError && (code === undefined || error.code === code);
}
