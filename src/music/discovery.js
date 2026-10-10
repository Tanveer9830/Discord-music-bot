import { BRANDING } from "../config/branding.js";

let lastMusicBrainzRequest = 0;
let musicBrainzQueue = Promise.resolve();

function musicBrainz(path) {
  const request = musicBrainzQueue.then(async () => {
    const waitMs = Math.max(0, 1050 - (Date.now() - lastMusicBrainzRequest));
    if (waitMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }
    lastMusicBrainzRequest = Date.now();
    const response = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": `TANVEER-PRIME-MUSIC/1.0 (${BRANDING.repository})`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`MusicBrainz metadata request returned HTTP ${response.status}.`);
    }
    return response.json();
  });
  musicBrainzQueue = request.catch(() => {});
  return request;
}

export async function lookupArtist(query) {
  const normalized = String(query ?? "").trim();
  if (!normalized || normalized.length > 100) {
    throw new Error("Artist search text must contain 1 to 100 characters.");
  }
  const data = await musicBrainz(`artist/?query=${encodeURIComponent(normalized)}&fmt=json&limit=5`);
  return Array.isArray(data.artists) ? data.artists : [];
}

export async function lookupAlbum(query) {
  const normalized = String(query ?? "").trim();
  if (!normalized || normalized.length > 150) {
    throw new Error("Album search text must contain 1 to 150 characters.");
  }
  const data = await musicBrainz(`release-group/?query=${encodeURIComponent(normalized)}&fmt=json&limit=5`);
  return Array.isArray(data["release-groups"]) ? data["release-groups"] : [];
}

function cleanTitle(title) {
  return String(title ?? "")
    .replace(/\s*[-[(]\s*(official|audio|lyrics|video|music video|visualizer).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function lookupLyrics(track) {
  const artist = String(track?.info?.author ?? "").split(",")[0].trim();
  const title = cleanTitle(track?.info?.title);
  if (!artist || !title || artist.length > 150 || title.length > 150) {
    throw new Error("There is not enough track metadata to request lyrics.");
  }
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`The lyrics provider returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const lyrics = typeof payload.lyrics === "string" ? payload.lyrics.trim() : "";
  return lyrics || null;
}

export function artistCredit(release) {
  return String(release["artist-credit-phrase"] ?? release["artist-credit"]?.map((credit) => credit.name ?? credit.artist?.name).filter(Boolean).join(", ") ?? "Unknown artist");
}

export function releaseUrl(release) {
  return release.id ? `https://musicbrainz.org/release-group/${encodeURIComponent(release.id)}` : "";
}
