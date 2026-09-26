import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useToast } from './ToastContext';
import styles from './location-point-picker.module.css';

/**
 * Parent-side location point picker (Phase F-UI-15).
 * Unlike MapRadiusPicker (shared with the sitter's availability screen),
 * this component has NO radius circle — parents pin an exact home location.
 * Features: draggable pin, GPS "locate me" FAB, Nominatim reverse geocoding.
 */

const customPinIcon = L.divIcon({
  className: 'custom-leaflet-pin',
  html: `
    <div style="
      position: relative;
      width: 32px;
      height: 32px;
      background: #E8622A;
      border: 3px solid #FFFFFF;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 0 4px 14px rgba(232, 98, 42, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    ">
      <div style="
        width: 10px;
        height: 10px;
        background: #FFFFFF;
        border-radius: 50%;
        transform: rotate(45deg);
      "></div>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

/** Captures map clicks (click-to-place the home pin). */
function MapEventsHandler({ onPick }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function MapRecenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && typeof center.lat === 'number' && typeof center.lng === 'number') {
      map.setView([center.lat, center.lng], map.getZoom(), { animate: true });
    }
  }, [center, map]);
  return null;
}

export default function LocationPointPicker({
  center = { lat: 33.6844, lng: 73.0479 },
  value,
  onChange,
  onResolved,
  showSearch = false,
  showMap = true,
}) {
  const toast = useToast();
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  // Flip to true once the newest reverse-geocode resolves; earlier callbacks
  // that finish late check this and abort instead of overwriting a newer result.
  const resolvedRef = useRef(false);
  // Latest resolved address text for the live-pin display.
  const [resolvedAddress, setResolvedAddress] = useState('');


  const activePosition =
    value && typeof value.lat === 'number' && typeof value.lng === 'number'
      ? value
      : center;

  const lat = activePosition?.lat ?? 33.6844;
  const lng = activePosition?.lng ?? 73.0479;

  /**
   * Reverse geocode via free Nominatim (OpenStreetMap) — no API key needed.
   * Extracts the closest human-readable address plus the broader city.
   * Gracefully handles failures (ocean pins, network errors, rate limits).
   */
  const resolveAddress = useCallback(
    async (point) => {
      try {
        const url =
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
          `&lat=${point.lat}&lon=${point.lng}&zoom=16&addressdetails=1`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`Nominatim ${res.status}`);
        const data = await res.json();
        const a = data?.address || {};
        const city =
          a.city || a.town || a.village || a.municipality || a.county || null;
        const label =
          data?.display_name ||
          [a.road, a.suburb, a.neighbourhood].filter(Boolean).join(', ') ||
          null;
        if (!label && !city) throw new Error('No address found');
        return { lat: point.lat, lng: point.lng, address: label, city };
      } catch {
        // Graceful degradation: pin still lands, only the label/city stay stale.
        return { lat: point.lat, lng: point.lng, address: null, city: null };
      }
    },
    []
  );

  /** Single entry point for any new pin location (map click, drag, GPS). */
  const handleNewPoint = useCallback(
    async (point) => {
      if (!point || typeof point.lat !== 'number') return;
      if (onChange) onChange({ lat: point.lat, lng: point.lng });
      const resolved = await resolveAddress(point);
      if (resolvedRef.current) return; // a newer pick superseded this one
      if (onResolved) onResolved(resolved);
      setResolvedAddress(resolved.address || resolved.city || '');
      if (resolved.address || resolved.city) {
        toast.success(resolved.city ? `Location set: ${resolved.city}` : 'Location set');
      } else {
        toast.info('Pin placed — address lookup unavailable here.');
      }
    },
    [onChange, onResolved, resolveAddress, toast]
  );

  /** Forward geocode via Nominatim — search an area name and show results dropdown. */
  const handleSearch = useCallback(async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const url =
        `https://nominatim.openstreetmap.org/search?format=jsonv2` +
        `&q=${encodeURIComponent(query.trim())}&limit=5`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en' },
      });
      if (!res.ok) throw new Error(`Nominatim search failed (${res.status})`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        toast.warning('No results found. Try a different area name.');
        return;
      }
      setSearchResults(
        data.map((r) => ({
          display: r.display_name,
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
        }))
      );
    } catch {
      toast.warning('Search failed. Check your connection and try again.');
    } finally {
      setSearching(false);
    }
  }, [query, searching, toast]);

  /** Pick a result from the autocomplete dropdown — drop the pin and update LIVE PIN. */
  const handleSearchPick = useCallback(
    (result) => {
      setSearchResults([]);
      resolvedRef.current = false;
      handleNewPoint({ lat: result.lat, lng: result.lng });
    },
    [handleNewPoint]
  );

  /** GPS "Locate Me" — pan the map and drop the pin on the live position. */
  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) {
      toast.warning('Geolocation is not supported by this browser.');
      return;
    }
    setLocating(true);
    toast.info('Finding your location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        resolvedRef.current = false;
        handleNewPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        toast.warning('Could not get your location. Drop the pin manually.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [handleNewPoint, toast]);

  return (
    <div className={styles.wrap}>
      {/* Search + GPS — two-row responsive layout to prevent mobile overflow */}
      {showSearch && (
        <div className={styles.searchRow}>
          {/* Row 1: Search Input + Search Button */}
          <div className={styles.searchInputRow}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search for your area..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              aria-label="Search for your area"
            />
            <button
              type="button"
              className={styles.searchBtn}
              onClick={handleSearch}
              disabled={searching || !query.trim()}
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
          {/* Row 2: Use my location (full width below) */}
          <button
            type="button"
            className={styles.gpsBtn}
            onClick={handleLocateMe}
            disabled={locating}
            aria-label="Use my current location"
            title="Use my current location"
          >
            {locating ? (
              <span className={styles.spinner} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="7.5" />
                <line x1="12" y1="1.5" x2="12" y2="4.5" />
                <line x1="12" y1="19.5" x2="12" y2="22.5" />
                <line x1="1.5" y1="12" x2="4.5" y2="12" />
                <line x1="19.5" y1="12" x2="22.5" y2="12" />
              </svg>
            )}
            <span>Use my location</span>
          </button>
        </div>
      )}

      {/* Autocomplete dropdown — shows Nominatim search results */}
      {searchResults.length > 0 && (
        <ul className={styles.searchDropdown}>
          {searchResults.map((r, i) => (
            <li
              key={i}
              className={styles.searchDropdownItem}
              onClick={() => handleSearchPick(r)}
            >
              📍 {r.display}
            </li>
          ))}
        </ul>
      )}

      {/* Map canvas — only rendered when showMap is true; pin-drop only, NO radius circle */}
      {showMap && (
        <>
          <MapContainer
            center={[lat, lng]}
            zoom={13}
            scrollWheelZoom={true}
            className={styles.realMapContainer}
            style={{
              height: '250px',
              width: '100%',
              borderRadius: '12px',
              marginTop: '12px',
              overflow: 'hidden',
              boxShadow: 'inset 0 2px 4px rgb(var(--shadow-ink-rgb) / 0.06)',
            }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Exact home-location pin — draggable, NO radius circle (parent = point, not area) */}
            <Marker
              position={[lat, lng]}
              icon={customPinIcon}
              draggable
              eventHandlers={{
                dragend(e) {
                  const marker = e.target;
                  if (marker) {
                    resolvedRef.current = false;
                    const p = marker.getLatLng();
                    handleNewPoint({ lat: p.lat, lng: p.lng });
                  }
                },
              }}
            />

            <MapRecenter center={{ lat, lng }} />
            <MapEventsHandler onPick={(p) => { resolvedRef.current = false; handleNewPoint(p); }} />
          </MapContainer>

          {/* Coordinates chip — bottom-left (GPS button owns bottom-right) */}
          <div className={styles.coords}>
            {lat.toFixed(4)}, {lng.toFixed(4)}
          </div>
        </>
      )}

      {/* Live Pin Display — shows resolved address or prompt text (BELOW the map) */}
      <div className={styles.livePinDisplay}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span className={styles.livePinText}>
          {resolvedAddress || 'Tap the map or search to set your location'}
        </span>
        {resolvedAddress && (
          <span className={styles.livePinBadge}>LIVE PIN</span>
        )}
      </div>
    </div>
  );
}
