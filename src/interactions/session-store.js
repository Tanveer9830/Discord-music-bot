import { randomBytes } from "node:crypto";

export class UiSessionStore {
  #sessions = new Map();

  constructor(ttlMs = 2 * 60 * 1000) {
    if (!Number.isFinite(ttlMs) || ttlMs < 1000) {
      throw new RangeError("UI session lifetime must be at least one second.");
    }
    this.ttlMs = ttlMs;
  }

  create(data, now = Date.now()) {
    this.#prune(now);
    const token = randomBytes(6).toString("base64url");
    this.#sessions.set(token, { ...data, expiresAt: now + this.ttlMs });
    return token;
  }

  get(token, { guildId, userId, type } = {}, now = Date.now()) {
    const session = this.#sessions.get(token);
    if (!session || session.expiresAt <= now) {
      this.#sessions.delete(token);
      return null;
    }
    if ((guildId != null && session.guildId !== guildId)
      || (userId != null && session.userId !== userId)
      || (type != null && session.type !== type)) {
      return null;
    }
    return session;
  }

  delete(token) {
    return this.#sessions.delete(token);
  }

  get size() {
    return this.#sessions.size;
  }

  #prune(now) {
    for (const [token, session] of this.#sessions) {
      if (session.expiresAt <= now) {
        this.#sessions.delete(token);
      }
    }
  }
}
