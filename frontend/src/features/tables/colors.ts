/** Colors of the options of a select or status column. Mirrors backend `fields/types.py`. */

import type { SelectOption } from "./schema";

/** The Standard tab of the color dialog. The server gives new options these colors in turn. */
export const PALETTE: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Red", hex: "#e5484d" },
  { name: "Orange", hex: "#f76808" },
  { name: "Amber", hex: "#f5a623" },
  { name: "Yellow", hex: "#e5c100" },
  { name: "Green", hex: "#46a758" },
  { name: "Teal", hex: "#12a594" },
  { name: "Sky", hex: "#0b9cd8" },
  { name: "Blue", hex: "#3e63dd" },
  { name: "Violet", hex: "#6e56cf" },
  { name: "Pink", hex: "#d6409f" },
  { name: "Gray", hex: "#8b97a3" },
  { name: "Slate", hex: "#3d4852" },
];

/** What a status option looks like until somebody picks a color: the color of its kind. */
export const KIND_COLORS: Readonly<Record<string, string>> = {
  todo: "#8b97a3",
  in_progress: "#3e63dd",
  review: "#f5a623",
  done: "#46a758",
  paused: "#6e56cf",
  blocked: "#e5484d",
};

export type Rgb = [number, number, number];

export function parseHex(text: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: Rgb): string {
  return "#" + rgb.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
}

export function isHex(text: unknown): text is string {
  return typeof text === "string" && /^#[0-9a-f]{6}$/i.test(text);
}

export type Hsv = { h: number; s: number; v: number };

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g] = [c, x];
  else if (hp < 2) [r, g] = [x, c];
  else if (hp < 3) [g, b] = [c, x];
  else if (hp < 4) [g, b] = [x, c];
  else if (hp < 5) [r, b] = [x, c];
  else [r, b] = [c, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** `hue` is kept when the color has none (gray), so dragging does not jump back to red. */
export function rgbToHsv([red, green, blue]: Rgb, hue = 0): Hsv {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = hue;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * The text color for a label on this fill: black or white, whichever has the higher contrast.
 * The best of the two is never below about 4.6:1, so any color somebody types stays readable.
 */
export function inkFor(hex: string): { color: "#000000" | "#ffffff"; ratio: number } {
  const rgb = parseHex(hex) ?? [128, 128, 128];
  const l = luminance(rgb);
  const onBlack = (l + 0.05) / 0.05;
  const onWhite = 1.05 / (l + 0.05);
  return onBlack >= onWhite
    ? { color: "#000000", ratio: onBlack }
    : { color: "#ffffff", ratio: onWhite };
}

/** The fill of an option: its own color when it is a hex color, else its kind's, else the palette's. */
export function optionColor(option: SelectOption, index: number): string {
  if (isHex(option.color)) return option.color.toLowerCase();
  if (option.kind && KIND_COLORS[option.kind]) return KIND_COLORS[option.kind];
  return PALETTE[index % PALETTE.length].hex;
}
