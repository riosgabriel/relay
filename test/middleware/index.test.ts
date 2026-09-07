import { describe, expect, it, vi } from "vitest";
import type { RequestOptions } from "../../src/core/types.js";
import { defaultHeaders, requestLogger } from "../../src/middleware/index.js";
import type { NextFn } from "../../src/queue/executor.js";

function options(overrides: Partial<RequestOptions<unknown>> = {}): RequestOptions<unknown> {
	return { ...overrides };
}

describe("defaultHeaders", () => {
	it("merges configured headers into the request", async () => {
		const middleware = defaultHeaders({ "X-Api-Key": "secret" });
		const next: NextFn = vi.fn(async () => new Response(null, { status: 200 }));

		await middleware(options(), next);

		expect(next).toHaveBeenCalledWith(expect.objectContaining({ headers: { "X-Api-Key": "secret" } }));
	});

	it("lets per-request headers override the defaults", async () => {
		const middleware = defaultHeaders({ "X-Api-Key": "secret", Accept: "application/json" });
		const next: NextFn = vi.fn(async () => new Response(null, { status: 200 }));

		await middleware(options({ headers: { "X-Api-Key": "override" } }), next);

		expect(next).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: { "X-Api-Key": "override", Accept: "application/json" },
			}),
		);
	});

	it("preserves other request options untouched", async () => {
		const middleware = defaultHeaders({ "X-Api-Key": "secret" });
		const next: NextFn = vi.fn(async () => new Response(null, { status: 200 }));

		await middleware(options({ method: "POST", url: "/x" }), next);

		expect(next).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", url: "/x" }));
	});
});

describe("requestLogger", () => {
	it("logs completion with status and duration on success", async () => {
		const log = vi.fn();
		const middleware = requestLogger({ log });
		const next: NextFn = vi.fn(async () => new Response(null, { status: 204 }));

		const response = await middleware(options(), next);

		expect(response.status).toBe(204);
		expect(log).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith(
			"Request completed",
			expect.objectContaining({ status: 204, durationMs: expect.any(Number) }),
		);
	});

	it("logs failure with the error message and rethrows", async () => {
		const log = vi.fn();
		const middleware = requestLogger({ log });
		const next: NextFn = vi.fn(async () => {
			throw new Error("boom");
		});

		await expect(middleware(options(), next)).rejects.toThrow("boom");
		expect(log).toHaveBeenCalledWith(
			"Request failed",
			expect.objectContaining({ error: "boom", durationMs: expect.any(Number) }),
		);
	});

	it("stringifies non-Error throws", async () => {
		const log = vi.fn();
		const middleware = requestLogger({ log });
		const next: NextFn = vi.fn(async () => {
			throw "raw string failure";
		});

		await expect(middleware(options(), next)).rejects.toBe("raw string failure");
		expect(log).toHaveBeenCalledWith("Request failed", expect.objectContaining({ error: "raw string failure" }));
	});

	it("defaults to console.log when no logger is provided", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const middleware = requestLogger();
		const next: NextFn = vi.fn(async () => new Response(null, { status: 200 }));

		await middleware(options(), next);

		expect(consoleSpy).toHaveBeenCalledWith("Request completed", expect.objectContaining({ status: 200 }));
		consoleSpy.mockRestore();
	});
});
