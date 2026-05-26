<script lang="ts">
	import { ExternalLink } from '@lucide/svelte';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import IdentifierBadge from '$lib/components/entity/IdentifierBadge.svelte';
	import MoleculeStructure from '$lib/components/entity/MoleculeStructure.svelte';
	import {
		getAllowedEntityDescriptions,
		getEntityDisplayName,
		getEntityIdentifiers,
		getEntityPrimaryIdentifierBadge,
		getEntityPublicId,
		getEntitySmiles,
		getEntityTypeLabel,
		getIdentifierTypeLabel,
		isSmallMoleculeEntity,
		type EntityLike
	} from '$lib/entities/display';

	interface Props {
		open: boolean;
		entity: EntityLike | null;
	}

	type AnnotationRow = {
		term: string;
		label: string;
		value: string;
		unit: string;
		source: string;
	};

	type AnnotationGroup = {
		label: string;
		values: string[];
		sources: string[];
	};

	let { open = $bindable(false), entity }: Props = $props();
	let hydratedEntity = $state<EntityLike | null>(null);
	let loadingDetails = $state(false);
	let detailsPublicId = $state<string | null>(null);
	let identifierLimit = $state(20);

	const IDENTIFIER_PAGE_SIZE = 20;

	$effect(() => {
		if (!open || !entity) {
			hydratedEntity = null;
			loadingDetails = false;
			detailsPublicId = null;
			identifierLimit = IDENTIFIER_PAGE_SIZE;
			return;
		}

		const publicId = getEntityPublicId(entity);
		if (detailsPublicId !== publicId) {
			detailsPublicId = publicId;
			identifierLimit = IDENTIFIER_PAGE_SIZE;
			hydratedEntity = null;
		}
		let cancelled = false;
		loadingDetails = true;

		(async () => {
			try {
				const url = new URL(`/app-api/entities/${encodeURIComponent(publicId)}`, window.location.origin);
				url.searchParams.set('identifierLimit', String(identifierLimit));
				const response = await fetch(url);
				if (!response.ok) return;
				const payload = (await response.json()) as { entity?: EntityLike | null };
				if (!cancelled) hydratedEntity = payload.entity ?? entity;
			} finally {
				if (!cancelled) loadingDetails = false;
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	const TAXONOMY_LABELS: Record<string, string> = {
		'9606': 'Human',
		'10090': 'Mouse',
		'10116': 'Rat',
		'7227': 'Fruit fly',
		'6239': 'C. elegans',
		'7955': 'Zebrafish'
	};

	function formatTaxonomyId(value: string | null | undefined) {
		if (!value) return null;
		return TAXONOMY_LABELS[value] ? `${TAXONOMY_LABELS[value]} (${value})` : value;
	}

	function stripHtml(value: string) {
		return value.replace(/<[^>]*>/g, '');
	}

	const DESCRIPTION_SECTION_LABELS = [
		'FUNCTION',
		'DISEASE',
		'SUBCELLULAR LOCATION',
		'PATHWAY',
		'CATALYTIC ACTIVITY',
		'COFACTOR',
		'ACTIVITY REGULATION',
		'TISSUE SPECIFICITY',
		'SIMILARITY',
		'DEVELOPMENTAL STAGE',
		'INDUCTION',
		'DOMAIN',
		'NOTE'
	] as const;

	const sectionMatchPattern = `(${DESCRIPTION_SECTION_LABELS.map((label) => label.replace(/\s+/g, '\\s+')).join('|')}):`;

	function cleanDescriptionText(value: string) {
		return stripHtml(value)
			.replace(/\{[^{}]*(?:ECO:|PubMed:|UniProtKB:)[^{}]*\}/g, '')
			.replace(/\[[^\]]*(?:MIM:|PubMed:|UniProtKB:)[^\]]*\]/g, '')
			.replace(/\((?:[^)]*(?:PubMed:|ECO:|UniProtKB|MIM:)[^)]*)\)/g, '')
			.replace(/\b(?:PubMed|ECO|UniProtKB|MIM):[^\s;,.)]*/g, '')
			.replace(/\s+/g, ' ')
			.replace(/\s+([;,.])/g, '$1')
			.trim();
	}

	function getDescriptionSections(entity: EntityLike) {
		const grouped = new Map<string, string[]>();

		for (const description of getAllowedEntityDescriptions(entity)) {
			const normalized = stripHtml(description);
			const matches = Array.from(normalized.matchAll(new RegExp(sectionMatchPattern, 'gi')));

			if (matches.length === 0) {
				const cleaned = cleanDescriptionText(normalized);
				if (cleaned) grouped.set('DESCRIPTION', [...(grouped.get('DESCRIPTION') || []), cleaned]);
				continue;
			}

			for (let index = 0; index < matches.length; index += 1) {
				const current = matches[index];
				const next = matches[index + 1];
				const label = (current[1] || 'DESCRIPTION').toUpperCase();
				const start = (current.index ?? 0) + current[0].length;
				const end = next ? next.index ?? normalized.length : normalized.length;
				const cleaned = cleanDescriptionText(normalized.slice(start, end).replace(/^\s*[;,-]\s*/, '').trim());
				if (!cleaned) continue;

				const existing = grouped.get(label) || [];
				if (!existing.includes(cleaned)) {
					grouped.set(label, [...existing, cleaned]);
				}
			}
		}

		const sectionOrder = [
			'FUNCTION',
			'DISEASE',
			'SUBCELLULAR LOCATION',
			...DESCRIPTION_SECTION_LABELS.filter((label) => !['FUNCTION', 'DISEASE', 'SUBCELLULAR LOCATION'].includes(label)),
			'DESCRIPTION'
		];

		return Array.from(grouped.entries())
			.sort(([a], [b]) => {
				const aIndex = sectionOrder.indexOf(a);
				const bIndex = sectionOrder.indexOf(b);
				return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
			})
			.map(([label, items]) => ({ label, items }));
	}

	function normalizeAnnotationRows(attributes: unknown[]): AnnotationRow[] {
		return attributes.flatMap((attribute) => {
			if (typeof attribute !== 'object' || attribute === null || !('term' in attribute)) return [];
			const row = attribute as { term?: unknown; value?: unknown; unit?: unknown; source?: unknown };
			const term = typeof row.term === 'string' ? row.term.trim() : '';
			const value = typeof row.value === 'string' ? row.value.trim() : '';
			const unit = typeof row.unit === 'string' ? row.unit.trim() : '';
			const source = typeof row.source === 'string' ? row.source.trim() : '';
			const label = getIdentifierTypeLabel(term);
			if (!term) return [];
			if (label.toLowerCase() === 'amino acid sequence') return [];
			return [{ term, label, value, unit, source }];
		});
	}

	function isPubmedAnnotation(row: AnnotationRow) {
		const termLabel = row.label.toLowerCase();
		return termLabel === 'pubmed' || termLabel === 'pmid' || termLabel.includes('pubmed');
	}

	function annotationSortRank(labelValue: string): number {
		const label = labelValue.toLowerCase();
		if (label === 'function') return 0;
		if (label === 'subcellular location') return 1;
		if (label === 'disease involvement' || label === 'disease') return 2;
		return 10;
	}

	function sortAnnotations(rows: AnnotationRow[]): AnnotationRow[] {
		return [...rows].sort((a, b) => annotationSortRank(a.label) - annotationSortRank(b.label) || a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
	}

	function groupAnnotationsByLabel(rows: AnnotationRow[]): AnnotationGroup[] {
		const groups = new Map<string, AnnotationGroup>();

		for (const row of rows) {
			const key = row.label.toLowerCase();
			const group = groups.get(key) ?? {
				label: row.label,
				values: [],
				sources: []
			};
			const value = row.value ? `${row.value}${row.unit ? ` ${row.unit}` : ''}` : '';
			if (value && !group.values.includes(value)) group.values.push(value);
			if (row.source && !group.sources.includes(row.source)) group.sources.push(row.source);
			groups.set(key, group);
		}

		return Array.from(groups.values()).sort(
			(a, b) => annotationSortRank(a.label) - annotationSortRank(b.label) || a.label.localeCompare(b.label)
		).map((group) => ({
			...group,
			values: [...group.values].sort((a, b) => a.localeCompare(b)),
			sources: [...group.sources].sort((a, b) => a.localeCompare(b))
		}));
	}

	function pubmedIdsFromAnnotations(rows: AnnotationRow[]): string[] {
		const ids = new Set<string>();
		for (const row of rows) {
			if (!isPubmedAnnotation(row)) continue;
			`${row.value} ${row.unit}`.match(/\b\d{4,9}\b/g)?.forEach((id) => ids.add(id));
		}
		return Array.from(ids).sort((a, b) => Number(a) - Number(b));
	}

	function sourcesForPubmedId(rows: AnnotationRow[], pubmedId: string): string[] {
		const sources = new Set<string>();
		for (const row of rows) {
			if (!isPubmedAnnotation(row) || !row.source) continue;
			const ids: string[] = `${row.value} ${row.unit}`.match(/\b\d{4,9}\b/g) ?? [];
			if (ids.includes(pubmedId)) sources.add(row.source);
		}
		return Array.from(sources).sort();
	}

	function getEntityIdentifierTotal(entity: EntityLike): number {
		const total = (entity as { identifiersTotal?: unknown }).identifiersTotal;
		const numericTotal = Number(total);
		return Number.isFinite(numericTotal) ? numericTotal : getEntityIdentifiers(entity).length;
	}

</script>

<Dialog bind:open>
	<DialogContent class="grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
		{#if entity}
			{@const detailEntity = hydratedEntity ?? entity}
			{@const detailSections = getDescriptionSections(detailEntity)}
			{@const detailIdentifiers = getEntityIdentifiers(detailEntity)}
			{@const visibleDetailIdentifiers = detailIdentifiers.slice(0, identifierLimit)}
			{@const detailIdentifierTotal = getEntityIdentifierTotal(detailEntity)}
			{@const detailSmiles = getEntitySmiles(detailEntity)}
			{@const primaryIdentifierBadge = getEntityPrimaryIdentifierBadge(detailEntity)}
			{@const detailTaxonomy = formatTaxonomyId(detailEntity.taxonomyId)}
			{@const showMoleculeStructure = isSmallMoleculeEntity(detailEntity) && detailSmiles}
			{@const detailAttributes = Array.isArray(detailEntity.entityAttributes) ? detailEntity.entityAttributes : []}
			{@const detailAnnotationRows = normalizeAnnotationRows(detailAttributes)}
			{@const detailPubmedIds = pubmedIdsFromAnnotations(detailAnnotationRows)}
			{@const detailNonPubmedAnnotations = groupAnnotationsByLabel(sortAnnotations(detailAnnotationRows.filter((row) => !isPubmedAnnotation(row))))}
			<DialogHeader>
				<DialogTitle>{getEntityDisplayName(detailEntity)}</DialogTitle>
			</DialogHeader>
			<div class="min-h-0 space-y-5 overflow-y-auto pr-2 overscroll-contain">
				<div class="flex flex-wrap items-center gap-2">
					<Badge variant="secondary">{getEntityTypeLabel(detailEntity)}</Badge>
					{#if detailTaxonomy}
						<Badge variant="outline">Taxon: {detailTaxonomy}</Badge>
					{/if}
					<IdentifierBadge identifierType={primaryIdentifierBadge.key} value={primaryIdentifierBadge.value} variant="subtle" />
				</div>
				{#if loadingDetails && !hydratedEntity}
					<p class="text-sm text-muted-foreground">Loading annotations...</p>
				{/if}
				{#if showMoleculeStructure}
					<div class="rounded-lg border bg-muted/10 p-4">
						<div class="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Molecule structure
						</div>
						<div class="flex justify-center">
							<MoleculeStructure smiles={detailSmiles} width={320} height={240} renderOnClick={false} />
						</div>
					</div>
				{/if}
				{#if detailSections.length > 0}
					<div class="max-h-72 space-y-4 overflow-y-auto">
						{#each detailSections as section}
							<section class="space-y-1.5">
								<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									{section.label}
								</h3>
								{#each section.items as item}
									<p class="text-sm leading-relaxed text-foreground">{item}</p>
								{/each}
							</section>
						{/each}
					</div>
				{/if}
				{#if detailNonPubmedAnnotations.length > 0}
					<div class="space-y-2">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Annotations
						</h3>
						<div class="grid min-w-0 gap-2">
							{#each detailNonPubmedAnnotations as annotation}
								<div class="min-w-0 max-w-full overflow-hidden rounded-lg border bg-muted/10 px-3 py-2 text-sm">
									<div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
										<div class="truncate font-medium text-foreground">{annotation.label}</div>
										{#if annotation.sources.length > 0}
											<div class="flex min-w-0 flex-wrap justify-end gap-1">
												{#each annotation.sources as source}
													<Badge variant="secondary" class="max-w-32 truncate text-[10px]">{source}</Badge>
												{/each}
											</div>
										{/if}
									</div>
									{#if annotation.values.length > 0}
										<div class="mt-2 max-h-32 max-w-full space-y-1 overflow-auto">
											{#each annotation.values as value}
												<div class="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{value}</div>
											{/each}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
				{#if detailPubmedIds.length > 0}
					<details class="group rounded-lg border bg-muted/5 px-3 py-2">
						<summary class="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Publications ({detailPubmedIds.length})
						</summary>
						<div class="mt-3 flex min-w-0 flex-wrap gap-1.5">
							{#each detailPubmedIds as pubmedId}
								{@const pubmedSources = sourcesForPubmedId(detailAnnotationRows, pubmedId)}
								<a
									href={`https://pubmed.ncbi.nlm.nih.gov/${pubmedId}/`}
									target="_blank"
									rel="noreferrer"
									class="inline-flex max-w-full items-center gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-muted"
									title={pubmedSources.length ? `Sources: ${pubmedSources.join(', ')}` : undefined}
								>
									PMID:{pubmedId}
									<ExternalLink class="size-3" />
									{#if pubmedSources.length > 0}
										<span class="max-w-24 truncate text-muted-foreground">{pubmedSources.join(', ')}</span>
									{/if}
								</a>
							{/each}
						</div>
					</details>
				{/if}
				{#if detailIdentifiers.length > 0}
					<details class="group rounded-lg border bg-muted/5 px-3 py-2">
						<summary class="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Identifiers ({detailIdentifierTotal})
						</summary>
						<div class="mt-3 flex flex-wrap gap-2">
							{#each visibleDetailIdentifiers as identifier}
								<IdentifierBadge identifierType={identifier.key} value={identifier.value} />
							{/each}
						</div>
						{#if detailIdentifierTotal > visibleDetailIdentifiers.length}
							<Button
								variant="ghost"
								size="sm"
								class="mt-3 w-full text-xs"
								disabled={loadingDetails}
								onclick={() => identifierLimit += IDENTIFIER_PAGE_SIZE}
							>
								{loadingDetails ? 'Loading...' : 'Load more'}
							</Button>
						{/if}
					</details>
				{/if}
			</div>
		{/if}
	</DialogContent>
</Dialog>
