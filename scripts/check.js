import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folders = ["src", "scripts", "tests"];
const files = [];

async function collect(folder) {
  let entries;
  try {
    entries = await readdir(path.join(root, folder), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      await collect(file);
    } else if (entry.isFile() && (file.endsWith(".js") || file.endsWith(".cjs"))) {
      files.push(file);
    }
  }
}

for (const folder of folders) {
  await collect(folder);
}
files.push("eslint.config.js");
files.push("ecosystem.config.cjs");
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    failed = true;
  }
}
if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${files.length} JavaScript files.`);
}
