/**
 * Render the play surface outside Raycast so the layout can be judged without
 * opening the app. QuickLook (`qlmanage -t`) rasterises the SVG, which makes this
 * the fastest loop available for design work.
 */
import { renderSurface, type Stats } from "../src/surface.ts";
import { repairForCompile } from "../src/latex.ts";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

const LATEX = "/opt/homebrew/bin/latex";
const DVIPNG = "/opt/homebrew/bin/dvipng";
const OUT = "/tmp/surface-preview";

const PREAMBLE = String.raw`\documentclass[preview,border=6pt,varwidth=130pt]{standalone}
\usepackage{amsmath,amssymb,amsthm}
\newtheorem{theorem}{Theorem}
\newtheorem{lemma}{Lemma}
\newtheorem{corollary}{Corollary}
\theoremstyle{definition}
\newtheorem{definition}{Definition}
`;

function typeset(body: string, tag: string, maxHeightPx: number): string | undefined {
  const dir = join(OUT, tag);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "doc.tex"), `${PREAMBLE}\\begin{document}\n${body}\n\\end{document}\n`, "utf8");
  try {
    execFileSync(LATEX, ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "doc.tex"], { cwd: dir, stdio: "ignore" });
    execFileSync(
      DVIPNG,
      ["-D", "145", "-T", "tight", "-bg", "Transparent", "-fg", "rgb 0.58 0.58 0.62", "-o", "out.png", "doc.dvi"],
      { cwd: dir, stdio: "ignore" },
    );
    const png = join(dir, "out.png");
    // Mirror render.ts: tail-crop with magick so only the newest content shows.
    const buf = readFileSync(png);
    const h = buf.length >= 24 && buf.toString("ascii", 12, 16) === "IHDR" ? buf.readUInt32BE(20) : 0;
    if (h > maxHeightPx) {
      execFileSync("/opt/homebrew/bin/magick", [png, "-gravity", "South", "-crop", `x${maxHeightPx}+0+0`, "+repage", png], {
        stdio: "ignore",
      });
    }
    return png;
  } catch {
    return undefined;
  }
}

const problem = JSON.parse(readFileSync("assets/problems/01-even-square.json", "utf8"));
const lines: string[] = problem.reference.split("\n");

const base: Stats = {
  wpm: 47,
  accuracy: 92,
  doneLines: 5,
  totalLines: lines.length,
  seconds: 38.4,
  finished: false,
};

const scenarios = [
  {
    name: "start",
    doneCount: 0,
    typed: "\\begin{theo",
    stale: false,
    stats: { ...base, wpm: 0, doneLines: 0, seconds: 2.1, accuracy: 100 },
  },
  {
    name: "typo",
    doneCount: 5,
    typed: "Since $n$ is even, there exists an intger",
    stale: true,
    stats: base,
  },
  {
    name: "midway",
    doneCount: 8,
    // Indentation is granted for free, so what gets typed is the trimmed line:
    // a prefix of lines[8].trimStart() ("&= 4k^2 \\").
    typed: "&= 4k^",
    stale: false,
    stats: { ...base, doneLines: 8, accuracy: 97, wpm: 52, seconds: 71.2 },
  },
  {
    name: "finished",
    doneCount: lines.length,
    typed: "",
    stale: false,
    stats: { ...base, doneLines: lines.length, accuracy: 96, finished: true, seconds: 121.7 },
  },
];

for (const s of scenarios) {
  // What the app would have typeset: completed lines only, through the same
  // repair the app uses. The line in progress stays source-side.
  const body = repairForCompile(lines.slice(0, s.doneCount).join("\n")) || "\\phantom{x}";
  const png = typeset(body, s.name, s.stats.finished ? 356 : 160);
  const uri = renderSurface({
    lines,
    doneCount: s.doneCount,
    typed: s.typed,
    stats: s.stats,
    width: 438,
    height: 358,
    typesetPng: png,
    stale: s.stale,
  });
  const svg = Buffer.from(uri.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");
  writeFileSync(`/tmp/surface-${s.name}.svg`, svg, "utf8");
  console.log(`${s.name}: svg ${(svg.length / 1024).toFixed(1)}kB  png ${png ? "ok" : "FAILED"}`);
}
