import { Action, ActionPanel, Grid, Icon } from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadProblems, type Problem } from "./problems.ts";
import { renderTex, sweepStaleBuildDirs } from "./render.ts";
import { analyzeLines, buildJobs, jobKey, goalOf } from "./precompile.ts";
import { renderSurface } from "./surface.ts";

/**
 * The whole game is one composed image inside a single Grid cell. Grid is used
 * instead of List because List always reserves a third of the window for the
 * item column; Grid with one column hands the full window to the image while
 * keeping the search bar as the typing input. The cell is 16:9, so is the canvas.
 */
const SURFACE_W = 720;
const SURFACE_H = 405;

/** Zero-width space: the invisible content that keeps the search bar non-empty. */
const ZWSP = "​";

/** Tail-crop budgets for cumulative document images. */
const DOC_MAX_H = 205;
const FINAL_DOC_MAX_H = 300;

export default function Command() {
  const problems = useMemo(() => loadProblems(), []);
  const [problem, setProblem] = useState<Problem>(problems[0]);

  const lines = useMemo(() => problem.reference.split("\n"), [problem]);
  const infos = useMemo(() => analyzeLines(lines), [lines]);

  const [doneCount, setDoneCount] = useState(0);
  /** Consumed characters of the active line's goal. */
  const [pos, setPos] = useState(0);
  /**
   * The search bar stays EMPTY except for mistakes: a correct keystroke is
   * consumed instantly (the line transforms), a wrong one stays in the bar as
   * red surplus so Backspace still works on it.
   */
  const [surplus, setSurplus] = useState("");
  /**
   * Raycast pops the view when Backspace lands on an EMPTY search bar — which
   * would kill the game on a reflexive backspace. So the bar always carries an
   * invisible zero-width-space sentinel: visually empty, never actually empty.
   * The count alternates 1/2 so the controlled value always differs from what
   * the bar holds after an edit, forcing Raycast to accept the reset.
   */
  const [sentinels, setSentinels] = useState(1);
  // Bumped whenever a precompile job lands or a keystroke needs stats refreshed.
  const [tick, setTick] = useState(0);

  const startedAt = useRef<number | null>(null);
  const correctChars = useRef(0);
  const typedChars = useRef(0);
  const combo = useRef(0);

  const finished = doneCount >= lines.length;

  // ---- precompile pipeline ---------------------------------------------------
  // Every reachable image (line fragments, cumulative documents) is compiled in
  // play order the moment the problem is selected — the metamorphosis then never
  // waits on latex. Results land in a map keyed by jobKey.
  const resultsRef = useRef(new Map<string, string>());
  const genRef = useRef(0);

  useEffect(() => {
    const gen = ++genRef.current;
    resultsRef.current = new Map();
    const prefix = `pc${gen}-`;
    sweepStaleBuildDirs(prefix);

    const jobs = buildJobs(lines, infos);
    void (async () => {
      for (let i = 0; i < jobs.length; i++) {
        if (genRef.current !== gen) return; // superseded — abandon
        const job = jobs[i];
        const maxH = job.type === "doc" ? (job.k === lines.length ? FINAL_DOC_MAX_H : DOC_MAX_H) : undefined;
        const r = await renderTex(job.body, problem, `${prefix}${i}`, maxH);
        if (genRef.current !== gen) return;
        if (r.png) {
          resultsRef.current.set(jobKey(job), r.png);
          setTick((t) => t + 1);
        }
      }
    })();

    // Retiring the generation on cleanup stops the loop at its next check —
    // dev-mode double-mounts otherwise leave two loops compiling into dirs the
    // newer generation's sweep is deleting out from under them.
    return () => {
      genRef.current++;
    };
  }, [problem, lines, infos]);

  // ---- input: consume-or-queue ----------------------------------------------
  // Whatever Raycast reports as the bar's content is matched against the
  // expected stream; the matching prefix is consumed (advancing pos and lines),
  // only the unmatched tail goes back into the bar (behind the sentinel).
  function onType(next: string) {
    const raw = next.split(ZWSP).join("");
    if (startedAt.current === null && raw.length > 0) startedAt.current = Date.now();
    const added = raw.length - surplus.length;
    if (added > 0) typedChars.current += added;

    let stream = raw;
    let d = doneCount;
    let p = pos;
    while (stream.length > 0 && d < lines.length) {
      const goal = infos[d].goal;
      if (p < goal.length && stream[0] === goal[p]) {
        stream = stream.slice(1);
        p++;
        correctChars.current++;
        combo.current++;
        // Line finished: advance, skipping lines with nothing to type.
        while (d < lines.length && p >= infos[d].goal.length) {
          d++;
          p = 0;
        }
        continue;
      }
      break;
    }

    // Fresh keys that could not be consumed are mistakes.
    if (added > 0 && stream.length > 0) combo.current = 0;

    setDoneCount(d);
    setPos(p);
    setSurplus(stream);
    // Alternate the sentinel count so the controlled searchText value is always
    // new — otherwise React skips the update and the bar drifts out of sync.
    setSentinels((s) => (s === 1 ? 2 : 1));
    setTick((t) => t + 1);
  }

  function reset() {
    setDoneCount(0);
    setPos(0);
    setSurplus("");
    startedAt.current = null;
    correctChars.current = 0;
    typedChars.current = 0;
    combo.current = 0;
    setTick((t) => t + 1);
  }

  // ---- display state ---------------------------------------------------------
  const elapsedMs = startedAt.current ? Date.now() - startedAt.current : 0;
  const minutes = elapsedMs / 60000;
  // Monkeytype's convention: one "word" is five characters.
  const wpm = minutes > 0 ? Math.round(correctChars.current / 5 / minutes) : 0;
  const accuracy =
    typedChars.current > 0 ? Math.round((correctChars.current / typedChars.current) * 100) : 100;

  const surface = useMemo(() => {
    const results = resultsRef.current;

    // Newest cumulative document that is both reached and compiled.
    let docPng: string | undefined;
    for (let k = Math.min(doneCount, lines.length); k >= 1; k--) {
      const hit = results.get(`doc:${k}`);
      if (hit) {
        docPng = hit;
        break;
      }
    }

    // The largest stable boundary at or behind the caret whose fragment landed.
    let fragPng: string | undefined;
    let fragBoundary = 0;
    if (!finished) {
      for (const b of infos[doneCount].boundaries) {
        if (b > pos) break;
        const hit = results.get(`frag:${doneCount}:${b}`);
        if (hit) {
          fragPng = hit;
          fragBoundary = b;
        }
      }
    }

    const goal = finished ? "" : infos[doneCount].goal;
    let nextGoal: string | undefined;
    for (let li = doneCount + 1; li < lines.length; li++) {
      if (infos[li].goal.length > 0) {
        nextGoal = infos[li].goal;
        break;
      }
    }

    return renderSurface({
      prose: problem.prose,
      docPng,
      fragPng,
      greenSrc: goal.slice(fragBoundary, pos),
      surplus,
      graySrc: goal.slice(pos),
      nextGoal,
      width: SURFACE_W,
      height: SURFACE_H,
      stats: {
        wpm,
        accuracy,
        combo: combo.current,
        doneLines: doneCount,
        totalLines: lines.length,
        seconds: elapsedMs / 1000,
        finished,
      },
    });
    // tick keeps the surface in step with the results map and ref counters
  }, [lines, infos, doneCount, pos, surplus, tick, finished, problem]);

  return (
    <Grid
      columns={1}
      aspectRatio="16/9"
      fit={Grid.Fit.Contain}
      inset={Grid.Inset.Small}
      filtering={false}
      searchText={ZWSP.repeat(sentinels) + surplus}
      onSearchTextChange={onType}
      searchBarPlaceholder={finished ? "完成！ ⌘R でもう一回" : "ここに打つ"}
      navigationTitle={`${problem.title} — ${doneCount}/${lines.length} 行${wpm ? ` ・ ${wpm} WPM` : ""}`}
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
                let d = doneCount + 1;
                while (d < lines.length && infos[d].goal.length === 0) d++;
                setDoneCount(d);
                setPos(0);
                setSurplus("");
              }}
            />
            <Action.CopyToClipboard title="お手本をコピー" content={problem.reference} />
          </ActionPanel>
        }
      />
    </Grid>
  );
}
