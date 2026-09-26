import { useNavigate } from 'react-router-dom';
import styles from './back-button.module.css';

/**
 * Universal Circular Back Button — Phase F-UI-10
 * 40px circular white button with drop shadow and dark thick stroke caret left (<).
 * Defaults to navigate(-1) history traversal.
 */
export default function BackButton({ onClick, className = '', style, ariaLabel = 'Go back' }) {
  const navigate = useNavigate();

  const handleClick = (e) => {
    if (onClick) {
      onClick(e);
    } else {
      navigate(-1);
    }
  };

  return (
    <button
      type="button"
      className={`${styles.backBtn} ${className}`}
      style={style}
      onClick={handleClick}
      aria-label={ariaLabel}
    >
      <svg
        className={styles.icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  );
}
