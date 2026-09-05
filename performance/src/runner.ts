import { HttpClient } from "vereda";
import { type BenchmarkResult, printResults, runBenchmark, TestServer } from "../src/utils.js";

/**
 * Comprehensive benchmark runner
 * Executes all benchmarks and generates a summary report
 */
type BenchmarkFn = () => Promise<BenchmarkResult>;

const benchmarks: Record<string, BenchmarkFn> = {
	// Load Tests
	"Basic Load Test": async () => {
		const server = new TestServer({ baseLatencyMs: 10, jitterMs: 5 });
		await server.start();
		try {
			const client = HttpClient.create({
				baseUrl: server.baseUrl,
				retry: { maxRetries: 3 },
				timeout: { attemptMs: 5000 },
			});
			return await runBenchmark(client, {
				name: "Basic Load Test",
				totalRequests: 500,
				concurrency: 20,
				warmupRequests: 50,
			});
		} finally {
			await server.stop();
		}
	},

	"Stress Test (Low Concurrency)": async () => {
		const server = new TestServer({ baseLatencyMs: 20, jitterMs: 10 });
		await server.start();
		try {
			const client = HttpClient.create({
				baseUrl: server.baseUrl,
				retry: { maxRetries: 2 },
				timeout: { attemptMs: 3000 },
			});
			return await runBenchmark(client, {
				name: "Stress Test (Low Concurrency)",
				totalRequests: 500,
				concurrency: 50,
				warmupRequests: 20,
			});
		} finally {
			await server.stop();
		}
	},

	"Stress Test (High Concurrency)": async () => {
		const server = new TestServer({ baseLatencyMs: 20, jitterMs: 10 });
		await server.start();
		try {
			const client = HttpClient.create({
				baseUrl: server.baseUrl,
				retry: { maxRetries: 2 },
				timeout: { attemptMs: 3000 },
				concurrency: 200,
			});
			return await runBenchmark(client, {
				name: "Stress Test (High Concurrency)",
				totalRequests: 1000,
				concurrency: 200,
				warmupRequests: 20,
			});
		} finally {
			await server.stop();
		}
	},

	// Chaos Tests
	"Network Chaos (30% failures)": async () => {
		const server = new TestServer({
			baseLatencyMs: 10,
			jitterMs: 5,
			failRate: 0.3,
			statusCodes: [500, 502, 503, 504],
		});
		await server.start();
		try {
			const client = HttpClient.create({
				baseUrl: server.baseUrl,
				retry: { maxRetries: 3, backoff: { baseDelayMs: 100, maxDelayMs: 5000, jitter: true } },
				timeout: { attemptMs: 3000 },
			});
			return await runBenchmark(client, {
				name: "Network Chaos (30% failures)",
				totalRequests: 200,
				concurrency: 20,
			});
		} finally {
			await server.stop();
		}
	},

	// Scenarios
	"Bulkhead Isolation": async () => {
		const fastServer = new TestServer({ baseLatencyMs: 5, jitterMs: 2 });
		const slowServer = new TestServer({ baseLatencyMs: 100, jitterMs: 50, failRate: 0.5, statusCodes: [500, 503] });
		await Promise.all([fastServer.start(), slowServer.start()]);
		try {
			const client = HttpClient.create({
				concurrency: 10,
				partitions: {
					[fastServer.baseUrl.replace("http://", "")]: { concurrency: 5, maxQueueSize: 20 },
					[slowServer.baseUrl.replace("http://", "")]: { concurrency: 2, maxQueueSize: 10 },
				},
				retry: { maxRetries: 2 },
				timeout: { attemptMs: 2000 },
			});

			const results = { fast: { success: 0, failed: 0 }, slow: { success: 0, failed: 0 } };
			const promises: Promise<void>[] = [];

			for (let i = 0; i < 100; i++) {
				const isFast = i % 2 === 0;
				const baseUrl = isFast ? fastServer.baseUrl : slowServer.baseUrl;
				const target = isFast ? "fast" : "slow";

				promises.push(
					client
						.get(`${baseUrl}/test/${i}`)
						.toPromise()
						.then((result) => {
							if (result.success) results[target].success++;
							else results[target].failed++;
						}),
				);
			}

			await Promise.allSettled(promises);

			const totalSuccess = results.fast.success + results.slow.success;
			const totalFailed = results.fast.failed + results.slow.failed;

			return {
				name: "Bulkhead Isolation",
				totalRequests: 100,
				successfulRequests: totalSuccess,
				failedRequests: totalFailed,
				avgLatencyMs: 0,
				p50LatencyMs: 0,
				p95LatencyMs: 0,
				p99LatencyMs: 0,
				minLatencyMs: 0,
				maxLatencyMs: 0,
				requestsPerSecond: 0,
				durationMs: 0,
				errors: {},
				timestamp: new Date().toISOString(),
			};
		} finally {
			await Promise.all([fastServer.stop(), slowServer.stop()]);
		}
	},
};

