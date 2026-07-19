export class CoalescedTask {
  private active: Promise<void> | null = null;

  constructor(private readonly operation: () => Promise<void>) {}

  run(): Promise<void> {
    if (this.active) return this.active;

    const task = Promise.resolve().then(this.operation);
    this.active = task;
    task.then(
      () => this.clear(task),
      () => this.clear(task),
    );
    return task;
  }

  async drain(): Promise<void> {
    await this.active;
  }

  get running() {
    return this.active !== null;
  }

  private clear(task: Promise<void>) {
    if (this.active === task) this.active = null;
  }
}
