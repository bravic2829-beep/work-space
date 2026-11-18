import { describe, expect, it } from "vitest";

import {
  hsvToRgb,
  inkFor,
  isHex,
  KIND_COLORS,
  optionColor,
  PALETTE,
  parseHex,
  rgbToHsv,
  toHex,
} from "./colors";

describe("hex colors", () => {
  it("reads and writes hex", () => {
    expect(parseHex("#3e63dd")).toEqual([62, 99, 221]);
    expect(parseHex(" 3E63DD ")).toEqual([62, 99, 221]);
    expect(toHex([62, 99, 221])).toBe("#3e63dd");
    expect(toHex([0, 0, 0])).toBe("#000000");
  });

  it("refuses what is not a six digit hex", () => {
    for (const bad of ["", "#fff", "#12345", "#1234567", "blue", "#gggggg", "rgb(0,0,0)"]) {
      expect(parseHex(bad)).toBeNull();
    }
    expect(isHex("#abcdef")).toBe(true);
    expect(isHex("red")).toBe(false);
    expect(isHex(undefined)).toBe(false);
  });

  it("converts between RGB and HSV both ways", () => {
    for (const rgb of [
      [255, 0, 0],
      [0, 255, 0],
      [62, 99, 221],
      [128, 128, 128],
      [0, 0, 0],
      [255, 255, 255],
    ] as [number, number, number][]) {
      expect(hsvToRgb(rgbToHsv(rgb))).toEqual(rgb);
    }
    expect(rgbToHsv([255, 0, 0])).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv([0, 0, 255]).h).toBe(240);
  });

  it("keeps the hue of a gray, so dragging down does not jump to red", () => {
    expect(rgbToHsv([100, 100, 100], 222).h).toBe(222);
    expect(rgbToHsv([0, 0, 0], 90).h).toBe(90);
  });
});

describe("the text color on a fill", () => {
  it("is white on dark and black on light", () => {
    expect(inkFor("#000000").color).toBe("#ffffff");
    expect(inkFor("#3d4852").color).toBe("#ffffff");
    expect(inkFor("#ffffff").color).toBe("#000000");
    expect(inkFor("#f5a623").color).toBe("#000000");
  });

  it("never falls below 4.5:1, whatever the color", () => {
    let worst = Infinity;
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          worst = Math.min(worst, inkFor(toHex([r, g, b])).ratio);
        }
      }
    }
    expect(worst).toBeGreaterThan(4.5);
  });

  it("treats a text that is not a color as gray", () => {
    expect(inkFor("nonsense").ratio).toBeGreaterThan(4.5);
  });
});

describe("the color of an option", () => {
  it("is its own color when it is a hex color", () => {
    expect(optionColor({ id: "a", name: "A", color: "#ABCDEF" }, 0)).toBe("#abcdef");
  });

  it("is the color of its kind when it has none", () => {
    expect(optionColor({ id: "a", name: "Done", kind: "done" }, 3)).toBe(KIND_COLORS.done);
    expect(optionColor({ id: "a", name: "Odd", kind: "unknown" }, 0)).toBe(PALETTE[0].hex);
  });

  it("is the next color of the palette otherwise, and wraps around", () => {
    expect(optionColor({ id: "a", name: "A" }, 0)).toBe(PALETTE[0].hex);
    expect(optionColor({ id: "a", name: "A" }, 13)).toBe(PALETTE[1].hex);
  });

  it("ignores a color name, which cannot be drawn reliably", () => {
    expect(optionColor({ id: "a", name: "A", color: "red" }, 2)).toBe(PALETTE[2].hex);
  });

  it("has the same palette and kind colors as the server", () => {
    expect(PALETTE.map((c) => c.hex)).toEqual([
      "#e5484d",
      "#f76808",
      "#f5a623",
      "#e5c100",
      "#46a758",
      "#12a594",
      "#0b9cd8",
      "#3e63dd",
      "#6e56cf",
      "#d6409f",
      "#8b97a3",
      "#3d4852",
    ]);
    expect(KIND_COLORS).toEqual({
      todo: "#8b97a3",
      in_progress: "#3e63dd",
      review: "#f5a623",
      done: "#46a758",
      paused: "#6e56cf",
      blocked: "#e5484d",
    });
  });
});
