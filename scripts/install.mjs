import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

if (!existsSync(".env")) {
  console.error("Missing .env. Copy .env.example and set OBSIDIAN_PLUGIN_DIR.");
  process.exit(1);
}
process.loadEnvFile(".env");

const target = process.env.OBSIDIAN_PLUGIN_DIR;
if (!target || target.startsWith("/path/to/")) {
  console.error("Set OBSIDIAN_PLUGIN_DIR in .env.");
  process.exit(1);
}
if (basename(target) !== "tk-comments") {
  console.error("OBSIDIAN_PLUGIN_DIR must end in the plugin id, tk-comments.");
  process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  copyFileSync(file, join(target, file));
}
console.log("Installed main.js, manifest.json, styles.css.");
