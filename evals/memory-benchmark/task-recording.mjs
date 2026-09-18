// The final snapshot repairs missed or out-of-order best-effort task events.
export function recordTaskEvent(tasks, event) {
  if (event.type === "run_started") {
    for (const task of event.tasks ?? []) tasks.set(task.taskId, { ...task, state: "queued" });
  } else if (event.type === "run_settled") {
    for (const task of event.tasks ?? []) tasks.set(task.taskId, { ...tasks.get(task.taskId), ...task });
  } else if (event.type === "task_started" || event.type === "task_finished") {
    const task = tasks.get(event.taskId) ?? { taskId: event.taskId, tabId: event.tabId, site: "Unknown site" };
    if (event.type === "task_started") {
      task.startedAt ??= event.timestamp;
      if (!task.finishedAt) task.state = "running";
    } else {
      task.finishedAt = event.timestamp;
      task.state = event.state;
      if (event.error) task.error = event.error;
    }
    tasks.set(task.taskId, task);
  }
}
