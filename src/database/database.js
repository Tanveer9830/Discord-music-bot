import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_GUILD_SETTINGS, normalizeGuildSettings } from "../music/settings.js";

const migrations = [
  `CREATE TABLE IF NOT EXISTS guild_settings (
     guild_id TEXT PRIMARY KEY,
     settings_json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS dj_controllers (
     guild_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     added_by TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (guild_id, user_id)
   );
   CREATE TABLE IF NOT EXISTS playlists (
     id TEXT PRIMARY KEY,
     guild_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     name TEXT NOT NULL COLLATE NOCASE,
     visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
     share_token TEXT UNIQUE,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (guild_id, user_id, name)
   );
   CREATE TABLE IF NOT EXISTS playlist_tracks (
     playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
     position INTEGER NOT NULL,
     track_json TEXT NOT NULL,
     PRIMARY KEY (playlist_id, position)
   );
   CREATE TABLE IF NOT EXISTS favorites (
     guild_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     track_key TEXT NOT NULL,
     track_json TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (guild_id, user_id, track_key)
   );
   CREATE TABLE IF NOT EXISTS listening_history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     guild_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     track_json TEXT NOT NULL,
     played_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS saved_queues (
     guild_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     name TEXT NOT NULL COLLATE NOCASE,
     tracks_json TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (guild_id, user_id, name)
   );`,
  `CREATE INDEX IF NOT EXISTS playlists_owner_idx ON playlists(guild_id, user_id);
   CREATE INDEX IF NOT EXISTS playlists_share_idx ON playlists(share_token);
   CREATE INDEX IF NOT EXISTS history_user_idx ON listening_history(guild_id, user_id, played_at DESC);
   CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites(guild_id, user_id, created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS guild_sessions (
     guild_id TEXT PRIMARY KEY,
     session_json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
];

function now() {
  return new Date().toISOString();
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cleanTrack(track) {
  const info = track?.info && typeof track.info === "object" ? track.info : {};
  return {
    encoded: typeof track?.encoded === "string" ? track.encoded : "",
    info: {
      identifier: String(info.identifier ?? ""),
      isSeekable: Boolean(info.isSeekable),
      author: String(info.author ?? "Unknown artist"),
      length: Math.max(0, Number(info.length) || 0),
      isStream: Boolean(info.isStream),
      title: String(info.title ?? "Unknown track"),
      uri: typeof info.uri === "string" ? info.uri : undefined,
      artworkUrl: typeof info.artworkUrl === "string" ? info.artworkUrl : undefined,
      sourceName: String(info.sourceName ?? "unknown"),
      isrc: typeof info.isrc === "string" ? info.isrc : undefined,
    },
    query: typeof track?.query === "string" ? track.query : undefined,
  };
}

function requireName(name, label = "Name") {
  const normalized = String(name ?? "").trim();
  if (normalized.length < 1 || normalized.length > 50 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} must contain 1 to 50 printable characters.`);
  }
  return normalized;
}

export class MusicDatabase {
  constructor(databasePath) {
    const resolved = path.resolve(databasePath);
    mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
    this.path = resolved;
    this.db = new Database(resolved);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.#migrate();
    try {
      chmodSync(resolved, 0o600);
    } catch {
      // Some filesystems do not support POSIX permission bits; data remains in the configured path.
    }
  }

