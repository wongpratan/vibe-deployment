import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "development",
      OPENAI_BASE_URL: "http://localhost:1234/v1",
      OPENAI_API_KEY: "test",
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      JWT_SECRET: "test-secret-at-least-16-chars",
      COOLIFY_APPS_DOMAIN: "apps.test.example",
    },
  },
});
