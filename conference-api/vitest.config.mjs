import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.test.jsonc" },
			miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") } },
		}),
	],
}));
