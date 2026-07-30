/**
 * Making half-typed LaTeX compilable.
 *
 * A live preview has to typeset text that is, by definition, unfinished: the
 * moment `\begin{proof}` is typed there is no `\end{proof}` yet, so a literal
 * compile fails and the preview stays empty until the very last keystroke —
 * which defeats the point of a live preview.
 *
 * So before compiling, the in-progress text is repaired: trailing fragments that
 * cannot be completed are dropped, then open groups, math modes and environments
 * are closed in the right order. The repair is never shown to the player; it only
 * feeds the compiler.
 */

/** Environments the drill accepts in \begin{...}. */
const KNOWN_ENVIRONMENTS = new Set([
  "document", "theorem", "lemma", "corollary", "proposition", "definition", "remark", "proof",
  "align", "align*", "aligned", "alignat", "alignat*", "gather", "gather*", "gathered",
  "equation", "equation*", "multline", "multline*", "split", "cases", "array",
  "matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix", "smallmatrix",
  "itemize", "enumerate", "description", "center", "flushleft", "flushright", "quote",
]);

/**
 * Environments that will not typeset while empty, so a freshly opened one needs a
 * placeholder before it is closed again.
 */
const NEEDS_CONTENT = new Set([
  "align", "align*", "aligned", "alignat", "alignat*", "gather", "gather*", "gathered",
  "equation", "equation*", "multline", "multline*", "split", "cases", "array",
  "matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix", "smallmatrix",
  "itemize", "enumerate", "description",
]);

const PLACEHOLDER: Record<string, string> = {
  itemize: "\\item ",
  enumerate: "\\item ",
  description: "\\item ",
};

export type Scan = {
  /** Environments still open, outermost first. */
  openEnvironments: string[];
  /** Unclosed `{` count. */
  openBraces: number;
  /** Whichever math mode is still open, if any. */
  openMath: false | "inline" | "display";
  /** Environment names that are not in the accepted set. */
  unknownEnvironments: string[];
};

/** Walk the source once, tracking brace depth, math mode and the environment stack. */
export function scan(src: string): Scan {
  const openEnvironments: string[] = [];
  const unknownEnvironments: string[] = [];
  let openBraces = 0;
  let math: false | "inline" | "display" = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (c === "\\") {
      // Control words matter only when they are \begin or \end; everything else
      // (including escapes like \{ \$ \\) is skipped wholesale.
      const m = /^\\(begin|end)\s*\{([^}]*)\}/.exec(src.slice(i));
      if (m) {
        const name = m[2];
        if (m[1] === "begin") {
          openEnvironments.push(name);
          if (!KNOWN_ENVIRONMENTS.has(name)) unknownEnvironments.push(name);
        } else {
          // Pop even on a mismatch, so a stray \end cannot leave the stack stuck.
          openEnvironments.pop();
        }
        i += m[0].length - 1;
        continue;
      }
      i++; // skip the escaped character
      continue;
    }

    if (c === "{") openBraces++;
    else if (c === "}") openBraces = Math.max(0, openBraces - 1);
    else if (c === "$") {
      if (src[i + 1] === "$") {
        math = math === "display" ? false : "display";
        i++;
      } else {
        math = math === "inline" ? false : "inline";
      }
    }
  }

  return { openEnvironments, openBraces, openMath: math, unknownEnvironments };
}

/**
 * Drop a trailing fragment that cannot be repaired into valid input.
 *
 * `\begin{theo` has no closing brace to attach a name to, and a bare `\fra` is not
 * a command yet. Both fail the compile no matter what is appended, so they are cut.
 */
function trimTrailingFragment(src: string): string {
  // Trailing whitespace has to go first and last. Inside align, appending
  // `\end{align}` after a newline leaves a blank line, and a blank line ends the
  // paragraph — which amsmath rejects with "Paragraph ended before \align was
  // complete".
  let out = src.replace(/\s+$/, "");

  // A `\begin{` / `\end{` whose brace never closes.
  const openSpec = /\\(begin|end)\s*\{[^}]*$/.exec(out);
  if (openSpec) out = out.slice(0, openSpec.index);

  // A trailing control word: it may still grow, so it is not usable yet.
  const trailingCmd = /\\[a-zA-Z]+$/.exec(out);
  if (trailingCmd) out = out.slice(0, trailingCmd.index);

  // A row separator with no row after it yet.
  out = out.replace(/\\\\$/, "");

  // A trailing lone backslash that is not part of `\\`.
  if (/(^|[^\\])\\$/.test(out)) out = out.slice(0, -1);

  // Subscript or superscript with nothing to apply to.
  out = out.replace(/[_^]\s*$/, "");

  return out.replace(/\s+$/, "");
}

/**
 * Repair half-typed LaTeX into something the compiler will accept.
 * Returns the body to compile, or an empty string when nothing usable was typed.
 */
export function repairForCompile(src: string): string {
  let body = trimTrailingFragment(src);
  const s = scan(body);

  // Unknown environment names get closed like any other — a problem's own
  // preamble may well define them (\newtheorem{claim}{Claim}), and if it truly
  // doesn't, the compile fails and the caller keeps the previous image anyway.
  // Bailing out here would kill the live preview for the whole problem.

  // A freshly opened environment that cannot stand empty needs filler.
  const last = s.openEnvironments[s.openEnvironments.length - 1];
  if (last !== undefined && NEEDS_CONTENT.has(last)) {
    const opener = `\\begin{${last}}`;
    const after = body.slice(body.lastIndexOf(opener) + opener.length);
    if (after.trim() === "") body += PLACEHOLDER[last] ?? "\\phantom{x}";
  }

  // Close in the reverse of the order things were opened: braces and math sit
  // inside the innermost environment.
  if (s.openBraces > 0) body += "}".repeat(s.openBraces);

  // A math mode opened but not written into needs something between the
  // delimiters: closing `$` straight after `$` just reads as a `$$` opener.
  if (s.openMath === "inline") body += /\$$/.test(body) ? "{}$" : "$";
  else if (s.openMath === "display") body += /\$\$$/.test(body) ? "{}$$" : "$$";
  for (let i = s.openEnvironments.length - 1; i >= 0; i--) {
    body += `\n\\end{${s.openEnvironments[i]}}`;
  }

  return body;
}
