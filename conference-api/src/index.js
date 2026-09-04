import Stripe from "stripe";

const ALLOWED_ORIGINS = new Set([
	"http://127.0.0.1:5500",
	"http://localhost:5500",
	"https://hacypaa.us",
	"https://www.hacypaa.us",
]);

const PAID_CHECKOUT_EVENT_TYPES = new Set([
	"checkout.session.completed",
	"checkout.session.async_payment_succeeded",
]);

function getCorsHeaders(request) {
	const origin = request.headers.get("Origin");

	const headers = {
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		Vary: "Origin",
	};

	if (origin && ALLOWED_ORIGINS.has(origin)) {
		headers["Access-Control-Allow-Origin"] = origin;
	}

	return headers;
}

function json(data, status = 200, headers = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			...headers,
		},
	});
}

function buildOrderItems(lineItems) {
	if (
		!Array.isArray(lineItems?.data) ||
		lineItems.data.length === 0 ||
		lineItems.has_more
	) {
		throw new Error("Stripe returned incomplete line items");
	}

	return lineItems.data.map((lineItem) => {
		const product = lineItem.price?.product;

		if (
			!product ||
			typeof product === "string" ||
			product.deleted
		) {
			throw new Error(
				'Stripe Product was not expanded for ${lineItem.id}',
			);
		}

		const printifyProductID =
			product.metadata?.printify_product_id?.trim();

		const printifyVariantID = Number.parseInt(
			product.metadata?.printify_variant_id || "",
			10,
		);

		if(
			typeof lineItem.id !== "string" ||
			!printifyProductID ||
			!Number.isInteger(printifyVariantID) ||
			printifyVariantID <= 0 ||
			!Number.isInteger(lineItem.quantity) ||
			lineItem.quantity < 1 ||
			lineItem.quantity > 10 ||
			!Number.isInteger(lineItem.price?.unit_amount) ||
			lineItem.price.unit_amount <= 0 ||
			!Number.isInteger(lineItem.amount_total) ||
			lineItem.amount_total < 0
		) {
			throw new Error(
				'Invalid trusted data for ${lineItem.id || "unknown line item"}',
			);
		}

		return {
			stripeLineItemID: lineItem.id,
			printifyProductID,
			printifyVariantID,
			productTitle:
				product.name?.trim() ||
				lineItem.description?.trim() ||
				"Unknown product",
			variantTitle: null,
			quantity: lineItem.quantity,
			unitAmount: lineItem.price.unit_amount,
			amountTotal: lineItem.amount_total,
		};
	});
}

function cleanText(value) {
	return typeof value === "string" ? value.trim() : "";
}

function stripeObjectID(value) {
	if (typeof value === "string") return value;

	return cleanText(value?.id) || null;
}

