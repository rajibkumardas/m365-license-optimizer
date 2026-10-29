"use client";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const KEYS = ["series-1", "series-2", "grid", "text-2", "text-3", "surface", "border", "text"] as const;
type Colors = Record<(typeof KEYS)[number], string>;

const FALLBACK: Colors = {
  "series-1": "#2a78d6",
  "series-2": "#eb6834",
  grid: "#e3e2de",
  "text-2": "#52514e",
  "text-3": "#7a7974",
  surface: "#fcfcfb",
  border: "#e3e2de",
  text: "#0b0b0b",
};

/** SVG presentation attributes can't take CSS var(), so resolve tokens to hex per theme. */
export function useChartColors(): Colors {
  const { resolvedTheme } = useTheme();
  const [c, setC] = useState<Colors>(FALLBACK);
  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    const out = { ...FALLBACK };
    for (const k of KEYS) out[k] = s.getPropertyValue(`--${k}`).trim() || FALLBACK[k];
    setC(out);
  }, [resolvedTheme]);
  return c;
}
