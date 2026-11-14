import React from 'react';
import {
  Archive,
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
  Laptop,
  Monitor,
  Music,
  Package,
  Smartphone,
  Tablet,
} from 'lucide-react';
import type { DeviceOS, DeviceType } from '../types/instrop';
import { inferFileCategory } from '../utils/device';

export function InstropMark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        width="32"
        height="32"
        rx="8"
        className="fill-zinc-950 dark:fill-zinc-100"
      />
      <path
        d="M16 7.5V14.5"
        className="stroke-white dark:stroke-zinc-950"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M10.5 16.5L16 11L21.5 16.5"
        className="stroke-indigo-400 dark:stroke-indigo-600"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.5 22.5L16 19L19.5 22.5"
        className="stroke-white dark:stroke-zinc-950"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DeviceIcon({
  deviceType,
  os,
  className = 'w-4 h-4',
}: {
  deviceType: DeviceType;
  os?: DeviceOS;
  className?: string;
}) {
  if (deviceType === 'mobile') return <Smartphone className={className} />;
  if (deviceType === 'tablet') return <Tablet className={className} />;
  if (os === 'macOS' || os === 'Linux') return <Laptop className={className} />;
  return <Monitor className={className} />;
}

export function FileTypeIcon({
  name,
  mimeType,
  className = 'w-4 h-4',
}: {
  name: string;
  mimeType: string;
  className?: string;
}) {
  const cat = inferFileCategory(name, mimeType);
  switch (cat) {
    case 'image':
      return <ImageIcon className={className} />;
    case 'video':
      return <Film className={className} />;
    case 'audio':
      return <Music className={className} />;
    case 'archive':
      return <Archive className={className} />;
    case 'apk':
      return <Package className={className} />;
    case 'document':
      return <FileText className={className} />;
    default:
      return <FileIcon className={className} />;
  }
}
