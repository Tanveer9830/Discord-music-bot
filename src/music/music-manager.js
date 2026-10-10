import { randomBytes } from "node:crypto";
import { normalizeLoadedTracks, buildResolverIdentifier, validateTrackReference } from "./track-resolver.js";
import { TrackQueue } from "./track-queue.js";
import { queueTrack, trackKey, trackTitle } from "./track-utils.js";
import { KeyedMutex } from "../utils/mutex.js";
import { presetFilter } from "./filters.js";

const MAX_TRACK_HISTORY = 50;

function initialState(guildId, settings) {
  return {
    guildId,
    player: null,
    voiceChannelId: null,
    current: null,
    queue: new TrackQueue(),
    loop: settings.defaultLoop,
    autoplay: settings.defaultAutoplay,
    announce: settings.defaultAnnouncements,
    volume: settings.defaultVolume,
    filters: settings.defaultPreset === "flat" ? {} : presetFilter(settings.defaultPreset),
    previous: [],
    votes: new Set(),
    componentToken: randomBytes(5).toString("hex"),
    lastPosition: 0,
    idleTimer: null,
    autoplaySearching: false,
    intentionalLeave: false,
    sessionRestored: false,
  };
}

function cleanFailure(error) {
  const message = String(error?.message ?? "").replace(/\s+/g, " ").trim();
  if (/unsupported|not supported|no results|no tracks|empty/i.test(message)) {
    return message.slice(0, 220);
  }
  return "The Lavalink audio backend could not load that track. Check the configured source manager and node logs.";
}

export class MusicManager {
  constructor({ client, shoukaku, database, config, logger, onStateChange = () => {}, onAnnouncement = () => {} }) {
    this.client = client;
    this.shoukaku = shoukaku;
    this.database = database;
    this.config = config;
    this.logger = logger;
    this.onStateChange = onStateChange;
    this.onAnnouncement = onAnnouncement;
    this.states = new Map();
    this.mutex = new KeyedMutex();
    this.boundPlayers = new WeakSet();
    this.persistTimers = new Map();
    this.persistenceInterval = setInterval(() => {
      for (const state of this.states.values()) {
        this.#persistState(state);
      }
    }, 30000);
    this.persistenceInterval.unref?.();
    this.#bindNodes();
  }

