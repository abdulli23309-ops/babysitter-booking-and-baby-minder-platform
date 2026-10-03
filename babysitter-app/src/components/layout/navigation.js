// Phase F-UI-11 (Phase 1) — App chrome navigation source of truth.
//
// Sourced from the real route table in src/app/App.jsx: every entry below is a
// route that exists today. This module is pure presentation metadata for the
// sticky header title and the mobile menu drawer — it performs no data
// fetching and touches no backend contract.

export const DEFAULT_TITLE = 'Little Care';

/** Route path → human title. Longest matching prefix wins. */
const ROUTE_TITLES = {
  '/': 'Little Care',
  '/role': 'Choose Your Role',
  '/login': 'Sign In',
  '/register': 'Create Account',
  '/create-account': 'Create Account',

  '/parent-dashboard': 'Parent Dashboard',
  '/main-screen': 'Main Screen',
  '/search-babysitter': 'Find a Sitter',
  '/my-jobs': 'My Bookings',
  '/booking-status': 'Booking Status',
  '/child-profile': 'Children Profiles',
  '/set-child-profile': 'Register Child',
  '/update-child-profile': 'Update Child Profile',
  '/parent-profile': 'My Profile',
  '/parent-active-job': 'Active Session',
  '/parent-upcoming-job': 'Upcoming Booking',
  '/baby-monitoring': 'Baby Monitor',
  '/independent-monitoring': 'Independent Monitoring',
  '/cry-alert': 'Cry Alert',
  '/child-cry-alert': 'Cry Alert',
  '/parent-notifications': 'Notifications',
  '/job-end-review': 'Review & Rate',
  '/job-requested-success': 'Request Sent',
  '/babysitter-details': 'Caregiver Details',

  '/babysitter-dashboard': 'Caregiver Dashboard',
  '/job-request': 'Job Invitations',
  '/set-availability': 'Availability',
  '/babysitter-my-jobs': 'My Jobs',
  '/my-profile': 'My Profile',
  '/update-profile': 'Update Profile',
  '/active-job-details': 'Active Session',
  '/upcoming-job-details': 'Upcoming Job',
  '/completed-job-details': 'Job Summary',
  '/job-details': 'Job Details',
  '/earnings': 'Earnings',
  '/ratings': 'Ratings & Feedback',
  '/babysitter-notifications': 'Notifications',
  '/job-accepted-success': 'Booking Accepted',

  '/cry-detector': 'Cry Detector',
  '/support': 'Help & Support',
  '/job-parent-profile': 'Parent Profile',
  '/job-child-profile': 'Child Profile',
};

/**
 * Resolve a page title from a router pathname, tolerating dynamic segments
 * (e.g. '/booking-status/42' → 'Booking Status') and trailing slashes.
 *
 * @param {string} pathname
 * @returns {string}
 */
export function getRouteTitle(pathname) {
  if (!pathname) return DEFAULT_TITLE;

  const clean = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (ROUTE_TITLES[clean]) return ROUTE_TITLES[clean];

  const prefixMatch = Object.keys(ROUTE_TITLES)
    .filter((route) => route !== '/' && clean.startsWith(`${route}/`))
    .sort((a, b) => b.length - a.length)[0];

  return prefixMatch ? ROUTE_TITLES[prefixMatch] : DEFAULT_TITLE;
}

const GUEST_ITEMS = [
  { id: 'splash', icon: 'home', label: 'Home', route: '/' },
  { id: 'role', icon: 'sparkle', label: 'Choose Your Role', route: '/role' },
  { id: 'login', icon: 'login', label: 'Sign In', route: '/login' },
  { id: 'create-account', icon: 'userPlus', label: 'Create Account', route: '/create-account' },
];

const PARENT_ITEMS = [
  { id: 'parent-dashboard', icon: 'dashboard', label: 'Parent Dashboard', route: '/parent-dashboard' },
  { id: 'search-babysitter', icon: 'search', label: 'Find a Sitter', route: '/search-babysitter' },
  { id: 'my-jobs', icon: 'briefcase', label: 'My Bookings', route: '/my-jobs' },
  { id: 'child-profile', icon: 'child', label: 'Children Profiles', route: '/child-profile' },
  { id: 'baby-monitoring', icon: 'camera', label: 'Baby Monitor', route: '/baby-monitoring' },
  { id: 'independent-monitoring', icon: 'camera', label: 'Monitor Device Setup', route: '/independent-monitoring' },
  /* The 'Cry Detector' entry was REMOVED from the parent menu. Cry detection
     runs on the monitor device (Phone 2) and the server rejects a cry report
     from any account bearer, so a menu link here would only ever open a screen
     the parent cannot use. Viewing a resulting CryAlert is still available. */
  { id: 'parent-notifications', icon: 'bell', label: 'Notifications', route: '/parent-notifications' },
  { id: 'parent-profile', icon: 'user', label: 'My Profile', route: '/my-profile' },
  { id: 'support', icon: 'help', label: 'Help & Support', route: '/support' },
];

const BABYSITTER_ITEMS = [
  { id: 'babysitter-dashboard', icon: 'dashboard', label: 'Caregiver Dashboard', route: '/babysitter-dashboard' },
  { id: 'job-request', icon: 'briefcase', label: 'Job Invitations', route: '/job-request' },
  { id: 'babysitter-my-jobs', icon: 'briefcase', label: 'My Jobs', route: '/babysitter-my-jobs' },
  { id: 'set-availability', icon: 'calendar', label: 'Availability', route: '/set-availability' },
  { id: 'earnings', icon: 'wallet', label: 'Earnings', route: '/earnings' },
  { id: 'ratings', icon: 'star', label: 'Ratings & Feedback', route: '/ratings' },
  /* The 'Cry Detector' entry was REMOVED from the sitter menu. Detection is a
     monitor-device (Phone 2) capability and the server refuses a cry report from
     an account bearer, so this link could only open a screen the sitter cannot
     use. Receiving and answering a CryAlert is unchanged. */
  { id: 'babysitter-notifications', icon: 'bell', label: 'Notifications', route: '/babysitter-notifications' },
  { id: 'my-profile', icon: 'user', label: 'My Profile', route: '/my-profile' },
  { id: 'support', icon: 'help', label: 'Help & Support', route: '/support' },
];

/**
 * Role-aware drawer items. Falls back to the public items for guests, so the
 * menu is never empty on auth screens.
 *
 * @param {string|null|undefined} role — 'parent' | 'babysitter'
 * @param {boolean} isAuthenticated
 */
export function getNavItems(role, isAuthenticated) {
  if (!isAuthenticated) return GUEST_ITEMS;
  return role === 'babysitter' ? BABYSITTER_ITEMS : PARENT_ITEMS;
}
