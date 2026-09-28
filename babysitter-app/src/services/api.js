import { apiGet, apiPost, apiPut, apiDelete } from './apiClient';

export const API = {
  // Get matching sitters for a job
  getMatchingSitters: (jobId) => apiGet(`/matching/matches/${jobId}`),

  // Get job details
  getJobDetails: (jobId) => apiGet(`/jobs/jobdetails/${jobId}`),

  // Phase 8D: every day of a series, for the "Day X of N" pagination bar.
  // Used by BOTH the parent BookingStatus and the sitter CompletedJobDetails so
  // they see identical siblings — /jobs/sitter/{id} only returns days ASSIGNED
  // to that sitter, which hid cancelled / released siblings from them.
  getSeriesJobs: (seriesId) => apiGet(`/jobs/series/${seriesId}`),

  // Get all sitters (search sitters)
  getSitters: () => apiPost('/matching/search-sitters', {}),

  // Search sitters with a filter payload (auth-capable; replaces raw fetch)
  searchSitters: (payload) => apiPost('/matching/search-sitters', payload),

  // Parent invite-hire flow
  inviteSitters: (jobId, payload) => apiPost(`/jobs/${jobId}/invite`, payload),
  getJobInvitations: (jobId) => apiGet(`/jobs/${jobId}/invitations`),
  hireSitter: (jobId, payload) => apiPost(`/jobs/${jobId}/hire`, payload),

  // Sitter invitations flow
  getSitterInvitations: () => apiGet('/sitter/invitations'),
  acceptInvitation: (invitationId) => apiPost(`/sitter/invitations/${invitationId}/accept`, {}),
  declineInvitation: (invitationId) => apiPost(`/sitter/invitations/${invitationId}/decline`, {}),
  declineInvitationByJob: (jobId) => apiPost(`/sitter/invitations/decline-by-job/${jobId}`, {}),

  // Sitter earnings
  getSitterEarnings: (sitterId) => apiGet(`/babysitter/earnings/${sitterId}`),

  // Get sitter availability
  getSitterAvailability: (sitterId) => apiGet(`/matching/availability/${sitterId}`),

  // Get open jobs (optionally filtered by city)
  getJobs: (city) => {
    const url = city
      ? `/jobs?city=${encodeURIComponent(city)}`
      : '/jobs';
    return apiGet(url);
  },

  // Confirm a job (sitter accepts)
  confirmJob: (jobId, sitterId) => apiPost(`/jobs/confirm/${jobId}/${sitterId}`, {}),

  // Confirm bulk jobs
  confirmJobsBulk: (jobIds, sitterId) => apiPost('/jobs/confirm-bulk', { JobIds: jobIds, SitterId: sitterId }),

  // Update job status (start session / cancel / complete) — replaces raw fetch
  updateJobStatus: (jobId, status) => apiPost(`/jobs/updateStatus/${jobId}`, { Status: status }),

  // Phase 8D: sitter releases a single assigned day of a series back to Open.
  declineDay: (jobId) => apiPost(`/jobs/decline-day/${jobId}`, {}),

  // Clear all availability for a sitter
  clearAllAvailability: (sitterId) => apiDelete(`/matching/availability/clear/${sitterId}`),

  // Get job requests specifically matched to a sitter's availability
  getJobRequests: (sitterId) => apiGet(`/matching/jobrequests?sitterId=${sitterId}`),

  // Get reviews for a user (parent or sitter)
  getUserReviews: (userId, role) => apiGet(`/review/user/${userId}/${role}`),

  // Phase 6.1 mutual reviews: both reviews (Parent->Sitter and Sitter->Parent)
  // attached to one job.
  getReviewsForJob: (jobId) => apiGet(`/review/job/${jobId}`),

  // Save sitter availability
  saveAvailability: (payload) => {
    const body = {
      SitterId: payload.SitterId ?? payload.sitterId ?? payload.BabySitter_ID,
      Date: payload.Date ?? payload.date,
      SlotIds: payload.SlotIds ?? payload.slotIds,
      City: payload.City ?? payload.city,
    };
    // Forward lat/lng/radius if provided (ignored by current backend, but ready for future schema)
    if (payload.Latitude !== undefined) body.Latitude = payload.Latitude;
    if (payload.Longitude !== undefined) body.Longitude = payload.Longitude;
    if (payload.RadiusKm !== undefined) body.RadiusKm = payload.RadiusKm;
    if (payload.HourlyRate !== undefined) body.HourlyRate = payload.HourlyRate;
    return apiPost('/matching/availability/save', body);
  },

  // ---- Parent: children (replaces raw fetch on child screens) ----
  getChildren: (parentId) => apiGet(`/parent/children/${parentId}`),

  // Create child — multipart form (replaces raw fetch in SetChildProfile.jsx)
  createChild: (formData) => apiPost('/parent/child', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),

  // Update child — multipart form (replaces raw fetch in UpdateChildProfileScreen.jsx)
  updateChild: (childId, formData) => apiPut(`/parent/child/${childId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),

  // Delete child
  deleteChild: (childId) => apiDelete(`/parent/child/${childId}`),

  // ---- Notifications (replaces raw fetch in ParentNotifications.jsx) ----
  getNotifications: (userId, role) => apiGet(`/notifications?userId=${userId}&userRole=${role}`),
  markNotificationRead: (id) => apiPut(`/notifications/${id}/read`),
  clearNotifications: (userId, role) => apiDelete(`/notifications/clear?userId=${userId}&userRole=${role}`),

  // ---- Bids (parent-facing; see BidsController) ----
  getBidsForParent: (parentId) => apiGet(`/bids/parent/${parentId}`),
  acceptBid: (bidId) => apiPost(`/bids/accept/${bidId}`, {}),
  rejectBid: (bidId) => apiPost(`/bids/reject/${bidId}`, {}),

  // ---- Cry detection (404 means "no alert yet" — treated as null, other errors rethrow) ----
  getLatestCryAlert: async (parentId) => {
    try {
      return await apiGet(`/cry-detection/latest?parentId=${parentId}`);
    } catch (err) {
      if (err?.response?.status === 404 || err?.status === 404) return null;
      throw err;
    }
  },

  // Submit a review for a completed job (replaces raw fetch in BabySitterDetails2.jsx)
  submitReview: (jobId, rating, comment) =>
    apiPost('/review/add', { Job_ID: jobId, Rating: rating, Comment: comment }),

  // ---- Auth: registration (public multipart; replaces raw fetch) ----
  registerParent: (formData) => apiPost('/parent/register', formData),
  registerSitter: (formData) => apiPost('/babysitter/register', formData),

  // ---- Sitter profile (public GET; replaces raw fetch in UpdateProfile.jsx) ----
  getSitterProfile: (sitterId) => apiGet(`/matching/babysitter/${sitterId}`),

  // ---- Sitter self-update (PUT api/babysitter/update/{sitterId}; PascalCase JSON) ----
  updateSitterProfile: (sitterId, payload) =>
    apiPut(`/babysitter/update/${sitterId}`, payload),

  // ---- Profile picture upload (POST api/images/upload) ----
  // Multipart body with a single "file" field. Returns { PictureAddress: "Sitters/<guid>.jpg" }.
  // Same shape/convention as createChild / updateChild above.
  uploadProfilePicture: (formData) => apiPost('/images/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),

  // ---- Parent: create job (replaces raw fetch in BabySitterDetails.jsx) ----
  createJob: (payload) => apiPost('/parent/create-job', payload),

  // ---- Parent: job list + single job fetch (used by MyJobs and BookingStatus) ----
  getParentJobs: (parentId) => apiGet(`/parent/jobs/${parentId}`),
  getJobById: (jobId) => apiGet(`/parent/job/${jobId}`),

  // ---- Parent self-service profile (GET/PUT api/parent/{parentId}/profile; PascalCase JSON) ----
  // GET returns ParentProfileDto { Parent_ID, FullName, EmailAddress, Username,
  // PhoneNumber, PictureAddress, Address }; PUT accepts UpdateParentProfileDto
  // { FullName, PhoneNumber, PictureAddress, Address }.
  getParentProfile: (parentId) => apiGet(`/parent/${parentId}/profile`),
  updateParentProfile: (parentId, payload) =>
    apiPut(`/parent/${parentId}/profile`, payload),

  // ==========================================================================
  // PHASE 7 - Guardian connection, parent pause, parent DND
  // --------------------------------------------------------------------------
  // Every call below goes through the same apiGet/apiPost helpers, so the bearer
  // token is attached exactly like every other endpoint.
  //
  // SECURITY: the frontend is NEVER the authorization boundary. It cannot choose
  // who approves, whose DND is set, or how long a pause lasts - the backend DTOs
  // deliberately have no such fields. These wrappers therefore send SCOPE ONLY
  // ({ jobId, childId }) and let the server derive identity from the token.
  // Disabling a button or hiding a section is presentation only.
  // ==========================================================================

  // ---- Family / guardians ----
  // GET guardians of a child: [{ Parent_ID, FullName, Relation, IsPrimary,
  //                              CanApprovePause, IsCurrentUser }]
  getGuardians: (jobId, childId) =>
    apiGet(`/monitoring/guardians?jobId=${jobId}&childId=${childId}`),

  // POST a guardian invitation. `identifier` is a USERNAME or EMAIL, never a
  // Parent_ID. `relation` ("Father" | "Mother" | "Guardian") decides whether the
  // accepted guardian may approve a pause; the server assigns the capability.
  createGuardianInvitation: (childId, identifier, relation) =>
    apiPost('/monitoring/guardian-invitations', { childId, identifier, relation }),

  // GET only the authenticated account's invitations (no parentId parameter is
  // accepted by the server, so one parent cannot list another's).
  getMyGuardianInvitations: () => apiGet('/monitoring/guardian-invitations'),
  acceptGuardianInvitation: (id) => apiPost(`/monitoring/guardian-invitations/${id}/accept`),
  rejectGuardianInvitation: (id) => apiPost(`/monitoring/guardian-invitations/${id}/reject`),
  cancelGuardianInvitation: (id) => apiDelete(`/monitoring/guardian-invitations/${id}`),

  // ---- Parent pause ----
  // Requesting pauses nothing yet: the OTHER guardian must approve, and only
  // then is the cry incident cancelled for exactly 150 seconds.
  requestPause: (jobId, childId) => apiPost('/monitoring/pause', { jobId, childId }),
  approvePause: (pauseId) => apiPost(`/monitoring/pause/${pauseId}/approve`),
  denyPause: (pauseId) => apiPost(`/monitoring/pause/${pauseId}/deny`),
  cancelPause: (pauseId) => apiDelete(`/monitoring/pause/${pauseId}`),
  // Returns the current pause with IsActive / SecondsRemaining, or null.
  getPause: (jobId, childId) => apiGet(`/monitoring/pause?jobId=${jobId}&childId=${childId}`),

  // ---- Parent DND ----
  // DND is PRESENTATION ONLY: the notification is still persisted and the cry
  // still escalates. Only the ringing/sound is suppressed client-side, and only
  // for the parent who enabled it. The other parent stays alertable.
  enableDnd: (jobId, childId) => apiPost('/monitoring/dnd', { jobId, childId }),
  // axios passes a DELETE body through the `data` key of the config object.
  disableDnd: (jobId, childId) => apiDelete('/monitoring/dnd', { data: { jobId, childId } }),
  getDndStates: (jobId, childId) => apiGet(`/monitoring/dnd?jobId=${jobId}&childId=${childId}`),

  // ==========================================================================
  // PHASE 3/4/5/6 + PHASE 8 - monitoring session, heartbeat and cry incident
  // --------------------------------------------------------------------------
  // These endpoints were implemented and verified in Phases 3-6 but had NO
  // frontend consumer until Phase 8, so they are wired here for the first time.
  //
  // E2E flow they participate in:
  //   component -> these methods -> MonitoringController -> MonitoringAccess
  //             -> MonitoringService / CryIncidentService -> DB state -> UI
  //
  // SECURITY: like every Phase 7 call, the body carries SCOPE ONLY
  // ({ jobId, childId }). There is deliberately no field for the acting user,
  // the session id, the escalation stage or a timestamp - the backend derives
  // the caller from the bearer token, resolves the Active session itself, and
  // owns every clock. React never decides who is allowed, when T+5/T+15 fire,
  // or whether an incident is open.
  // ==========================================================================

  // ---- Monitoring session (Phase 3) ----
  // Starts (or idempotently returns) the ACTIVE session for one child of a job.
  // Backend rule: requires MonitoringAccess (guardian / assigned sitter + job
  // In Progress + child in JobChildren). Failures: 400 bad ids, 403 not
  // authorized / job not In Progress, 404 unknown job or child.
  startMonitoringSession: (jobId, childId) =>
    apiPost('/monitoring/session/start', { jobId, childId }),

  // Reads the session AND (Phase 5/6 sweep-on-poll) advances any DUE cry
  // escalation for it, so one call renders the whole monitoring view.
  // Phase 7 also returns IsPaused / PauseSecondsRemaining here, which is how
  // the SITTER sees the pause without any sitter-specific pause endpoint.
  // Failures: 404 when the (job, child) never had a session; 403 otherwise.
  getMonitoringSession: (jobId, childId) =>
    apiGet(`/monitoring/session?jobId=${jobId}&childId=${childId}`),

  // Ends the session (Phase 3). Phase 5/6 cancels its still-active cry
  // incidents, and Phase 7 invalidates any pending/approved pause and DND.
  endMonitoringSession: (jobId, childId) =>
    apiPost('/monitoring/session/end', { jobId, childId }),

  // ---- Heartbeat (Phase 4) ----
  // Proves this participant is still communicating. WHICH timestamp is stamped
  // comes from the authenticated role, never from the body. Response is only
  // { ok, serverTimeUtc }. The client never derives Connected/Lost itself - it
  // renders ParentConnection / SitterConnection returned by the session GET.
  sendMonitoringHeartbeat: (jobId, childId) =>
    apiPost('/monitoring/session/heartbeat', { jobId, childId }),

  // ---- Cry incident (Phase 5/6) ----
  // Creates the incident, or returns the already-open one with Reused=true
  // (dedupe, so a repeatedly firing detector cannot create an alert storm).
  // Callers poll getCryIncident instead; this exists for the detector path.
  reportCry: (jobId, childId) => apiPost('/monitoring/cry', { jobId, childId }),

  // Reads the ACTIVE incident (Open/Acknowledged) or the latest one as history,
  // and drives the due-escalation sweep for the caller's own session.
  // Shape: { Status, EscalationStage, SitterResponse, NextEscalationDueAt, ... }
  // React TRANSLATES these into words; it must not reimplement the timing.
  getCryIncident: (jobId, childId) =>
    apiGet(`/monitoring/cry?jobId=${jobId}&childId=${childId}`),

  // Sitter "I'm going to the child": acknowledges the incident and postpones the
  // PARENT escalation to max(created+15s, response+10s). Idempotent. Sitter-only.
  sitterGoingToChild: (jobId, childId) =>
    apiPost('/monitoring/cry/going-to-child', { jobId, childId }),

  // Sitter "with child": resolves the incident (terminal). A cancelled incident
  // can never be resolved (400) - for example one a pause already cancelled.
  sitterWithChild: (jobId, childId) =>
    apiPost('/monitoring/cry/with-child', { jobId, childId }),
};

export default API;
