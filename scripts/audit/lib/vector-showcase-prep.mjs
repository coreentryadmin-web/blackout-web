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
