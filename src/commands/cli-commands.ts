import { Command } from "@cliffy/command";
import type { ApiClient, Config, Task } from "../types.ts";
import {
  loadConfig,
  loadExtraTasks,
  loadFavorites,
  saveExtraTasks,
  saveFavorites,
} from "../config.ts";
import { createApi } from "../api/client.ts";
import {
  completeTimer,
  deleteTimer,
  fetchAllTasks,
  fetchAllTimers,
  fetchMe,
  fetchRunningTimer,
  fetchTaskById,
  postComment,
  reassignTask,
  startTimer,
} from "../api/teamwork.ts";
import { openInBrowser } from "./browser.ts";
import { getTaskGroup, GROUP_LABEL } from "../core/task-grouping.ts";
import {
  fmtMinutes,
  getTodayStr,
  getTomorrowStr,
  timerElapsedMin,
} from "../ui/formatters.ts";

//  Shared bootstrap

async function getApiAndConfig(): Promise<{ api: ApiClient; config: Config }> {
  const config = await loadConfig();
  if (!config) {
    console.error("Not configured. Run: wtctw --config");
    Deno.exit(1);
  }
  return { api: createApi(config), config };
}

async function openEditorForInput(): Promise<string> {
  const tmpFile = `/tmp/wtctw_input_${Date.now()}.txt`;
  try {
    await Deno.writeTextFile(tmpFile, "");
    const editorEnv = Deno.env.get("EDITOR") ?? Deno.env.get("VISUAL") ?? "vi";
    const [editor, ...editorArgs] = editorEnv.split(" ");
    await new Deno.Command(editor, {
      args: [...editorArgs, tmpFile],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn().status;
    return (await Deno.readTextFile(tmpFile)).trim();
  } finally {
    await Deno.remove(tmpFile).catch(() => {});
  }
}

// Returns comment body from: -m flag → piped stdin → $EDITOR (in that priority order)
async function getCommentBody(message?: string): Promise<string> {
  if (message) return message;
  if (!Deno.stdin.isTerminal()) {
    const text = await new Response(Deno.stdin.readable).text();
    return text.trim();
  }
  return openEditorForInput();
}

//  Output formatters for task list

function tasksToJson(tasks: Task[]): string {
  return JSON.stringify(tasks, null, 2);
}

function tasksToCsv(tasks: Task[]): string {
  const header =
    "id,content,project,list,due-date,priority,estimated-minutes,logged-minutes";
  const rows = tasks.map((t) => {
    const cols = [
      t.id,
      `"${t.content.replace(/"/g, '""')}"`,
      `"${(t["project-name"] ?? "").replace(/"/g, '""')}"`,
      `"${(t["todo-list-name"] ?? "").replace(/"/g, '""')}"`,
      t["due-date"] ?? "",
      t.priority ?? "",
      t["estimated-minutes"] ?? 0,
      t["total-minutes-logged"] ?? 0,
    ];
    return cols.join(",");
  });
  return [header, ...rows].join("\n");
}

//  Timer commands

export function buildTimerCommand(): Command {
  const cmd = new Command().description("Manage timers").action(function () {
    this.showHelp();
  });

  cmd
    .command("list")
    .description("List all timers (running and paused)")
    .action(async () => {
      const { api } = await getApiAndConfig();
      const timers = await fetchAllTimers(api);
      if (timers.length === 0) {
        console.log("No timers found.");
        return;
      }
      for (const t of timers) {
        const dot = t.running ? "●" : "○";
        const state = t.running ? "Running" : "Paused ";
        const elapsed = timerElapsedMin(t);
        const time = elapsed > 0 ? fmtMinutes(elapsed) : "";
        const task = (t.taskName ?? "Unknown task").padEnd(48);
        const proj = (t.projectName ?? "").padEnd(20);
        console.log(
          `${dot} ${state}  ${task}  ${proj}  ${time.padStart(6)}  [id: ${t.id}]`,
        );
      }
    });

  cmd
    .command("start")
    .description("Start a timer for a task")
    .arguments("<task-id:string>")
    .action(async (_opts, taskId) => {
      const { api } = await getApiAndConfig();
      const task = await fetchTaskById(api, taskId);
      if (!task) {
        console.error(`Task ${taskId} not found.`);
        Deno.exit(1);
      }
      if (!task["project-id"]) {
        console.error("Task has no project ID.");
        Deno.exit(1);
      }
      await startTimer(api, task.id, task["project-id"]);
      console.log(`Timer started: ${task.content}`);
    });

  cmd
    .command("stop")
    .description("Stop the currently running timer")
    .action(async () => {
      const { api } = await getApiAndConfig();
      const { timer, task } = await fetchRunningTimer(api);
      if (!timer) {
        console.log("No running timer.");
        return;
      }
      await completeTimer(api, timer.id);
      const elapsed = timerElapsedMin(timer);
      const name = task?.content ?? "Unknown task";
      const elapsedStr = elapsed > 0 ? ` (${fmtMinutes(elapsed)})` : "";
      console.log(`Timer stopped: ${name}${elapsedStr}`);
    });

  cmd
    .command("delete")
    .description("Delete a timer by ID")
    .arguments("<timer-id:string>")
    .action(async (_opts, timerId) => {
      const { api } = await getApiAndConfig();
      await deleteTimer(api, timerId);
      console.log("Timer deleted.");
    });

  cmd
    .command("open")
    .description("Open the running timer's task in the browser")
    .action(async () => {
      const { api, config } = await getApiAndConfig();
      const { timer, task } = await fetchRunningTimer(api);
      if (!timer) {
        console.log("No running timer.");
        return;
      }
      if (!timer.taskId) {
        console.error("Running timer has no associated task.");
        Deno.exit(1);
      }
      openInBrowser(`https://${config.site}/tasks/${timer.taskId}`);
      console.log(`Opening: ${task?.content ?? timer.taskId}`);
    });

  return cmd;
}

//  Task commands

export function buildTaskCommand(): Command {
  const cmd = new Command()
    .description("Interact with tasks")
    .action(function () {
      this.showHelp();
    });

  cmd
    .command("list")
    .description("List your assigned tasks")
    .option(
      "-f, --format <format:string>",
      "Output format: table (default), csv, json",
    )
    .action(async ({ format }) => {
      const { api } = await getApiAndConfig();
      const me = await fetchMe(api);
      const tasks = await fetchAllTasks(api, me.id);
      if (tasks.length === 0) {
        console.log("No tasks found.");
        return;
      }

      if (format === "json") {
        console.log(tasksToJson(tasks));
        return;
      }

      if (format === "csv") {
        console.log(tasksToCsv(tasks));
        return;
      }

      // Default: grouped table
      const today = getTodayStr();
      const tomorrow = getTomorrowStr();
      let lastGroup = "";
      for (const t of tasks) {
        const group = GROUP_LABEL[getTaskGroup(t, today, tomorrow)];
        if (group !== lastGroup) {
          console.log(`\n${group}`);
          lastGroup = group;
        }
        const est = t["estimated-minutes"]
          ? `  ${fmtMinutes(t["estimated-minutes"])} est`
          : "";
        const proj = t["project-name"] ? `  [${t["project-name"]}]` : "";
        console.log(`  ${t.content}${proj}${est}  (id: ${t.id})`);
      }
    });

  cmd
    .command("view")
    .description("View details of a task")
    .arguments("<task-id:string>")
    .action(async (_opts, taskId) => {
      const { api } = await getApiAndConfig();
      const task = await fetchTaskById(api, taskId);
      if (!task) {
        console.error(`Task ${taskId} not found.`);
        Deno.exit(1);
      }
      const est = task["estimated-minutes"]
        ? fmtMinutes(task["estimated-minutes"])
        : "—";
      const logged = task["total-minutes-logged"]
        ? fmtMinutes(task["total-minutes-logged"])
        : "—";
      console.log(`Task:      ${task.content}`);
      console.log(`Project:   ${task["project-name"]}`);
      console.log(`List:      ${task["todo-list-name"]}`);
      console.log(`Due:       ${task["due-date"] || "none"}`);
      console.log(`Priority:  ${task.priority || "none"}`);
      console.log(`Estimated: ${est}`);
      console.log(`Logged:    ${logged}`);
      console.log(`Status:    ${task.completed ? "complete" : "incomplete"}`);
    });

  cmd
    .command("comment")
    .description("Post a comment on a task")
    .arguments("<task-id:string>")
    .option(
      "-m, --message <message:string>",
      "Comment body (omit to open $EDITOR)",
    )
    .action(async ({ message }, taskId) => {
      const { api } = await getApiAndConfig();
      const body = await getCommentBody(message);
      if (!body) {
        console.log("No comment posted.");
        return;
      }
      await postComment(api, taskId, body);
      console.log("Comment posted.");
    });

  cmd
    .command("handback")
    .description("Post a comment and reassign the task to its creator")
    .arguments("<task-id:string>")
    .option(
      "-m, --message <message:string>",
      "Comment body (omit to open $EDITOR)",
    )
    .action(async ({ message }, taskId) => {
      const { api } = await getApiAndConfig();
      const body = await getCommentBody(message);
      if (!body) {
        console.log("Cancelled.");
        return;
      }
      await postComment(api, taskId, body);
      const task = await fetchTaskById(api, taskId);
      const creatorId = task?.["creator-id"];
      if (!creatorId) {
        console.error("Could not determine task creator.");
        Deno.exit(1);
      }
      await reassignTask(api, taskId, creatorId);
      console.log("Comment posted and task reassigned.");
    });

  cmd
    .command("open")
    .description("Open a task in the browser")
    .arguments("<task-id:string>")
    .action(async (_opts, taskId) => {
      const { api, config } = await getApiAndConfig();
      const task = await fetchTaskById(api, taskId);
      openInBrowser(`https://${config.site}/tasks/${taskId}`);
      if (task) console.log(`Opening: ${task.content}`);
    });

  return cmd;
}

//  Fav commands

export function buildFavCommand(): Command {
  const cmd = new Command()
    .description("Manage favourited tasks")
    .action(function () {
      this.showHelp();
    });

  cmd
    .command("list")
    .description("List all favourited tasks")
    .action(async () => {
      const { api } = await getApiAndConfig();
      const me = await fetchMe(api);
      const [favs, extraTasks, allTasks] = await Promise.all([
        loadFavorites(),
        loadExtraTasks(),
        fetchAllTasks(api, me.id),
      ]);
      const taskMap = new Map(allTasks.map((t) => [String(t.id), t]));
      const favList = [...favs]
        .map((id) => taskMap.get(id) ?? extraTasks.get(id))
        .filter(Boolean);
      if (favList.length === 0) {
        console.log("No favourites.");
        return;
      }
      const today = getTodayStr();
      const tomorrow = getTomorrowStr();
      for (const task of favList) {
        if (!task) continue;
        const group = GROUP_LABEL[getTaskGroup(task, today, tomorrow)];
        const name = task.content.padEnd(50);
        const proj = task["project-name"].padEnd(20);
        console.log(`★ ${name}  ${proj}  ${group}`);
      }
    });

  cmd
    .command("add")
    .description("Add a task to favourites")
    .arguments("<task-id:string>")
    .action(async (_opts, taskId) => {
      const { api } = await getApiAndConfig();
      const [favs, extraTasks] = await Promise.all([
        loadFavorites(),
        loadExtraTasks(),
      ]);
      if (favs.has(taskId)) {
        console.log("Already in favourites.");
        return;
      }
      const task = await fetchTaskById(api, taskId);
      if (!task) {
        console.error(`Task ${taskId} not found.`);
        Deno.exit(1);
      }
      favs.add(taskId);
      extraTasks.set(taskId, task);
      await Promise.all([saveFavorites(favs), saveExtraTasks(extraTasks)]);
      console.log(`Added to favourites: ${task.content}`);
    });

  cmd
    .command("remove")
    .description("Remove a task from favourites")
    .arguments("<task-id:string>")
    .action(async (_opts, taskId) => {
      const [favs, extraTasks] = await Promise.all([
        loadFavorites(),
        loadExtraTasks(),
      ]);
      if (!favs.has(taskId)) {
        console.log("Not in favourites.");
        return;
      }
      favs.delete(taskId);
      extraTasks.delete(taskId);
      await Promise.all([saveFavorites(favs), saveExtraTasks(extraTasks)]);
      console.log("Removed from favourites.");
    });

  return cmd;
}
