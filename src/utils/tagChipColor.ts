const TAG_PRESETS = [
  "blue",
  "cyan",
  "green",
  "gold",
  "orange",
  "purple",
  "geekblue",
  "magenta",
  "red",
  "lime",
  "volcano",
] as const;

/**
 * Maps an arbitrary tag string to an Ant Design Vue `a-tag` preset so chips
 * stay readable (preset names are invalid for random user strings).
 */
export function tagChipColor(name: string): (typeof TAG_PRESETS)[number] {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = name.charCodeAt(i) + ((h << 5) - h);
  }
  return TAG_PRESETS[Math.abs(h) % TAG_PRESETS.length];
}
