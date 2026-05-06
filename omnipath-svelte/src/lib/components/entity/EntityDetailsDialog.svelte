<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import IdentifierBadge from '$lib/components/entity/IdentifierBadge.svelte';
	import MoleculeStructure from '$lib/components/entity/MoleculeStructure.svelte';
	import {
		getAllowedEntityDescriptions,
		getEntityDisplayName,
		getEntityIdentifiers,
		getEntitySmiles,
		getEntityTypeLabel,
		isSmallMoleculeEntity,
		type EntityLike
	} from '$lib/entities/display';

	interface Props {
		open: boolean;
		entity: EntityLike | null;
	}

	let { open = $bindable(false), entity }: Props = $props();

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
</script>

<Dialog bind:open>
	<DialogContent class="grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
		{#if entity}
			{@const detailSections = getDescriptionSections(entity)}
			{@const detailIdentifiers = getEntityIdentifiers(entity)}
			{@const detailSmiles = getEntitySmiles(entity)}
			{@const showMoleculeStructure = isSmallMoleculeEntity(entity) && detailSmiles}
			<DialogHeader>
				<DialogTitle>{getEntityDisplayName(entity)}</DialogTitle>
			</DialogHeader>
			<div class="min-h-0 space-y-5 overflow-y-auto pr-2 overscroll-contain">
				<div class="flex flex-wrap items-center gap-2">
					<Badge variant="secondary">{getEntityTypeLabel(entity)}</Badge>
					<IdentifierBadge identifierType={entity.canonicalIdentifierType} value={entity.canonicalIdentifier} variant="subtle" />
				</div>
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
				{#if detailIdentifiers.length > 0}
					<div class="space-y-2">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Identifiers
						</h3>
						<div class="flex flex-wrap gap-2">
							{#each detailIdentifiers as identifier}
								<IdentifierBadge identifierType={identifier.key} value={identifier.value} />
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</DialogContent>
</Dialog>
