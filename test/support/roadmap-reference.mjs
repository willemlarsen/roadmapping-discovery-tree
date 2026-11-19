const STATUSES = ["done", "now", "next", "blocked", "paused", "merged"];

const unescaped = (quoted) => JSON.parse(`"${quoted}"`);

function wordOf(renderJs, status) {
  const line = renderJs.match(new RegExp(`^\\s*${status}:\\s*\\([^)]*\\)\\s*=>\\s*[\`"]([^"\`$]*)`, "m"));
  return line[1].trim();
}

function ruleBody(indexHtml, status) {
  const rule = indexHtml.match(new RegExp(`li > div\\[data-status="${status}"\\]\\s*\\{([^}]*)\\}`));
  return rule[1];
}

function declared(body, property) {
  const found = body.match(new RegExp(`(?:^|[\\s;])${property}:\\s*([^;]+)`));
  return found && found[1].trim();
}

function bordersOf(indexHtml) {
  const base = indexHtml.match(/li > div \{[^}]*border: (\S+) (\S+) var\(--edge\)/);
  const borders = {};
  for (const status of STATUSES) {
    const body = ruleBody(indexHtml, status);
    borders[status] = {
      borderColor: declared(body, "border-color").replace(/^var\((.*)\)$/, "$1"),
      borderStyle: declared(body, "border-style") ?? base[2],
      borderWidth: declared(body, "border-width") ?? base[1],
      boxShadow: declared(body, "box-shadow") !== null,
    };
  }
  return borders;
}

export function deriveRoadmapReference(renderJs, indexHtml) {
  return {
    words: {
      now: wordOf(renderJs, "now"),
      next: wordOf(renderJs, "next"),
      merged: wordOf(renderJs, "merged"),
      donePrefix: wordOf(renderJs, "done"),
    },
    pausedMark: unescaped(renderJs.match(/function pauseMark[\s\S]*?"span", "([^"]*)"/)[1]),
    parkedHeading: renderJs.match(/"h2", "(Parked[^"]*)"/)[1],
    borders: bordersOf(indexHtml),
  };
}
