/**
 * Render the play surface outside Raycast so the layout can be judged without
 * opening the app. QuickLook (`qlmanage -t`) rasterises the SVG, which makes this
 * the fastest loop available for design work. Uses the same analysis and
 * fragment/document builders as the app.
 */
import { renderSurface, type Stats } from "../src/surface.ts";
import { analyzeLines, fragmentBody, documentBody } from "../src/precompile.ts";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

const LATEX = "/opt/homebrew/bin/latex";
const DVIPNG = "/opt/homebrew/bin/dvipng";
const OUT = "/tmp/surface-preview";

const PREAMBLE = String.raw`\documentclass[preview,border=6pt,varwidth=250pt]{standalone}
\usepackage{amsmath,amssymb,amsthm}
\newtheorem{theorem}{Theorem}
\newtheorem{lemma}{Lemma}
\newtheorem{corollary}{Corollary}
\theoremstyle{definition}
\newtheorem{definition}{Definition}
`;

function typeset(body: string, tag: string, maxHeightPx?: number): string | undefined {
  if (body.trim().length === 0) return undefined;
  const dir = join(OUT, tag);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "doc.tex"), `${PREAMBLE}\\begin{document}\n${body}\n\\end{document}\n`, "utf8");
  try {
    execFileSync(LATEX, ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "doc.tex"], {
      cwd: dir,
      stdio: "ignore",
    });
    execFileSync(
      DVIPNG,
      ["-D", "145", "-T", "tight", "-bg", "Transparent", "-fg", "rgb 0.58 0.58 0.62", "-o", "out.png", "doc.dvi"],
      { cwd: dir, stdio: "ignore" },
    );
    const png = join(dir, "out.png");
    const buf = readFileSync(png);
    const h = buf.length >= 24 && buf.toString("ascii", 12, 16) === "IHDR" ? buf.readUInt32BE(20) : 0;
    if (maxHeightPx !== undefined && h > maxHeightPx) {
      execFileSync(
        "/opt/homebrew/bin/magick",
        [png, "-gravity", "South", "-crop", `x${maxHeightPx}+0+0`, "+repage", png],
        { stdio: "ignore" },
      );
    }
    return png;
  } catch {
    return undefined;
  }
}

const problem = JSON.parse(readFileSync("assets/problems/20-even-square.json", "utf8"));
const lines: string[] = problem.reference.split("\n");
const infos = analyzeLines(lines);

const base: Stats = {
  wpm: 47,
  accuracy: 92,
  combo: 12,
  doneLines: 5,
  totalLines: lines.length,
  seconds: 38.4,
  finished: false,
};

// (doneCount, pos, surplus) triplets to render.
const scenarios = [
  { name: "start", doneCount: 0, pos: 4, surplus: "", stats: { ...base, wpm: 0, combo: 4, doneLines: 0, seconds: 1.2 } },
  {
    name: "midtext",
    doneCount: 5,
    pos: 51, // "Since $n$ is even, there exists an integer $k$ such" — boundary at 51
    surplus: "",
    stats: base,
  },
  {
    name: "typo",
    doneCount: 5,
    pos: 55, // past boundary 51, mid-word, with a mistake queued
    surplus: "u",
    stats: { ...base, combo: 0 },
  },
  {
    name: "mathrow",
    doneCount: 8,
    pos: 6, // "&= 4k^" — no boundary passed yet (boundary is 10)
    surplus: "",
    stats: { ...base, doneLines: 8, accuracy: 97, wpm: 52, combo: 31, seconds: 71.2 },
  },
  {
    name: "finished",
    doneCount: lines.length,
    pos: 0,
    surplus: "",
    stats: { ...base, doneLines: lines.length, accuracy: 96, finished: true, seconds: 121.7, combo: 0 },
  },
];

for (const s of scenarios) {
  const finished = s.doneCount >= lines.length;

  const docPng = typeset(documentBody(lines, s.doneCount), `doc-${s.doneCount}`, finished ? 300 : 205);

  let fragPng: string | undefined;
  let fragBoundary = 0;
  if (!finished) {
    for (const b of infos[s.doneCount].boundaries) {
      if (b > s.pos) break;
      const png = typeset(fragmentBody(infos[s.doneCount], b), `frag-${s.doneCount}-${b}`);
      if (png) {
        fragPng = png;
        fragBoundary = b;
      }
    }
  }

  const goal = finished ? "" : infos[s.doneCount].goal;
  const upcoming: string[] = [];
  for (let li = s.doneCount + 1; li < lines.length && upcoming.length < 10; li++) {
    if (infos[li].goal.length > 0) upcoming.push(infos[li].goal);
  }

  const uri = renderSurface({
    prose: problem.prose,
    docPng,
    fragPng,
    greenSrc: goal.slice(fragBoundary, s.pos),
    surplus: s.surplus,
    graySrc: goal.slice(s.pos),
    upcoming,
    stats: s.stats,
    width: 720,
    height: 405,
  });
  const svg = Buffer.from(uri.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");
  writeFileSync(`/tmp/surface-${s.name}.svg`, svg, "utf8");
  console.log(`${s.name}: svg ${(svg.length / 1024).toFixed(1)}kB  doc ${docPng ? "ok" : "-"}  frag ${fragPng ? `@${fragBoundary}` : "-"}`);
}
