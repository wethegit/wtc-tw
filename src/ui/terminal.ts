export function write(s: string): void {
  Deno.stdout.writeSync(new TextEncoder().encode(s));
}

export function stripAnsi(s: string): string {
  // deno-lint-ignore no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function padVisible(s: string, width: number): string {
  const len = stripAnsi(s).length;
  return s + " ".repeat(Math.max(0, width - len));
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const LOG_PATH = `/tmp/wtctw.log`;
const enc = new TextEncoder();

// Truncate log on each run so it doesn't grow unboundedly
try { Deno.writeFileSync(LOG_PATH, new Uint8Array(0)); } catch { /* ignore */ }

export function log(...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
  Deno.writeFileSync(LOG_PATH, enc.encode(line), { append: true });
}
