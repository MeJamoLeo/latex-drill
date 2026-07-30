/**
 * The play surface, drawn as a single SVG data URI.
 *
 * Two constraints shape this file.
 *
 * First, colour: Raycast's markdown sanitises every HTML colouring technique
 * (span/font/mark/u) and does not implement ==highlight==, so per-character
 * colour is only reachable through an image. SVG is the one image format we can
 * rebuild from a string on every keystroke — a full surface costs well under a
 * millisecond, which is what makes debounce-free feedback possible (the LaTeX
 * compile still debounces).
 *
 * Second, layout: markdown has no side-by-side construct. To put the copy pane
 * and the live typeset pane next to each other, both have to live inside one
 * image, so the compiled PNG gets embedded as a nested <image> element.
 */

import { readFileSync, statSync } from "fs";

const FONT = '"SF Mono", Menlo, ui-monospace, monospace';
const UI_FONT = "-apple-system, BlinkMacSystemFont, Helvetica, sans-serif";
/**
 * Sized so the copy pane holds roughly five logical lines: the game is a focus
 * view like monkeytype, not a document editor, and the window slides with the
 * caret anyway. The Grid cell also scales the whole canvas down slightly, so
 * what is drawn here reads one notch smaller on screen.
 */
const FONT_SIZE = 26;
/** Menlo and SF Mono both advance 0.6em per glyph. */
const CHAR_W = FONT_SIZE * 0.6;
const LINE_H = 38;
const PAD = 8;
const HEADER_H = 26;

/** Colours chosen to stay legible against both the light and dark Raycast themes. */
const C = {
  pending: "#8a8a96",
  done: "#5f8a68",
  correct: "#22c55e",
  wrongText: "#fee2e2",
  wrongBg: "#b91c1c",
  caret: "#f59e0b",
  future: "#71717c",
  track: "#55555f",
  // Mid-grey on purpose: the same image is shown on both the light and dark
  // Raycast themes, so anything tuned to one vanishes on the other.
  statsStrong: "#82828e",
  header: "#7a7a86",
  divider: "#4a4a55",
};

export type Stats = {
  wpm: number;
  accuracy: number;
  doneLines: number;
  totalLines: number;
  seconds: number;
  finished: boolean;
};

export type SurfaceInput = {
  /** Reference split into logical lines. */
  lines: string[];
  /** How many logical lines are already complete. */
  doneCount: number;
  /** What is currently typed for the active line. */
  typed: string;
  stats: Stats;
  /** Total image width in points. */
  width: number;
  /** Total image height in points. */
  height: number;
  /** Path to the latest successful typeset PNG, if there is one. */
  typesetPng?: string;
  /** Shown in the typeset pane when the compile is behind the typing. */
  stale?: boolean;
  /**
   * True when typesetPng is the finished reference shown before any typing:
   * rendered dimmed and labelled so it reads as the goal, not as progress.
   */
  ghost?: boolean;
};

