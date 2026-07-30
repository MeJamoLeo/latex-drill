import { Action, ActionPanel, Grid, Icon } from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadProblems, type Problem } from "./problems";
import { renderTex, type RenderResult } from "./render";
import { repairForCompile } from "./latex";
import { renderSurface } from "./surface";

/**
 * Delay before the first compile of a typing burst. Once the drain loop below is
 * running it recompiles continuously, so this only trims wasted compiles at the
 * very start of a burst. The typing surface itself redraws on every keystroke.
 */
const DEBOUNCE_MS = 150;

/**
 * The whole game is one composed image inside a single Grid cell. Grid is used
 * instead of List because List always reserves a third of the window for the
 * item column, which this game has no use for — Grid with one column hands the
 * full window to the image while keeping the search bar as the typing input.
 * The cell is 16:9 (the only wide aspect Grid offers), so the canvas is too.
 */
const SURFACE_W = 720;
const SURFACE_H = 405;

/** Monotonic tag for goal compiles, so no two share a working directory. */
let goalGeneration = 0;

type Live = {
  /** Last image that compiled successfully. Kept on screen through failures. */
  png?: string;
  /** True while the on-screen image is behind what has been typed. */
  stale: boolean;
  error?: string;
  ms: number;
};

function firstDifference(typed: string, target: string): number | null {
  const n = Math.min(typed.length, target.length);
  for (let i = 0; i < n; i++) if (typed[i] !== target[i]) return i;
  return typed.length > target.length ? target.length : null;
}

