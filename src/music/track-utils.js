export function trackTitle(track) {
  return String(track?.info?.title ?? "Unknown track");
}

export function trackArtist(track) {
  return String(track?.info?.author ?? "Unknown artist");
}

export function trackUrl(track) {
  return track?.info?.uri ? String(track.info.uri) : "";
}

export function trackKey(track) {
  const info = track?.info ?? {};
  return String(info.uri || `${info.sourceName ?? ""}:${info.identifier ?? info.title ?? ""}`).toLowerCase();
}

export function queueTrack(track, requester = null) {
  if (!track?.info || (!track.encoded && !track.info.uri && !track.query)) {
    throw new Error("The audio source returned a track without playable data.");
  }
  return {
    encoded: track.encoded ?? "",
    info: { ...track.info },
    requester: requester ? { id: String(requester.id), tag: String(requester.tag ?? requester.username ?? "Listener") } : null,
  };
}

export function exportableTrack(track) {
  const info = track?.info ?? {};
  return {
    title: String(info.title ?? "Unknown track"),
    artist: String(info.author ?? "Unknown artist"),
    url: info.uri ? String(info.uri) : "",
    source: String(info.sourceName ?? "unknown"),
  };
}

export function playlistTrackToSearch(track) {
  return track?.info?.uri || track?.query || "";
}
