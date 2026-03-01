import type { SortOrder, Task, TaskListView } from "../types.ts";
import {
  buildVirtualRows,
  buildVirtualRowsByPriority,
  sortTasksByPriority,
} from "../core/task-grouping.ts";
import { getTodayStr, getTomorrowStr } from "./formatters.ts";

export function createTaskListView(
  tasks: Task[],
  sortOrder: SortOrder = "due",
): TaskListView {
  let sorted = tasks;
  let vrowData: { vrows: TaskListView["vrows"]; taskVRowIdx: number[] };

  if (sortOrder === "priority") {
    sorted = sortTasksByPriority(tasks);
    vrowData = buildVirtualRowsByPriority(sorted);
  } else {
    const today = getTodayStr();
    const tomorrow = getTomorrowStr();
    vrowData = buildVirtualRows(tasks, today, tomorrow);
  }

  return { tasks: sorted, ...vrowData, sel: 0, scrollTop: 0 };
}

export function tlvUp(v: TaskListView): TaskListView {
  return { ...v, sel: Math.max(0, v.sel - 1) };
}

export function tlvDown(v: TaskListView): TaskListView {
  if (v.tasks.length === 0) return v;
  return { ...v, sel: Math.min(v.tasks.length - 1, v.sel + 1) };
}

export function tlvPageUp(v: TaskListView, vp: number): TaskListView {
  return { ...v, sel: Math.max(0, v.sel - vp) };
}

export function tlvPageDown(v: TaskListView, vp: number): TaskListView {
  if (v.tasks.length === 0) return v;
  return { ...v, sel: Math.min(v.tasks.length - 1, v.sel + vp) };
}

export function tlvClamp(v: TaskListView, viewportRows: number): TaskListView {
  if (v.tasks.length === 0) return { ...v, scrollTop: 0 };
  const selRow = v.taskVRowIdx[v.sel] ?? 0;
  let { scrollTop } = v;
  if (selRow < scrollTop) scrollTop = selRow;
  else if (selRow >= scrollTop + viewportRows)
    scrollTop = selRow - viewportRows + 1;
  scrollTop = Math.max(0, scrollTop);
  return { ...v, scrollTop };
}