export default function Command() {
  const problems = useMemo(() => loadProblems(), []);
  const [problem, setProblem] = useState<Problem>(problems[0]);

  const lines = useMemo(() => problem.reference.split("\n"), [problem]);
  const [doneCount, setDoneCount] = useState(0);
  const [typed, setTyped] = useState("");
  const [live, setLive] = useState<Live>({ stale: false, ms: 0 });
  /** The finished reference, typeset once per problem and shown until typing produces its own. */
  const [goalPng, setGoalPng] = useState<string | undefined>(undefined);
  // Bumped on every keystroke so elapsed-time figures refresh with the surface.
  const [tick, setTick] = useState(0);

  const startedAt = useRef<number | null>(null);
  const correctChars = useRef(0);
  const typedChars = useRef(0);

  const finished = doneCount >= lines.length;
  const target = finished ? "" : lines[doneCount];
  // Leading indentation is display-only (the surface shows it greyed); what the
  // player actually types starts at the first non-space character.
  const goal = target.trimStart();

  // Blank lines in the reference carry no keystrokes, so award them for free.
  useEffect(() => {
    if (!finished && target.trim() === "") setDoneCount((n) => n + 1);
  }, [target, finished]);

  // Typeset the finished reference once per problem: the pane shows the goal
  // (dimmed) before any typing, so the player sees what they are building.
  // Each compile gets its own generation-tagged dir — switching problems while a
  // goal compile is in flight must not let two latex runs share doc.tex/doc.dvi.
  useEffect(() => {
    let cancelled = false;
    const generation = ++goalGeneration;
    setGoalPng(undefined);
    void renderTex(problem.reference, problem, `goal-${generation}`).then((r) => {
      if (!cancelled) setGoalPng(r.png);
    });
    return () => {
      cancelled = true;
    };
  }, [problem]);

  // Only COMPLETED lines are typeset — the vertical layout keeps the line being
  // typed as coloured source, and it flips into the typeset strip the moment it
  // matches. Repair still closes whatever the completed prefix leaves open
  // (environments, math, braces), so every completion compiles.
  const body = useMemo(
    () => repairForCompile(lines.slice(0, doneCount).join("\n")).trim(),
    [lines, doneCount],
  );

  // The compile pipeline is a serialized drain loop, NOT debounce-and-discard.
  // The first version cancelled the in-flight compile on every keystroke, which
  // meant a result only ever landed after ~500ms of complete silence — and a
  // typing game never goes silent, so the pane stayed empty for whole lines.
  // Here exactly one compile runs at a time; when it lands it is shown even if
  // already behind (marked stale), and the loop immediately recompiles until it
  // has caught up with what is typed.
  const bodyRef = useRef("");
  const problemRef = useRef(problem);
  const runningRef = useRef(false);
  /** Tail-crop budget for the typeset strip: taller once the proof is finished. */
  const maxHRef = useRef(160);

  async function drainCompiles() {
    if (runningRef.current) return; // the active loop will pick up bodyRef itself
    runningRef.current = true;
    try {
      let compiled: string | null = null;
      while (compiled !== bodyRef.current && bodyRef.current.length > 0) {
        const b: string = bodyRef.current;
        const p: Problem = problemRef.current;
        const r: RenderResult = await renderTex(b, p, "live", maxHRef.current);
        compiled = b;
        // A result from a problem that is no longer selected is not "behind",
        // it is from a different document — drop it instead of showing it.
        if (problemRef.current !== p) continue;
        setLive((prev) => ({
          png: r.png ?? prev.png,
          stale: bodyRef.current !== b || !r.png,
          error: r.png ? undefined : r.error,
          ms: r.ms,
        }));
      }
    } finally {
      runningRef.current = false;
    }
  }

  useEffect(() => {
    bodyRef.current = body;
    problemRef.current = problem;
    // While playing, the strip above the typing block has ~160px; once finished
    // the source block disappears and the strip gets the whole canvas.
    maxHRef.current = finished ? 356 : 160;
    if (body.length === 0) {
      setLive({ stale: false, ms: 0 });
      return;
    }
    setLive((prev) => ({ ...prev, stale: true }));
    // The debounce only delays the first compile of a burst; once the drain loop
    // is running it follows the typing continuously on its own.
    const timer = setTimeout(() => void drainCompiles(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [body, problem, finished]);

  const diffAt = firstDifference(typed, goal);
  const onTrack = diffAt === null;

  function onType(next: string) {
    if (startedAt.current === null && next.length > 0) startedAt.current = Date.now();

    const added = next.length - typed.length;
    if (added > 0) {
      typedChars.current += added;
      if (firstDifference(next, goal) === null) correctChars.current += added;
    }

    // Line complete: advance and adopt the reference line verbatim, so the
    // accumulated document keeps the master's indentation.
    if (next.trim() !== "" && next.trim() === target.trim()) {
      setDoneCount((n) => n + 1);
      setTyped("");
      setTick((t) => t + 1);
      return;
    }
    setTyped(next);
    setTick((t) => t + 1);
  }

  function reset() {
    setDoneCount(0);
    setTyped("");
    startedAt.current = null;
    correctChars.current = 0;
    typedChars.current = 0;
    setTick((t) => t + 1);
  }

  const elapsedMs = startedAt.current ? Date.now() - startedAt.current : 0;
  const minutes = elapsedMs / 60000;
  // Monkeytype's convention: one "word" is five characters.
  const wpm = minutes > 0 ? Math.round(correctChars.current / 5 / minutes) : 0;
  const accuracy =
    typedChars.current > 0 ? Math.round((correctChars.current / typedChars.current) * 100) : 100;

  const surface = useMemo(
    () =>
      renderSurface({
        lines,
        doneCount,
        typed,
        width: SURFACE_W,
        height: SURFACE_H,
        typesetPng: live.png ?? goalPng,
        stale: live.stale,
        ghost: !live.png && goalPng !== undefined,
        stats: {
          wpm,
          accuracy,
          doneLines: doneCount,
          totalLines: lines.length,
          seconds: elapsedMs / 1000,
          finished,
        },
      }),
    // tick keeps the surface in step with counters that live in refs
    [lines, doneCount, typed, tick, live.png, live.stale, goalPng],
  );

  return (
    <Grid
      columns={1}
      aspectRatio="16/9"
      fit={Grid.Fit.Contain}
      inset={Grid.Inset.Small}
      filtering={false}
      searchText={typed}
      onSearchTextChange={onType}
      searchBarPlaceholder={finished ? "完成！ ⌘R でリセット" : goal}
      navigationTitle={`${problem.title} — ${doneCount}/${lines.length} 行`}
      searchBarAccessory={
        <Grid.Dropdown
          tooltip="問題"
          value={problem.id}
          onChange={(id) => {
            const next = problems.find((p) => p.id === id);
            if (next) {
              setProblem(next);
              reset();
            }
          }}
        >
          {problems.map((p) => (
            <Grid.Dropdown.Item key={p.id} value={p.id} title={`Lv${p.level} ${p.title}`} />
          ))}
        </Grid.Dropdown>
      }
    >
      <Grid.Item
        content={surface}
        keywords={[]}
        actions={
          <ActionPanel>
            <Action
              title="リセット"
              icon={Icon.ArrowCounterClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={reset}
            />
            <Action
              title="この行をスキップ"
              icon={Icon.ArrowRight}
              shortcut={{ modifiers: ["cmd"], key: "arrowRight" }}
              onAction={() => {
                if (finished) return;
                setDoneCount((n) => n + 1);
                setTyped("");
              }}
            />
            <Action.CopyToClipboard title="お手本をコピー" content={problem.reference} />
          </ActionPanel>
        }
      />
    </Grid>
  );
}
