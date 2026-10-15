const TASK = /<task-id>([^<]+)<\/task-id>/
const STATUS = /<status>[^<]+<\/status>/

// What a runtime says to its agent of a task the agent left running: an event along the way, or its end, which is
// the one that carries a status.
export class TaskNotification {
  private readonly text: string

  constructor(text: string) {
    this.text = text
  }

  // The task this ends; null for anything else, a task still running included.
  get ended(): string | null {
    const start = this.text.trimStart()

    if (!start.startsWith('<task-notification') || !STATUS.test(start)) return null

    return TASK.exec(start)?.[1]?.trim() ?? null
  }
}
