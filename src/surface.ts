/**
 * The play surface, drawn as a single SVG data URI.
 *
 * Colour constraint: Raycast's markdown sanitises every HTML colouring
 * technique, so per-character colour is only reachable through an image; SVG is
 * the one image format cheap enough to rebuild on every keystroke (<1ms).
 * Layout constraint: markdown has no side-by-side/overlay constructs, so the
 * whole game lives in this one image, with compiled PNGs embedded as <image>.
 *
 * Design: in-line metamorphosis. The active line is STATIC (typing games need a
 * still target — the eye reads 7–13 characters ahead). Its typed prefix is not
 * merely recoloured: at each stable token boundary the prefix is REPLACED by
 * its LaTeX-typeset image, so the line turns from code into mathematics under
 * the caret, left to right. Everything is precompiled, so the swap is instant.
 *
 *   prose (faint)
 *   ┌ document: grows one line per line-clear ┐
 *   └─────────────────────────────────────────┘
 *   [typeset frag][green src][red][▏][grey src]   ← active line, static
 *   next line (faint)
 *   COMBO …  行 k/N ▓▓░░  WPM …  ACC …
 */

import { readFileSync, statSync } from "fs";

const FONT = '"SF Mono", Menlo, ui-monospace, monospace';
const UI_FONT = "-apple-system, BlinkMacSystemFont, Helvetica, sans-serif";

const MARGIN_X = 36;
const MARGIN_Y = 22;

/** Active-line source glyphs. */
const SRC_SIZE = 20;
const SRC_W = SRC_SIZE * 0.6;
const ACTIVE_H = 44;

const PROSE_SIZE = 12.5;
/**
 * Same size as the active line — like the official Typing Practice, hierarchy
 * between "now" and "next" is carried by opacity alone, not by font size (two
 * sizes read as two different UI elements instead of one flowing text).
 */
const PREVIEW_SIZE = SRC_SIZE;
const STATS_H = 26;

/** Colours chosen to stay legible against both the light and dark Raycast themes. */
const C = {
  pending: "#8a8a96",
  correct: "#22c55e",
  wrongText: "#fee2e2",
  wrongBg: "#b91c1c",
  caret: "#f59e0b",
  faint: "#9a9aa4",
  stats: "#82828e",
  combo: "#f59e0b",
  track: "#55555f",
};

export type Stats = {
  wpm: number;
  accuracy: number;
  combo: number;
  doneLines: number;
  totalLines: number;
  seconds: number;
  finished: boolean;
};

export type SurfaceInput = {
  /** English prose of the theorem being typeset. */
  prose: string;
  /** Cumulative document image for the lines cleared so far (may lag a line). */
  docPng?: string;
  /** Typeset image of the active line's stable prefix, when one exists. */
  fragPng?: string;
  /** Source between the last stable boundary and the caret — correct, awaiting metamorphosis. */
  greenSrc: string;
  /** Mistyped characters queued at the caret. */
  surplus: string;
  /** Untyped remainder of the active line. */
  graySrc: string;
  /** Goals of the lines still to come, nearest first — drawn in a fading ladder. */
  upcoming: string[];
  /** True for a couple of frames right after a line clears. */
  flash?: boolean;
  stats: Stats;
  width: number;
  height: number;
};

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Read a PNG's intrinsic size straight out of its IHDR chunk. */
function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/**
 * PNGs are re-embedded on every keystroke but only change on precompile-land or
 * line-clear; a small cache keeps the per-keystroke cost at string assembly.
 */
const pngCache = new Map<string, { base64: string; w: number; h: number }>();

function loadPng(path: string): { base64: string; w: number; h: number } | null {
  const hit = pngCache.get(path);
  if (hit) return hit;
  try {
    if (statSync(path).size === 0) return null;
    const buf = readFileSync(path);
    const size = pngSize(buf);
    if (!size || size.w <= 0 || size.h <= 0) return null;
    const entry = { base64: buf.toString("base64"), w: size.w, h: size.h };
    pngCache.set(path, entry);
    if (pngCache.size > 40) {
      // Drop the oldest entries; insertion order is good enough here.
      for (const key of pngCache.keys()) {
        if (pngCache.size <= 24) break;
        pngCache.delete(key);
      }
    }
    return entry;
  } catch {
    return null;
  }
}

function text(x: number, y: number, s: string, size: number, color: string, opacity = 1, font = FONT): string {
  return (
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${color}" opacity="${opacity}" ` +
    `font-family='${font}' font-size="${size}" xml:space="preserve">${escapeXml(s)}</text>`
  );
}

