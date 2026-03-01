import type {
  Me,
  RunningTimer,
  SortOrder,
  TaskGroup,
  TaskListView,
  TimerObject,
} from "../types.ts";
import {
  BOLD,
  CLEAR,
  CYAN,
  DIM,
  GREEN,
  HIDE_CUR,
  RED,
  RESET,
  REV,
  YELLOW,
} from "./ansi.ts";
import { padVisible, truncate } from "./terminal.ts";
import {
  fmtDueDate,
  fmtMinutes,
  fmtTimeColumn,
  getTodayStr,
  getTomorrowStr,
  isOverdue,
  priorityTag,
  taskDueDateColor,
  timerElapsedMin,
} from "./formatters.ts";
import {
  getTaskGroup,
  GROUP_COLOR,
  GROUP_LABEL,
} from "../core/task-grouping.ts";

// Helper functions

export function getViewportSizes(
  currentTimer: TimerObject | null,
  searchMode: boolean | false,
  searchQuery: string | null,
): { headerH: number; footerH: number; viewportRows: number } {
  try {
    const { rows } = getConsoleSize();
    const headerH = 8 + (currentTimer ? 3 : 0);
    const footerH = 4 + (searchMode || searchQuery ? 2 : 0);
    const viewportRows = Math.max(3, rows - headerH - footerH);
    return { headerH, footerH, viewportRows };
  } catch {
    return { headerH: 8, footerH: 4, viewportRows: 15 };
  }
}

function getConsoleSize() {
  try {
    return Deno.consoleSize();
  } catch {
    return { columns: 80, rows: 24 };
  }
}

function buildRow(segments: Array<string | null | undefined>): string {
  return segments.filter(Boolean).join("");
}

function highlightIfSelected(
  row: string,
  isSelected: boolean,
  width: number,
): string {
  return isSelected ? REV + padVisible(row, width) + RESET : row;
}

function makeDivider(width: number): string {
  return `${DIM}${"─".repeat(width)}${RESET}`;
}

function renderHeader(user: Me, subtitle?: string): string {
  const title = `${BOLD}${CYAN}TW💩${RESET}`;
  const userInfo = `${DIM}${user["first-name"]} ${user["last-name"]}${RESET}`;
  const subtitleText = subtitle ? `  ${DIM}${subtitle}${RESET}` : "";
  return `  ${title}  ${userInfo}${subtitleText}`;
}

function renderFooterLines(
  width: number,
  helpText: string,
  options?: { statusMsg?: string; searchBar?: string },
): string[] {
  const lines = [`  ${makeDivider(width)}`, `  ${DIM}${helpText}${RESET}`];
  if (options?.searchBar) lines.push(`  ${DIM}/${RESET} ${options.searchBar}█`);
  if (options?.statusMsg) lines.push(`  ${RED}${options.statusMsg}${RESET}`);
  return lines;
}

// Screen Renderers

