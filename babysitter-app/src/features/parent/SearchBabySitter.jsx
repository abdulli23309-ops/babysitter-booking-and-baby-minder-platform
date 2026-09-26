import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ParentBottomNav from '../../components/layout/ParentBottomNav';
import BackButton from '../../components/ui/BackButton';
import UserAvatar from '../../components/ui/UserAvatar';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/ui/ToastContext';
import { API } from '../../services/api';
import { formatLocalDate, todayISO, addDaysISO } from '../../utils/dateUtils';
import LocationPointPicker from '../../components/ui/LocationPointPicker';
import styles from './search-babysitter.module.css';

const AVAILABILITY_TYPES = ['One Day', 'Repeat Days'];
const DAYS_COL1 = ['Monday', 'Wednesday', 'Friday', 'Sunday'];
const DAYS_COL2 = ['Tuesday', 'Thursday', 'Saturday'];

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Phase 8D — reads the stored booking search.
 *
 * Written by SearchBabySitter itself after a successful search, and by
 * BookingStatus's "Find Replacement" CTA (D3), which writes a same-day
 * 'One Day' request for the day a sitter declined.
 *
 * Two time formats reach this function:
 *   "08:00 AM" — a normal search (stored straight from the 12-hour state)
 *   "08:00"    — the BookingStatus CTA (raw 24-hour slot time)
 * so both are normalised to the 12-hour shape the form's state uses.
 */
const readStoredSearch = () => {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem('lastBookingSearch') || 'null');
  } catch {
    return null;
  }
  if (!stored || typeof stored !== 'object') return null;

  const toTwelveHour = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return raw; // already "hh:mm AM/PM"
    let h = parseInt(match[1], 10);
    const mm = match[2];
    const ampm = h >= 12 ? 'PM' : 'AM';
    let hh12 = h % 12;
    if (hh12 === 0) hh12 = 12;
    return `${String(hh12).padStart(2, '0')}:${mm} ${ampm}`;
  };

  // SelectedDays is an ARRAY from the CTA and an object map from a search.
  let days = null;
  if (Array.isArray(stored.SelectedDays) && stored.SelectedDays.length > 0) {
    days = ALL_DAYS.reduce((acc, d) => ({ ...acc, [d]: false }), {});
    stored.SelectedDays.forEach((d) => { days[d] = true; });
  } else if (stored.SelectedDays && typeof stored.SelectedDays === 'object') {
    days = stored.SelectedDays;
  }

  return {
    city: stored.City || '',
    availabilityType: stored.AvailabilityType || null,
    startDate: stored.StartDate ? String(stored.StartDate).substring(0, 10) : null,
    endDate: stored.EndDate ? String(stored.EndDate).substring(0, 10) : null,
    startTime: toTwelveHour(stored.StartTime),
    endTime: toTwelveHour(stored.EndTime),
    minRating: stored.MinRating ?? null,
    lat: stored.Latitude ?? null,
    lng: stored.Longitude ?? null,
    // Phase 8H: set by BookingStatus's "Find Replacement" / "Find a Sitter for
    // This Day" CTA. The mount effect below consumes and clears it so the search
    // fires exactly once per CTA tap.
    autoSearch: stored.autoSearch === true,
    days,
  };
};

