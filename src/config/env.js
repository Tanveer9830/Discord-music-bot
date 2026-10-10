import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const truthy = new Set(["1", "true", "yes", "on"]);
const falsy = new Set(["0", "false", "no", "off"]);

export function parseBoolean(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (truthy.has(normalized)) {
    return true;
  }
  if (falsy.has(normalized)) {
    return false;
  }
  throw new Error(`Expected a boolean value, received ${normalized}.`);
}

function parseInteger(value, fallback, label, min, max) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function normalizeNode(node, index) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error(`LAVALINK_NODES item ${index + 1} must be an object.`);
  }
  const name = String(node.name ?? `node-${index + 1}`).trim();
  const host = String(node.host ?? "").trim();
  const password = String(node.password ?? "");
  const port = Number(node.port ?? 2333);
  const secure = typeof node.secure === "boolean" ? node.secure : parseBoolean(node.secure, false);
  if (!name || name.length > 64) {
    throw new Error(`LAVALINK_NODES item ${index + 1} has an invalid name.`);
  }
  if (!host || /\s|:\/\//.test(host)) {
    throw new Error(`LAVALINK_NODES item ${index + 1} host must be a hostname or IP without a URL scheme.`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`LAVALINK_NODES item ${index + 1} port must be between 1 and 65535.`);
  }
  if (!password) {
    throw new Error(`LAVALINK_NODES item ${index + 1} is missing its password.`);
  }
  return { name, host, port, password, secure, group: node.group ? String(node.group) : undefined };
}

export function loadConfig(env = process.env) {
  const errors = [];
  let nodes = [];
  try {
    if (env.LAVALINK_NODES?.trim()) {
      let parsed;
      try {
        parsed = JSON.parse(env.LAVALINK_NODES);
      } catch {
        throw new Error("LAVALINK_NODES must contain a JSON array.");
      }
      if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 10) {
        throw new Error("LAVALINK_NODES must be a non-empty JSON array with at most 10 nodes.");
      }
      nodes = parsed.map(normalizeNode);
      if (new Set(nodes.map((node) => node.name)).size !== nodes.length) {
        throw new Error("LAVALINK_NODES node names must be unique.");
      }
    } else {
      const host = String(env.LAVALINK_HOST ?? "127.0.0.1").trim();
      const port = parseInteger(env.LAVALINK_PORT, 2333, "LAVALINK_PORT", 1, 65535);
      const password = String(env.LAVALINK_PASSWORD ?? "");
      const secure = parseBoolean(env.LAVALINK_TLS, false);
      const name = String(env.LAVALINK_NODE_NAME ?? "primary").trim();
      if (!host || /\s|:\/\//.test(host)) {
        throw new Error("LAVALINK_HOST must be a hostname or IP without a URL scheme.");
      }
      if (!name || name.length > 64) {
        throw new Error("LAVALINK_NODE_NAME must contain 1 to 64 characters.");
      }
      if (password) {
        nodes = [{ name, host, port, password, secure }];
      }
    }
  } catch (error) {
    errors.push(error.message);
  }

  const commandRegistration = String(env.COMMAND_REGISTRATION ?? "manual").toLowerCase();
  if (!["manual", "on-startup"].includes(commandRegistration)) {
    errors.push("COMMAND_REGISTRATION must be 'manual' or 'on-startup'.");
  }
  const deployment = String(env.DEPLOYMENT_MODE ?? "node").toLowerCase();
  if (!["node", "pm2", "docker", "pterodactyl", "systemd"].includes(deployment)) {
    errors.push("DEPLOYMENT_MODE must be node, pm2, docker, pterodactyl, or systemd.");
  }
  const commandPrefix = String(env.LAVALINK_SEARCH_PREFIX ?? "ytsearch").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(commandPrefix)) {
    errors.push("LAVALINK_SEARCH_PREFIX must be a simple Lavalink source prefix such as ytsearch or scsearch.");
  }
  const defaultVolume = parseIntegerSafe(env.DEFAULT_VOLUME, 75, "DEFAULT_VOLUME", 0, 1000, errors);
  const maxVolume = parseIntegerSafe(env.MAX_VOLUME, 150, "MAX_VOLUME", 1, 1000, errors);
  if (defaultVolume > maxVolume) {
    errors.push("DEFAULT_VOLUME cannot exceed MAX_VOLUME.");
  }
  const maxQueueSize = parseIntegerSafe(env.MAX_QUEUE_SIZE, 250, "MAX_QUEUE_SIZE", 1, 1000, errors);
  const idleDisconnectSeconds = parseIntegerSafe(env.IDLE_DISCONNECT_SECONDS, 180, "IDLE_DISCONNECT_SECONDS", 0, 86400, errors);
  const ownerIds = String(env.BOT_OWNER_ID ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (ownerIds.some((id) => !/^\d{15,22}$/.test(id))) {
    errors.push("BOT_OWNER_ID must contain Discord user ID snowflakes, comma-separated if needed.");
  }
  const token = String(env.DISCORD_TOKEN ?? "").trim();
  const clientId = String(env.DISCORD_CLIENT_ID ?? "").trim();
  const devGuildId = String(env.DEV_GUILD_ID ?? "").trim();
  if (clientId && !/^\d{15,22}$/.test(clientId)) {
    errors.push("DISCORD_CLIENT_ID must be a Discord application ID.");
  }
  if (devGuildId && !/^\d{15,22}$/.test(devGuildId)) {
    errors.push("DEV_GUILD_ID must be a Discord guild ID.");
  }

  return {
    errors,
    token,
    clientId,
    devGuildId,
    ownerIds,
    nodes,
    searchPrefix: commandPrefix,
    databasePath: path.resolve(env.DATABASE_PATH || "./data/music.sqlite"),
    environment: String(env.NODE_ENV ?? "production"),
    deployment,
    commandRegistration,
    defaultVolume,
    maxVolume,
    maxQueueSize,
    idleDisconnectSeconds,
    logLevel: String(env.LOG_LEVEL ?? "info").toLowerCase(),
  };
}

function parseIntegerSafe(value, fallback, label, min, max, errors) {
  try {
    return parseInteger(value, fallback, label, min, max);
  } catch (error) {
    errors.push(error.message);
    return fallback;
  }
}

export function validateRequiredConfig(config, { discord = true, lavalink = true } = {}) {
  const errors = [...config.errors];
  if (discord) {
    if (!config.token) {
      errors.push("DISCORD_TOKEN is required. Run `npm run setup` to configure it locally.");
    }
    if (!config.clientId) {
      errors.push("DISCORD_CLIENT_ID is required. Set it in the private .env file.");
    }
  }
  if (lavalink && config.nodes.length === 0) {
    errors.push("LAVALINK_PASSWORD or a valid LAVALINK_NODES entry is required. Configure your existing Lavalink v4 server in .env.");
  }
  return [...new Set(errors)];
}

export function nodeUrl(node) {
  const host = node.host.includes(":") && !node.host.startsWith("[") ? `[${node.host}]` : node.host;
  return `${host}:${node.port}`;
}
