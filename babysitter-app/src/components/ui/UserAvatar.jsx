import { useState } from 'react';
import { getAvatarUrl } from '../../utils/imageUtils';

/**
 * Universal UserAvatar Component — Phase F-UI-11.
 * Loads backend user images through getAvatarUrl.
 * Provides an Iron-Clad Fallback to the First Letter of the name on #FFF5EE / #E8622A
 * whenever the image is missing, 404s, or fails to load.
 */
export default function UserAvatar({
  src,
  name = 'User',
  size = 44,
  shape = 'circle', // 'circle' | 'rounded'
  type = 'Parents',
  className = '',
  style = {},
  alt,
}) {
  const [hasError, setHasError] = useState(false);

  const initial = (name?.trim()?.charAt(0) || 'U').toUpperCase();
  const imageUrl = !hasError ? getAvatarUrl(src, type) : null;
  const borderRadius = shape === 'circle' ? '50%' : '16px';
  const fontSize = typeof size === 'number' ? Math.max(12, Math.round(size * 0.42)) : '16px';

  if (!imageUrl || hasError) {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          borderRadius,
          background: 'var(--color-primary-tint)',
          color: 'var(--color-primary)',
          fontWeight: 700,
          fontSize,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          userSelect: 'none',
          boxSizing: 'border-box',
          ...style,
        }}
        aria-label={alt || name}
      >
        {initial}
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt || name}
      className={className}
      onError={() => setHasError(true)}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius,
        objectFit: 'cover',
        display: 'block',
        ...style,
      }}
    />
  );
}
