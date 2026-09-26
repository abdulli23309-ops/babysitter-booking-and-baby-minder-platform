import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import UserAvatar from '../../components/ui/UserAvatar';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { apiGet } from '../../services/apiClient';
import styles from './earnings.module.css';

const PAGE_SIZE = 5;

/** Newest first: JobDate DESC, then Job_ID DESC. Never mutates the input. */
const sortByDateDesc = (list) =>
  [...list].sort((a, b) => {
    const da = a.JobDate ? new Date(a.JobDate).getTime() : 0;
    const db = b.JobDate ? new Date(b.JobDate).getTime() : 0;
    if (db !== da) return db - da;
    return (b.Job_ID ?? 0) - (a.Job_ID ?? 0);
  });

const formatPaymentDate = (value) => {
  if (!value) return 'Completed session';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function Earnings() {
  const { userId } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [balance, setBalance] = useState(0);
  const [completedJobs, setCompletedJobs] = useState(0);
  const [totalHours, setTotalHours] = useState(0);
  const [payments, setPayments] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(() => Boolean(userId));
  const [refreshing, setRefreshing] = useState(false);

  // Phase 5.2: NO mock fallbacks. Aggregates come from the earnings endpoint;
  // the payment rows come from the sitter's REAL completed jobs, because the
  // earnings DTO exposes only {parentName, amount, date} — it carries neither
  // Job_ID (needed for navigation) nor the parent picture (needed for the avatar).
  const fetchEarnings = useCallback(async () => {
    if (!userId) return;

    try {
      const [earnings, jobs] = await Promise.all([
        apiGet(`/babysitter/earnings/${userId}`),
        apiGet(`/jobs/sitter/${userId}`),
      ]);

      setBalance(Number(earnings?.totalEarnings ?? 0));
      setCompletedJobs(Number(earnings?.completedJobs ?? 0));
      setTotalHours(Number(earnings?.totalHours ?? 0));

      const completed = (Array.isArray(jobs) ? jobs : []).filter(
        (j) => String(j?.Status ?? '').toLowerCase() === 'completed'
      );

      setPayments(
        sortByDateDesc(completed).map((j) => ({
          id: j.Job_ID ?? j.jobId,
          name: j.ParentName || 'Parent',
          date: formatPaymentDate(j.JobDate),
          amount: Number(j.Payment ?? 0),
          avatar: j.ParentPic ?? null,
          status: 'PAID',
        }))
      );
      setPage(1);
    } catch (err) {
      // Surface the failure instead of silently rendering mock data.
      setPayments([]);
      toast.error(err?.message || 'Could not load your earnings.');
    }
  }, [userId, toast]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!userId) {
        setLoading(false);
        return;
      }
      await fetchEarnings();
      if (!ignore) {
        setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [userId, fetchEarnings]);

  const handleRefresh = async () => {
    toast.info('Refreshing earnings...');
    setRefreshing(true);
    await fetchEarnings();
    setTimeout(() => setRefreshing(false), 500);
  };

  // Local pagination over the already-sorted list.
  const totalPages = Math.max(1, Math.ceil(payments.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pagePayments = payments.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className={styles.earningsContainer}>
      {/* Top Bar: Frame 14 with BackButton, centered title, and Refresh button */}
      <header className={styles.topBar}>
        <BackButton />
        <h1 className={styles.pageTitle}>Earnings</h1>
        <button
          type="button"
          className={styles.moreBtn}
          onClick={handleRefresh}
          aria-label="Refresh earnings"
          title="Refresh"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transition: 'transform 0.5s ease',
              transform: refreshing ? 'rotate(360deg)' : 'none',
            }}
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </header>

      {loading ? (
        <div style={{ padding: '40px 0', display: 'flex', justifyContent: 'center' }}>
          <LoadingSpinner size="lg" label="Calculating your earnings..." />
        </div>
      ) : (
        <>
          {/* Available Balance Hero Card (Frame 14) */}
          <section className={styles.balanceCard} aria-label="Available Balance">
            <div className={styles.cardAccentCircle} />
            <span className={styles.balanceLabel}>Available Balance</span>
            <h2 className={styles.balanceAmount}>PKR {balance.toLocaleString()}</h2>
            <span className={styles.totalEarningsLink}>
              Total Earnings <span>↗</span>
            </span>
          </section>

          {/* Metrics Pills: Completed 12 Jobs / Total Hours 48 hrs */}
          <section className={styles.metricsGrid} aria-label="Work Metrics">
            <div className={styles.metricPill}>
              <span className={styles.metricLabel}>COMPLETED</span>
              <span className={styles.metricValue}>{completedJobs} Jobs</span>
            </div>
            <div className={styles.metricPill}>
              <span className={styles.metricLabel}>TOTAL HOURS</span>
              <span className={styles.metricValue}>{totalHours} hrs</span>
            </div>
          </section>

          {/* Recent Payments Section — real completed jobs, newest first */}
          <section className={styles.historySection} aria-label="Recent Payments">
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>Recent Payments</h3>
            </div>

            {payments.length === 0 ? (
              <EmptyState
                icon="💳"
                title="No payments yet"
                description="Completed sessions will appear here once they are paid."
              />
            ) : (
              <>
                <div className={styles.paymentsList}>
                  {pagePayments.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={styles.paymentCard}
                      style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
                      onClick={() => {
                        if (p.id != null) navigate(`/completed-job-details/${p.id}`);
                      }}
                    >
                      <div className={styles.paymentLeft}>
                        <UserAvatar
                          src={p.avatar}
                          name={p.name ?? 'Parent'}
                          size={48}
                          type="Parents"
                        />
                        <div>
                          <h4 className={styles.parentName}>{p.name}</h4>
                          <p className={styles.paymentDate}>{p.date}</p>
                        </div>
                      </div>
                      <div className={styles.paymentRight}>
                        <span className={styles.paymentAmount}>
                          PKR {Number(p.amount).toLocaleString()}
                        </span>
                        <span className={styles.paidBadge}>{p.status}</span>
                      </div>
                    </button>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      marginTop: 4,
                    }}
                  >
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setPage((n) => Math.max(1, n - 1))}
                      style={{
                        padding: '8px 18px',
                        borderRadius: 999,
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)',
                        color: safePage <= 1 ? 'var(--color-text-faint)' : 'var(--color-text)',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: safePage <= 1 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Previous
                    </button>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-tertiary)' }}>
                      Page {safePage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
                      style={{
                        padding: '8px 18px',
                        borderRadius: 999,
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)',
                        color: safePage >= totalPages ? 'var(--color-text-faint)' : 'var(--color-text)',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: safePage >= totalPages ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      <BabysitterBottomNav />
    </div>
  );
}
