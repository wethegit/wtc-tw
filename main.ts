import { Command } from "@cliffy/command";
import { Input, prompt } from "@cliffy/prompt";
import denoJson from "./deno.json" with { type: "json" };

const { version } = denoJson;
import type { Config } from "./src/types.ts";
import {
  loadConfig,
  loadExtraTasks,
  loadFavorites,
  saveConfig,
  saveExtraTasks,
} from "./src/config.ts";
import { createApi } from "./src/api/client.ts";
import {
  fetchAllTasks,
  fetchMe,
  fetchRunningTimer,
  fetchTaskById,
} from "./src/api/teamwork.ts";
import { write, log } from "./src/ui/terminal.ts";
import { runInteractive } from "./src/commands/interactive.ts";
import { showSplash } from "./src/commands/splash.ts";
import {
  buildTimerCommand,
  buildTaskCommand,
  buildFavCommand,
} from "./src/commands/cli-commands.ts";

// ─── Config Flow ──────────────────────────────────────────────────────────────

async function runConfigFlow(): Promise<Config> {
  console.log("Welcome! Let's configure your Teamwork CLI.\n");

  const result = await prompt([
    {
      name: "site",
      message: "Teamwork site (e.g. yourcompany.teamwork.com):",
      type: Input,
    },
    {
      name: "token",
      message: "Teamwork API token:",
      type: Input,
    },
  ]);

  const config: Config = {
    site: result.site!.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    token: result.token!,
  };

  await saveConfig(config);
  console.log("\nConfiguration saved to ~/.wtctw/config.json\n");
  return config;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(configOnly: boolean): Promise<void> {
  if (!configOnly) await showSplash(version);

  let config = await loadConfig();

  log(`Running teamwork-cli with configOnly=${configOnly}`, {
    configLoaded: !!config,
  });

  if (!config || configOnly) {
    config = await runConfigFlow();
    if (configOnly) return;
  }

  write("  Fetching your workload…\r");

  const api = createApi(config);

  try {
    const user = await fetchMe(api);
    const [fetchedTasks, timerResult, loadedFavs, loadedExtra] =
      await Promise.all([
        fetchAllTasks(api, user.id),
        fetchRunningTimer(api),
        loadFavorites(),
        loadExtraTasks(),
      ]);

    const tasks = fetchedTasks;
    const timer = timerResult;
    const timerStatus = timerResult.error ? `timer: ${timerResult.error}` : "";
    const favs = loadedFavs;
    const extraFavTasks = loadedExtra;

    // Migration: fetch any favourited task IDs not yet in extra-tasks.json
    const knownIds = new Set([
      ...tasks.map((t) => String(t.id)),
      ...extraFavTasks.keys(),
    ]);
    const missingIds = [...favs].filter((id) => !knownIds.has(id));
    if (missingIds.length > 0) {
      const fetched = await Promise.all(
        missingIds.map((id) => fetchTaskById(api, id)),
      );
      let updated = false;
      for (const task of fetched) {
        if (task) {
          extraFavTasks.set(task.id, task);
          updated = true;
        }
      }
      if (updated) await saveExtraTasks(extraFavTasks);
    }

    await runInteractive(
      tasks,
      user,
      config,
      api,
      timer,
      timerStatus,
      favs,
      extraFavTasks,
    );
  } catch (err) {
    write("\n");
    console.error(`Error: ${(err as Error).message}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await new Command()
    .name("wtctw")
    .version(version)
    .description("WTC Teamwork CLI — Workload at a glance")
    .option("-c, --config", "Run the configuration setup")
    .action(async ({ config }) => {
      await run(config ?? false);
    })
    .command("timer", buildTimerCommand())
    .command("task", buildTaskCommand())
    .command("fav", buildFavCommand())
    .parse(Deno.args);
}
