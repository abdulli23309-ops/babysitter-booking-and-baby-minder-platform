# GEO-MATCHING INTEGRATION REPORT

**Policy:** Commit-gated on build verification only. Live browser smoke test is **deferred to human — see checklist at end**. No HTTP status codes were fabricated.

## 1. Database (Step 1 — EXECUTED)
`docs/database/add_geo_columns.sql` (idempotent `IF NOT EXISTS` guards) executed via sqlcmd against `DESKTOP-UD649GB\SQLEXPRESS` / `BabySitterBooking and BabyMinder`. All **7 columns verified present** via `sys.columns` query:
- `SitterAvailability`: `Latitude`, `Longitude`, `RadiusKm` (FLOAT NULL)
- `Job`: `Latitude`, `Longitude` (FLOAT NULL)
- `Parent`: `Latitude`, `Longitude` (FLOAT NULL)

No other column added; none dropped/renamed; **EDMX untouched** (no `Model1.edmx`, `Model1.Context.cs`, `.tt` changes).

## 2. Backend Changes (Steps 2–6)
| File | Change |
|---|---|
| `Infrastructure/GeoHelper.cs` (new) | `HaversineDistanceKm(lat1,lon1,lat2,lon2)` — pure C#, Earth radius 6371 km. Added to `.csproj`. |
| `DTOs/AvailabilityDto.cs` | Additive `Latitude`/`Longitude`/`RadiusKm` (nullable). New public `SitterAvailabilityCoordsDto` (public parameterless ctor + public settable props — required by `SqlQuery<T>`). |
| `DTOs/CreateJobDto.cs` | Additive `Latitude`/`Longitude`. |
| `DTOs/SearchSittersDTO.cs` | Additive `Latitude`/`Longitude`. |
| `DTOs/JobDTOs.cs` | `SitterDTO.DistanceKm` (nullable, additive). |
| `Services/Interfaces/IAvailabilityService.cs` | `GetAvailabilityLocations(ids)` returning `Dictionary<int, SitterAvailabilityCoordsDto>` (refinement #2 Option B). |
| `Services/Implementations/AvailabilityService.cs` | `SaveAvailability` persists geo via **raw SQL** `ExecuteSqlCommand` after `SaveChanges`, unwrapping `.Value` on HasValue-checked nullables (refinement #1). `GetAvailabilityLocations` uses `SqlQuery<SitterAvailabilityCoordsDto>`. |
| `Services/Implementations/JobService.cs` | `CreateJobForSitter` persists `Job.Latitude/Longitude` via raw SQL after save. |
| `Services/Implementations/MatchingService.cs` | `SearchSitters` applies radius filter ONLY when the DTO carries `Latitude`/`Longitude`: sitters kept if ≥1 availability row's radius circle contains the parent; `DistanceKm` = **shortest** distance among matching rows; rows with all-`RadiusKm`-null keep the sitter with `DistanceKm = null` (refinement #6). No pin → behavior identical to before. |

**Radius edge-case rule (for the human test):** a sitter with multiple rows is kept if ANY row covers the parent; `DistanceKm` shown is the minimum. A sitter with availability but no saved coordinates is never excluded and shows no distance pill.

## 3. Frontend Changes (Step 7)
| File | Change |
|---|---|
| `src/features/parent/SearchBabySitter.jsx` | **Purely additive**: Leaflet `MapRadiusPicker` panel added above the City field (component already Leaflet-based; `npm ls` confirmed leaflet+react-leaflet present — NOT reinstalled, refinement #4). Pin optional: search without pin unchanged. Payload extended only with `Latitude`/`Longitude` when a pin exists (existing key casing untouched, refinement #5). Results cards show `📍 X.X km away` only when backend returned `DistanceKm`. Fixed a duplicate `minRating`/`favorites` declaration introduced mid-edit. |

## 4. Build Verification (Step 8)
- **Backend:** `MSBuild.exe WebApplication2.csproj /t:Rebuild /p:Configuration=Debug` → **Build succeeded. 0 Warning(s) / 0 Error(s)**.
- **Frontend:** `npm run lint` → **0 errors / 0 warnings**. `npm run build` → **built successfully** (only the pre-existing ≥500 kB chunk-size advisory).

## 5. Commits & Tags (Step 9)
- Backend: `Geo-matching: add nullable geo columns (raw SQL), Haversine helper, additive DTO fields, and radius-aware sitter search` — 11 files, +198/−7 → tag **`api-c-geo-matching`**
- Frontend: `Geo-matching: additive Leaflet map pin in parent search + DistanceKm display on results` — 1 file, +63/−1 → tag **`frontend-geo-matching`**
- Pre-work tags from Step 0: `api-c-pre-geo-matching`, `frontend-pre-geo-matching`

## 6. Constraints Honored
✅ Schema freeze partially lifted for EXACTLY the 7 named columns · raw SQL only · EDMX untouched · ✅ No API-A/B changes · ✅ Auth (BCrypt + opaque tokens) unchanged · ✅ No JWT · ✅ No route removed/renamed; existing JSON shapes additive-only · ✅ No EF Core / Code First / migrations tooling · ✅ No new global-state library · ✅ No BabysittingSession/Admin touched · ✅ No fabricated responses or status codes.

## 7. DEFERRED — Human Smoke-Test Checklist
Requires: backend running (VS F5 / IIS Express at `https://localhost:44368`) + a real browser.
1. Sitter → Set Availability: place pin, set radius (default 3 km), save → DB row shows non-null Latitude/Longitude/RadiusKm.
2. Parent → Search: without pin → results identical to pre-change; distance pills absent.
3. Parent → Search: place pin near a saved sitter pin → sitter appears with `DistanceKm`; move pin beyond all radii → sitter filtered out (subject to fallback behavior).
4. Parent → Create job with pin → `Job.Latitude/Longitude` non-null in DB.
5. Confirm no 401/403/CORS errors in the network tab.
