import React, { useState, useEffect, useCallback, useRef } from 'react';
import BabysitterBottomNav from '../../components/layout/BabysitterBottomNav';
import BackButton from '../../components/ui/BackButton';
import GoogleMapRadiusPicker from '../../components/ui/GoogleMapRadiusPicker';
import { API } from '../../services/api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import styles from './set-availability.module.css';

// ---------------------------------------------------------------------------
// Set Availability — Weekly Timetable Grid
// Features: 7 day columns (Mon–Sun), 7 standard time slot rows (08:00 AM – 10:00 PM),
// 48px row heights with 6px commute gap spacing, sticky time column on mobile,
// bulk Select All / Clear All, Google Map radius picker, and 4-week per-date save.
// ---------------------------------------------------------------------------

const DAYS_OF_WEEK = [
  { key: 'Monday', label: 'Mon' },
  { key: 'Tuesday', label: 'Tue' },
  { key: 'Wednesday', label: 'Wed' },
  { key: 'Thursday', label: 'Thu' },
  { key: 'Friday', label: 'Fri' },
  { key: 'Saturday', label: 'Sat' },
  { key: 'Sunday', label: 'Sun' },
];

const TIME_SLOTS = [
  { id: 1, label: '08:00 AM – 10:00 AM' },
  { id: 2, label: '11:00 AM – 01:00 PM' },
  { id: 3, label: '02:00 PM – 04:00 PM' },
  { id: 4, label: '05:00 PM – 07:00 PM' },
  { id: 5, label: '08:00 PM – 10:00 PM' },
  // Slot_ID 8 in the DB (identity) = 23:00 – 23:59 late-night slot
  { id: 8, label: '11:00 PM – 11:59 PM' },
];

const formatLocalDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getNext4WeekDates = (weekdayName) => {
  const dayMap = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  const targetDay = dayMap[weekdayName];
  if (targetDay === undefined) return [];

  const dates = [];
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentDay = base.getDay();
  const daysUntilTarget = (targetDay - currentDay + 7) % 7;

  for (let w = 0; w < 4; w += 1) {
    const d = new Date(base);
    d.setDate(base.getDate() + daysUntilTarget + w * 7);
    dates.push(formatLocalDate(d));
  }
  return dates;
};

