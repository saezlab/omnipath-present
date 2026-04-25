import type { ActionReturn } from "svelte/action";

interface InfiniteScrollOptions {
	onIntersect: () => void;
	root?: HTMLElement | null;
	rootMargin?: string;
	threshold?: number;
	enabled?: boolean;
}

export function infiniteScroll(node: HTMLElement, options: InfiniteScrollOptions): ActionReturn<InfiniteScrollOptions> {
	let observer: IntersectionObserver | null = null;
	let lastEnabled = options.enabled;
	let lastRoot = options.root;
	let lastRootMargin = options.rootMargin ?? "100px";
	let lastThreshold = options.threshold ?? 0;

	function createObserver(opts: InfiniteScrollOptions) {
		return new IntersectionObserver(
			(entries) => {
				if (!opts.enabled) return;
				const [entry] = entries;
				if (entry?.isIntersecting) {
					opts.onIntersect();
				}
			},
			{
				root: opts.root,
				rootMargin: opts.rootMargin ?? "100px",
				threshold: opts.threshold ?? 0,
			}
		);
	}

	function update(opts: InfiniteScrollOptions) {
		const needsRecreate =
			!observer ||
			opts.root !== lastRoot ||
			(opts.rootMargin ?? "100px") !== lastRootMargin ||
			(opts.threshold ?? 0) !== lastThreshold;

		lastEnabled = opts.enabled;
		lastRoot = opts.root;
		lastRootMargin = opts.rootMargin ?? "100px";
		lastThreshold = opts.threshold ?? 0;

		if (needsRecreate) {
			if (observer) {
				observer.disconnect();
			}
			observer = createObserver(opts);
			observer.observe(node);
		}
	}

	update(options);

	return {
		update,
		destroy() {
			if (observer) {
				observer.disconnect();
				observer = null;
			}
		},
	};
}
