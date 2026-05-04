export type HierarchyNode = {
  id: string;
  name?: string | null;
  distance?: number;
  children?: HierarchyNode[];
  open?: boolean;
  childrenLoaded?: boolean;
  childrenLoading?: boolean;
  error?: string | null;
};

export type ApiTermInfo = {
  id: string;
  name?: string | null;
  definition?: string | null;
  namespace?: string | null;
};
