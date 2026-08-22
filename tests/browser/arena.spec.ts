import { expect, test } from "@playwright/test";

test("renders a replay-verified pre-Genesis game from the public API", async ({
  page,
  request,
}, testInfo) => {
  const publicApiUrl = testInfo.config.metadata.publicApiUrl;
  if (typeof publicApiUrl !== "string")
    throw new Error("Playwright public API URL metadata is absent");
  const projectionResponse = await request.get(
    `${publicApiUrl}/v1/public/games`,
  );
  expect(projectionResponse.ok()).toBe(true);
  const projection = (await projectionResponse.json()) as {
    canonical: boolean;
    items: { canonical?: unknown }[];
  };
  expect(projection.canonical).toBe(true);
  expect(projection.items.length).toBeGreaterThan(0);
  expect(projection.items.every(({ canonical }) => canonical === true)).toBe(
    true,
  );

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/arena");

  await expect(page).toHaveTitle("ABL · Pre-Genesis Arena");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".proof-strip")).toBeVisible();
  if (testInfo.config.metadata.localRehearsal === true) {
    expect(projectionResponse.headers()["x-abl-genesis-state"]).toBe(
      "REHEARSAL",
    );
    expect(projection.items).toHaveLength(1);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Basketball you can audit.",
      }),
    ).toBeVisible();
    await expect(page.locator(".canonical-stamp")).toContainText(
      "replay verified",
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "Six immutable segments" }),
    ).toBeVisible();
    await expect(page.locator(".players > li")).toHaveCount(10);
  }
  await expect(
    page.locator(
      "main button, main input, main select, main textarea, main form",
    ),
  ).toHaveCount(0);

  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(pageErrors).toEqual([]);
});
