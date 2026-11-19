const AA_MINIMUM_RATIO = 4.5;
const ROOT_BLOCK = /:root\s*\{([^}]*)\}/;
const SIX_DIGIT_HEX = /^#[0-9a-fA-F]{6}$/;

function linearChannel(hex, start) {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  return 0.2126 * linearChannel(hex, 1) + 0.7152 * linearChannel(hex, 3) + 0.0722 * linearChannel(hex, 5);
}

export function contrastRatio(fg, bg) {
  const [lighter, darker] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export function failingPairs(pairs) {
  return pairs
    .map(([fg, bg]) => ({ fg, bg, ratio: contrastRatio(fg, bg) }))
    .filter(({ ratio }) => ratio < AA_MINIMUM_RATIO);
}

function readRootTokens(html) {
  const rootBlock = html.match(ROOT_BLOCK)[1];
  return Object.fromEntries(
    [...rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  );
}

function tokenValue(tokens, name) {
  if (!(name in tokens)) throw new Error(`token ${name} is not defined in :root`);
  if (!SIX_DIGIT_HEX.test(tokens[name])) throw new Error(`token ${name} is not a six-digit hex colour`);
  return tokens[name];
}

export function resolvePairs(html, tokenPairs) {
  const tokens = readRootTokens(html);
  return tokenPairs.map((names) => names.map((name) => tokenValue(tokens, name)));
}

export function colourLiteralsOutsideRoot(html) {
  const outsideRoot = html.replace(ROOT_BLOCK, "");
  return outsideRoot.match(/#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)/g) ?? [];
}
