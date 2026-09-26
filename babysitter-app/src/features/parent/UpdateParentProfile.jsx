import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import UserAvatar from '../../components/ui/UserAvatar';
import { API } from '../../services/api';
import { useAuth } from '../auth/AuthContext';

const orange = 'var(--color-primary)';

// NOTE: no local image-URL helper here (the sitter screen had one and it caused a
// double-prefixed URL). <UserAvatar> resolves the raw "Parents/file.jpg" value
// through getAvatarUrl(), so the stored PictureAddress is passed in untouched.

const Icons = {
  lock: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  checkmark: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-inverse)" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  camera: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-inverse)" strokeWidth="2">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  ),
};

const UpdateParentProfile = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Parent_ID of the signed-in parent. Both profile endpoints are ownership-guarded
  // server-side (403 when the claim does not match), so no client trust is assumed.
  const parentId = Number(user?.userId || localStorage.getItem('userId'));

  const fileInputRef = useRef(null);
  // parentId is derived at mount from the session, so a missing one can never resolve
  // by re-rendering: loading/error start in their final shape for that case instead of
  // being corrected with a setState inside the effect (react-hooks/set-state-in-effect).
  const [loading, setLoading] = useState(() => Boolean(parentId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(() =>
    parentId ? '' : 'Could not determine your account. Please sign in again.'
  );
  const [success, setSuccess] = useState('');
  const [profileImage, setProfileImage] = useState(null);
  const [profileFile, setProfileFile] = useState(null); // the actual File chosen for upload

  // Display-only identity fields. The parent login response (POST /api/parent/login)
  // returns only userId/name/role/address/pictureAddress/token, so the session copy has
  // no email or username — the profile GET is the source of truth and the session
  // value (if any) is kept purely as a fallback.
  const [account, setAccount] = useState({
    email: user?.email ?? user?.EmailAddress ?? user?.Email ?? '',
    username: user?.username ?? user?.Username ?? '',
  });

  const [form, setForm] = useState({
    fullName: '',
    contactNo: '',
    address: '',
  });

  useEffect(() => {
    if (!parentId) return;

    const fetchProfile = async () => {
      try {
        const data = await API.getParentProfile(parentId);
        setForm({
          fullName: data.FullName || '',
          contactNo: data.PhoneNumber || '',
          address: data.Address || '',
        });
        setAccount((prev) => ({
          email: data.EmailAddress || prev.email,
          username: data.Username || prev.username,
        }));
        // Raw "Parents/file.jpg" — UserAvatar prefixes it exactly once.
        if (data.PictureAddress) setProfileImage(data.PictureAddress);
      } catch (err) {
        console.error(err);
        setError('Could not load profile.');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [parentId]);

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
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');

    if (!form.fullName.trim()) { setError('Full name is required.'); return; }
    if (!form.contactNo.trim()) { setError('Phone number is required.'); return; }

    setSaving(true);
    try {
      // 1. Upload the new picture first so the update payload can carry its path.
      let newPicturePath;
      if (profileFile) {
        const fd = new FormData();
        fd.append('file', profileFile);
        const uploadRes = await API.uploadProfilePicture(fd);
        newPicturePath = uploadRes?.PictureAddress;
        if (!newPicturePath) throw new Error('Image upload failed.');
      }

      // 2. UpdateParentProfileDto = { FullName, PhoneNumber, PictureAddress, Address }.
      //    Address is optional, so a blank box is sent as null (then stripped) and the
      //    column keeps its stored value. Nothing else here is ever null because both
      //    required fields are validated above.
      const payload = {
        FullName: form.fullName.trim(),
        PhoneNumber: form.contactNo.trim(),
        Address: form.address.trim() || null,
      };
      if (newPicturePath) payload.PictureAddress = newPicturePath;

      Object.keys(payload).forEach((k) => {
        if (payload[k] === null) delete payload[k];
      });

      await API.updateParentProfile(parentId, payload);
      setSuccess('Profile updated.');
      setProfileFile(null); // consumed
      setTimeout(() => navigate('/parent-profile'), 1500);
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
      {loading ? (
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

          {/* Avatar section - same pattern as the sitter form */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
            <div style={{ position: 'relative' }}>
              <div style={{
                width: '90px', height: '90px', borderRadius: '50%', overflow: 'hidden',
                border: '3px solid var(--glass-border)', boxShadow: '0 4px 12px rgb(var(--shadow-ink-rgb) / 0.15)',
                background: 'var(--color-surface-inverse)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <UserAvatar src={profileImage} name={form.fullName || user?.name || 'Parent'} size={88} type="Parents" alt="Profile" />
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

          {/* Read-only identity - Email/Username come from the profile GET because the
              login response carries neither. */}
          <SectionHeader icon="🔒" title="Account Information" />
          <ReadOnlyField label="EMAIL" value={account.email} />
          <ReadOnlyField label="USERNAME" value={account.username} />

          {/* Editable fields */}
          <SectionHeader icon="👤" title="Profile Details" />
          <InputField label="FULL NAME" value={form.fullName} onChange={(v) => handleChange('fullName', v)} />
          <InputField label="PHONE NUMBER" type="tel" value={form.contactNo} onChange={(v) => handleChange('contactNo', v)} />
          <InputField label="ADDRESS (OPTIONAL)" value={form.address} onChange={(v) => handleChange('address', v)} />

          {error && <p style={{ color: '#e74c3c', textAlign: 'center', margin: '10px 0' }}>{error}</p>}
          {success && <p style={{ color: '#27ae60', textAlign: 'center', margin: '10px 0' }}>{success}</p>}

          {/* Save / Cancel */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
            <button onClick={() => navigate('/parent-profile')} disabled={saving} style={{
              flex: 1, padding: '16px', borderRadius: '30px', background: 'var(--color-surface)',
              color: 'var(--color-text)', border: '1px solid var(--color-border)',
              fontWeight: 'bold', fontSize: '16px', cursor: saving ? 'wait' : 'pointer',
            }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving} style={{
              flex: 2, padding: '16px', borderRadius: '30px',
              background: 'linear-gradient(to right, var(--color-warning), var(--color-warning-strong))',
              color: 'var(--color-text-inverse)', border: 'none', fontWeight: 'bold', fontSize: '16px',
              cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}>
              <Icons.checkmark /> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

          <ParentBottomNav />
        </>
      )}
    </div>
  );
};

// Reusable fields
const ReadOnlyField = ({ label, value }) => (
  <div>
    <label style={labelStyle}>{label}</label>
    <div style={cardStyle}>
      <span style={{
        fontSize: '14px', color: 'var(--color-text-secondary)', flex: 1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value || '—'}
      </span>
      <Icons.lock />
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

export default UpdateParentProfile;
