/**
 * Gated routes. Any file under src/pages/(app)/(protected)/ requires sign-in.
 * The `(protected)` folder is a Generouted route group — parentheses mean
 * it doesn't appear in the URL. For a dynamic page that does NOT require
 * sign-in, put it directly under src/pages/(app)/; for a static page, put it
 * at the top level of src/pages/.
 *
 * Children may call data hooks like `useUser()` safely because the parent
 * (app)/_layout.tsx mounts <RecordProvider> above this layout.
 *
 * The `fallback` keeps signed-out visitors inside the app's own chrome
 * (without it, AuthGate shows the SDK's full-screen, non-dismissible
 * overlay). The sign-in overlay opens on demand and can be dismissed.
 * A link with `?signin=1` (the landing page's sign-in links) opens it right
 * away; OAuth sign-in returns to /home, and the flag is dropped once signed in.
 */

import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AuthGate, AuthOverlay, useAuth } from 'deepspace'
import { Button } from '@/components/ui'
import { arxivSlug } from '../../../lib/arxiv'
import { DEMO_ARXIV_ID } from '../../../constants'

const SIGN_IN_PARAM = 'signin'

export default function ProtectedLayout() {
  const { isSignedIn } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const wantsSignIn = new URLSearchParams(location.search).has(SIGN_IN_PARAM)

  useEffect(() => {
    if (!isSignedIn || !wantsSignIn) return
    const params = new URLSearchParams(location.search)
    params.delete(SIGN_IN_PARAM)
    const search = params.toString()
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })
  }, [isSignedIn, wantsSignIn, location.pathname, location.search, navigate])

  return (
    <AuthGate fallback={<SignedOutPanel openAtStart={wantsSignIn} />}>
      <Outlet />
    </AuthGate>
  )
}

function SignedOutPanel({ openAtStart }: { openAtStart: boolean }) {
  const [showAuthModal, setShowAuthModal] = useState(openAtStart)

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-20" data-testid="signed-out-panel">
      <div className="surface w-full max-w-sm p-7 text-center">
        <h1 className="text-lg font-semibold text-foreground">Sign in to continue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Workspaces, papers and what you know are saved to your account.
        </p>
        <Button className="mt-6 w-full" onClick={() => setShowAuthModal(true)} data-testid="signed-out-sign-in">
          Sign in
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">
          Or open the{' '}
          <Link to={`/p/${arxivSlug(DEMO_ARXIV_ID)}`} className="text-primary hover:underline" data-testid="signed-out-demo-link">
            demo paper
          </Link>{' '}
          without an account.
        </p>
      </div>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}
