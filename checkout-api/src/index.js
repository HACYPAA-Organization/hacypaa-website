import Stripe from "stripe";

const ALLOWED_ORIGINS = new Set([
	"http://127.0.0.1:5500",
	"http://localhost:5500",
	"https://hacypaa.us",
	"https://www.hacypaa.us",
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
			const orderMetadata = [];

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
						},
						unit_amount: trustedPrice,
					},
					quantity: item.quantity,
				});

				orderMetadata.push(
					item.productId + ":" + item.variantId + ":" + item.quantity,
				);
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
						items: orderMetadata.join("|"),
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
};