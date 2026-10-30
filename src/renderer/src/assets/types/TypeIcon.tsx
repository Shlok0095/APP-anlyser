import type { TargetType } from '@shared/types/engine'

const stroke = '#cccccc'

interface TypeIconProps {
  type: TargetType
  className?: string
}

export function TypeIcon({ type, className = 'type-icon' }: TypeIconProps) {
  switch (type) {
    case 'android':
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="none"
            stroke={stroke}
            strokeWidth="1.6"
            d="M8 4 6.5 2M16 4l1.5-2M8 9h8M9 13v3M15 13v3"
          />
          <rect x="5" y="6" width="14" height="14" rx="3" fill="none" stroke={stroke} strokeWidth="1.6" />
        </svg>
      )
    case 'windows':
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path fill={stroke} d="M4 5.2 11 4.2v7.2H4Zm8-.9 8-1.2v9.3h-8Zm-8 8.5h7v7.3L4 18.9Zm8 .1h8v8.2l-8-1.1Z" />
        </svg>
      )
    case 'website':
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" fill="none" stroke={stroke} strokeWidth="1.6" />
          <path fill="none" stroke={stroke} strokeWidth="1.6" d="M4 12h16M12 4c2.5 2.4 3.8 5.2 3.8 8S14.5 17.6 12 20c-2.5-2.4-3.8-5.2-3.8-8S9.5 6.4 12 4Z" />
        </svg>
      )
    case 'tool':
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="none"
            stroke={stroke}
            strokeWidth="1.6"
            d="m14 7 3-3 3 3-3 3M4 20l8.5-8.5M15 10l3 3"
          />
          <path fill="none" stroke={stroke} strokeWidth="1.6" d="M8.5 15.5 5 19" />
        </svg>
      )
    case 'package':
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path fill="none" stroke={stroke} strokeWidth="1.6" d="M4 8 12 4l8 4v8l-8 4-8-4V8Z" />
          <path fill="none" stroke={stroke} strokeWidth="1.6" d="M12 12V4M4 8l8 4 8-4" />
        </svg>
      )
    case 'container':
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="8" width="5" height="8" fill="none" stroke={stroke} strokeWidth="1.6" />
          <rect x="9.5" y="8" width="5" height="8" fill="none" stroke={stroke} strokeWidth="1.6" />
          <rect x="16" y="8" width="5" height="8" fill="none" stroke={stroke} strokeWidth="1.6" />
          <path fill="none" stroke={stroke} strokeWidth="1.6" d="M2 18h20" />
        </svg>
      )
    default:
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path fill="none" stroke={stroke} strokeWidth="1.6" d="M6 7h9l3 3v9H6V7Z" />
          <path fill="none" stroke={stroke} strokeWidth="1.6" d="M9 7V5h6v2" />
        </svg>
      )
  }
}
