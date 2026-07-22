/** A tool invocation made by an agent, surfaced to the UI for transparency. */
export interface ToolCall {
  name: string
  input: Record<string, unknown>
}

/** The uniform shape every lab agent returns from the backend. */
export interface AgentResult {
  result: string
  tool_calls: ToolCall[]
  error: string | null
}
