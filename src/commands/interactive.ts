import type {
  ApiClient,
  Config,
  Me,
  RunningTimer,
  SortOrder,
  Task,
  TimerObject,
} from "../types.ts";
import { SHOW_CUR } from "../ui/ansi.ts";
import { write, log } from "../ui/terminal.ts";
import {
  createTaskListView,
  tlvClamp,
  tlvDown,
  tlvPageDown,
  tlvPageUp,
  tlvUp,
} from "../ui/task-list-view.ts";
import {
  renderTaskListScreen,
  renderTimersScreen,
  getViewportSizes,
} from "../ui/renderers.ts";
import { saveFavorites, saveExtraTasks } from "../config.ts";
import {
  completeTimer,
  deleteTimer,
  fetchAllTasks,
  fetchAllTimers,
  fetchRunningTimer,
  fetchSearchTasks,
  fetchTaskById,
  postComment,
  reassignTask,
  startTimer,
} from "../api/teamwork.ts";
import { openInBrowser } from "./browser.ts";

// Key codes
const KEY = {
  Q: 0x71,
  CTRL_C: 0x03,
  CTRL_D: 0x04,
  ESC: 0x1b,
  BRACKET: 0x5b,
  UP: 0x41,
  DOWN: 0x42,
  BACKSPACE: 0x7f,
  DELETE: 0x08,
  ENTER: 0x0d,
  O: 0x6f,
  V: 0x76,
  S: 0x73,
  F: 0x66,
  F_UPPER: 0x46,
  T_UPPER: 0x54,
  C: 0x63,
  D: 0x64,
  P: 0x70,
  X: 0x78,
  SLASH: 0x2f,
  PAGE_UP_SEQ: [0x1b, 0x5b, 0x35, 0x7e],
  PAGE_DOWN_SEQ: [0x1b, 0x5b, 0x36, 0x7e],
} as const;

// Helper functions
const matchesSeq = (buf: Uint8Array, seq: readonly number[]): boolean =>
  seq.every((byte, i) => buf[i] === byte);

const isArrowUp = (b: Uint8Array): boolean =>
  b[0] === KEY.ESC && b[1] === KEY.BRACKET && b[2] === KEY.UP;

const isArrowDown = (b: Uint8Array): boolean =>
  b[0] === KEY.ESC && b[1] === KEY.BRACKET && b[2] === KEY.DOWN;

const isPageUp = (b: Uint8Array): boolean => matchesSeq(b, KEY.PAGE_UP_SEQ);

const isPageDown = (b: Uint8Array): boolean => matchesSeq(b, KEY.PAGE_DOWN_SEQ);

const isPrintable = (byte: number): boolean => byte >= 0x20 && byte <= 0x7e;

