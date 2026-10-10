export function formatDuration(milliseconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function makeProgressBar(position, duration, width = 18) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return "LIVE";
  }
  const ratio = Math.max(0, Math.min(1, position / duration));
  const marker = Math.min(width - 1, Math.floor(ratio * width));
  return `${"━".repeat(marker)}●${"─".repeat(Math.max(0, width - marker - 1))}`;
}

export function truncate(value, max = 100) {
  const text = String(value ?? "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function escapeMarkdown(value = "") {
  return String(value).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}
