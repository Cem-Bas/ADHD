export const CLAIM_CLASSES = ['core', 'supporting', 'background'];
export const STABILITIES = ['stable', 'unstable'];
export const CONTROVERSIES = ['disputed', 'undisputed'];
export const CONFIDENCES = ['high', 'moderate', 'low'];
export const RELATIONS = ['supports', 'contradicts', 'context'];
export const SOURCE_TYPES = ['primary', 'authoritative', 'secondary', 'other'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export function validateSource(source) {
  const errors = [];
  if (!source || typeof source !== 'object') return { ok: false, errors: ['source must be an object'] };
  if (!nonEmpty(source.url)) errors.push('url required');
  if (!nonEmpty(source.title)) errors.push('title required');
  if (!nonEmpty(source.publisher)) errors.push('publisher required');
  if (!(source.publicationDate === null || nonEmpty(source.publicationDate))) errors.push('publicationDate must be a string or null');
  if (!nonEmpty(source.accessedAt)) errors.push('accessedAt required');
  if (!SOURCE_TYPES.includes(source.sourceType)) errors.push(`sourceType must be one of ${SOURCE_TYPES.join(', ')}`);
  if (!nonEmpty(source.evidenceChainId)) errors.push('evidenceChainId required');
  if (!RELATIONS.includes(source.relation)) errors.push(`relation must be one of ${RELATIONS.join(', ')}`);
  if (source.independentlyCollected !== undefined && typeof source.independentlyCollected !== 'boolean') errors.push('independentlyCollected must be boolean');
  return { ok: errors.length === 0, errors };
}

export function validateClaim(claim) {
  const errors = [];
  if (!claim || typeof claim !== 'object') return { ok: false, errors: ['claim must be an object'] };
  if (typeof claim.claimId !== 'string' || !ID_RE.test(claim.claimId)) errors.push(`claimId must be a string matching ${ID_RE.source}`);
  if (!nonEmpty(claim.text)) errors.push('text required');
  if (!CLAIM_CLASSES.includes(claim.class)) errors.push('class must be core, supporting, or background');
  if (!STABILITIES.includes(claim.stability)) errors.push('stability must be stable or unstable');
  if (!CONTROVERSIES.includes(claim.controversy)) errors.push('controversy must be disputed or undisputed');
  if (!CONFIDENCES.includes(claim.confidence)) errors.push('confidence must be high, moderate, or low');
  if (typeof claim.rationale !== 'string') errors.push('rationale must be a string');
  if (!Array.isArray(claim.sources)) errors.push('sources must be an array');
  else claim.sources.forEach((source, i) => { const result = validateSource(source); if (!result.ok) errors.push(`sources[${i}]: ${result.errors.join('; ')}`); });
  if (claim.inference !== undefined && typeof claim.inference !== 'boolean') errors.push('inference must be boolean');
  if (claim.dateChecked !== undefined && typeof claim.dateChecked !== 'boolean') errors.push('dateChecked must be boolean');
  return { ok: errors.length === 0, errors };
}

export function validateUnresolved(item) {
  const errors = [];
  if (!item || typeof item !== 'object') return { ok: false, errors: ['unresolved item must be an object'] };
  if (!nonEmpty(item.question)) errors.push('question required');
  if (!nonEmpty(item.missingEvidence)) errors.push('missingEvidence required');
  if (!nonEmpty(item.effectOnConclusion)) errors.push('effectOnConclusion required');
  if (item.claimId !== undefined && (typeof item.claimId !== 'string' || !ID_RE.test(item.claimId))) errors.push('claimId malformed');
  return { ok: errors.length === 0, errors };
}

export function normalizePublisher(publisher) {
  return String(publisher || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function chainKeys(sources) {
  const byPublisher = new Map();
  const keys = new Set();
  for (const source of sources) {
    if (source.independentlyCollected === true) {
      keys.add(`chain:${source.evidenceChainId}`);
      continue;
    }
    const publisher = normalizePublisher(source.publisher);
    if (!byPublisher.has(publisher)) byPublisher.set(publisher, source.evidenceChainId);
    keys.add(`chain:${byPublisher.get(publisher)}`);
  }
  return [...keys];
}

function supporting(claim) {
  return (claim.sources || []).filter((source) => source.relation === 'supports');
}

export function supportChains(claim) {
  return chainKeys(supporting(claim));
}

export function authoritativeChains(claim) {
  return chainKeys(supporting(claim).filter((source) => source.sourceType === 'primary' || source.sourceType === 'authoritative'));
}

export function hasDateCheck(claim) {
  if (claim.dateChecked === true) return true;
  const sources = supporting(claim);
  return sources.length > 0 && sources.every((source) => nonEmpty(source.publicationDate));
}

export function computeConfidence(claim) {
  const authoritative = authoritativeChains(claim).length;
  const all = supportChains(claim).length;
  const contradicted = (claim.sources || []).some((source) => source.relation === 'contradicts');
  if (authoritative >= 2 && !contradicted) return 'high';
  if (authoritative >= 1 || all >= 2) return 'moderate';
  return 'low';
}

export function assessClaim(claim, unresolved = []) {
  const reasons = [];
  const chains = supportChains(claim);
  const authoritative = authoritativeChains(claim);
  const gapReported = unresolved.some((item) => item.claimId === claim.claimId);
  if (claim.class === 'core') {
    if (chains.length === 0) reasons.push('core claim has no direct supporting citation');
    if (claim.stability === 'unstable' && !hasDateCheck(claim)) reasons.push('unstable claim lacks a date check');
    if (claim.stability === 'stable' && claim.controversy === 'undisputed' && authoritative.length < 1) reasons.push('core stable undisputed claim needs one primary or authoritative source');
    if ((claim.stability === 'unstable' || claim.controversy === 'disputed') && authoritative.length < 2 && !(claim.confidence === 'low' && gapReported)) {
      reasons.push('core disputed or unstable claim needs two independent authoritative chains, or low confidence with a reported gap');
    }
  } else if (claim.class === 'supporting' && chains.length === 0 && claim.inference !== true) {
    reasons.push('supporting claim needs one credible source or an explicit inference label');
  }
  const contradictions = (claim.sources || []).filter((source) => source.relation === 'contradicts').length;
  if (contradictions > 0 && claim.class === 'core' && claim.confidence === 'high' && !gapReported) reasons.push('high confidence is not allowed with an unresolved contradiction');
  return { claimId: claim.claimId, adequate: reasons.length === 0, reasons, supportChains: chains.length, authoritativeChains: authoritative.length, contradictions, computedConfidence: computeConfidence(claim), gapReported };
}

export function assessLedger(claims, unresolved = []) {
  const results = claims.map((claim) => assessClaim(claim, unresolved));
  const gaps = results.filter((result) => !result.adequate).map((result) => ({ claimId: result.claimId, reasons: result.reasons }));
  return { adequate: gaps.length === 0, claims: results, gaps };
}
