import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PermissionFlagsBits } from "discord.js";
import { MusicDatabase } from "../src/database/database.js";
import { authorizeMusicAction } from "../src/permissions/music-permissions.js";

const guildId = "12345678901234567";
const voiceId = "23456789012345678";
const textId = "34567890123456789";

function makeInteraction({ userId = "45678901234567890", voice = voiceId, admin = false, roles = [] } = {}) {
  return {
    inGuild: () => true,
    guildId,
    channelId: textId,
    user: { id: userId },
    memberPermissions: { has: (permission) => admin && permission === PermissionFlagsBits.Administrator },
    member: {
      voice: { channelId: voice },
      roles: { cache: { has: (roleId) => roles.includes(roleId) } },
    },
  };
}

function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "tanveer-permissions-"));
  const database = new MusicDatabase(path.join(directory, "music.sqlite"));
  const music = { getVoiceChannelId: () => voiceId };
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { database, music };
}

test("DJ-required actions reject ordinary listeners while safe controls remain usable", (t) => {
  const { database, music } = setup(t);
  const interaction = makeInteraction();
  const protectedResult = authorizeMusicAction(interaction, { database, music, action: "clear" });
  assert.equal(protectedResult.ok, false);
  assert.match(protectedResult.message, /DJ-only/);
  assert.equal(authorizeMusicAction(interaction, { database, music, action: "pause" }).ok, true);
});

test("administrators, configured DJ roles, controllers, and bot owners are recognized", (t) => {
  const { database, music } = setup(t);
  database.setGuildSettings(guildId, { djRoleId: "56789012345678901" });
  assert.equal(authorizeMusicAction(makeInteraction({ admin: true }), { database, music, action: "clear" }).ok, true);
  assert.equal(authorizeMusicAction(makeInteraction({ roles: ["56789012345678901"] }), { database, music, action: "clear" }).ok, true);
  database.addController(guildId, "45678901234567890", "admin");
  assert.equal(authorizeMusicAction(makeInteraction(), { database, music, action: "clear" }).ok, true);
  assert.equal(authorizeMusicAction(makeInteraction(), { database, music, ownerIds: ["45678901234567890"], action: "clear" }).ok, true);
});

test("voice and configured text/voice channel policies apply before actions", (t) => {
  const { database, music } = setup(t);
  assert.match(authorizeMusicAction(makeInteraction({ voice: null }), { database, music, action: "play" }).message, /Join a voice channel/);
  assert.match(authorizeMusicAction(makeInteraction({ voice: "99999999999999999" }), { database, music, action: "play" }).message, /where the bot is currently playing/);
  database.setGuildSettings(guildId, { allowedVoiceChannelIds: ["99999999999999999"] });
  assert.match(authorizeMusicAction(makeInteraction(), { database, music, action: "play" }).message, /not enabled/);
  database.setGuildSettings(guildId, { allowedVoiceChannelIds: [], allowedTextChannelIds: ["88888888888888888"] });
  assert.match(authorizeMusicAction(makeInteraction(), { database, music, action: "play" }).message, /music text channel/);
});

test("server settings remain isolated between guilds", (t) => {
  const { database, music } = setup(t);
  database.setGuildSettings(guildId, { djRoleId: "56789012345678901" });
  const otherGuild = "67890123456789012";
  const interaction = { ...makeInteraction({ roles: ["56789012345678901"] }), guildId: otherGuild };
  const result = authorizeMusicAction(interaction, { database, music, action: "clear" });
  assert.equal(result.ok, false);
});
