import type { Task, TaskGroup, VRow } from "../types.ts";
import { DARK_GRAY, GRAY, RED, YELLOW } from "../ui/ansi.ts";

export const GROUP_LABEL: Record<TaskGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  later: "Later",
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  normal: "Normal",
  low: "Low",
};

export const GROUP_COLOR: Record<TaskGroup, string> = {
  overdue: RED,
  today: "",
  tomorrow: GRAY,
  later: DARK_GRAY,
  urgent: RED,
  high: YELLOW,
  medium: "",
  normal: GRAY,
  low: DARK_GRAY,
};

export function getTaskGroup(
  task: Task,
  todayStr: string,
  tomorrowStr: string,
): TaskGroup {
  const dd = task["due-date"];
  if (!dd) return "later";
  if (dd < todayStr) return "overdue";
  if (dd === todayStr) return "today";
  if (dd === tomorrowStr) return "tomorrow";
  return "later";
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  "": 3,
  low: 4,
};

export function getPriorityGroup(task: Task): TaskGroup {
  switch (task.priority) {
    case "urgent":
      return "urgent";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return "normal";
  }
}

export function sortTasksByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    const da = a["due-date"] || "99999999";
    const db = b["due-date"] || "99999999";
    return da.localeCompare(db);
  });
}

export function buildVirtualRowsByPriority(tasks: Task[]): {
  vrows: VRow[];
  taskVRowIdx: number[];
} {
  const vrows: VRow[] = [];
  const taskVRowIdx: number[] = [];
  let lastGroup: TaskGroup | null = null;

  for (let i = 0; i < tasks.length; i++) {
    const group = getPriorityGroup(tasks[i]);
    if (group !== lastGroup) {
      if (lastGroup !== null) vrows.push({ kind: "spacer" });
      vrows.push({ kind: "header", group });
      lastGroup = group;
    }
    taskVRowIdx.push(vrows.length);
    vrows.push({ kind: "task", task: tasks[i], taskIdx: i });
  }

  return { vrows, taskVRowIdx };
}

export function buildVirtualRows(
  tasks: Task[],
  todayStr: string,
  tomorrowStr: string,
): {
  vrows: VRow[];
  taskVRowIdx: number[];
} {
  const vrows: VRow[] = [];
  const taskVRowIdx: number[] = [];
  let lastGroup: TaskGroup | null = null;

  for (let i = 0; i < tasks.length; i++) {
    const group = getTaskGroup(tasks[i], todayStr, tomorrowStr);
    if (group !== lastGroup) {
      if (lastGroup !== null) vrows.push({ kind: "spacer" });
      vrows.push({ kind: "header", group });
      lastGroup = group;
    }
    taskVRowIdx.push(vrows.length);
    vrows.push({ kind: "task", task: tasks[i], taskIdx: i });
  }

  return { vrows, taskVRowIdx };
}
