import { useNavigate } from 'react-router-dom';
import styles from './role-selection.module.css';

const RoleSelection = () => {
  const navigate = useNavigate();

  const selectRole = (role) => {
    navigate(role === 'parent' ? '/create-account' : '/register');
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Choose Your Role</h2>
          <p className={styles.welcome}>Welcome to Little Care</p>
        </div>

        <div
          className={styles.card}
          role="button"
          tabIndex={0}
          onClick={() => selectRole('parent')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectRole('parent');
            }
          }}
        >
          <div className={styles.emoji} aria-hidden="true">👨‍👩‍👧</div>
          <div>
            <h3 className={styles.cardTitle}>Parent</h3>
            <p className={styles.cardText}>Find trusted care for your child</p>
          </div>
        </div>

        <div
          className={styles.card}
          role="button"
          tabIndex={0}
          onClick={() => selectRole('babysitter')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectRole('babysitter');
            }
          }}
        >
          <div className={styles.emoji} aria-hidden="true">👶</div>
          <div>
            <h3 className={styles.cardTitle}>Baby Sitter</h3>
            <p className={styles.cardText}>Offer your services to families</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoleSelection;