import type { RequestHandler } from './$types';
import { API_SERVICE_URL } from '$lib/server/api-config';

const HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade'
]);

function buildUpstreamUrl(path: string | undefined, search: string) {
	const base = API_SERVICE_URL.endsWith('/') ? API_SERVICE_URL : `${API_SERVICE_URL}/`;
	const upstream = new URL(path ? path : '.', base);
	upstream.search = search;
	return upstream;
}

const proxy: RequestHandler = async ({ params, request, url }) => {
	// Browser-facing API routes live under /api, while FastAPI routes are served
	// at the upstream root. FastAPI is configured with root_path="/api", so its
	// docs page still points browsers back to /api/openapi.json and /api/*.
	const upstreamUrl = buildUpstreamUrl(params.path, url.search);

	const headers = new Headers(request.headers);
	for (const header of HOP_BY_HOP_HEADERS) {
		headers.delete(header);
	}
	headers.delete('host');

	const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
	const upstreamResponse = await fetch(upstreamUrl, {
		method: request.method,
		headers,
		body: hasBody ? await request.arrayBuffer() : undefined
	});

	const responseHeaders = new Headers(upstreamResponse.headers);
	for (const header of HOP_BY_HOP_HEADERS) {
		responseHeaders.delete(header);
	}

	return new Response(upstreamResponse.body, {
		status: upstreamResponse.status,
		statusText: upstreamResponse.statusText,
		headers: responseHeaders
	});
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const HEAD = proxy;
