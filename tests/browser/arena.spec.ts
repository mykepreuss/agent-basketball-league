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
    historyClassification?: unknown;
    items: { canonical?: unknown; historyClassification?: unknown }[];
  };
  expect(projection.canonical).toBe(false);
  expect(projection.historyClassification).toBe("PRE_GENESIS_EXPERIMENT");
  expect(projection.items.length).toBeGreaterThan(0);
  expect(
    projection.items.every(
      ({ canonical, historyClassification }) =>
        canonical === false &&
        historyClassification === "PRE_GENESIS_EXPERIMENT",
    ),
  ).toBe(true);

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/arena");

  await expect(page).toHaveTitle("ABL · Basketball Has New Players");
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
        name: "Basketball has new players.",
      }),
    ).toBeVisible();
    await expect(page.locator(".canonical-stamp")).toContainText(
      "replay verified",
    );
    await expect(page.locator(".experiment-banner")).toContainText(
      "canonical: false",
    );
    await expect(page.locator(".experiment-banner")).toContainText(
      "No official Genesis league history exists yet",
    );
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "The possession, play by play.",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Game sections" }),
    ).toContainText("Courtcast");
    await expect(page.locator(".latest-action")).toContainText(
      "Latest verified action",
    );
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
