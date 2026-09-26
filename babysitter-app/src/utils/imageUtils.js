/**
 * Image URL resolution utility — Phase F-UI-11.
 * Resolves relative, type-prefixed, or GUID image paths to the backend Swagger endpoint:
 * GET /api/images/{type}/{filename}
 */
export function getAvatarUrl(pic, defaultType = 'Parents') {
  if (!pic || typeof pic !== 'string') return null;

  // Handle external or data URIs
  if (pic.startsWith('http://') || pic.startsWith('https://') || pic.startsWith('data:')) {
    return pic;
  }

  // Normalize Windows path backslashes: e.g. "Parents\pic.jpg" -> "Parents/pic.jpg"
  const clean = pic.replace(/\\/g, '/').replace(/^\/+/, '');

  const parts = clean.split('/');
  if (parts.length === 2) {
    const [type, filename] = parts;
    return `/api/images/${type}/${filename}`;
  }

  return `/api/images/${defaultType}/${clean}`;
}
