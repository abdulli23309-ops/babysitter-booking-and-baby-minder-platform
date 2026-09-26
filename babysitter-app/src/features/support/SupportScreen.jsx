import BackButton from '../../components/ui/BackButton';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import { useToast } from '../../components/ui/ToastContext';
import FaqAccordion from '../../components/ui/FaqAccordion';

export default function SupportScreen() {
  const toast = useToast();

  const handleContact = (method) => {
    toast.info(`Connecting to ${method}... Our support team is available 24/7.`);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        maxWidth: '480px',
        margin: '0 auto',
        padding: '16px 16px 100px',
        boxSizing: 'border-box',
        background: 'var(--gradient-auth-pastel)',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      {/* Top Bar */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
        <BackButton />
        <h1 style={{ margin: 0, fontSize: '19px', fontWeight: 700, color: 'var(--color-text)', textAlign: 'center', flex: 1 }}>
          Support &amp; Help Center
        </h1>
        <div style={{ width: 42 }} />
      </header>

      {/* Hero Card */}
      <section
        style={{
          background: 'var(--color-surface)',
          borderRadius: '24px',
          padding: '22px 18px',
          boxShadow: '0 6px 24px rgb(var(--ink-rgb) / 0.05)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '8px',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'var(--color-info-tint)',
            color: 'var(--color-info)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
          </svg>
        </div>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--color-text)' }}>
          How can we assist you?
        </h2>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
          Our care concierge team is standing by 24/7 for booking support, payments, and safety questions.
        </p>
      </section>

      {/* Quick Action Channels */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          type="button"
          onClick={() => handleContact('Emergency Caregiver Hotline')}
          style={{
            background: 'var(--color-surface)',
            border: 'none',
            borderRadius: '20px',
            padding: '16px 18px',
            boxShadow: '0 4px 16px rgb(var(--ink-rgb) / 0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--color-primary-tint)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--color-text)' }}>24/7 Caregiver Helpline</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Toll-free: +92 (800) 548853</p>
            </div>
          </div>
          <span style={{ color: 'var(--color-text-faint)', fontSize: '18px' }}>›</span>
        </button>

        <button
          type="button"
          onClick={() => handleContact('WhatsApp Concierge')}
          style={{
            background: 'var(--color-surface)',
            border: 'none',
            borderRadius: '20px',
            padding: '16px 18px',
            boxShadow: '0 4px 16px rgb(var(--ink-rgb) / 0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--badge-success-bg)', color: 'var(--color-success-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--color-text)' }}>WhatsApp Support Chat</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Instant response within 5 minutes</p>
            </div>
          </div>
          <span style={{ color: 'var(--color-text-faint)', fontSize: '18px' }}>›</span>
        </button>

        <button
          type="button"
          onClick={() => handleContact('Payment Resolution Support')}
          style={{
            background: 'var(--color-surface)',
            border: 'none',
            borderRadius: '20px',
            padding: '16px 18px',
            boxShadow: '0 4px 16px rgb(var(--ink-rgb) / 0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--badge-purple-bg)', color: 'var(--badge-purple-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--color-text)' }}>Payment &amp; Payout Inquiries</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Direct bank deposit assistance</p>
            </div>
          </div>
          <span style={{ color: 'var(--color-text-faint)', fontSize: '18px' }}>›</span>
        </button>
      </section>

      {/* Frequently Asked Questions */}
      <section style={{ background: 'var(--color-surface)', borderRadius: '24px', padding: '18px 20px', boxShadow: '0 4px 16px rgb(var(--ink-rgb) / 0.04)' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--color-text)' }}>Frequently Asked Questions</h3>
        <FaqAccordion
          items={[
            {
              question: 'How are babysitters verified?',
              answer:
                'Every caregiver completes identity verification (CNIC), a manual profile review, and must provide prior experience details before they appear in your search results. Sitters with reported safety concerns are removed from the platform.',
            },
            {
              question: 'How do I cancel a booking?',
              answer:
                'Open the booking from "My Jobs" and use the Cancel button while the request is still Pending or Open. Once a session is In Progress, contact support through this screen so we can help you resolve it fairly for both sides.',
            },
            {
              question: 'When are booking payouts cleared?',
              answer:
                'Cleared funds are deposited automatically within 24 hours of session completion. You can track the status of each payout from your dashboard history.',
            },
            {
              question: 'How do I change my 3 km work radius?',
              answer:
                'Open "Set Availability" in your menu and drag the pin on the Google Map. The new radius takes effect immediately for future search matches.',
            },
          ]}
        />
      </section>

      <BabysitterBottomNav />
    </div>
  );
}
