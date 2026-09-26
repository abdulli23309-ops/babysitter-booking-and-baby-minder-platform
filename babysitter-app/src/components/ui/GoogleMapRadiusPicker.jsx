import { useState, useCallback, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Location + radius picker on Leaflet / OpenStreetMap tiles (free, no API key).
 * Emits via onLocationChange({ latitude, longitude, radiusKm }) only after the
 * user explicitly places/moves the pin — nothing is auto-saved.
 */

const NEUTRAL_CENTER = { lat: 33.6844, lng: 73.0479 }; // Islamabad — navigation only, never persisted as a selection.
const DEFAULT_RADIUS_KM = 3;
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 15;
const RADIUS_STEP_KM = 0.5;

// Bundler-safe custom pin icon (avoids Leaflet default-asset URL issues).
const pinIcon = L.divIcon({
  className: "",
  html: '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;background:#E8622A;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;"><div style="width:8px;height:8px;border-radius:50%;background:#fff;transform:rotate(45deg);"></div></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

const geoErrorMessage = (err) => {
  if (!err) return "Location could not be determined. Search for your area or drop the pin manually.";
  switch (err.code) {
    case 1:
      return "Location permission denied. Click the padlock / site-settings icon in the browser address bar, set Location to Allow, then retry — or search for your area below.";
    case 2:
      return "Your location is currently unavailable (GPS/network). Search for your area or drop the pin manually.";
    case 3:
      return "Getting your location timed out. Retry Use-my-location or drop the pin manually.";
    default:
      return "Location could not be determined. Search for your area or drop the pin manually.";
  }
};

// ── Nominatim (free OSM geocoder) ─────────────────────────────────────────────
async function nominatimReverse(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=14&addressdetails=1&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("reverse geocode failed");
  return res.json();
}

async function nominatimSearch(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("search failed");
  return res.json();
}

const clampRadius = (value) => {
  const num = Number(value);
  if (Number.isNaN(num)) return DEFAULT_RADIUS_KM;
  const v = Math.round((num + Number.EPSILON) * 10) / 10;
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, v));
};

// Helper children: map click + recenter-on-trigger.
function MapEvents({ onClick }) {
  useMapEvents({
    click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}

function Recenter({ position, trigger }) {
  const map = useMap();
  useEffect(() => {
    if (position && trigger) map.setView([position.lat, position.lng], 14);
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function GoogleMapRadiusPicker({
  center,
  initialCenter = NEUTRAL_CENTER,
  radiusKm = DEFAULT_RADIUS_KM,
  onRadiusChange,
  onLocationChange,
  onAreaDetected,
  onGeoStatus,
}) {
  const [position, setPosition] = useState(center ?? initialCenter);
  const [geoMessage, setGeoMessage] = useState("");
  const [geoLoading, setGeoLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [recenterTrigger, setRecenterTrigger] = useState(0);
  const lastCenterRef = useRef(center ?? initialCenter);
  const userMovedRef = useRef(false);
  const reverseTimerRef = useRef(null);
  const lastReverseRef = useRef(0);

  // External center changes (e.g. restored availability) recenter the pin
  // unless the user already picked a spot manually.
  useEffect(() => {
    if (center && !userMovedRef.current) {
      const changed =
        Math.abs(center.lat - lastCenterRef.current.lat) > 1e-7 ||
        Math.abs(center.lng - lastCenterRef.current.lng) > 1e-7;
      if (changed) {
        lastCenterRef.current = center;
        setPosition(center);
        // Phase 8P: without this the marker moves but the map stays on
        // whatever center MapContainer mounted with (react-leaflet's
        // `center` prop is mount-only, so <Recenter> is the only way to
        // follow an external prop change).
        setRecenterTrigger((t) => t + 1);
      }
    }
  }, [center]);

  useEffect(() => () => reverseTimerRef.current && clearTimeout(reverseTimerRef.current), []);

  const [prevRadiusKm, setPrevRadiusKm] = useState(radiusKm);
  const [radiusKmState, setRadiusKmState] = useState(() => clampRadius(radiusKm));
  if (radiusKm !== prevRadiusKm) {
    setPrevRadiusKm(radiusKm);
    setRadiusKmState(clampRadius(radiusKm));
  }

  const reportGeo = useCallback(
    (status, message) => {
      if (onGeoStatus) onGeoStatus(status, message);
      setGeoMessage(message || "");
    },
    [onGeoStatus]
  );

  // Reverse geocode with polite Nominatim pacing (≥1s between requests).
  const performReverseGeocode = useCallback(
    (coords) => {
      if (!onAreaDetected) return;
      if (reverseTimerRef.current) clearTimeout(reverseTimerRef.current);
      reverseTimerRef.current = setTimeout(async () => {
        try {
          const now = Date.now();
          const wait = Math.max(0, 1000 - (now - lastReverseRef.current));
          if (wait) await new Promise((r) => setTimeout(r, wait));
          lastReverseRef.current = Date.now();
          const data = await nominatimReverse(coords.lat, coords.lng);
          const a = data?.address ?? {};
          const area = a.suburb || a.neighbourhood || a.city_district || a.village || a.town || "";
          const city = a.city || a.town || a.village || a.county || "";
          const label = [area, city].filter(Boolean).join(", ");
          if (label) onAreaDetected(label, coords);
        } catch {
          // Failure-safe: keep pin coordinates; leave existing City untouched.
        }
      }, 350);
    },
    [onAreaDetected]
  );

  const commit = useCallback(
    (coords) => {
      lastCenterRef.current = coords;
      setPosition(coords);
      setRecenterTrigger((t) => t + 1);
      if (onLocationChange) onLocationChange(coords);
      performReverseGeocode(coords);
    },
    [onLocationChange, performReverseGeocode]
  );

  const handleMapClick = useCallback(
    (coords) => {
      userMovedRef.current = true;
      setSearchResults([]);
      reportGeo("manual", "");
      commit(coords);
    },
    [commit, reportGeo]
  );

  const handleMarkerDragEnd = useCallback(
    (e) => {
      const { lat, lng } = e.target.getLatLng();
      userMovedRef.current = true;
      reportGeo("manual", "");
      commit({ lat, lng });
    },
    [commit, reportGeo]
  );

  // "Use my location": 10s timeout, distinct error messages per failure code.
  // On ANY failure we keep the neutral navigation center and never save a
  // default pin — the user must place/confirm the location manually.
  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      reportGeo(
        "unsupported",
        "Geolocation is not supported by this browser. Search for your area below or drop the pin on the map."
      );
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false);
        userMovedRef.current = true;
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPosition(coords);
        lastCenterRef.current = coords;
        reportGeo("success", "");
        if (onLocationChange) onLocationChange(coords);
        performReverseGeocode(coords);
      },
      (err) => {
        setGeoLoading(false);
        // err.code: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
        reportGeo(err?.code === 1 ? "denied" : "error", geoErrorMessage(err));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, [onLocationChange, performReverseGeocode, reportGeo]);

  // Nominatim free-text search fallback (replaces Places Autocomplete).
  const handleSearchSubmit = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError("");
    try {
      const results = await nominatimSearch(q);
      if (!results || results.length === 0) {
        setSearchResults([]);
        setSearchError("No matching place found. Try a more specific search or drop the pin manually.");
        return;
      }
      setSearchResults(
        results.map((r) => ({
          display: r.display_name,
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
        }))
      );
    } catch {
      setSearchError("Location search is temporarily unavailable. Please drop the pin on the map manually.");
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const handleSearchPick = useCallback(
    (result) => {
      userMovedRef.current = true;
      setSearchResults([]);
      setSearchError("");
      reportGeo("manual", "");
      commit({ lat: result.lat, lng: result.lng });
    },
    [commit, reportGeo]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Search + Use-my-location toolbar (Nominatim / OSM — no API key) */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearchSubmit();
          }}
          placeholder="Search for your area (e.g. F-6 Islamabad)"
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: 12,
            borderRadius: "10px",
            border: "1px solid var(--color-border, #ddd)",
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={handleSearchSubmit}
          disabled={searching}
          style={{
            whiteSpace: "nowrap",
            fontSize: 11,
            fontWeight: 700,
            color: "var(--color-text-secondary, #555)",
            background: "var(--color-surface, #f7f7f7)",
            border: "1px solid var(--color-border, #ddd)",
            borderRadius: "10px",
            padding: "4px 10px",
            cursor: searching ? "wait" : "pointer",
          }}
        >
          {searching ? "Searching…" : "Search"}
        </button>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={geoLoading}
          style={{
            whiteSpace: "nowrap",
            fontSize: 11,
            fontWeight: 700,
            color: "var(--color-primary)",
            background: "var(--color-primary-soft, var(--color-primary-tint))",
            border: "1px solid var(--color-primary)",
            borderRadius: "10px",
            padding: "4px 10px",
            cursor: geoLoading ? "wait" : "pointer",
          }}
        >
          {geoLoading ? "Locating…" : "Use my location"}
        </button>
      </div>

      {searchError && (
        <span style={{ fontSize: 11, color: "var(--color-warning-strong)", fontWeight: 600 }}>{searchError}</span>
      )}
      {searchResults.length > 0 && (
        <div
          style={{
            border: "1px solid var(--color-border, #ddd)",
            borderRadius: "10px",
            maxHeight: 150,
            overflowY: "auto",
          }}
        >
          {searchResults.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSearchPick(r)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                fontSize: 11,
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--color-border, #eee)",
                cursor: "pointer",
              }}
            >
              📍 {r.display}
            </button>
          ))}
        </div>
      )}

      {/* Real interactive Leaflet map — OpenStreetMap tiles, no API key. */}
      <MapContainer
        center={[position.lat, position.lng]}
        zoom={13}
        style={{ width: "100%", height: "250px", borderRadius: "16px", overflow: "hidden" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapEvents onClick={handleMapClick} />
        <Recenter position={position} trigger={recenterTrigger} />
        <Marker
          position={[position.lat, position.lng]}
          icon={pinIcon}
          draggable
          eventHandlers={{ dragend: handleMarkerDragEnd }}
        />
        <Circle
          center={[position.lat, position.lng]}
          radius={Number(radiusKmState) * 1000}
          pathOptions={{
            fillColor: "var(--color-primary)",
            fillOpacity: 0.15,
            color: "var(--color-primary)",
            opacity: 0.8,
            weight: 2,
          }}
        />
      </MapContainer>

      {/* Radius slider (1–15 km, default 3 km) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="range"
          min={MIN_RADIUS_KM}
          max={MAX_RADIUS_KM}
          step={RADIUS_STEP_KM}
          value={radiusKmState}
          onChange={(e) => {
          const val = clampRadius(e.target.value);
          setRadiusKmState(val);
          onRadiusChange && onRadiusChange(val);
        }}
          style={{ flex: 1, accentColor: "var(--color-primary)" }}
          aria-label="Service radius in kilometers"
        />
        <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
          📏 {Number(radiusKmState).toFixed(1)} km
        </span>
      </div>

      {/* Specific geolocation feedback (denied / unavailable / timeout) */}
      {geoMessage && (
        <span style={{ fontSize: 11, color: "var(--color-warning-strong)", fontWeight: 600 }}>{geoMessage}</span>
      )}
    </div>
  );
}


