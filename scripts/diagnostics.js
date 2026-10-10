import { loadConfig, nodeUrl, validateRequiredConfig } from "../src/config/env.js";
import { MusicDatabase } from "../src/database/database.js";
import { createLogger } from "../src/utils/logger.js";

const config = loadConfig();
const args = new Set(process.argv.slice(2));
const allowMissing = args.has("--allow-missing");
const configOnly = args.has("--config-only");
const checkCredentials = args.has("--check-credentials");
const logger = createLogger(config.logLevel);

function requireNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

function printErrors(errors) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
}

function configuredLavalinkNodes() {
  if (config.nodes.length > 0) {
    return config.nodes;
  }
  const password = process.env.LAVALINK_PASSWORD ?? "";
  if (!password) {
    return [];
  }
  return [];
}

async function checkDiscord() {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bot ${config.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Discord API returned HTTP ${response.status}; token/application configuration was not accepted.`);
  }
  const data = await response.json();
  return data.bot ? `valid bot login (${data.username ?? "bot"})` : "token does not identify a bot user";
}

async function checkLavalink(node) {
  const scheme = node.secure ? "https" : "http";
  const response = await fetch(`${scheme}://${nodeUrl(node)}/v4/info`, {
    headers: { Authorization: node.password, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Lavalink node '${node.name}' returned HTTP ${response.status}.`);
  }
  const data = await response.json();
  return {
    name: node.name,
    version: data.version?.semver ?? "unknown",
    sourceManagers: Array.isArray(data.sourceManagers) ? data.sourceManagers : [],
    filters: Array.isArray(data.filters) ? data.filters : [],
  };
}

async function main() {
  if (!requireNodeVersion()) {
    console.error(`Node.js ${process.versions.node} is too old; 22.13 or newer is required.`);
    process.exitCode = 1;
    return;
  }

  if (checkCredentials) {
    const structuralErrors = config.errors;
    if (structuralErrors.length > 0) {
      printErrors(structuralErrors);
      process.exitCode = 1;
      return;
    }
    if (config.token && config.clientId) {
      console.log("Discord command-registration credentials are configured (values not shown).");
      return;
    }
    console.log("Discord bot token or application ID is missing; command registration will be skipped.");
    process.exitCode = 2;
    return;
  }

  const requiredErrors = validateRequiredConfig(config, {
    discord: !allowMissing,
    lavalink: !allowMissing,
  });
  if (requiredErrors.length > 0) {
    console.error("Configuration validation failed:");
    printErrors(requiredErrors);
    process.exitCode = 1;
    return;
  }
  console.log(`Node.js ${process.versions.node}: supported.`);
  console.log(`Deployment mode: ${config.deployment}; command registration: ${config.commandRegistration}.`);
  console.log(`Discord credentials: ${config.token && config.clientId ? "configured (values hidden)" : "incomplete"}.`);
  console.log(`Lavalink nodes: ${config.nodes.length} configured.`);

  if (allowMissing && (!config.token || !config.clientId || config.nodes.length === 0)) {
    console.log("Installation can continue without credentials. Add the private Discord and Lavalink values to .env before starting the bot.");
  }
  if (configOnly) {
    console.log("Configuration syntax is valid. Network checks were not requested.");
    return;
  }

  let database;
  try {
    database = new MusicDatabase(config.databasePath);
    console.log(`SQLite storage: healthy (schema version ${database.getMigrationVersion()}).`);
  } catch (error) {
    console.error(`SQLite storage check failed: ${error?.message ?? "unknown error"}`);
    process.exitCode = 1;
    return;
  } finally {
    database?.close();
  }

  let failed = false;
  try {
    const discord = await checkDiscord();
    console.log(`Discord API: ${discord}.`);
  } catch (error) {
    console.error(`Discord check failed: ${error?.message ?? "unknown error"}`);
    failed = true;
  }

  const nodes = configuredLavalinkNodes();
  if (nodes.length === 0) {
    console.error("Lavalink check skipped: no authenticated node is configured.");
    failed = true;
  } else {
    for (const node of nodes) {
      try {
        const status = await checkLavalink(node);
        console.log(`Lavalink ${status.name}: v${status.version}; ${status.sourceManagers.length} source manager(s); ${status.filters.length} advertised filter(s).`);
      } catch (error) {
        logger.warn("Lavalink diagnostic failed", { node: node.name, error: error?.message });
        console.error(`Lavalink ${node.name} check failed: ${error?.message ?? "unknown error"}`);
        failed = true;
      }
    }
  }
  if (failed) {
    console.error("One or more live checks failed. The bot has not been started by this diagnostics command.");
    process.exitCode = 1;
  } else {
    console.log("Diagnostics completed successfully. No secrets were printed.");
  }
}

await main();
