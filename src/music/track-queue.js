function signature(track) {
  const info = track?.info ?? track ?? {};
  return info.uri || `${info.sourceName ?? ""}:${info.identifier ?? info.title ?? ""}`.toLowerCase();
}

export class TrackQueue {
  #items = [];
  #shuffleSnapshot = null;

  constructor(items = []) {
    this.#items = [...items];
  }

  get length() {
    return this.#items.length;
  }

  get isShuffled() {
    return this.#shuffleSnapshot !== null;
  }

  get items() {
    return [...this.#items];
  }

  at(index) {
    return this.#items[index];
  }

  add(tracks, maxSize = 250) {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    if (this.#items.length + list.length > maxSize) {
      throw new Error(`Queue limit reached (${maxSize} upcoming tracks).`);
    }
    this.#items.push(...list);
    this.#shuffleSnapshot = null;
    return list.length;
  }

  addFirst(track, maxSize = 250) {
    if (this.#items.length + 1 > maxSize) {
      throw new Error(`Queue limit reached (${maxSize} upcoming tracks).`);
    }
    this.#items.unshift(track);
    this.#shuffleSnapshot = null;
  }

  takeNext() {
    this.#shuffleSnapshot = null;
    return this.#items.shift() ?? null;
  }

  remove(position) {
    const index = position - 1;
    if (!Number.isInteger(position) || index < 0 || index >= this.#items.length) {
      throw new RangeError(`Queue position must be between 1 and ${this.#items.length}.`);
    }
    this.#shuffleSnapshot = null;
    return this.#items.splice(index, 1)[0];
  }

  move(from, to) {
    this.#assertPosition(from);
    this.#assertPosition(to);
    if (from === to) {
      return this.#items[from - 1];
    }
    const [item] = this.#items.splice(from - 1, 1);
    this.#items.splice(to - 1, 0, item);
    this.#shuffleSnapshot = null;
    return item;
  }

  swap(first, second) {
    this.#assertPosition(first);
    this.#assertPosition(second);
    [this.#items[first - 1], this.#items[second - 1]] = [this.#items[second - 1], this.#items[first - 1]];
    this.#shuffleSnapshot = null;
  }

  clear() {
    const removed = this.#items;
    this.#items = [];
    this.#shuffleSnapshot = null;
    return removed;
  }

  shuffle(random = Math.random) {
    if (this.#items.length < 2) {
      return false;
    }
    this.#shuffleSnapshot = [...this.#items];
    for (let index = this.#items.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [this.#items[index], this.#items[swapIndex]] = [this.#items[swapIndex], this.#items[index]];
    }
    return true;
  }

  unshuffle() {
    if (!this.#shuffleSnapshot) {
      return false;
    }
    this.#items = this.#shuffleSnapshot;
    this.#shuffleSnapshot = null;
    return true;
  }

  reverse() {
    this.#items.reverse();
    this.#shuffleSnapshot = null;
  }

  deduplicate() {
    const seen = new Set();
    const before = this.#items.length;
    this.#items = this.#items.filter((track) => {
      const key = signature(track);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    this.#shuffleSnapshot = null;
    return before - this.#items.length;
  }

  replace(items) {
    this.#items = [...items];
    this.#shuffleSnapshot = null;
  }

  #assertPosition(position) {
    if (!Number.isInteger(position) || position < 1 || position > this.#items.length) {
      throw new RangeError(`Queue position must be between 1 and ${this.#items.length}.`);
    }
  }
}
