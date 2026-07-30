import { environment } from "@raycast/api";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import type { Problem } from "./problems.ts";

const execFileAsync = promisify(execFile);

// Absolute paths: a GUI-launched Node does not inherit the shell's PATH.
const LATEX = "/opt/homebrew/bin/latex";
const DVIPNG = "/opt/homebrew/bin/dvipng";
const MAGICK = "/opt/homebrew/bin/magick";

// varwidth is sized for the full-width typeset strip above the typing line, so
// the measure can breathe; dvipng's dpi below turns 250pt into roughly 500px.
export const BASE_PREAMBLE = String.raw`\documentclass[preview,border=6pt,varwidth=250pt]{standalone}
\usepackage{amsmath,amssymb,amsthm}
\newtheorem{theorem}{Theorem}
\newtheorem{lemma}{Lemma}
\newtheorem{corollary}{Corollary}
\theoremstyle{definition}
\newtheorem{definition}{Definition}
`;

export type RenderResult = { png?: string; error?: string; ms: number };

/**
 * Compile a LaTeX body to a transparent PNG.
 *
 * `maxHeightPx`, when given, crops the image to its BOTTOM `maxHeightPx` pixels.
 * The vertical layout shows the tail of the growing document above the typing
 * line, and cropping the raster here is the reliable way to do that — SVG-side
 * viewBox clipping proved to be ignored by at least one renderer.
 */
export async function renderTex(
  body: string,
  problem: Problem,
  tag: string,
  maxHeightPx?: number,
): Promise<RenderResult> {
  const dir = join(environment.supportPath, "build", tag);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tex = join(dir, "doc.tex");
  const dvi = join(dir, "doc.dvi");
  // Raycast caches markdown images by path, so each successful compile needs a
  // fresh filename to actually appear. Old ones are swept below.
  const png = join(dir, `out-${Date.now()}.png`);
  const source = `${BASE_PREAMBLE}${problem.preamble ?? ""}\\begin{document}\n${body}\n\\end{document}\n`;
  writeFileSync(tex, source, "utf8");

  const started = Date.now();
  try {
    // -no-shell-escape: the compiled text is trusted today (verbatim reference
    // lines), but problem files are user-editable JSON — belt and braces.
    await execFileAsync(LATEX, ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "doc.tex"], {
      cwd: dir,
    });
    await execFileAsync(
      DVIPNG,
      // The display runs at backingScaleFactor 1, so points map to pixels and the
      // image wants to arrive at roughly its final size. 145 dpi over 250pt lands
      // near 500px wide — a comfortable read across the full-width strip.
      ["-D", "145", "-T", "tight", "-bg", "Transparent", "-fg", "rgb 0.58 0.58 0.62", "-o", png, dvi],
      { cwd: dir },
    );
    if (maxHeightPx !== undefined && pngHeight(png) > maxHeightPx) {
      // -gravity South keeps the newest (bottom) part of the document.
      await execFileAsync(
        MAGICK,
        [png, "-gravity", "South", "-crop", `x${Math.round(maxHeightPx)}+0+0`, "+repage", png],
        { cwd: dir },
      );
    }
    return { png, ms: Date.now() - started };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const raw = err.stdout || err.stderr || err.message || String(e);
    // TeX writes the actionable part on lines starting with "!" or "l.<n>".
    const bang = raw.split("\n").filter((l) => l.startsWith("!") || l.startsWith("l."));
    return { error: (bang.length ? bang.join("\n") : raw).slice(0, 1200), ms: Date.now() - started };
  } finally {
    // Sweep on every outcome, so a failed attempt's half-product cannot pile up.
    // When this compile failed, keep the newest previous PNG instead — the UI is
    // still showing it.
    sweep(dir, existsSync(png) ? png : newestPng(dir));
  }
}

/**
 * Precompile runs tag their build dirs with a per-generation prefix; when a new
 * generation starts, the previous one's dirs are dead weight. Sweep them.
 */
export function sweepStaleBuildDirs(keepPrefix: string): void {
  const base = join(environment.supportPath, "build");
  if (!existsSync(base)) return;
  for (const name of readdirSync(base)) {
    if (!name.startsWith("pc") || name.startsWith(keepPrefix)) continue;
    try {
      rmSync(join(base, name), { recursive: true, force: true });
    } catch {
      // Leftovers are harmless; the next sweep gets another chance.
    }
  }
}

/** Newest out-*.png in a build dir, or "" when there is none. */
function newestPng(dir: string): string {
  // The dir can vanish mid-flight when a newer generation sweeps it — that
  // compile's result is unwanted anyway, so absence is a fine answer.
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((f) => f.startsWith("out-") && f.endsWith(".png"))
      .sort();
  } catch {
    return "";
  }
  return names.length > 0 ? join(dir, names[names.length - 1]) : "";
}

/** Height straight out of the PNG's IHDR chunk — no image library needed. */
function pngHeight(path: string): number {
  try {
    const fd = readFileSync(path);
    if (fd.length < 24 || fd.toString("ascii", 12, 16) !== "IHDR") return 0;
    return fd.readUInt32BE(20);
  } catch {
    return 0;
  }
}

/** Keep the build dir from growing without bound during a long typing session. */
function sweep(dir: string, keep: string) {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    // A newer generation already removed the whole dir — nothing to sweep.
    return;
  }
  for (const f of names) {
    if (!f.startsWith("out-") || !f.endsWith(".png")) continue;
    const p = join(dir, f);
    if (p === keep) continue;
    try {
      unlinkSync(p);
    } catch {
      // A file we failed to delete is harmless; skip it.
    }
  }
}

