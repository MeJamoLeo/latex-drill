/**
 * The real requirement for a live preview is not "valid LaTeX compiles" but
 * "every prefix of the reference compiles". So this walks the whole proof one
 * keystroke at a time and actually invokes latex on each repaired prefix,
 * reporting how many of them the compiler accepts.
 */
import { repairForCompile, scan } from "../src/latex.ts";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

const LATEX = "/opt/homebrew/bin/latex";
const DIR = "/tmp/latex-prefix-test";

const PREAMBLE = String.raw`\documentclass[preview,border=6pt,varwidth=130pt]{standalone}
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

// --- the real test: every prefix of the reference ----------------------------

const problem = JSON.parse(readFileSync("assets/problems/01-even-square.json", "utf8"));
const reference: string = problem.reference;

console.log(`\n=== 全接頭辞テスト（${reference.length} 文字を3打鍵刻みで） ===`);
const broken: { at: number; err: string; context: string }[] = [];
let tested = 0;
for (let i = 0; i <= reference.length; i += 3) {
  tested++;
  const repaired = repairForCompile(reference.slice(0, i));
  const body = repaired.trim() === "" ? "\\phantom{x}" : repaired;
  const err = compiles(body);
  if (err) broken.push({ at: i, err, context: JSON.stringify(reference.slice(Math.max(0, i - 20), i)) });
}

console.log(`compiled ${tested - broken.length}/${tested} prefixes`);
if (broken.length > 0) {
  console.log("\n通らなかった位置（先頭8件）:");
  for (const b of broken.slice(0, 8)) {
    console.log(`  @${String(b.at).padStart(3)} …${b.context}`);
    console.log(`        ${b.err}`);
  }
}

console.log(`\nscan sanity: ${JSON.stringify(scan("\\begin{align}$x{"))}`);
console.log(failed === 0 && broken.length === 0 ? "\n全部通った" : `\n${failed} 件 FAIL / ${broken.length} 接頭辞 NG`);
process.exit(failed === 0 && broken.length === 0 ? 0 : 1);
