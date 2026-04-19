"use client"

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FlaskConical } from 'lucide-react';

type OpenChemLibModule = {
  Molecule: typeof import('openchemlib')['Molecule'];
};

interface MoleculeStructureProps {
  smiles: string;
  width?: number;
  height?: number;
  className?: string;
  canonicalId?: string;
  compoundName?: string;
  renderOnClick?: boolean;
}

const isBlackColor = (value: string | null) => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'black' ||
    normalized === '#000' ||
    normalized === '#000000' ||
    normalized === 'rgb(0,0,0)' ||
    normalized === 'rgb(0, 0, 0)' ||
    normalized === 'rgba(0,0,0,1)' ||
    normalized === 'rgba(0, 0, 0, 1)'
  );
};

export function MoleculeStructure({
  smiles,
  width = 250,
  height = 250,
  className = "",
  renderOnClick = true,
}: MoleculeStructureProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [OCL, setOCL] = useState<OpenChemLibModule | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasRendered, setHasRendered] = useState(false);
  const [shouldRender, setShouldRender] = useState(!renderOnClick);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    const element = containerRef.current;
    if (!element || hasRendered || !shouldRender) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        setIsVisible(true);
        observer.disconnect();
      },
      { rootMargin: '300px 0px' }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasRendered, shouldRender]);

  useEffect(() => {
    if (!shouldRender || !isVisible || OCL) return;
    let mounted = true;

    const loadOCL = async () => {
      try {
        setError(null);
        const { Molecule } = await import('openchemlib');
        if (!mounted) return;
        setOCL({ Molecule });
      } catch (err) {
        if (!mounted) return;
        console.error('Failed to load OpenChemLib:', err);
        setError('Failed to load molecular visualization library');
      }
    };

    loadOCL();

    return () => {
      mounted = false;
    };
  }, [isVisible, OCL]);

  useEffect(() => {
    if (!shouldRender || !isVisible || !OCL || !smiles || !containerRef.current) return;

    const container = containerRef.current;
    let cancelled = false;
    let idleHandle: number | ReturnType<typeof setTimeout> | null = null;

    const renderMolecule = () => {
      if (cancelled) return;

      try {
        setError(null);
        container.innerHTML = '';

        const molecule = OCL.Molecule.fromSmiles(smiles);
        if (!molecule) {
          setError('Invalid molecular structure');
          return;
        }

        const svgString = molecule.toSVG(width, height);
        if (!svgString) {
          setError('Failed to generate structure visualization');
          return;
        }

        if (cancelled) return;
        container.innerHTML = svgString;

        const svgElement = container.querySelector('svg');
        if (svgElement) {
          svgElement.style.width = '100%';
          svgElement.style.height = '100%';
          svgElement.style.display = 'block';

          if (isDark) {
            const darkModeStroke = '#E5E7EB';
            const nodes = svgElement.querySelectorAll('*');
            nodes.forEach((node) => {
              const stroke = node.getAttribute('stroke');
              const fill = node.getAttribute('fill');

              if (isBlackColor(stroke)) {
                node.setAttribute('stroke', darkModeStroke);
              }
              if (isBlackColor(fill)) {
                node.setAttribute('fill', darkModeStroke);
              }
            });
          }
        }

        setHasRendered(true);
      } catch (err) {
        console.error('Error rendering molecule:', err);
        setError('Failed to render molecular structure');
      }
    };

    const windowWithIdleCallbacks = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (windowWithIdleCallbacks.requestIdleCallback) {
      idleHandle = windowWithIdleCallbacks.requestIdleCallback(() => renderMolecule(), { timeout: 500 });
    } else {
      idleHandle = globalThis.setTimeout(renderMolecule, 0);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== null) {
        if (windowWithIdleCallbacks.cancelIdleCallback && typeof idleHandle === 'number') {
          windowWithIdleCallbacks.cancelIdleCallback(idleHandle);
        } else {
          globalThis.clearTimeout(idleHandle);
        }
      }
    };
  }, [shouldRender, isVisible, OCL, smiles, width, height, isDark]);

  const structureDisplay = (() => {
    const baseClassName = cn('shrink-0', className);
    const dimensions = { width, height };

    if (error) {
      return (
        <Alert className={cn('flex items-center justify-center text-center', baseClassName)} style={dimensions}>
          <AlertDescription className="text-sm">
            {error}
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <div
        ref={containerRef}
        className={cn(
          'rounded-md border bg-muted/20',
          !hasRendered && !error && shouldRender ? 'animate-pulse' : '',
          'relative overflow-hidden',
          baseClassName
        )}
        style={dimensions}
      >
        {!shouldRender ? (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/10">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() => setShouldRender(true)}
            >
              <FlaskConical className="mr-1.5 h-4 w-4" />
              Show structure
            </Button>
          </div>
        ) : null}
      </div>
    );
  })();

  return (
    <div className="flex flex-col items-center" style={width ? { width } : undefined}>
      {structureDisplay}
    </div>
  );
}
