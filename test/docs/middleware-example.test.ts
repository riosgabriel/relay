import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpClient } from "../../src/core/client.js";
import { defaultHeaders, requestLogger } from "../../src/middleware/index.js";

/**
 * Runs the README's "Middleware" example verbatim (task 7.1's acceptance
 * criteria: the example typechecks and middleware can read/rewrite ctx.url).
 */
describe("README middleware example", () => {
	let server: Server;
	let url: string;
	let received: { headers: IncomingMessage["headers"]; url?: string };

	beforeAll(async () => {
		server = createServer((req, res) => {
			received = { headers: req.headers, url: req.url };
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end("{}");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const addr = server.address();
		if (addr && typeof addr === "object") {
			url = `http://127.0.0.1:${addr.port}`;
		}
	});

	afterAll(async () => {
		await new Promise((resolve) => server.close(resolve));
	});

	it("wires defaultHeaders, requestLogger, and a custom middleware that reads ctx", async () => {
		const client = HttpClient.create({ baseUrl: url });
		const logged: Array<[string, Record<string, unknown>]> = [];

		client.use(defaultHeaders({ Authorization: "Bearer token123" }));
		client.use(requestLogger({ log: (msg, meta) => logged.push([msg, meta]) }));

		client.use(async (ctx, next) => {
			const response = await next(ctx);
			return response;
		});

		const result = await client.get("/resource").toPromise();

		expect(result.success).toBe(true);
		expect(received.headers.authorization).toBe("Bearer token123");
		expect(logged.some(([msg]) => msg === "Request completed")).toBe(true);

		await client.close();
	});

	it("lets middleware rewrite ctx.url before the request is sent", async () => {
		const client = HttpClient.create({ baseUrl: url });

		client.use(async (ctx, next) => {
			return next({ ...ctx, url: `${ctx.url}?rewritten=1` });
		});

		const result = await client.get("/original").toPromise();

		expect(result.success).toBe(true);
		expect(received.url).toBe("/original?rewritten=1");

		await client.close();
	});
});
