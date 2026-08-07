// Shared entity type display utilities

// Map entity types to emojis for visual distinction
export const entityTypeEmojis: Record<string, string> = {
    'Chemical': '🧪',
    'Lipid': '💧',
    'Cv_term': '🏷️',
    'Protein': '🧬',
    'Gene': '🧬',
    'Mirna': '〰️',
    'Reaction': '⚗️',
    'Complex': '🧩',
    'Pathway': '🛣️',
    'Protein_family': '👥',
    'Physical_entity': '🧱',
    'DoubleStrandedDeoxyribonucleicAcid': '🧬',
    'ProteinComplex': '🧩',
    'RibonucleicAcid': '🧫',
    'Rna': '🧫',
    'Phenotype': '🩺',
    'MoleculeSet': '📦',
    'Stimulus': '🔦',
    'Degradation': '♻️',
    'Food': '🍎',
    'Dna': '🧬',
    'Transport': '🚚',
};

export type EntityTypeStyle = {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    chipClass: string;
};

export const defaultEntityTypeStyle: EntityTypeStyle = {
    label: 'Entity',
    color: 'text-slate-500',
    bgColor: 'from-slate-50/80 to-slate-100/80 dark:from-slate-800/80 dark:to-slate-900/80',
    borderColor: 'border-slate-200/60 dark:border-slate-700/60',
    chipClass: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/45 dark:text-slate-200',
};

const entityTypeStyles: Record<string, EntityTypeStyle> = {
    protein: {
        label: 'Protein',
        color: 'text-blue-500',
        bgColor: 'from-blue-50/80 to-blue-100/80 dark:from-blue-900/30 dark:to-blue-800/30',
        borderColor: 'border-blue-200/70 dark:border-blue-700/60',
        chipClass: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-700/60 dark:bg-blue-950/35 dark:text-blue-200',
    },
    chemical: {
        label: 'Chemical',
        color: 'text-green-500',
        bgColor: 'from-green-50/80 to-green-100/80 dark:from-green-900/30 dark:to-green-800/30',
        borderColor: 'border-green-200/70 dark:border-green-700/60',
        chipClass: 'border-green-200 bg-green-50 text-green-700 dark:border-green-700/60 dark:bg-green-950/35 dark:text-green-200',
    },
    compound: {
        label: 'Compound',
        color: 'text-green-500',
        bgColor: 'from-green-50/80 to-green-100/80 dark:from-green-900/30 dark:to-green-800/30',
        borderColor: 'border-green-200/70 dark:border-green-700/60',
        chipClass: 'border-green-200 bg-green-50 text-green-700 dark:border-green-700/60 dark:bg-green-950/35 dark:text-green-200',
    },
    metabolite: {
        label: 'Metabolite',
        color: 'text-green-500',
        bgColor: 'from-green-50/80 to-green-100/80 dark:from-green-900/30 dark:to-green-800/30',
        borderColor: 'border-green-200/70 dark:border-green-700/60',
        chipClass: 'border-green-200 bg-green-50 text-green-700 dark:border-green-700/60 dark:bg-green-950/35 dark:text-green-200',
    },
    drug: {
        label: 'Drug',
        color: 'text-purple-500',
        bgColor: 'from-purple-50/80 to-purple-100/80 dark:from-purple-900/30 dark:to-purple-800/30',
        borderColor: 'border-purple-200/70 dark:border-purple-700/60',
        chipClass: 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-700/60 dark:bg-purple-950/35 dark:text-purple-200',
    },
    lipid: {
        label: 'Lipid',
        color: 'text-yellow-600',
        bgColor: 'from-yellow-50/80 to-yellow-100/80 dark:from-yellow-900/30 dark:to-yellow-800/30',
        borderColor: 'border-yellow-200/80 dark:border-yellow-700/60',
        chipClass: 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-700/60 dark:bg-yellow-950/35 dark:text-yellow-200',
    },
    gene: {
        label: 'Gene',
        color: 'text-orange-500',
        bgColor: 'from-orange-50/80 to-orange-100/80 dark:from-orange-900/30 dark:to-orange-800/30',
        borderColor: 'border-orange-200/70 dark:border-orange-700/60',
        chipClass: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-700/60 dark:bg-orange-950/35 dark:text-orange-200',
    },
    complex: {
        label: 'Complex',
        color: 'text-indigo-500',
        bgColor: 'from-indigo-50/80 to-indigo-100/80 dark:from-indigo-900/30 dark:to-indigo-800/30',
        borderColor: 'border-indigo-200/70 dark:border-indigo-700/60',
        chipClass: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-700/60 dark:bg-indigo-950/35 dark:text-indigo-200',
    },
    pathway: {
        label: 'Pathway',
        color: 'text-cyan-500',
        bgColor: 'from-cyan-50/80 to-cyan-100/80 dark:from-cyan-900/30 dark:to-cyan-800/30',
        borderColor: 'border-cyan-200/70 dark:border-cyan-700/60',
        chipClass: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-700/60 dark:bg-cyan-950/35 dark:text-cyan-200',
    },
    reaction: {
        label: 'Reaction',
        color: 'text-pink-500',
        bgColor: 'from-pink-50/80 to-pink-100/80 dark:from-pink-900/30 dark:to-pink-800/30',
        borderColor: 'border-pink-200/70 dark:border-pink-700/60',
        chipClass: 'border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-700/60 dark:bg-pink-950/35 dark:text-pink-200',
    },
    cvterm: {
        label: 'CV Term',
        color: 'text-amber-600',
        bgColor: 'from-amber-50/80 to-amber-100/80 dark:from-amber-900/30 dark:to-amber-800/30',
        borderColor: 'border-amber-200/80 dark:border-amber-700/60',
        chipClass: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-200',
    },
};

