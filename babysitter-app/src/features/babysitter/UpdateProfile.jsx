import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import UserAvatar from '../../components/ui/UserAvatar';
import { API } from '../../services/api';
import { useAuth } from '../auth/AuthContext';

const orange = 'var(--color-primary)';

// NOTE: the local buildImageUrl() helper was removed. UserAvatar already resolves a
// relative "Type/file.jpg" path through getAvatarUrl(), so pre-prefixing it here produced
// a double-prefixed URL ("/api/images/Parents/api/images/Sitters/x.jpg") and the avatar
// always fell back to the letter circle. The raw PictureAddress is now passed straight in.

const Icons = {
  arrowBack: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-text)" strokeWidth="2">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  lock: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  location: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={orange} strokeWidth="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  checkmark: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-inverse)" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  chevronDown: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  camera: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-inverse)" strokeWidth="2">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  ),
};

const UpdateProfile = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const sitterId = Number(user?.userId || localStorage.getItem('userId'));

  const fileInputRef = useRef(null);
  const [isLoading, setIsLoading] = useState(() => Boolean(sitterId));
  const [profileImage, setProfileImage] = useState(null);
  const [profileFile, setProfileFile] = useState(null); // ← the actual File chosen for upload
  const [originalProfile, setOriginalProfile] = useState(null);

  const [form, setForm] = useState({
    fullName: '',
    contactNo: '',
    dob: '',
    experienceYears: '',
    hourlyRate: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await API.getSitterProfile(sitterId);
        setOriginalProfile(data);
        setForm({
          fullName: data.FullName || '',
          contactNo: data.PhoneNumber || '',
          dob: data.DOB ? data.DOB.slice(0, 10) : '',
          experienceYears: data.ExperienceYears != null ? String(data.ExperienceYears) : '',
          hourlyRate: data.HourlyRate != null ? String(data.HourlyRate) : '',
        });
        // Keep the RAW "Type/file.jpg" path — UserAvatar -> getAvatarUrl() prefixes it
        // exactly once. Prefixing here as well double-prefixed the URL and broke the image.
        if (data.PictureAddress) setProfileImage(data.PictureAddress);
      } catch (err) {
        console.error(err);
        setError('Could not load profile.');
      } finally {
        setIsLoading(false);
      }
    };
    if (sitterId) fetchProfile();
  }, [sitterId]);

  const handleImageClick = () => fileInputRef.current?.click();
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5 MB.');
      return;
    }
    setProfileFile(file);
    const reader = new FileReader();
    reader.onload = () => setProfileImage(reader.result);
    reader.readAsDataURL(file);
    setError('');
  };

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');

    // Required fields
    if (!form.fullName.trim()) { setError('Full name is required.'); return; }
    if (!form.dob) { setError('Date of birth is required.'); return; }
    if (!form.contactNo.trim()) { setError('Phone number is required.'); return; }

    setSaving(true);
    try {
      // 1. If a new file was chosen, upload it first and use the returned path.
      let newPicturePath;
      if (profileFile) {
        const fd = new FormData();
        fd.append('file', profileFile);
        const uploadRes = await API.uploadProfilePicture(fd);
        newPicturePath = uploadRes?.PictureAddress;
        if (!newPicturePath) throw new Error('Image upload failed.');
      }

      // 2. Build the update payload from fields that map to real Babysitter columns
      //    (PUT api/babysitter/update/{sitterId}). CNIC / Gender / City / Address / Bio
      //    have no column on this API and are no longer collected by this form.
      const payload = {
        FullName: form.fullName.trim(),
        PhoneNumber: form.contactNo.trim() || null,
        DOB: form.dob ? new Date(form.dob).toISOString() : null,
        ExperienceYears: form.experienceYears ? Number(form.experienceYears) : null,
        HourlyRate: form.hourlyRate ? Number(form.hourlyRate) : null,
      };
      if (newPicturePath) payload.PictureAddress = newPicturePath;

      // 3. Remove nulls so the backend's `if (dto.X != null)` guards skip untouched fields.
      Object.keys(payload).forEach((k) => {
        if (payload[k] === null) delete payload[k];
      });

      await API.updateSitterProfile(sitterId, payload);
      setSuccess('Profile updated.');
      setProfileFile(null); // consumed
      setTimeout(() => navigate('/my-profile'), 1500);
    } catch (err) {
      setError(err?.message || 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      maxWidth: '480px',
      margin: '0 auto',
      background: 'var(--gradient-auth-pastel, linear-gradient(160deg, var(--color-pastel-coral-soft) 0%, var(--color-pastel-lavender) 45%, var(--color-pastel-sky) 100%))',
      padding: '16px 16px 100px',
      boxSizing: 'border-box',
      overflowX: 'hidden',
    }}>
      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,0.7)', animation: 'pulse 1.4s ease-in-out infinite' }} />
            <div style={{ height: '22px', background: 'rgba(255,255,255,0.7)', borderRadius: '8px', width: '140px', animation: 'pulse 1.4s ease-in-out infinite' }} />
            <div style={{ width: '40px' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '8px' }}>
            <div style={{ width: '90px', height: '90px', borderRadius: '50%', background: 'rgba(255,255,255,0.75)', animation: 'pulse 1.4s ease-in-out infinite' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
              <div style={{ height: '18px', background: 'rgba(255,255,255,0.7)', borderRadius: '6px', width: '70%', animation: 'pulse 1.4s ease-in-out infinite' }} />
              <div style={{ height: '32px', background: 'rgba(255,255,255,0.7)', borderRadius: '16px', width: '110px', animation: 'pulse 1.4s ease-in-out infinite' }} />
            </div>
          </div>
          <div style={{ height: '56px', background: 'rgba(255,255,255,0.75)', borderRadius: '16px', width: '100%', animation: 'pulse 1.4s ease-in-out 0.1s infinite' }} />
          <div style={{ height: '56px', background: 'rgba(255,255,255,0.75)', borderRadius: '16px', width: '100%', animation: 'pulse 1.4s ease-in-out 0.2s infinite' }} />
          <div style={{ height: '56px', background: 'rgba(255,255,255,0.75)', borderRadius: '16px', width: '100%', animation: 'pulse 1.4s ease-in-out 0.3s infinite' }} />
          <div style={{ height: '56px', background: 'rgba(255,255,255,0.75)', borderRadius: '16px', width: '100%', animation: 'pulse 1.4s ease-in-out 0.4s infinite' }} />
          <div style={{ height: '56px', background: 'rgba(255,255,255,0.75)', borderRadius: '16px', width: '100%', animation: 'pulse 1.4s ease-in-out 0.5s infinite' }} />
        </div>
      ) : (
        <>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".jpg,.jpeg,.png" onChange={handleFileChange} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', paddingTop: '4px' }}>
        <BackButton />
        <h2 style={{ margin: 0, fontWeight: '700', fontSize: '18px', color: 'var(--color-text)' }}>Update Profile</h2>
        <div style={{ width: '42px' }} />
      </div>

        {/* Avatar section */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
          <div style={{ position: 'relative' }}>
            <div style={{
              width: '90px', height: '90px', borderRadius: '50%', overflow: 'hidden',
              border: '3px solid var(--glass-border)', boxShadow: '0 4px 12px rgb(var(--shadow-ink-rgb) / 0.15)',
              background: 'var(--color-surface-inverse)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <UserAvatar src={profileImage} name={form.fullName || originalProfile?.FullName || 'Sitter'} size={88} alt="Profile" />
            </div>
            <div onClick={handleImageClick} style={{
              position: 'absolute', bottom: 2, right: 2, width: 28, height: 28,
              borderRadius: '50%', background: orange, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid var(--glass-border)', cursor: 'pointer', boxShadow: '0 2px 8px rgb(var(--primary-rgb) / 0.4)',
            }}>
              <Icons.camera />
            </div>
          </div>
          <div>
            <button onClick={handleImageClick} style={{
              background: 'var(--color-primary-tint)', color: orange, border: 'none', borderRadius: '20px',
              padding: '6px 14px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer',
            }}>Upload Photo</button>
          </div>
        </div>

        {/* Verified Info */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={orange} strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--color-text)' }}>Verified Personal Information</span>
          </div>

          <CardField label="FULL NAME" value={form.fullName} onChange={(v) => handleChange('fullName', v)} locked />
          <CardField label="DOB" type="date" value={form.dob} onChange={(v) => handleChange('dob', v)} locked />
        </div>

        {/* Professional Experience */}
        <SectionHeader icon="📝" title="Professional Experience" />
        <InputField label="EXPERIENCE (YEARS)" type="number" min="0" value={form.experienceYears} onChange={(v) => handleChange('experienceYears', v)} />
        <label style={labelStyle}>HOURLY RATE (PKR)</label>
        <input
          type="number"
          min="0"
          step="50"
          value={form.hourlyRate}
          onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
          placeholder="e.g. 750"
          style={inputStyle}
        />
        <InputField label="CONTACT NO" type="tel" value={form.contactNo} onChange={(v) => handleChange('contactNo', v)} />

        {error && <p style={{ color: '#e74c3c', textAlign: 'center', margin: '10px 0' }}>{error}</p>}
        {success && <p style={{ color: '#27ae60', textAlign: 'center', margin: '10px 0' }}>{success}</p>}

        <button onClick={handleSave} disabled={saving} style={{
          width: '100%', padding: '16px', borderRadius: '30px',
          background: 'linear-gradient(to right, var(--color-warning), var(--color-warning-strong))',
          color: 'var(--color-text-inverse)', border: 'none', fontWeight: 'bold', fontSize: '16px',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          marginTop: '20px',
        }}>
          <Icons.checkmark /> Update Profile
                </button>
        <BabysitterBottomNav />
        </>
      )}
    </div>
  );
};

// Reusable fields
const CardField = ({ label, value, onChange, type = 'text', locked }) => (
  <div>
    <label style={labelStyle}>{label}</label>
    <div style={cardStyle}>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '14px', color: 'var(--color-text)', flex: 1, background: 'transparent' }} />
      {locked && <Icons.lock />}
    </div>
  </div>
);

