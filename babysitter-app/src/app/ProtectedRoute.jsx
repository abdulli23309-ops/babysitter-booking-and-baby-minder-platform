// ProtectedRoute — Phase F1
//
// DISCLAIMER (explicit, per Phase F1 spec):
// This is a UX-ONLY navigation guard. It prevents users from *navigating* to
// pages they should not see in the browser. It is NOT true backend security —
// the ASP.NET API remains fully callable by any client regardless of this
// wrapper. Real enforcement must be implemented server-side (deferred work).

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';

/**
 * @param {string[]} allowedRoles - lowercase role strings exactly as stored
 *   ('parent' | 'babysitter'). Omit to allow any authenticated session.
 */
export default function ProtectedRoute({ children, allowedRoles }) {
  const { userId, role, loading } = useAuth();
  const location = useLocation();

  // 1) Session loading — render a soft pulse spinner to confirm the shell is
  //    alive while the auth context resolves. No plain text.
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: '2.5px solid rgb(var(--edge-rgb) / 0.35)',
              borderTopColor: 'var(--color-primary)',
              animation: 'spin 0.7s linear infinite',
            }}
          />
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
            Loading…
          </span>
        </div>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // 2) No session — redirect to login, preserving the intended destination.
  if (userId === null || !role) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // 3) Wrong role — redirect to the correct role's safe default dashboard.
  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return <Navigate to={role === 'babysitter' ? '/babysitter-dashboard' : '/parent-dashboard'} replace />;
  }

  // 4) Correct role (or no role restriction) — render the page.
  return children;
}
