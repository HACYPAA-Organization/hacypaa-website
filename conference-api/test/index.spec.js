import { exports } from "cloudflare:workers";
import {
	afterEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import worker, {
	authorizePreregAdmin,
	buildPrintifyOrderPayload,
	handleAdminPanelists,
	handlePanelistApplication,
	handlePaymentReport,
	handleResendPaymentLink,
	sendPaymentConfirmationEmail,
	sendRegistrationEmail,
 } from "../src/index.js";
import {
	errors,
	exportJWK,
	generateKeyPair,
	SignJWT,
} from "jose";

const allowedOrigin = "http://127.0.0.1:5500";

async function createSupabaseTestToken({
	supabaseUrl,
	aal = "aal2",
	userId = "123e4567-e89b-42d3-a456-426614174000",
}) {
	const { publicKey, privateKey } =
		await generateKeyPair("ES256", {
			extractable: true,
		});
	const keyId = "supabase-test-key";
	const jwk = await exportJWK(publicKey);

	jwk.kid = keyId;
	jwk.alg = "ES256";
	jwk.use = "sig";

	const token = await new SignJWT ({
		role: "authenticated",
		aal,
	})
		.setProtectedHeader({
			alg: "ES256",
			kid: keyId,
		})
		.setIssuer(`${supabaseUrl}/auth/v1`)
		.setAudience("authenticated")
		.setSubject(userId)
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(privateKey);

	return {
		jwk,
		token,
		userId,
	};
}



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
			id: "msg_printify_failure",
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

	it("rejects invalid JSON during registration submission", async () => {
		const response = await exports.default.fetch(
			new Request("http://example.com/registrations", {
				method: "POST",
				headers: {
					Origin: allowedOrigin,
					"Content-Type": "applications/json",
				},
				body: "{",
			}),
		);

		expect(response.status).toBe(400);

		expect(await response.json()).toEqual({
			ok: false,
			error: "Request body must be valid JSON",
		});
	});

		it("rejects incomplete registration information", async () => {
		const response = await exports.default.fetch(
			new Request("http://example.com/registrations", {
				method: "POST",
				headers: {
					Origin: allowedOrigin,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			}),
		);

		expect(response.status).toBe(400);

		expect(await response.json()).toEqual({
			ok: false,
			error: "Registration information is incomplete or invalid",
		});
	});

	it("accepts a payment report authenticated by payment token", async () => {
		const boundStatements = [];

		const prepare = vi.fn((sql) => ({
			bind: vi.fn((...values) => {
				const statement = { sql, values };

				boundStatements.push(statement);
				return statement;
			}),
		}));

		const batch = vi.fn().mockResolvedValue([
			{
				meta: { changes: 1 },
			},
			{
				meta: {changes: 1 },
			},
			{
				results: [
					{
						registrationCode: "HACXI-ABCDEF123456",
						status: "payment_reported",
						paymentMethod: "venmo",
						paymentSenderHandle: "@test-user",
						paymentReference: null,
						paymentReportedAt: 1700000000,
					},
				],
			},
		]);

		const response = await handlePaymentReport(
			new Request(
				"http://example.com/registration/payment-report",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						paymentAccessToken: "a".repeat(64),
						paymentMethod: "venmo",
						paymentSenderHandle: "@test-user",
					}),
				},
			),
			{
				ORDERS_DB: {
					prepare,
					batch,
				},
			},
			{},
		);

		expect(response.status).toBe(200);

		expect(await response.json()).toEqual({
			ok: true,
			duplicate: false,
			registration: {
				registrationCode: "HACXI-ABCDEF123456",
				status: "payment_reported",
				paymentMethod: "venmo",
				paymentReportedAt: 1700000000,
			},
		});

		expect(boundStatements).toHaveLength(3);

		const tokenHash = boundStatements[2].values[0];

		expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
		expect(boundStatements[0].values[1]).toBe(tokenHash);
		expect(boundStatements[1].values[3]).toBe(tokenHash);
	});

	it("sends registration email through Resend", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "email_test_123",
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
					},
				},
			),
		);

		vi.stubGlobal("fetch",fetchMock);

		const emailID = await sendRegistrationEmail(
			{
				RESEND_API_KEY: "re_test_key",
				PREREG_FROM_EMAIL:
					"HACYPAA XI Registration <onboarding@resend.dev>",
			},
			{
				to: "registrant@example.com",
				subject: "Test registration email",
				idempotencyKey: "prereg-test/HACXI-TEST123456",
				html: "<p>Test registration email</p>",
				text: "Test registration email",
			},
		);

		expect(emailID).toBe("email_test_123");
		expect(fetchMock).toHaveBeenCalledOnce();

		const [url, requestOptions] =
			fetchMock.mock.calls[0];

		expect(url).toBe("https://api.resend.com/emails");
		expect(requestOptions.method).toBe("POST");
		expect(requestOptions.headers).toMatchObject({
			Authorization: "Bearer re_test_key",
			"Content-Type": "application/json",
			"Idempotency-Key":
				"prereg-test/HACXI-TEST123456",
		});

		expect(JSON.parse(requestOptions.body)).toEqual({
			from:
				"HACYPAA XI Registration <onboarding@resend.dev>",
			to: ["registrant@example.com"],
			subject: "Test registration email",
			html: "<p>Test registration email</p>",
			text: "Test registration email",
		});
	});

	it("sends payment confirmation with registration details", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "email_confirmation_123",
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

		const emailID = await sendPaymentConfirmationEmail(
			{
				RESEND_API_KEY: "re_test_key",
				PREREG_FROM_EMAIL:
					"HACYPAA XI Registration <onboarding@resend.dev>",
			},
			{
				email: "registrant@example.com",
				firstName: "Zach",
				registrationCode: "HACXI-ABCDEF123456",
				amountDueCents: 2500,
			},
		);

		expect(emailID).toBe("email_confirmation_123");
		expect(fetchMock).toHaveBeenCalledOnce();

		const [, requestOptions] =
			fetchMock.mock.calls[0];
		const email = JSON.parse(requestOptions.body);

		expect(requestOptions.headers["Idempotency-Key"]).toBe(
			"prereg-payment-confirmed/HACXI-ABCDEF123456",
		);
		expect(email.to).toEqual([
			"registrant@example.com",
		]);
		expect(email.subject).toBe(
			"Your HACYPAA XI registration is confirmed",
		);
		expect(email.text).toContain(
			"Registration code: HACXI-ABCDEF123456",
		);
		expect(email.text).toContain(
			"Amount confirmed: $25.00",
		);
		expect(email.html).toContain(
			"REGISTRATION CONFIRMED",
		);
	});

	it("sends the payment link by email without exposing it in the registration response", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: "email_payment_link_123",
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

        const statementRun = vi.fn().mockResolvedValue({
            meta: { changes: 1 },
        });

        const prepare = vi.fn((sql) => ({
            bind: vi.fn((...values) => ({
                sql,
                values,
                run: statementRun,
            })),
        }));

        const batch = vi.fn().mockResolvedValue([
            {
                meta: { changes: 1 },
            },
            {
                meta: { changes: 1 },
            },
            {
                results: [
                    {
                        registrationCode:
                            "HACXI-ABCDEF123456",
                        status: "awaiting_payment",
                        amountDueCents: 2500,
                        currency: "usd",
                        firstName: "Zach",
                        lastName: "Walker",
                        email: "zach@example.com",
                    },
                ],
            },
        ]);

        const response = await worker.fetch(
            new Request(
                "http://example.com/registrations",
                {
                    method: "POST",
                    headers: {
                        Origin: allowedOrigin,
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        submissionKey:
                            "123e4567-e89b-42d3-a456-426614174000",
                        firstName: "Zach",
                        lastName: "Walker",
                        email: "zach@example.com",
                        phoneNumber: "8168534193",
                        sobrietyDate: "2020-01-01",
                        location:
                            "Kansas City, Missouri",
                        homeGroup: "Test Home Group",
                        fellowshipAa: true,
                        fellowshipAlanon: false,
                        accommodationMobility: false,
                        accommodationAsl: false,
                        accommodationDetails: "",
                        volunteerInterest: true,
                        scholarshipDonation: false,
                        preferredPaymentMethod:
                            "venmo",
                    }),
                },
            ),
            {
                ORDERS_DB: {
                    prepare,
                    batch,
                },
                PREREG_PRICE_CENTS: "2500",
                PUBLIC_SITE_URL:
                    "https://hacypaa.us",
                RESEND_API_KEY: "re_test_key",
                PREREG_FROM_EMAIL:
                    "HACYPAA XI Registration <onboarding@resend.dev>",
            },
        );

        expect(response.status).toBe(201);

        const data = await response.json();

        expect(data).toMatchObject({
            ok: true,
            duplicate: false,
            emailSent: true,
            registration: {
                registrationCode:
                    "HACXI-ABCDEF123456",
                status: "awaiting_payment",
                amountDueCents: 2500,
                currency: "usd",
            },
        });

        expect(data).not.toHaveProperty("paymentUrl");
        expect(fetchMock).toHaveBeenCalledOnce();

        const [, requestOptions] =
            fetchMock.mock.calls[0];
        const email = JSON.parse(
            requestOptions.body,
        );

        expect(email.text).toContain(
            "https://hacypaa.us/payment/?token=",
        );
        expect(email.text).toContain(
            "Amount due: $25.00",
        );
    });

    it("resends the payment email and rotates the private token", async () => {
        const oldTokenHash = "b".repeat(64);
        const statements = [];

        const prepare = vi.fn((sql) => ({
            bind: vi.fn((...values) => {
                const statement = {
                    sql,
                    values,
                };

                statements.push(statement);

                const normalizedSql =
                    sql.replace(/\s+/g, " ").trim();

                if (
                    normalizedSql.startsWith(
                        "SELECT",
                    )
                ) {
                    return {
                        first: vi.fn().mockResolvedValue({
                            id: 42,
                            registrationCode:
                                "HACXI-ABCDEF123456",
                            firstName: "Zach",
                            email:
                                "zach@example.com",
                            status:
                                "awaiting_payment",
                            amountDueCents: 2500,
                            currency: "usd",
                            currentTokenHash:
                                oldTokenHash,
                            registrationEmailSentAt:
                                0,
                        }),
                    };
                }

                return {
                    run: vi.fn().mockResolvedValue({
                        meta: { changes: 1 },
                    }),
                };
            }),
        }));

        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: "email_resend_123",
                }),
                {
                    status: 200,
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                },
            ),
        );

        vi.stubGlobal("fetch", fetchMock);

        const response =
            await handleResendPaymentLink(
                new Request(
                    "http://example.com/registrations/resend-payment-link",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json",
                        },
                        body: JSON.stringify({
                            submissionKey:
                                "123e4567-e89b-42d3-a456-426614174000",
                            email:
                                "zach@example.com",
                        }),
                    },
                ),
                {
                    ORDERS_DB: { prepare },
                    PUBLIC_SITE_URL:
                        "https://hacypaa.us",
                    RESEND_API_KEY:
                        "re_test_key",
                    PREREG_FROM_EMAIL:
                        "HACYPAA XI Registration <onboarding@resend.dev>",
                },
                {},
            );

        expect(response.status).toBe(200);

        const lookupStatement =
            statements.find(({ sql }) =>
                sql
                    .replace(/\s+/g, " ")
                    .trim()
                    .startsWith("SELECT"),
            );

        expect(lookupStatement).toBeDefined();

        const lookupSql =
            lookupStatement.sql
                .replace(/\s+/g, " ")
                .trim();

        expect(lookupSql).toContain(
            "payment_access_token_hash AS currentTokenHash",
        );
        expect(lookupSql).toContain(
            "WHERE submission_key = ? AND email = ?",
        );

        const data = await response.json();

        expect(data).toMatchObject({
            ok: true,
            emailSent: true,
            registration: {
                registrationCode:
                    "HACXI-ABCDEF123456",
                status: "awaiting_payment",
                amountDueCents: 2500,
                currency: "usd",
            },
        });

        expect(data).not.toHaveProperty("paymentUrl");

        const rotationStatement =
            statements.find(({ sql }) => {
                const normalizedSql =
                    sql.replace(/\s+/g, " ");

                return normalizedSql.includes(
                    "SET payment_access_token_hash = ?",
                ) &&
                    normalizedSql.includes(
                        "status = 'awaiting_payment'",
                    );
            });

        expect(rotationStatement).toBeDefined();

        const newTokenHash =
            rotationStatement.values[0];

        expect(newTokenHash).toMatch(
            /^[0-9a-f]{64}$/,
        );
        expect(newTokenHash).not.toBe(
            oldTokenHash,
        );
        expect(rotationStatement.values[3]).toBe(
            oldTokenHash,
        );

        expect(fetchMock).toHaveBeenCalledOnce();

        const [, requestOptions] =
            fetchMock.mock.calls[0];
        const email = JSON.parse(
            requestOptions.body,
        );

        expect(email.text).toContain(
            "https://hacypaa.us/payment/?token=",
        );
        expect(
            requestOptions.headers[
                "Idempotency-Key"
            ],
        ).toMatch(
            /^prereg-payment-link\/HACXI-ABCDEF123456\/[0-9a-f]{16}$/,
        );
    });

    it("rate limits payment-email resend requests", async () => {
        const nowSpy = vi
            .spyOn(Date, "now")
            .mockReturnValue(1700000000000);

        const fetchMock = vi.fn();

        vi.stubGlobal("fetch", fetchMock);

        const first = vi.fn().mockResolvedValue({
            id: 42,
            registrationCode:
                "HACXI-ABCDEF123456",
            firstName: "Zach",
            email: "zach@example.com",
            status: "awaiting_payment",
            amountDueCents: 2500,
            currency: "usd",
            currentTokenHash: "b".repeat(64),
            registrationEmailSentAt:
                1699999970,
        });

        const prepare = vi.fn(() => ({
            bind: vi.fn(() => ({
                first,
            })),
        }));

        try {
            const response =
                await handleResendPaymentLink(
                    new Request(
                        "http://example.com/registrations/resend-payment-link",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type":
                                    "application/json",
                            },
                            body: JSON.stringify({
                                submissionKey:
                                    "123e4567-e89b-42d3-a456-426614174000",
                                email:
                                    "zach@example.com",
                            }),
                        },
                    ),
                    {
                        ORDERS_DB: { prepare },
                    },
                    {},
                );

            expect(response.status).toBe(429);
            expect(
                response.headers.get(
                    "Retry-After",
                ),
            ).toBe("30");

            expect(await response.json()).toEqual({
                ok: false,
                emailSent: false,
                retryAfter: 30,
                error:
                    "Please wait 30 seconds before resending",
            });

            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            nowSpy.mockRestore();
        }
    });

    it("restores the previous payment token when resend email delivery fails", async () => {
        const oldTokenHash = "c".repeat(64);
        const statements = [];

        const prepare = vi.fn((sql) => ({
            bind: vi.fn((...values) => {
                const statement = {
                    sql,
                    values,
                };

                statements.push(statement);

                const normalizedSql =
                    sql.replace(/\s+/g, " ").trim();

                if (
                    normalizedSql.startsWith(
                        "SELECT",
                    )
                ) {
                    return {
                        first: vi.fn().mockResolvedValue({
                            id: 42,
                            registrationCode:
                                "HACXI-ABCDEF123456",
                            firstName: "Zach",
                            email:
                                "zach@example.com",
                            status:
                                "awaiting_payment",
                            amountDueCents: 2500,
                            currency: "usd",
                            currentTokenHash:
                                oldTokenHash,
                            registrationEmailSentAt:
                                0,
                        }),
                    };
                }

                return {
                    run: vi.fn().mockResolvedValue({
                        meta: { changes: 1 },
                    }),
                };
            }),
        }));

        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    message:
                        "Email service unavailable",
                }),
                {
                    status: 500,
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                },
            ),
        );

        vi.stubGlobal("fetch", fetchMock);

        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        try {
            const response =
                await handleResendPaymentLink(
                    new Request(
                        "http://example.com/registrations/resend-payment-link",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type":
                                    "application/json",
                            },
                            body: JSON.stringify({
                                submissionKey:
                                    "123e4567-e89b-42d3-a456-426614174000",
                                email:
                                    "zach@example.com",
                            }),
                        },
                    ),
                    {
                        ORDERS_DB: { prepare },
                        PUBLIC_SITE_URL:
                            "https://hacypaa.us",
                        RESEND_API_KEY:
                            "re_test_key",
                        PREREG_FROM_EMAIL:
                            "HACYPAA XI Registration <onboarding@resend.dev>",
                    },
                    {},
                );

            expect(response.status).toBe(502);

            expect(await response.json()).toEqual({
                ok: false,
                emailSent: false,
                error:
                    "The registration is saved, but the email could not be resent",
            });

            const rotationStatement =
                statements.find(({ sql }) => {
                    const normalizedSql =
                        sql.replace(/\s+/g, " ");

                    return normalizedSql.includes(
                        "status = 'awaiting_payment'",
                    ) &&
                        normalizedSql.includes(
                            "SET payment_access_token_hash = ?",
                        );
                });

            expect(rotationStatement).toBeDefined();

            const rotatedTokenHash =
                rotationStatement.values[0];

            const rollbackStatement =
                statements.find(
                    ({ sql, values }) => {
                        const normalizedSql =
                            sql.replace(/\s+/g, " ");

                        return (
                            normalizedSql.includes(
                                "SET payment_access_token_hash = ?",
                            ) &&
                            !normalizedSql.includes(
                                "status = 'awaiting_payment'",
                            ) &&
                            values[0] ===
                                oldTokenHash
                        );
                    },
                );

            expect(rollbackStatement).toBeDefined();
            expect(rollbackStatement.values[2]).toBe(
                42,
            );
            expect(rollbackStatement.values[3]).toBe(
                rotatedTokenHash,
            );
        } finally {
            consoleError.mockRestore();
        }
    });

	it("authorizes an allowlisted Supabase admin with aal2", async () => {
		const supabaseUrl =
			"https://allowed-admin.supabase.co";
		const { jwk, token, userId } =
			await createSupabaseTestToken({
				supabaseUrl,
			});

		const fetchMock = vi.fn(
			async (input, options = {}) => {
				const url = String(input);

				if (
					url.endsWith(
						"/auth/v1/.well-known/jwks.json",
					)
				) {
					return new Response(
						JSON.stringify({
							keys: [jwk],
						}),
						{
							status: 200,
							headers: {
								"Content-Type":
									"application/json",
							},
						},
					);
				}

				if (
					url.includes(
						"rest/v1/admin_users",
					)
				) {
					expect(options.headers).toMatchObject({
						apikey: "sb_secret_test",
					});

					return new Response(
						JSON.stringify([
							{
								user_id: userId,
								role: "prereg_admin",
							},
						]),
						{
							status: 200,
							headers: {
								"Content-Type":
									"application/json",
							},
						},
					);
				}

				throw new Error(
					`Unexpected fetch: ${url}`,
				);
			},
		);

		vi.stubGlobal("fetch", fetchMock);

		const result =
			await authorizePreregAdmin(
				new Request(
                    "https://example.com/admin/registrations",
                    {
                        headers: {
                            Authorization:
                                `Bearer ${token}`,
                        },
                    },
                ),
                {
                    SUPABASE_URL: supabaseUrl,
                    SUPABASE_SECRET_KEY:
                        "sb_secret_test",
                },
            );

        expect(result).toMatchObject({
            ok: true,
            authType: "supabase",
            userId,
            role: "prereg_admin",
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);

		const prepare = vi.fn();

		const panelistsResponse = await worker.fetch(
			new Request("https://example.com/admin/panelists", {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			}),
			{
				SUPABASE_URL: supabaseUrl,
				SUPABASE_SECRET_KEY: "sb_secret_test",
				ORDERS_DB: { prepare },
			},
		);

		expect(panelistsResponse.status).toBe(403);
		expect(await panelistsResponse.json()).toMatchObject({
			ok: false,
			error: "Forbidden",
		});
		expect(prepare).not.toHaveBeenCalled();

		const sessionResponse = await worker.fetch(
			new Request("https://example.com/admin/session", {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			}),
			{
				SUPABASE_URL: supabaseUrl,
				SUPABASE_SECRET_KEY: "sb_secret_test",
			},
		);

		expect(sessionResponse.status).toBe(200);
		expect(sessionResponse.headers.get("Cache-Control")).toBe("no-store");
		expect(await sessionResponse.json()).toEqual({
			ok: true,
			role: "prereg_admin",
			permissions: {
				registrations: true,
				volunteers: false,
			},
		});
    });

    it("rejects a Supabase admin session that has not completed MFA", async () => {
        const supabaseUrl =
            "https://aal1-admin.supabase.co";
        const { jwk, token } =
            await createSupabaseTestToken({
                supabaseUrl,
                aal: "aal1",
            });

        const fetchMock = vi.fn(
            async (input) => {
                const url = String(input);

                if (
                    url.endsWith(
                        "/auth/v1/.well-known/jwks.json",
                    )
                ) {
                    return new Response(
                        JSON.stringify({
                            keys: [jwk],
                        }),
                        {
                            status: 200,
                            headers: {
                                "Content-Type":
                                    "application/json",
                            },
                        },
                    );
                }

                throw new Error(
                    `Unexpected fetch: ${url}`,
                );
            },
        );

        vi.stubGlobal("fetch", fetchMock);

        const result =
            await authorizePreregAdmin(
                new Request(
                    "https://example.com/admin/registrations",
                    {
                        headers: {
                            Authorization:
                                `Bearer ${token}`,
                        },
                    },
                ),
                {
                    SUPABASE_URL: supabaseUrl,
                    SUPABASE_SECRET_KEY:
                        "sb_secret_test",
                },
            );

        expect(result).toMatchObject({
            ok: false,
            status: 403,
            error:
                "Multi-factor authentication required",
        });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("rejects a Supabase user who is not on the active admin allowlist", async () => {
        const supabaseUrl =
            "https://unlisted-admin.supabase.co";
        const { jwk, token } =
            await createSupabaseTestToken({
                supabaseUrl,
            });

        const fetchMock = vi.fn(
            async (input) => {
                const url = String(input);

                if (
                    url.endsWith(
                        "/auth/v1/.well-known/jwks.json",
                    )
                ) {
                    return new Response(
                        JSON.stringify({
                            keys: [jwk],
                        }),
                        {
                            status: 200,
                            headers: {
                                "Content-Type":
                                    "application/json",
                            },
                        },
                    );
                }

                if (
                    url.includes(
                        "/rest/v1/admin_users",
                    )
                ) {
                    return new Response(
                        JSON.stringify([]),
                        {
                            status: 200,
                            headers: {
                                "Content-Type":
                                    "application/json",
                            },
                        },
                    );
                }

                throw new Error(
                    `Unexpected fetch: ${url}`,
                );
            },
        );

        vi.stubGlobal("fetch", fetchMock);

        const result =
            await authorizePreregAdmin(
                new Request(
                    "https://example.com/admin/registrations",
                    {
                        headers: {
                            Authorization:
                                `Bearer ${token}`,
                        },
                    },
                ),
                {
                    SUPABASE_URL: supabaseUrl,
                    SUPABASE_SECRET_KEY:
                        "sb_secret_test",
                },
            );

        expect(result).toMatchObject({
            ok: false,
            status: 403,
            error: "Forbidden",
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("returns panelist records to an authorized admin", async () => {
		const supabaseUrl =
			"https://panelist-admin.supabase.co";

		const { jwk, token, userId } =
			await createSupabaseTestToken({
				supabaseUrl,
			});

		const all = vi.fn().mockResolvedValue({
			results: [
				{
					id: 7,
					firstName: "Test",
					lastName: "Panelist",
					email: "panelist@example.com",
					phoneNumber: "816-555-0105",
					stepPreferences: '["1", "6"]',
					sobrietyDate: "2024-06-15",
					hasSponsor: 1,
					workedSteps: 1,
					location: "Kansas City, Missouri",
					hasHomeGroup: 1,
					homeGroup: "Example Group",
					topicPreferences:
						"Sponsorship and service",
					status: "new",
					adminNotes: null,
					createdAt: 1700000000,
					updatedAt: 1700000000,
				},
			],
		});

		const prepare = vi.fn(() => ({
			all,
		}));

		const fetchMock = vi.fn(
			async (input, options = {}) => {
				const url = String(input);

				if (
					url.endsWith(
						"/auth/v1/.well-known/jwks.json",
					)
				) {
					return new Response(
						JSON.stringify({
							keys: [jwk],
						}),
						{
							status: 200,
							headers: {
								"Content-Type":
									"application/json",
							},
						},
					);
				}

				if (
					url.includes(
						"rest/v1/admin_users",
					)
				) {
					expect(
						options.headers,
					).toMatchObject({
						apikey: "sb_secret_test",
					});

					return new Response(
						JSON.stringify([
							{
								user_id: userId,
								role: "volunteer_admin",
							},
						]),
						{
							status: 200,
							headers: {
								"Content-Type":
									"application/json",
							},
						},
					);
				}

				throw new Error(
					`Unexpected fetch: ${url}`,
				);
			},
		);

		vi.stubGlobal("fetch", fetchMock);

		const response = await handleAdminPanelists(
			new Request(
				"https://example.com/admin/panelists",
				{
					headers: {
						Authorization:
							`Bearer ${token}`,
					},
				},
			),
			{
				ORDERS_DB: {
					prepare,
				},
				SUPABASE_URL: supabaseUrl,
				SUPABASE_SECRET_KEY:
					"sb_secret_test",
			},
			{},
		);

		expect(response.status).toBe(200);

		expect(await response.json()).toEqual({
			ok: true,
			panelists: [
				{
					id: 7,
					firstName: "Test",
					lastName: "Panelist",
					email: "panelist@example.com",
					phoneNumber: "816-555-0105",
					stepPreferences: ["1", "6"],
					sobrietyDate: "2024-06-15",
					hasSponsor: 1,
					workedSteps: 1,
					location: "Kansas City, Missouri",
					hasHomeGroup: 1,
					homeGroup: "Example Group",
					topicPreferences:
						"Sponsorship and service",
					status: "new",
					adminNotes: null,
					createdAt: 1700000000,
					updatedAt: 1700000000,
				},
			],
		});

		expect(prepare).toHaveBeenCalledOnce();

		expect(
			prepare.mock.calls[0][0]
				.replace(/\s+/g, " ")
				.trim(),
		).toContain("FROM panelist_volunteers");

		expect(all).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("blocks volunteer admins from registration records", async () => {
		const supabaseUrl =
			"https://volunteer-denied-registration.supabase.co";
		const { jwk, token, userId } =
			await createSupabaseTestToken({ supabaseUrl });
		const prepare = vi.fn();

		vi.stubGlobal("fetch", vi.fn(async (input) => {
			const url = String(input);

			if (url.endsWith("/auth/v1/.well-known/jwks.json")) {
				return Response.json({ keys: [jwk] });
			}

			if (url.includes("/rest/v1/admin_users")) {
				return Response.json([
					{ user_id: userId, role: "volunteer_admin" },
				]);
			}

			throw new Error(`Unexpected fetch: ${url}`);
		}));

		const response = await worker.fetch(
			new Request("https://example.com/admin/registrations", {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			}),
			{
				SUPABASE_URL: supabaseUrl,
				SUPABASE_SECRET_KEY: "sb_secret_test",
				ORDERS_DB: { prepare },
			},
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			ok: false,
			error: "Forbidden",
		});

		const statusResponse = await worker.fetch(
			new Request(
				"https://example.com/admin/registrations/status",
				{
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						registrationCode: "TEST-001",
						status: "confirmed",
					}),
				},
			),
			{
				SUPABASE_URL: supabaseUrl,
				SUPABASE_SECRET_KEY: "sb_secret_test",
				ORDERS_DB: { prepare },
			},
		);

		expect(statusResponse.status).toBe(403);
		expect(await statusResponse.json()).toMatchObject({
			ok: false,
			error: "Forbidden",
		});

		expect(prepare).not.toHaveBeenCalled();
	});

	it("accepts a valid panelist application", async () => {
		const run = vi.fn().mockResolvedValue({
			meta: {
				changes: 1,
			},
		});

		const bind = vi.fn(() => ({
			run,
		}));

		const prepare = vi.fn(() => ({
			bind,
		}));

		const submissionKey =
			"123e4567-e89b-42d3-a456-426614174000";

		const response = await handlePanelistApplication(
			new Request(
				"https://example.com/panelists",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						submissionKey,
						firstName: "Zach",
						lastName: "Walker",
						email: "zach@example.com",
						phoneNumber: "816-555-0100",
						stepPreferences: [
							"12",
							"1",
							"4",
							"4",
						],
						sobrietyDate: "2024-06-15",
						hasSponsor: true,
						workedSteps: true,
						location: "Kansas City, Missouri",
						hasHomeGroup: true,
						homeGroup: "Example Group",
						topicPreferences:
							"Sponsorship and service",
					}),
				},
			),
			{
				ORDERS_DB: {
					prepare,
				},
			},
			{},
		);

		expect(response.status).toBe(201);

		expect(await response.json()).toEqual({
			ok: true,
			submissionKey,
		});

		expect(prepare).toHaveBeenCalledOnce();

		expect(
			prepare.mock.calls[0][0]
				.replace(/\s+/g, " ")
				.trim(),
		).toContain(
			"INSERT INTO panelist_volunteers",
		);

		expect(bind).toHaveBeenCalledWith(
			submissionKey,
			"Zach",
			"Walker",
			"zach@example.com",
			"816-555-0100",
			'["1","4","12"]',
			"2024-06-15",
			1,
			1,
			"Kansas City, Missouri",
			1,
			"Example Group",
			"Sponsorship and service",
		);

		expect(run).toHaveBeenCalledOnce();
	});

	it("rejects invalid panelist applications before database access", async () => {
    const prepare = vi.fn();

    const response = await handlePanelistApplication(
        new Request(
            "https://example.com/panelists",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    submissionKey:
                        "123e4567-e89b-42d3-a456-426614174001",
                    firstName: "Test",
                    lastName: "Panelist",
                    email: "panelist@example.com",
                    phoneNumber: "816-555-0101",
                    stepPreferences: ["13"],
                    sobrietyDate: "2024-06-15",
                    hasSponsor: true,
                    workedSteps: true,
                    location: "Kansas City, Missouri",
                    hasHomeGroup: false,
                }),
            },
        ),
        {
            ORDERS_DB: {
                prepare,
            },
        },
        {},
    );

    expect(response.status).toBe(400);

    expect(await response.json()).toEqual({
        ok: false,
        error: "Panelist information is incomplete or invalid",
    });

    expect(prepare).not.toHaveBeenCalled();
	});

	it("treats a repeated panelist submission key as idempotent", async () => {
		const run = vi.fn().mockResolvedValue({
			meta: {
				changes: 0,
			},
		});

		const bind = vi.fn(() => ({
			run,
		}));

		const prepare = vi.fn(() => ({
			bind,
		}));

		const submissionKey =
			"123e4567-e89b-42d3-a456-426614174002";

		const response = await handlePanelistApplication(
			new Request(
				"https://example.com/panelists",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						submissionKey,
						firstName: "Repeat",
						lastName: "Panelist",
						email: "repeat@example.com",
						phoneNumber: "816-555-0102",
						stepPreferences: ["2"],
						sobrietyDate: "2024-06-15",
						hasSponsor: false,
						workedSteps: false,
						location: "Independence, Missouri",
						hasHomeGroup: false,
					}),
				},
			),
			{
				ORDERS_DB: {
					prepare,
				},
			},
			{},
		);

		expect(response.status).toBe(200);

		expect(await response.json()).toEqual({
			ok: true,
			submissionKey,
		});

		expect(prepare).toHaveBeenCalledOnce();
		expect(bind).toHaveBeenCalledOnce();
		expect(run).toHaveBeenCalledOnce();
	});

	it("returns a safe error when a panelist application cannot be saved", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const run = vi
			.fn()
			.mockRejectedValue(
				new Error("D1 temporarily unavailable"),
			);

		const bind = vi.fn(() => ({
			run,
		}));

		const prepare = vi.fn(() => ({
			bind,
		}));

		try {
			const response =
				await handlePanelistApplication(
					new Request(
						"https://example.com/panelists",
						{
							method: "POST",
							headers: {
								"Content-Type":
									"application/json",
							},
							body: JSON.stringify({
								submissionKey:
									"123e4567-e89b-42d3-a456-426614174003",
								firstName: "Test",
								lastName: "Failure",
								email: "failure@example.com",
								phoneNumber: "816-555-0103",
								stepPreferences: ["5"],
								sobrietyDate: "2024-06-15",
								hasSponsor: true,
								workedSteps: true,
								location: "Kansas City, Missouri",
								hasHomeGroup: false,
							}),
						},
					),
					{
						ORDERS_DB: {
							prepare,
						},
					},
					{},
				);

			expect(response.status).toBe(503);

			expect(await response.json()).toEqual({
				ok: false,
				error: "Could not save the panelist application",
			});

			expect(run).toHaveBeenCalledOnce();
			expect(consoleError).toHaveBeenCalledOnce();
		} finally {
			consoleError.mockRestore();
		}
	});
});
