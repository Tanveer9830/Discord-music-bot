import { readFile, writeFile, chmod, lstat, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const nonInteractive = process.argv.includes("--non-interactive") || process.env.CI === "true";
const windows = process.platform === "win32";

async function readExisting() {
  try {
    return await readFile(envPath, "utf8");
  } catch {
    return "";
  }
}

function parseEnv(contents) {
  return new Map(Object.entries(dotenv.parse(contents)));
}

function quoteEnv(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

async function terminalLine(label, { secret = false, defaultValue = "" } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    return defaultValue;
  }
  process.stdout.write(`${label}${defaultValue && !secret ? ` [${defaultValue}]` : ""}: `);
  const decoder = new StringDecoder("utf8");
  const input = process.stdin;
  const output = process.stdout;
  const originalRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error = null) => {
      input.off("data", onData);
      input.setRawMode(Boolean(originalRaw));
      output.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(value || defaultValue);
      }
    };
    const onData = (chunk) => {
      const text = decoder.write(chunk);
      for (const character of text) {
        const code = character.charCodeAt(0);
        if (code === 3) {
          finish(new Error("Setup cancelled with Ctrl+C."));
          return;
        }
        if (code === 4) {
          finish();
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }
        if (code >= 32) {
          value += character;
          output.write(secret ? "*" : character);
        }
      }
    };
    input.on("data", onData);
  });
}

async function main() {
  const envStat = await lstat(envPath).catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (envStat && (!envStat.isFile() || envStat.isSymbolicLink())) {
    throw new Error("Refusing to read or overwrite .env because it is not a regular file.");
  }
  const contents = await readExisting();
  const values = parseEnv(contents);
  if (!contents) {
    console.error(".env does not exist. Copy .env.example to .env before running setup.");
    process.exitCode = 1;
    return;
  }
  if (nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("No interactive terminal is available; left .env unchanged. Edit the private .env file to add credentials.");
    return;
  }

  const prompts = [
    ["DISCORD_TOKEN", "Discord bot token", { secret: true }],
    ["DISCORD_CLIENT_ID", "Discord application/client ID", {}],
    ["DEV_GUILD_ID", "Development guild ID (optional; blank for global commands)", {}],
    ["LAVALINK_HOST", "Existing Lavalink host (localhost is this runtime/container)", { defaultValue: values.get("LAVALINK_HOST") || "127.0.0.1" }],
    ["LAVALINK_PORT", "Lavalink port", { defaultValue: values.get("LAVALINK_PORT") || "2333" }],
    ["LAVALINK_PASSWORD", "Existing Lavalink password", { secret: true }],
    ["LAVALINK_TLS", "Use TLS for Lavalink? (true/false)", { defaultValue: values.get("LAVALINK_TLS") || "false" }],
    ["LAVALINK_NODE_NAME", "Lavalink node name", { defaultValue: values.get("LAVALINK_NODE_NAME") || "primary" }],
    ["LAVALINK_SEARCH_PREFIX", "Default Lavalink search prefix", { defaultValue: values.get("LAVALINK_SEARCH_PREFIX") || "ytsearch" }],
    ["DATABASE_PATH", "SQLite database path", { defaultValue: values.get("DATABASE_PATH") || "./data/music.sqlite" }],
    ["DEPLOYMENT_MODE", "Deployment mode (node/pm2/docker/pterodactyl)", { defaultValue: values.get("DEPLOYMENT_MODE") || "node" }],
    ["COMMAND_REGISTRATION", "Command registration (manual/on-startup)", { defaultValue: values.get("COMMAND_REGISTRATION") || "manual" }],
  ];

  console.log("\nTANVEER PRIME MUSIC first-run setup. Secret fields are masked and written only to .env.\n");
  const updates = new Map();
  for (const [key, label, options] of prompts) {
    const existing = values.get(key) ?? "";
    if (options.secret && existing) {
      continue;
    }
    const promptOptions = { ...options, defaultValue: options.defaultValue ?? existing };
    if (key === "DEPLOYMENT_MODE" && (process.env.P_SERVER_UUID || process.env.PTERODACTYL || process.cwd() === "/home/container")) {
      promptOptions.defaultValue = "pterodactyl";
    }
    const answer = await terminalLine(label, promptOptions);
    if (answer !== "" && answer !== existing) {
      updates.set(key, answer);
    }
  }

  let next = contents;
  for (const [key, value] of updates) {
    const line = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, "m");
    if (line.test(next)) {
      next = next.replace(line, `${key}=${quoteEnv(value)}`);
    } else {
      next = `${next.trimEnd()}\n${key}=${quoteEnv(value)}\n`;
    }
  }
  if (windows) {
    await writeFile(envPath, next, { mode: 0o600 });
    await chmod(envPath, 0o600).catch(() => {});
  } else {
    const tempPath = path.join(root, `.env.setup-${process.pid}-${randomBytes(5).toString("hex")}.tmp`);
    try {
      await writeFile(tempPath, next, { mode: 0o600, flag: "wx" });
      await chmod(tempPath, 0o600).catch(() => {});
      await rename(tempPath, envPath);
      await chmod(envPath, 0o600).catch(() => {});
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  }
  console.log(`Saved ${updates.size} non-empty configuration value(s) to ${envPath}; credentials were not echoed.`);
  console.log("Next: verify your bot invite permissions and ensure this runtime can reach your existing Lavalink server.");
}

try {
  await main();
} catch (error) {
  if (!windows && process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // TTY may already have been restored.
    }
  }
  console.error(`Setup failed: ${error?.message ?? "unknown error"}`);
  process.exitCode = 1;
}
