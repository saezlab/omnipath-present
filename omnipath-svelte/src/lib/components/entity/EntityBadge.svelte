<script lang="ts">
  import { FlaskConical, Dna, CircleDot, Waypoints, Shapes, HelpCircle, Tags, AlertTriangle } from '@lucide/svelte';

  const entityTypeConfig: Record<string, { icon: typeof CircleDot; color: string; bgColor: string; label: string }> = {
    protein: { icon: CircleDot, color: 'text-blue-500', bgColor: 'from-blue-50/80 to-blue-100/80 dark:from-blue-900/30 dark:to-blue-800/30', label: 'Protein' },
    chemical: { icon: FlaskConical, color: 'text-green-500', bgColor: 'from-green-50/80 to-green-100/80 dark:from-green-900/30 dark:to-green-800/30', label: 'Chemical' },
    compound: { icon: FlaskConical, color: 'text-green-500', bgColor: 'from-green-50/80 to-green-100/80 dark:from-green-900/30 dark:to-green-800/30', label: 'Compound' },
    metabolite: { icon: FlaskConical, color: 'text-green-500', bgColor: 'from-green-50/80 to-green-100/80 dark:from-green-900/30 dark:to-green-800/30', label: 'Metabolite' },
    drug: { icon: FlaskConical, color: 'text-purple-500', bgColor: 'from-purple-50/80 to-purple-100/80 dark:from-purple-900/30 dark:to-purple-800/30', label: 'Drug' },
    lipid: { icon: FlaskConical, color: 'text-yellow-600', bgColor: 'from-yellow-50/80 to-yellow-100/80 dark:from-yellow-900/30 dark:to-yellow-800/30', label: 'Lipid' },
    gene: { icon: Dna, color: 'text-orange-500', bgColor: 'from-orange-50/80 to-orange-100/80 dark:from-orange-900/30 dark:to-orange-800/30', label: 'Gene' },
    complex: { icon: Shapes, color: 'text-indigo-500', bgColor: 'from-indigo-50/80 to-indigo-100/80 dark:from-indigo-900/30 dark:to-indigo-800/30', label: 'Complex' },
    pathway: { icon: Waypoints, color: 'text-cyan-500', bgColor: 'from-cyan-50/80 to-cyan-100/80 dark:from-cyan-900/30 dark:to-cyan-800/30', label: 'Pathway' },
    reaction: { icon: Waypoints, color: 'text-pink-500', bgColor: 'from-pink-50/80 to-pink-100/80 dark:from-pink-900/30 dark:to-pink-800/30', label: 'Reaction' },
    cvterm: { icon: Tags, color: 'text-amber-600', bgColor: 'from-amber-50/80 to-amber-100/80 dark:from-amber-900/30 dark:to-amber-800/30', label: 'CV Term' },
  };

  const defaultConfig = { icon: HelpCircle, color: 'text-slate-500', bgColor: 'from-slate-50/80 to-slate-100/80 dark:from-slate-800/80 dark:to-slate-900/80', label: 'Entity' };

  function getEntityTypeConfig(entityType: string | undefined) {
    if (!entityType) return defaultConfig;
    const typeName = entityType.includes(':') ? entityType.split(':')[0] : entityType;
    const normalized = typeName.toLowerCase().replace(/[\s_]/g, '');
    const normalizedAlias = normalized === 'smallmolecule' ? 'chemical' : normalized;
    return entityTypeConfig[normalizedAlias] || defaultConfig;
  }

  function isResolverBackedEntityType(entityType: string | undefined) {
    if (!entityType) return false;
    const typeName = entityType.includes(':') ? entityType.split(':')[0] : entityType;
    const normalized = typeName.toLowerCase().replace(/[\s_]/g, '');
    return normalized === 'protein'
      || normalized === 'chemical'
      || normalized === 'smallmolecule'
      || normalized === 'compound'
      || normalized === 'metabolite'
      || normalized === 'drug'
      || normalized === 'lipid';
  }

  interface Props {
    displayName: string;
    canonicalIdentifier: string;
    entityType?: string;
    resolutionStatus?: string | null;
  }

  let { displayName, canonicalIdentifier, entityType, resolutionStatus }: Props = $props();

  const typeConfig = $derived(getEntityTypeConfig(entityType));
  const TypeIcon = $derived(typeConfig.icon);
  const isDuplicate = $derived(displayName === canonicalIdentifier || /^\d+$/.test(canonicalIdentifier));
  const isUnresolved = $derived(
    isResolverBackedEntityType(entityType) && resolutionStatus?.trim().toLowerCase() === 'unresolved'
  );
  const rootClass = $derived(
    isUnresolved
      ? 'border-dashed border-amber-300/90 bg-amber-50/45 dark:border-amber-700/70 dark:bg-amber-950/20'
      : `bg-gradient-to-br ${typeConfig.bgColor} border-slate-200/60 dark:border-slate-700/60`
  );
</script>

<div class="relative">
  <div class="relative {rootClass} backdrop-blur-sm border rounded-md px-2 py-1 shadow-sm min-w-[80px] w-full">
    <div class="flex items-center gap-1.5 min-h-[32px]">
      <TypeIcon class="h-4 w-4 {typeConfig.color} shrink-0" />
      <div class="flex flex-col justify-center flex-1 min-w-0">
        <span class="truncate text-xs font-medium leading-tight {isUnresolved ? 'text-slate-700 dark:text-slate-200' : 'text-slate-900 dark:text-slate-100'}" title={`${typeConfig.label}: ${displayName || canonicalIdentifier}`}>
          {displayName || canonicalIdentifier}
        </span>
        {#if displayName && !isDuplicate}
          <span class="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate leading-none" title={canonicalIdentifier}>
            {canonicalIdentifier}
          </span>
        {/if}
      </div>
      {#if isUnresolved}
        <span class="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300/80 bg-amber-100/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-800 dark:border-amber-700/70 dark:bg-amber-950/60 dark:text-amber-200" title="Unresolved entity">
          <AlertTriangle class="size-3" />
          Unresolved
        </span>
      {/if}
    </div>
  </div>
</div>
