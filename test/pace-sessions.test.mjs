import { test } from "node:test";
import assert from "node:assert/strict";
import { sessions } from "../src/pace/sessions.js";
import { commitAt } from "./support/commits.mjs";

test("commits split into sessions at gaps over the limit, and a gap of exactly the limit stays together", () => {
  const commits = [0, 20, 80, 141, 150].map((minute) => commitAt(minute));
  const shuffled = [commits[3], commits[0], commits[4], commits[2], commits[1]];
  const before = [...shuffled];

  const found = sessions(shuffled, 60);

  assert.deepEqual(found, [commits.slice(0, 3), commits.slice(3)]);
  assert.deepEqual(shuffled, before);
});
