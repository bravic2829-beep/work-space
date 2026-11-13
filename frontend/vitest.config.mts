import react from "@vitejs/plugin-react";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// realpathSync.native returns the canonical path. On Windows the drive letter may be "d:" or
// "D:" depending on the terminal; a mismatch makes Vitest load every module twice and fail
// with "failed to find the current suite".
const root = realpathSync.native(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: { "@": `${root}${root.endsWith("\\") || root.endsWith("/") ? "" : "/"}src` },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
