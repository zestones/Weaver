export type AgentAccess = 'read-only' | 'write'
export type AnswerSchema = Readonly<Record<string, unknown>>

export interface AgentTaskFields {
  readonly prompt: string
  readonly cwd: string
  readonly access: AgentAccess
  readonly timeoutSeconds: number
  readonly model?: string | null
  readonly effort?: string | null
  readonly answerSchema?: AnswerSchema | null
  readonly maxTurns?: number | null
  readonly maxCostUsd?: number | null
  readonly beforeTool?: readonly string[] | null
  readonly environment?: Readonly<Record<string, string>>
}

export class AgentTask {
  readonly prompt: string
  readonly cwd: string
  // read-only: the agent reads files and nothing else. write: it changes files and runs commands, in `cwd`.
  readonly access: AgentAccess
  readonly timeoutSeconds: number
  // null for the model the runtime chooses by itself.
  readonly model: string | null
  // How hard the model thinks, in the words of its runtime; null for the runtime's own choice.
  readonly effort: string | null
  // The JSON Schema the last message must follow; null for free text.
  readonly answerSchema: AnswerSchema | null
  // How many turns the agent may take and how much it may spend, for a runtime that can hold it to them.
  readonly maxTurns: number | null
  readonly maxCostUsd: number | null
  // A command line started before each tool call of a task that writes, which answers as a hook of the runtime does
  // and may refuse the call. A runtime that keeps the writes of a task inside `cwd` by itself does not start it.
  readonly beforeTool: readonly string[] | null
  // Variables added to the environment the agent runs in.
  readonly environment: Readonly<Record<string, string>>

  constructor(fields: AgentTaskFields) {
    this.prompt = fields.prompt
    this.cwd = fields.cwd
    this.access = fields.access
    this.timeoutSeconds = fields.timeoutSeconds
    this.model = fields.model ?? null
    this.effort = fields.effort ?? null
    this.answerSchema = fields.answerSchema ?? null
    this.maxTurns = fields.maxTurns ?? null
    this.maxCostUsd = fields.maxCostUsd ?? null
    this.beforeTool = fields.beforeTool ?? null
    this.environment = fields.environment ?? {}
  }
}