async function runAllBenchmarks(selectedBenchmarks?: string[]) {
	console.log(`\n${"=".repeat(60)}`);
	console.log("VEREDA BENCHMARK SUITE");
	console.log(`${"=".repeat(60)}\n`);

	const toRun = selectedBenchmarks
		? Object.entries(benchmarks).filter(([name]) =>
				selectedBenchmarks.some((s) => name.toLowerCase().includes(s.toLowerCase())),
			)
		: Object.entries(benchmarks);

	const results: BenchmarkResult[] = [];

	for (const [name, fn] of toRun) {
		console.log(`\n▶ Running: ${name}`);
		try {
			const result = await fn();
			results.push(result);
			printResults(result);
		} catch (error) {
			console.error(`✗ Failed: ${name}`);
			console.error(error);
		}
	}

	// Generate summary
	generateSummary(results);
}

function generateSummary(results: BenchmarkResult[]): void {
	console.log(`\n${"=".repeat(60)}`);
	console.log("SUMMARY REPORT");
	console.log("=".repeat(60));
	console.log(`Total Benchmarks: ${results.length}`);
	console.log(`Timestamp: ${new Date().toISOString()}`);
	console.log("-".repeat(60));

	console.log("\nPerformance Overview:\n");
	console.table(
		results.map((r) => ({
			Benchmark: r.name,
			"Req/s": r.requestsPerSecond.toFixed(1),
			"Avg (ms)": r.avgLatencyMs.toFixed(1),
			"P95 (ms)": r.p95LatencyMs.toFixed(1),
			"P99 (ms)": r.p99LatencyMs.toFixed(1),
			"Success %": `${((r.successfulRequests / r.totalRequests) * 100).toFixed(1)}%`,
		})),
	);

	// Find best and worst performers
	if (results.length > 0) {
		const byThroughput = [...results].sort((a, b) => b.requestsPerSecond - a.requestsPerSecond);
		const byLatency = [...results].sort((a, b) => a.p95LatencyMs - b.p95LatencyMs);
		const byReliability = [...results].sort(
			(a, b) => (b.successfulRequests / b.totalRequests) * 100 - (a.successfulRequests / a.totalRequests) * 100,
		);

		console.log("\nKey Insights:");
		console.log(
			`  Highest Throughput: ${byThroughput[0].name} (${byThroughput[0].requestsPerSecond.toFixed(1)} req/s)`,
		);
		console.log(`  Lowest P95 Latency: ${byLatency[0].name} (${byLatency[0].p95LatencyMs.toFixed(1)}ms)`);
		console.log(
			`  Most Reliable: ${byReliability[0].name} (${((byReliability[0].successfulRequests / byReliability[0].totalRequests) * 100).toFixed(1)}% success)`,
		);
	}

	console.log(`\n${"=".repeat(60)}\n`);
}

// CLI argument parsing
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
	console.log(`
Vereda Benchmark Runner

Usage:
  bun run src/runner.ts              # Run all benchmarks
  bun run src/runner.ts stress       # Run benchmarks matching 'stress'
  bun run src/runner.ts chaos        # Run benchmarks matching 'chaos'

Examples:
  bun run src/runner.ts load         # Run load tests
  bun run src/runner.ts scenario     # Run scenario tests
`);
	process.exit(0);
}

runAllBenchmarks(args).catch(console.error);
