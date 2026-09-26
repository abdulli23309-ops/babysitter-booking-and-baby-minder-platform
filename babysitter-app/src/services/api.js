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
};

export default API;
