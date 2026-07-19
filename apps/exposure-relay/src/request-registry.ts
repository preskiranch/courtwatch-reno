export class RequestControllerRegistry {
  readonly #controllers = new Set<AbortController>();

  get size() {
    return this.#controllers.size;
  }

  create() {
    const controller = new AbortController();
    this.#controllers.add(controller);
    let released = false;

    return {
      controller,
      release: () => {
        if (released) return;
        released = true;
        this.#controllers.delete(controller);
      },
    };
  }

  abortAll(reason?: unknown) {
    for (const controller of this.#controllers) {
      if (!controller.signal.aborted) controller.abort(reason);
    }
  }
}
