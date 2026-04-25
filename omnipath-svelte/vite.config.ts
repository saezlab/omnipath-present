import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const apiServiceUrl =
		env.API_SERVICE_URL || (env.DOCKERIZED === 'true' ? 'http://api-service:8081' : 'http://localhost:8081');

	return {
		plugins: [tailwindcss(), sveltekit()],
		server: {
			proxy: {
				// Match next-omnipath's fallback rewrite: browser `/api/*` goes to
				// FastAPI's upstream root, while FastAPI root_path keeps generated docs
				// URLs under the public `/api` prefix.
				'/api': {
					target: apiServiceUrl,
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/api/, '') || '/'
				}
			}
		}
	};
});