function image(x: number, y: number, w: number, h: number, base64: string): string {
  const uri = `data:image/png;base64,${base64}`;
  return (
    `<image x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
    `href="${uri}" xlink:href="${uri}"/>`
  );
}

export function renderSurface(input: SurfaceInput): string {
  const { prose, docPng, fragPng, greenSrc, surplus, graySrc, upcoming, flash, stats, width, height } = input;
  const parts: string[] = [];
  const availW = width - MARGIN_X * 2;

  // ---- prose, faint, up to two rows ----------------------------------------
  let y = MARGIN_Y;
  const proseCols = Math.floor(availW / (PROSE_SIZE * 0.52));
  const proseRows: string[] = [];
  let rest = prose.replace(/\s+/g, " ").trim();
  while (rest.length > 0 && proseRows.length < 2) {
    if (rest.length <= proseCols) {
      proseRows.push(rest);
      rest = "";
    } else {
      let cut = rest.lastIndexOf(" ", proseCols);
      if (cut < proseCols / 2) cut = proseCols;
      proseRows.push(proseRows.length === 1 && rest.length > cut ? rest.slice(0, cut - 1) + "…" : rest.slice(0, cut));
      rest = rest.slice(cut + 1);
    }
  }
  for (const row of proseRows) {
    parts.push(text(MARGIN_X, y + PROSE_SIZE, row, PROSE_SIZE, C.faint, 0.7, UI_FONT));
    y += PROSE_SIZE + 4;
  }
  y += 6;

  // ---- document + active line, flowing like a real document -----------------
  // The active line starts right under the prose and DESCENDS as the document
  // grows above it — like typing at the end of a page. Once it reaches its
  // floor it stays put and the document tail-crops instead.
  // Reserve at least one upcoming row below the active line; the fading ladder
  // then fills whatever space actually remains.
  const previewH = upcoming.length > 0 && !stats.finished ? PREVIEW_SIZE + 14 : 0;
  const maxActiveTop = height - MARGIN_Y - STATS_H - previewH - ACTIVE_H;

  const doc = docPng ? loadPng(docPng) : null;
  let docH = 0;
  let docW = 0;
  let docScale = 1;
  if (doc) {
    const budget = maxActiveTop - 12 - y;
    docScale = Math.min(availW / doc.w, Math.max(20, budget) / doc.h, 1);
    docW = doc.w * docScale;
    docH = doc.h * docScale;
  }

  if (stats.finished) {
    // The score must not depend on the final document compile having succeeded.
    let scoreY = height / 2;
    if (doc) {
      const scale = Math.min(availW / doc.w, (height - MARGIN_Y * 2 - 44) / doc.h, 1);
      const w = doc.w * scale;
      const h = doc.h * scale;
      const top = Math.max(y, (height - h - 44) / 2);
      parts.push(image(MARGIN_X, top, w, h, doc.base64));
      scoreY = top + h + 32;
    }
    const score = `${stats.wpm} WPM ・ 正確さ ${stats.accuracy}% ・ ${stats.seconds.toFixed(1)}秒`;
    parts.push(
      `<text x="${width / 2}" y="${scoreY.toFixed(1)}" fill="${C.correct}" text-anchor="middle" ` +
        `font-family='${UI_FONT}' font-size="16">${escapeXml(score)}</text>`,
    );
    const svgDone =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svgDone, "utf8").toString("base64")}`;
  }

  const activeTop = Math.min(y + docH + (docH > 0 ? 12 : 0), maxActiveTop);
  if (doc && docH > 0) {
    // The document's bottom edge hugs the active line.
    parts.push(image(MARGIN_X, activeTop - 12 - docH, docW, docH, doc.base64));
  }
  const statsTop = height - MARGIN_Y - STATS_H + 10;

  // ---- line-clear flash ------------------------------------------------------
  // Two-frame celebration: a soft green wash behind the play row plus a bright
  // seam under the document — the freshly committed line literally glows.
  if (flash) {
    parts.push(
      `<rect x="${MARGIN_X - 10}" y="${activeTop - 4}" width="${availW + 20}" height="${ACTIVE_H + 8}" ` +
        `rx="8" fill="${C.correct}" opacity="0.10"/>`,
    );
    parts.push(
      `<rect x="${MARGIN_X}" y="${(activeTop - 10).toFixed(1)}" width="${availW}" height="2.5" rx="1.25" ` +
        `fill="${C.correct}" opacity="0.55"/>`,
    );
  }

  // ---- active line: [frag][green][red surplus][caret][grey] -----------------
  const rowMid = activeTop + ACTIVE_H / 2;
  const srcBaseline = rowMid + SRC_SIZE / 2 - 3;
  let x = MARGIN_X;

  const frag = fragPng ? loadPng(fragPng) : null;
  if (frag) {
    // Natural size caps at the row height; long fragments also give way so the
    // green/grey source always keeps at least a third of the row.
    const maxH = ACTIVE_H - 6;
    const maxW = availW * 0.66;
    const scale = Math.min(maxH / frag.h, maxW / frag.w, 1);
    const w = frag.w * scale;
    const h = frag.h * scale;
    parts.push(image(x, rowMid - h / 2, w, h, frag.base64));
    x += w + SRC_W * 0.6;
  }

  if (greenSrc.length > 0) {
    // Clamp the green run so it can never push the caret off-canvas: keep the
    // TAIL (the part nearest the caret), elide the head.
    const reserved = (surplus.length + 10) * SRC_W;
    const room = Math.max(4, Math.floor((width - MARGIN_X - x - reserved) / SRC_W));
    const shown = greenSrc.length > room ? "…" + greenSrc.slice(greenSrc.length - room + 1) : greenSrc;
    parts.push(text(x, srcBaseline, shown, SRC_SIZE, C.correct));
    x += shown.length * SRC_W;
  }

  for (const ch of surplus) {
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${(rowMid - SRC_SIZE / 2 - 4).toFixed(1)}" width="${SRC_W.toFixed(1)}" ` +
        `height="${SRC_SIZE + 8}" fill="${C.wrongBg}"/>`,
    );
    parts.push(text(x, srcBaseline, ch === " " ? "␣" : ch, SRC_SIZE, C.wrongText));
    x += SRC_W;
  }

  parts.push(
    `<rect x="${x.toFixed(1)}" y="${(rowMid - SRC_SIZE / 2 - 5).toFixed(1)}" width="3" ` +
      `height="${SRC_SIZE + 10}" fill="${C.caret}" rx="1.5"/>`,
  );
  x += 6;

  if (graySrc.length > 0) {
    const room = Math.floor((width - MARGIN_X - x) / SRC_W);
    const shown = graySrc.length > room ? graySrc.slice(0, Math.max(0, room - 1)) + "…" : graySrc;
    parts.push(text(x, srcBaseline, shown, SRC_SIZE, C.pending));
  }

  // ---- upcoming lines: a fading ladder --------------------------------------
  // A typing game needs the road ahead visible. Every remaining line is drawn,
  // fading with distance, until the space above the stats strip runs out — the
  // closest line is clearly readable, the far ones are just "there's more".
  if (upcoming.length > 0) {
    const ROW_H = PREVIEW_SIZE + 10;
    const cols = Math.floor(availW / (PREVIEW_SIZE * 0.6));
    let uy = activeTop + ACTIVE_H + PREVIEW_SIZE + 2;
    // The floor accounts for glyph descent, so the last row's tails cannot
    // brush the stats strip.
    const floor = height - MARGIN_Y - STATS_H - PREVIEW_SIZE * 0.3;
    for (let i = 0; i < upcoming.length && uy < floor; i++) {
      const opacity = Math.max(0.14, 0.5 - i * 0.09);
      const line = upcoming[i];
      const shown = line.length > cols ? line.slice(0, cols - 1) + "…" : line;
      parts.push(text(MARGIN_X, uy, shown, PREVIEW_SIZE, C.pending, opacity));
      uy += ROW_H;
    }
  }

  // ---- stats strip ----------------------------------------------------------
  // COMBO escalates in tiers so a streak feels like something to protect.
  const sy = statsTop + 8;
  if (stats.combo >= 2) {
    const tier =
      stats.combo >= 50
        ? { size: 15, color: "#ef4444", label: `🔥COMBO ${stats.combo}` }
        : stats.combo >= 25
          ? { size: 14, color: "#f97316", label: `COMBO ${stats.combo}` }
          : stats.combo >= 10
            ? { size: 13, color: C.combo, label: `COMBO ${stats.combo}` }
            : { size: 12, color: C.stats, label: `COMBO ${stats.combo}` };
    parts.push(text(MARGIN_X, sy, tier.label, tier.size, tier.color, 1, UI_FONT));
  }
  parts.push(
    text(MARGIN_X + 110, sy, `行 ${stats.doneLines}/${stats.totalLines}`, 12, C.stats, 1, UI_FONT),
  );
  const barX = MARGIN_X + 190;
  const barW = 150;
  const frac = stats.totalLines > 0 ? stats.doneLines / stats.totalLines : 0;
  parts.push(`<rect x="${barX}" y="${sy - 9}" width="${barW}" height="7" rx="3.5" fill="${C.track}" opacity="0.5"/>`);
  parts.push(
    `<rect x="${barX}" y="${sy - 9}" width="${(barW * frac).toFixed(1)}" height="7" rx="3.5" fill="${C.correct}"/>`,
  );
  parts.push(
    text(barX + barW + 26, sy, `${stats.wpm} WPM   ${stats.accuracy}%   ${stats.seconds.toFixed(0)}s`, 12, C.stats, 1, UI_FONT),
  );

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
