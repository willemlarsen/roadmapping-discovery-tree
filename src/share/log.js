const ALLOWED = ["productId", "status", "attempt", "outcome"];

export function createLogger(sink) {
  return (event, fields) => {
    const entry = { event };
    for (const name of ALLOWED) {
      if (name in fields) entry[name] = fields[name];
    }
    sink(JSON.stringify(entry));
  };
}