// Normalized keys for case-insensitive matching
// Maps lowercase, no-space versions to the original keys
const normalizedEntityTypeMap: Record<string, string> = Object.keys(entityTypeEmojis).reduce((acc, key) => {
    // Create normalized key: lowercase, no spaces, no underscores
    const normalized = key.toLowerCase().replace(/[_\s]/g, '');
    acc[normalized] = key;
    return acc;
}, {} as Record<string, string>);

normalizedEntityTypeMap.smallmolecule = 'Chemical';

function normalizeEntityTypeKey(value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    const typeName = value.includes(':') ? value.split(':')[0] : value;
    const normalized = typeName.toLowerCase().replace(/[_\s]/g, '');
    if (normalized === 'smallmolecule') return 'chemical';
    return normalized;
}

/**
 * Get emoji for an entity type value.
 * Handles case-insensitive matching and various naming formats:
 * - "TypeName:ID" format (e.g., "Protein:12345")
 * - lowercase (e.g., "protein")
 * - space-separated (e.g., "physical entity")
 * - underscore-separated (e.g., "PHYSICAL_ENTITY")
 */
export function getEntityTypeEmoji(value: string): string | undefined {
    // Extract type name from "TypeName:ID" format if present
    const typeName = value.includes(':') ? value.split(':')[0] : value;

    // Try direct match first
    if (entityTypeEmojis[typeName]) {
        return entityTypeEmojis[typeName];
    }

    // Try normalized (case-insensitive, no spaces/underscores) match
    const normalized = typeName.toLowerCase().replace(/[_\s]/g, '');
    const originalKey = normalizedEntityTypeMap[normalized];
    if (originalKey) {
        return entityTypeEmojis[originalKey];
    }

    return undefined;
}

export function getEntityTypeStyle(value: string | null | undefined): EntityTypeStyle {
    const normalized = normalizeEntityTypeKey(value);
    return (normalized && entityTypeStyles[normalized]) || defaultEntityTypeStyle;
}