function buildOrderRecord(event, session) {
	const customer = session.customer_details;
	const shipping = 
		session.collected_information?.shipping_details;
	const address = shipping?.address;

	const currency = cleanText(session.currency).toLowerCase();
	const country = cleanText(address?.country).toUpperCase();

	const customerName = cleanText(customer?.name) || null;
	const shippingName =
		cleanText(shipping?.name) || customerName;

	const amountSubtotal = session.amount_subtotal;
	const amountShipping =
		session.total_details?.amount_shipping ?? 0;
	const amountTax =
		session.total_details?.amount_tax ?? 0;
	const amountDiscount =
		session.total_details?.amount_discount ?? 0;
	const amountTotal = session.amount_total;

	const requiredText = [
		cleanText(event.id),
		cleanText(session.id),
		currency,
		cleanText(customer?.email),
		shippingName,
		cleanText(address?.line1),
		cleanText(address?.city),
		cleanText(address?.state),
		cleanText(address?.postal_code),
		country,
	];

	const amounts = [
		amountSubtotal,
		amountShipping,
		amountTax,
		amountDiscount,
		amountTotal,
	];

	if (
		requiredText.some((value) => !value) ||
		currency.length !== 3 ||
		country.length !== 2 ||
		amounts.some(
			(value) =>
				!Number.isInteger(value) || value < 0,
		) ||
		amountTotal !==
			amountSubtotal +
				amountShipping +
				amountTax -
				amountDiscount ||
		!Number.isInteger(event.created) ||
		event.created <= 0 ||
		typeof event.livemode !== "boolean" ||
		typeof session.livemode !== "boolean" ||
		event.livemode !== session.livemode ||
		session.object !== "checkout.session" ||
		session.mode !== "payment" ||
		session.status !== "complete" ||
		session.payment_status !== "paid" ||
		session.metadata?.source !== "hacypaa_merch"
	) {
		throw new Error(
			"Paid Checkout Session is incomplete or inconsistent",
		);
	}

	return {
		stripeEventID: event.id,
		stripeEventType: event.type,
		stripeObjectID: session.id,
		livemode: event.livemode ? 1: 0,
		stripeCreatedAt: event.created,

		stripeSessionID: session.id,
		stripePaymentIntentID:
			stripeObjectID(session.payment_intent),
		stripeCustomerID:
			stripeObjectID(session.customer),
		paymentStatus: "paid",
		currency,

		amountSubtotal,
		amountShipping,
		amountTax,
		amountDiscount,
		amountTotal,

		customerEmail: cleanText(customer.email),
		customerName,
		customerPhone:
			cleanText(customer.phone) || null,

		shippingName,
		shippingLine1: cleanText(address.line1),
		shippingLine2:
			cleanText(address.line2) || null,
		shippingCity: cleanText(address.city),
		shippingState: cleanText(address.state),
		shippingPostalCode:
			cleanText(address.postal_code),
		shippingCountry: country,

		paidAt: event.created,
	}
}

async function storePaidOrder(db, order, items) {
	if (!db) {
		throw new Error("ORDERS_DB is not configured");
	}

	const findStoredOrder = () =>
		db
			.prepare(
				`
				SELECT id
				FROM orders
				WHERE stripe_event_id = ?
					OR stripe_session_id = ?
				LIMIT 1
				`,
			)
			.bind(
				order.stripeEventID,
				order.stripeSessionID,
			)
			.first();

	const existingOrder = await findStoredOrder();

	if (existingOrder) {
		return {
			duplicate: true,
			orderID: existingOrder.id,
		};
	}

	const statements = [
		db
			.prepare(
				`
				INSERT INTO processed_stripe_events (
					event_id,
					event_type,
					stripe_object_id,
					livemode,
					stripe_created_at
				)
				VALUES (?, ?, ?, ?, ?)
				`,
			)
			.bind(
				order.stripeEventID,
				order.stripeEventType,
				order.stripeObjectID,
				order.livemode,
				order.stripeCreatedAt,
			),

		db
			.prepare(
				`
				INSERT INTO orders (
					stripe_event_id,
					stripe_session_id,
					stripe_payment_intent_id,
					stripe_customer_id,
					livemode,
					payment_status,
					currency,
					amount_subtotal,
					amount_shipping,
					amount_tax,
					amount_discount,
					amount_total,
					customer_email,
					customer_name,
					customer_phone,
					shipping_name,
					shipping_line1,
					shipping_line2,
					shipping_city,
					shipping_state,
					shipping_postal_code,
					shipping_country,
					paid_at
				)
				VALUES (
					?, ?, ?, ?, ?, ?, ?,
					?, ?, ?, ?, ?,
					?, ?, ?,
					?, ?, ?, ?, ?, ?, ?,
					?
				)
				`,
			)
			.bind(
				order.stripeEventID,
				order.stripeSessionID,
				order.stripePaymentIntentID,
				order.stripeCustomerID,
				order.livemode,
				order.paymentStatus,
				order.currency,
				order.amountSubtotal,
				order.amountShipping,
				order.amountTax,
				order.amountDiscount,
				order.amountTotal,
				order.customerEmail,
				order.customerName,
				order.customerPhone,
				order.shippingName,
				order.shippingLine1,
				order.shippingLine2,
				order.shippingCity,
				order.shippingState,
				order.shippingPostalCode,
				order.shippingCountry,
				order.paidAt,
			),
	];

	for (const item of items) {
		statements.push(
			db
				.prepare(
					`
					
					INSERT INTO order_items (
						order_id,
						stripe_line_item_id,
						printify_product_id,
						printify_variant_id,
						product_title,
						variant_title,
						quantity,
						unit_amount,
						amount_total
					)
					VALUES (
						(
							SELECT id
							FROM orders
							WHERE stripe_session_id = ?
							),
							?, ?, ?, ?, ?, ?, ?, ?
						)
						`,		
				)
				.bind(
					order.stripeSessionID,
					item.stripeLineItemID,
					item.printifyProductID,
					item.printifyVariantID,
					item.productTitle,
					item.variantTitle,
					item.quantity,
					item.unitAmount,
					item.amountTotal,
				),
		);
	}

	try {
		const results = await db.batch(statements);

		return {
			duplicate: false,
			orderID:
			results[1]?.meta?.last_row_id || null,
		};
	} catch (error) {
		// Another copy of the webhook may have won the race.
		const racedOrder = await findStoredOrder();

		if (racedOrder) {
			return {
				duplicate: true,
				orderID: racedOrder.id,
			};
		}

		throw error;
	}
}

