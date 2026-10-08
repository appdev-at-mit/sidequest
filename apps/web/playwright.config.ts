import { defineConfig, devices } from "@playwright/test";
const database = `sidequest_e2e_${Date.now()}_dev`;
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://localhost:5174", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: "npm run db:seed -w ../server && npm run dev -w ../server",
      url: "http://localhost:4001/api/v1/health",
      env: {
        DATABASE_URL: `mongodb://127.0.0.1:27017/${database}?replicaSet=rs0`,
        PORT: "4001",
        CLIENT_ORIGIN: "http://localhost:5174",
        AUTH_MODE: "development",
        NODE_ENV: "development",
      },
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5174",
      url: "http://localhost:5174",
      env: { API_PROXY_TARGET: "http://localhost:4001" },
      reuseExistingServer: false,
    },
  ],
});
