import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const outputDir = new URL('../android/store-assets/phone/', import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const context = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'es-ES',
});

const page = await context.newPage();
const capturedAt = new Date().toISOString();
await page.route('**/api/trams', (route) => route.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({
    source: 'Metrotenerife · TranvíaOnline',
    fetchedAt: capturedAt,
    stale: false,
    trams: [
      { service: '102', route: 1, direction: 2, coordinate: { lat: 28.47962, lon: -16.30531 }, remainingMinutes: 2, departureMinutes: null, atTerminal: false, nextStop: 'CPI', nextStopDescription: 'Cruz de Piedra', destinationStop: 'INT', destinationStopDescription: 'Intercambiador', orderStop: 3 },
      { service: '108', route: 1, direction: 2, coordinate: { lat: 28.47416, lon: -16.29484 }, remainingMinutes: 4, departureMinutes: null, atTerminal: false, nextStop: 'GRA', nextStopDescription: 'Gracia', destinationStop: 'INT', destinationStopDescription: 'Intercambiador', orderStop: 5 },
      { service: '115', route: 1, direction: 2, coordinate: { lat: 28.46833, lon: -16.25991 }, remainingMinutes: 1, departureMinutes: null, atTerminal: false, nextStop: 'WEY', nextStopDescription: 'Weyler', destinationStop: 'INT', destinationStopDescription: 'Intercambiador', orderStop: 18 },
    ],
  }),
}));
await page.route('**/api/occupancy', (route) => route.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({
    source: 'Metrotenerife · TranvíaOnline',
    fetchedAt: capturedAt,
    stale: false,
    occupancy: [
      { service: '102', vehicle: 102, load: 24, rawLoad: null, sourceAt: capturedAt },
      { service: '108', vehicle: 108, load: 47, rawLoad: null, sourceAt: capturedAt },
      { service: '115', vehicle: 115, load: 68, rawLoad: null, sourceAt: capturedAt },
    ],
  }),
}));
await page.route('**/api/reports**', (route) => route.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({ reports: [] }),
}));
await page.route('**/api/occupancy/history**', (route) => route.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({ sampleCount: 0, points: [] }),
}));
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.locator('.app-shell').waitFor();
await page.evaluate(() => {
  localStorage.setItem('alerta-tram-language', 'es');
  window.scrollTo(0, 0);
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.app-shell').waitFor();
await page.waitForTimeout(1_500);
await page.screenshot({ path: new URL('01-inicio.png', outputDir).pathname });

await page.locator('.live-panel').evaluate((element) => {
  const top = element.getBoundingClientRect().top + window.scrollY;
  window.scrollTo(0, Math.max(0, top - 24));
});
await page.waitForTimeout(400);
await page.screenshot({ path: new URL('02-mapa-en-directo.png', outputDir).pathname });

await browser.close();
