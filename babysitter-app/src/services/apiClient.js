// Authoritative API client - Phase F1 & Phase F-FIX (Updated for Opaque Tokens)
// Single centralized Axios instance. Uses relative /api/... paths so the
// Vite dev proxy (vite.config.js -> https://localhost:44368) keeps working.
// Supports import.meta.env.VITE_API_BASE for deployments that need an
// absolute base URL. Preserves PascalCase payload expectations of the
// ASP.NET controllers.
//
// OPAQUE TOKEN AUTH:
// - Request interceptor attaches `Authorization: Bearer <token>` when a token is stored.
// - Response interceptor catches 401 Unauthorized responses, clears session, and forces redirect to /login.
// - Strict rule: The token is an opaque GUID. No JWT decoding is performed client-side.

import axios from 'axios';
import { normalizeApiError } from './apiErrors';
import { getToken, clearSession } from './sessionStorage';

const BASE_URL = import.meta.env.VITE_API_BASE || '/api';

const apiClient = axios.create({
  baseURL: BASE_URL,
});

// Request interceptor: attach Authorization header if token exists and normalize URL
apiClient.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Normalize URL if baseURL is /api and request URL starts with /api/
    if (config.baseURL === '/api' && config.url?.startsWith('/api/')) {
      config.url = config.url.replace(/^\/api/, '');
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: globally catch 401 Unauthorized, clear session, and force redirect to /login
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearSession();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(normalizeApiError(error));
  }
);

/** GET request returning parsed data. */
export async function apiGet(url, config) {
  const res = await apiClient.get(url, config);
  return res.data;
}

/** POST request with a JSON body. Field names must stay PascalCase. */
export async function apiPost(url, body, config) {
  const res = await apiClient.post(url, body, config);
  return res.data;
}

/** PUT request. Field names must stay PascalCase. */
export async function apiPut(url, body, config) {
  const res = await apiClient.put(url, body, config);
  return res.data;
}

/** DELETE request. */
export async function apiDelete(url, config) {
  const res = await apiClient.delete(url, config);
  return res.data;
}

export default apiClient;

