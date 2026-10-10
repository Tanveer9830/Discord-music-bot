import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/env.js";
import { MusicDatabase } from "../src/database/database.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig();

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: allowFailure ? "pipe" : "inherit" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args[0]} failed with exit code ${result.status}.`);
  }
  return result;
}

function command(binary, args, { allowFailure = false } = {}) {
  const result = spawnSync(binary, args, { cwd: root, stdio: "inherit" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${binary} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
  return result;
}

function currentSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

async function backupDatabase() {
  await mkdir(path.join(root, "backups"), { recursive: true, mode: 0o700 });
  const filename = `music-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
  const destination = path.join(root, "backups", filename);
  const database = new MusicDatabase(config.databasePath);
  try {
    database.db.pragma("wal_checkpoint(FULL)");
    await database.db.backup(destination);
  } finally {
    database.close();
  }
  await chmod(destination, 0o600).catch(() => {});
  return destination;
}

async function restartIfManaged() {
  const mode = String(process.env.UPDATE_PROCESS_MANAGER ?? config.deployment).toLowerCase();
  if (mode === "pm2") {
    const result = command("pm2", ["reload", "ecosystem.config.cjs", "--update-env"], { allowFailure: true });
    if (result.status !== 0) {
      console.error("Update succeeded, but PM2 did not restart the bot. Run `pm2 restart tanveer-prime-music --update-env` and inspect `pm2 logs tanveer-prime-music`.");
      return false;
    }
    return true;
  }
  if (mode === "systemd") {
    const result = command("systemctl", ["--user", "restart", "tanveer-prime-music.service"], { allowFailure: true });
    if (result.status !== 0) {
      console.error("Update succeeded, but the user systemd service did not restart. Run `systemctl --user restart tanveer-prime-music.service`.");
      return false;
    }
    return true;
  }
  if (mode === "docker") {
    const result = command("docker", ["compose", "up", "-d", "--build"], { allowFailure: true });
    if (result.status !== 0) {
      console.error("Update succeeded, but Docker Compose did not rebuild/restart. Run `docker compose up -d --build` from the project directory.");
      return false;
    }
    return true;
  }
  if (mode === "pterodactyl") {
    console.log("Pterodactyl controls the container lifecycle. Stop and start/restart this server in the panel after the update.");
    return false;
  }
  console.log("No managed process restart was requested. Restart the foreground `npm start` process when ready.");
  return false;
}

async function main() {
  const branch = process.env.UPDATE_BRANCH || execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();
  if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) {
    throw new Error("Could not determine a safe current Git branch name.");
  }
  const origin = git(["remote", "get-url", "origin"], { allowFailure: true });
  const trustedOrigins = new Set([
    "https://github.com/Tanveer9830/Discord-music-bot",
    "https://github.com/Tanveer9830/Discord-music-bot.git",
  ]);
  if (origin.status !== 0 || !trustedOrigins.has(origin.stdout.trim())) {
    throw new Error("Update stopped because origin is not the trusted TANVEER PRIME MUSIC repository.");
  }
  const status = git(["status", "--porcelain", "--untracked-files=all"], { allowFailure: true });
  if (status.status !== 0) {
    throw new Error("This directory is not a Git checkout.");
  }
  if (status.stdout.trim()) {
    throw new Error("Update stopped because local source changes are present. Commit or back them up before updating; .env and data directories are ignored and preserved.");
  }

  const oldSha = currentSha();
  console.log(`Checking trusted origin branch '${branch}' (current revision ${oldSha.slice(0, 12)}).`);
  git(["fetch", "--no-tags", "origin", branch]);
  const fetchResult = git(["rev-parse", "FETCH_HEAD"], { allowFailure: true });
  if (fetchResult.status !== 0) {
    throw new Error(`Remote branch '${branch}' was not found.`);
  }
  const remoteSha = fetchResult.stdout.trim();
  if (remoteSha === oldSha) {
    console.log("Already up to date. No files or data were changed.");
    return;
  }
  const ancestor = git(["merge-base", "--is-ancestor", oldSha, remoteSha], { allowFailure: true });
  if (ancestor.status !== 0) {
    throw new Error("Remote update is not a fast-forward. No local files were changed; resolve branch history manually.");
  }

  const backupPath = await backupDatabase();
  console.log(`SQLite backup created at ${backupPath}.`);
  let merged = false;
  try {
    git(["merge", "--ff-only", "--no-edit", "FETCH_HEAD"]);
    merged = true;
    command("npm", ["ci"]);
    command("node", ["scripts/check.js"]);
    command("npm", ["run", "lint"]);
    command("npm", ["test"]);
    command("npm", ["run", "db:init"]);
    if (config.environment === "production") {
      command("npm", ["prune", "--omit=dev"]);
    }
  } catch (error) {
    if (merged) {
      console.error("Update checks failed; attempting a fast, local rollback to the previous code revision. Configuration and data stay in place.");
      git(["reset", "--hard", oldSha]);
      command("npm", ["ci"] , { allowFailure: true });
    }
    throw error;
  }

  const restarted = await restartIfManaged();
  console.log(`Update completed. Database backup: ${backupPath}.`);
  if (restarted) {
    console.log("The configured process manager restarted the application after all checks passed.");
  }
}

try {
  await main();
} catch (error) {
  console.error(`Safe update stopped: ${error?.message ?? "unknown error"}`);
  process.exitCode = 1;
}
