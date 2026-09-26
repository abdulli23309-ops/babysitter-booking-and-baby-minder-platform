import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import BackButton from '../../components/ui/BackButton';
import { useToast } from '../../components/ui/ToastContext';
import { API } from '../../services/api';
import styles from './auth-form.module.css';

const CreateAccount = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const profileFileRef = useRef(null);
  const { showToast } = useToast();

  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [profileImage, setProfileImage] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phoneNumber: '',
    address: '',
  });

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleImageClick = () => fileInputRef.current?.click();

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
      setError('Only JPG/PNG images are allowed');
      return;
    }

    setProfileImage(URL.createObjectURL(file));
    profileFileRef.current = file;
    setError('');
  };

  const validate = () => {
    const errs = {};
    if (!form.fullName.trim()) errs.fullName = 'Full name is required';
    if (!form.email.trim()) errs.email = 'Email address is required';
    if (!form.password) errs.password = 'Password is required';
    if (form.password !== form.confirmPassword) errs.confirmPassword = 'Passwords do not match';
    return errs;
  };

  const handleRegister = async () => {
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError('Please fix the highlighted fields');
      return;
    }
    setError('');

    setLoading(true);

    const fd = new FormData();
    fd.append('FullName', form.fullName);
    fd.append('EmailAddress', form.email);
    fd.append('Username', form.email.split('@')[0]);
    fd.append('Password', form.password);
    fd.append('PhoneNumber', form.phoneNumber);
    fd.append('Address', form.address || 'Not Provided');

    if (profileFileRef.current) {
      fd.append('ProfilePicture', profileFileRef.current);
    } else {
      fd.append('UseDefaultPicture', 'true');
    }

    try {
      await API.registerParent(fd);

      showToast('Account created successfully! Please log in.', { type: 'success' });
      navigate('/login', { replace: true });
    } catch (err) {
      const message = err?.message || 'Could not connect to the server. Please try again.';
      setError(message);
      showToast(message, { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".jpg,.jpeg,.png"
        onChange={handleFileChange}
      />

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <BackButton onClick={() => navigate('/role')} />
          <h2 className={styles.title}>
            <span className={styles.titleText}>Create Parent Account</span>
          </h2>
          <div style={{ width: 40 }} />
        </div>
        <p className={styles.subtitle}>Tell us a little about yourself</p>

        <div className={styles.imageContainer}>
          <button type="button" className={styles.imageButton} onClick={handleImageClick} aria-label="Upload profile picture">
            <span className={styles.imageWrapper}>
              {profileImage ? (
                <img src={profileImage} alt="Profile preview" className={styles.image} />
              ) : (
                <span className={styles.placeholderIcon} aria-hidden="true">📷</span>
              )}
            </span>
            <span className={styles.cameraBadge} aria-hidden="true">📸</span>
          </button>
        </div>

        <div className={styles.formGrid}>
          <Input
            label="Full Name *"
            name="fullName"
            placeholder="Sadia Malik"
            value={form.fullName}
            onChange={(e) => handleChange('fullName', e.target.value)}
            error={fieldErrors.fullName}
            disabled={loading}
          />
          <Input
            label="Email Address *"
            name="email"
            type="email"
            placeholder="example@email.com"
            value={form.email}
            onChange={(e) => handleChange('email', e.target.value)}
            error={fieldErrors.email}
            disabled={loading}
          />
          <Input
            label="Password *"
            name="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter your password"
            value={form.password}
            onChange={(e) => handleChange('password', e.target.value)}
            error={fieldErrors.password}
            disabled={loading}
          />
          <Input
            label="Confirm Password *"
            name="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            placeholder="Re-enter your password"
            value={form.confirmPassword}
            onChange={(e) => handleChange('confirmPassword', e.target.value)}
            error={fieldErrors.confirmPassword}
            disabled={loading}
          />
          <Input
            label="Phone Number"
            name="phoneNumber"
            type="tel"
            placeholder="+92 300 1234567"
            value={form.phoneNumber}
            onChange={(e) => handleChange('phoneNumber', e.target.value)}
            disabled={loading}
          />
          <Input
            label="Address"
            name="address"
            placeholder="Street, City"
            value={form.address}
            onChange={(e) => handleChange('address', e.target.value)}
            disabled={loading}
          />
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            marginTop: 'var(--space-3)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
          />
          Show passwords
        </label>

        {error && <p className={styles.successText} style={{ color: 'var(--color-error)' }}>{error}</p>}

        <Button
          onClick={handleRegister}
          loading={loading}
          block
          size="lg"
          className={styles.submitButton}
        >
          {loading ? 'Creating account…' : 'Create Account'}
        </Button>
      </div>
    </div>
  );
};

export default CreateAccount;
