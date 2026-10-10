const supportedHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "m.youtube.com",
  "soundcloud.com",
  "www.soundcloud.com",
  "m.soundcloud.com",
  "on.soundcloud.com",
  "bandcamp.com",
  "twitch.tv",
  "www.twitch.tv",
  "vimeo.com",
  "www.vimeo.com",
]);

export function validateSearchQuery(query) {
  const normalized = String(query ?? "").trim();
  if (!normalized) {
    throw new Error("Enter a song name, artist, or supported music URL.");
  }
  if (normalized.length > 200) {
    throw new Error("Search text must be 200 characters or fewer.");
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("Search text contains unsupported control characters.");
  }
  return normalized;
}

export function validateTrackReference(query) {
  const normalized = validateSearchQuery(query);
  let url;
  try {
    url = new URL(normalized);
  } catch {
    return { kind: "search", query: normalized };
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("Only HTTP or HTTPS music URLs are supported.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "spotify.com" || host.endsWith(".spotify.com")) {
    throw new Error("Spotify links provide metadata, not an audio stream here. Use a supported audio URL or search for the track title.");
  }
  if (!supportedHosts.has(host)) {
    throw new Error(`Unsupported music URL host: ${host}. Try YouTube, SoundCloud, Bandcamp, Twitch, or Vimeo, or enter a text search.`);
  }
  return { kind: "url", query: url.toString(), host };
}

export function buildResolverIdentifier(query, searchPrefix = "ytsearch") {
  const reference = validateTrackReference(query);
  if (reference.kind === "url") {
    return reference.query;
  }
  return `${searchPrefix}:${reference.query}`;
}

export function normalizeLoadedTracks(result) {
  if (!result || typeof result !== "object") {
    return { type: "empty", tracks: [] };
  }
  switch (result.loadType) {
    case "track":
      return { type: "track", tracks: [result.data] };
    case "search":
      return { type: "search", tracks: Array.isArray(result.data) ? result.data : [] };
    case "playlist":
      return { type: "playlist", tracks: Array.isArray(result.data?.tracks) ? result.data.tracks : [], name: result.data?.info?.name };
    case "empty":
      return { type: "empty", tracks: [] };
    case "error":
      return { type: "error", tracks: [], message: result.data?.message || "The audio source could not load that track." };
    default:
      return { type: "empty", tracks: [] };
  }
}

export { supportedHosts };
