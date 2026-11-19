import { join } from "node:path";
import { validateDecisionLog } from "../decisions.js";
import { validateRoadmap } from "../validate.js";

export async function validateCommand(roadmapDir, deps) {
  const roadmap = await readRoadmap(roadmapDir, deps);
  if (roadmap === undefined) return reportError(deps, "roadmap unreadable");
  const roadmapVerdict = validateRoadmap(roadmap);
  if (!roadmapVerdict.valid) return reportError(deps, invalidLine(roadmapVerdict));
  const decisions = await readDecisions(roadmapDir, deps);
  if (decisions.unreadable) return reportError(deps, decisions.unreadable);
  const logVerdict = validateDecisionLog(decisions.entries, roadmap);
  if (!logVerdict.valid) return reportError(deps, invalidLine(logVerdict));
  deps.out.write("roadmap valid\n");
  return 0;
}

async function readRoadmap(roadmapDir, deps) {
  try {
    return JSON.parse(await deps.readFile(join(roadmapDir, "roadmap.json")));
  } catch {
    return undefined;
  }
}

async function readDecisions(roadmapDir, deps) {
  let text;
  try {
    text = await deps.readFile(join(roadmapDir, "decisions.jsonl"));
  } catch {
    return { unreadable: "decisions unreadable" };
  }
  return parseJsonLines(text);
}

function parseJsonLines(text) {
  const lines = text.split("\n");
  const badLineIndex = lines.findIndex((line) => !isBlank(line) && !isJson(line));
  if (badLineIndex !== -1) return { unreadable: `decisions unreadable: line ${badLineIndex + 1}` };
  return { entries: lines.filter((line) => !isBlank(line)).map((line) => JSON.parse(line)) };
}

function isBlank(line) {
  return line.trim() === "";
}

function isJson(line) {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

function reportError(deps, line) {
  deps.err.write(`${line}\n`);
  return 1;
}

function invalidLine(verdict) {
  return `roadmap invalid: ${distinctReasons(verdict.errors).join(", ")}`;
}

function distinctReasons(errors) {
  return [...new Set(errors.map((error) => error.reason))];
}
