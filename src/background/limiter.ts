/**
 * 串行闸门：同一时刻只允许一个模型请求在飞，并保证相邻两次请求至少间隔 gapMs。
 * 这里只做成本与误触保护，不做任何"模仿人类节奏"的伪装。
 */
export class SerialLimiter {
  private tail: Promise<void> = Promise.resolve()
  private lastFinishedAt = 0

  constructor(private readonly gapMs: () => number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const execution = this.tail.then(async () => {
      const wait = this.lastFinishedAt + Math.max(0, this.gapMs()) - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      try {
        return await task()
      } finally {
        this.lastFinishedAt = Date.now()
      }
    })
    this.tail = execution.then(
      () => undefined,
      () => undefined,
    )
    return execution
  }
}
