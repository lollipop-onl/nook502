import { writeFileSync } from "node:fs";
import { join } from "node:path";

const distDir = "dist";
const ignored = ["_worker.js", "_routes.json"];

writeFileSync(join(distDir, ".assetsignore"), `${ignored.join("\n")}\n`);

console.log(`Wrote ${distDir}/.assetsignore (ignored: ${ignored.join(", ")})`);
