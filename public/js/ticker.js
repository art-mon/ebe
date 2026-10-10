// A steady timer that keeps running when the tab is in the background.
// Chrome slows setInterval in hidden tabs to once a second, which would make the
// looper stutter and the APC's light clock stall. Timers inside a Worker aren't
// throttled that way, so the Worker just sends "tick" and we do the work here.

const WORKER_SRC = `
  let id = 0;
  onmessage = (e) => {
    clearInterval(id);
    if (e.data > 0) id = setInterval(() => postMessage(0), e.data);
  };
`;

/** Calls fn every `ms` milliseconds. Returns a stop function. */
export function every(ms, fn) {
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = fn;
    worker.postMessage(ms);
    return () => worker.terminate();
  } catch {
    const id = setInterval(fn, ms); // no Worker support: fall back to a plain timer
    return () => clearInterval(id);
  }
}
