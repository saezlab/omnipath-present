export type HierarchyNode = {
  id: string;
  name?: string | null;
  ontologyId?: string | null;
  distance?: number;
  children?: HierarchyNode[];
  open?: boolean;
  childrenLoaded?: boolean;
  childrenLoading?: boolean;
  error?: string | null;
};

export type ApiTermInfo = {
  id: string;
  termId?: string;
  name?: string | null;
  label?: string | null;
  definition?: string | null;
  namespace?: string | null;
  ontologyId?: string | null;
  relationCount?: number;
};