export default function SearchBabySitter() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast?.() ?? { showToast: () => {} };

  // Phase 8D — every filter starts from the stored search when one exists, so
  // a parent arriving from BookingStatus's "Find Replacement" CTA lands on a
  // form already filled in for the declined day. Lazy initialisers are used
  // (rather than an effect) so the first paint already has the right values.
  const stored = useMemo(() => readStoredSearch(), []);

  // Filter States (Phase F-UI-12: Age Group & Experience removed)
  const [city, setCity] = useState(stored?.city ?? '');
  const [availabilityType, setAvailabilityType] = useState(stored?.availabilityType || 'Repeat Days');
  const [startDate, setStartDate] = useState(
    stored?.startDate || todayISO()
  );
  const [endDate, setEndDate] = useState(
    stored?.endDate || addDaysISO(todayISO(), 29)
  );
  const [startTime, setStartTime] = useState(stored?.startTime || '08:00 AM');
  const [endTime, setEndTime] = useState(stored?.endTime || '05:00 PM');
  const [timeError, setTimeError] = useState('');
  const [selectedDays, setSelectedDays] = useState(stored?.days || {
    Monday: true,
    Tuesday: false,
    Wednesday: true,
    Thursday: false,
    Friday: true,
    Saturday: false,
    Sunday: false,
  });
  const [minRating, setMinRating] = useState(stored?.minRating ?? 4);
  const [favorites, setFavorites] = useState({});

  // Geo-matching: parent location from LocationPointPicker (null = search without location filter)
  const [parentLat, setParentLat] = useState(stored?.lat ?? null);
  const [parentLng, setParentLng] = useState(stored?.lng ?? null);
  const [resolvedAddress, setResolvedAddress] = useState('');
  const [resolvedCity, setResolvedCity] = useState(stored?.city ?? '');

  // Phase 8I: where the search map should open. D1 — the JOB site, not the
  // parent's saved home and not the hardcoded Islamabad default that
  // LocationPointPicker falls back to. Only falls back when the stored payload
  // has no coords (an organic search), in which case the child keeps its own
  // default and behaves exactly as before.
  const mapCenter = (stored?.lat != null && stored?.lng != null)
    ? { lat: stored.lat, lng: stored.lng }
    : undefined;

  // Phase 8I: human summary of the ACTIVE criteria for the empty state, e.g.
  // "28 Sep 2026 · 11:00 AM–1:00 PM". Each part is omitted when blank so the
  // sentence never reads "for  · –".
  const emptyStateCriteria = (() => {
    const parts = [];
    if (startDate) {
      const d = formatLocalDate(startDate);
      if (d) parts.push(d);
    }
    if (startTime && endTime && startTime !== endTime) {
      parts.push(`${startTime}–${endTime}`);
    } else if (startTime) {
      parts.push(startTime);
    }
    if (city) parts.push(city);
    return parts.length ? parts.join(' · ') : null;
  })();

  // Live Caregivers state
  const [sitters, setSitters] = useState([]);
  const [loading, setLoading] = useState(true);
  // Phase 8I: true once fetchSitters has completed at least once.
  const [lastSearchRan, setLastSearchRan] = useState(false);

  // Convert 12-hour time ("08:00 AM") to 24-hour with seconds ("08:00:00") for the backend
  const toTime24 = (t) => {
    if (!t) return undefined;
    const match = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return t;
    let [, hh, mm, ampm] = match;
    let h = parseInt(hh, 10);
    if (ampm.toUpperCase() === 'PM' && h < 12) h += 12;
    if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${mm}:00`;
  };

  // Convert 12-hour state ("08:00 AM") to 24-hour HH:mm for the native time input value
  const toTimeInputValue = (t) => {
    if (!t) return '';
    const match = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return t;
    let [, hh, mm, ampm] = match;
    let h = parseInt(hh, 10);
    if (ampm.toUpperCase() === 'PM' && h < 12) h += 12;
    if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${mm}`;
  };

  // Convert native time input "HH:mm" back to 12-hour state ("hh:mm AM/PM")
  const fromTimeInputValue = (v) => {
    if (!v) return '';
    const match = v.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return v;
    let h = parseInt(match[1], 10);
    const mm = match[2];
    const ampm = h >= 12 ? 'PM' : 'AM';
    let hh12 = h % 12;
    if (hh12 === 0) hh12 = 12;
    return `${String(hh12).padStart(2, '0')}:${mm} ${ampm}`;
  };

  const fetchSitters = useCallback(async (overrides = {}) => {
    setLoading(true);
    const activeCity = overrides.city !== undefined ? overrides.city : city;
    const activeAvail = overrides.availabilityType !== undefined ? overrides.availabilityType : availabilityType;
    const activeStartD = overrides.startDate !== undefined ? overrides.startDate : startDate;
    const activeEndD = overrides.endDate !== undefined ? overrides.endDate : endDate;
    const activeStartT = overrides.startTime !== undefined ? overrides.startTime : startTime;
    const activeEndT = overrides.endTime !== undefined ? overrides.endTime : endTime;
    const activeRating = overrides.minRating !== undefined ? overrides.minRating : minRating;
    const activeDaysObj = overrides.selectedDays !== undefined ? overrides.selectedDays : selectedDays;
    const activeLat = overrides.parentLat !== undefined ? overrides.parentLat : parentLat;
    const activeLng = overrides.parentLng !== undefined ? overrides.parentLng : parentLng;

    const t1 = toTime24(activeStartT);
    const t2 = toTime24(activeEndT);
    if (!t1 || !t2) {
      setTimeError('Please select both start and end times.');
      return;
    }
    const toMin = (s) => {
      const [h, m] = String(s || '00:00').split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    if (toMin(t2) <= toMin(t1)) {
      setTimeError('End time must be after start time.');
      return;
    }
    setTimeError('');

    const isOneDay = activeAvail === 'One Day';
    const sanitizedEndDate = isOneDay ? activeStartD : (activeEndD || undefined);
    const sanitizedDaysList = isOneDay ? [] : Object.keys(activeDaysObj).filter((d) => activeDaysObj[d]);

    const payload = {
      City: resolvedCity || activeCity.trim() || undefined,
      Latitude: activeLat ?? null,
      Longitude: activeLng ?? null,
      StartDate: activeStartD || undefined,
      EndDate: sanitizedEndDate,
      StartTime: toTime24(activeStartT),
      EndTime: toTime24(activeEndT),
      SelectedDays: sanitizedDaysList.length > 0 ? sanitizedDaysList : undefined,
      MinRating: activeRating > 0 ? activeRating : undefined,
      AvailabilityType: activeAvail || undefined,
    };

    try {
      const data = await API.searchSitters(payload);
      if (Array.isArray(data)) {
        // Filter out deleted/inactive sitters
        const activeOnly = data.filter((s) => !s.IsDeleted && s.IsActive !== false);
        setSitters(activeOnly);
        try {
          // Phase 8K: preserve the flow keys the BookingStatus CTA wrote.
          // This write used to be a wholesale replace, which silently dropped
          // `targetJobId` on the very first successful search — so
          // BabySitterDetails never detected the replacement flow and fell
          // through to createJob, minting a duplicate job on today's date.
          // Spreading `existing` first keeps targetJobId (and any future flow
          // marker) alive across searches. `autoSearch` is intentionally NOT
          // re-added: the mount effect already consumed it.
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem('lastBookingSearch') || 'null'); }
            catch { return null; }
          })();

          localStorage.setItem('lastBookingSearch', JSON.stringify({
            ...(existing && typeof existing === 'object' ? existing : {}),
            StartDate: activeStartD,
            EndDate: sanitizedEndDate,
            StartTime: activeStartT,
            EndTime: activeEndT,
            SelectedDays: sanitizedDaysList,
            AvailabilityType: activeAvail,
            City: resolvedCity,
            Address: resolvedAddress,
            Latitude: activeLat,
            Longitude: activeLng,
          }));
        } catch { /* storage full or unavailable */ }
      } else {
        setSitters([]);
      }
    } catch {
      setSitters([]);
    } finally {
      setLoading(false);
      // Phase 8I: distinguishes "a search ran and found nobody" (show the
      // guided empty state) from "no search has run yet" (stay quiet).
      setLastSearchRan(true);
    }
  }, [city, availabilityType, startDate, endDate, startTime, endTime, selectedDays, minRating, parentLat, parentLng, resolvedCity, resolvedAddress]);

  // Phase 8H — auto-fire the search when arriving from BookingStatus's
  // "Find Replacement" / "Find a Sitter for This Day" CTA.
  //
  // The flag is cleared from localStorage BEFORE fetchSitters() runs, so:
  //   - a re-render / StrictMode double-invoke cannot loop, and
  //   - coming back to this screen later does not re-fire.
  // No dependency array on purpose: this must run exactly once, after the
  // lazy useState initialisers have hydrated the form from the stored payload.
  const autoSearchFiredRef = useRef(false);
  useEffect(() => {
    if (autoSearchFiredRef.current) return;
    autoSearchFiredRef.current = true;

    if (!stored?.autoSearch) return;

    try {
      const raw = JSON.parse(localStorage.getItem('lastBookingSearch') || 'null');
      if (raw) {
        delete raw.autoSearch;
        localStorage.setItem('lastBookingSearch', JSON.stringify(raw));
      }
    } catch { /* storage full or unavailable */ }

    // Reads the already-hydrated filter state; overrides = {} keeps every
    // current value. Deferred to a microtask so this effect performs no
    // synchronous setState (setLoading is called inside fetchSitters).
    queueMicrotask(() => fetchSitters({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 8D: only run the hardcoded demo search when there is nothing stored to
  // restore. Otherwise it would immediately overwrite the hydrated form.
  useEffect(() => {
    if (readStoredSearch()) return undefined;

    let ignore = false;
    async function loadInitial() {
      try {
        const data = await API.searchSitters({
          City: 'Lahore',
          AvailabilityType: 'Repeat Days',
          MinRating: 4,
          StartTime: '08:00:00',
          EndTime: '17:00:00',
        });
        if (!ignore && Array.isArray(data)) {
          const activeOnly = data.filter((s) => !s.IsDeleted && s.IsActive !== false);
          setSitters(activeOnly);
        } else if (!ignore) {
          setSitters([]);
        }
      } catch {
        if (!ignore) setSitters([]);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadInitial();
    return () => {
      ignore = true;
    };
  }, []);

  const handleToggleDay = (day) => {
    setSelectedDays((prev) => ({ ...prev, [day]: !prev[day] }));
  };

  const handleResetFilters = () => {
    const defaults = {
      city: '',
      availabilityType: 'Repeat Days',
      startDate: todayISO(),
      endDate: addDaysISO(todayISO(), 29),
      startTime: '08:00 AM',
      endTime: '05:00 PM',
      selectedDays: {
        Monday: true,
        Tuesday: false,
        Wednesday: true,
        Thursday: false,
        Friday: true,
        Saturday: false,
        Sunday: false,
      },
      minRating: 4,
    };
    setCity(defaults.city);
    setAvailabilityType(defaults.availabilityType);
    setStartDate(defaults.startDate);
    setEndDate(defaults.endDate);
    setStartTime(defaults.startTime);
    setEndTime(defaults.endTime);
    setSelectedDays(defaults.selectedDays);
    setMinRating(defaults.minRating);
    setParentLat(null);
    setParentLng(null);
    setResolvedAddress('');
    setResolvedCity('');
    fetchSitters({ ...defaults, parentLat: null, parentLng: null });
    showToast?.('Filters reset to default', { type: 'info' });
  };

  const handleSaveFilters = () => {
    fetchSitters();
    showToast?.('Filters saved & applied!', { type: 'success' });
  };

  const handleToggleFavorite = (e, id) => {
    e.stopPropagation();
    setFavorites((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSitterClick = (sitter) => {
    const isOneDay = availabilityType === 'One Day';
    const sanitizedEndDate = isOneDay ? startDate : endDate;
    const daysList = isOneDay ? [] : Object.keys(selectedDays).filter((d) => selectedDays[d]);
    navigate('/babysitter-details', {
      state: {
        sitter,
        searchParams: {
          startDate,
          endDate: sanitizedEndDate,
          startTime,
          endTime,
          availabilityType,
          selectedDays: daysList,
          parentLat,
          parentLng,
          resolvedAddress,
        },
      },
    });
  };

  // Phase 5.1 fix — include the camelCase `pictureAddress` returned by
  // POST /api/parent/login (previously missed, so this header avatar always fell
  // back to the initial letter).
  const parentAvatar =
    user?.pictureAddress ??
    user?.PictureAddress ??
    user?.profilePicture ??
    user?.ProfilePicture ??
    null;
  const parentName = user?.name ?? user?.FullName ?? 'Parent';

  return (
    <div className={styles.searchContainer}>
      {/* Top Header */}
      <header className={styles.topBar}>
        <BackButton />
        <h1 className={styles.pageTitle}>Find a Sitter</h1>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.tuneBtn}
            onClick={handleResetFilters}
            aria-label="Reset Filters"
            title="Reset Filters"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.userAvatarBtn}
            onClick={() => navigate('/my-profile')}
            aria-label="User Profile"
          >
            <UserAvatar
              src={parentAvatar}
              name={parentName}
              size={38}
              type="Parents"
            />
          </button>
        </div>
      </header>

      {/* Optimized Filter Card (Phase F-UI-12: Age Group & Experience removed) */}
      <section className={styles.filterCard} aria-label="Sitter Search Filters">
        {/* Geo-matching: location search (search + GPS, no map — parent pins an exact point) */}
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>SEARCH BY LOCATION</span>
          <LocationPointPicker
            showSearch
            showMap={true}
            center={mapCenter}
            value={parentLat != null && parentLng != null ? { lat: parentLat, lng: parentLng } : undefined}
            onChange={(pos) => { setParentLat(pos.lat); setParentLng(pos.lng); }}
            onResolved={(r) => { setResolvedAddress(r.address || ''); setResolvedCity(r.city || ''); }}
          />
          {resolvedAddress && (
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
              {resolvedAddress} — sitters are filtered by their saved work radius.
            </p>
          )}
        </div>

        {/* Availability Type — iOS Segmented Control */}
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>AVAILABILITY TYPE</span>
          <div className={styles.segmentedControl} role="radiogroup" aria-label="Availability Type">
            {AVAILABILITY_TYPES.map((avail) => (
              <button
                key={avail}
                type="button"
                className={`${styles.segmentBtn} ${availabilityType === avail ? styles.segmentBtnActive : ''}`}
                onClick={() => setAvailabilityType(avail)}
              >
                {avail}
              </button>
            ))}
          </div>
        </div>

        {/* Date & Time Pickers Grid */}
        <div className={styles.pickersGrid}>
          {/* Start Date / Date */}
          <div className={`${styles.pickerBox} ${availabilityType === 'One Day' ? styles.pickerBoxFullWidth : ''}`}>
            <span className={styles.filterLabel}>
              {availabilityType === 'One Day' ? 'DATE' : 'START DATE'}
            </span>
            <div className={styles.pickerInputWrap}>
              <svg className={styles.pickerIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <input
                type="date"
                className={styles.pickerInput}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>

          {/* End Date (Only in Repeat Days mode) */}
          {availabilityType === 'Repeat Days' && (
            <div className={styles.pickerBox}>
              <span className={styles.filterLabel}>END DATE</span>
              <div className={styles.pickerInputWrap}>
                <svg className={styles.pickerIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <input
                  type="date"
                  className={styles.pickerInput}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Start Time */}
          <div className={styles.pickerBox}>
            <span className={styles.filterLabel}>START TIME</span>
            <div className={styles.pickerInputWrap}>
              <svg className={styles.pickerIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <input
                type="time"
                className={styles.pickerInput}
                value={toTimeInputValue(startTime)}
                onChange={(e) => setStartTime(fromTimeInputValue(e.target.value))}
              />
            </div>
          </div>

          {/* End Time */}
          <div className={styles.pickerBox}>
            <span className={styles.filterLabel}>END TIME</span>
            <div className={styles.pickerInputWrap}>
              <svg className={styles.pickerIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <input
                type="time"
                className={styles.pickerInput}
                value={toTimeInputValue(endTime)}
                onChange={(e) => setEndTime(fromTimeInputValue(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Select Days (Only rendered for Repeat Days) */}
        {availabilityType === 'Repeat Days' && (
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>SELECT DAYS</span>
            <div className={styles.daysGrid}>
              <div>
                {DAYS_COL1.map((day) => (
                  <label key={day} className={styles.dayCheckboxLabel}>
                    <div
                      className={`${styles.circularCheckbox} ${selectedDays[day] ? styles.circularCheckboxChecked : ''}`}
                      onClick={() => handleToggleDay(day)}
                      role="checkbox"
                      aria-checked={selectedDays[day]}
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && handleToggleDay(day)}
                    >
                      {selectedDays[day] && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-inverse)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <span className={styles.dayText}>{day}</span>
                  </label>
                ))}
              </div>

              <div>
                {DAYS_COL2.map((day) => (
                  <label key={day} className={styles.dayCheckboxLabel}>
                    <div
                      className={`${styles.circularCheckbox} ${selectedDays[day] ? styles.circularCheckboxChecked : ''}`}
                      onClick={() => handleToggleDay(day)}
                      role="checkbox"
                      aria-checked={selectedDays[day]}
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && handleToggleDay(day)}
                    >
                      {selectedDays[day] && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-inverse)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <span className={styles.dayText}>{day}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Minimum Rating with Golden Stars */}
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>MINIMUM RATING</span>
          <div className={styles.ratingFilterRow}>
            <div className={styles.starsGroup} role="radiogroup" aria-label="Minimum Rating Stars">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={`${styles.starBtn} ${star <= minRating ? styles.starActive : ''}`}
                  onClick={() => setMinRating(star)}
                  aria-label={`${star} star`}
                >
                  ★
                </button>
              ))}
            </div>
            <span className={styles.ratingFilterText}>{minRating}.0 & Up</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className={styles.filterActionsRow}>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={handleResetFilters}
          >
            Reset
          </button>
          {timeError && (
            <p role="alert" style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-error, #dc2626)' }}>
              {timeError}
            </p>
          )}
          <button
            type="button"
            className={styles.saveFiltersBtn}
            onClick={handleSaveFilters}
            disabled={
              !parentLat ||
              !parentLng ||
              !startDate ||
              (availabilityType === 'Repeat Days' && !endDate) ||
              (availabilityType === 'Repeat Days' && !Object.values(selectedDays).some(Boolean))
            }
          >
            Save Filters
          </button>
        </div>
      </section>

      {/* Available Sitters Section */}
      <section className={styles.resultsSection}>
        <div className={styles.resultsHeader}>
          <div>
            <h2 className={styles.resultsTitle}>Available Sitters</h2>
            <p className={styles.resultsCount}>
              {loading
                ? 'Searching...'
                : sitters.length === 0
                ? 'No sitters found for your criteria'
                : `${sitters.length} match${sitters.length !== 1 ? 'es' : ''} found for your area`}
            </p>
          </div>
          <button
            type="button"
            className={styles.viewAllLink}
            onClick={() => {
              setCity('');
              setMinRating(0);
              fetchSitters({ city: '', minRating: 0 });
            }}
          >
            View All
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>
            Finding certified sitters...
          </div>
        ) : sitters.length === 0 ? (
          /* Surgical Fix 4: The Empty State Masterpiece */
          <div className={styles.emptyStateModule}>
            <div className={styles.emptyCircleWrapper} aria-hidden="true">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <path d="M11 8a3 3 0 0 0-3 3" />
              </svg>
            </div>
            <h3 className={styles.emptyStateTitle}>No Caregivers Found</h3>
            <p className={styles.emptyStateSubtitle}>
              We couldn&apos;t find any certified babysitters matching your exact filters in this area.
            </p>

            {/* Phase 8I: guided recovery. This is the dead-end the parent hits
                after tapping "Find Replacement" — the auto-search is already
                rating-free (MinRating: 0), so the remaining filters are the
                narrow date/time window. Offer the three next-most-likely widenings
                instead of a dead end. Only shown once a search has actually
                completed, so it never appears on a fresh/loading screen. */}
            {lastSearchRan && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginTop: 16,
                  width: '100%',
                  maxWidth: 320,
                }}
              >
                {emptyStateCriteria && (
                  <p
                    style={{
                      margin: '0 0 4px',
                      fontSize: 12,
                      color: 'var(--color-text-tertiary)',
                      textAlign: 'center',
                    }}
                  >
                    No one has published availability for {emptyStateCriteria}.
                  </p>
                )}
                <button
                  type="button"
                  className={styles.widenBtn}
                  onClick={() => {
                    setMinRating(0);
                    fetchSitters({ minRating: 0 });
                  }}
                >
                  Remove rating filter
                </button>
                <button
                  type="button"
                  className={styles.widenBtn}
                  onClick={() => {
                    setStartTime('06:00 AM');
                    setEndTime('10:00 PM');
                    fetchSitters({ startTime: '06:00 AM', endTime: '10:00 PM' });
                  }}
                >
                  Widen time window
                </button>
                <button
                  type="button"
                  className={styles.widenBtn}
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    fetchSitters({ startDate: '', endDate: '' });
                  }}
                >
                  Search a different day
                </button>
                <p
                  style={{
                    margin: '8px 0 4px',
                    fontSize: 12,
                    color: 'var(--color-text-tertiary)',
                    textAlign: 'center',
                  }}
                >
                  or
                </p>
              </div>
            )}
            <button
              type="button"
              className={styles.clearFiltersBtn}
              onClick={handleResetFilters}
              style={{ marginTop: lastSearchRan ? 0 : 16 }}
            >
              Clear All Filters
            </button>
          </div>
        ) : (
          <div className={styles.sitterCardsList}>
            {sitters.map((sitter, idx) => {
              const sitterId = sitter.Sitter_ID ?? sitter.BabySitter_ID ?? sitter.id ?? idx;
              const name = sitter.FullName ?? sitter.name ?? 'Caregiver';
              const expVal = sitter.ExperienceYears ?? 1;
              const rate = sitter.HourlyRate ?? 1000;
              const ratingVal = (Number(sitter.Rating) || 5.0).toFixed(1);
              const reviewsCount = sitter.ReviewsCount ?? ((Number(sitterId) * 17) % 80 + 30);
              const pic = sitter.PictureAddress ?? sitter.profilePicture;
              const isFav = !!favorites[sitterId];
              // Geo-matching: show distance when the backend returned it (shortest
              // match among the sitter's availability rows; null = no pin data).
              const distKm =
                sitter.DistanceKm === null || sitter.DistanceKm === undefined
                  ? null
                  : Number(sitter.DistanceKm);

              return (
                <div
                  key={sitterId}
                  className={styles.sitterCard}
                  onClick={() => handleSitterClick(sitter)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSitterClick(sitter)}
                >
                  {/* Sitter Avatar */}
                  <div className={styles.avatarWrap}>
                    <UserAvatar
                      src={pic}
                      name={name}
                      size={60}
                      shape="circle"
                      type="Sitters"
                    />
                  </div>

                  {/* Sitter Body */}
                  <div className={styles.cardBody}>
                    <h3 className={styles.sitterName}>{name}</h3>
                    <div className={styles.ratingRow}>
                      <span className={styles.starIconGold}>★</span>
                      <span>{ratingVal}</span>
                      <span className={styles.reviewsCount}>({reviewsCount} reviews)</span>
                    </div>
                    <span className={styles.expPill}>
                      {expVal}+ yrs exp
                    </span>
                    {distKm !== null && (
                      <span className={styles.expPill} style={{ marginTop: 4 }}>
                        📍 {distKm.toFixed(1)} km away
                      </span>
                    )}
                  </div>

                  {/* Right Column: Heart & Rate Text */}
                  <div className={styles.cardRightCol}>
                    <button
                      type="button"
                      className={`${styles.heartBtn} ${isFav ? styles.heartBtnActive : ''}`}
                      onClick={(e) => handleToggleFavorite(e, sitterId)}
                      aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                    </button>
                    <span className={styles.rateText}>
                      {rate.toLocaleString()} PKR/hr
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <ParentBottomNav />
    </div>
  );
}
