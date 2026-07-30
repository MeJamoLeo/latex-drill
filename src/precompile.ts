/**
 * Static analysis for the metamorphosis pipeline.
 *
 * Input is forced to be a prefix of the reference (mistakes queue in the search
 * bar and never advance the position), so every visual state the game can reach
 * is enumerable the moment a problem is selected. That is what makes zero-latency
 * "source turns into math under the caret" possible: every fragment and every
 * cumulative document image is compiled ahead of play, in play order.
 *
 * This module is pure analysis — no Raycast imports — so tests and previews can
 * use it outside the app.
 */

import { scan, repairForCompile } from "./latex.ts";

/** Environments whose body lines are math material, not prose. */
const MATH_ENVS = new Set([
  "align", "align*", "aligned", "alignat", "alignat*", "gather", "gather*", "gathered",
  "equation", "equation*", "multline", "multline*", "split", "cases", "array",
  "matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix", "smallmatrix",
]);

export type LineKind = "structural" | "text" | "math";

export type LineInfo = {
  /** What actually gets typed: the line minus its indentation. */
  goal: string;
  kind: LineKind;
  /**
   * Positions (in goal) where the typed prefix is stable enough to typeset:
   * braces balanced, math closed, no half-finished command. Ascending; the last
   * boundary is goal.length. Structural lines have none — their payoff is the
   * document updating when the line clears.
   */
  boundaries: number[];
};

/** The goal text of a line: indentation is formatting, not LaTeX to practise. */
export function goalOf(line: string): string {
  return line.trimStart();
}

function isStructural(goal: string): boolean {
  return /^\\(begin|end)\{[^}]*\}$/.test(goal);
}

/** A prefix is fragment-safe when nothing is left dangling. */
function isStable(prefix: string): boolean {
  const s = scan(prefix);
  if (s.openBraces !== 0 || s.openMath !== false || s.openEnvironments.length > 0) return false;
  // A trailing control word compiles only if it happens to take no argument;
  // conservatively wait for the next boundary instead of guessing.
  if (/\\[a-zA-Z]+$/.test(prefix)) return false;
  // A \left without its \right cannot stand alone in a fragment.
  const lefts = prefix.match(/\\left(?![a-zA-Z])/g)?.length ?? 0;
  const rights = prefix.match(/\\right(?![a-zA-Z])/g)?.length ?? 0;
  if (lefts !== rights) return false;
  return true;
}

/** Minimum characters between kept boundaries, so fragments change chunkily. */
const MIN_STRIDE = 8;

function boundariesOf(goal: string): number[] {
  const out: number[] = [];
  let last = 0;
  for (let i = 1; i <= goal.length; i++) {
    const atWordGap = i === goal.length || (goal[i] === " " && goal[i - 1] !== " ");
    if (!atWordGap) continue;
    if (i !== goal.length && i - last < MIN_STRIDE) continue;
    if (!isStable(goal.slice(0, i))) continue;
    out.push(i);
    last = i;
  }
  if (out[out.length - 1] !== goal.length && isStable(goal)) out.push(goal.length);
  return out;
}

export function analyzeLines(lines: string[]): LineInfo[] {
  return lines.map((line, li) => {
    const goal = goalOf(line);
    if (goal.length === 0 || isStructural(goal)) {
      return { goal, kind: "structural" as const, boundaries: [] };
    }
    // The innermost environment open at the START of this line decides whether
    // its content is math (an align row) or prose (a theorem/proof sentence).
    const before = scan(lines.slice(0, li).join("\n"));
    const innermost = before.openEnvironments[before.openEnvironments.length - 1];
    const kind: LineKind = innermost !== undefined && MATH_ENVS.has(innermost) ? "math" : "text";
    return { goal, kind, boundaries: boundariesOf(goal) };
  });
}

/**
 * The LaTeX body for one line-prefix fragment — the piece of the active line
 * that has already "become math" and sits to the left of the green source.
 */
export function fragmentBody(info: LineInfo, boundary: number): string {
  const prefix = info.goal.slice(0, boundary);
  if (info.kind === "math") {
    // Alignment tabs and row breaks only mean something inside the environment;
    // the fragment shows the row's content as free-standing display math.
    const cleaned = prefix.replace(/&/g, "").replace(/\\\\\s*$/, "").trim();
    return cleaned.length === 0 ? "" : `\\(\\displaystyle ${cleaned}\\)`;
  }
  return prefix;
}

/** The cumulative document after the first `k` lines have cleared. */
export function documentBody(lines: string[], k: number): string {
  return repairForCompile(lines.slice(0, k).join("\n")).trim();
}

export type Job =
  | { type: "doc"; k: number; body: string }
  | { type: "frag"; line: number; boundary: number; body: string };

/**
 * Every compile the game will ever need, in play order: the fragments of line 0
 * come first, then the document state after line 0 clears, then line 1's
 * fragments, and so on. A player is always many jobs behind the queue.
 */
export function buildJobs(lines: string[], infos: LineInfo[]): Job[] {
  const jobs: Job[] = [];
  for (let li = 0; li < lines.length; li++) {
    for (const b of infos[li].boundaries) {
      const body = fragmentBody(infos[li], b);
      if (body.length > 0) jobs.push({ type: "frag", line: li, boundary: b, body });
    }
    const body = documentBody(lines, li + 1);
    if (body.length > 0) jobs.push({ type: "doc", k: li + 1, body });
  }
  return jobs;
}

export const jobKey = (j: Job): string => (j.type === "doc" ? `doc:${j.k}` : `frag:${j.line}:${j.boundary}`);
