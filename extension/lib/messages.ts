export type StartRunMessage = { type: "START_RUN"; query: string }
export type StopRunMessage = { type: "STOP_RUN" }
export type ProgressMessage = {
  type: "PROGRESS"
  leadCount: number
  status: string
}
export type StoppedMessage = { type: "STOPPED"; reason: string }
export type RunErrorMessage = { type: "RUN_ERROR"; error: string }

export type RuntimeMessage =
  | StartRunMessage
  | StopRunMessage
  | ProgressMessage
  | StoppedMessage
  | RunErrorMessage