export async function runInteractive(
  tasks: Task[],
  user: Me,
  config: Config,
  api: ApiClient,
  initialTimer: TimerObject | null,
  initialStatus: string,
  initialFavorites: Set<string>,
  initialExtraTasks: Map<string, Task>,
): Promise<void> {
  // State
  let view: "tasks" | "timers" | "favorites" = "tasks";

  let allTasks = tasks;
  let allTaskIds = new Set(allTasks.map((t) => String(t.id)));
  // Tasks favourited from search/other sources that aren't in allTasks
  const extraTasks = initialExtraTasks;
  let currentTimer = initialTimer;
  let statusMsg = initialStatus;
  const favorites = initialFavorites;
  let searchQuery = "";
  let searchMode = false;
  let sortOrder: SortOrder = "due";

  let tasksView = createTaskListView(allTasks, sortOrder);
  let favsView = createTaskListView([]);

  // timers view
  let timerSel = 0;
  let allTimers: RunningTimer[] = [];
  let timerStatusMsg = "";

  const getVP = (): number => {
    try {
      const {
        headerH: _headerH,
        footerH: _footerH,
        viewportRows,
      } = getViewportSizes(currentTimer, searchMode, searchQuery);
      return viewportRows;
    } catch {
      return 15;
    }
  };

  const buildFavsTaskList = () => [
    ...allTasks.filter((t) => favorites.has(String(t.id))),
    ...[...extraTasks.values()].filter((t) => favorites.has(String(t.id))),
  ];

  const activeLv = () => (view === "favorites" ? favsView : tasksView);

  // Helper: Toggle favorite for a task
  const toggleFavorite = async (taskId: string, task: Task) => {
    if (favorites.has(taskId)) {
      favorites.delete(taskId);
      if (extraTasks.has(taskId)) {
        extraTasks.delete(taskId);
        await saveExtraTasks(extraTasks);
      }
    } else {
      favorites.add(taskId);
      // Persist tasks from search that aren't in the main task list
      if (!allTaskIds.has(taskId)) {
        extraTasks.set(taskId, { ...task, id: taskId });
        await saveExtraTasks(extraTasks);
      }
    }
    await saveFavorites(favorites);
    favsView = createTaskListView(buildFavsTaskList());
  };

  // Helper: Execute async action with error handling
  const tryAction = async (
    action: () => Promise<void>,
    msgTarget: "status" | "timer" = "status",
  ) => {
    const setMsg = (msg: string) => {
      if (msgTarget === "timer") timerStatusMsg = msg;
      else statusMsg = msg;
    };
    setMsg("");
    try {
      await action();
    } catch (err) {
      setMsg((err as Error).message);
    }
    render();
  };

  // Re-fetches tasks and timer, rebuilds views in-place.
  const refreshData = async () => {
    const [fetchedTasks, timerResult] = await Promise.all([
      fetchAllTasks(api, user.id),
      fetchRunningTimer(api),
    ]);
    allTasks = fetchedTasks;
    allTaskIds = new Set(allTasks.map((t) => String(t.id)));
    currentTimer = timerResult;
    tasksView = createTaskListView(allTasks, sortOrder);
    favsView = createTaskListView(buildFavsTaskList());
  };

  // Opens $EDITOR on a temp file and returns the trimmed contents.
  const openEditor = async (): Promise<string> => {
    const tmpFile = `/tmp/wtctw_input_${Date.now()}.txt`;
    pollActive = false;
    Deno.stdin.setRaw(false);
    write(SHOW_CUR);
    try {
      await Deno.writeTextFile(tmpFile, "");
      const editor = Deno.env.get("EDITOR") ?? Deno.env.get("VISUAL") ?? "vi";
      await new Deno.Command(editor, {
        args: [tmpFile],
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).spawn().status;
      return (await Deno.readTextFile(tmpFile)).trim();
    } finally {
      await Deno.remove(tmpFile).catch(() => {});
      Deno.stdin.setRaw(true);
      pollActive = true;
    }
  };

  const render = () => {
    const vp = getVP();
    if (view === "tasks") {
      write(
        renderTaskListScreen(
          tlvClamp(tasksView, vp),
          user,
          currentTimer,
          favorites,
          statusMsg,
          {
            showSummary: true,
            searchQuery,
            searchMode,
            type: "main",
            sortOrder,
          },
        ),
      );
    } else if (view === "favorites") {
      write(
        renderTaskListScreen(
          tlvClamp(favsView, vp),
          user,
          currentTimer,
          favorites,
          statusMsg,
          {
            title: "/ Favourites",
            showSummary: false,
            searchQuery,
            searchMode,
            type: "favorites",
          },
        ),
      );
    } else {
      write(renderTimersScreen(allTimers, timerSel, user, timerStatusMsg));
    }
  };
  render();

  let pollActive = true;
  const pollId = setInterval(async () => {
    if (!pollActive) return;
    try {
      await refreshData();
      render();
    } catch {
      /* silently ignore background poll errors */
    }
  }, 60_000);

  Deno.stdin.setRaw(true);
  const buf = new Uint8Array(8);

  try {
    loop: while (true) {
      const n = await Deno.stdin.read(buf);
      if (n === null) break;

      const b = buf.slice(0, n);

      // q / Ctrl-C / Ctrl-D → quit (all views)
      if (b[0] === KEY.Q || b[0] === KEY.CTRL_C || b[0] === KEY.CTRL_D)
        break loop;

      // Bare ESC → clear search if active, then navigate back
      if (b[0] === KEY.ESC && n === 1) {
        if (searchMode || searchQuery) {
          searchMode = false;
          searchQuery = "";
          tasksView = createTaskListView(allTasks, sortOrder);
          favsView = createTaskListView(buildFavsTaskList());
        } else if (view !== "tasks") {
          view = "tasks";
        }
        render();
        continue;
      }

      // Arrow keys and page navigation
      if (isArrowUp(b)) {
        if (view === "tasks") tasksView = tlvUp(tasksView);
        else if (view === "favorites") favsView = tlvUp(favsView);
        else timerSel = Math.max(0, timerSel - 1);
        render();
        continue;
      }

      if (isArrowDown(b)) {
        if (view === "tasks") tasksView = tlvDown(tasksView);
        else if (view === "favorites") favsView = tlvDown(favsView);
        else if (allTimers.length > 0) {
          timerSel = Math.min(allTimers.length - 1, timerSel + 1);
        }
        render();
        continue;
      }

      if (isPageUp(b)) {
        const vp = getVP();
        if (view === "tasks") tasksView = tlvPageUp(tasksView, vp);
        else if (view === "favorites") favsView = tlvPageUp(favsView, vp);
        render();
        continue;
      }

      if (isPageDown(b)) {
        const vp = getVP();
        if (view === "tasks") tasksView = tlvPageDown(tasksView, vp);
        else if (view === "favorites") favsView = tlvPageDown(favsView, vp);
        render();
        continue;
      }

      // Search mode input──────────────────────────────────────────────────

      if (searchMode) {
        const char = b[0];
        if (isPrintable(char)) {
          searchQuery += String.fromCharCode(char);
          render();
        } else if (char === KEY.BACKSPACE || char === KEY.DELETE) {
          searchQuery = searchQuery.slice(0, -1);
          render();
        } else if (char === KEY.ENTER) {
          if (searchQuery.trim()) {
            searchMode = false;
            statusMsg = "Searching…";
            view = "tasks";
            render();
            try {
              const results = await fetchSearchTasks(api, searchQuery);
              tasksView = createTaskListView(results);
              statusMsg = results.length === 0 ? "No results found." : "";
            } catch (err) {
              statusMsg = (err as Error).message;
            }
          } else {
            searchMode = false;
          }
          render();
        }
        continue;
      }

      // Task-list view keys (tasks OR favorites)───────────────────────────

      if (view === "tasks" || view === "favorites") {
        const lv = activeLv();

        // o - open in browser
        if (b[0] === KEY.O && lv.tasks.length > 0) {
          openInBrowser(`https://${config.site}/tasks/${lv.tasks[lv.sel].id}`);
          continue;
        }

        // s - start timer (completing any existing timer for this task first)
        if (b[0] === KEY.S && lv.tasks.length > 0) {
          const task = lv.tasks[lv.sel];
          await tryAction(async () => {
            // Fetch timer list without task details — we only need ids/taskIds here
            const timers = await fetchAllTimers(api, false);
            log("timers for s handler", timers.length);

            // If the current timer is for the selected task, complete it.
            if (currentTimer?.timer?.taskId === String(task.id)) {
              log("Stopping current timer for task", task.id);
              await completeTimer(api, currentTimer.timer.id);
              currentTimer = null;
              return;
            }

            // Otherwise, see if there are any paused timers for this task and complete them (Teamwork only allows one running timer per task, but multiple paused timers can exist)
            for (const timer of timers) {
              if (String(timer.taskId) === String(task.id)) {
                // This try...catch is a belt-and-braces attempt to ensure we don't leave orphaned timers running if the completeTimer call fails for some reason
                try {
                  log("Completing timer", timer.taskId, task.id);
                  await completeTimer(api, timer.id);
                } catch (err) {
                  log("Error completing timer", timer.taskId, err);
                }
              }
            }

            // Finally, start up the new timer
            const projectId = task["project-id"];
            if (!projectId) throw new Error("Task has no project ID");
            await startTimer(api, task.id, projectId);
            currentTimer = await fetchRunningTimer(api);
          });
          continue;
        }

        // f - toggle favourite
        if (b[0] === KEY.F && lv.tasks.length > 0) {
          const task = lv.tasks[lv.sel];
          await toggleFavorite(String(task.id), task);
          render();
          continue;
        }

        // c - post comment via $EDITOR
        if (b[0] === KEY.C && lv.tasks.length > 0) {
          const task = lv.tasks[lv.sel];
          const body = await openEditor();
          if (body) {
            await tryAction(async () => {
              await postComment(api, task.id, body);
              statusMsg = "Comment posted.";
            });
          } else {
            statusMsg = "No comment posted.";
            render();
          }
          continue;
        }

        // x - post comment and reassign to task creator
        if (b[0] === KEY.X && lv.tasks.length > 0) {
          const task = lv.tasks[lv.sel];
          const body = await openEditor();
          if (!body) {
            statusMsg = "Cancelled.";
            render();
            continue;
          }
          await tryAction(async () => {
            await postComment(api, task.id, body);
            const fullTask = await fetchTaskById(api, task.id);
            const creatorId = fullTask?.["creator-id"];
            if (!creatorId) throw new Error("Could not determine task creator");
            await reassignTask(api, task.id, creatorId);
            await refreshData();
            statusMsg = "Comment posted and task reassigned.";
          });
          continue;
        }

        // / - enter search mode
        if (b[0] === KEY.SLASH) {
          searchMode = true;
          render();
          continue;
        }

        // Tasks-only keys────────────────────────────────────────────────

        if (view === "tasks") {
          // F - open favourites screen
          if (b[0] === KEY.F_UPPER) {
            view = "favorites";
            searchQuery = "";
            searchMode = false;
            tasksView = createTaskListView(allTasks, sortOrder);
            favsView = createTaskListView(buildFavsTaskList());
            render();
            continue;
          }

          // v - toggle sort order (clears active search)
          if (b[0] === KEY.V) {
            sortOrder = sortOrder === "due" ? "priority" : "due";
            searchQuery = "";
            searchMode = false;
            tasksView = createTaskListView(allTasks, sortOrder);
            render();
            continue;
          }

          // T - open timers view
          if (b[0] === KEY.T_UPPER) {
            log("T pressed: entering timers view");
            await tryAction(async () => {
              log("T: calling fetchAllTimers");
              const t0 = Date.now();
              allTimers = await fetchAllTimers(api);
              log(
                `T: fetchAllTimers returned in ${Date.now() - t0}ms, ${allTimers.length} timers`,
              );
              timerSel = 0;
              view = "timers";
              log("T: view set, render about to fire");
            });
            log("T: tryAction complete");
            continue;
          }
        }
      } else if (view === "timers") {
        // o - open in browser
        if (b[0] === KEY.O && allTimers.length > 0) {
          openInBrowser(
            `https://${config.site}/tasks/${allTimers[timerSel].taskId}`,
          );
          continue;
        }

        // s - complete selected timer
        if (b[0] === KEY.S && allTimers.length > 0) {
          await tryAction(async () => {
            await completeTimer(api, allTimers[timerSel].id);
            allTimers = await fetchAllTimers(api);
            timerSel = Math.min(timerSel, Math.max(0, allTimers.length - 1));
            currentTimer = await fetchRunningTimer(api);
          }, "timer");
          continue;
        }

        // d - delete selected timer
        if (b[0] === KEY.D && allTimers.length > 0) {
          await tryAction(async () => {
            await deleteTimer(api, allTimers[timerSel].id);
            allTimers = await fetchAllTimers(api);
            timerSel = Math.min(timerSel, Math.max(0, allTimers.length - 1));
            currentTimer = await fetchRunningTimer(api);
          }, "timer");
          continue;
        }

        // f - toggle favourite
        if (b[0] === KEY.F && allTimers.length > 0) {
          const timer = allTimers[timerSel];
          const taskId = String(timer.taskId);
          const taskDetail = await fetchTaskById(api, taskId);
          await toggleFavorite(taskId, taskDetail as Task);
          render();
          continue;
        }
      }
    }
  } finally {
    clearInterval(pollId);
    Deno.stdin.setRaw(false);
    write(SHOW_CUR + "\n");
  }
}
