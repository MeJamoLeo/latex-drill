/**
 * The real requirement for the metamorphosis pipeline is not "valid LaTeX
 * compiles" but "every prefix of every reference compiles after repair" (the
 * document images) and "every fragment body compiles" (the in-line
 * transformations). Both are exercised here with the real latex binary, for
 * every bundled problem — each new problem opens repair holes in new places.
 */
import { repairForCompile, scan } from "../src/latex.ts";
import { analyzeLines, fragmentBody } from "../src/precompile.ts";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

const LATEX = "/opt/homebrew/bin/latex";
const DIR = "/tmp/latex-prefix-test";

const PREAMBLE = String.raw`\documentclass[preview,border=6pt,varwidth=250pt]{standalone}
\usepackage{amsmath,amssymb,amsthm}
\newtheorem{theorem}{Theorem}
\newtheorem{lemma}{Lemma}
\newtheorem{corollary}{Corollary}
\theoremstyle{definition}
\newtheorem{definition}{Definition}
`;

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

function compiles(body: string): string | null {
  writeFileSync(join(DIR, "doc.tex"), `${PREAMBLE}\\begin{document}\n${body}\n\\end{document}\n`, "utf8");
  try {
    execFileSync(LATEX, ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "doc.tex"], {
      cwd: DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return null;
  } catch (e) {
    const out = String((e as { stdout?: Buffer }).stdout ?? "");
    const bang = out.split("\n").find((l) => l.startsWith("!"));
    return bang ?? "unknown failure";
  }
}

// --- unit checks on the repair itself ---------------------------------------

const unit: { typed: string; note: string; mayFail?: boolean }[] = [
  { typed: "\\begin{theorem}", note: "開いた環境を閉じる" },
  { typed: "\\begin{theorem}\nLet $n$ be", note: "文中" },
  { typed: "\\begin{theorem}\nLet $n$ be an even integer. Then $n^2", note: "数式を閉じる" },
  { typed: "\\begin{proof}\n\\begin{align}", note: "空 align に詰め物" },
  { typed: "\\begin{align}\n  n^2 &= (2k)^2", note: "align 途中" },
  { typed: "\\begin{align}\n  n^2 &= (2k)^2 \\\\", note: "行末の \\\\" },
  // Not reachable while copying a reference (the `$` always comes first), and a
  // repair would have to guess at wrapping it in math mode. Left to fail, which
  // the caller handles by keeping the previous image.
  { typed: "\\mathbb{", note: "数式外の math コマンド（修復不能・前の画像を保持）", mayFail: true },
  { typed: "$2k^2 \\in \\mathbb{Z", note: "数式＋波括弧" },
  { typed: "\\begin{theo", note: "環境名が途中（切り捨て）" },
  { typed: "Let $n^", note: "^ の直後（切り捨て）" },
  { typed: "\\fra", note: "コマンド途中（切り捨て）" },
  { typed: "", note: "空" },
];

let failed = 0;
console.log("=== 修復してコンパイルできるか（実際に latex を回す） ===");
for (const u of unit) {
  const repaired = repairForCompile(u.typed);
  const body = repaired.trim() === "" ? "\\phantom{x}" : repaired;
  const err = compiles(body);
  if (err && !u.mayFail) failed++;
  const mark = !err ? "ok  " : u.mayFail ? "skip" : "FAIL";
  console.log(`${mark} ${JSON.stringify(u.typed).padEnd(52)} ${u.note}`);
  if (err && !u.mayFail) console.log(`       → ${err}`);
}

// --- every problem: every prefix, every fragment -----------------------------

const problemDir = "assets/problems";
const files = readdirSync(problemDir).filter((f) => f.endsWith(".json")).sort();

let prefixNG = 0;
let fragNG = 0;

for (const file of files) {
  const problem = JSON.parse(readFileSync(join(problemDir, file), "utf8"));
  const reference: string = problem.reference;
  const lines: string[] = reference.split("\n");
  const infos = analyzeLines(lines);

  // Document prefixes: hard requirement — every 3rd keystroke state must render.
  const broken: { at: number; err: string; context: string }[] = [];
  let tested = 0;
  for (let i = 0; i <= reference.length; i += 3) {
    tested++;
    const repaired = repairForCompile(reference.slice(0, i));
    const body = repaired.trim() === "" ? "\\phantom{x}" : repaired;
    const err = compiles(body);
    if (err) broken.push({ at: i, err, context: JSON.stringify(reference.slice(Math.max(0, i - 20), i)) });
  }
  prefixNG += broken.length;

  // Fragments: soft requirement — a failed fragment just means no in-line
  // transformation at that boundary (the fallback keeps the green source), but
  // a high failure count means the analysis is mis-slicing this problem.
  let fragTotal = 0;
  let fragBad = 0;
  for (const info of infos) {
    for (const b of info.boundaries) {
      const body = fragmentBody(info, b);
      if (body.length === 0) continue;
      fragTotal++;
      if (compiles(body)) fragBad++;
    }
  }
  fragNG += fragBad;

  console.log(
    `\n=== ${file} (Lv${problem.level}) ===\n` +
      `prefixes ${tested - broken.length}/${tested}  fragments ${fragTotal - fragBad}/${fragTotal}`,
  );
  for (const b of broken.slice(0, 5)) {
    console.log(`  @${String(b.at).padStart(3)} …${b.context}\n        ${b.err}`);
  }
}

console.log(`\nscan sanity: ${JSON.stringify(scan("\\begin{align}$x{"))}`);
const ok = failed === 0 && prefixNG === 0;
console.log(ok ? `\n全部通った（fragment 失敗 ${fragNG} 件は許容）` : `\n${failed} unit FAIL / ${prefixNG} prefix NG`);
process.exit(ok ? 0 : 1);
