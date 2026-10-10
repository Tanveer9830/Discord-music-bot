import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MusicDatabase } from "../src/database/database.js";
import { MusicManager } from "../src/music/music-manager.js";

const guildA = "12345678901234567";
const guildB = "22345678901234567";
const voiceA = "32345678901234567";
const voiceB = "42345678901234567";
const userId = "52345678901234567";

function track(id) {
  return {
    encoded: `encoded-${id}`,
    info: {
      identifier: String(id),
      isSeekable: true,
      author: `Artist ${id}`,
      length: 240000,
      isStream: false,
      position: 0,
      title: `Song ${id}`,
      uri: `https://www.youtube.com/watch?v=${id}`,
      sourceName: "youtube",
    },
  };
}

class FakePlayer extends EventEmitter {
  constructor(guildId, node) {
    super();
    this.guildId = guildId;
    this.node = node;
    this.track = null;
    this.volume = 75;
    this.paused = false;
    this.position = 0;
    this.filters = {};
  }

  async playTrack(options) {
    this.track = options.track.encoded;
    this.position = 0;
    return this;
  }

  async stopTrack() {
    this.track = null;
    this.emit("end", { reason: "stopped" });
  }

  async setPaused(paused) { this.paused = paused; }
  async seekTo(position) { this.position = position; }
  async setGlobalVolume(volume) { this.volume = volume; }
  async setFilters(filters) { this.filters = filters; }
  async clearFilters() { this.filters = {}; }
  async destroy() {}
  clean() {}
}

class FakeShoukaku extends EventEmitter {
  constructor({ connected = true } = {}) {
    super();
    this.nodes = new Map();
    this.players = new Map();
    this.connections = new Map();
    if (connected) {
      this.node = {
        name: "test-node",
        state: 1,
        info: { version: { semver: "4.0.0" }, filters: ["equalizer", "karaoke", "timescale", "rotation", "lowPass", "distortion", "channelMix"] },
        stats: { players: 0, playingPlayers: 0, uptime: 1000 },
        rest: {
          resolve: async (identifier) => ({ loadType: "track", data: track(identifier.split(":").at(-1)) }),
        },
      };
      this.nodes.set(this.node.name, this.node);
    }
  }

  getIdealNode() {
    return [...this.nodes.values()].find((node) => node.state === 1);
  }

  async joinVoiceChannel({ guildId, channelId }) {
    if (!this.getIdealNode()) {
      throw new Error("unavailable");
    }
    const player = new FakePlayer(guildId, this.node);
    this.players.set(guildId, player);
    this.connections.set(guildId, { channelId });
    return player;
  }

  async leaveVoiceChannel(guildId) {
    this.players.delete(guildId);
    this.connections.delete(guildId);
  }
}

function makeClient() {
  const guilds = new Map([
    [guildA, { id: guildA, shardId: 0, channels: { cache: new Map() }, members: { me: { voice: { channelId: null } } } }],
    [guildB, { id: guildB, shardId: 0, channels: { cache: new Map() }, members: { me: { voice: { channelId: null } } } }],
  ]);
  const voice = (id) => ({ id, members: new Map() });
  return {
    user: { id: "62345678901234567" },
    guilds: { cache: guilds },
    channels: { cache: new Map([[voiceA, voice(voiceA)], [voiceB, voice(voiceB)]]) },
  };
}

