import type { RunningTimer, Task } from "../types.ts";
import { DARK_GRAY, DIM, GRAY, RED, RESET, YELLOW } from "./ansi.ts";

export function fmtMinutes(m: number): string {
  if (!m) return "";
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${min}m`;
  if (min === 0) return `${h}h`;
  return `${h}h ${min}m`;
}

export function priorityTag(p: string): string {
  switch (p) {
    case "urgent":
      return `${RED}↑↑${RESET}`;
    case "high":
      return `${YELLOW}↑${RESET}`;
    case "low":
      return `${DIM}↓${RESET}`;
    default:
      return "";
  }
}

export function timerElapsedMin(timer: RunningTimer): number {
  const completedSec = timer.duration ?? 0;
  const currentSec =
    timer.running && timer.lastStartedAt
      ? (Date.now() - new Date(timer.lastStartedAt).getTime()) / 1000
      : 0;
  return Math.floor((completedSec + currentSec) / 60);
}

export function fmtTimeColumn(task: Task): string {
  const est = task["estimated-minutes"] ?? 0;
  const logged = task["total-minutes-logged"] ?? 0;
  if (!est && !logged) return "";
  if (est && logged) return `${fmtMinutes(logged)} / ${fmtMinutes(est)}`;
  if (est) return `~${fmtMinutes(est)}`;
  return fmtMinutes(logged);
}

export function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function getTomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function isOverdue(task: Task): boolean {
  if (!task["due-date"]) return false;
  return task["due-date"] < getTodayStr();
}

export function taskDueDateColor(task: Task): string {
  const dd = task["due-date"];
  if (!dd) return "";
  const today = getTodayStr();
  const tomorrow = getTomorrowStr();
  if (dd < today) return RED;
  if (dd === today) return ""; // default white
  if (dd === tomorrow) return GRAY;
  return DARK_GRAY;
}

export function fmtDueDate(task: Task): string {
  const dd = task["due-date"];
  if (!dd) return "";
  const today = getTodayStr();
  const tomorrow = getTomorrowStr();
  if (dd === today) return "today";
  if (dd === tomorrow) return "tmrw";
  const date = new Date(
    `${dd.slice(0, 4)}-${dd.slice(4, 6)}-${dd.slice(6, 8)}`,
  );
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
