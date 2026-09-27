import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClaim, chainKeys, assessClaim, assessLedger, computeConfidence } from '../../scripts/common/ledger.mjs';

const src = (over = {}) => ({ url: 'https://a.gov/x', title: 'A', publisher: 'Agency A', publicationDate: '2026-01-01', accessedAt: '2026-09-27T00:00:00Z', sourceType: 'primary', evidenceChainId: 'a', relation: 'supports', ...over });
const claim = (over = {}) => ({ claimId: 'c1', text: 'X is true', class: 'core', stability: 'stable', controversy: 'undisputed', confidence: 'moderate', rationale: 'because', sources: [src()], ...over });

test('claims and sources are validated field by field', () => {
  assert.equal(validateClaim(claim()).ok, true);
  const bad = validateClaim(claim({ class: 'major', sources: [src({ relation: 'maybe', sourceType: 'blog' })] }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('class')));
  assert.ok(bad.errors.some((e) => e.includes('sources[0]')));
});

test('repeated coverage of one source is one chain; independent collection separates chains', () => {
  assert.deepEqual(chainKeys([src(), src({ url: 'https://news.example/1', publisher: 'News', evidenceChainId: 'a' })]), ['chain:a']);
  assert.equal(chainKeys([src({ evidenceChainId: 'a' }), src({ url: 'https://a.gov/y', evidenceChainId: 'b' })]).length, 1);
  assert.equal(chainKeys([src({ evidenceChainId: 'a' }), src({ url: 'https://a.gov/y', evidenceChainId: 'b', independentlyCollected: true })]).length, 2);
  assert.equal(chainKeys([src({ evidenceChainId: 'a' }), src({ url: 'https://b.org/z', publisher: 'Org B', evidenceChainId: 'b' })]).length, 2);
});

test('support rules from the spec', () => {
  assert.equal(assessClaim(claim()).adequate, true);
  assert.equal(assessClaim(claim({ sources: [] })).adequate, false);
  assert.equal(assessClaim(claim({ sources: [src({ sourceType: 'secondary' })] })).adequate, false);
  const disputedOne = claim({ controversy: 'disputed' });
  assert.equal(assessClaim(disputedOne).adequate, false);
  assert.equal(assessClaim({ ...disputedOne, confidence: 'low' }, [{ claimId: 'c1', question: 'q', missingEvidence: 'm', effectOnConclusion: 'e' }]).adequate, true);
  const disputedTwo = claim({ controversy: 'disputed', sources: [src(), src({ url: 'https://b.org/z', publisher: 'Org B', evidenceChainId: 'b', sourceType: 'authoritative' })] });
  assert.equal(assessClaim(disputedTwo).adequate, true);
  assert.equal(assessClaim(claim({ stability: 'unstable', sources: [src({ publicationDate: null }), src({ url: 'https://b.org/z', publisher: 'Org B', evidenceChainId: 'b', publicationDate: null })] })).adequate, false);
  assert.equal(assessClaim(claim({ stability: 'unstable', dateChecked: true, sources: [src(), src({ url: 'https://b.org/z', publisher: 'Org B', evidenceChainId: 'b' })] })).adequate, true);
  assert.equal(assessClaim(claim({ class: 'supporting', sources: [] })).adequate, false);
  assert.equal(assessClaim(claim({ class: 'supporting', sources: [], inference: true })).adequate, true);
  assert.equal(assessClaim(claim({ class: 'background', sources: [] })).adequate, true);
});

test('confidence and ledger assessment', () => {
  assert.equal(computeConfidence(claim()), 'moderate');
  assert.equal(computeConfidence(claim({ sources: [src(), src({ url: 'https://b.org/z', publisher: 'Org B', evidenceChainId: 'b' })] })), 'high');
  assert.equal(computeConfidence(claim({ sources: [src(), src({ url: 'https://b.org/z', publisher: 'Org B', evidenceChainId: 'b', relation: 'contradicts' })] })), 'moderate');
  assert.equal(computeConfidence(claim({ sources: [src({ sourceType: 'secondary' })] })), 'low');
  const result = assessLedger([claim(), claim({ claimId: 'c2', sources: [] })], []);
  assert.equal(result.adequate, false);
  assert.deepEqual(result.gaps.map((g) => g.claimId), ['c2']);
});
