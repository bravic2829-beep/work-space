"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

import {
  hsvToRgb,
  inkFor,
  PALETTE,
  parseHex,
  rgbToHsv,
  toHex,
  type Hsv,
  type Rgb,
} from "./colors";

type Props = {
  /** The color the option has now (a hex color). */
  current: string;
  /** OK: the new color. */
  onPick: (hex: string) => void;
  onCancel: () => void;
  /** Names the dialog for screen readers, for example the option it colors. */
  label: string;
};

function clamp(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, n));
}

/**
 * A color dialog with two tabs: Standard (the palette) and Custom (a spectrum with RGB and hex),
 * and the new color beside the current one. The spectrum is plain CSS gradients, so it needs
 * no canvas. OK keeps the color, Cancel leaves the option as it was.
 */
export function ColorPicker({ current, onPick, onCancel, label }: Props) {
  const start = parseHex(current) ?? [62, 99, 221];
  const [tab, setTab] = useState<"standard" | "custom">("standard");
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(start));
  const [rgb, setRgb] = useState<Rgb>(start);
  const [hexText, setHexText] = useState(toHex(start));

  const hex = toHex(rgb);
  const ink = inkFor(hex);

  function setFromRgb(next: Rgb, keepText = false) {
    setRgb(next);
    setHsv((before) => rgbToHsv(next, before.h));
    if (!keepText) setHexText(toHex(next));
  }

  function setFromHsv(next: Hsv) {
    setHsv(next);
    const converted = hsvToRgb(next);
    setRgb(converted);
    setHexText(toHex(converted));
  }

  function drag(apply: (x: number, y: number) => void) {
    return (event: React.PointerEvent<HTMLElement>) => {
      const element = event.currentTarget;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Not every environment can capture the pointer; dragging still works inside the box.
      }
      const run = (e: { clientX: number; clientY: number }) => {
        const box = element.getBoundingClientRect();
        apply(
          clamp((e.clientX - box.left) / (box.width || 1), 0, 1),
          clamp((e.clientY - box.top) / (box.height || 1), 0, 1),
        );
      };
      run(event);
      const move = (e: PointerEvent) => run(e);
      const up = () => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", up);
        element.removeEventListener("pointercancel", up);
      };
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", up);
      element.addEventListener("pointercancel", up);
    };
  }

  const hueStops = [0, 60, 120, 180, 240, 300, 360]
    .map((h) => toHex(hsvToRgb({ h, s: 1, v: hsv.v })))
    .join(", ");
  const gray = toHex(hsvToRgb({ h: 0, s: 0, v: hsv.v }));
  const top = toHex(hsvToRgb({ h: hsv.h, s: hsv.s, v: 1 }));

  return (
    <div
      role="group"
      aria-label={`Color of ${label}`}
      className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3 p-3"
    >
      <div className="grid min-w-0 gap-3">
        <div role="tablist" aria-label="Color source" className="flex gap-1 border-b border-line">
          {(["standard", "custom"] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={cn(
                "-mb-px cursor-pointer rounded-t-md border border-b-0 px-3 py-1 text-sm",
                tab === name
                  ? "border-line bg-surface font-semibold text-fg"
                  : "border-transparent bg-transparent text-muted",
              )}
            >
              {name === "standard" ? "Standard" : "Custom"}
            </button>
          ))}
        </div>

        {tab === "standard" ? (
          <div role="tabpanel" aria-label="Standard colors" className="grid grid-cols-6 gap-2">
            {PALETTE.map((color) => (
              <button
                key={color.hex}
                type="button"
                aria-label={`${color.name} ${color.hex}`}
                aria-pressed={hex === color.hex}
                onClick={() => setFromRgb(parseHex(color.hex) ?? rgb)}
                className={cn(
                  "aspect-square cursor-pointer rounded-md border border-line p-0",
                  hex === color.hex && "outline-2 outline-offset-2 outline-fg",
                )}
                style={{ backgroundColor: color.hex }}
              />
            ))}
          </div>
        ) : (
          <div role="tabpanel" aria-label="Custom color" className="grid gap-3">
            <div className="flex items-stretch gap-2.5">
              <div
                aria-label="Hue and saturation"
                className="relative aspect-[8/5] min-w-0 flex-1 cursor-crosshair touch-none border border-line"
                style={{
                  backgroundImage: `linear-gradient(to bottom, ${gray}00, ${gray}), linear-gradient(to right, ${hueStops})`,
                }}
                onPointerDown={drag((x, y) =>
                  setFromHsv({ h: x * 359.99, s: 1 - y, v: hsv.v }),
                )}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#000]"
                  style={{ left: `${(hsv.h / 360) * 100}%`, top: `${(1 - hsv.s) * 100}%` }}
                />
              </div>
              <div
                aria-label="Brightness"
                className="relative w-5 shrink-0 cursor-pointer touch-none border border-line"
                style={{ backgroundImage: `linear-gradient(to bottom, ${top}, #000000)` }}
                onPointerDown={drag((_x, y) =>
                  setFromHsv({ h: hsv.h, s: hsv.s, v: 1 - y }),
                )}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-2 size-0 -translate-y-1/2 border-y-[5px] border-r-[8px] border-y-transparent border-r-fg"
                  style={{ top: `${(1 - hsv.v) * 100}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-[4.5rem_5rem] items-center gap-x-2 gap-y-1.5 text-sm">
              <span className="col-span-2 text-xs text-muted">Color model: RGB</span>
              {(["Red", "Green", "Blue"] as const).map((name, index) => (
                <label key={name} className="contents">
                  <span>{name}:</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    inputMode="numeric"
                    aria-label={name}
                    value={rgb[index]}
                    onChange={(event) => {
                      if (event.target.value === "") return;
                      const next: Rgb = [...rgb];
                      next[index] = clamp(Math.round(Number(event.target.value)), 0, 255);
                      setFromRgb(next);
                    }}
                    className="w-full rounded border border-line bg-surface-muted px-1.5 py-0.5"
                  />
                </label>
              ))}
              <label className="contents">
                <span>Hex:</span>
                <input
                  type="text"
                  maxLength={7}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Hex"
                  value={hexText}
                  onChange={(event) => {
                    setHexText(event.target.value);
                    const parsed = parseHex(event.target.value);
                    if (parsed) setFromRgb(parsed, true);
                  }}
                  className="w-full rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col items-stretch gap-2">
        <Button size="sm" variant="primary" onClick={() => onPick(hex)}>
          OK
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <div className="mt-auto flex w-full flex-col items-center gap-1 text-xs text-muted">
          <span>New</span>
          <div className="w-full">
            <div
              aria-label={`New color ${hex}`}
              className="h-9 border border-b-0 border-line"
              style={{ backgroundColor: hex }}
            />
            <div
              aria-label={`Current color ${current}`}
              className="h-9 border border-t-0 border-line"
              style={{ backgroundColor: current }}
            />
          </div>
          <span>Current</span>
          <span aria-live="polite" className="text-center">
            {ink.color === "#000000" ? "Black" : "White"} text, {ink.ratio.toFixed(1)}:1
          </span>
        </div>
      </div>
    </div>
  );
}
