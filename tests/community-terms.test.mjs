import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acceptsCurrentCommunityTerms, COMMUNITY_TERMS_VERSION } from '../lib/community-terms.ts';

test('only the current explicit community terms version is accepted', () => {
  const request = (value) => new Request('https://example.test/api/reports', { headers: value ? { 'X-Alerta-Community-Terms': value } : {} });
  assert.equal(acceptsCurrentCommunityTerms(request()), false);
  assert.equal(acceptsCurrentCommunityTerms(request('old')), false);
  assert.equal(acceptsCurrentCommunityTerms(request(COMMUNITY_TERMS_VERSION)), true);
});

test('posting is gated in both the interface and reports API', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../app/api/reports/route.ts', import.meta.url), 'utf8');
  assert.match(page, /if \(!communityTermsAccepted\)[\s\S]*communityConsentRef\.current\?\.focus\(\)/);
  assert.match(page, /'X-Alerta-Community-Terms': COMMUNITY_TERMS_VERSION/);
  assert.match(route, /if \(!acceptsCurrentCommunityTerms\(request\)\) throw new ApiError\(428, 'community_terms_required'\)/);
});

test('users can hide and immediately restore a report only on their device', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /HIDDEN_REPORTS_STORAGE_KEY/);
  assert.match(page, /!hiddenReportIds\.includes\(item\.id\)/);
  assert.match(page, /function hideReportLocally\(report: Report\)/);
  assert.match(page, /function undoLocalHide\(\)/);
  const hideFunction = page.slice(page.indexOf('function hideReportLocally'), page.indexOf('function undoLocalHide'));
  assert.doesNotMatch(hideFunction, /fetch\(/);
});
