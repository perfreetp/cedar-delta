import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function GrabIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 11.2V6.5a1.5 1.5 0 0 1 3 0v6.8c0 4.2-2.7 7.2-6.5 7.2-2.5 0-4.2-1.1-5.5-3.2L3.4 14a1.6 1.6 0 0 1 2.6-1.8L8 14.5" />
    </svg>
  );
}

export function RaiseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 19c2.5-1 4.2-3.2 8-3.2s5.5 2.2 8 3.2" />
      <path d="M12 15V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    </svg>
  );
}

export function FlattenIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 17h18" />
      <path d="M5 20h14" />
      <path d="M12 3v10" />
      <path d="m8 9 4 4 4-4" />
    </svg>
  );
}

export function SmoothIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 8c2.5-3 5-3 7.5 0s5 3 7.5 0c1-1.2 2-1.8 3-1.8" />
      <path d="M3 15c2.5-3 5-3 7.5 0s5 3 7.5 0c1-1.2 2-1.8 3-1.8" />
    </svg>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m7 4 13 8-13 8V4Z" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function CubeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" />
      <path d="m3 7 9 5 9-5" />
      <path d="M12 12v10" />
    </svg>
  );
}

export function SymmetryIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3v18" strokeDasharray="3 3" />
      <path d="M8 7c-2.5 1-4 3-4 5s1.5 4 4 5c1.5-2 2-3.2 2-5s-.5-3-2-5Z" />
      <path d="M16 7c2.5 1 4 3 4 5s-1.5 4-4 5c-1.5-2-2-3.2-2-5s.5-3 2-5Z" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
