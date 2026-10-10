import test from "node:test";
import assert from "node:assert/strict";
import { BRANDING, BRAND_FOOTER, buildStartupBanner, createBrandEmbed } from "../src/config/branding.js";
import { commandDefinitions } from "../src/commands/definitions.js";
import { Routes } from "discord.js";
import { commandRegistrationRoute } from "../src/client.js";

test("startup banner includes all canonical identity values and aligned frame", () => {
  const banner = buildStartupBanner({ version: "1.0.0", startedAt: new Date("2026-10-10T00:00:00.000Z"), environment: "test", deployment: "node" });
  const lines = banner.split("\n");
  assert.match(banner, /TANVEER PRIME MUSIC/);
  assert.match(banner, /Made by Tanveer/);
  assert.match(banner, /Discord: Tanveer5637/);
  assert.match(banner, /Version: 1\.0\.0/);
  assert.match(banner, /Discord: initializing \| Lavalink: initializing/);
  assert.equal(lines[0][0], "╔");
  assert.equal(lines[0].length, lines[lines.findIndex((line) => line.startsWith("╚"))].length);
  assert.equal(BRANDING.footer, BRAND_FOOTER);
  assert.equal(createBrandEmbed({ description: "Music" }).data.footer.text, "Made by Tanveer • Discord: Tanveer5637");
});

test("registered slash commands serialize uniquely with executable music command coverage", () => {
  const names = commandDefinitions.map((command) => command.name);
  assert.equal(new Set(names).size, names.length);
  for (const command of commandDefinitions) {
    assert.ok(command.description.length <= 100);
    assert.ok(command.name.length <= 32);
    assert.ok(command.options.length <= 25);
  }
  for (const name of ["play", "queue", "playlist", "musicsettings", "health", "247", "panel"]) {
    assert.ok(names.includes(name), `missing /${name}`);
  }
  assert.ok(commandDefinitions.find((command) => command.name === "playlist").options.length >= 10);
});

test("command registration selects global or configured development-guild scope", () => {
  assert.equal(commandRegistrationRoute({ clientId: "123456789012345678", devGuildId: null }), Routes.applicationCommands("123456789012345678"));
  assert.equal(commandRegistrationRoute({ clientId: "123456789012345678", devGuildId: "987654321098765432" }), Routes.applicationGuildCommands("123456789012345678", "987654321098765432"));
});
