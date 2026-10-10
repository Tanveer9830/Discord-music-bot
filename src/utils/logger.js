const levels = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const secretKey = /(token|password|secret|authorization|api.?key|credential|cookie)/i;
const tokenPattern = /\b[A-Za-z\d_-]{20,}\.[A-Za-z\d_-]{6,}\.[A-Za-z\d_-]{20,}\b/g;
const assignmentPattern = /\b(token|password|authorization|api[_-]?key)\s*([:=])\s*([^,;\r\n]*)/gi;

function safeText(value) {
  return String(value)
    .replace(tokenPattern, "[REDACTED]")
    .replace(assignmentPattern, "$1$2[REDACTED]");
}

function sanitize(value, key = "", seen = new WeakSet()) {
  if (secretKey.test(key)) {
    return "[REDACTED]";
  }
  if (value instanceof Error) {
    return { name: value.name, message: safeText(value.message) };
  }
  if (typeof value === "string") {
    return safeText(value);
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry, "", seen));
  }
  return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, sanitize(entry, entryKey, seen)]));
}

export function createLogger(level = process.env.LOG_LEVEL ?? "info") {
  const threshold = levels[level] ?? levels.info;
  function write(name, message, fields) {
    if (levels[name] < threshold) {
      return;
    }
    const record = {
      time: new Date().toISOString(),
      level: name,
      message: safeText(message),
      ...(fields && typeof fields === "object" ? sanitize(fields) : {}),
    };
    const line = JSON.stringify(record);
    if (name === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
  return Object.freeze({
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  });
}
