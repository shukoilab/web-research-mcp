/**
 * @purpose Request deadline and timeout management service with cooperative cancellation support.
 * @rationale Enforces strict budget ceilings across multi-phase operations, preventing unbounded execution and providing deterministic timeout diagnostics.
 * @preconditions Budget in milliseconds must be a positive number.
 * @invariants Monotonically decreasing remaining budget; thread-safe; zero external I/O.
 */

import { DomainError } from '@shukoi/core';

/**
 * @purpose Represents a finite time budget tied to an optional AbortSignal.
 * @rationale Slices execution time across sequential and nested operations with fail-fast expiration checks.
 * @invariants Immutable start time and initial budget; remaining budget decreases monotonically to 0.
 */
export class Deadline {
  private readonly startTime: number;
  private readonly budgetMs: number;
  private readonly signal?: AbortSignal;

  /**
   * @purpose Constructs a new Deadline instance with an explicit duration and optional cancellation signal.
   * @rationale Combines wall-clock duration with cooperative caller abort signals into a single unified deadline abstraction.
   * @preconditions budgetMs must be a finite number >= 0.
   * @param budgetMs Total budget allocated in milliseconds.
   * @param signal Optional AbortSignal from request context.
   * @returns Instantiated Deadline object.
   * @throws Never throws directly.
   * @invariants Big-O time complexity O(1); immutable baseline parameters.
   */
  constructor(budgetMs: number, signal?: AbortSignal) {
    this.startTime = Date.now();
    this.budgetMs = Math.max(0, budgetMs);
    this.signal = signal;
  }

  /**
   * @purpose Factory method creating a Deadline instance.
   * @rationale Encapsulates construction logic and provides a standardized instantiation entry point.
   * @preconditions budgetMs must be a finite number >= 0.
   * @param budgetMs Total budget allocated in milliseconds.
   * @param signal Optional AbortSignal from caller.
   * @returns Configured Deadline instance.
   * @throws Never throws directly.
   * @invariants Pure factory function; Big-O time complexity O(1).
   */
  public static create(budgetMs: number, signal?: AbortSignal): Deadline {
    return new Deadline(budgetMs, signal);
  }

  /**
   * @purpose Returns the remaining time budget in milliseconds.
   * @rationale Computes remaining milliseconds by subtracting elapsed wall-clock time from initial budget, clamping to 0 if expired or aborted.
   * @preconditions None; callable at any point in the deadline lifecycle.
   * @param None.
   * @returns Non-negative number representing remaining milliseconds (0 if expired or cancelled).
   * @throws Never throws.
   * @invariants Returns 0 if signal is aborted or elapsed >= budget; Big-O time complexity O(1).
   */
  public get remaining(): number {
    if (this.signal?.aborted) {
      return 0;
    }
    const elapsed = Date.now() - this.startTime;
    return Math.max(0, this.budgetMs - elapsed);
  }

  /**
   * @purpose Checks whether the deadline has expired or the associated signal was aborted.
   * @rationale Provides a fast boolean predicate for loop termination and phase gating without throwing exceptions.
   * @preconditions None.
   * @param None.
   * @returns True if remaining budget is 0 or abort signal is triggered; false otherwise.
   * @throws Never throws.
   * @invariants Big-O time complexity O(1); deterministic boolean result.
   */
  public get expired(): boolean {
    return this.remaining <= 0;
  }

  /**
   * @purpose Retrieves the underlying AbortSignal if configured.
   * @rationale Allows downstream HTTP clients and browser operations to link their cancellation tokens to this deadline's signal.
   * @preconditions None.
   * @param None.
   * @returns Configured AbortSignal or undefined.
   * @throws Never throws.
   * @invariants Pure getter; Big-O time complexity O(1).
   */
  public get abortSignal(): AbortSignal | undefined {
    return this.signal;
  }

  /**
   * @purpose Computes a sub-phase timeout bounded by the remaining global deadline.
   * @rationale Prevents individual phase timeouts from exceeding the overarching request budget.
   * @preconditions maxMs must be a positive number.
   * @param maxMs Maximum duration in milliseconds requested for the phase.
   * @returns Bounded duration in milliseconds, never exceeding remaining deadline.
   * @throws Never throws.
   * @invariants Result is between 0 and min(maxMs, remaining); Big-O time complexity O(1).
   */
  public slice(maxMs: number): number {
    return Math.min(Math.max(0, maxMs), this.remaining);
  }

  /**
   * @purpose Throws a typed DomainError if the deadline is expired or signal is aborted.
   * @rationale Enforces fail-fast termination before starting costly operations (e.g. browser navigation or DOM parsing).
   * @preconditions None.
   * @param message Optional custom error message string.
   * @returns Void if deadline is still valid.
   * @throws DomainError BAD_REQUEST if cancelled by caller, or GATEWAY_TIMEOUT if wall-clock budget expired.
   * @invariants Halts execution if expired; Big-O time complexity O(1).
   */
  public throwIfExpired(message?: string): void {
    if (this.signal?.aborted) {
      throw new DomainError('BAD_REQUEST', 'Operation cancelled by caller');
    }
    if (this.remaining <= 0) {
      throw new DomainError('GATEWAY_TIMEOUT', message ?? 'Request deadline exceeded');
    }
  }
}
