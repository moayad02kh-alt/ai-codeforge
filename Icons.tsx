/** Inline SVG icon set — no external dependency, so the sandboxed preview works offline. */

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const base = (size: number, strokeWidth: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconPlay = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
  </svg>
);

export const IconStop = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconEye = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconSave = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </svg>
);

export const IconSettings = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

export const IconSparkle = ({ size = 16, className, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M12 2.6 14.1 8.6 20.1 10.7 14.1 12.8 12 18.8 9.9 12.8 3.9 10.7 9.9 8.6Z" />
    <path d="M18.5 15.5 19.4 18 21.9 18.9 19.4 19.8 18.5 22.3 17.6 19.8 15.1 18.9 17.6 18Z" />
  </svg>
);

export const IconSend = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M4 12 20 4l-3.5 8L20 20Z" />
    <path d="M4 12h12.5" />
  </svg>
);

export const IconFile = ({ size = 16, className, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
  </svg>
);

export const IconFolder = ({ size = 16, className, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);

export const IconChevron = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const IconPlus = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconX = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const IconCheck = ({ size = 16, className, strokeWidth = 2.4 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="m20 6-11 11-5-5" />
  </svg>
);

export const IconAlert = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

export const IconBug = ({ size = 16, className, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <rect x="8" y="6" width="8" height="14" rx="4" />
    <path d="M19 7l-3 2M5 7l3 2M3 13h5M16 13h5M19 20l-3-2M5 20l3-2M9 6a3 3 0 0 1 6 0" />
  </svg>
);

export const IconTerminal = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="m4 17 6-5-6-5M12 19h8" />
  </svg>
);

export const IconFlask = ({ size = 16, className, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M9 2v6.2L3.6 18a2 2 0 0 0 1.7 3h13.4a2 2 0 0 0 1.7-3L15 8.2V2" />
    <path d="M8 2h8M6.6 14h10.8" />
  </svg>
);

export const IconHistory = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3.5 2" />
  </svg>
);

export const IconRevert = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M3 7v6h6" />
    <path d="M3.5 13a9 9 0 1 0 2.1-6.4L3 9" />
  </svg>
);

export const IconRefresh = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

export const IconCode = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="m8 18-6-6 6-6M16 6l6 6-6 6" />
  </svg>
);

export const IconLayout = ({ size = 16, className, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M12 3v18" />
  </svg>
);

export const IconDesktop = ({ size = 16, className, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

export const IconTablet = ({ size = 16, className, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M12 18h.01" />
  </svg>
);

export const IconMobile = ({ size = 16, className, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <rect x="7" y="2" width="10" height="20" rx="2" />
    <path d="M12 18h.01" />
  </svg>
);

export const IconMenu = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

export const IconTrash = ({ size = 16, className, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const IconWrench = ({ size = 16, className, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.8 2.8 0 0 1-4-4Z" />
    <path d="M14.7 6.3 18.3 2.7a4 4 0 0 1 3 3l-3.6 3.6" />
  </svg>
);

export const IconBolt = ({ size = 16, className, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7Z" />
  </svg>
);

export const IconSearch = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconCopy = ({ size = 16, className, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const IconExternal = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M14 3h7v7M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

export const IconBrain = ({ size = 16, className, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M9.5 3a2.5 2.5 0 0 0-2.4 1.8A2.5 2.5 0 0 0 4.5 9a2.5 2.5 0 0 0 .6 4.4A2.5 2.5 0 0 0 7.5 17a2.5 2.5 0 0 0 4.5 1.4V3.5A2.5 2.5 0 0 0 9.5 3Z" />
    <path d="M14.5 3a2.5 2.5 0 0 1 2.4 1.8A2.5 2.5 0 0 1 19.5 9a2.5 2.5 0 0 1-.6 4.4A2.5 2.5 0 0 1 16.5 17a2.5 2.5 0 0 1-4.5 1.4" />
  </svg>
);

export const IconList = ({ size = 16, className, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);

export const IconShield = ({ size = 16, className, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size, strokeWidth)} className={className}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

/** Animated three-dot thinking indicator. */
export const Dots = () => (
  <span className="dots" aria-label="Thinking">
    <i /> <i /> <i />
  </span>
);

/** Language glyph shown next to files in the explorer. */
export function FileGlyph({ language }: { language: string }) {
  const map: Record<string, { label: string; color: string }> = {
    html: { label: '<>', color: '#e8814a' },
    css: { label: '#', color: '#4a9ee8' },
    javascript: { label: 'JS', color: '#e8c44a' },
    typescript: { label: 'TS', color: '#4a8fe8' },
    jsx: { label: 'JX', color: '#4ad3e8' },
    tsx: { label: 'TX', color: '#4ad3e8' },
    json: { label: '{}', color: '#a5a5a5' },
    markdown: { label: 'M', color: '#7c7aff' },
    text: { label: '·', color: '#646b7d' },
  };
  const g = map[language] ?? map.text;
  return (
    <span className="file-glyph mono" style={{ color: g.color }} aria-hidden="true">
      {g.label}
    </span>
  );
}
