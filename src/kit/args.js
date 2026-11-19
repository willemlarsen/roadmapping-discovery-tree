const isFlag = (arg) => arg.startsWith("--");

export function splitArgs(args) {
  const flags = [];
  const positionals = [];
  let index = 0;
  while (index < args.length) {
    if (isFlag(args[index])) {
      flags.push(args[index], args[index + 1]);
      index += 2;
    } else {
      positionals.push(args[index]);
      index += 1;
    }
  }
  return { flags, positionals };
}
