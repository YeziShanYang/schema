/**
 * The light/dark switch: a sun/moon icon button, in the sidebar footer when
 * signed in and in the top bar when signed out (the landing's and the app's).
 * It shows the moon in light mode and the sun in dark mode, chosen in CSS
 * from the class on <html>, so the prerendered landing paints the right icon
 * before it hydrates. The label follows the mode once mounted.
 */

import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { chooseMode, currentMode, subscribeMode } from '../themes'
import { MoonIcon, SunIcon } from './icons'

export function ThemeToggle({ className }: { className?: string }) {
  // The server snapshot is light: the prerendered landing has no stored choice to read.
  const dark = useSyncExternalStore(subscribeMode, () => currentMode() === 'dark', () => false)
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <button
      type="button"
      onClick={() => chooseMode(dark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className={cn(
        'press grid size-[30px] shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        className,
      )}
    >
      <MoonIcon size={16} className="dark:hidden" />
      <SunIcon size={16} className="hidden dark:block" />
    </button>
  )
}
