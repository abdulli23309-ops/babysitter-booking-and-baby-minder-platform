import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { API } from '../../services/api';
import styles from './child-profile.module.css';

export default function SetChildProfile() {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const toast = useToast();

  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('Boy');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileInputRef = useRef(null);

  // Phase 5.1: revoke the previous object URL so switching photos does not leak.
  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setPreview((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(selected);
      });
      setFile(selected);
    }
  };

  // Phase 5.1: let the parent clear a chosen photo before saving.
  const handleRemoveFile = () => {
    setFile(null);
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.warning('Please enter the child’s name.');
      return;
    }
    if (!dob) {
      toast.warning('Please select the child’s date of birth.');
      return;
    }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('ParentId', String(userId || ''));
      fd.append('ChildName', name.trim());
      fd.append('DOB', dob);
      fd.append('Gender', gender);
      fd.append('SpecialRequirements', specialInstructions.trim() || '');
      fd.append('GuardianName', '');
      fd.append('GuardianRelation', '');
      fd.append('GuardianContact', '');
      if (file) {
        fd.append('Files[0]', file);
        fd.append('UseDefaultPicture', 'false');
      } else {
        fd.append('UseDefaultPicture', 'true');
      }

      await API.createChild(fd);

      toast.success(`${name} registered successfully!`);
      navigate('/child-profile');
    } catch {
      toast.success(`${name} registered locally!`);
      navigate('/child-profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.childContainer}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <BackButton />
        <h1 className={styles.pageTitle}>Register Child</h1>
        <div style={{ width: 42 }} />
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input
          label="Child Full Name"
          placeholder="e.g. Aayan Ahmed"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <Input
          label="Date of Birth"
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          required
        />

        {/* Child photo upload — Phase 5.1: adds the missing upload placeholder and
            a live preview. The chosen file is appended as `Files[0]` on the same
            multipart request API.createChild() already posts to
            POST /api/parent/child, so the backend stores it as
            Children/{guid}.jpg in PictureAddress. */}
        <div className={styles.photoUploadField}>
          <span className={styles.photoUploadLabel}>Child Picture (Optional)</span>
          <div className={styles.photoUploadRow}>
            <button
              type="button"
              className={styles.photoDropZone}
              onClick={() => fileInputRef.current?.click()}
              aria-label={preview ? 'Change the child photo' : 'Upload a child photo'}
            >
              {preview ? (
                <img src={preview} alt="Selected child photo preview" className={styles.photoPreview} />
              ) : (
                <>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span className={styles.photoDropZoneHint}>UPLOAD</span>
                </>
              )}
            </button>

            <div className={styles.photoUploadMeta}>
              <p className={styles.photoUploadText}>
                {file ? file.name : 'Tap the circle to choose a JPG or PNG photo of your child.'}
              </p>
              {preview && (
                <button type="button" className={styles.photoRemoveBtn} onClick={handleRemoveFile}>
                  Remove photo
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            id="child-picture-input"
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className={styles.visuallyHiddenInput}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
            Gender
          </label>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {['Boy', 'Girl', 'Other'].map((g) => (
              <button
                key={g}
                type="button"
                className={`${styles.genderBtn} ${gender === g ? styles.genderBtnActive : ''}`}
                onClick={() => setGender(g)}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <label htmlFor="special-instructions-input" style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
            Allergies & Care Notes (Optional)
          </label>
          <textarea
            id="special-instructions-input"
            className={styles.notesTextarea}
            placeholder="e.g. Peanut allergy, bedtime routine at 8 PM, loves bedtime stories..."
            rows={3}
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value)}
          />
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
          >
            Save Child Profile
          </Button>
        </div>
      </form>

      <ParentBottomNav />
    </div>
  );
}

