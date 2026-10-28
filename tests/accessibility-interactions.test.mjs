// Source regression checks for keyboard and screen-reader interaction contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('modal owns a unique accessible title and contains keyboard focus', () => {
  assert.match(source, /const titleId = useId\(\)/);
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\} tabIndex=\{-1\}/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /previouslyFocused\?\.focus\(\)/);
});

test('custom selects support arrows, endpoints, escape, and return focus', () => {
  assert.match(source, /aria-controls=\{`\$\{id\}-listbox`\}/);
  assert.match(source, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/);
  assert.match(source, /optionButtons\.current\[nextIndex\]\?\.focus\(\)/);
  assert.match(source, /trigger\.current\?\.focus\(\)/);
  assert.match(source, /role="option" tabIndex=\{option\.value === value \? 0 : -1\}/);
});

test('community filters expose a complete keyboard tab pattern', () => {
  assert.match(source, /role="tablist"/);
  assert.match(source, /id="community-inspection-tab"[^>]+aria-controls="community-alerts-panel"/);
  assert.match(source, /id="community-incident-tab"[^>]+aria-controls="community-alerts-panel"/);
  assert.match(source, /role="tabpanel" aria-labelledby=\{`community-\$\{reportFilter\}-tab`\}/);
  assert.match(source, /onKeyDown=\{moveReportFilter\}/);
});
