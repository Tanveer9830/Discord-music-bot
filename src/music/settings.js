export const DEFAULT_GUILD_SETTINGS = Object.freeze({
  defaultVolume: 75,
  maxVolume: 150,
  djRoleId: null,
  allowedVoiceChannelIds: [],
  allowedTextChannelIds: [],
  maxQueueSize: 250,
  defaultLoop: "off",
  defaultAutoplay: false,
  announceChannelId: null,
  voteSkipMinimum: 2,
  voteSkipPercentage: 0.5,
  idleDisconnectSeconds: 180,
  defaultPreset: "flat",
  stay247: false,
  stayChannelId: null,
  historyEnabled: true,
  djRequiredActions: ["stop", "clear", "remove", "move", "swap", "skipto", "shuffle", "reversequeue", "deduplicate", "loop", "autoplay", "settings", "filter", "volume", "playlist-delete"],
  defaultAnnouncements: false,
});

const loops = new Set(["off", "track", "queue"]);
const presets = new Set(["flat", "rock", "pop", "jazz", "classical", "bassboost"]);

export function normalizeGuildSettings(settings = {}) {
  const input = settings && typeof settings === "object" ? settings : {};
  const maxVolume = clampInteger(input.maxVolume, DEFAULT_GUILD_SETTINGS.maxVolume, 1, 1000);
  const defaultVolume = clampInteger(input.defaultVolume, DEFAULT_GUILD_SETTINGS.defaultVolume, 0, maxVolume);
  return {
    ...DEFAULT_GUILD_SETTINGS,
    ...input,
    defaultVolume,
    maxVolume,
    maxQueueSize: clampInteger(input.maxQueueSize, DEFAULT_GUILD_SETTINGS.maxQueueSize, 1, 1000),
    djRoleId: /^\d{15,22}$/.test(String(input.djRoleId ?? "")) ? String(input.djRoleId) : null,
    defaultLoop: loops.has(input.defaultLoop) ? input.defaultLoop : DEFAULT_GUILD_SETTINGS.defaultLoop,
    defaultAutoplay: Boolean(input.defaultAutoplay),
    announceChannelId: /^\d{15,22}$/.test(String(input.announceChannelId ?? "")) ? String(input.announceChannelId) : null,
    voteSkipMinimum: clampInteger(input.voteSkipMinimum, DEFAULT_GUILD_SETTINGS.voteSkipMinimum, 1, 100),
    voteSkipPercentage: clampNumber(input.voteSkipPercentage, DEFAULT_GUILD_SETTINGS.voteSkipPercentage, 0.1, 1),
    idleDisconnectSeconds: clampInteger(input.idleDisconnectSeconds, DEFAULT_GUILD_SETTINGS.idleDisconnectSeconds, 0, 86400),
    defaultPreset: presets.has(input.defaultPreset) ? input.defaultPreset : DEFAULT_GUILD_SETTINGS.defaultPreset,
    stay247: Boolean(input.stay247),
    stayChannelId: /^\d{15,22}$/.test(String(input.stayChannelId ?? "")) ? String(input.stayChannelId) : null,
    historyEnabled: input.historyEnabled !== false,
    djRequiredActions: normalizeActions(input.djRequiredActions),
    allowedVoiceChannelIds: normalizeIds(input.allowedVoiceChannelIds),
    allowedTextChannelIds: normalizeIds(input.allowedTextChannelIds),
  };
}

export function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map(String).filter((id) => /^\d{15,22}$/.test(id)))];
}

function normalizeActions(value) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_GUILD_SETTINGS.djRequiredActions];
  }
  return [...new Set(value.map((action) => String(action).trim().toLowerCase()).filter((action) => /^[a-z-]{2,32}$/.test(action)))];
}

export { loops as loopModes, presets as equalizerPresets };
