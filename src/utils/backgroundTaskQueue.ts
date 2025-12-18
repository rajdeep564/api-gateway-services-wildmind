/**
 * Background Task Queue
 * Limits concurrent background operations to reduce CPU load
 * Uses a simple queue with configurable concurrency
 */

interface Task {
  id: string;
  fn: () => Promise<void>;
  priority?: number;
}

class BackgroundTaskQueue {
  private queue: Task[] = [];
  private running: Set<string> = new Set();
  private maxConcurrent: number;
  private processing: boolean = false;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Add a task to the queue
   * @param id Unique task identifier
   * @param fn Async function to execute
   * @param priority Higher priority tasks run first (default: 0)
   */
  enqueue(id: string, fn: () => Promise<void>, priority: number = 0): void {
    // Check if already queued or running
    if (this.running.has(id)) {
      console.log(`[BackgroundTaskQueue] Task ${id} already running, skipping`);
      return;
    }

    const existingIndex = this.queue.findIndex(t => t.id === id);
    if (existingIndex >= 0) {
      console.log(`[BackgroundTaskQueue] Task ${id} already queued, skipping`);
      return;
    }

    this.queue.push({ id, fn, priority });
    // Sort by priority (higher first)
    this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    // Start processing if not already
    if (!this.processing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0 || this.running.size > 0) {
      // Wait if we're at max concurrency
      while (this.running.size >= this.maxConcurrent && this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Process next task
      if (this.queue.length > 0) {
        const task = this.queue.shift()!;
        this.running.add(task.id);

        // Execute task in background (don't await)
        task.fn()
          .then(() => {
            console.log(`[BackgroundTaskQueue] Task ${task.id} completed`);
          })
          .catch((err) => {
            console.error(`[BackgroundTaskQueue] Task ${task.id} failed:`, err);
          })
          .finally(() => {
            this.running.delete(task.id);
          });
      } else {
        // No tasks in queue, wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    this.processing = false;
  }

  /**
   * Get current queue status
   */
  getStatus(): { queued: number; running: number; runningIds: string[] } {
    return {
      queued: this.queue.length,
      running: this.running.size,
      runningIds: Array.from(this.running),
    };
  }
}

// Global singleton instance
export const backgroundTaskQueue = new BackgroundTaskQueue(3); // Max 3 concurrent background tasks

