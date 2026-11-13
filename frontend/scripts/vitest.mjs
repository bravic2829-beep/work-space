// Runs Vitest with the canonical (real-case) path of the project.
// On Windows the same folder can be reached as "d:\..." or "D:\..." (terminals differ).
// If the two spellings get mixed, Vitest loads each module twice and every test fails with
// "failed to find the current suite". Re-launching from the canonical path avoids that.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync.native(join(dirname(fileURLToPath(import.meta.url)), ".."));
const vitestBin = join(root, "node_modules", "vitest", "vitest.mjs");

const result = spawnSync(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
