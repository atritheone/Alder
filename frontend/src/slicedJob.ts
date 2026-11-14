/** A cancellable browser-frame job. Only a complete current epoch is published. */
export function slicedJob<T>(
  work: Generator<void, T, void>,
  options: {
    current: () => boolean;
    complete: (value: T) => void;
    error: (error: unknown) => void;
    before?: () => void;
    after?: () => void;
    schedule?: (callback: () => void) => number;
    unschedule?: (frame: number) => void;
  },
) {
  const schedule = options.schedule || requestAnimationFrame,
    unschedule = options.unschedule || cancelAnimationFrame;
  let frame = 0,
    live = true;
  const cancel = () => {
    if (!live) return;
    live = false;
    unschedule(frame);
    work.return(undefined as never);
  };
  const advance = (drain = false): boolean => {
    if (!live) return true;
    if (!options.current()) {
      cancel();
      return false;
    }
    options.before?.();
    let step: IteratorResult<void, T>;
    try {
      step = work.next();
      while (drain && !step.done && options.current()) step = work.next();
    } catch (error) {
      live = false;
      unschedule(frame);
      options.error(error);
      return false;
    } finally {
      options.after?.();
    }
    if (!options.current()) {
      cancel();
      return false;
    }
    if (step.done) {
      live = false;
      unschedule(frame);
      options.complete(step.value);
      return true;
    }
    frame = schedule(() => advance());
    return false;
  };
  return {
    start: () => advance(),
    finish: () => {
      unschedule(frame);
      return advance(true);
    },
    cancel,
    get pending() {
      return live;
    },
  };
}
