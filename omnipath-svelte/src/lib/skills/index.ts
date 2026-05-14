import postgresApiContent from './omnipath-postgres-api/SKILL.md?raw';

export type Skill = {
	name: string;
	title: string;
	description: string;
	href: string;
	content: string;
};

export const skills: Skill[] = [
	{
		name: 'omnipath-postgres-api',
		title: 'OmniPath Postgres API',
		description:
			'Resolve entities, inspect scoped facets, search ontology terms, and query resource metadata through the Postgres-backed API service.',
		href: '/skills/omnipath-postgres-api/SKILL.md',
		content: postgresApiContent
	}
];

export function getSkill(name: string) {
	return skills.find((skill) => skill.name === name);
}