  #migrate() {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const current = this.db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version;
    migrations.forEach((sql, index) => {
      const version = index + 1;
      if (version <= current) {
        return;
      }
      const apply = this.db.transaction(() => {
        this.db.exec(sql);
        this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, now());
      });
      apply.immediate();
    });
  }

  close() {
    if (this.db.open) {
      this.db.close();
    }
  }

  getMigrationVersion() {
    return this.db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version;
  }

  saveSession(guildId, session) {
    const clean = {
      current: session.current ? cleanTrack(session.current) : null,
      queue: Array.isArray(session.queue) ? session.queue.slice(0, 1000).map(cleanTrack) : [],
      voiceChannelId: /^\d{15,22}$/.test(String(session.voiceChannelId ?? "")) ? String(session.voiceChannelId) : null,
      position: Math.max(0, Math.floor(Number(session.position) || 0)),
      volume: Math.max(0, Math.min(1000, Math.floor(Number(session.volume) || 0))),
      loop: ["off", "track", "queue"].includes(session.loop) ? session.loop : "off",
      autoplay: Boolean(session.autoplay),
      announce: Boolean(session.announce),
      filters: session.filters && typeof session.filters === "object" && !Array.isArray(session.filters) ? session.filters : {},
    };
    this.db.prepare(`INSERT INTO guild_sessions(guild_id, session_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET session_json = excluded.session_json, updated_at = excluded.updated_at`)
      .run(String(guildId), JSON.stringify(clean), now());
  }

  getSession(guildId) {
    const row = this.db.prepare("SELECT session_json AS sessionJson FROM guild_sessions WHERE guild_id = ?").get(String(guildId));
    const session = row ? safeJson(row.sessionJson, null) : null;
    if (!session || typeof session !== "object") {
      return null;
    }
    return {
      current: session.current ? cleanTrack(session.current) : null,
      queue: Array.isArray(session.queue) ? session.queue.map(cleanTrack) : [],
      voiceChannelId: session.voiceChannelId ?? null,
      position: Math.max(0, Number(session.position) || 0),
      volume: Math.max(0, Math.min(1000, Number(session.volume) || 0)),
      loop: ["off", "track", "queue"].includes(session.loop) ? session.loop : "off",
      autoplay: Boolean(session.autoplay),
      announce: Boolean(session.announce),
      filters: session.filters && typeof session.filters === "object" && !Array.isArray(session.filters) ? session.filters : {},
    };
  }

  deleteSession(guildId) {
    return this.db.prepare("DELETE FROM guild_sessions WHERE guild_id = ?").run(String(guildId)).changes > 0;
  }

  getGuildSettings(guildId) {
    const row = this.db.prepare("SELECT settings_json FROM guild_settings WHERE guild_id = ?").get(String(guildId));
    const parsed = row ? safeJson(row.settings_json, {}) : {};
    return normalizeGuildSettings({ ...DEFAULT_GUILD_SETTINGS, ...parsed });
  }

  setGuildSettings(guildId, patch) {
    const current = this.getGuildSettings(guildId);
    const normalized = normalizeGuildSettings({ ...current, ...patch });
    this.db.prepare(`INSERT INTO guild_settings(guild_id, settings_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`)
      .run(String(guildId), JSON.stringify(normalized), now());
    return normalized;
  }

  resetGuildSettings(guildId) {
    this.db.prepare("DELETE FROM guild_settings WHERE guild_id = ?").run(String(guildId));
    this.db.prepare("DELETE FROM dj_controllers WHERE guild_id = ?").run(String(guildId));
    return { ...DEFAULT_GUILD_SETTINGS, allowedVoiceChannelIds: [], allowedTextChannelIds: [], djRequiredActions: [...DEFAULT_GUILD_SETTINGS.djRequiredActions] };
  }

  addController(guildId, userId, addedBy) {
    return this.db.prepare(`INSERT OR IGNORE INTO dj_controllers(guild_id, user_id, added_by, created_at)
      VALUES (?, ?, ?, ?)`)
      .run(String(guildId), String(userId), String(addedBy), now()).changes > 0;
  }

  removeController(guildId, userId) {
    return this.db.prepare("DELETE FROM dj_controllers WHERE guild_id = ? AND user_id = ?")
      .run(String(guildId), String(userId)).changes > 0;
  }

  isController(guildId, userId) {
    return Boolean(this.db.prepare("SELECT 1 FROM dj_controllers WHERE guild_id = ? AND user_id = ?")
      .get(String(guildId), String(userId)));
  }

  listControllers(guildId) {
    return this.db.prepare("SELECT user_id AS userId, added_by AS addedBy, created_at AS createdAt FROM dj_controllers WHERE guild_id = ? ORDER BY created_at")
      .all(String(guildId));
  }

  createPlaylist(guildId, userId, name) {
    const normalizedName = requireName(name, "Playlist name");
    const id = randomUUID();
    const timestamp = now();
    try {
      this.db.prepare(`INSERT INTO playlists(id, guild_id, user_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, String(guildId), String(userId), normalizedName, timestamp, timestamp);
    } catch (error) {
      if (String(error.code).includes("CONSTRAINT")) {
        throw new Error("You already have a playlist with that name in this server.");
      }
      throw error;
    }
    return this.getPlaylistById(id);
  }

  getPlaylistById(id) {
    const row = this.db.prepare("SELECT id, guild_id AS guildId, user_id AS userId, name, visibility, share_token AS shareToken, created_at AS createdAt, updated_at AS updatedAt FROM playlists WHERE id = ?")
      .get(String(id));
    if (!row) {
      return null;
    }
    return { ...row, tracks: this.getPlaylistTracks(row.id) };
  }

  getOwnedPlaylist(guildId, userId, name) {
    const row = this.db.prepare(`SELECT id, guild_id AS guildId, user_id AS userId, name, visibility, share_token AS shareToken, created_at AS createdAt, updated_at AS updatedAt
      FROM playlists WHERE guild_id = ? AND user_id = ? AND name = ? COLLATE NOCASE`)
      .get(String(guildId), String(userId), requireName(name, "Playlist name"));
    return row ? { ...row, tracks: this.getPlaylistTracks(row.id) } : null;
  }

  getAccessiblePlaylist(guildId, userId, name) {
    const row = this.db.prepare(`SELECT id, guild_id AS guildId, user_id AS userId, name, visibility, share_token AS shareToken, created_at AS createdAt, updated_at AS updatedAt
      FROM playlists WHERE guild_id = ? AND name = ? COLLATE NOCASE AND (user_id = ? OR visibility = 'shared')
      ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END LIMIT 1`)
      .get(String(guildId), requireName(name, "Playlist name"), String(userId), String(userId));
    return row ? { ...row, tracks: this.getPlaylistTracks(row.id) } : null;
  }

  getPlaylistByShareToken(token) {
    const row = this.db.prepare(`SELECT id, guild_id AS guildId, user_id AS userId, name, visibility, share_token AS shareToken, created_at AS createdAt, updated_at AS updatedAt
      FROM playlists WHERE share_token = ? AND visibility = 'shared'`)
      .get(String(token));
    return row ? { ...row, tracks: this.getPlaylistTracks(row.id) } : null;
  }

  listPlaylists(guildId, userId) {
    return this.db.prepare(`SELECT p.id, p.guild_id AS guildId, p.user_id AS userId, p.name, p.visibility, p.share_token AS shareToken,
        p.created_at AS createdAt, p.updated_at AS updatedAt,
        (SELECT COUNT(*) FROM playlist_tracks t WHERE t.playlist_id = p.id) AS trackCount
      FROM playlists p WHERE p.guild_id = ? AND (p.user_id = ? OR p.visibility = 'shared')
      ORDER BY CASE WHEN p.user_id = ? THEN 0 ELSE 1 END, p.name COLLATE NOCASE`)
      .all(String(guildId), String(userId), String(userId));
  }

  getPlaylistTracks(playlistId) {
    return this.db.prepare("SELECT track_json AS trackJson FROM playlist_tracks WHERE playlist_id = ? ORDER BY position")
      .all(String(playlistId))
      .map((row) => cleanTrack(safeJson(row.trackJson, {})));
  }

  addPlaylistTracks(playlistId, tracks) {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    if (list.length === 0) {
      throw new Error("At least one playable track is required.");
    }
    const existingCount = this.db.prepare("SELECT COUNT(*) AS count FROM playlist_tracks WHERE playlist_id = ?").get(String(playlistId)).count;
    if (existingCount + list.length > 100) {
      throw new Error("A playlist can contain at most 100 tracks.");
    }
    const insert = this.db.prepare("INSERT INTO playlist_tracks(playlist_id, position, track_json) VALUES (?, ?, ?)");
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      list.forEach((track, index) => insert.run(String(playlistId), existingCount + index + 1, JSON.stringify(cleanTrack(track))));
      this.db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(timestamp, String(playlistId));
    });
    transaction.immediate();
    return existingCount + list.length;
  }

  removePlaylistTrack(playlistId, position) {
    const tracks = this.getPlaylistTracks(playlistId);
    if (!Number.isInteger(position) || position < 1 || position > tracks.length) {
      throw new RangeError(`Playlist position must be between 1 and ${tracks.length}.`);
    }
    const removed = tracks.splice(position - 1, 1)[0];
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(String(playlistId));
      const insert = this.db.prepare("INSERT INTO playlist_tracks(playlist_id, position, track_json) VALUES (?, ?, ?)");
      tracks.forEach((track, index) => insert.run(String(playlistId), index + 1, JSON.stringify(cleanTrack(track))));
      this.db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now(), String(playlistId));
    });
    transaction.immediate();
    return removed;
  }

  renamePlaylist(playlistId, newName) {
    const normalizedName = requireName(newName, "Playlist name");
    try {
      this.db.prepare("UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?")
        .run(normalizedName, now(), String(playlistId));
    } catch (error) {
      if (String(error.code).includes("CONSTRAINT")) {
        throw new Error("You already have a playlist with that name in this server.");
      }
      throw error;
    }
    return this.getPlaylistById(playlistId);
  }

  deletePlaylist(playlistId) {
    return this.db.prepare("DELETE FROM playlists WHERE id = ?").run(String(playlistId)).changes > 0;
  }

  sharePlaylist(playlistId) {
    const token = randomBytes(9).toString("base64url");
    this.db.prepare("UPDATE playlists SET visibility = 'shared', share_token = ?, updated_at = ? WHERE id = ?")
      .run(token, now(), String(playlistId));
    return token;
  }

  duplicatePlaylist(guildId, userId, source, newName) {
    const duplicate = this.createPlaylist(guildId, userId, newName);
    if (source.tracks.length > 0) {
      this.addPlaylistTracks(duplicate.id, source.tracks);
    }
    return this.getPlaylistById(duplicate.id);
  }

  addFavorite(guildId, userId, track) {
    const cleaned = cleanTrack(track);
    const key = cleaned.info.uri || `${cleaned.info.sourceName}:${cleaned.info.identifier || cleaned.info.title}`;
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM favorites WHERE guild_id = ? AND user_id = ?")
      .get(String(guildId), String(userId)).count;
    if (count >= 100) {
      throw new Error("Favorites are limited to 100 tracks per listener in this server.");
    }
    return this.db.prepare(`INSERT OR IGNORE INTO favorites(guild_id, user_id, track_key, track_json, created_at)
      VALUES (?, ?, ?, ?, ?)`)
      .run(String(guildId), String(userId), key, JSON.stringify(cleaned), now()).changes > 0;
  }

  removeFavorite(guildId, userId, keyOrQuery) {
    const value = String(keyOrQuery).trim();
    return this.db.prepare(`DELETE FROM favorites WHERE guild_id = ? AND user_id = ? AND
      (track_key = ? OR json_extract(track_json, '$.info.title') = ? COLLATE NOCASE OR json_extract(track_json, '$.info.uri') = ?)`)
      .run(String(guildId), String(userId), value, value, value).changes > 0;
  }

  listFavorites(guildId, userId) {
    return this.db.prepare("SELECT track_json AS trackJson FROM favorites WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 100")
      .all(String(guildId), String(userId))
      .map((row) => cleanTrack(safeJson(row.trackJson, {})));
  }

  addHistory(guildId, userId, track) {
    if (!userId) {
      return;
    }
    const cleaned = cleanTrack(track);
    this.db.prepare("INSERT INTO listening_history(guild_id, user_id, track_json, played_at) VALUES (?, ?, ?, ?)")
      .run(String(guildId), String(userId), JSON.stringify(cleaned), now());
    this.db.prepare(`DELETE FROM listening_history WHERE guild_id = ? AND user_id = ? AND id NOT IN (
      SELECT id FROM listening_history WHERE guild_id = ? AND user_id = ? ORDER BY played_at DESC LIMIT 100
    )`).run(String(guildId), String(userId), String(guildId), String(userId));
  }

  listHistory(guildId, userId, limit = 20) {
    const bounded = Math.max(1, Math.min(50, Math.floor(limit)));
    return this.db.prepare("SELECT track_json AS trackJson, played_at AS playedAt FROM listening_history WHERE guild_id = ? AND user_id = ? ORDER BY played_at DESC LIMIT ?")
      .all(String(guildId), String(userId), bounded)
      .map((row) => ({ ...cleanTrack(safeJson(row.trackJson, {})), playedAt: row.playedAt }));
  }

  saveQueue(guildId, userId, name, tracks) {
    const normalizedName = requireName(name, "Saved queue name");
    if (!Array.isArray(tracks) || tracks.length === 0 || tracks.length > 1000) {
      throw new Error("Save a queue containing between 1 and 1000 tracks.");
    }
    this.db.prepare(`INSERT INTO saved_queues(guild_id, user_id, name, tracks_json, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id, name) DO UPDATE SET tracks_json = excluded.tracks_json, updated_at = excluded.updated_at`)
      .run(String(guildId), String(userId), normalizedName, JSON.stringify(tracks.map(cleanTrack)), now());
  }

  loadQueue(guildId, userId, name) {
    const row = this.db.prepare("SELECT tracks_json AS tracksJson FROM saved_queues WHERE guild_id = ? AND user_id = ? AND name = ? COLLATE NOCASE")
      .get(String(guildId), String(userId), requireName(name, "Saved queue name"));
    return row ? safeJson(row.tracksJson, []).map(cleanTrack) : null;
  }

  listSavedQueues(guildId, userId) {
    return this.db.prepare("SELECT name, json_array_length(tracks_json) AS trackCount, updated_at AS updatedAt FROM saved_queues WHERE guild_id = ? AND user_id = ? ORDER BY name COLLATE NOCASE")
      .all(String(guildId), String(userId));
  }
}

export { cleanTrack as cleanStoredTrack };
