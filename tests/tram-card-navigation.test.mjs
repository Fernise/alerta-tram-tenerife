// Source and style regression checks; browser/device interaction remains a release check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('each live tram card is an accessible control that requests route focus', () => {
  assert.match(source, /<button className="live-tram-card" type="button"/);
  assert.match(source, /onClick=\{\(\) => showTramOnRoute\(tram\)\}/);
  assert.match(source, /aria-label=\{`\$\{t\.showOnRoute\}/);
  assert.match(source, /tramFocusRequest.*nonce/s);
});

test('route focus centers the exact marker and clamps at both route edges', () => {
  assert.match(source, /maximumLeft = Math\.max\(0, routeMap\.scrollWidth - routeMap\.clientWidth\)/);
  assert.match(source, /clampedLeft = Math\.min\(maximumLeft, Math\.max\(0, desiredLeft\)\)/);
  assert.match(source, /routeMap\.scrollTo\(\{ left: clampedLeft, behavior \}\)/);
  assert.match(source, /window\.scrollTo\(\{ top: Math\.max\(0, desiredTop\), behavior \}\)/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*tramMarkerRefs\.current\.get\(tramFocusRequest\.key\)[\s\S]*\}, \[tramFocusRequest\]\)/);
  assert.doesNotMatch(source, /\}, \[tramFocusRequest, (?:liveTrams|visibleTrams)/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /route-map:has\(\.live-tram-marker\.is-selected\)::before/);
});

test('a selected tram is promoted out of overflow and visibly highlighted', () => {
  assert.match(source, /selectedTram[\s\S]*\[selectedTram, \.\.\.tramsHere\.filter/);
  assert.match(source, /hiddenTrams = tramsHere\.filter/);
  assert.match(source, /selectedTramKey === key \? 'is-selected'/);
  assert.match(css, /\.live-tram-marker\.is-selected/);
});

test('changing route clears stale focus announcements and install help is never covered', () => {
  const routeChange = source.slice(source.indexOf('function changeRoute('), source.indexOf('const showAppNotification'));
  assert.match(routeChange, /if \(nextLine === line && nextDirection === direction\) return/);
  assert.match(routeChange, /setSelectedTramKey\(null\);[\s\S]*setTramFocusRequest\(null\);[\s\S]*setTramMapAnnouncement\(''\)/);
  assert.match(source, /onClick=\{\(\) => changeRoute\(item, direction\)\}/);
  assert.match(source, /changeRoute\(report\.line, report\.direction\)/);
  assert.match(source, /!installHelpOpen && <button className="report-button"/);
  assert.match(source, /className="report-button" type="button" aria-label=\{t\.reportControl\}/);
});
