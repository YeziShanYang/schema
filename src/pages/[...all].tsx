import { Link } from 'react-router-dom'
import { APP_DISPLAY_NAME } from '../constants'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center text-center px-4">
      <title>{`Not found · ${APP_DISPLAY_NAME}`}</title>
      <meta name="robots" content="noindex" />
      <h1 className="mb-2 font-mono text-4xl font-medium text-foreground">404</h1>
      <p className="text-muted-foreground mb-6">Page not found</p>
      <Link
        to="/"
        className="press rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[color-mix(in_oklab,var(--color-primary)_88%,black)]"
      >
        Back to {APP_DISPLAY_NAME}
      </Link>
    </div>
  )
}
