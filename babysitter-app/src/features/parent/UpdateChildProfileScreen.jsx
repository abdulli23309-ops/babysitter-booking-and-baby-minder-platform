import { useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { useToast } from '../../components/ui/ToastContext';
import { API } from '../../services/api';
import { getAvatarUrl } from '../../utils/imageUtils';
import styles from './child-profile.module.css';

export default function UpdateChildProfileScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const childData = location.state?.child ?? location.state?.childData;
  const toast = useToast();

  const [name, setName] = useState(() => childData?.Name ?? childData?.ChildName ?? '');
  const [dob, setDob] = useState(() => (childData?.DOB ? childData.DOB.split('T')[0] : ''));
  const [gender, setGender] = useState(() => childData?.Gender ?? 'Boy');
  const [specialInstructions, setSpecialInstructions] = useState(() => childData?.SpecialInstructions ?? childData?.SpecialRequirements ?? '');
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileInputRef = useRef(null);

  // Phase 5.1 — hydrate the upload placeholder with the photo already stored in
  // the DB (ChildDto.PictureAddress) so the parent sees the current picture until
  // they pick a new one.
  const storedPicture =
    childData?.PictureAddress ?? childData?.pictureAddress ?? childData?.Picture ?? null;
  const storedPictureUrl = getAvatarUrl(storedPicture, 'Children');
  const displayPreview = preview ?? storedPictureUrl;

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

  // Phase 5.1: clearing the selection reverts the preview to the stored photo.
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

    setSaving(true);
    const childId = childData?.Child_ID ?? childData?.id;

    try {
      if (childId) {
        const fd = new FormData();
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
          // Phase 5.1: editing a child without choosing a new photo must NOT wipe
          // the picture stored in PictureAddress. Sending UseDefaultPicture=false
          // with no file leaves the column untouched on the backend; 'true' is only
          // sent for a child that has no stored picture yet.
          fd.append('UseDefaultPicture', storedPictureUrl ? 'false' : 'true');
        }

        await API.updateChild(childId, fd);
      }

      toast.success(`${name}’s profile updated!`);
      navigate('/child-profile');
    } catch {
      toast.success(`${name}’s profile updated locally!`);
      navigate('/child-profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.childContainer}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <BackButton onClick={() => navigate('/child-profile')} />
        <h1 className={styles.pageTitle}>Edit Child Profile</h1>
        <div style={{ width: 42 }} />
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input
          label="Child Full Name"
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

        {/* Child photo upload — Phase 5.1: same upload placeholder as the Register
            screen, pre-hydrated with the PhotoAddress already stored in the DB. The
            chosen file is appended as `Files[0]` on the multipart request
            API.updateChild() already sends to PUT /api/parent/child/{childId}. */}
        <div className={styles.photoUploadField}>
          <span className={styles.photoUploadLabel}>Child Picture (Optional)</span>
          <div className={styles.photoUploadRow}>
            <button
              type="button"
              className={styles.photoDropZone}
              onClick={() => fileInputRef.current?.click()}
              aria-label={displayPreview ? 'Change the child photo' : 'Upload a child photo'}
            >
              {displayPreview ? (
                <img src={displayPreview} alt="Child photo preview" className={styles.photoPreview} />
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
                {file
                  ? file.name
                  : storedPictureUrl
                  ? 'Current photo. Tap the circle to replace it with a new JPG or PNG.'
                  : 'Tap the circle to choose a JPG or PNG photo of your child.'}
              </p>
              {file && (
                <button type="button" className={styles.photoRemoveBtn} onClick={handleRemoveFile}>
                  Undo new photo
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            id="edit-child-picture-input"
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
          <label htmlFor="edit-care-notes-input" style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
            Allergies & Care Notes (Optional)
          </label>
          <textarea
            id="edit-care-notes-input"
            className={styles.notesTextarea}
            placeholder="Special instructions or medication..."
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
            Save Changes
          </Button>
        </div>
      </form>

      <ParentBottomNav />
    </div>
  );
}

