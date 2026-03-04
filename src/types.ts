export interface Config {
  site: string; // e.g. "yourcompany.teamwork.com"
  token: string; // API token
  cannedTimerComment?: string; // posted when starting a timer with Ctrl+S (default: "Working on this now")
}

export interface Me {
  id: string;
  "first-name": string;
  "last-name": string;
}

export interface Task {
  id: string;
  content: string;
  "due-date": string;
  "project-id"?: string;
  "project-name": string;
  "todo-list-name": string;
  "estimated-minutes": number;
  "total-minutes-logged"?: number;
  priority: string;
  completed: boolean;
  "creator-id"?: string;
}

export interface RunningTimer {
  id: string;
  taskId?: string;
  taskName?: string;
  projectName?: string;
  running: boolean;
  lastStartedAt?: string;
  duration?: number; // completed intervals in seconds (v3 only)
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put(path: string, body?: unknown): Promise<void>;
  delete(path: string): Promise<void>;
}

export type TimerObject = {
  timer: RunningTimer | null;
  error?: string;
  task?: Task | null;
};

export type TaskGroup =
  | "overdue"
  | "today"
  | "tomorrow"
  | "later"
  | "urgent"
  | "high"
  | "medium"
  | "normal"
  | "low";

export type SortOrder = "due" | "priority";

export type VRow =
  | { kind: "spacer" }
  | { kind: "header"; group: TaskGroup }
  | { kind: "task"; task: Task; taskIdx: number };

export interface TaskListView {
  tasks: Task[];
  vrows: VRow[];
  taskVRowIdx: number[];
  sel: number;
  scrollTop: number;
}