function setup(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "tanveer-music-manager-"));
  const database = new MusicDatabase(path.join(directory, "music.sqlite"));
  const client = makeClient();
  const shoukaku = new FakeShoukaku(options);
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const manager = new MusicManager({
    client,
    shoukaku,
    database,
    config: { searchPrefix: "ytsearch" },
    logger,
  });
  t.after(async () => {
    await manager.shutdown({ preserveLavalinkPlayers: false });
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { manager, database, client, shoukaku, directory };
}

test("Lavalink search and per-guild queue mutations remain serialized", async (t) => {
  const { manager } = setup(t);
  const loaded = await manager.resolve("Song one");
  assert.equal(loaded.tracks[0].info.title, "Song Song one");

  await manager.play(guildA, voiceA, track("one"), { requester: { id: userId, tag: "User" } });
  await Promise.all([
    manager.play(guildA, voiceA, [track("two"), track("three")]),
    manager.play(guildA, voiceA, track("four")),
  ]);
  await manager.play(guildB, voiceB, track("other"));

  assert.equal(manager.getState(guildA).current.info.identifier, "one");
  assert.deepEqual(manager.getState(guildA).queue.items.map((item) => item.info.identifier), ["two", "three", "four"]);
  assert.equal(manager.getState(guildB).current.info.identifier, "other");
  const skipped = await manager.skip(guildA);
  assert.equal(skipped.track.info.identifier, "two");
  const jumped = await manager.skipTo(guildA, 2);
  assert.equal(jumped.info.identifier, "four");
  assert.deepEqual(manager.getState(guildA).queue.items, []);
});

test("queue mutations invalidate stale panel controls and keep shuffle status snapshot-backed", async (t) => {
  const { manager } = setup(t);
  await manager.play(guildA, voiceA, [track("one"), track("two"), track("three")]);
  const state = manager.getState(guildA);
  const initialToken = state.componentToken;
  assert.equal(state.queue.isShuffled, false);
  assert.equal(await manager.shuffleQueue(guildA), true);
  assert.equal(state.queue.isShuffled, true);
  assert.notEqual(state.componentToken, initialToken);
  const shuffledToken = state.componentToken;
  assert.equal(await manager.unshuffleQueue(guildA), true);
  assert.equal(state.queue.isShuffled, false);
  assert.notEqual(state.componentToken, shuffledToken);
  assert.deepEqual(state.queue.items.map((item) => item.info.identifier), ["two", "three"]);
});

test("natural Lavalink track-end events advance exactly once and stop does not restart the queue", async (t) => {
  const { manager } = setup(t);
  await manager.play(guildA, voiceA, [track("one"), track("two")], { requester: { id: userId, tag: "User" } });
  const player = manager.getState(guildA).player;
  player.emit("end", { reason: "finished" });
  await new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
  assert.equal(manager.getState(guildA).current.info.identifier, "two");
  assert.equal(manager.getState(guildA).queue.length, 0);

  await manager.stop(guildA);
  assert.equal(manager.getState(guildA).current, null);
  assert.equal(manager.getState(guildA).queue.length, 0);
});

test("play-skip queue-limit failures leave the existing current track and queue untouched", async (t) => {
  const { manager, database } = setup(t);
  database.setGuildSettings(guildA, { maxQueueSize: 2 });
  await manager.play(guildA, voiceA, track("current"));
  await manager.play(guildA, voiceA, track("queued"));
  await assert.rejects(manager.play(guildA, voiceA, track("new"), { mode: "skip" }), /Queue limit reached/);
  assert.equal(manager.getState(guildA).current.info.identifier, "current");
  assert.deepEqual(manager.getState(guildA).queue.items.map((item) => item.info.identifier), ["queued"]);
});

test("skipping the final track stops the Lavalink player rather than leaving phantom audio", async (t) => {
  const { manager } = setup(t);
  await manager.play(guildA, voiceA, track("last"));
  const player = manager.getState(guildA).player;
  const result = await manager.skip(guildA);
  assert.equal(result.track, null);
  assert.equal(manager.getState(guildA).current, null);
  assert.equal(player.track, null);
});

test("24/7 mode restores an active track after the bot loses its Discord voice channel", async (t) => {
  const { manager, database, client } = setup(t);
  const guild = client.guilds.cache.get(guildA);
  guild.channels.cache.set(voiceA, { id: voiceA });
  await manager.play(guildA, voiceA, track("recover"));
  await manager.seek(guildA, 42000);
  await manager.setStay247(guildA, true, voiceA);
  const state = manager.getState(guildA);
  await manager.onVoiceStateUpdate(
    { channelId: voiceA },
    { id: client.user.id, channelId: null, guild },
  );
  assert.equal(state.player, null);
  assert.equal(state.current.info.identifier, "recover");
  assert.equal(database.getGuildSettings(guildA).stay247, true);

  await manager.restoreSessions();
  assert.equal(state.current.info.identifier, "recover");
  assert.equal(state.player.track, "encoded-recover");
  assert.equal(state.lastPosition, 42000);
  guild.members.me.voice.channelId = voiceA;
});

test("server-selected audio preset is applied when a fresh music player starts", async (t) => {
  const { manager, database } = setup(t);
  database.setGuildSettings(guildA, { defaultPreset: "rock" });
  await manager.play(guildA, voiceA, track("preset"));
  const filters = manager.getState(guildA).player.filters;
  assert.equal(filters.equalizer.length, 15);
  assert.equal(filters.equalizer[2].gain, 0.05);
});

test("Lavalink outage produces a useful failure and cleanly persists/restores queued work", async (t) => {
  const { manager, database, shoukaku } = setup(t, { connected: false });
  await assert.rejects(manager.resolve("song"), /No Lavalink v4 node is connected/);
  await assert.rejects(manager.play(guildA, voiceA, track("offline")), /No Lavalink v4 node is connected/);

  shoukaku.nodes.set("recovered", {
    name: "recovered",
    state: 1,
    info: { filters: [] },
    rest: { resolve: async () => ({ loadType: "empty", data: {} }) },
  });
  shoukaku.node = shoukaku.nodes.get("recovered");
  await manager.play(guildA, voiceA, [track("one"), track("two")], { requester: { id: userId, tag: "User" } });
  await manager.shutdown({ preserveLavalinkPlayers: false });
  const saved = database.getSession(guildA);
  assert.equal(saved.current.info.identifier, "one");
  assert.equal(saved.queue[0].info.identifier, "two");
});