async function loadFulfillmentOrder(db, orderID) {
	const order = await db
		.prepare(
			`
				SELECT
					id,
					stripe_session_id,
					customer_email,
					customer_phone,
					shipping_name,
					shipping_line1,
					shipping_line2,
					shipping_city,
					shipping_state,
					shipping_postal_code,
					shipping_country,
					fulfillment_status,
					printify_order_id
				FROM orders
				WHERE id = ?
			`,
		)
		.bind(orderID)
		.first();

	if (!order) {
		return null;
	}

	const itemResult = await db
		.prepare(
			`
				SELECT
					stripe_line_item_id,
					printify_product_id,
					printify_variant_id,
					quantity
				FROM order_items
				WHERE order_id = ?
				ORDER BY id
			`,
		)
		.bind(orderID)
		.all();

	return {
		order,
		items: itemResult.results || [],
	};
}

export function buildPrintifyOrderPayload(fulfillmentOrder) {
	const { order, items } = fulfillmentOrder;
	const nameParts = order.shipping_name.trim().split(/\s+/);
	const firstName = nameParts.shift();
	const lastName = nameParts.join(" ") || firstName;

	return {
		external_id: order.stripe_session_id,
		label: `HACYPAA-${order.id}`,
		line_items: items.map((item) => ({
				product_id: item.printify_product_id,
				variant_id: item.printify_variant_id,
				quantity: item.quantity,
				external_id: item.stripe_line_item_id,
		})),
		shipping_method: 1,
		send_shipping_notification: true,
		address_to: {
			first_name: firstName,
			last_name: lastName,
			email: order.customer_email,
			phone: order.customer_phone || "",
			country: order.shipping_country,
			region: order.shipping_state,
			address1: order.shipping_line1,
			address2: order.shipping_line2 || "",
			city: order.shipping_city,
			zip: order.shipping_postal_code,
		},
	};
}

