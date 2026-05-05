import resourceZipsContent from './omnipath-resource-zips/SKILL.md?raw';
import subsetDownloadContent from './omnipath-subset-download/SKILL.md?raw';

export type Skill = {
	name: string;
	title: string;
	description: string;
	href: string;
	content: string;
};

export const skills: Skill[] = [
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
];

export function getSkill(name: string) {
	return skills.find((skill) => skill.name === name);
}
