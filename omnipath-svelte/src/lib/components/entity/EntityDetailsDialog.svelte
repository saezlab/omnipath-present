<script lang="ts">
	import { ExternalLink, Network } from '@lucide/svelte';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import IdentifierBadge from '$lib/components/entity/IdentifierBadge.svelte';
	import MoleculeStructure from '$lib/components/entity/MoleculeStructure.svelte';
	import OntologyHierarchyBrowser from '$lib/components/explore/OntologyHierarchyBrowser.svelte';
	import {
		getAllowedEntityDescriptions,
		getEntityDisplayName,
		getEntityIdentifiers,
		getEntityPrimaryIdentifierBadge,
		getEntityPublicId,
		getEntitySmiles,
		getEntityTypeLabel,
		getIdentifierTypeLabel,
		isChemicalEntity,
		isCvTermEntity,
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

	type EntityIdentifierLike = {
		key: string;
		value: string;
	};

	type IdentifierRow = {
		section: 'Name' | 'Synonym' | 'Identifier';
		type: string;
		value: string;
		href: string | null;
	};

	type IdentifierGroup = {
		type: string;
		rows: IdentifierRow[];
	};

	type EntityOntologyHierarchyLike = {
		termId: string;
		ontologyPrefix: string | null;
		label: string | null;
		definition: string | null;
		ontologyId?: string | null;
		childCount?: number;
		parentCount?: number;
	};

	let { open = $bindable(false), entity }: Props = $props();
	let hydratedEntity = $state<EntityLike | null>(null);
	let loadingDetails = $state(false);
	let detailsPublicId = $state<string | null>(null);
	let identifierLimit = $state(20);

	const IDENTIFIER_PAGE_SIZE = 20;

	function normalizeIdentifierEntries(entityLike: EntityLike | null | undefined): EntityIdentifierLike[] {
		if (!entityLike) return [];
		const identifiers = new Map<string, EntityIdentifierLike>();
		for (const identifier of getEntityIdentifiers(entityLike)) {
			const key = identifier.key?.trim();
			const value = identifier.value?.trim();
			if (!key || !value) continue;
			identifiers.set(`${key.toLowerCase()}\u0000${value.toLowerCase()}`, { key, value });
		}
		return Array.from(identifiers.values());
	}

	function mergeEntityDetails(
		fallbackEntity: EntityLike,
		nextEntity: EntityLike | null | undefined,
		previousEntity: EntityLike | null,
	): EntityLike {
		const merged = {
			...fallbackEntity,
			...(previousEntity ?? {}),
			...(nextEntity ?? {}),
		} as EntityLike & {
			identifiers?: EntityIdentifierLike[];
			entityAttributes?: unknown;
			sources?: string[];
		};

		const identifiers = new Map<string, EntityIdentifierLike>();
		for (const entityLike of [fallbackEntity, previousEntity, nextEntity]) {
			for (const identifier of normalizeIdentifierEntries(entityLike)) {
				identifiers.set(`${identifier.key.toLowerCase()}\u0000${identifier.value.toLowerCase()}`, identifier);
			}
		}

		if (identifiers.size > 0) {
			merged.identifiers = Array.from(identifiers.values());
		}

		const nextAttributes = Array.isArray(nextEntity?.entityAttributes) ? nextEntity.entityAttributes : null;
		const previousAttributes = Array.isArray(previousEntity?.entityAttributes) ? previousEntity.entityAttributes : null;
		const fallbackAttributes = Array.isArray(fallbackEntity.entityAttributes) ? fallbackEntity.entityAttributes : null;
		merged.entityAttributes = nextAttributes ?? previousAttributes ?? fallbackAttributes ?? null;

		const sourceValues = [fallbackEntity, previousEntity, nextEntity].flatMap((entityLike) =>
			Array.isArray(entityLike?.sources) ? entityLike.sources.filter(Boolean) : [],
		);
		if (sourceValues.length > 0) {
			merged.sources = Array.from(new Set(sourceValues));
		}

		return merged;
	}

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
				if (!cancelled) hydratedEntity = mergeEntityDetails(entity, payload.entity, hydratedEntity);
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
		const rows = attributes.flatMap((attribute) => {
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

		const uniqueRows = new Map<string, AnnotationRow>();
		for (const row of rows) {
			uniqueRows.set(`${row.term.toLowerCase()}\u0000${row.value.toLowerCase()}\u0000${row.unit.toLowerCase()}\u0000${row.source.toLowerCase()}`, row);
		}
		return Array.from(uniqueRows.values());
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

	function formatAnnotationValue(row: AnnotationRow): string {
		const rawValue = row.value ? `${row.value}${row.unit ? ` ${row.unit}` : ''}` : '';
		if (!rawValue) return 'No value';

		const withoutPrefix = rawValue.replace(new RegExp(`^${row.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`, 'i'), '');
		const cleaned = cleanDescriptionText(withoutPrefix);
		return cleaned || rawValue;
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
		return Number.isFinite(numericTotal) ? numericTotal : normalizeIdentifierEntries(entity).length;
	}

	function identifierTypeText(identifier: EntityIdentifierLike): string {
		return `${identifier.key} ${getIdentifierTypeLabel(identifier.key)}`.toLowerCase().replace(/[_-]/g, ' ');
	}

	function identifierNameSection(identifier: EntityIdentifierLike): 'Name' | 'Synonym' | null {
		const text = identifierTypeText(identifier);
		if (text.includes('synonym')) return 'Synonym';
		if (text.includes('gene name primary')) return 'Name';
		if (text.includes('recommended name')) return 'Name';
		if (text.includes('entry name')) return 'Name';
		if (getIdentifierTypeLabel(identifier.key).toLowerCase() === 'name') return 'Name';
		return null;
	}

	function getIdentifierRows(identifiers: EntityIdentifierLike[]): IdentifierRow[] {
		const nameSynonymRows = new Map<string, IdentifierRow>();
		const identifierRows: IdentifierRow[] = [];

		for (const identifier of identifiers) {
			const section = identifierNameSection(identifier);
			const type = getIdentifierTypeLabel(identifier.key);
			if (section) {
				const key = `${section}\u0000${type.toLowerCase()}\u0000${identifier.value.toLowerCase()}`;
				nameSynonymRows.set(key, { section, type, value: identifier.value, href: null });
			} else {
				identifierRows.push({
					section: 'Identifier',
					type,
					value: identifier.value,
					href: identifiersOrgHref(identifier.key, identifier.value),
				});
			}
		}

		return [
			...Array.from(nameSynonymRows.values()).sort((a, b) =>
				a.section.localeCompare(b.section) || a.type.localeCompare(b.type) || a.value.localeCompare(b.value)
			),
			...identifierRows.sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value)),
		];
	}

	function identifierSectionRank(section: IdentifierRow['section']): number {
		if (section === 'Name') return 0;
		if (section === 'Synonym') return 1;
		return 2;
	}

	function getIdentifierGroups(rows: IdentifierRow[]): IdentifierGroup[] {
		const groups = new Map<string, IdentifierGroup>();
		for (const row of rows) {
			const group = groups.get(row.type) ?? { type: row.type, rows: [] };
			group.rows.push(row);
			groups.set(row.type, group);
		}

		return Array.from(groups.values())
			.map((group) => ({
				...group,
				rows: group.rows.sort((a, b) =>
					identifierSectionRank(a.section) - identifierSectionRank(b.section)
					|| a.value.localeCompare(b.value)
				),
			}))
			.sort((a, b) =>
				Math.min(...a.rows.map((row) => identifierSectionRank(row.section)))
				- Math.min(...b.rows.map((row) => identifierSectionRank(row.section)))
				|| a.type.localeCompare(b.type)
			);
	}

	function compactIdentifier(identifierType: string, value: string): string | null {
		const trimmedValue = value.trim();
		if (!trimmedValue) return null;
		if (/^[A-Za-z][A-Za-z0-9_.-]*:\S+$/.test(trimmedValue)) return trimmedValue;

		const text = `${identifierType} ${getIdentifierTypeLabel(identifierType)}`.toLowerCase();
		const namespace = text.includes('uniprot')
			? 'uniprot'
			: text.includes('chebi')
				? 'chebi'
				: text.includes('chembl')
					? 'chembl.compound'
					: text.includes('hmdb')
						? 'hmdb'
						: text.includes('pubchem')
							? 'pubchem.compound'
							: text.includes('ensembl')
								? 'ensembl'
								: text.includes('hgnc')
									? 'hgnc'
									: text.includes('entrez') || text.includes('ncbi gene')
										? 'ncbigene'
										: text.includes('taxonomy') || text.includes('tax id')
											? 'taxonomy'
											: text.includes('reactome')
												? 'reactome'
												: text.includes('interpro')
													? 'interpro'
													: null;

		return namespace ? `${namespace}:${trimmedValue}` : null;
	}

	function identifiersOrgHref(identifierType: string, value: string): string | null {
		const compactId = compactIdentifier(identifierType, value);
		if (!compactId) return null;
		const separatorIndex = compactId.indexOf(':');
		if (separatorIndex === -1) return `https://identifiers.org/${encodeURIComponent(compactId)}`;
		const namespace = compactId.slice(0, separatorIndex);
		const localId = compactId.slice(separatorIndex + 1);
		return `https://identifiers.org/${encodeURIComponent(namespace)}:${encodeURIComponent(localId)}`;
	}

	function getOntologyHierarchy(entityLike: EntityLike): EntityOntologyHierarchyLike | null {
		const hierarchy = (entityLike as { ontologyHierarchy?: unknown }).ontologyHierarchy;
		if (!hierarchy || typeof hierarchy !== 'object') {
			if (!isCvTermEntity(entityLike) || !entityLike.canonicalIdentifier.includes(':')) return null;
			return {
				termId: entityLike.canonicalIdentifier,
			ontologyPrefix: entityLike.canonicalIdentifier.split(':')[0] || null,
			label: getEntityDisplayName(entityLike),
			definition: null,
			ontologyId: null,
			childCount: 0,
			parentCount: 0,
		};
	}
		const row = hierarchy as Partial<EntityOntologyHierarchyLike>;
		if (!row.termId) return null;
		return {
			termId: row.termId,
			ontologyPrefix: row.ontologyPrefix ?? null,
			label: row.label ?? null,
			definition: row.definition ?? null,
			ontologyId: row.ontologyId ?? null,
			childCount: Number(row.childCount || 0),
			parentCount: Number(row.parentCount || 0),
		};
	}

</script>

<Dialog bind:open>
	<DialogContent class="grid max-h-[88vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-5xl">
		{#if entity}
			{@const detailEntity = hydratedEntity ?? entity}
			{@const detailSections = getDescriptionSections(detailEntity)}
			{@const detailIdentifiers = normalizeIdentifierEntries(detailEntity)}
			{@const detailIdentifierRows = getIdentifierRows(detailIdentifiers)}
			{@const detailIdentifierGroups = getIdentifierGroups(detailIdentifierRows)}
			{@const detailIdentifierTotal = getEntityIdentifierTotal(detailEntity)}
			{@const detailSmiles = getEntitySmiles(detailEntity)}
			{@const primaryIdentifierBadge = getEntityPrimaryIdentifierBadge(detailEntity)}
			{@const detailTaxonomy = formatTaxonomyId(detailEntity.taxonomyId)}
			{@const ontologyHierarchy = getOntologyHierarchy(detailEntity)}
			{@const showChemicalStructure = isChemicalEntity(detailEntity) && detailSmiles}
			{@const detailAttributes = Array.isArray(detailEntity.entityAttributes) ? detailEntity.entityAttributes : []}
			{@const detailAnnotationRows = normalizeAnnotationRows(detailAttributes)}
			{@const detailPubmedIds = pubmedIdsFromAnnotations(detailAnnotationRows)}
			{@const detailNonPubmedAnnotations = sortAnnotations(detailAnnotationRows.filter((row) => !isPubmedAnnotation(row)))}
			{@const showOntologyTabs = !!ontologyHierarchy}
			<DialogHeader>
				<DialogTitle>{getEntityDisplayName(detailEntity)}</DialogTitle>
			</DialogHeader>
			{#snippet detailContent()}
				<div class="min-h-0 space-y-5 overflow-y-auto pr-2 overscroll-contain">
				<div class="flex flex-wrap items-center gap-2">
					<Badge variant="secondary">{getEntityTypeLabel(detailEntity)}</Badge>
					{#if detailTaxonomy}
						<Badge variant="outline">Taxon: {detailTaxonomy}</Badge>
					{/if}
					<IdentifierBadge identifierType={primaryIdentifierBadge.key} value={primaryIdentifierBadge.value} variant="subtle" />
					{#if ontologyHierarchy}
						<Badge variant="outline" class="gap-1.5">
							<Network class="size-3.5" />
							{ontologyHierarchy.termId}
						</Badge>
					{/if}
				</div>
				{#if loadingDetails && !hydratedEntity}
					<p class="text-sm text-muted-foreground">Loading annotations...</p>
				{/if}
				{#if showChemicalStructure}
					<div class="rounded-lg border bg-muted/10 p-4">
						<div class="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Chemical structure
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
						<div class="max-h-72 overflow-auto rounded-lg border bg-background">
							<Table.Root>
								<Table.Header class="sticky top-0 z-10 bg-muted/80 backdrop-blur">
									<Table.Row>
										<Table.Head class="w-48">Annotation</Table.Head>
										<Table.Head>Value</Table.Head>
										<Table.Head class="w-36">Source</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each detailNonPubmedAnnotations as annotation}
										<Table.Row>
											<Table.Cell class="whitespace-normal align-top font-medium text-foreground">
												{annotation.label}
											</Table.Cell>
											<Table.Cell class="max-w-lg whitespace-normal break-words align-top text-foreground">
												{formatAnnotationValue(annotation)}
											</Table.Cell>
											<Table.Cell class="whitespace-normal align-top text-muted-foreground">
												{annotation.source || 'Unknown'}
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</div>
					</div>
				{/if}
				{#if detailPubmedIds.length > 0}
					<details class="group rounded-lg border bg-muted/5 px-3 py-2">
						<summary class="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Publications ({detailPubmedIds.length})
						</summary>
						<div class="mt-3 max-h-56 overflow-auto rounded-md border bg-background">
							<Table.Root>
								<Table.Header class="sticky top-0 z-10 bg-muted/80 backdrop-blur">
									<Table.Row>
										<Table.Head class="w-40">PubMed ID</Table.Head>
										<Table.Head>Sources</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each detailPubmedIds as pubmedId}
										{@const pubmedSources = sourcesForPubmedId(detailAnnotationRows, pubmedId)}
										<Table.Row>
											<Table.Cell class="align-top">
												<a
													href={`https://pubmed.ncbi.nlm.nih.gov/${pubmedId}/`}
													target="_blank"
													rel="noreferrer"
													class="inline-flex items-center gap-1 font-mono text-primary underline-offset-4 hover:underline"
												>
													PMID:{pubmedId}
													<ExternalLink class="size-3" />
												</a>
											</Table.Cell>
											<Table.Cell class="whitespace-normal break-words align-top text-muted-foreground">
												{pubmedSources.length ? pubmedSources.join(', ') : 'Unknown'}
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</div>
					</details>
				{/if}
				{#if detailIdentifierRows.length > 0 || detailIdentifierTotal > detailIdentifiers.length}
					<details class="group rounded-lg border bg-muted/5 px-3 py-2">
						<summary class="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Identifiers ({detailIdentifierTotal})
						</summary>
						{#if detailIdentifierRows.length > 0}
							<div class="mt-3 max-h-72 overflow-auto rounded-md border bg-background">
								<Table.Root>
									<Table.Header class="sticky top-0 z-10 bg-muted/80 backdrop-blur">
										<Table.Row>
											<Table.Head>Value</Table.Head>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{#each detailIdentifierGroups as group}
											<Table.Row class="bg-muted/45 hover:bg-muted/45">
												<Table.Cell class="whitespace-normal py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
													<div class="flex items-center justify-between gap-3">
														<span>{group.type}</span>
														<span class="font-normal tabular-nums">{group.rows.length}</span>
													</div>
												</Table.Cell>
											</Table.Row>
											{#each group.rows as row}
												<Table.Row>
												<Table.Cell class={`max-w-lg whitespace-normal align-top text-foreground ${row.section === 'Identifier' ? 'break-all font-mono' : 'break-words font-medium'}`}>
													{#if row.href}
														<a
															href={row.href}
															target="_blank"
															rel="noreferrer"
															class="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
														>
															{row.value}
															<ExternalLink class="size-3 shrink-0" />
														</a>
													{:else}
														{row.value}
													{/if}
												</Table.Cell>
											</Table.Row>
											{/each}
										{/each}
									</Table.Body>
								</Table.Root>
							</div>
						{/if}
						{#if detailIdentifierTotal > detailIdentifiers.length}
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
			{/snippet}

			{#if showOntologyTabs}
				<Tabs.Root value="ontology" class="min-h-0 overflow-hidden">
					<Tabs.List class="mb-2">
						<Tabs.Trigger value="ontology">
							<Network class="size-4" />
							Ontology
						</Tabs.Trigger>
						<Tabs.Trigger value="details">Details</Tabs.Trigger>
					</Tabs.List>
					<Tabs.Content value="ontology" class="min-h-0 overflow-auto">
						<OntologyHierarchyBrowser term={ontologyHierarchy} />
					</Tabs.Content>
					<Tabs.Content value="details" class="min-h-0 overflow-hidden">
						{@render detailContent()}
					</Tabs.Content>
				</Tabs.Root>
			{:else}
				{@render detailContent()}
			{/if}
		{/if}
	</DialogContent>
</Dialog>
