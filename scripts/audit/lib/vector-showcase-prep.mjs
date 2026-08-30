/**
 * Prepare a Vector intraday chart for crisp X attachments — matches the SPX Slayer showcase:
 * 3m candles, 0DTE horizon, 20 bead rows, indicators already default-on (VWAP / structure / VP).
 *
 * Works on /dashboard (embedded column) or /vector (standalone desk).
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Desktop toolbar — SPX desk portal first, else standalone /vector page toolbar. */
export function vectorShowcaseToolbar(page) {
  return page
    .locator(
      ".spx-desk-vector-toolbar .vector-toolbar-desk, .vector-page-toolbar .vector-toolbar-desk, .vector-toolbar-desk",
    )
    .first();
}

/**
 * @param {import('playwright').Page} page
 * @param {{ waitMs?: number }} [opts]
 */
export async function prepareVectorShowcaseChart(page, opts = {}) {
  const waitMs = opts.waitMs ?? 2500;
  const toolbar = vectorShowcaseToolbar(page);
  await toolbar.waitFor({ state: "visible", timeout: 90_000 });

  const tf = toolbar.locator("#vector-tf-select").first();
  if (await tf.count()) {
    await tf.selectOption("3");
    await sleep(waitMs);
  }

  const dte = toolbar.locator('[data-testid="vector-dte-0dte"]').first();
  if (await dte.count()) {
    if ((await dte.getAttribute("aria-pressed")) !== "true") {
      await dte.click();
      await sleep(waitMs + 500);
    }
  }

  const nodes = toolbar.locator('[data-testid="vector-nodes-select"]').first();
  if (await nodes.count()) {
    await nodes.selectOption("20");
    await sleep(waitMs + 1500);
  }

  await page.locator(".vector-chart-canvas").first().waitFor({ state: "visible", timeout: 90_000 });

  await page
    .waitForFunction(
      () => {
        const body = document.body.innerText;
        return body.includes("POC") && body.includes("VWAP");
      },
      { timeout: 120_000 },
    )
    .catch(() => {});

  await sleep(1500);
}

/**
 * Social / X capture prep — zooms until candles and bead rails are legible (not the default
 * full-range smear). Mirrors the operator rules in x-intel-capture.cjs and capture-catalog.
 *
 * @param {import('playwright').Page} page
 * @param {{
 *   horizon?: string;
 *   timeframe?: string;
 *   nodes?: string;
 *   zoom?: number;
 *   zoomAnchor?: number;
 *   priceZoom?: number;
 *   sessionViewport?: boolean;
 *   waitBeads?: boolean;
 *   waitMs?: number;
 * }} [opts]
 */
export async function prepareVectorSocialCapture(page, opts = {}) {
  const horizon = opts.horizon ?? "0dte";
  const timeframe = String(opts.timeframe ?? "3");
  const nodes = String(opts.nodes ?? "20");
  const zoomSteps = Number(opts.zoom ?? 0);
  const zoomAnchor = Number(opts.zoomAnchor ?? 0.99);
  const priceZoom = opts.priceZoom ?? 0;
  const waitMs = opts.waitMs ?? 2500;
  const waitBeads = opts.waitBeads ?? true;
  const useStructure = opts.structure_viewport === true;

  const toolbar = vectorShowcaseToolbar(page);
  await toolbar.waitFor({ state: "visible", timeout: 90_000 });

  const dteBtn = page.locator(`[data-testid="vector-dte-${horizon}"]`).first();
  if (await dteBtn.count()) {
    if ((await dteBtn.getAttribute("aria-pressed")) !== "true") {
      await dteBtn.click({ force: true, timeout: 8000 }).catch(() => {});
      await sleep(waitMs + 500);
    }
  }

  const tf = toolbar.locator("#vector-tf-select").first();
  await tf.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
  if (await tf.count()) {
    await tf.selectOption(timeframe).catch(() => {});
    await sleep(waitMs);
  }

  const nodesSel = toolbar.locator('#vector-nodes-select, select[data-testid="vector-nodes-select"]').first();
  await nodesSel.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
  if (await nodesSel.count()) {
    await nodesSel.selectOption(nodes).catch(() => {});
    await sleep(waitMs + 1500);
  }

  await page.locator(".vector-chart-canvas").first().waitFor({ state: "visible", timeout: 90_000 });

  await page
    .waitForFunction(
      () => {
        const body = document.body.innerText;
        return body.includes("POC") || body.includes("VWAP") || !!document.querySelector(".vector-chart-canvas");
      },
      { timeout: 120_000 },
    )
    .catch(() => {});

  await sleep(waitBeads ? 14_000 : 5000);

  // Session + ladder AFTER tf/nodes/beads settle — changing density resets fitContent() and
  // smears beads into horizontal rails if we frame the session too early.
  await page
    .locator('[data-testid="vector-intraday-zoom-session"], button:has-text("Session")')
    .first()
    .click({ force: true, timeout: 8000 })
    .catch(() => {});
  await sleep(2500);

  await page
    .locator('[data-testid="vector-gex-ladder-reset"]')
    .first()
    .click({ force: true, timeout: 5000 })
    .catch(() => {});
  await sleep(1500);

  if (useStructure) {
    await page
      .locator('[data-testid="vector-intraday-zoom-structure"]')
      .first()
      .click({ force: true, timeout: 5000 })
      .catch(() => {});
    await sleep(1500);
  }

  const chart = page.locator(".vector-chart-wrap").first();
  await chart.waitFor({ state: "visible", timeout: 25_000 });
  const box = await chart.boundingBox();
  if (!box || zoomSteps <= 0) {
    await page.mouse.move(4, 4);
    await sleep(400);
    return;
  }

  const cx = box.x + box.width * zoomAnchor;
  const cy = box.y + box.height * 0.5;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < zoomSteps; i += 1) {
    await page.mouse.wheel(0, -260);
    await sleep(450);
  }
  await sleep(3500);

  if (priceZoom) {
    const px = box.x + box.width * 0.985;
    const steps = Math.abs(Number(priceZoom));
    const expand = Number(priceZoom) < 0;
    for (let i = 0; i < steps; i += 1) {
      const from = box.y + box.height * (expand ? 0.15 : 0.35);
      const to = box.y + box.height * (expand ? 0.35 : 0.15);
      await page.mouse.move(px, from);
      await page.mouse.down();
      await page.mouse.move(px, to, { steps: 12 });
      await page.mouse.up();
      await sleep(700);
    }
    await sleep(2500);
  }

  // Park pointer off-chart so crosshair tooltips do not obscure the frame.
  await page.mouse.move(4, 4);
  await sleep(1200);
}

/** Wait until SPX desk matrix is populated (for /dashboard captures). */
export async function waitForSpxDeskReady(page) {
  await page.waitForSelector(".spx-sniper-desk", { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const table = document.querySelector(".spx-gex-matrix-table tbody");
      return table && table.querySelectorAll("tr").length >= 8;
    },
    { timeout: 120_000 },
  );
  await sleep(2000);
}