export default function SetAvailability() {
  const { userId } = useAuth();
  const toast = useToast();

  // Weekly timetable state: keys are weekday names, values are arrays of slot IDs (1-7)
  const [weeklyGrid, setWeeklyGrid] = useState({
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
    Sunday: [],
  });

  // Modal state for custom confirm dialogs (Clear All, etc.)
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [pendingClearAction, setPendingClearAction] = useState(null);

  // Hourly Rate (PKR) state — hydrated from sitter profile, saved with availability
  const [hourlyRate, setHourlyRate] = useState('');

  // Set to true once the server's saved pin (Latitude/Longitude) has been
  // applied to the map. When true, the geolocation auto-detect effect must
  // NOT run — otherwise it would overwrite the restored saved pin ~200ms
  // after hydration (location-revert bug).
  const hydratedFromServer = useRef(false);

  // Preferred areas
  const [selectedAreas, setSelectedAreas] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('preferredAreas') || 'null');
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch {
      /* ignore */
    }
    return ['DHA Phase 6, Lahore', 'Gulberg III'];
  });

  // Smart Geocoded Area state (auto-updated from Google Map pin)
  const [preferredAreaText, setPreferredAreaText] = useState(() => {
    try {
      const saved = localStorage.getItem('preferredAreaText');
      if (saved) return saved;
      const savedAreas = JSON.parse(localStorage.getItem('preferredAreas') || 'null');
      if (Array.isArray(savedAreas) && savedAreas.length > 0) return savedAreas[0];
    } catch {
      /* ignore */
    }
    return 'DHA Phase 6, Lahore';
  });

  const [userLocation, setUserLocation] = useState(null);
  const [geoStatus, setGeoStatus] = useState(() =>
    typeof navigator !== 'undefined' && navigator?.geolocation ? 'pending' : 'unsupported'
  );
  const [saving, setSaving] = useState(false);

  // Map / location state (lat/lng and radius in km)
  // SSOT Rule: the backend (GetSitterAvailability) is the single source of truth.
  // localStorage is NOT read on init — a stale cached value would override the
  // server's hydrated pin/radius. The server always wins on mount.
  const [mapPosition, setMapPosition] = useState(null);
  const [mapRadiusKm, setMapRadiusKm] = useState(3); // hydrated from server on mount

  // Server-backed list of existing availability (refreshed via polling)
  const [existingAvailability, setExistingAvailability] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const hydratedRef = useRef(false);

  // Locked (booked) cells from the server: key "YYYY-MM-DD|slotId" -> LockedByJobId
  const [lockedMap, setLockedMap] = useState({});

  // Sitter-level 3-hour lockout from Babysitter.SitterLockedUntil (via profile endpoint)
  const [lockoutUntil, setLockoutUntil] = useState(null);

  // One-time lockout check on mount. Graceful degradation: if the profile endpoint
  // doesn't return SitterLockedUntil yet, the banner simply stays hidden (no error shown).
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const profile = await API.getSitterProfile(userId);
        if (profile && profile.SitterLockedUntil) {
          const until = new Date(profile.SitterLockedUntil);
          if (until > new Date()) {
            setLockoutUntil(until);
          }
        }
        if (profile) {
          if (profile.HourlyRate != null && Number(profile.HourlyRate) > 0) {
            setHourlyRate(String(profile.HourlyRate));
          } else if (profile.hourlyRate != null && Number(profile.hourlyRate) > 0) {
            setHourlyRate(String(profile.hourlyRate));
          }
          if (profile.SitterLockedUntil) {
            const until = new Date(profile.SitterLockedUntil);
            if (until > new Date()) {
              setLockoutUntil(until);
            }
          }
        }
      } catch {
        // Silent — banner simply not shown
      }
    })();
  }, [userId]);

  const handleRadiusChange = useCallback((km) => {
    setMapRadiusKm(km);
    try {
      localStorage.setItem('workAreaRadius', String(km));
    } catch {
      /* ignore */
    }
  }, []);

  const handleLocationChange = useCallback((coords) => {
    setMapPosition(coords);
    setUserLocation(coords);
    try {
      localStorage.setItem('workAreaCoords', JSON.stringify(coords));
    } catch {
      /* ignore */
    }
  }, []);

  // Geolocation detection effect
  useEffect(() => {
    // If the server already restored a saved pin, never auto-detect —
    // it would overwrite the user's saved Latitude/Longitude.
    if (hydratedFromServer.current) return;
    // Do not auto-detect while the initial availability fetch is still in
    // flight — the hydrate block may be about to apply a saved pin.
    if (availabilityLoading) return;
    if (typeof window === 'undefined' || !navigator?.geolocation) {
      const t = setTimeout(() => setGeoStatus('unsupported'), 0);
      return () => clearTimeout(t);
    }
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          handleLocationChange({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
          setGeoStatus('success');
        },
        () => setGeoStatus('error'),
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      );
    } catch {
      const t = setTimeout(() => setGeoStatus('unsupported'), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [handleLocationChange, availabilityLoading]);

  

  // Slot toggle handler
  const toggleSlot = (dayKey, slotId) => {
    setWeeklyGrid((prev) => {
      const currentSlots = prev[dayKey] || [];
      const updated = currentSlots.includes(slotId)
        ? currentSlots.filter((id) => id !== slotId)
        : [...currentSlots, slotId].sort((a, b) => a - b);
      return {
        ...prev,
        [dayKey]: updated,
      };
    });
  };

  // Bulk actions
  const handleSelectToday = () => {
    const jsDay = new Date().getDay();
    const DAY_KEYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayKey = DAY_KEYS[jsDay];
    if (!todayKey) return;

    const ALL_SLOT_IDS = [1, 2, 3, 4, 5, 8];
    const cellDate = getNext4WeekDates(todayKey)[0];
    const availableSlots = ALL_SLOT_IDS.filter((id) => !lockedMap[`${cellDate}|${id}`]);

    setWeeklyGrid((prev) => {
      const next = { ...prev };
      const existing = Array.isArray(next[todayKey]) ? next[todayKey] : [];
      const merged = Array.from(new Set([...existing, ...availableSlots])).sort((a, b) => a - b);
      next[todayKey] = merged;
      return next;
    });
  };

  const handleSelectAll = () => {
        const allSlotIds = [1, 2, 3, 4, 5, 8];
    const nextGrid = {};
    DAYS_OF_WEEK.forEach((day) => {
      const cellDate = getNext4WeekDates(day.key)[0];
      nextGrid[day.key] = allSlotIds.filter((id) => !lockedMap[`${cellDate}|${id}`]);
    });
    setWeeklyGrid(nextGrid);
  };

  const handleClearAll = () => {
    setPendingClearAction(() => {
      return async () => {
        try {
          if (userId) {
            await API.clearAllAvailability(userId);
          }
          toast.success('Availability cleared.');
          setWeeklyGrid({
            Monday: [],
            Tuesday: [],
            Wednesday: [],
            Thursday: [],
            Friday: [],
            Saturday: [],
            Sunday: [],
          });
          hydratedRef.current = false;
          await fetchAvailability();
        } catch (err) {
          toast.error(err?.message || 'Could not clear availability.');
        }
      };
    });
    setShowClearConfirm(true);
  };

  const handleClearConfirmOk = async () => {
    const action = pendingClearAction;
    setShowClearConfirm(false);
    setPendingClearAction(null);
    if (action) await action();
  };

  const handleClearConfirmCancel = () => {
    setShowClearConfirm(false);
    setPendingClearAction(null);
  };

  const handleAreaDetected = useCallback((area) => {
    if (area) {
      setPreferredAreaText(area);
      try {
        localStorage.setItem('preferredAreaText', area);
      } catch {
        /* ignore */
      }
      setSelectedAreas([area]);
    }
  }, []);

  // Save handler: translates weeklyGrid to per-date payload across next 4 weeks
  const handleSave = async () => {
    const hasSlots = Object.values(weeklyGrid).some((arr) => arr && arr.length > 0);
    if (!hasSlots) {
      toast.warning('Please select at least one time slot in the weekly schedule.');
      return;
    }

    // 10-Hour Continuous Work Limit Validation
    // A sitter cannot work continuously for more than 10 hours (max 5 consecutive 2-hr slots) in a single day
    for (const dayKey of Object.keys(weeklyGrid)) {
      const slots = weeklyGrid[dayKey];
      if (slots && slots.length > 5) {
        const sorted = [...slots].sort((a, b) => a - b);
        let currentRun = 1;
        let maxRun = 1;
        for (let i = 1; i < sorted.length; i += 1) {
          if (sorted[i] === sorted[i - 1] + 1) {
            currentRun += 1;
            if (currentRun > maxRun) maxRun = currentRun;
          } else {
            currentRun = 1;
          }
        }
        if (maxRun > 5) {
          toast.warning(
            `Cannot work continuously for more than 10 hours on ${dayKey} (maximum 5 consecutive slots). Please include a break.`
          );
          return;
        }
      }
    }

    if (hourlyRate !== '' && Number(hourlyRate) < 0) {
      toast.warning('Hourly rate cannot be negative.');
      return;
    }

    if (!userId) {
      toast.info('Availability preferences updated locally.');
      return;
    }

    setSaving(true);
    let successCount = 0;
    let errorCount = 0;
    const primaryCity = preferredAreaText || selectedAreas[0] || 'Lahore';
    const parsedRate = hourlyRate !== '' && !Number.isNaN(Number(hourlyRate)) ? Number(hourlyRate) : undefined;

    for (const dayKey of Object.keys(weeklyGrid)) {
      const slots = weeklyGrid[dayKey];
      if (slots && slots.length > 0) {
        const dates = getNext4WeekDates(dayKey);
        for (const date of dates) {
          try {
            await API.saveAvailability({
              BabySitter_ID: userId,
              Date: date,
              SlotIds: slots,
              City: primaryCity,
              Latitude: mapPosition?.lat ?? null,
              Longitude: mapPosition?.lng ?? null,
              RadiusKm: mapRadiusKm ?? 3,
              HourlyRate: parsedRate,
            });
            successCount += 1;
          } catch {
            errorCount += 1;
          }
        }
      }
    }

    setSaving(false);

    if (errorCount === 0 && successCount > 0) {
      toast.success(`Saved weekly availability across next 4 weeks (${successCount} date sessions configured)!`);
    } else if (errorCount > 0) {
      toast.info(`Saved ${successCount} date(s); ${errorCount} had errors.`);
    } else {
      toast.success('Availability preferences saved successfully!');
    }
  };

  // Hydrate from existing availability
  const fetchAvailability = useCallback(async (bg = false) => {
    if (!userId) {
      setExistingAvailability([]);
      return [];
    }
    if (!bg) setAvailabilityLoading(true);
    try {
      const rows = await API.getSitterAvailability(userId);
      const list = Array.isArray(rows) ? rows : rows?.data ? rows.data : [];

      // Ignore any past-dated rows defensively (backend already filters them)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const futureRows = list.filter(r => {
        const d = new Date(r.AvailableDate);
        d.setHours(0, 0, 0, 0);
        return d >= today;
      });

      setExistingAvailability(futureRows);

      const lockedAccumulator = {};
      futureRows.forEach((r) => {
        if (r.IsLocked) {
          const ld = String(r.AvailableDate).slice(0, 10);
          const sid = Number(r.Slot_ID);
          if (ld && sid >= 1 && sid <= 8) {
            lockedAccumulator[`${ld}|${sid}`] = r.LockedByJobId;
          }
        }
      });
      setLockedMap(lockedAccumulator);

      if (!hydratedRef.current) {
        hydratedRef.current = true;

        if (futureRows.length === 0) {
          setWeeklyGrid({
            Monday: [], Tuesday: [], Wednesday: [], Thursday: [],
            Friday: [], Saturday: [], Sunday: []
          });
          setMapPosition(null);
          setMapRadiusKm(3);
        } else {
          // 1. Find the row from the most recent save
          const latest = futureRows.reduce((max, r) =>
            (!max || r.Availability_ID > max.Availability_ID) ? r : max, null);

          // 2. Only keep rows from that same save (same location + radius)
          const sameSaveRows = futureRows.filter(r =>
            r.City === latest.City &&
            r.Latitude === latest.Latitude &&
            r.Longitude === latest.Longitude &&
            r.RadiusKm === latest.RadiusKm
          );

          // 3. Hydrate the map + radius from that save
          setMapPosition({ lat: latest.Latitude, lng: latest.Longitude });
          setMapRadiusKm(latest.RadiusKm ?? 3);
          // Pin was restored from saved data — suppress the geolocation
          // auto-detect effect so it cannot overwrite the saved pin.
          if (latest.Latitude != null && latest.Longitude != null) {
            hydratedFromServer.current = true;
          }
          // 3b. Hydrate the per-availability rate (falls back to the
          // profile default already loaded if the row has NULL rate)
          if (latest.HourlyRate != null && latest.HourlyRate !== '') {
            setHourlyRate(String(latest.HourlyRate));
          }

          // 4. Hydrate the grid from those rows only
          const emptyGrid = {
            Monday: [], Tuesday: [], Wednesday: [], Thursday: [],
            Friday: [], Saturday: [], Sunday: []
          };
          const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
          sameSaveRows.forEach(r => {
            const d = new Date(r.AvailableDate);
            const dayName = DAY_NAMES[d.getDay()];
            if (!emptyGrid[dayName].includes(r.Slot_ID)) {
              emptyGrid[dayName].push(r.Slot_ID);
            }
          });
          Object.keys(emptyGrid).forEach(k => emptyGrid[k].sort((a, b) => a - b));
          setWeeklyGrid(emptyGrid);

          // 5. Hydrate the address text field if the component has one
          if (typeof setPreferredAreaText === 'function' && latest.City) {
            setPreferredAreaText(latest.City);
          }
        }
      }

      return list;
    } catch {
      return [];
    } finally {
      if (!bg) setAvailabilityLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    // Reset the one-shot hydration guard so every fresh mount re-hydrates the
    // grid + pin from the server (restores saved selections on navigation away/back).
    if (!userId) return;
    hydratedRef.current = false;
    let cancelled = false;

    const run = async () => {
      if (!cancelled) await fetchAvailability(false);
    };
    run();

    const intervalId = setInterval(() => {
      if (!cancelled) fetchAvailability(true);
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [userId, fetchAvailability]);

  const availabilitySummary =
    existingAvailability.length > 0
      ? `${existingAvailability.length} saved slot(s) • auto-refreshes every 5s`
      : 'No saved availability yet';

  return (
    <div className={styles.availContainer}>
      {/* Top Header with BackButton, title, subtitle */}
      <header className={styles.topBar}>
        <BackButton />
        <div className={styles.headerCenter}>
          <h1 className={styles.pageTitle}>Set Availability</h1>
        </div>
        <div className={styles.topBarSpacer} aria-hidden="true" />
      </header>

      <p className={styles.subtitle}>
        Select your recurring weekly availability to automatically accept booking requests.
      </p>

      {/* Existing availability summary (refreshed every 5s) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgb(var(--surface-rgb) / 0.7)',
          border: '1px solid var(--color-surface-sunken)',
          borderRadius: '14px',
          padding: '8px 12px',
          boxShadow: '0 2px 8px rgb(var(--ink-rgb) / 0.04)',
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: availabilityLoading ? '#F59E0B' : '#22C55E',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            flex: 1,
          }}
        >
          {availabilitySummary}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" strokeWidth="2.5">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </div>

      {lockoutUntil && (
        <div className={styles.lockoutBanner}>
          <strong>Schedule temporarily locked.</strong>{' '}
          Your next booking was cancelled because a previous session ran late.
          You can resume bookings after{' '}
          {lockoutUntil.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
        </div>
      )}

      {/* Weekly Timetable Grid Card */}
      <section className={styles.timetableCard} aria-label="Weekly Timetable">
        <div className={styles.timetableHeader}>
          <h2 className={styles.sectionTitle}>Weekly Schedule</h2>
          <div className={styles.bulkActionsRow}>
            <button
              type="button"
              className={styles.bulkBtn}
              onClick={handleSelectToday}
            >
              Select Today
            </button>
            <button
              type="button"
              className={styles.bulkBtn}
              onClick={handleSelectAll}
            >
              Select All
            </button>
            <button
              type="button"
              className={styles.bulkBtn}
              onClick={handleClearAll}
            >
              Clear All
            </button>
          </div>
        </div>

        <div className={styles.timetableScrollContainer}>
          <div className={styles.timetableGrid}>
            {/* Header Row: corner time cell + 7 day labels */}
            <div className={`${styles.gridHeaderCell} ${styles.stickyCol}`}>Time</div>
            {DAYS_OF_WEEK.map((d) => (
              <div key={d.key} className={styles.gridHeaderCell}>
                {d.label}
              </div>
            ))}

            {/* 7 Slot Rows */}
            {TIME_SLOTS.map((slot) => (
              <React.Fragment key={slot.id}>
                <div className={`${styles.timeLabelCell} ${styles.stickyCol}`}>
                  {slot.label}
                </div>
                {DAYS_OF_WEEK.map((day) => {
                  const isSelected = Boolean(weeklyGrid[day.key]?.includes(slot.id));
                  const cellDate = getNext4WeekDates(day.key)[0];
                  const lockKey = `${cellDate}|${slot.id}`;
                  const isLocked = Boolean(lockedMap[lockKey]) || Boolean(lockoutUntil);
                  return (
                    <button
                      key={`${day.key}-${slot.id}`}
                      type="button"
                      className={`${styles.slotCell} ${isSelected ? styles.slotCellActive : ''} ${isLocked ? styles.cellLocked : ''}`}
                      onClick={() => {
                        if (isLocked) return;
                        toggleSlot(day.key, slot.id);
                      }}
                      disabled={isLocked}
                      title={isLocked ? 'Booked — cannot be changed' : undefined}
                      aria-pressed={isSelected}
                      aria-label={`${day.key} ${slot.label} ${isLocked ? 'Booked' : isSelected ? 'Selected' : 'Available'}`}
                    >
                      {isSelected && !isLocked ? '✓' : ''}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* Preferred Work Area Section */}
      <section className={styles.areaSection} aria-label="Preferred Work Area">
        <h2 className={styles.sectionTitle}>Preferred Work Area</h2>

        {(geoStatus === 'error' || geoStatus === 'unsupported') && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              background: 'var(--color-primary-tint-light)',
              border: '1px solid var(--color-warning-border)',
              color: 'var(--color-warning-strong)',
              borderRadius: '12px',
              padding: '8px 12px',
              fontSize: '12px',
              fontWeight: 600,
              marginBottom: '10px',
            }}
          >
            <span>⚠️</span>
            <span>
              Couldn&apos;t access your location{geoStatus === 'unsupported' ? ' (browser location unsupported)' : ''}. Drop
              the pin manually on the map — nothing is saved automatically until you confirm.
            </span>
          </div>
        )}

        <div className={styles.smartAreaWrapper}>
          <span className={styles.smartAreaPin}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </span>
          <input
            type="text"
            readOnly
            value={preferredAreaText}
            placeholder="Move map pin to detect area"
            className={styles.smartAreaInput}
            aria-label="Selected Work Area"
          />
          <span className={styles.smartAreaBadge}>
            {geoStatus === 'success' ? 'Live Pin' : 'Manual Pin'}
          </span>
        </div>

        <div style={{ marginTop: '8px' }}>
          <GoogleMapRadiusPicker
            center={mapPosition}
            initialCenter={userLocation || undefined}
            radiusKm={mapRadiusKm}
            onRadiusChange={handleRadiusChange}
            onLocationChange={handleLocationChange}
            onAreaDetected={handleAreaDetected}
          />
        </div>
      </section>

      {/* Rate Per Hour Section */}
      <section className={styles.rateSection} aria-label="Hourly Rate">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 className={styles.sectionTitle} style={{ margin: 0 }}>Rate Per Hour (PKR)</h2>
          <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>Standard pricing</span>
        </div>
        <div className={styles.rateInputWrapper}>
          <span className={styles.rateCurrencyBadge}>PKR</span>
          <input
            type="number"
            min="0"
            step="50"
            placeholder="e.g. 500"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            className={styles.rateInput}
            aria-label="Hourly Rate in PKR"
          />
          <span style={{ fontSize: '13px', color: 'var(--color-text-faint)', fontWeight: 600 }}>/ hour</span>
        </div>
      </section>

      {/* Save Availability Button */}
      <button
        type="button"
        className={styles.saveBtn}
        onClick={handleSave}
        disabled={saving || !!lockoutUntil}
      >
        {saving ? 'Saving...' : lockoutUntil ? 'Locked — resume later' : 'Save Availability'}
      </button>

      {/* Custom Confirm Modal — Clear All */}
      {showClearConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgb(var(--shadow-ink-rgb) / 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '24px',
          }}
        >
          <div
            style={{
              background: 'var(--color-surface)',
              borderRadius: '16px',
              padding: '24px',
              width: '100%',
              maxWidth: '320px',
              boxShadow: '0 12px 40px rgb(var(--shadow-ink-rgb) / 0.15)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: 'var(--color-text)',
                marginBottom: '12px',
              }}
            >
              Clear All Availability?
            </div>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--color-text-secondary)',
                lineHeight: 1.5,
                margin: '0 0 20px',
              }}
            >
              This will remove all future availability except slots already booked by active jobs. Continue?
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '999px',
                  border: '1px solid var(--color-border-subtle)',
                  background: 'var(--color-surface-muted)',
                  color: 'var(--color-text-secondary)',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
                onClick={handleClearConfirmCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '999px',
                  border: 'none',
                  background: 'var(--color-primary)',
                  color: 'var(--color-text-inverse)',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgb(var(--primary-rgb) / 0.35)',
                }}
                onClick={handleClearConfirmOk}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      <BabysitterBottomNav />
    </div>
  );
}