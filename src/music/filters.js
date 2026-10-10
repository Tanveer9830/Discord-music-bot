const bands = Object.freeze({
  flat: [],
  rock: [
    [-0.1, 0.1], [-0.08, 0.2], [0.05, 0.25], [0.12, 0.2], [0.08, 0.15], [0.02, 0.05], [0.05, 0.15], [0.1, 0.2], [0.12, 0.25], [0.08, 0.2], [0.05, 0.1], [0, 0.05], [-0.02, 0], [-0.05, 0], [-0.08, 0],
  ],
  pop: [
    [0.15, 0.25], [0.12, 0.2], [0.08, 0.1], [0.02, 0.05], [-0.04, 0], [-0.06, 0], [0, 0.05], [0.08, 0.1], [0.12, 0.15], [0.1, 0.15], [0.08, 0.1], [0.04, 0.05], [0, 0.05], [-0.02, 0], [-0.04, 0],
  ],
  jazz: [
    [0.1, 0.15], [0.08, 0.1], [0.05, 0.05], [0.02, 0.05], [-0.02, 0], [-0.04, 0], [0, 0.05], [0.04, 0.1], [0.08, 0.15], [0.08, 0.15], [0.05, 0.1], [0.02, 0.05], [0, 0.05], [0, 0.05], [0, 0.05],
  ],
  classical: [
    [0.08, 0.1], [0.05, 0.05], [0.02, 0.05], [0.02, 0.05], [0, 0.02], [0, 0.02], [0, 0.02], [0.02, 0.05], [0.04, 0.08], [0.05, 0.1], [0.08, 0.12], [0.08, 0.12], [0.05, 0.1], [0.02, 0.05], [0, 0.02],
  ],
  bassboost: [
    [0.6, 0.7], [0.55, 0.65], [0.45, 0.55], [0.3, 0.4], [0.15, 0.25], [0.05, 0.15], [0, 0.05], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0],
  ],
});

const supportedFilters = new Map([
  ["equalizer", "equalizer"],
  ["bassboost", "equalizer"],
  ["karaoke", "karaoke"],
  ["timescale", "timescale"],
  ["nightcore", "timescale"],
  ["vaporwave", "timescale"],
  ["8d", "rotation"],
  ["rotation", "rotation"],
  ["lowpass", "lowPass"],
  ["distortion", "distortion"],
  ["channelmix", "channelMix"],
  ["tremolo", "tremolo"],
  ["vibrato", "vibrato"],
]);

export function buildEqualizer(preset) {
  return equalizerBands(preset);
}

export function equalizerBands(preset) {
  const value = String(preset).toLowerCase();
  if (!Object.hasOwn(bands, value)) {
    throw new Error(`Unknown equalizer preset '${preset}'.`);
  }
  return bands[value].map(([gain], band) => ({ band, gain }));
}

export function equalizerPresetNames() {
  return Object.keys(bands);
}

export function resolveFilterCapability(filterName) {
  return supportedFilters.get(String(filterName).toLowerCase()) ?? null;
}

export function presetFilter(preset) {
  switch (String(preset).toLowerCase()) {
    case "flat":
      return {};
    case "bassboost":
      return { equalizer: equalizerBands("bassboost") };
    case "nightcore":
      return { timescale: { speed: 1.15, pitch: 1.15, rate: 1 } };
    case "vaporwave":
      return { timescale: { speed: 0.85, pitch: 0.8, rate: 1 } };
    case "karaoke":
      return { karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 } };
    case "8d":
      return { rotation: { rotationHz: 0.2 } };
    case "lowpass":
      return { lowPass: { smoothing: 20 } };
    case "rock":
    case "pop":
    case "jazz":
    case "classical":
      return { equalizer: equalizerBands(preset) };
    default:
      throw new Error(`Unknown audio preset '${preset}'.`);
  }
}

export function clearFilter(filters, filterName) {
  const capability = resolveFilterCapability(filterName);
  if (!capability) {
    throw new Error(`Unsupported Lavalink filter '${filterName}'.`);
  }
  const next = { ...filters };
  delete next[capability];
  return next;
}
