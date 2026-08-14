import { defineConfig, devices } from "@playwright/test";

const localArenaUrl = "http://127.0.0.1:34173";
const localPublicApiUrl = "http://127.0.0.1:34172";
const externalArenaUrl = process.env.ABL_BROWSER_BASE_URL;
const externalPublicApiUrl = process.env.ABL_BROWSER_PUBLIC_API_URL;
if ((externalArenaUrl === undefined) !== (externalPublicApiUrl === undefined))
  throw new Error(
    "ABL_BROWSER_BASE_URL and ABL_BROWSER_PUBLIC_API_URL must be set together",
  );
const arenaUrl = externalArenaUrl ?? localArenaUrl;
const publicApiUrl = externalPublicApiUrl ?? localPublicApiUrl;
const useLocalServers = externalArenaUrl === undefined;

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  forbidOnly: true,
  retries: process.env.CI === undefined ? 0 : 1,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: arenaUrl,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  ...(useLocalServers
    ? {
        webServer: [
          {
            command: "pnpm browser:api",
            env: {
              ...process.env,
              HOST: "127.0.0.1",
              PORT: "34172",
            },
            name: "public-api",
            url: localPublicApiUrl,
            reuseExistingServer: false,
            timeout: 120_000,
            gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
          },
          {
            command: "pnpm browser:arena",
            env: {
              ...process.env,
              ABL_PUBLIC_API_URL: localPublicApiUrl,
            },
            name: "arena",
            url: localArenaUrl,
            reuseExistingServer: false,
            timeout: 120_000,
            gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
          },
        ],
      }
    : {}),
  metadata: { localRehearsal: useLocalServers, publicApiUrl },
});
