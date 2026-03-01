import type {
  ApiClient,
  Me,
  RunningTimer,
  Task,
  TimerObject,
} from "../types.ts";
import { log } from "../ui/terminal.ts";

export async function fetchMe(api: ApiClient): Promise<Me> {
  const data = await api.get<{ person: Me }>("/me.json");
  return data.person;
}

export async function fetchAllTasks(
  api: ApiClient,
  userId: string,
): Promise<Task[]> {
  const [todayRes, overdueRes, upcomingRes, anytimeRes] = await Promise.all([
    api.get<{ "todo-items": Task[] }>(
      `/tasks.json?filter=today&responsible-party-ids=${userId}&status=incomplete`,
    ),
    api.get<{ "todo-items": Task[] }>(
      `/tasks.json?filter=overdue&responsible-party-ids=${userId}&status=incomplete`,
    ),
    api.get<{ "todo-items": Task[] }>(
      `/tasks.json?filter=upcoming&responsible-party-ids=${userId}&status=incomplete`,
    ),
    api.get<{ "todo-items": Task[] }>(
      `/tasks.json?filter=anytime&responsible-party-ids=${userId}&status=incomplete`,
    ),
  ]);

  const seen = new Set<string>();
  const tasks: Task[] = [];
  for (const t of [
    ...(overdueRes["todo-items"] ?? []),
    ...(todayRes["todo-items"] ?? []),
    ...(upcomingRes["todo-items"] ?? []),
    ...(anytimeRes["todo-items"] ?? []),
  ]) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      tasks.push(t);
    }
  }

  // Sort ascending by due-date; tasks with no date go to the end
  tasks.sort((a, b) => {
    const da = a["due-date"] || "99999999";
    const db = b["due-date"] || "99999999";
    return da.localeCompare(db);
  });

  return tasks;
}

export async function fetchSearchTasks(
  api: ApiClient,
  query: string,
): Promise<Task[]> {
  const data = await api.get<{
    searchResult?: {
      tasks?: Array<{
        id: string;
        name: string;
        projectName: string;
        projectId: string;
        taskListName: string;
        taskEstimateMinutes?: string;
        completed: boolean;
      }>;
    };
  }>(
    `/search.json?searchFor=tasks&searchTerm=${encodeURIComponent(query)}&includeCompletedItems=false`,
  );
  return (data.searchResult?.tasks ?? []).map((t) => ({
    id: t.id,
    content: t.name,
    "due-date": "",
    "project-id": t.projectId,
    "project-name": t.projectName,
    "todo-list-name": t.taskListName,
    "estimated-minutes": parseInt(t.taskEstimateMinutes ?? "0", 10) || 0,
    priority: "",
    completed: t.completed,
  }));
}

export async function fetchTaskById(
  api: ApiClient,
  taskId: string,
): Promise<Task | null> {
  try {
    const res = await api.get<{ "todo-item": Task }>(`/tasks/${taskId}.json`);
    const item = res["todo-item"];
    return { ...item, id: String(item.id) };
  } catch {
    return null;
  }
}

export async function fetchAllTimers(
  api: ApiClient,
  withTaskDetails = true,
): Promise<RunningTimer[]> {
  log("fetchAllTimers: fetching timer list");
  const t0 = Date.now();
  const data = await api.get<{
    timers?: Array<{
      id: number;
      taskId?: number;
      projectId?: number;
      running: boolean;
      lastStartedAt?: string;
      duration?: number; // seconds of completed intervals
    }>;
  }>("/projects/api/v3/me/timers.json");
  log(
    `fetchAllTimers: timer list fetched in ${Date.now() - t0}ms, ${(data.timers ?? []).length} timers`,
  );

  const timers = data.timers ?? [];

  if (!withTaskDetails) {
    return timers.map((t) => ({
      id: String(t.id),
      taskId: t.taskId !== undefined ? String(t.taskId) : undefined,
      running: t.running,
      lastStartedAt: t.lastStartedAt,
      duration: t.duration,
    }));
  }

  // Fetch task details in parallel to get names
  log(`fetchAllTimers: fetching task details for ${timers.length} timer(s)`);
  const t1 = Date.now();
  const taskDetails = await Promise.all(
    timers.map(async (t, idx) => {
      if (!t.taskId) return null;
      log(`fetchAllTimers: [${idx}] fetching task ${t.taskId}`);
      const ts = Date.now();
      try {
        const res = await api.get<{
          "todo-item": { id: string; content: string; "project-name": string };
        }>(`/tasks/${t.taskId}.json`);
        log(
          `fetchAllTimers: [${idx}] task ${t.taskId} done in ${Date.now() - ts}ms`,
        );
        return res["todo-item"];
      } catch (err) {
        log(
          `fetchAllTimers: [${idx}] task ${t.taskId} error in ${Date.now() - ts}ms: ${(err as Error).message}`,
        );
        return null;
      }
    }),
  );
  log(`fetchAllTimers: all task details done in ${Date.now() - t1}ms`);

  return timers.map((t, i) => ({
    id: String(t.id),
    taskId: t.taskId !== undefined ? String(t.taskId) : undefined,
    taskName: taskDetails[i]?.content,
    projectName: taskDetails[i]?.["project-name"],
    running: t.running,
    lastStartedAt: t.lastStartedAt,
    duration: t.duration,
  }));
}

export async function fetchRunningTimer(api: ApiClient): Promise<TimerObject> {
  try {
    // deno-lint-ignore no-explicit-any
    const data = await api.get<{ timers?: any[] }>(
      "/me/timers.json?runningTimersOnly=true",
    );
    const raw = (data.timers ?? []).find((t) => t.running) ?? null;
    if (!raw) return { timer: null };
    // v1 API field names can vary — check both camelCase and hyphenated variants
    const rawTaskId = raw["task-id"] ?? raw["taskId"];
    if (!rawTaskId) throw new Error("No task to fetch");
    const taskId = String(rawTaskId);
    const rawStartedAt = raw["lastStartedAt"] ?? raw["last-started-at"];
    const task = await fetchTaskById(api, taskId);
    return {
      timer: {
        id: String(raw.id),
        taskId,
        running: raw.running,
        lastStartedAt: rawStartedAt,
        duration: raw.duration,
      },
      task,
    };
  } catch (err) {
    return { timer: null, task: null, error: (err as Error).message };
  }
}

export async function startTimer(
  api: ApiClient,
  taskId: string,
  projectId: string,
): Promise<void> {
  if (!projectId) throw new Error("Cannot start timer: task has no project ID");
  await api.post("/projects/api/v3/me/timers.json", {
    timer: {
      taskId: parseInt(taskId, 10),
      projectId: parseInt(projectId, 10),
      stopRunningTimers: true,
    },
  });
}

export async function completeTimer(
  api: ApiClient,
  timerId: string,
): Promise<void> {
  await api.put(`/projects/api/v3/me/timers/${timerId}/complete.json`);
}

export async function deleteTimer(
  api: ApiClient,
  timerId: string,
): Promise<void> {
  await api.delete(`/projects/api/v3/me/timers/${timerId}.json`);
}

export async function reassignTask(
  api: ApiClient,
  taskId: string,
  responsiblePartyId: string,
): Promise<void> {
  await api.put(`/tasks/${taskId}.json`, {
    "todo-item": { "responsible-party-id": responsiblePartyId },
  });
}

export async function postComment(
  api: ApiClient,
  taskId: string,
  body: string,
): Promise<void> {
  await api.post<unknown>(`/tasks/${taskId}/comments.json`, {
    comment: { body, "content-type": "TEXT" },
  });
}