type Cell = { ch: string; color: string; bg?: string };

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Read a PNG's intrinsic size straight out of its IHDR chunk. */
function pngSize(buf: Buffer): { w: number; h: number } | null {
  // 8-byte signature, 4-byte length, 4-byte "IHDR", then width and height.
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/**
 * The surface redraws on every keystroke, but the typeset PNG only changes when
 * a compile lands — and each compile writes a fresh filename. Caching the last
 * encoding keeps the per-keystroke cost at pure string assembly.
 */
let pngCache: { path: string; base64: string; w: number; h: number } | null = null;

function loadPng(path: string): { base64: string; w: number; h: number } | null {
  if (pngCache?.path === path) return pngCache;
  try {
    if (statSync(path).size === 0) return null;
    const buf = readFileSync(path);
    const size = pngSize(buf);
    if (!size || size.w <= 0 || size.h <= 0) return null;
    pngCache = { path, base64: buf.toString("base64"), w: size.w, h: size.h };
    return pngCache;
  } catch {
    // A missing or half-written PNG just means "nothing to show yet".
    return null;
  }
}

/**
 * Wrap at word boundaries. Breaking mid-token turns `that` into `th`/`at`, which
 * is exactly the kind of visual noise that makes a typist lose their place.
 * Tokens longer than a row still get split — there is nowhere else to put them.
 */
function wrapWords(cells: Cell[], cols: number): { cells: Cell[]; start: number }[] {
  if (cells.length === 0) return [{ cells: [], start: 0 }];

  // A token is a run of non-spaces plus the spaces trailing it, so breaks land
  // after the whitespace rather than before the next word.
  const tokens: { cells: Cell[]; start: number }[] = [];
  let i = 0;
  while (i < cells.length) {
    const start = i;
    const tok: Cell[] = [];
    while (i < cells.length && cells[i].ch !== " ") tok.push(cells[i++]);
    while (i < cells.length && cells[i].ch === " ") tok.push(cells[i++]);
    tokens.push({ cells: tok, start });
  }

  const rows: { cells: Cell[]; start: number }[] = [];
  let cur: Cell[] = [];
  let curStart = 0;
  const flush = () => {
    rows.push({ cells: cur, start: curStart });
    cur = [];
  };

  for (const tok of tokens) {
    if (cur.length > 0 && cur.length + tok.cells.length > cols) {
      flush();
      curStart = tok.start;
    }
    if (cur.length === 0) curStart = tok.start;

    if (tok.cells.length > cols) {
      // Oversized token: fill the current row, then split across fresh rows.
      let k = 0;
      while (k < tok.cells.length) {
        const room = cols - cur.length;
        const slice = tok.cells.slice(k, k + room);
        if (cur.length === 0) curStart = tok.start + k;
        cur.push(...slice);
        k += slice.length;
        if (cur.length >= cols && k < tok.cells.length) flush();
      }
    } else {
      cur.push(...tok.cells);
    }
  }
  if (cur.length > 0 || rows.length === 0) flush();
  return rows;
}

/**
 * Colour the active line against what has been typed.
 *
 * Unlike monkeytype, the reference text is never replaced by the mistyped
 * characters. Monkeytype lets you barrel on through an error, so showing what you
 * actually hit is the useful thing; here a line has to match before it advances,
 * so painting over the master would hide the very text needed to fix the mistake.
 * The search bar already shows the raw keystrokes — this pane stays the master.
 */
function activeCells(target: string, typed: string): { cells: Cell[]; caret: number } {
  // Leading indentation is the reference's formatting, not LaTeX to practise:
  // it stays visible but is granted for free, and typing starts past it.
  const indent = target.length - target.trimStart().length;
  const goal = target.slice(indent);

  let matched = 0;
  while (matched < typed.length && matched < goal.length && typed[matched] === goal[matched]) matched++;
  const diverged = matched < typed.length;

  const cells: Cell[] = [];
  for (let i = 0; i < indent; i++) cells.push({ ch: target[i], color: C.pending });
  for (let i = 0; i < goal.length; i++) {
    if (i < matched) cells.push({ ch: goal[i], color: C.correct });
    else if (i === matched && diverged) cells.push({ ch: goal[i], color: C.wrongText, bg: C.wrongBg });
    else cells.push({ ch: goal[i], color: C.pending });
  }

  // Typed past the end of the line: show the surplus so it can be deleted.
  if (typed.length > goal.length) {
    for (const ch of typed.slice(goal.length)) {
      cells.push({ ch: ch === " " ? "␣" : ch, color: C.wrongText, bg: C.wrongBg });
    }
  }

  // Park the caret on the next character to type, not past the mistake.
  return { cells, caret: indent + matched };
}

function paneLabel(x: number, y: number, text: string, color = C.header): string {
  return (
    `<text x="${x}" y="${y}" fill="${color}" font-family='${UI_FONT}' font-size="13" ` +
    `letter-spacing="0.4">${escapeXml(text)}</text>`
  );
}

/**
 * Vertical time-axis layout: the proof "becomes" typeset as it is typed.
 *
 *   ┌ header ─ stats ── progress ─ status ┐
 *   │  typeset strip (completed lines,    │  ← bottom-anchored: newest content
 *   │  rendered by LaTeX, tail visible)   │     sits right above the caret
 *   ├─────────────────────────────────────┤
 *   │  active line — coloured source      │  ← the only line being typed
 *   │  next lines — dim source            │  ← what is coming
 *   └─────────────────────────────────────┘
 */
export function renderSurface(input: SurfaceInput): string {
  const { lines, doneCount, typed, stats, width, height, typesetPng, stale, ghost } = input;

  const cols = Math.max(8, Math.floor((width - PAD * 2) / CHAR_W));
  const finished = doneCount >= lines.length;
  const active = finished ? lines.length - 1 : doneCount;

  const parts: string[] = [];

  // ---- header --------------------------------------------------------------
  const hy = PAD + 10;
  const statsLabel = stats.finished
    ? `🎉 完成  ${stats.wpm} WPM  ${stats.accuracy}%  ${stats.seconds.toFixed(1)}s`
    : `${stats.wpm} WPM  ${stats.accuracy}%  ${stats.doneLines}/${stats.totalLines}行  ${stats.seconds.toFixed(1)}s`;
  parts.push(paneLabel(PAD, hy, statsLabel, stats.finished ? C.correct : C.statsStrong));

  const barW = 160;
  const barX = width - PAD - barW - 90;
  const frac = stats.totalLines > 0 ? stats.doneLines / stats.totalLines : 0;
  const barColor = stats.accuracy >= 95 ? C.correct : stats.accuracy >= 85 ? C.caret : C.wrongBg;
  parts.push(`<rect x="${barX}" y="${hy - 7}" width="${barW}" height="7" rx="3.5" fill="${C.track}"/>`);
  parts.push(
    `<rect x="${barX}" y="${hy - 7}" width="${(barW * frac).toFixed(1)}" height="7" rx="3.5" fill="${barColor}"/>`,
  );
  parts.push(
    paneLabel(
      width - PAD - 80,
      hy,
      ghost ? "完成形" : stale ? "組版 ⏳" : "組版済",
      ghost ? C.header : stale ? C.caret : C.header,
    ),
  );

  // ---- bottom source block: active line + what comes next -------------------
  // Built first because its height decides how much room the typeset strip gets.
  type SourceRow = { cells: Cell[]; caretCol?: number };
  const sourceRows: SourceRow[] = [];

  if (!finished) {
    const built = activeCells(lines[active], typed);
    const wrapped = wrapWords(built.cells, cols);
    // Cap the active line at three physical rows, windowed around the caret.
    let activeRows = wrapped.map((w) => ({
      cells: w.cells,
      caretCol:
        built.caret >= w.start && built.caret <= w.start + w.cells.length
          ? built.caret - w.start
          : undefined,
    }));
    if (activeRows.length > 3) {
      const caretIdx = Math.max(0, activeRows.findIndex((r) => r.caretCol !== undefined));
      const start = Math.min(Math.max(0, caretIdx - 1), activeRows.length - 3);
      activeRows = activeRows.slice(start, start + 3);
    }
    sourceRows.push(...activeRows);

    // Up to two upcoming non-blank lines, one truncated row each.
    let shown = 0;
    for (let li = active + 1; li < lines.length && shown < 2; li++) {
      if (lines[li].trim() === "") continue;
      let cells: Cell[] = [...lines[li]].map((ch) => ({ ch, color: C.future }));
      if (cells.length > cols) cells = [...cells.slice(0, cols - 1), { ch: "…", color: C.future }];
      sourceRows.push({ cells });
      shown++;
    }
  }

  const blockH = sourceRows.length * LINE_H;
  const blockTop = height - PAD - blockH;

  // ---- typeset strip ---------------------------------------------------------
  // Bottom-anchored and clipped through a nested <svg> viewport, so when the
  // document grows past the strip the newest lines stay visible.
  const stripTop = PAD + HEADER_H;
  const stripH = blockTop - stripTop - (sourceRows.length > 0 ? 10 : 0);
  // The PNG arrives already tail-cropped to the strip height (render.ts does the
  // cropping with magick — SVG viewBox clipping proved unreliable), so placing it
  // bottom-anchored with a plain <image> is all that is left to do. The ghost
  // (full reference) may still be taller, hence the scale clamp.
  const png = typesetPng ? loadPng(typesetPng) : null;
  if (png && stripH > 20) {
    const availW = width - PAD * 2;
    const scale = Math.min(availW / png.w, stripH / png.h, 1);
    const dispH = png.h * scale;
    const uri = `data:image/png;base64,${png.base64}`;
    parts.push(
      `<image x="${PAD}" y="${(blockTop - (sourceRows.length > 0 ? 10 : 0) - dispH).toFixed(1)}" ` +
        `width="${(png.w * scale).toFixed(1)}" height="${dispH.toFixed(1)}" ` +
        `opacity="${ghost ? "0.4" : "1"}" href="${uri}" xlink:href="${uri}"/>`,
    );
  } else if (stripH > 20) {
    parts.push(
      `<text x="${PAD}" y="${stripTop + 20}" fill="${C.pending}" ` +
        `font-family='${UI_FONT}' font-size="13">ここに組版が積もっていく…</text>`,
    );
  }

  if (sourceRows.length > 0) {
    // Divider between what is typeset and what is still source.
    parts.push(
      `<rect x="${PAD}" y="${blockTop - 6}" width="${width - PAD * 2}" height="1" fill="${C.divider}"/>`,
    );
  }

  // ---- draw the source rows --------------------------------------------------
  sourceRows.forEach((row, ri) => {
    const top = blockTop + ri * LINE_H;
    const baseline = top + LINE_H - 8;

    row.cells.forEach((cell, ci) => {
      if (!cell.bg) return;
      parts.push(
        `<rect x="${(PAD + ci * CHAR_W).toFixed(1)}" y="${top + 2}" width="${CHAR_W.toFixed(1)}" ` +
          `height="${LINE_H - 4}" fill="${cell.bg}"/>`,
      );
    });

    let i = 0;
    while (i < row.cells.length) {
      const color = row.cells[i].color;
      let j = i;
      let text = "";
      while (j < row.cells.length && row.cells[j].color === color) {
        text += row.cells[j].ch;
        j++;
      }
      if (text.length > 0) {
        parts.push(
          `<text x="${(PAD + i * CHAR_W).toFixed(1)}" y="${baseline}" fill="${color}" ` +
            `font-family='${FONT}' font-size="${FONT_SIZE}" xml:space="preserve">${escapeXml(text)}</text>`,
        );
      }
      i = j;
    }

    if (row.caretCol !== undefined) {
      const x = PAD + row.caretCol * CHAR_W;
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${top + 2}" width="3" height="${LINE_H - 4}" fill="${C.caret}" rx="1.5"/>`,
      );
    }
  });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
