<script lang="ts">
  import { FlaskConical, Dna, CircleDot, Waypoints, Shapes, HelpCircle } from '@lucide/svelte';

  const entityTypeConfig: Record<string, { icon: typeof CircleDot; color: string; bgColor: string; label: string }> = {
    protein: { icon: CircleDot, color: 'text-blue-500', bgColor: 'from-blue-50/80 to-blue-100/80 dark:from-blue-900/30 dark:to-blue-800/30', label: 'Protein' },
    smallmolecule: { icon: FlaskConical, color: 'text-green-500', bgColor: 'from-green-50/80 to-green-100/80 dark:from-green-900/30 dark:to-green-800/30', label: 'Small Molecule' },
    small_molecule: { icon: FlaskConical, color: 'text-green-500', bgColor: 'from-green-50/80 to-green-100/80 dark:from-green-900/30 dark:to-green-800/30', label: 'Small Molecule' },
    compound: { icon: FlaskConical, color: 'text-green-500', bgColor: 'from-green-50/80 to-green-100/80 dark:from-green-900/30 dark:to-green-800/30', label: 'Compound' },
    metabolite: { icon: FlaskConical, color: 'text-green-500', bgColor: 'from-green-50/80 to-green-100/80 dark:from-green-900/30 dark:to-green-800/30', label: 'Metabolite' },
    drug: { icon: FlaskConical, color: 'text-purple-500', bgColor: 'from-purple-50/80 to-purple-100/80 dark:from-purple-900/30 dark:to-purple-800/30', label: 'Drug' },
    lipid: { icon: FlaskConical, color: 'text-yellow-600', bgColor: 'from-yellow-50/80 to-yellow-100/80 dark:from-yellow-900/30 dark:to-yellow-800/30', label: 'Lipid' },
    gene: { icon: Dna, color: 'text-orange-500', bgColor: 'from-orange-50/80 to-orange-100/80 dark:from-orange-900/30 dark:to-orange-800/30', label: 'Gene' },
    complex: { icon: Shapes, color: 'text-indigo-500', bgColor: 'from-indigo-50/80 to-indigo-100/80 dark:from-indigo-900/30 dark:to-indigo-800/30', label: 'Complex' },
    pathway: { icon: Waypoints, color: 'text-cyan-500', bgColor: 'from-cyan-50/80 to-cyan-100/80 dark:from-cyan-900/30 dark:to-cyan-800/30', label: 'Pathway' },
    reaction: { icon: Waypoints, color: 'text-pink-500', bgColor: 'from-pink-50/80 to-pink-100/80 dark:from-pink-900/30 dark:to-pink-800/30', label: 'Reaction' },
  };

  const defaultConfig = { icon: HelpCircle, color: 'text-slate-500', bgColor: 'from-slate-50/80 to-slate-100/80 dark:from-slate-800/80 dark:to-slate-900/80', label: 'Entity' };

  function getEntityTypeConfig(entityType: string | undefined) {
    if (!entityType) return defaultConfig;
    const typeName = entityType.includes(':') ? entityType.split(':')[0] : entityType;
    const normalized = typeName.toLowerCase().replace(/[\s_]/g, '');
    return entityTypeConfig[normalized] || defaultConfig;
  }

  interface Props {
    displayName: string;
    canonicalIdentifier: string;
    entityType?: string;
  }

  let { displayName, canonicalIdentifier, entityType }: Props = $props();

  const typeConfig = $derived(getEntityTypeConfig(entityType));
  const TypeIcon = $derived(typeConfig.icon);
  const isDuplicate = $derived(displayName === canonicalIdentifier || /^\d+$/.test(canonicalIdentifier));
</script>

<div class="relative">
  <div class="relative bg-gradient-to-br {typeConfig.bgColor} backdrop-blur-sm border border-slate-200/60 dark:border-slate-700/60 rounded-md px-2 py-1 shadow-sm min-w-[80px] w-full">
    <div class="flex items-center gap-1.5 min-h-[32px]">
      <TypeIcon class="h-4 w-4 {typeConfig.color} shrink-0" />
      <div class="flex flex-col justify-center flex-1 min-w-0">
        <span class="text-xs font-medium text-slate-900 dark:text-slate-100 truncate leading-tight" title={displayName || canonicalIdentifier}>
          {displayName || canonicalIdentifier}
        </span>
        {#if displayName && !isDuplicate}
          <span class="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate leading-none" title={canonicalIdentifier}>
            {canonicalIdentifier}
          </span>
        {/if}
      </div>
    </div>
  </div>
</div>
