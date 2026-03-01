import { ensureDir } from "@std/fs/ensure-dir";
import { join } from "@std/path";
import type { Config, Task } from "./types.ts";

export function getConfigDir(): string {
  const home = Deno.env.get("HOME") ?? "";
  return join(home, ".wtctw");
}

export async function loadConfig(): Promise<Config | null> {
  try {
    const raw = await Deno.readTextFile(join(getConfigDir(), "config.json"));
    const cfg = JSON.parse(raw) as Partial<Config>;
    if (cfg.site && cfg.token) return cfg as Config;
    return null;
  } catch {
    return null;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const dir = getConfigDir();
  await ensureDir(dir);
  await Deno.writeTextFile(
    join(dir, "config.json"),
    JSON.stringify(config, null, 2),
  );
}

export async function loadFavorites(): Promise<Set<string>> {
  try {
    const raw = await Deno.readTextFile(join(getConfigDir(), "favorites.json"));
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export async function saveFavorites(favs: Set<string>): Promise<void> {
  const dir = getConfigDir();
  await ensureDir(dir);
  await Deno.writeTextFile(
    join(dir, "favorites.json"),
    JSON.stringify([...favs], null, 2),
  );
}

export async function loadExtraTasks(): Promise<Map<string, Task>> {
  try {
    const raw = await Deno.readTextFile(
      join(getConfigDir(), "extra-tasks.json"),
    );
    const arr = JSON.parse(raw) as Task[];
    return new Map(arr.map((t) => [String(t.id), t]));
  } catch {
    return new Map();
  }
}

export async function saveExtraTasks(tasks: Map<string, Task>): Promise<void> {
  const dir = getConfigDir();
  await ensureDir(dir);
  // Validate the tasks themselves
  tasks = new Map([...tasks].filter(([_k, v]) => v.content !== undefined));
  await Deno.writeTextFile(
    join(dir, "extra-tasks.json"),
    JSON.stringify([...tasks.values()], null, 2),
  );
}