const InputField = ({ label, value, onChange, type = 'text' }) => (
  <div>
    <label style={labelStyle}>{label}</label>
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
  </div>
);

const SectionHeader = ({ icon, title }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', marginTop: '16px' }}>
    <span style={{ fontSize: '18px' }}>{icon}</span>
    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: 'var(--color-text)' }}>{title}</h3>
  </div>
);

const cardStyle = {
  background: 'var(--color-surface)',
  borderRadius: '16px',
  padding: '13px 15px',
  boxShadow: '0 2px 8px rgb(var(--shadow-ink-rgb) / 0.06)',
  marginBottom: '12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  border: '1px solid var(--color-border)',
};

const inputStyle = {
  width: '100%',
  background: 'var(--color-surface)',
  borderRadius: '16px',
  padding: '13px 15px',
  boxShadow: '0 2px 8px rgb(var(--shadow-ink-rgb) / 0.06)',
  marginBottom: '12px',
  border: '1px solid var(--color-border)',
  fontSize: '14px',
  color: 'var(--color-text)',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle = {
  fontSize: '11px',
  fontWeight: 'bold',
  color: 'var(--color-primary)',
  letterSpacing: '0.8px',
  marginBottom: '6px',
  marginTop: '4px',
};

export default UpdateProfile;

