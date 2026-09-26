import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import UserAvatar from '../../components/ui/UserAvatar';
import { API } from '../../services/api';
import { useAuth } from '../auth/AuthContext';

const orange = 'var(--color-primary)';

const buildImageUrl = (pic) => {
  if (!pic) return null;
  if (pic.startsWith('http') || pic.startsWith('data:')) return pic;
  const parts = pic.split('/');
  if (parts.length === 2) {
    const [type, filename] = parts;
    return `/api/images/${type}/${filename}`;
  }
  return `/api/images/default/${pic}`;
};

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
  const updateFileRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(() => Boolean(sitterId));
  const [message, setMessage] = useState('');
  const [profileImage, setProfileImage] = useState(null);
  const [originalProfile, setOriginalProfile] = useState(null);

  const [form, setForm] = useState({
    fullName: '',
    cnic: '',
    dob: '',
    gender: 'Female',
    professionalTitle: '',
    preferredChildAge: 'Toddlers (1-4 years)',
    experienceYears: '',
    location: '',
    fullAddress: '',
    contactNo: '',
    experienceSummary: '',
  });

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await API.getSitterProfile(sitterId);
        setOriginalProfile(data);
        setForm({
          fullName: data.FullName || '',
          cnic: data.CNIC || '',
          dob: data.DOB ? data.DOB.split('T')[0] : '',
          gender: data.Gender || 'Female',
          professionalTitle: data.ProfessionalTitle || '',
          preferredChildAge: data.PreferredChildAge || 'Toddlers (1-4 years)',
          experienceYears: data.ExperienceYears != null ? String(data.ExperienceYears) : '',
          location: data.City || '',
          fullAddress: data.Address || '',
          contactNo: data.PhoneNumber || '',
          experienceSummary: data.Bio || '',
        });
        setProfileImage(buildImageUrl(data.PictureAddress));
            } catch (err) {
        console.error(err);
        setMessage('Could not load profile.');
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
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
      setMessage('Only JPG/PNG images allowed');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setProfileImage(reader.result); setMessage(''); };
    reader.readAsDataURL(file);
    updateFileRef.current = file;
  };

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage('');

    // Map to the new backend UpdateSitterDto (PUT api/babysitter/update/{sitterId}).
    // Only existing Babysitter columns are available on API-C; fields like CNIC, City,
    // Gender, Bio/Address are DOCUMENT ONLY (no schema column) and are intentionally omitted.
    const payload = {
      FullName: form.fullName || undefined,
      PhoneNumber: form.contactNo || undefined,
      DOB: form.dob ? new Date(form.dob).toISOString() : undefined,
      ExperienceYears: form.experienceYears !== '' && !Number.isNaN(Number(form.experienceYears))
        ? Number(form.experienceYears)
        : undefined,
      PictureAddress:
        originalProfile?.PictureAddress
          ? originalProfile.PictureAddress
          : undefined,
    };
    // Only send non-empty values.
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );

    try {
      await API.updateSitterProfile(sitterId, cleanPayload);
      setMessage('Profile updated successfully!');
      setTimeout(() => navigate('/my-profile'), 1500);
    } catch (err) {
      setMessage(err?.message || 'Update failed');
    } finally {
      setLoading(false);
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
          <CardField label="CNIC / ID NUMBER" value={form.cnic} onChange={(v) => handleChange('cnic', v)} locked />
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <CardField label="DOB" type="date" value={form.dob} onChange={(v) => handleChange('dob', v)} locked />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>GENDER</label>
              <div style={{ ...cardStyle, marginBottom: 0 }}>
                <span style={{ fontSize: '14px', color: 'var(--color-text)' }}>{form.gender}</span>
                <Icons.lock />
              </div>
            </div>
          </div>
        </div>

        {/* Professional Experience */}
        <SectionHeader icon="📝" title="Professional Experience" />
        <InputField label="PROFESSIONAL TITLE" value={form.professionalTitle} onChange={(v) => handleChange('professionalTitle', v)} />
        <InputField label="EXPERIENCE (YEARS)" type="number" min="0" value={form.experienceYears} onChange={(v) => handleChange('experienceYears', v)} />
        <label style={labelStyle}>PREFERRED CHILD AGE</label>
        <div style={{ position: 'relative', marginBottom: '12px' }}>
          <select value={form.preferredChildAge} onChange={(e) => handleChange('preferredChildAge', e.target.value)} style={{ ...inputStyle, marginBottom: 0, appearance: 'none', paddingRight: '40px', cursor: 'pointer' }}>
            <option>Toddlers (1-4 years)</option>
            <option>Infants (0-1 year)</option>
            <option>Kids (4-8 years)</option>
            <option>Pre-teens (8-12 years)</option>
          </select>
          <Icons.chevronDown style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        </div>
        <div style={{ position: 'relative' }}>
          <InputField label="LOCATION" value={form.location} onChange={(v) => handleChange('location', v)} />
          <Icons.location style={{ position: 'absolute', right: '14px', top: '40px', transform: 'translateY(-50%)' }} />
        </div>
        <InputField label="FULL ADDRESS" value={form.fullAddress} onChange={(v) => handleChange('fullAddress', v)} />
        <InputField label="CONTACT NO" type="tel" value={form.contactNo} onChange={(v) => handleChange('contactNo', v)} />
        <label style={labelStyle}>EXPERIENCE SUMMARY</label>
        <textarea
          style={{ ...inputStyle, height: '120px', resize: 'none', verticalAlign: 'top', fontFamily: 'inherit', lineHeight: '1.5' }}
          value={form.experienceSummary}
          onChange={(e) => handleChange('experienceSummary', e.target.value)}
        />

        {message && <p style={{ color: message.includes('success') ? '#27ae60' : '#e74c3c', textAlign: 'center', margin: '10px 0' }}>{message}</p>}

        <button onClick={handleSave} disabled={loading} style={{
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

