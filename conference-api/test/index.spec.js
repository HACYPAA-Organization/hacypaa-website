import { exports } from "cloudflare:workers";
import {
	afterEach,
	describe,
	expect, 
	it,
	vi
} from "vitest";
import worker, {
	buildPrintifyOrderPayload,
 } from "../src/index.js";

const allowedOrigin = "http://127.0.0.1:5500";

afterEach(() => {
	vi.unstubAllGlobals();
});

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

		it("builds the trusted Printify order payload", () => {
		const payload = buildPrintifyOrderPayload({
			order: {
				id: 42,
				stripe_session_id: "cs_test_order_42",
				customer_email: "customer@example.com",
				customer_phone: "8165550123",
				shipping_name: "John Smith",
				shipping_line1: "123 Main Street",
				shipping_line2: null,
				shipping_city: "Kansas City",
				shipping_state: "MO",
				shipping_postal_code: "64111",
				shipping_country: "US",
			},
			items: [
				{
					stripe_line_item_id: "li_test_42",
					printify_product_id: "5bfd0b66a342bcc9b5563216",
					printify_variant_id: 17887,
					quantity: 2,
				},
			],
		});

		expect(payload).toEqual({
			external_id: "cs_test_order_42",
			label: "HACYPAA-42",
			line_items: [
				{
					product_id: "5bfd0b66a342bcc9b5563216",
					variant_id: 17887,
					quantity: 2,
					external_id: "li_test_42",
				},
			],
			shipping_method: 1,
			send_shipping_notification: true,
			address_to: {
				first_name: "John",
				last_name: "Smith",
				email: "customer@example.com",
				phone: "8165550123",
				country: "US",
				region: "MO",
				address1: "123 Main Street",
				address2: "",
				city: "Kansas City",
				zip: "64111",
			},
		});
	});

	it("acknowledges and discards invalid fulfillment jobs", async () => {
		const message = {
			id: "msg_invalid",
			timestamp: new Date(),
			body: { orderID: 0 },
			attempts: 1,
			ack: vi.fn(),
			retry: vi.fn(),
		};

		const batch = {
			queue: "hacypaa-fulfillment",
			messages: [message],
			ackAll: vi.fn(),
			retryAll: vi.fn(),
		};

		await worker.queue(batch, {});

		expect(message.ack).toHaveBeenCalledOnce();
		expect(message.retry).not.toHaveBeenCalled();
	});

	it("retries fulfillment jobs when the order cannot be loaded", async () => {
		const first = vi.fn().mockResolvedValue(null);
		const bind = vi.fn(() => ({ first }));
		const prepare = vi.fn(() => ({ bind }));

		const message = {
			id: "msg_missing_order",
			timestamp: new Date(),
			body: { orderID: 42 },
			attempts: 1,
			ack: vi.fn(),
			retry: vi.fn(),
		};

		const batch = {
			queue: "hacypaa-fulfillment",
			messages: [message],
			ackAll: vi.fn(),
			retryAll: vi.fn(),
		};

		await worker.queue(batch, {
			ORDERS_DB: { prepare },
		});

		expect(prepare).toHaveBeenCalledOnce();
		expect(message.retry).toHaveBeenCalledOnce();
		expect(message.ack).not.toHaveBeenCalled();
	});

	it("submits a claimed paid order to Printify", async () => {
		const order = {
			id: 42,
			stripe_session_id: "cs_test_order_42",
			customer_email: "customer@example.com",
			customer_phone: "8165550123",
			shipping_name: "John Smith",
			shipping_line1: "123 Main Street",
			shipping_line2: "null",
			shipping_city: "Kansas City",
			shipping_state: "MO",
			shipping_postal_code: "64111",
			shipping_country: "US",
			fulfillment_status: "pending",
			printify_order_id: null,
		};

		const items = [
			{
				stripe_line_item_id: "li_test_42",
				printify_product_id: "5bfd0b66a342bcc9b5563216",
				printify_variant_id: 17887,
				quantity: 1,
			},
		];

		const claimRun = vi.fn().mockResolvedValue({
			meta: { changes : 1 },
		});

		const recordRun = vi.fn().mockResolvedValue({
			meta: { changes: 1 },
		});

		const prepare = vi.fn((sql) => {
			if (sql.includes("FROM order_items")) {
				return {
					bind: () => ({
						all: vi.fn().mockResolvedValue({
							results: items,
						}),
					}),
				};
			}

			if (sql.includes("FROM orders")) {
				return {
					bind: () => ({
						first: vi.fn().mockResolvedValue(order),
					}),
				};
			}

			if (sql.includes("fulfillment_attempts")) {
				return {
					bind: () => ({
						run: claimRun,
					}),
				};
			}

			if (sql.includes("printify_submitted_at")) {
				return {
					bind: () => ({
						run: recordRun,
					}),
				};
			}

			if (sql.includes("fulfillment_status = 'failed'")) {
				return {
					bind: () => ({
						run: vi.fn().mockResolvedValue({
							meta: { changes: 1 },
						}),
					}),
				};
			}

			throw new Error("Unexpected SQL in fulfillment test");
		});

		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "printify_order_42",
					status: "pending",
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
					},
				},
			),
		);

		vi.stubGlobal("fetch", fetchMock);

		const message = {
			id: "msg_success",
			timestamp: new Date(),
			body: { orderID: 42 },
			attempts: 1,
			ack: vi.fn(),
			retry: vi.fn(),
		};

		await worker.queue(
			{
				queue: "hacypaa-fulfillment",
				messages: [message],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			},
			{
				ORDERS_DB: { prepare },
				PRINTIFY_API_TOKEN: "test-token",
				PRINTIFY_SHOP_ID: "test-shop",
			},
		);

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://api.printify.com/v1/shops/test-shop/orders.json"
		);

		const requestOptions = fetchMock.mock.calls[0][1];

		expect(requestOptions.method).toBe("POST");
		expect(requestOptions.headers.Authorization).toBe(
			"Bearer test-token",
		);
		expect(requestOptions.headers["User-Agent"]).toBe(
			"HACYPAA Checkout API",
		);

		expect(claimRun).toHaveBeenCalledOnce();
		expect(recordRun).toHaveBeenCalledOnce();
		expect(message.ack).toHaveBeenCalledOnce();
		expect(message.retry).not.toHaveBeenCalled();
	});

	it("does not resubmit an order already sent to Printify", async () => {
		const prepare = vi.fn((sql) => {
			if (sql.includes("FROM order_items")) {
				return {
					bind: () => ({
						all: vi.fn().mockResolvedValue({
							results: [
								{
									stripe_line_item_id: "li_existing",
									printify_product_id:
										"5bfd0b66a342bcc9b5563216",
									printify_variant_id: 17887,
									quantity: 1,
								},
							],
						}),
					}),
				};
			}

			if (sql.includes("FROM orders")) {
				return {
					bind: () => ({
						first: vi.fn().mockResolvedValue({
							id: 43,
							fulfillment_status: "submitted",
							printify_order_id:
								"printify_order_existing",
						}),
					}),
				}
			}
			throw new Error(
				"Unexpected SQL in completed-order test",
			);
		});

		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const message = {
			id: "msg_already_submitted",
			timestamp: new Date(),
			body: { orderID: 43 },
			attempts: 1,
			ack: vi.fn(),
			retry: vi.fn(),
		};

		await worker.queue(
			{
				queue: "hacypaa-fulfillment",
				messages: [message],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			},
			{
				ORDERS_DB: { prepare }
			},
		);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(message.ack).toHaveBeenCalledOnce();
		expect(message.retry).not.toHaveBeenCalled();
	});

	it("records Printify failures and retries the fulfillment job", async() => {
		const order = {
			id: 44,
			stripe_session_id: "cs_test_failure_44",
			customer_email: "customer@example.com",
			customer_phone: "8165550123",
			shipping_name: "John Smith",
			shipping_line1: "123 Main Street",
			shipping_line2: null,
			shipping_city: "Kansas City",
			shipping_state: "MO",
			shipping_postal_code: "64111",
			shipping_country: "US",
			fulfillment_status: "pending",
			printify_order_id: null,
		};

		const items = [
			{
				stipe_line_item_id: "li_failure_44",
				printify_product_id:
					"5bfd0b66a342bcc9b5563216",
					printify_variant_id: 17887,
					quantity: 1,
			},
		];

		const claimRun = vi.fn().mockResolvedValue({
			meta: { changes: 1 },
		});

		const failureRun = vi.fn().mockResolvedValue({
			meta: { changes: 1 },
		});

		const failureBind = vi.fn(() => ({
			run: failureRun,
		}));

		const prepare = vi.fn((sql) => {
			if (sql.includes("FROM order_items")) {
				return {
					bind: () => ({
						all: vi.fn().mockResolvedValue({
							results: items,
						}),
					}),
				};
			}

			if (sql.includes("FROM orders")) {
				return {
					bind: () =>({
						first: vi.fn().mockResolvedValue(order),
					}),
				};
			}

			if (sql.includes("fulfillment_attempts")) {
				return {
					bind: () => ({
						run: claimRun,
					}),
				};
			}

			if (sql.includes("fulfillment_status = 'failed'")) {
				return {
					bind: failureBind,
				};
			}

			throw new Error(
				"Unexpected SQL in failure-path test",
			);
		});

		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					message: "Printify unavailable",
				}),
				{
					status: 503,
					headers: {
						"Content-Type": "application/json",
					},
				},
			),
		);

		vi.stubGlobal("fetch", fetchMock);

		const message = {
			id: "msg_printify_failutre",
			timestamp: new Date(),
			body: { orderID: 44 },
			attempts: 1,
			ack: vi.fn(),
			retry: vi.fn(),
		};

		await worker.queue(
			{
				queue: "hacypaa-fulfillment",
				messages: [message],
				ackAll: vi.fn(),
				retryAll: vi.fn(),
			},
			{
				ORDERS_DB: { prepare },
				PRINTIFY_API_TOKEN: "test-token",
				PRINTIFY_SHOP_ID: "test-shop",
			},
		);

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(claimRun).toHaveBeenCalledOnce();
		expect(failureRun).toHaveBeenCalledOnce();
		expect(failureBind).toHaveBeenCalledWith(
			"Printify rejected order: Printify unavailable",
			44,
		);

		expect(message.retry).toHaveBeenCalledOnce();
		expect(message.ack).not.toHaveBeenCalled();
	});
});