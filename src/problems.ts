import { environment } from "@raycast/api";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

export type Problem = {
  id: string;
  level: number;
  title: string;
  /** The English prose the player has to typeset. */
  prose: string;
  /** One correct LaTeX rendering of the prose. Used for copy-mode and for the side-by-side. */
  reference: string;
  /** Elements the answer must contain in free mode, regardless of how it is written. */
  required: { label: string; pattern: string }[];
  /** Extra preamble lines when the problem needs packages beyond the default set. */
  preamble?: string;
};

export function loadProblems(): Problem[] {
  const dir = join(environment.assetsPath, "problems");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Problem);
}
