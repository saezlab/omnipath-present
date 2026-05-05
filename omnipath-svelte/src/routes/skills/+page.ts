import resourceZipsContent from '$lib/data/skills/omnipath-resource-zips/SKILL.md?raw';
import subsetDownloadContent from '$lib/data/skills/omnipath-subset-download/SKILL.md?raw';

export const load = () => ({
	skills: [
		{
			name: 'omnipath-subset-download',
			title: 'OmniPath Subset Download',
			description:
				'Resolve entities and ontology terms, validate filters through the API, preview slices, and export parquet subsets.',
			href: '/skills/omnipath-subset-download/SKILL.md',
			content: subsetDownloadContent
		},
		{
			name: 'omnipath-resource-zips',
			title: 'OmniPath Resource Zips',
			description:
				'Download and reuse complete per-resource zip archives, unpack parquet files, and join graph/evidence tables locally.',
			href: '/skills/omnipath-resource-zips/SKILL.md',
			content: resourceZipsContent
		}
	]
});
