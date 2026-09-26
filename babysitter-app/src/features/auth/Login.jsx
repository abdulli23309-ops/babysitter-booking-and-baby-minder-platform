import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from './AuthContext';
import Button from '../../components/ui/Button';
import BackButton from '../../components/ui/BackButton';
import Input from '../../components/ui/Input';
import { useToast } from '../../components/ui/ToastContext';
import styles from './login.module.css';

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Please enter username and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const endpoint = '/api/auth/login';

      const payload = {
        Username: username.trim(),
        Password: password.trim(),
      };

      const res = await axios.post(endpoint, payload, {
        headers: { 'Content-Type': 'application/json' },
      });

      const data = res.data;
      const userId = data.userId || data.id || data.UserId || data.sitterId;
      if (!data || !userId) {
        throw new Error('Invalid response from server');
      }

      const rawResponseRole = data.role ?? data.Role;
      if (rawResponseRole == null) {
        throw new Error('Invalid response from server');
      }

      const normalizedRole =
        String(rawResponseRole).toLowerCase() === 'sitter'
          ? 'babysitter'
          : String(rawResponseRole).toLowerCase();

      login({
        userId,
        role: normalizedRole,
        token: data.token ?? data.Token,
        expiresAt: data.expiresAt ?? data.ExpiresAt,
        user: data,
      });

      showToast('Welcome back! You are now logged in.', { type: 'success' });

      const targetPath =
        normalizedRole === 'parent' ? '/main-screen' : '/babysitter-dashboard';
      navigate(targetPath, { replace: true });
    } catch (err) {
      let errorMsg;

      if (err.response?.status === 401) {
        errorMsg =
          typeof err.response?.data === 'string' && err.response.data
            ? err.response.data
            : err.response?.data?.message || 'Invalid username or password.';
      } else if (err.response?.data) {
        errorMsg =
          typeof err.response.data === 'string'
            ? err.response.data
            : err.response.data.message || err.message || 'Login failed. Please try again.';
        console.error('Login Error:', err);
      } else {
        errorMsg = err.message || 'Unable to connect to server. Please check your network or backend server.';
        console.error('Login Error:', err);
      }

      const normalized = String(errorMsg);
      setError(normalized);
      showToast(normalized, { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = () => {
    navigate('/role');
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-start', marginBottom: '8px' }}>
          <BackButton onClick={() => navigate('/')} />
        </div>
        <h1 className={styles.appTitle}>Little Care</h1>
        <p className={styles.subtitle}>Nurturing with love and safety</p>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Login</h2>

          {/* Username */}
          <Input
            label="Username"
            name="username"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (error) setError('');
            }}
            placeholder="Enter your username"
            disabled={loading}
          />

          {/* Password */}
          <div style={{ position: 'relative' }}>
            <Input
              label="Password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError('');
              }}
              placeholder="Enter your password"
              disabled={loading}
              error={error || undefined}
              style={{ paddingRight: 44 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              disabled={loading}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text-tertiary)',
                transition: 'color var(--transition-fast, 120ms ease)',
              }}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>

          {/* Login Button */}
          <Button
            onClick={handleLogin}
            loading={loading}
            block
            size="lg"
            style={{ marginTop: 'var(--space-4)' }}
          >
            {loading ? 'Signing in…' : 'Login'}
          </Button>

          {/* Create Account Link */}
          <p className={styles.footerText}>
            Don&apos;t have an account?{' '}
            <button type="button" className={styles.link} onClick={handleCreateAccount}>
              Create New Account
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;