async function submitPrintifyOrder(
	apiToken,
	shopID,
	payload,
) {
	const response = await fetch(
		`https://api.printify.com/v1/shops/${encodeURIComponent(shopID)}/orders.json`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiToken}`,
				"Content-Type": "application/json",
				Accept: "application/json",
				"User-Agent": "HACYPAA Checkout API",
			},
			body: JSON.stringify(payload),
		},
	);

	const responseText = await response.text();
	let responseData = null;

	try {
		responseData = responseText
			? JSON.parse(responseText)
			: null;
	} catch {
		// Handled by the validation below.
	}

	if (!response.ok) {
		const message =
			typeof responseData?.message === "string"
				? responseData.message
				: `HTTP ${response.status}`;
		throw new Error(`Printify rejected order: ${message}`);	
	}

	if (
		!responseData ||
		typeof responseData.id !== "string" ||
		!responseData.id
	) {
		throw new Error(
			"Printify response did not include an order ID",
		);
	}

	return responseData;
}

async function claimOrderForFulfillment(db, orderID) {
	const result = await db
		.prepare(
			`
				UPDATE orders
				SET
					fulfillment_status = 'submitting',
					fulfillment_attempts =
						fulfillment_attempts + 1,
					last_fulfillment_error = NULL,
					updated_at = unixepoch()
				WHERE id = ?
					AND printify_order_id IS NULL
					AND (
						fulfillment_status IN (
							'pending',
							'failed'
						)
						OR (
							fulfillment_status = 'submitting'
							AND updated_at <= unixepoch() - 300
						)
					)
				`,
		)
		.bind(orderID)
		.run();

	return result.meta.changes === 1;
}

async function recordPrintSubmission(
	db,
	orderID,
	printifyOrder,
) {
	const result = await db
		.prepare(
			`
				UPDATE orders
				SET
					fulfillment_status = 'submitted',
					printify_order_id = ?,
					printify_status = ?,
					printify_submitted_at = unixepoch(),
					last_fulfillment_error = NULL,
					updated_at = unixepoch()
				WHERE id = ?
					AND fulfillment_status = 'submitting'
					AND printify_order_id IS NULL
				`,
		)
		.bind(
			printifyOrder.id,
			printifyOrder.status || "pending",
			orderID,
		)
		.run();

	if (result.meta.changes !== 1) {
		throw new Error(
			"Could not record the Printify submission",
		);
	}
}

async function recordFulfillmentFailure(
	db,
	orderID,
	error,
) {
	const message = (
		error instanceof Error
			? error.message
			: String(error)
	).slice(0, 1000);

	await db
		.prepare(
			`
				UPDATE orders
				SET
					fulfillment_status = 'failed',
					last_fulfillment_error = ?,
					updated_at = unixepoch()
				WHERE id = ?
					AND fulfillment_status = 'submitting'
					AND printify_order_id IS NULL
				`,
		)
		.bind(message, orderID)
		.run();
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const corsHeaders = getCorsHeaders(request);
		const origin = request.headers.get("Origin");

		if (request.method === "OPTIONS") {
			if (!origin || !ALLOWED_ORIGINS.has(origin)) {
				return json({ error: "Origin not allowed"}, 403, corsHeaders);
			}

			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}

		if (
			request.method === "POST" &&
			url.pathname === "/stripe/webhook"
		) {
			const stripeSecretKey = env.STRIPE_SECRET_KEY?.trim();
			const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();

			if (
				!stripeSecretKey ||
				!webhookSecret?.startsWith("whsec_")
			) {
				return json(
					{
						ok: false,
						error: "Stripe webhook is not configured",
					},
					500,
					{ "Cache-Control": "no-store" },
				);
			}

			const signature = request.headers.get("Stripe-Signature");

			if (!signature) {
				return json(
					{
						ok: false,
						error: "Stripe signature is required",
					},
					400,
					{ "Cache-Control": "no-store" },
				);
			}

			const stripe = new Stripe(stripeSecretKey);
			const rawBody = await request.text();
			let event;

			try {

				event = await stripe.webhooks.constructEventAsync(
					rawBody,
					signature,
					webhookSecret,
				);
			} catch (error) {
				console.error("Stripe webhook verification failed", {
					message:
					error instanceof Error
					? error.message
					: String(error),
				});

				return json(
					{
						ok: false,
						error: "Invalid Stripe webhook signature",
					},
					400,
					{ "Cache-Control": "no-store" },
				);
			}

			if (!PAID_CHECKOUT_EVENT_TYPES.has(event.type)) {
				return json(
					{ received: true, ignored: true },
					200,
					{ "Cache-Control": "no-store" },
				);
			}

			const eventSession = event.data?.object;

			if (
				eventSession?.object !== "checkout.session" ||
				typeof eventSession.id !== "string" ||
				eventSession.metadata?.source !== "hacypaa_merch"
			) {
				console.log("Ignoring unrelated Checkout Session", {
					eventId: event.id,
					sessionId: eventSession?.id || null,
				});

				return json(
					{ received: true, ignored: true },
					200,
					{ "Cache-Control": "no-store" },
				);
			}

			let session;
			let lineItems;

			try {
				[session, lineItems] = await Promise.all([
					stripe.checkout.sessions.retrieve(eventSession.id),
					stripe.checkout.sessions.listLineItems(
						eventSession.id,
						{
							limit: 100,
							expand: ["data.price.product"],
						},
					),
				]);
			} catch (error) {
				console.error("Checkout Session retrieval failed", {
					eventId: event.id,
					sessionId: eventSession.id,
					message:
						error instanceof Error
							? error.message
							: String(error),
				});

				return json(
					{
						ok: false,
						error: "Could not retrieve Checkout Session",
					},
					500,
					{ "Cache-Control": "no-store" },
				);
			}

			if (session.payment_status !== "paid") {
				console.log("Ignoring unpaid Checkout Session", {
					eventId: event.id,
					sessionId: session.id,
					paymentStatus: session.payment_status,
				});

				return json(
					{ received: true, ignored: true },
					200,
					{ "Cache-Control": "no-store" },
				);
			}

			let orderRecord;
			let orderItems;

			try {
				orderRecord = buildOrderRecord(event, session);
				orderItems = buildOrderItems(lineItems);
			} catch (error) {
				console.error("Checkout order validation failed", {
					eventId: event.id,
					sessionId: session.id,
					message:
						error instanceof Error
							? error.message
							: String(error),
				});

				return json(
					{
						ok: false,
						error: "Invalid Checkout order",
					},
					500,
					{ "Cache-Control": "no-store" },
				);
			}

			let storageResult;

			try {
				storageResult = await storePaidOrder(
					env.ORDERS_DB,
					orderRecord,
					orderItems,
				);
			} catch (error) {
				console.error("Paid order storage failed", {
					eventId: event.id,
					sessionId: session.id,
					message:
						error instanceof Error
							? error.message
							: String(error),
				});

				return json(
					{
						ok: false,
						error: "Could not store paid order",
					},
					500,
					{ "Cache-Control": "no-store" },
				);
			}

			if (
				!Number.isInteger(storageResult.orderID) ||
				storageResult.orderID <= 0
			) {
				console.error("Paid order has no valid D1 ID", {
					eventId: event.id,
					sessionId: session.id,
					orderID: storageResult.orderID,
				});

				return json(
					{
						ok: false,
						error: "Paid order has no valid ID",
					},
					500,
					{ "Cache-Control": "no-store" },
				);
			}

			try {
				await env.FULFILLMENT_QUEUE.send({
					orderID: storageResult.orderID,
				});
			} catch (error) {
				console.error("Paid order queueing faild", {
					eventId: event.id,
					sessionId: session.id,
					orderID: storageResult.orderID,
					message:
						error instanceof Error
							? error.message
							: String(error),
				});

				return json(
					{
						ok: false,
						error: "Could not queue paid order",
					},
					500,
					{ "Cache-Control": "no-store" },
				);
			}

			console.log(
				storageResult.duplicate
					? "Duplicate paid order ignored"
					: "Stored paid HACYPAA order",
					{
						eventId: event.id,
						sessionId: session.id,
						orderID: storageResult.orderID,
						lineItemCount: orderItems.length,
						amountTotal: orderRecord.amountTotal,
						queued: true,
					},
			);

			return json(
				{
					received: true,
					duplicate: storageResult.duplicate,
				},
				200,
				{ "Cache-Control": "no-store" }
			);
		}

		if (
			request.method === "POST" &&
			url.pathname === "/registrations"
		) {
			let body;

			try {
				body = await request.json();
			} catch {
				return json(
					{
						ok: false,
						error: "Request body must be valid JSON",
					},
					400,
					{
						...corsHeaders,
						"Cache-Control": "no-store",
					},
				);
			}

			return json(
				{
					ok: false,
					error: "Registration validation is not implemented",
				},
				501,
				{
					...corsHeaders,
					"Cache-Control": "no-store",
				},
			);
		}

		if (request.method === "GET" && url.pathname === "/health") {
			return json(
				{
					ok: true,
					service: "hacypaa-checkout-api",
				},
				200,
				corsHeaders,
			);
		}

		if (request.method === "GET" && url.pathname === "/stripe/status") {
			if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
				return json(
					{
						ok: false,
						error: "A Stripe test secret is required",
					},
					500,
					corsHeaders,
				);
			}

			try {
				const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
					appInfo: {
						name: "HACYPAA Checkout",
						version: "0.1.0",
					},
					maxNetworkRetries: 2,
				});

				const balance = await stripe.balance.retrieve();

				return json(
					{
						ok: true,
						stripeConnected: true,
						mode: balance.livemode ? "live" : "test",
					},
					200,
					corsHeaders,
				);
			} catch (error) {
				console.error("Stripe connection failed", error);

				return json(
					{
						ok: false,
						error: "Stripe connection failed",
					},
					500,
					corsHeaders,
				);
			}
		}

		if (request.method === "GET" && url.pathname === "/printify/status") {
			if (!env.PRINTIFY_API_TOKEN) {
				return Response.json(
					{ ok: false, error: "A Printify API token is required" },
					{ status: 500},
				);
			}

			const printifyResponse = await fetch(
				"https://api.printify.com/v1/shops.json",
				{
					headers: {
						Authorization: "Bearer " + env.PRINTIFY_API_TOKEN.trim(),
						"User-Agent": "HACYPAA Checkout API",
						"Content-Type": "application/json",
					},
				},
			);

			if (!printifyResponse.ok) {
				return Response.json(
					{
						ok: false,
						error: "Printify rejected the API request",
						status: printifyResponse.status,
					},
					{ status: 502},
				);
			}

			const shops = await printifyResponse.json();

			return Response.json({
				ok: true,
				printifyConnected: true,
				shops: shops.map((shop) => ({
					id: shop.id,
					title: shop.title,
					salesChannel: shop.sales_channel,
				})),
			});
		}

		if (request.method === "GET" && url.pathname === "/printify/products") {
			const shopID = env.PRINTIFY_SHOP_ID?.trim();

			if (!shopID) {
				return Response.json(
					{ ok: false, error: "PRINTIFY_SHOP_ID is required" },
					{ status: 500 },
				);
			}

			const productsUrl =
			"https://api.printify.com/v1/shops/" +
			encodeURIComponent(shopID) +
			"/products.json";

			const printifyResponse = await globalThis.fetch(productsUrl, {
				headers: {
					Authorization: "Bearer " + env.PRINTIFY_API_TOKEN.trim(),
					"User-Agent": "HACYPAA Checkout API",
					"Content-Type": "application/json",
				},
			});

			if (!printifyResponse.ok) {
				const printifyError = await printifyResponse.text();

				return Response.json(
					{
						ok: false,
						error: "Could not retrieve Printify products",
						printifyStatus: printifyResponse.status,
						details: printifyError,
					},
					{ status: printifyResponse.status },
				);
			}

			const payload = await printifyResponse.json();
			const products = Array.isArray(payload) ? payload : payload.data || [];

			return Response.json({
				ok: true,
				count: products.lenth,
				products: products.map((product) => ({
					id: product.id,
					title: product.title,
					visible: product.visible,
					enabledVariants: product.variants.filter(
						(variant) => variant.is_enabled,
					).length,
					prices: [
						...new Set(
							product.variants
							.filter((variant) => variant.is_enabled)
							.map((variant) => variant.price),
						),
					],
				})),
			});
		}

		if (
			request.method === "GET" &&
			url.pathname === "/checkout/session-status"
		) {
			const sessionID =
			url.searchParams.get("session_id")?.trim() || "";

			if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionID)) {
				return json(
					{
						ok: false,
						error: "A valid Checkout Session ID is required" ,
					},
					400,
					{
						...corsHeaders,
						"Cache-Control": "no-store",
					},
				);
			}

			if (!env.STRIPE_SECRET_KEY) {
				return json(
					{
						ok: false,
						error: "Stripe is not configured",
					},
					500,
					{
						...corsHeaders,
						"Cache-Control": "no-store",
					},
				);
			}

			try {
				const stripe = new Stripe(env.STRIPE_SECRET_KEY.trim());

				const session = await stripe.checkout.sessions.retrieve(
					sessionID,
					{
						expand: ["line_items"],
					},
				);

				const items = (session.line_items?.data || []).map(
					(item) => ({
						description: item.description || "Merchandise",
						quantity: item.quantity || 0,
						amountTotal: item.amount_total || 0,
					}),
				);

				return json(
					{
						ok: true,
						sessionId: session.id,
						status: session.status,
						paymentStatus: session.payment_status,
						paid:
							session.status === "complete" &&
							session.payment_status === "paid",
						customerEmail:
							session.customer_details?.email ||
							session.customer_email ||
							null,
						amountTotal: session.amount_total || 0,
						currency: session.currency || "usd",
						items,
					},
					200,
					{
						...corsHeaders,
						"Cache-Control": "no-store",
					},
				);
			} catch (error) {
				console.error("Stripe session retrieval failed:", error);

				const status =
					error?.code === "resource_missing" ? 404 : 502;

				return json(
					{
						ok: false,
						error: "Could not verify Checkout Session",
					},
					status,
					{
						...corsHeaders,
						"Cache-Control": "no-store",
					},
				);
			}
		}

		if(request.method === "POST" && url.pathname === "/checkout/session") {
			let body;

			try {
				body = await request.json();
			} catch {
				return Response.json(
					{ ok: false, error: "Request body must be valid JSON" },
					{ status: 400, headers: corsHeaders },
				);
			}

			if (!Array.isArray(body.items) || body.items.length === 0) {
				return Response.json(
					{ok: false, error: "Cart must contain at least one item" },
					{ status: 400, headers: corsHeaders },
				);
			}

			if (body.items.length > 10) {
				return Response.json(
					{ ok: false, error: "Cart contains too many unique items" },
					{ status: 400, headers: corsHeaders },
				);
			}

			const requestedItems = new Map();

			for (const item of body.items) {
				const productId = String(item?.productId || "").trim();
				const variantId = String(item?.variantId || "").trim();
				const quantity = Number(item?.quantity);

				const valid =
				/^[a-f0-9]{24}$/i.test(productId) &&
				/^\d+$/.test(variantId) &&
				Number.isInteger(quantity) &&
				quantity >= 1 &&
				quantity <= 10;

				if (!valid) {
					return Response.json(
						{ ok: false, error: "Cart contains an invalid item" },
						{ status: 400, headers: corsHeaders },
					);
				}

				const key = productId + ":" + variantId;
				const existing = requestedItems.get(key);
				const combinedQuantity = (existing?.quantity || 0) + quantity;

				if (combinedQuantity > 10) {
					return Response.json(
						{ ok: false, error: "Maximum quanitaty is 10 per variant" },
						{ status: 400, headers: corsHeaders },
					);
				}

				requestedItems.set(key, {
					productId,
					variantId,
					quantity: combinedQuantity,
				});
			}

			const shopID = env.PRINTIFY_SHOP_ID?.trim();

			const productsUrl = 
			"https://api.printify.com/v1/shops/" +
			encodeURIComponent(shopID) +
			"/products.json";

			const printifyResponse = await globalThis.fetch(productsUrl, {
				headers: {
					Authorization: "Bearer " + env.PRINTIFY_API_TOKEN.trim(),
					"User-Agent": "HACYPAA Checkout API",
					"Content-Type": "application/json",
				},
			});

			if (!printifyResponse.ok) {
				return Response.json(
					{
						ok: false,
						error: "Could not verify merchandise with Printify",
						printifyStatus: printifyResponse.status,
					},
				);
			}

			const payload = await printifyResponse.json();
			const products = Array.isArray(payload) ? payload : payload.data || [];
			const productMap = new Map(
				products.map((product) => [String(product.id), product]),
			);

			const lineItems = [];

			for (const item of requestedItems.values()) {
				const product = productMap.get(item.productId);
				const variant = product?.variants?.find(
					(candidate) =>
						String(candidate.id) === item.variantId &&
					candidate.is_enabled &&
					candidate.is_available !== false,
				);

				if (!product || !variant) {
					return Response.json(
						{ ok: false, error: "A selected product or variant is unavailable" },
						{ status: 400, headers: corsHeaders },
					);
				}

				const trustedPrice = Number(variant.price);

				if (!Number.isInteger(trustedPrice) || trustedPrice <= 0) {
					return Response.json(
						{ ok: false, error: "Printify returned an invalid product price" },
						{ status: 502, headers: corsHeaders },
					);
				}

				lineItems.push({
					price_data: {
						currency: "usd",
						product_data: {
							name: product.title || "Selected variant",
							metadata: {
								printify_product_id: item.productId,
								printify_variant_id: item.variantId,
							},
						},
						unit_amount: trustedPrice,
					},
					quantity: item.quantity,
				});
			}

			const checkoutOrigin =
			origin && ALLOWED_ORIGINS.has(origin)
			? origin
			: "http://127.0.0.1:5500";

			try {
				const stripe = new Stripe(env.STRIPE_SECRET_KEY.trim());

				const session = await stripe.checkout.sessions.create({
					ui_mode: "embedded_page",
					mode: "payment",
					line_items: lineItems,
					customer_creation: "always",
					shipping_address_collection: {
						allowed_countries: ["US"],
					},
					phone_number_collection: {
						enabled: true,
					},
					return_url:
					checkoutOrigin +
					"/merch/?checkout=complete&session_id={CHECKOUT_SESSION_ID}",
					metadata: {
						source: "hacypaa_merch",
						printify_shop_id: shopID,
					},
				});

				return Response.json(
					{
						ok: true,
						clientSecret: session.client_secret,
					},
					{ headers: corsHeaders },
				);
			} catch (error) {
				console.error("Stripe sesson creation failed:", error);

				return Response.json(
					{
						ok: false,
						error: "Could not create Stripe Checkout Session",
						details: error instanceof Error ? error.message : String(error),
					},
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		return json({ error: "Not found"}, 404, corsHeaders);
	},

	async queue(batch, env) {
		for (const message of batch.messages) {
			const orderID = Number(message.body?.orderID);

			if (!Number.isInteger(orderID) || orderID <= 0) {
				console.error("Rejecting invalid fulfillment job", {
					messageId: message.id,
					body: message.body,
				});

				message.ack();
				continue;
			}

			const fulfillmentOrder = await loadFulfillmentOrder(
				env.ORDERS_DB,
				orderID,
			);

			if (
				!fulfillmentOrder ||
				fulfillmentOrder.items.length === 0
			) {
				console.error("Fulfillment order could not be loaded", {
					messageId: message.id,
					orderID,
				});

				message.retry();
				continue;
			}

			const { order } = fulfillmentOrder;

			if (
				order.printify_order_id ||
				["submitted", "fulfilled", "canceled"].includes(
					order.fulfillment_status,
				)
			) {
				console.log("Fulfillment job already completed", {
					messageId: message.id,
					orderID,
					fulfillmentStatus: order.fulfillment_status,
				});
				
				message.ack();
				continue;
			}

			const printifyToken =
				env.PRINTIFY_API_TOKEN?.trim();
			const printifyShopID =
				env.PRINTIFY_SHOP_ID?.trim();

			if (!printifyToken || !printifyShopID) {
				console.error("Printify is not configured", {
					messageId: message.id,
					orderID,
				});

				message.retry({ delaySeconds: 60 });
				continue;
			}

			const claimed = await claimOrderForFulfillment(
				env.ORDERS_DB,
				orderID,
			);

			if(!claimed) {
				console.log("Fulfillment order is already claimed", {
					messageId: message.id,
					orderID,
				});

				message.retry({ delaySeconds: 60 });
				continue;
			}

			try {
				const printifyPayload =
					buildPrintifyOrderPayload(fulfillmentOrder);
				
				const printifyOrder =
					await submitPrintifyOrder(
						printifyToken,
						printifyShopID,
						printifyPayload,
					);
				await recordPrintSubmission(
					env.ORDERS_DB,
					orderID,
					printifyOrder,
				);

				console.log("Submitted paid order to Printify", {
					messageId: message.id,
					orderID,
					printifyOrderID: printifyOrder.id,
					printifyStatus:
						printifyOrder.status || "pending",
					itemCount:
						fulfillmentOrder.items.length,
				});

				message.ack();
			} catch (error) {
				await recordFulfillmentFailure(
					env.ORDERS_DB,
					orderID,
					error,
				);

				console.error("Printify fulfillment failed", {
					messageId: message.id,
					orderID,
					message:
						error instanceof Error
							? error.message
							: String(error),
				});

				message.retry()
			}
		}
	},
};