import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, nodeUrl, parseBoolean, validateRequiredConfig } from "../src/config/env.js";

const applicationId = "123456789012345678";
const guildId = "223456789012345678";

test("configuration accepts a valid existing Lavalink v4 node without exposing secrets", () => {
  const password = "private-lavalink-password";
  const token = "private-discord-token";
  const config = loadConfig({
    DISCORD_TOKEN: token,
    DISCORD_CLIENT_ID: applicationId,
    DEV_GUILD_ID: guildId,
    LAVALINK_NODES: JSON.stringify([{ name: "primary", host: "lavalink.internal", port: 2443, password, secure: true }]),
    DEPLOYMENT_MODE: "docker",
    COMMAND_REGISTRATION: "on-startup",
    DATABASE_PATH: "./data/test.sqlite",
  });
  assert.deepEqual(config.errors, []);
  assert.equal(config.token, token);
  assert.equal(config.nodes[0].password, password);
  assert.equal(config.nodes[0].secure, true);
  assert.deepEqual(validateRequiredConfig(config), []);
  assert.equal(nodeUrl({ host: "2001:db8::1", port: 2333 }), "[2001:db8::1]:2333");
});

test("configuration rejects malformed nodes and missing startup credentials clearly", () => {
  const malformed = loadConfig({ LAVALINK_NODES: "not-json" });
  assert.ok(malformed.errors.some((message) => message.includes("LAVALINK_NODES must contain a JSON array")));
  assert.ok(validateRequiredConfig(malformed).some((message) => message.includes("DISCORD_TOKEN is required")));
  assert.ok(validateRequiredConfig(malformed).some((message) => message.includes("LAVALINK_PASSWORD")));
});

test("boolean parsing accepts common forms and rejects ambiguous values", () => {
  assert.equal(parseBoolean("YES"), true);
  assert.equal(parseBoolean("off", true), false);
  assert.equal(parseBoolean("", true), true);
  assert.throws(() => parseBoolean("sometimes"), /Expected a boolean value/);
});
