# LaTeX Drill

A typing game for Raycast that teaches you to write LaTeX proofs — type the
source and watch it **become mathematics under your caret**.

The core mechanic is *in-line metamorphosis*: as you copy a theorem's LaTeX
line by line, every token boundary you cross replaces the source you just typed
with its actually-compiled typeset image, in place, with zero latency. Cleared
lines accumulate above as a growing, real LaTeX document. Mistakes queue in red
at the caret until you backspace them away. Combo streaks, WPM, and accuracy
keep score.

16 built-in problems (Lv1–Lv5) pair a classic proof with one new token family
each — from `\frac` and `\sqrt` up to `align`, `\lim`, `\binom`, `cases`, and
full theorem/proof documents.

## Requirements

- macOS with [Raycast](https://raycast.com)
- A TeX distribution and ImageMagick:

  ```sh
  brew install texlive imagemagick
  ```

  The extension shells out to `/opt/homebrew/bin/{latex,dvipng,magick}`
  (Apple Silicon Homebrew paths — configurable paths are on the roadmap).

## Install (development mode)

```sh
git clone https://github.com/MeJamoLeo/latex-drill.git
cd latex-drill
npm install
npm run dev
```

`npm run dev` registers the extension with Raycast; after the first launch it
stays available from the root search as **Type Proof**.

## How to play

- Open **Type Proof** and just start typing the greyed-out LaTeX.
- Correct keystrokes are consumed instantly — the search bar stays empty and
  the line transforms. Wrong keystrokes queue in red; Backspace removes them.
- `⌘P` picks a problem (Lv1–Lv5), `⌘R` restarts, `⌘→` skips a line.
- Finish the proof to see the fully typeset document and your score.

## How it works (short version)

- The whole UI is a single SVG data URI inside a Grid cell, rebuilt on every
  keystroke (<1 ms). Compiled LaTeX is embedded as PNG images.
- Because input is forced to be a prefix of the reference, every reachable
  typeset state is enumerable — all fragments and cumulative documents are
  precompiled in play order (`latex` + `dvipng`, ~0.3 s each), so the
  metamorphosis never waits on TeX.
- A repair engine closes half-typed LaTeX (environments, math, braces,
  `\left/\right`, dangling two-argument commands) so that *every* keystroke
  prefix compiles; the test suite proves this against the real `latex` binary
  for all bundled problems (1506/1506 prefixes).

## Tests

```sh
node --experimental-strip-types tests/latex.test.ts     # exhaustive prefix compile check
node --experimental-strip-types tests/surface.preview.ts # render layout states to /tmp
```

## License

MIT
