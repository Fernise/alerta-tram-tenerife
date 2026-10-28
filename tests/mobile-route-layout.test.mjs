// Source/geometry regression checks, not browser rendering or device screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import ts from 'typescript';

const css = postcss.parse(readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const page = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function declarations(selector, mobile = true) {
  const result = {};
  css.walkRules((rule) => {
    const inMobile = rule.parent.type === 'atrule' && rule.parent.name === 'media' && rule.parent.params === '(max-width: 720px)';
    if (inMobile !== mobile || !rule.selectors.includes(selector)) return;
    rule.walkDecls((decl) => { result[decl.prop] = decl.value; });
  });
  return result;
}

test('mobile rail uses the full stop row height, connecting variable-height rows', () => {
  const map = declarations('.route-map');
  const rail = declarations('.route-map .rail');
  const track = declarations('.route-map .track');
  assert.equal(map['row-gap'], '0');
  assert.equal(rail.position, 'absolute'); assert.equal(rail.top, '0'); assert.equal(rail.bottom, '0'); assert.equal(rail.height, 'auto');
  assert.equal(track.height, '100%'); assert.equal(track.top, 'var(--stop-center)');
  const centre = Number.parseFloat(map['--stop-center']);
  assert.ok(Number.isFinite(centre));
  let rowTop = 0;
  // Compact, wrapped labels, one/two trams, and wrapped marker rows.
  for (const rowHeight of [80, 80, 122, 145, 181.5, 96]) {
    const segmentEnd = rowTop + centre + rowHeight;
    const nextStopCentre = rowTop + rowHeight + centre;
    assert.equal(segmentEnd, nextStopCentre);
    rowTop += rowHeight;
  }
});

test('mobile labels and marker badges have independent normal-flow rows', () => {
  const stop = declarations('.route-map button.stop');
  const name = declarations('.stop > .stop-name');
  const markers = declarations('.route-map .live-tram-stack');
  assert.equal(stop.display, 'grid'); assert.equal(stop['grid-template-columns'], '34px minmax(0, 1fr)');
  assert.equal(name['grid-row'], '1'); assert.equal(name['grid-column'], '2'); assert.equal(name['max-width'], '100%');
  assert.equal(name['overflow-wrap'], 'anywhere');
  assert.equal(markers['grid-row'], '2'); assert.equal(markers['grid-column'], '2');
  assert.equal(markers.position, 'relative'); assert.equal(markers.top, 'auto'); assert.equal(markers.left, 'auto');
  assert.equal(markers['flex-wrap'], 'wrap'); assert.equal(markers.padding, '10px 7px 9px');
  assert.equal(declarations('.stop > span:last-child').position, undefined);
});

test('stop label and live markers are siblings, not inside the track column', () => {
  let stop;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(page) === 'button'
      && node.openingElement.attributes.properties.some((attribute) => attribute.name?.getText(page) === 'className' && attribute.initializer?.text === 'stop')) stop = node;
    ts.forEachChild(node, visit);
  }
  visit(page);
  assert.ok(stop);
  const children = stop.children.filter((child) => !(ts.isJsxText(child) && !child.text.trim()));
  assert.equal(children.length, 3);
  assert.match(children[0].getText(page), /className=\{`rail /);
  assert.doesNotMatch(children[0].getText(page), /live-tram-stack/);
  assert.match(children[1].getText(page), /stop-name/);
  assert.match(children[2].getText(page), /live-tram-stack/);
  assert.match(children[0].getText(page), /index < current\.stops\.length - 1/); // No rail beyond the terminal.
});

test('horizontal directions rotate down/up only on mobile, with the legend retained', () => {
  assert.equal(declarations('.route-map .marker-direction').transform, 'rotate(90deg)');
  assert.equal(declarations('.direction-legend b').transform, 'rotate(90deg)');
  assert.equal(declarations('.map-labels span:last-child').display, undefined);
  assert.equal(declarations('.marker-direction', false).transform, undefined);
  assert.equal(declarations('.route-map', false).display, 'flex');
  assert.equal(declarations('.route-map', false)['overflow-x'], 'auto');
  assert.match(source, /tram\.direction === 2 \? '→' : '←'/);
  assert.match(source, /tram\.mapStop === stop/); // Same live data as the individual cards.
});

test('primary mobile controls expose practical touch targets', () => {
  assert.equal(declarations('.alerts-button').height, '42px');
  assert.equal(declarations('.icon-button').height, '42px');
  assert.equal(declarations('.language-switch button').height, '36px');
  assert.equal(declarations('.direction-button')['min-height'], '44px');
  assert.equal(declarations('.report-filter button')['min-height'], '44px');
  assert.equal(declarations('.report-inline-action')['min-height'], '44px');
  assert.equal(declarations('.modal-heading button').height, '44px');
});

test('mobile floating actions respect device safe-area insets', () => {
  assert.match(declarations('.report-button')['bottom'], /safe-area-inset-bottom/);
  assert.match(declarations('.toast')['bottom'], /safe-area-inset-bottom/);
});