export function renderTaskListScreen(
  lv: TaskListView,
  user: Me,
  timer: TimerObject | null,
  favorites: Set<string>,
  statusMsg: string,
  opts: {
    type: "main" | "favorites";
    title?: string;
    showSummary?: boolean;
    searchQuery?: string;
    searchMode?: boolean;
    sortOrder?: SortOrder;
  } = { type: "main" },
): string {
  const { columns: cols, rows: _termRows } = getConsoleSize();
  const panelWidth = Math.min(cols, 100);
  const divider = makeDivider(panelWidth);

  const { tasks, sel, scrollTop } = lv;
  const today = getTodayStr();
  const tomorrow = getTomorrowStr();
  const showSummary = opts.showSummary !== false;
  const searchQuery = opts.searchQuery ?? "";
  const showSearchBar = opts.searchMode || !!searchQuery;

  // Group estimated totals for section headers and summary
  const groupEst: Record<TaskGroup, number> = {
    overdue: 0,
    today: 0,
    tomorrow: 0,
    later: 0,
    urgent: 0,
    high: 0,
    medium: 0,
    normal: 0,
    low: 0,
  };
  for (const t of tasks) {
    groupEst[getTaskGroup(t, today, tomorrow)] += t["estimated-minutes"] ?? 0;
  }

  // Compute how many lines the fixed header and footer occupy
  const {
    headerH: _headerH,
    footerH: _footerH,
    viewportRows,
  } = getViewportSizes(timer, showSearchBar, searchQuery);

  const visibleVRows = lv.vrows.slice(scrollTop, scrollTop + viewportRows);

  const lines: string[] = [CLEAR, HIDE_CUR];

  // Header (fixed)
  const sortLabel =
    opts.type === "main" && opts.sortOrder
      ? opts.sortOrder === "priority"
        ? "Priority"
        : "Due"
      : null;
  const headerParts = [opts.title, sortLabel ? `sort: ${sortLabel}` : null]
    .filter(Boolean)
    .join("  ·  ");
  lines.push("");
  lines.push(renderHeader(user, headerParts || undefined));
  lines.push(`  ${divider}`);
  lines.push("");

  // Running timer
  if (timer?.timer) {
    const taskName = truncate(timer?.task?.content ?? "Unknown task", 50);
    const elapsedMin = timerElapsedMin(timer.timer);
    const row = buildRow([
      "  ",
      `${GREEN}●${RESET}`,
      "  ",
      taskName,
      timer?.task?.["project-name"]
        ? `  ${DIM}${truncate(timer.task["project-name"], 20)}${RESET}`
        : null,
      elapsedMin > 0 ? `  ${DIM}${fmtMinutes(elapsedMin)}${RESET}` : null,
    ]);
    lines.push(row);
    lines.push(`  ${divider}`);
    lines.push("");
  }

  // Summary (tasks view only)
  if (showSummary) {
    const todayTasks = tasks.filter(
      (t) => t["due-date"] && t["due-date"] <= today,
    );
    const todayCount = todayTasks.length;
    const totalEst = todayTasks.reduce(
      (s, t) => s + (t["estimated-minutes"] ?? 0),
      0,
    );
    const overdueCount = tasks.filter(isOverdue).length;

    const dot = `  ${DIM}·${RESET}  `;
    const summaryParts: string[] = [
      `${DIM}Today's work:${RESET}  ${BOLD}${todayCount}${RESET} task${todayCount !== 1 ? "s" : ""}`,
    ];
    if (totalEst)
      summaryParts.push(`${BOLD}${fmtMinutes(totalEst)}${RESET} estimated`);
    if (overdueCount)
      summaryParts.push(`${RED}${BOLD}${overdueCount} overdue${RESET}`);

    lines.push(`  ${summaryParts.join(dot)}`);
    lines.push("");
    lines.push(`  ${divider}`);
    lines.push("");
  }

  // Scrollable task list
  if (tasks.length === 0) {
    lines.push(`  ${GREEN}${BOLD}All clear!${RESET} No tasks due.`);
  } else {
    const maxTitle = panelWidth - 44;

    for (const vrow of visibleVRows) {
      if (vrow.kind === "spacer") {
        lines.push("");
        continue;
      }
      if (vrow.kind === "header") {
        const gc = GROUP_COLOR[vrow.group];
        const est = groupEst[vrow.group]
          ? `  ${DIM}— ${fmtMinutes(groupEst[vrow.group])}${RESET}`
          : "";
        lines.push(`  ${gc}${BOLD}${GROUP_LABEL[vrow.group]}${RESET}${est}`);
        continue;
      }

      const { task, taskIdx } = vrow;
      const isSel = taskIdx === sel;
      const color = taskDueDateColor(task);

      // Check if there's a timer for this task (running or paused)
      const taskTimer =
        timer?.timer?.taskId !== undefined &&
        String(timer.timer?.taskId) === String(task.id)
          ? timer.timer
          : null;
      const isFav = favorites.has(String(task.id));

      const title = truncate(task.content, maxTitle);
      const titleColored = color && !isSel ? `${color}${title}${RESET}` : title;
      const timeStr = fmtTimeColumn(task);
      const time = timeStr ? `  ${DIM}${timeStr}${RESET}` : "";
      const project = task["project-name"]
        ? `  ${DIM}${truncate(task["project-name"], 16)}${RESET}`
        : "";
      const dateLabel = fmtDueDate(task);
      const date = dateLabel
        ? `  ${!isSel && color ? color : ""}${dateLabel}${!isSel && color ? RESET : ""}`
        : "";
      const pTag = priorityTag(task.priority);
      const priority = pTag ? `  ${pTag}` : "";

      // Show timer status: ● running, ○ paused, or blank
      const timerDot = taskTimer
        ? taskTimer.running
          ? `${isSel ? "" : GREEN}●${isSel ? "" : RESET} `
          : `${isSel ? "" : DIM}○${isSel ? "" : RESET} `
        : "  ";

      // Show favorite star
      const favStar = isFav
        ? `${isSel ? "" : YELLOW}★${isSel ? "" : RESET} `
        : "  ";

      const row = `  ${timerDot}${favStar}${titleColored}${time}${project}${date}${priority}`;
      lines.push(highlightIfSelected(row, isSel, panelWidth));
    }
  }

  // Footer (fixed)
  lines.push("");
  const helpText =
    opts.type === "favorites"
      ? "↑↓ navigate   o open   c comment   x handback   f unfav   s timer   / search   ESC back   q quit"
      : "↑↓ navigate   o open   c comment   x handback   v sort   f fav   F favourites   s timer   / search   T timers   q quit";
  lines.push(
    ...renderFooterLines(panelWidth, helpText, {
      searchBar: showSearchBar ? searchQuery : undefined,
      statusMsg: statusMsg || undefined,
    }),
  );
  lines.push("");

  return lines.join("\n");
}

export function renderTimersScreen(
  timers: RunningTimer[],
  sel: number,
  user: Me,
  statusMsg: string,
): string {
  const { columns: cols } = getConsoleSize();
  const panelWidth = Math.min(cols, 100);
  const divider = makeDivider(panelWidth);

  const lines: string[] = [CLEAR, HIDE_CUR];

  lines.push("");
  lines.push(renderHeader(user, "/ Timers"));
  lines.push(`  ${divider}`);
  lines.push("");

  if (timers.length === 0) {
    lines.push(`  ${DIM}No timers found.${RESET}`);
  } else {
    for (let i = 0; i < timers.length; i++) {
      const timer = timers[i];
      const isSel = i === sel;
      const reset = isSel ? "" : RESET;
      const elapsedMin = timerElapsedMin(timer);
      const row = buildRow([
        "  ",
        timer.running ? `${GREEN}●${reset}` : `${DIM}○${reset}`,
        "  ",
        truncate(timer.taskName ?? "Unknown task", 50),
        timer.projectName
          ? `  ${DIM}${truncate(timer.projectName, 20)}${reset}`
          : null,
        elapsedMin > 0 ? `  ${DIM}${fmtMinutes(elapsedMin)}${RESET}` : null,
      ]);
      lines.push(highlightIfSelected(row, isSel, panelWidth));
    }
  }

  lines.push("");
  lines.push(
    ...renderFooterLines(
      panelWidth,
      "↑↓ navigate   s complete   d delete   o open   ESC back",
      {
        statusMsg: statusMsg || undefined,
      },
    ),
  );
  lines.push("");

  return lines.join("\n");
}