  #notify(guildId, options = {}) {
    const key = String(guildId);
    if (options.rotatePanel) {
      const state = this.getState(key);
      if (state) {
        state.componentToken = randomBytes(5).toString("hex");
      }
    }
    if (!this.persistTimers.has(key)) {
      const timer = setTimeout(() => {
        this.persistTimers.delete(key);
        this.#persistState(this.getState(key));
      }, 750);
      timer.unref?.();
      this.persistTimers.set(key, timer);
    }
    this.onStateChange(key, options);
  }

  #persistState(state) {
    try {
      if (!state) {
        return;
      }
      const settings = this.database.getGuildSettings(state.guildId);
      if (!state.current && state.queue.length === 0 && !settings.stay247) {
        this.database.deleteSession(state.guildId);
        return;
      }
      this.database.saveSession(state.guildId, {
        current: state.current,
        queue: state.queue.items,
        voiceChannelId: state.voiceChannelId ?? settings.stayChannelId,
        position: state.player?.position ?? state.lastPosition,
        volume: state.volume,
        loop: state.loop,
        autoplay: state.autoplay,
        announce: state.announce,
        filters: state.filters,
      });
    } catch (error) {
      this.logger.warn("Music session state could not be saved", { guildId: state?.guildId, error: error?.message });
    }
  }

  rotateComponentToken(guildId) {
    const state = this.getState(guildId);
    if (!state) {
      throw new Error("There is no music player for this server.");
    }
    state.componentToken = randomBytes(5).toString("hex");
    return state.componentToken;
  }

  async setStay247(guildId, enabled, channelId = null) {
    const settings = this.database.getGuildSettings(guildId);
    if (enabled && !channelId && !settings.stayChannelId) {
      throw new Error("Join a voice channel first so the bot can save the channel for 24/7 mode.");
    }
    const updated = this.database.setGuildSettings(guildId, {
      stay247: Boolean(enabled),
      stayChannelId: enabled ? String(channelId ?? settings.stayChannelId) : null,
    });
    const state = this.getState(guildId, Boolean(enabled));
    if (state) {
      this.#notify(guildId);
    }
    return updated;
  }


  #bindNodes() {
    this.shoukaku.on("ready", (name, resumed, libraryResume) => {
      this.logger.info("Lavalink node is ready", { node: name, resumed, libraryResume });
      const node = this.shoukaku.nodes.get(name);
      if (node) {
        void node.rest.getLavalinkInfo().then((info) => {
          if (info) {
            node.info = info;
            this.logger.info("Lavalink capabilities loaded", {
              node: name,
              version: info.version?.semver ?? "unknown",
              sourceManagers: info.sourceManagers?.length ?? 0,
              filters: info.filters?.length ?? 0,
            });
            for (const state of this.states.values()) {
              this.#notify(state.guildId);
            }
          }
        }).catch((error) => {
          this.logger.warn("Lavalink capability lookup failed", { node: name, status: error?.status });
        });
      }
      for (const state of this.states.values()) {
        this.#notify(state.guildId);
      }
      void this.restoreSessions().catch((error) => this.logger.warn("Saved music session restoration failed", { error: error?.message }));
    });
    this.shoukaku.on("reconnecting",  (name, remaining, interval) => {
      this.logger.warn("Lavalink node reconnecting", { node: name, remaining, interval });
    });
    this.shoukaku.on("disconnect", (name, count) => {
      this.logger.error("Lavalink node disconnected", { node: name, reconnectCount: count });
      for (const state of this.states.values()) {
        this.#notify(state.guildId);
      }
    });
    this.shoukaku.on("close", (name, code) => {
      this.logger.warn("Lavalink websocket closed", { node: name, code });
    });
    this.shoukaku.on("error", (name, error) => {
      this.logger.error("Lavalink node error", { node: name, error: error?.message ?? "unknown error" });
    });
  }

  getState(guildId, create = false) {
    const key = String(guildId);
    let state = this.states.get(key);
    if (!state && create) {
      const settings = this.database.getGuildSettings(key);
      state = initialState(key, settings);
      state.player = this.shoukaku.players.get(key) ?? null;
      state.voiceChannelId = this.shoukaku.connections.get(key)?.channelId ?? null;
      this.states.set(key, state);
      if (state.player) {
        this.#bindPlayer(state);
      }
    }
    return state ?? null;
  }

  getVoiceChannelId(guildId) {
    const state = this.states.get(String(guildId));
    return state?.voiceChannelId ?? this.shoukaku.connections.get(String(guildId))?.channelId ?? null;
  }

  getActivePlayerCount() {
    return [...this.states.values()].filter((state) => Boolean(state.current && state.player)).length;
  }

  getPlayerSummary(guildId) {
    const state = this.getState(guildId);
    if (!state) {
      return null;
    }
    return {
      current: state.current,
      queue: state.queue.items,
      volume: state.volume,
      loop: state.loop,
      autoplay: state.autoplay,
      voiceChannelId: this.getVoiceChannelId(guildId),
      position: Math.max(0, state.player?.position ?? state.lastPosition ?? 0),
      paused: Boolean(state.player?.paused),
      filters: Object.keys(state.filters),
      shuffled: state.queue.isShuffled,
      announce: state.announce,
      componentToken: state.componentToken,
    };
  }

  getNodeStatuses() {
    return [...this.shoukaku.nodes.values()].map((node) => ({
      name: node.name,
      connected: node.state === 1,
      state: ["connecting", "connected", "disconnecting", "disconnected"][node.state] ?? "unknown",
      version: node.info?.version?.semver ?? null,
      players: node.stats?.players ?? null,
      playingPlayers: node.stats?.playingPlayers ?? null,
      uptime: node.stats?.uptime ?? null,
    }));
  }

  #connectedNode() {
    const candidates = [...this.shoukaku.nodes.values()].filter((node) => node.state === 1);
    if (candidates.length === 0) {
      throw new Error("No Lavalink v4 node is connected. Verify host, port, TLS, password, and network access.");
    }
    return this.shoukaku.getIdealNode() ?? candidates[0];
  }

  async resolve(query, prefix = this.config.searchPrefix) {
    const reference = validateTrackReference(query);
    const identifier = buildResolverIdentifier(reference.query, prefix);
    const node = this.#connectedNode();
    let response;
    try {
      response = await node.rest.resolve(identifier);
    } catch (error) {
      this.logger.warn("Lavalink track resolution failed", { node: node.name, status: error?.status });
      throw new Error(cleanFailure(error));
    }
    const normalized = normalizeLoadedTracks(response);
    if (normalized.type === "error") {
      this.logger.warn("Lavalink rejected a track request", { node: node.name });
      throw new Error(cleanFailure(new Error(normalized.message)));
    }
    if (!normalized.tracks.length) {
      throw new Error("No playable tracks were found. The source may be unavailable or disabled on Lavalink.");
    }
    return normalized;
  }

  async search(query, prefix = this.config.searchPrefix) {
    const normalized = await this.resolve(query, prefix);
    return normalized.tracks;
  }

  async join(guildId, voiceChannelId) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId, true);
      await this.#ensurePlayer(state, voiceChannelId);
      if (!state.current && state.queue.length > 0) {
        const next = state.queue.takeNext();
        await this.#start(state, next, { recordHistory: false });
      }
      this.#notify(state.guildId);
      return state;
    });
  }

  async play(guildId, voiceChannelId, items, { mode = "append", requester = null } = {}) {
    const list = (Array.isArray(items) ? items : [items]).filter(Boolean).map((item) => item?.info ? queueTrack(item, requester) : item);
    if (list.length === 0) {
      throw new Error("No playable tracks were supplied.");
    }
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId, true);
      const settings = this.database.getGuildSettings(guildId);
      const retainedCurrent = mode === "skip" && state.current ? 1 : 0;
      if (state.queue.length + retainedCurrent + list.length > settings.maxQueueSize) {
        throw new Error(`Queue limit reached (${settings.maxQueueSize} upcoming tracks).`);
      }
      await this.#ensurePlayer(state, voiceChannelId);
      this.#cancelIdle(state);
      if (mode === "skip") {
        if (state.current) {
          state.queue.addFirst(state.current, settings.maxQueueSize);
          state.previous.push(state.current);
          state.previous = state.previous.slice(-MAX_TRACK_HISTORY);
          state.current = null;
        }
        for (let index = list.length - 1; index >= 0; index -= 1) {
          state.queue.addFirst(list[index], settings.maxQueueSize);
        }
      } else if (mode === "next") {
        for (let index = list.length - 1; index >= 0; index -= 1) {
          state.queue.addFirst(list[index], settings.maxQueueSize);
        }
      } else {
        state.queue.add(list, settings.maxQueueSize);
      }
      if (!state.current) {
        const next = state.queue.takeNext();
        if (next) {
          await this.#start(state, next);
        }
      }
      this.#notify(state.guildId, { rotatePanel: true });
      return { state, added: list.length };
    });
  }

  async pause(guildId, paused = true) {
    return this.#withPlayer(guildId, async (state) => {
      await state.player.setPaused(Boolean(paused));
      this.#notify(state.guildId);
      return state.player.paused;
    });
  }

  async skip(guildId) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.#requireCurrent(guildId);
      return this.#advance(state, { rememberCurrent: true });
    });
  }

  async previous(guildId) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.#requireCurrent(guildId);
      const prior = state.previous.pop();
      if (!prior) {
        throw new Error("There is no previous track in this player session.");
      }
      const settings = this.database.getGuildSettings(guildId);
      state.queue.addFirst(state.current, settings.maxQueueSize);
      await this.#start(state, prior, { recordHistory: false });
      return prior;
    });
  }

  async stop(guildId) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId);
      if (!state?.player) {
        throw new Error("There is no active music player in this server.");
      }
      state.queue.clear();
      state.current = null;
      state.lastPosition = 0;
      state.votes.clear();
      state.componentToken = randomBytes(5).toString("hex");
      await state.player.stopTrack();
      this.#scheduleIdle(state);
      this.#notify(state.guildId);
      return state;
    });
  }

  async leave(guildId, { disableStay247 = true } = {}) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId);
      if (state) {
        this.#cancelIdle(state);
        state.intentionalLeave = true;
        state.queue.clear();
        state.current = null;
        state.player = null;
        state.voiceChannelId = null;
      }
      if (disableStay247) {
        this.database.setGuildSettings(guildId, { stay247: false, stayChannelId: null });
      }
      await this.shoukaku.leaveVoiceChannel(String(guildId));
      this.states.delete(String(guildId));
      this.database.deleteSession(guildId);
      this.#notify(String(guildId));
    });
  }

  async seek(guildId, position) {
    return this.#withPlayer(guildId, async (state) => {
      const duration = state.current?.info?.length ?? 0;
      if (!state.current || state.current.info?.isStream || !state.current.info?.isSeekable || duration <= 0) {
        throw new Error("This track is live or does not support seeking.");
      }
      const target = Math.max(0, Math.min(duration, Math.floor(position)));
      await state.player.seekTo(target);
      state.lastPosition = target;
      this.#notify(state.guildId);
      return target;
    });
  }

  async restart(guildId) {
    return this.seek(guildId, 0);
  }

  async setVolume(guildId, volume) {
    return this.#withPlayer(guildId, async (state) => {
      const settings = this.database.getGuildSettings(guildId);
      if (!Number.isInteger(volume) || volume < 0 || volume > settings.maxVolume) {
        throw new Error(`Volume must be between 0 and ${settings.maxVolume} for this server.`);
      }
      await state.player.setGlobalVolume(volume);
      state.volume = volume;
      this.#notify(state.guildId);
      return volume;
    });
  }

  async setLoop(guildId, mode) {
    if (!new Set(["off", "track", "queue"]).has(mode)) {
      throw new Error("Loop mode must be off, track, or queue.");
    }
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId, true);
      state.loop = mode;
      this.#notify(state.guildId);
      return state.loop;
    });
  }

  async setAutoplay(guildId, enabled) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId, true);
      state.autoplay = Boolean(enabled);
      this.#notify(state.guildId);
      return state.autoplay;
    });
  }

  async toggleAnnouncements(guildId, enabled) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId, true);
      state.announce = Boolean(enabled);
      this.#notify(state.guildId);
      return state.announce;
    });
  }

  async setFilter(guildId, filters) {
    return this.#withPlayer(guildId, async (state) => {
      const node = state.player.node;
      const requested = Object.keys(filters);
      const nodeFilters = node.info?.filters;
      if (Array.isArray(nodeFilters)) {
        const unsupported = requested.filter((key) => !nodeFilters.includes(key));
        if (unsupported.length > 0) {
          throw new Error(`This Lavalink node does not advertise the ${unsupported.join(", ")} filter${unsupported.length > 1 ? "s" : ""}.`);
        }
      }
      const next = { ...state.filters, ...filters };
      try {
        await state.player.setFilters(next);
      } catch {
        throw new Error("Lavalink rejected the requested filter. Check the node version and advertised filter support.");
      }
      state.filters = next;
      this.#notify(state.guildId);
      return state.filters;
    });
  }

  async clearFilters(guildId) {
    return this.#withPlayer(guildId, async (state) => {
      try {
        await state.player.clearFilters();
      } catch {
        throw new Error("Lavalink could not clear the active audio filters.");
      }
      state.filters = {};
      this.#notify(state.guildId);
      return state;
    });
  }

  async updateFilters(guildId, nextFilters) {
    return this.#withPlayer(guildId, async (state) => {
      const nodeFilters = state.player.node.info?.filters;
      if (Array.isArray(nodeFilters)) {
        const unsupported = Object.keys(nextFilters).filter((key) => !nodeFilters.includes(key));
        if (unsupported.length > 0) {
          throw new Error(`This Lavalink node does not advertise the ${unsupported.join(", ")} filter${unsupported.length > 1 ? "s" : ""}.`);
        }
      }
      try {
        await state.player.setFilters(nextFilters);
      } catch {
        throw new Error("Lavalink rejected the requested audio filter settings.");
      }
      state.filters = { ...nextFilters };
      this.#notify(state.guildId);
      return state.filters;
    });
  }

  async setEqualizer(guildId, equalizer) {
    const state = this.getState(guildId);
    if (!state?.player || !state.current) {
      throw new Error("There is no active track to adjust.");
    }
    const filters = { ...state.filters, equalizer };
    return this.updateFilters(guildId, filters);
  }

  async setTimescale(guildId, timescale) {
    return this.updateFilters(guildId, { ...(this.getState(guildId)?.filters ?? {}), timescale });
  }

  async setQueueLimit(guildId, limit) {
    const settings = this.database.getGuildSettings(guildId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error("Queue limit must be between 1 and 1000 tracks.");
    }
    if (this.getState(guildId)?.queue.length > limit) {
      throw new Error("The current upcoming queue is larger than that limit. Remove tracks first.");
    }
    return this.database.setGuildSettings(guildId, { ...settings, maxQueueSize: limit });
  }

  async removeFromQueue(guildId, position) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId);
      if (!state) {
        throw new Error("There is no queue in this server.");
      }
      const removed = state.queue.remove(position);
      this.#notify(state.guildId, { rotatePanel: true });
      return removed;
    });
  }

  async moveQueue(guildId, from, to) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId);
      if (!state) {
        throw new Error("There is no queue in this server.");
      }
      const moved = state.queue.move(from, to);
      this.#notify(state.guildId, { rotatePanel: true });
      return moved;
    });
  }

  async swapQueue(guildId, first, second) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId);
      if (!state) {
        throw new Error("There is no queue in this server.");
      }
      state.queue.swap(first, second);
      this.#notify(state.guildId, { rotatePanel: true });
    });
  }

  async clearQueue(guildId) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId);
      if (!state) {
        return 0;
      }
      const removed = state.queue.clear().length;
      this.#notify(state.guildId, { rotatePanel: true });
      return removed;
    });
  }

  async shuffleQueue(guildId) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId);
      if (!state) {
        throw new Error("There is no queue in this server.");
      }
      const changed = state.queue.shuffle();
      this.#notify(state.guildId, { rotatePanel: true });
      return changed;
    });
  }

  async unshuffleQueue(guildId) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId);
      if (!state) {
        throw new Error("There is no queue in this server.");
      }
      const changed = state.queue.unshuffle();
      this.#notify(state.guildId, { rotatePanel: true });
      return changed;
    });
  }

  async reverseQueue(guildId) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId);
      if (!state) {
        throw new Error("There is no queue in this server.");
      }
      state.queue.reverse();
      this.#notify(state.guildId, { rotatePanel: true });
      return state.queue.length;
    });
  }

  async deduplicateQueue(guildId) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId);
      if (!state) {
        return 0;
      }
      const removed = state.queue.deduplicate();
      this.#notify(state.guildId, { rotatePanel: true });
      return removed;
    });
  }

  async skipTo(guildId, position) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.getState(guildId);
      if (!state?.player || state.queue.length === 0) {
        throw new Error("There are no upcoming tracks to skip to.");
      }
      const upcoming = state.queue.items;
      if (!Number.isInteger(position) || position < 1 || position > upcoming.length) {
        throw new RangeError(`Queue position must be between 1 and ${upcoming.length}.`);
      }
      const target = upcoming[position - 1];
      state.queue.replace(upcoming.slice(position));
      if (state.current) {
        state.previous.push(state.current);
        state.previous = state.previous.slice(-MAX_TRACK_HISTORY);
      }
      await this.#start(state, target);
      return target;
    });
  }

  async saveQueue(guildId, userId, name) {
    const state = this.getState(guildId);
    const tracks = [...(state?.current ? [state.current] : []), ...(state?.queue.items ?? [])];
    if (tracks.length === 0) {
      throw new Error("There are no current or upcoming tracks to save.");
    }
    this.database.saveQueue(guildId, userId, name, tracks);
    return tracks.length;
  }

  async loadSavedQueue(guildId, voiceChannelId, userId, name) {
    const tracks = this.database.loadQueue(guildId, userId, name);
    if (!tracks) {
      throw new Error("No saved queue with that name was found for you in this server.");
    }
    const playable = await this.#refreshStoredTracks(tracks);
    return this.play(guildId, voiceChannelId, playable, { mode: "append", requester: null });
  }

  async voteSkip(guildId, userId, { minimum = 2, percentage = 0.5 } = {}) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.#requireCurrent(guildId);
      const channel = this.client.channels.cache.get(state.voiceChannelId);
      const humanCount = channel?.members?.filter((member) => !member.user.bot).size ?? 1;
      const required = Math.min(humanCount, Math.max(minimum, Math.ceil(humanCount * percentage)));
      if (state.votes.has(String(userId))) {
        return { votes: state.votes.size, required, skipped: false, alreadyVoted: true };
      }
      state.votes.add(String(userId));
      if (state.votes.size >= required) {
        await this.#advance(state, { rememberCurrent: true });
        return { votes: state.votes.size, required, skipped: true, alreadyVoted: false };
      }
      this.#notify(state.guildId);
      return { votes: state.votes.size, required, skipped: false, alreadyVoted: false };
    });
  }

  async #refreshStoredTracks(tracks) {
    const playable = [];
    for (const item of tracks) {
      if (item.encoded && item.info?.identifier) {
        playable.push(item);
        continue;
      }
      const query = item.info?.uri || item.query || `${item.info?.author ?? ""} ${item.info?.title ?? ""}`.trim();
      if (!query) {
        continue;
      }
      const loaded = await this.resolve(query);
      if (loaded.tracks[0]) {
        playable.push(queueTrack(loaded.tracks[0]));
      }
    }
    if (playable.length === 0) {
      throw new Error("None of the saved tracks could be resolved on the configured Lavalink source.");
    }
    return playable;
  }

  async #ensurePlayer(state, voiceChannelId) {
    if (!voiceChannelId) {
      throw new Error("Join a voice channel before starting music.");
    }
    if (state.player && state.voiceChannelId && state.voiceChannelId !== voiceChannelId) {
      throw new Error("The bot is already connected to another voice channel in this server.");
    }
    if (!state.player) {
      this.#connectedNode();
      const guild = this.client.guilds.cache.get(state.guildId);
      try {
        state.player = await this.shoukaku.joinVoiceChannel({
          guildId: state.guildId,
          shardId: guild?.shardId ?? 0,
          channelId: voiceChannelId,
          deaf: true,
          mute: false,
        });
      } catch {
        state.player = this.shoukaku.players.get(state.guildId) ?? null;
        if (!state.player) {
          throw new Error("Could not join voice. Check Lavalink connectivity and the bot's Connect/Speak permissions.");
        }
      }
      state.voiceChannelId = voiceChannelId;
      const settings = this.database.getGuildSettings(state.guildId);
      state.volume = Math.min(state.volume, settings.maxVolume);
      await state.player.setGlobalVolume(state.volume);
      this.#bindPlayer(state);
    }
    this.#cancelIdle(state);
    return state.player;
  }

  #bindPlayer(state) {
    if (!state.player || this.boundPlayers.has(state.player)) {
      return;
    }
    const player = state.player;
    this.boundPlayers.add(player);
    player.on("update", (event) => {
      if (Number.isFinite(event?.state?.position)) {
        state.lastPosition = event.state.position;
        this.#notify(state.guildId, { positionOnly: true });
      }
    });
    player.on("start", () => {
      state.lastPosition = 0;
      this.#notify(state.guildId);
      const guild = this.client.guilds.cache.get(state.guildId);
      this.logger.info("Music track started", { guildId: state.guildId, title: trackTitle(state.current) });
      if (state.announce && guild) {
        void this.onAnnouncement(state.guildId, state.current);
      }
    });
    player.on("end", (event) => {
      void this.mutex.runExclusive(state.guildId, async () => this.#onTrackEnd(state, event)).catch((error) => {
        this.logger.error("Track-end recovery failed", { guildId: state.guildId, error: error?.message });
      });
    });
    player.on("stuck", (event) => {
      this.logger.warn("Lavalink track became stuck", { guildId: state.guildId, thresholdMs: event?.thresholdMs });
      void this.mutex.runExclusive(state.guildId, async () => this.#advance(state, { rememberCurrent: false })).catch(() => {});
    });
    player.on("exception", (event) => {
      this.logger.warn("Lavalink could not play a track", { guildId: state.guildId, severity: event?.exception?.severity });
      void this.mutex.runExclusive(state.guildId, async () => this.#advance(state, { rememberCurrent: false })).catch(() => {});
    });
    player.on("closed", (event) => {
      this.logger.warn("Lavalink voice websocket closed", { guildId: state.guildId, code: event?.code, reason: String(event?.reason ?? "").slice(0, 100) });
      this.#notify(state.guildId);
    });
    player.on("resumed", () => {
      this.logger.info("Lavalink player resumed", { guildId: state.guildId });
      this.#notify(state.guildId);
    });
  }

  async #onTrackEnd(state, event) {
    if (!state.current) {
      return;
    }
    if (event?.reason === "replaced" || event?.reason === "stopped" || event?.reason === "cleanup") {
      return;
    }
    if (event?.reason === "finished" && state.loop === "track") {
      await this.#start(state, state.current, { recordHistory: false });
      return;
    }
    if (event?.reason === "finished" && state.loop === "queue") {
      const finished = state.current;
      this.#rememberPrevious(state, finished);
      const settings = this.database.getGuildSettings(state.guildId);
      try {
        state.queue.add(finished, settings.maxQueueSize);
      } catch {
        // The current item is retried only if space remains; queue safety takes priority.
      }
    } else if (event?.reason === "finished") {
      this.#rememberPrevious(state, state.current);
    }
    const endedTrack = state.current;
    state.current = null;
    state.lastPosition = 0;
    state.votes.clear();
    await this.#advance(state, { rememberCurrent: false, autoplaySeed: endedTrack });
  }

  #rememberPrevious(state, track) {
    if (track) {
      state.previous.push(track);
      state.previous = state.previous.slice(-MAX_TRACK_HISTORY);
    }
  }

  async #advance(state, { rememberCurrent = false, autoplaySeed = state.current } = {}) {
    const trackBeforeAdvance = state.current;
    if (rememberCurrent && state.current) {
      this.#rememberPrevious(state, state.current);
    }
    let next = state.queue.takeNext();
    while (next) {
      try {
        await this.#start(state, next);
        return { track: next, ended: false };
      } catch (error) {
        this.logger.warn("Could not start the next queued track; trying the following item", {
          guildId: state.guildId,
          reason: error?.message,
        });
        if (!this.#hasConnectedNode()) {
          const settings = this.database.getGuildSettings(state.guildId);
          try {
            state.queue.addFirst(next, settings.maxQueueSize);
          } catch {
            // Preserve the configured queue bound if the queue was refilled concurrently.
          }
          break;
        }
        next = state.queue.takeNext();
      }
    }
    if (state.autoplay && autoplaySeed && this.#hasConnectedNode()) {
      const auto = await this.#findAutoplayTrack(state, autoplaySeed);
      if (auto) {
        try {
          await this.#start(state, auto);
          return { track: auto, ended: false, autoplay: true };
        } catch (error) {
          this.logger.warn("Could not start the autoplay selection", { guildId: state.guildId, reason: error?.message });
        }
      }
    }
    if (trackBeforeAdvance && state.player) {
      await state.player.stopTrack().catch((error) => {
        this.logger.warn("Lavalink could not stop the ended player", { guildId: state.guildId, error: error?.message });
      });
    }
    state.current = null;
    state.lastPosition = 0;
    state.votes.clear();
    this.#scheduleIdle(state);
    this.#notify(state.guildId, { rotatePanel: true });
    return { track: null, ended: true };
  }

  async #findAutoplayTrack(state, seed = state.current) {
    if (state.autoplaySearching || !seed) {
      return null;
    }
    state.autoplaySearching = true;
    try {
      const query = `${seed.info?.author ?? ""} ${seed.info?.title ?? ""} official audio`.trim();
      const result = await this.resolve(query);
      const visited = new Set([...state.previous, seed, ...state.queue.items].map(trackKey));
      const candidate = result.tracks.find((track) => !visited.has(trackKey(track)));
      if (!candidate) {
        this.logger.info("Autoplay search returned no new track", { guildId: state.guildId });
        return null;
      }
      return queueTrack(candidate, { id: this.client.user?.id ?? "0", tag: "Autoplay" });
    } catch (error) {
      this.logger.warn("Autoplay could not find a follow-up track", { guildId: state.guildId, reason: cleanFailure(error) });
      return null;
    } finally {
      state.autoplaySearching = false;
    }
  }

  async #start(state, item, { recordHistory = true, position = 0 } = {}) {
    if (!state.player) {
      throw new Error("The Lavalink player is no longer connected. Use /play to reconnect.");
    }
    let track = item;
    if (!track?.encoded && (track?.info?.uri || track?.query)) {
      const result = await this.resolve(track.info?.uri || track.query);
      track = queueTrack(result.tracks[0], track.requester);
    }
    if (!track?.encoded) {
      throw new Error("This saved track has no playable Lavalink track data.");
    }
    state.current = track;
    state.lastPosition = 0;
    state.votes.clear();
    state.componentToken = randomBytes(5).toString("hex");
    try {
      await state.player.playTrack({ track: { encoded: track.encoded } });
      if (Object.keys(state.filters).length > 0) {
        try {
          await state.player.setFilters(state.filters);
        } catch {
          state.filters = {};
          this.logger.warn("Saved filter state was not supported after player recovery", { guildId: state.guildId });
        }
      }
      const safePosition = Math.max(0, Math.min(Number(position) || 0, track.info?.length ?? 0));
      if (safePosition > 0 && track.info?.isSeekable && !track.info?.isStream) {
        try {
          await state.player.seekTo(safePosition);
          state.lastPosition = safePosition;
        } catch {
          this.logger.warn("Saved playback position could not be restored", { guildId: state.guildId });
        }
      }
    } catch {
      state.current = null;
      throw new Error("Lavalink could not start the selected track. The track may have expired or the source may be unavailable.");
    }
    if (recordHistory) {
      const settings = this.database.getGuildSettings(state.guildId);
      if (settings.historyEnabled) {
        this.database.addHistory(state.guildId, track.requester?.id, track);
      }
    }
    this.#notify(state.guildId);
    return track;
  }

  #requireCurrent(guildId) {
    const state = this.getState(guildId);
    if (!state?.player || !state.current) {
      throw new Error("There is no active track in this server.");
    }
    return state;
  }

  async #withPlayer(guildId, operation) {
    return this.mutex.runExclusive(String(guildId), async () => {
      const state = this.#requireCurrent(guildId);
      return operation(state);
    });
  }

  #cancelIdle(state) {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
  }

  #scheduleIdle(state) {
    this.#cancelIdle(state);
    const settings = this.database.getGuildSettings(state.guildId);
    if (settings.idleDisconnectSeconds <= 0 || settings.stay247 || state.current || state.queue.length > 0) {
      return;
    }
    state.idleTimer = setTimeout(() => {
      void this.mutex.runExclusive(state.guildId, async () => {
        if (!state.current && state.queue.length === 0 && !this.database.getGuildSettings(state.guildId).stay247) {
          await this.shoukaku.leaveVoiceChannel(state.guildId);
          state.player = null;
          state.voiceChannelId = null;
          this.states.delete(state.guildId);
          this.logger.info("Idle music player disconnected", { guildId: state.guildId });
          this.#notify(state.guildId);
        }
      }).catch((error) => this.logger.warn("Idle disconnect failed", { guildId: state.guildId, error: error?.message }));
    }, settings.idleDisconnectSeconds * 1000);
    state.idleTimer.unref?.();
  }

  async onVoiceStateUpdate(oldState, newState) {
    if (newState.id !== this.client.user?.id || oldState.channelId === newState.channelId) {
      return;
    }
    const guildId = newState.guild.id;
    if (newState.channelId) {
      const state = this.getState(guildId, true);
      state.voiceChannelId = newState.channelId;
      const settings = this.database.getGuildSettings(guildId);
      if (settings.stay247) {
        this.database.setGuildSettings(guildId, { stayChannelId: newState.channelId });
      }
      this.#notify(guildId);
      return;
    }

    const settings = this.database.getGuildSettings(guildId);
    const state = this.getState(guildId);
    if (!settings.stay247) {
      if (state) {
        this.#cancelIdle(state);
        if (state.current) {
          try {
            state.queue.addFirst(state.current, settings.maxQueueSize);
          } catch {
            // Keep the queue bounded if it was already full.
          }
          state.current = null;
        }
        state.player = null;
        state.voiceChannelId = null;
        this.#notify(guildId, { rotatePanel: true });
      }
      return;
    }

    if (state) {
      state.player = null;
      state.voiceChannelId = null;
      this.#notify(guildId, { rotatePanel: true });
    }
    const channelId = settings.stayChannelId ?? oldState.channelId;
    if (!channelId) {
      return;
    }
    setTimeout(() => {
      const guild = this.client.guilds.cache.get(guildId);
      const channel = guild?.channels.cache.get(channelId);
      const botMember = guild?.members.me;
      if (!channel || botMember?.voice.channelId || !this.#hasConnectedNode()) {
        return;
      }
      void this.mutex.runExclusive(guildId, async () => {
        const currentState = this.getState(guildId, true);
        const resumeTrack = currentState.current;
        const resumePosition = currentState.lastPosition;
        await this.shoukaku.leaveVoiceChannel(guildId);
        currentState.player = null;
        currentState.voiceChannelId = null;
        await this.#ensurePlayer(currentState, channelId);
        if (resumeTrack) {
          await this.#start(currentState, resumeTrack, { recordHistory: false, position: resumePosition });
        } else if (currentState.queue.length > 0) {
          await this.#start(currentState, currentState.queue.takeNext(), { recordHistory: false });
        }
      }).catch((error) => this.logger.warn("24/7 voice rejoin failed", { guildId, error: error?.message }));
    }, 3000).unref?.();
  }

  #hasConnectedNode() {
    return [...this.shoukaku.nodes.values()].some((node) => node.state === 1);
  }

  async restoreSessions() {
    for (const guild of this.client.guilds.cache.values()) {
      const settings = this.database.getGuildSettings(guild.id);
      const saved = this.database.getSession(guild.id);
      if (!saved && !settings.stay247) {
        continue;
      }
      const state = this.getState(guild.id, true);
      if (saved && !state.sessionRestored) {
        state.volume = Math.min(saved.volume, settings.maxVolume);
        state.loop = saved.loop;
        state.autoplay = saved.autoplay;
        state.announce = saved.announce;
        state.filters = saved.filters;
        state.voiceChannelId = saved.voiceChannelId ?? settings.stayChannelId;
        state.queue.replace([...(saved.current ? [saved.current] : []), ...saved.queue]);
        state.current = null;
        state.lastPosition = saved.position;
        state.sessionRestored = true;
        this.#notify(guild.id);
      }
      if (!settings.stay247 || state.player || !this.#hasConnectedNode()) {
        continue;
      }
      const channelId = settings.stayChannelId ?? saved?.voiceChannelId ?? guild.members.me?.voice?.channelId;
      const channel = channelId ? guild.channels.cache.get(channelId) : null;
      if (!channel) {
        continue;
      }
      await this.mutex.runExclusive(guild.id, async () => {
        await this.#ensurePlayer(state, channelId);
        if (state.current) {
          await this.#start(state, state.current, { recordHistory: false, position: state.lastPosition });
        } else if (state.queue.length > 0) {
          await this.#start(state, state.queue.takeNext(), { recordHistory: false, position: saved?.position ?? 0 });
        }
        this.#notify(guild.id);
      }).catch((error) => this.logger.warn("Saved music session could not resume", { guildId: guild.id, error: error?.message }));
    }
  }

  async shutdown({ preserveLavalinkPlayers = true } = {}) {
    clearInterval(this.persistenceInterval);
    for (const timer of this.persistTimers.values()) {
      clearTimeout(timer);
    }
    this.persistTimers.clear();
    for (const state of this.states.values()) {
      this.#cancelIdle(state);
      this.#persistState(state);
    }
    if (!preserveLavalinkPlayers) {
      await Promise.allSettled([...this.states.keys()].map((guildId) => this.shoukaku.leaveVoiceChannel(guildId)));
    }
    this.states.clear();
  }
}
