import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "../../src/core/errors.js";
import { CircuitBreaker, CircuitBreakerRegistry } from "../../src/queue/circuit-breaker.js";

describe("CircuitBreaker", () => {
	it("is always inert when disabled", () => {
		const cb = new CircuitBreaker("test", { enabled: false, failureThreshold: 1 });

		expect(cb.canRequest()).toBe(true);
		cb.recordFailure(new NetworkError("boom"));
		cb.recordFailure(new NetworkError("boom"));
		cb.recordFailure(new NetworkError("boom"));
		expect(cb.canRequest()).toBe(true);
		cb.recordSuccess();
		expect(cb.canRequest()).toBe(true);
	});

	// NOTE: this test exercises the consecutive-failure trip condition, which is
	// the single TODO(human) left in evaluateTripCondition() (currently `return
	// false`, so the breaker never trips). It is expected to FAIL until that
	// method is implemented.
	it("trips from closed to open after failureThreshold consecutive failures", () => {
		const cb = new CircuitBreaker("test", { enabled: true, failureThreshold: 3 });

		expect(cb.canRequest()).toBe(true);
		cb.recordFailure(new NetworkError("boom"));
		expect(cb.canRequest()).toBe(true);
		cb.recordFailure(new NetworkError("boom"));
		expect(cb.canRequest()).toBe(true);
		cb.recordFailure(new NetworkError("boom"));

		// Third consecutive failure should trip the breaker to open.
		expect(cb.canRequest()).toBe(false);
	});

	it("rejects immediately via canRequest() once open", () => {
		const onStateChange = vi.fn();
		const cb = new CircuitBreaker("test", { enabled: true, failureThreshold: 1 }, onStateChange);

		cb.recordFailure(new NetworkError("boom"));
		expect(cb.canRequest()).toBe(false);
		expect(cb.canRequest()).toBe(false);
	});

	describe("half-open transitions (fake timers)", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("moves from open to half-open after resetTimeoutMs elapses", () => {
			const cb = new CircuitBreaker("test", {
				enabled: true,
				failureThreshold: 1,
				resetTimeoutMs: 1000,
			});

			cb.recordFailure(new NetworkError("boom"));
			expect(cb.canRequest()).toBe(false);

			vi.advanceTimersByTime(999);
			expect(cb.canRequest()).toBe(false);

			vi.advanceTimersByTime(1);
			// resetTimeoutMs has elapsed: the next canRequest() call transitions to
			// half-open and admits exactly one trial.
			expect(cb.canRequest()).toBe(true);
		});

		it("half-open trial success transitions back to closed", () => {
			const onStateChange = vi.fn();
			const cb = new CircuitBreaker(
				"test",
				{ enabled: true, failureThreshold: 1, resetTimeoutMs: 1000 },
				onStateChange,
			);

			cb.recordFailure(new NetworkError("boom"));
			vi.advanceTimersByTime(1000);
			expect(cb.canRequest()).toBe(true); // admits the half-open trial

			cb.recordSuccess();
			expect(onStateChange).toHaveBeenLastCalledWith("test", "closed");

			// Now closed again: further requests are admitted freely.
			expect(cb.canRequest()).toBe(true);
			expect(cb.canRequest()).toBe(true);
		});

		it("half-open trial failure transitions back to open", () => {
			const onStateChange = vi.fn();
			const cb = new CircuitBreaker(
				"test",
				{ enabled: true, failureThreshold: 1, resetTimeoutMs: 1000 },
				onStateChange,
			);

			cb.recordFailure(new NetworkError("boom"));
			expect(onStateChange).toHaveBeenLastCalledWith("test", "open");

			vi.advanceTimersByTime(1000);
			expect(cb.canRequest()).toBe(true); // admits the half-open trial

			cb.recordFailure(new NetworkError("boom again"));
			expect(onStateChange).toHaveBeenLastCalledWith("test", "open");

			// Back open: immediately rejects until resetTimeoutMs elapses again.
			expect(cb.canRequest()).toBe(false);
		});

		it("half-open admits at most halfOpenMaxAttempts concurrent trials", () => {
			const cb = new CircuitBreaker("test", {
				enabled: true,
				failureThreshold: 1,
				resetTimeoutMs: 1000,
				halfOpenMaxAttempts: 1,
			});

			cb.recordFailure(new NetworkError("boom"));
			vi.advanceTimersByTime(1000);

			// First call admits the single allowed trial; a second concurrent call
			// (before the first resolves) must be rejected.
			expect(cb.canRequest()).toBe(true);
			expect(cb.canRequest()).toBe(false);
		});
	});
});

describe("CircuitBreakerRegistry", () => {
	it("creates separate breakers per partition", () => {
		const registry = new CircuitBreakerRegistry({ enabled: true });
		const a = registry.get("payments");
		const b = registry.get("notifications");
		expect(a).not.toBe(b);
	});

	it("returns the same breaker for the same partition", () => {
		const registry = new CircuitBreakerRegistry({ enabled: true });
		expect(registry.get("payments")).toBe(registry.get("payments"));
	});

	it("applies partition-specific config", () => {
		const registry = new CircuitBreakerRegistry(
			{ enabled: true, failureThreshold: 10 },
			{ payments: { circuitBreaker: { failureThreshold: 2 } } },
		);
		const payments = registry.get("payments");
		// Partition override (2) should apply instead of the global (10). Reads
		// the merged config directly (like the equivalent BulkheadRegistry test)
		// rather than driving canRequest()/recordFailure(), which depend on the
		// still-stubbed evaluateTripCondition().
		expect((payments as unknown as { config: { failureThreshold: number } }).config.failureThreshold).toBe(2);
	});
});
