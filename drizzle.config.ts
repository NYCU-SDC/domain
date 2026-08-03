import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./app/lib/server/db/schema.server.ts",
  strict: true,
  verbose: true,
});
