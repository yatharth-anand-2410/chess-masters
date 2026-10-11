/**
 * Hand-inlined 24px stroke icons.
 *
 * The project intentionally ships no icon library, so these mirror the Lucide
 * geometry (24x24 viewBox, 2px stroke, round caps and joins) while inheriting
 * `currentColor`. Keep them in sync with the visual language rather than
 * reaching for a dependency.
 */

type IconProps = {
  className?: string;
};

const BASE = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function TargetIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function PawnIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M12 2a4 4 0 0 0-2.5 7.1A5 5 0 0 0 7 13.5A4.5 4.5 0 0 0 9 22h6a4.5 4.5 0 0 0 2-8.5a5 5 0 0 0-2.5-4.4A4 4 0 0 0 12 2z" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

export function RotateIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function BulbIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.8.8 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}

export function ExternalLinkIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function SwordsIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <line x1="13" x2="19" y1="19" y2="13" />
      <line x1="16" x2="20" y1="16" y2="20" />
      <line x1="19" x2="21" y1="21" y2="19" />
      <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
      <line x1="5" x2="9" y1="14" y2="18" />
      <line x1="7" x2="4" y1="17" y2="20" />
      <line x1="3" x2="5" y1="19" y2="21" />
    </svg>
  );
}

export function SparkIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M9.94 4.6a.6.6 0 0 1 1.12 0l1.02 2.9a.6.6 0 0 0 .42.42l2.9 1.02a.6.6 0 0 1 0 1.12l-2.9 1.02a.6.6 0 0 0-.42.42l-1.02 2.9a.6.6 0 0 1-1.12 0l-1.02-2.9a.6.6 0 0 0-.42-.42l-2.9-1.02a.6.6 0 0 1 0-1.12l2.9-1.02a.6.6 0 0 0 .42-.42z" />
      <path d="M18 4v4" />
      <path d="M16 6h4" />
      <path d="M18 16v3" />
      <path d="M16.5 17.5h3" />
    </svg>
  );
}
