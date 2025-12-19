// Background task queue was removed per request.
// Export a shim that executes tasks immediately (fire-and-forget) and logs a deprecation warning.
export const backgroundTaskQueue = {
  enqueue: (id: string, fn: () => Promise<void>, _priority?: number) => {
    console.warn('[BackgroundTaskQueue][shim] enqueue called - queue removed; executing immediately for', id);
    try {
      setImmediate(() => {
        (async () => {
          try {
            await fn();
            console.log('[BackgroundTaskQueue][shim] Task completed', id);
          } catch (err) {
            console.error('[BackgroundTaskQueue][shim] Task failed', id, err);
          }
        })();
      });
    } catch (e) {
      // Fallback: run directly
      fn().catch(err => console.error('[BackgroundTaskQueue][shim] direct execution failed', id, err));
    }
  },
  getStatus: () => ({ queued: 0, running: 0, runningIds: [] as string[] })
};

