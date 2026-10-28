import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('weekday history identifies separate morning and afternoon peaks', () => {
  assert.match(source, /morningPeak: 'Punta de mañana'/);
  assert.match(source, /afternoonPeak: 'Punta de tarde'/);
  assert.match(source, /start: 360, end: 720/);
  assert.match(source, /start: 720, end: 1321/);
  assert.match(source, /point\.minuteOfDay >= period\.start && point\.minuteOfDay < period\.end/);
});

test('peak summaries require measured day and sample coverage', () => {
  assert.match(source, /HISTORY_REQUIRED_DAYS = 14/);
  assert.match(source, /HISTORY_REQUIRED_WEEKDAY_DAYS = 10/);
  assert.match(source, /HISTORY_REQUIRED_BUCKET_SAMPLES = 50/);
  assert.match(source, /historyObservedDays >= HISTORY_REQUIRED_DAYS && qualifiedWeekdayHistory\.length >= 8/);
  assert.match(source, /historyReady && <div className="peak-periods"/);
  assert.match(source, /historyEvidence\(period\.point\.daysObserved, period\.point\.samples\)/);
});

test('coverage state and peak summaries adapt to mobile', () => {
  assert.match(source, /className=\{`history-quality \$\{historyReady \? 'is-ready' : 'is-learning'\}`\}/);
  assert.match(source, /historyCoveragePercent/);
  assert.match(css, /\.peak-periods \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.peak-periods \{ grid-template-columns: 1fr; \}/);
});
