# BACKEND DATA INTEGRITY AUDIT

> Read-only audit of entity relationships, state transitions, and booking logic.  

---

## 1. Entity Relationships (from EDMX/Models)

| Entity | Key | Relationships |
|--------|-----|---------------|
| Parent | Parent_ID (PK, int, identity) | Has many Jobs, many Children |
| Babysitter | Sitter_ID (PK, int, identity) | Has many Jobs, many SitterAvailabilities, many Bids |
| Child | Child_ID (PK, int, identity) | Belongs to Parent (Parent_ID FK) |
| Job | Job_ID (PK, int, identity) | Belongs to Parent, Child, Babysitter (nullable); has JobTimeSlots, Bids, Reviews, CryAlerts |
| Bid | Bid_ID (PK, int, identity) | Belongs to Job, Babysitter |
| Review | Review_ID (PK, int, identity) | Belongs to Job; references Parent/Babysitter by role |
| Notification | NotificationId (PK, int, identity) | References UserID/UserRole (polymorphic) |
| CryAlert | Id (PK, Guid) | References JobId, ParentId, BabysitterId |
| TimeSlot | Slot_ID (PK, int) | Has JobTimeSlots |
| JobTimeSlot | (composite: Job_ID, Slot_ID) | Links Job ↔ TimeSlot |
| SitterAvailability | (composite: Sitter_ID, Slot_ID, Date?) | Links Babysitter ↔ TimeSlot |

---

## 2. ID Data Types (for JavaScript Number() safety)

| Field | C# Type | SQL Type | Identity | JS Number() Safe? |
|-------|---------|----------|----------|-------------------|
| Parent_ID | `int` | int | Yes | ✅ Yes |
| Sitter_ID | `int` | int | Yes | ✅ Yes |
| Job_ID | `int` | int | Yes | ✅ Yes |
| Child_ID | `int` | int | Yes | ✅ Yes |
| Review_ID | `int` | int | Yes | ✅ Yes |
| NotificationId | `int` | int | Yes | ✅ Yes |
| Slot_ID | `int` | int | No | ✅ Yes |
| CryAlert.Id | `Guid` | uniqueidentity | Yes | ❌ No — use string |

**Conclusion:** All numeric IDs are `int` (≤ 2^53), so `Number()` is safe. Only `CryAlert.Id` is a `Guid` (must remain string).

---

## 3. Job State Transitions

**States found in code:** "Open", "Confirmed", "Completed", "Cancelled" (partial)

```
Open ──confirm──→ Confirmed ──complete──→ Completed
  │
  └──cancel──→ Cancelled (if implemented)
```

| Transition | Endpoint | Validation | Issue |
|------------|----------|------------|-------|
| Open → Confirmed | POST api/jobs/confirm/{jobId}/{sitterId} | Sets AssignedSitter_ID, Status="Confirmed" | **No check if job already assigned** — double-confirm possible |
| Confirmed → Completed | POST api/jobs/updateStatus/{jobId} with status="Completed" | None | **Any status string accepted** — no state machine guard |
| Open → Cancelled | Not found in code | N/A | **No cancel endpoint** — only status update |

**Issue:** No state machine enforcement. Client can set any status. Could "complete" an "Open" job without confirmation.

---

## 4. Booking Conflict Prevention

| Scenario | Prevented? | Evidence |
|----------|------------|----------|
| Same babysitter + same date + overlapping time | **No** | No uniqueness constraint or query check in confirm logic |
| Double-confirm of same job | **No** | `ConfirmJob` does not check current status |
| Duplicate availability | **No** | `SaveAvailability` inserts without checking existing slots |
| Duplicate review | **No** | `AddReview` does not check if user already reviewed this job |

**Risk:** Medium-High. Booking conflicts possible in concurrent scenarios.

---

## 5. Foreign Key Integrity

| Relationship | Cascade Delete? | Nullable? | Risk |
|--------------|-----------------|-----------|------|
| Job → Parent | Not set (EDMX likely NoAction) | No | Orphan jobs if parent deleted |
| Job → Child | Not set | No | Orphan if child deleted |
| Job → Babysitter | Not set | **Yes** (AssignedSitter_ID nullable) | Job can exist without sitter |
| JobTimeSlot → Job | Not set | No | — |
| Bid → Job | Not set | No | — |

**Note:** Live DB has no user-created cascading deletes (per §28 of directive). Historical SQL had `trg_*` triggers — NOT resurrected.

---

## 6. Duplicate Records

| Scenario | Prevented? | Evidence |
|----------|------------|----------|
| Duplicate parent registration | **Yes** | `Any(p => p.EmailAddress == email || p.Username == username)` |
| Duplicate sitter registration | **Yes** | `Any(b => b.EmailAddress == email || b.Username == username)` |
| Duplicate bids | **No** | No check — sitter could bid twice on same job |
| Duplicate availability | **No** | `SaveAvailability` inserts without dedup |
| Duplicate reviews | **No** | `AddReview` allows multiple reviews per job/user |

---

## 7. Date/Time Handling

| Aspect | Finding |
|--------|---------|
| CreatedAt | DB default `getdate()` (model annotation) |
| Timestamp (CryAlert) | Client-supplied |
| JobDate | Client-supplied |
| TimeSlots | StartTime/EndTime nullable TimeSpan |
| Timezone | **Not handled** — all dates treated as server-local or client-local inconsistently |

---

## Summary

| Risk | Count |
|------|-------|
| High | 2 (booking conflicts, no state machine) |
| Medium | 4 (duplicate bids/reviews/availability, FK orphans) |
| Low | 2 (timezone, duplicate registration prevented) |

**Recommendations (deferred):** Add state machine guards, add uniqueness constraints for bids/reviews, add conflict detection query before confirm.
