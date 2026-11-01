// TEST: placement totals, grouped dialog and scope changes use synthetic data only.
const fs = require("fs"),
  assert = require("node:assert/strict"),
  path = require("path");
const web = path.resolve(__dirname, "../../../apps/web");
const es = require("module").createRequire(
  require.resolve(web + "/node_modules/vite/package.json"),
)("esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const script = es.buildSync({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ReceiptPlacementPanel,ReceiptPlacementBadge} from './src/components/warehouse/ReceiptPlacementPanel';const root=createRoot(document.getElementById('root'));window.mount=(token)=>root.render(<><ReceiptPlacementPanel token={token} warehouseId={token}/><ReceiptPlacementBadge token={token} warehouseId={token}/></>);window.mount('one');`,
      resolveDir: web,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    loader: { ".css": "empty" },
  }).outputFiles[0].text;
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    const page = await browser.newPage();
    let scope = "one";
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const p = new URL(route.request().url());
      if (p.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div>',
        });
      assert(p.pathname.endsWith("/placement-report"));
      scope = route.request().headers().authorization.slice(7);
      return route.fulfill({
        json: {
          enabled: true,
          summary: { pallets: 2, boxes: 5, awaiting: scope === "one" ? 2 : 0 },
          items:
            scope === "one" && !p.searchParams.get("summaryOnly")
              ? [
                  {
                    id: "a",
                    code: "BOX-1",
                    client: "Клиент",
                    clientId: "c",
                    receipt: "SERIES:2026:FFL_TEST0111",
                    receiptAt: "2026-11-01T09:00:00Z",
                  },
                  {
                    id: "b",
                    code: "BOX-2",
                    client: "Клиент",
                    clientId: "c",
                    receipt: null,
                    receiptAt: null,
                  },
                ]
              : [],
          nextCursor: null,
        },
      });
    });
    await page.goto("https://fixture.test");
    await page.addScriptTag({ content: script });
    await page.addStyleTag({
      path: web + "/src/components/warehouse/receipt-placement.css",
    });
    await page.getByLabel("Ожидают размещения: 2", { exact: true }).waitFor();
    await page.getByRole("button", { name: "2 Ожидают размещения" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Ожидают размещения",
      exact: true,
    });
    await dialog
      .getByRole("heading", { name: "FFL_TEST0111", exact: true })
      .waitFor();
    await dialog.getByText("BOX-1", { exact: true }).waitFor();
    await dialog
      .getByRole("heading", { name: "Приёмка не определена", exact: true })
      .waitFor();
    await dialog.getByText("BOX-2", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await page.evaluate(() => window.mount("two"));
    await page.getByRole("button", { name: "0 Ожидают размещения" }).waitFor();
    assert.equal(
      await page.getByLabel("Ожидают размещения: 2", { exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS summary, receipt groups, unassigned receipt, native modal and scope reset",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
