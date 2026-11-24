/**
 * The app's icon set: one SVG per icon, drawn with currentColor on a 24px
 * grid. `weight` is the rendered stroke in CSS pixels (1.5 next to
 * 400-weight text, 2 next to 500-600); the viewBox stroke is scaled so a
 * 16px icon still paints that width.
 */

import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'stroke'> & { size?: number; weight?: number }

function Svg({ size = 16, weight = 1.5, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={(weight * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const MarkIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <circle cx="4.5" cy="6" r="2" />
    <circle cx="19.5" cy="6" r="2" />
    <circle cx="12" cy="20.5" r="2" />
    <path d="M6.2 7.1 9.6 10.4M17.8 7.1l-3.4 3.3M12 15v3.5" />
  </Svg>
)
export const CheckIcon = (p: IconProps) => (
  <Svg weight={2.5} {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
)
export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
)
export const SparkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
  </Svg>
)
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)
export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
)
export const BookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z" />
    <path d="M5 16a4 4 0 0 1 4-4h10" />
  </Svg>
)
export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
)
export const DotIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
  </Svg>
)
