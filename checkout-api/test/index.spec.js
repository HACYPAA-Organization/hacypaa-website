import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const allowedOrigin = "http://127.0.0.1:5500";

describe("HACYPAA checkout API", () => {
	it("reports that the service is healthy", async () => {
		const response = await exports.default.fetch(
			new Request("http://example.com/health"),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
		ok: true,
		service: "hacypaa-checkout-api",
		});
	});

	it("returns 404 for an unknown route", async () => {
		const response = await exports.default.fetch(
			new Request("http://example.com/not-real"),
		);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: "Not found",
		});
	});

	it("accepts preflight requests from the local website", async () => {
		const response = await exports.default.fetch(
			new Request("http://example.com/checkout/session", {
				method: "OPTIONS",
				headers: {
					Origin: allowedOrigin,
				},
			}),
		);

		expect(response.status).toBe(204);
		expect(
			response.headers.get("Access-Control-Allow-Origin"),
		).toBe(allowedOrigin);

		await response.text();
	});

	it("rejects preflight requests from unknown origins", async () => {
		const response = await exports.default.fetch(
			new Request("http://example.default.fetch", {
				method: "OPTIONS",
				headers: {
					Origin: "https://evil.example",
				},
			}),
		);

		expect(response.status).toBe(403);

		const data = await response.json();
		expect(data.error).toBe("Origin not allowed");
	});

	it("rejects an invalid Checkout Session ID", async () => {
		const response = await exports.default.fetch(
			new Request(
				"http://example.com/checkout/session-status?session_id=fake",
				{
					headers: {
						Origin: allowedOrigin,
					},
				},
			),
		);

		expect(response.status).toBe(400);

		const data = await response.json();
		expect(data.error).toBe(
			"A valid Checkout Session ID is required",
		);
	});

	it("rejects invalid JSON during session creation", async () => {
		const response = await exports.default.fetch(
			new Request("http://example.com/checkout/session", {
				method: "POST",
				headers: {
					Origin: allowedOrigin,
					"Content-Type": "application/json",
				},
				body: "{",
			}),
		);

		expect(response.status).toBe(400);

		const data = await response.json();
		expect(data.error).toBe(
			"Request body must be valid JSON",
		);
	});

	it("rejects an empty cart", async () => {
		const response = await exports.default.fetch(
			new Request("http://exampmle.com/checkout/session", {
				method: "POST",
				headers: {
					Origin: allowedOrigin,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					items: [],
				}),
			}),
		);

		expect(response.status).toBe(400);

		const data = await response.json();
		expect(data.error).toBe(
			"Cart must contain at least one item",
		);
	});

	it("rejects malformed cart items", async () => {
		const response = await exports.default.fetch(
			new Request("http://example.com/checkout/session", {
				method: "POST",
				headers: {
					Origin: allowedOrigin,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					items: [
						{
							productId: "fake",
							variendId: "also-fake",
							quantity: 0,
						},
					],
				}),
			}),
		);

		expect(response.status).toBe(400);

		const data = await response.json();
		expect(data.error).toBe(
			"Cart contains an invalid item",
		);
	});
});