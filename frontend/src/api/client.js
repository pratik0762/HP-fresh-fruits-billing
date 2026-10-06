import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

// ---------------------------------------------------------------------------
// Instant-cache layer (stale-while-revalidate)
//
// api.getCached(url, onData?, { maxAge }) ALWAYS resolves to an axios-style
// response ({ data: body }) — whether served from cache or network — so
// callers can uniformly use res.data.success / res.data.branches etc.
//
//   1st visit   -> network fetch, resolves when it arrives (deduped per URL)
//   fresh cache -> resolves INSTANTLY from cache, zero network calls
//   stale cache -> resolves instantly from cache AND silently re-fetches in
//                  the background, then calls onData(fresh) when it arrives
//
// Cache is keyed by user + branch so switching branch/user never leaks data,
// and is cleared on logout / 401 / any write (POST/PUT/DELETE).
// ---------------------------------------------------------------------------
const responseCache = new Map();
const inflight = new Map();
let cacheIdentity = 'anon';

export const setCacheIdentity = (identity) => {
  if (identity !== cacheIdentity) {
    responseCache.clear();
    cacheIdentity = identity || 'anon';
  }
};

export const clearApiCache = () => responseCache.clear();

const buildHeaders = () => {
  const headers = {};
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const activeBranchId = localStorage.getItem('activeBranchId');
  if (activeBranchId && activeBranchId !== 'all') headers['x-branch-id'] = activeBranchId;
  return headers;
};

const cacheKeyOf = (url) => {
  const branch = localStorage.getItem('activeBranchId') || '';
  return `${cacheIdentity}|${branch}|GET|${url}`;
};

// Request interceptors: attach auth + branch, and bust cache on writes
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const activeBranchId = localStorage.getItem('activeBranchId');
  if (activeBranchId && activeBranchId !== 'all') {
    config.headers['x-branch-id'] = activeBranchId;
  }
  return config;
}, (error) => Promise.reject(error));

api.interceptors.request.use((config) => {
  if (config.method !== 'get') responseCache.clear();
  return config;
});

// Response interceptor: session expiration handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      responseCache.clear();
      if (!window.location.pathname.includes('/login')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

/**
 * GET with instant cache (stale-while-revalidate).
 * Always resolves to a response-like object: { data, status, ... }.
 *
 * @param {string} url
 * @param {Function} [onData]  optional callback fired with the FRESH response
 *                             when a background refresh completes
 * @param {Object} opts
 * @param {number} opts.maxAge  ms before cached data triggers a background
 *                              refresh (default 30s)
 */
api.getCached = (url, onData = null, opts = {}) => {
  const { maxAge = 30_000 } = opts;
  const cacheKey = cacheKeyOf(url);
  const cached = responseCache.get(cacheKey);

  // Callers rely on onData to paint (they ignore the resolved value), so it
  // must fire on EVERY path: cache hit, background refresh and cold fetch.
  const flush = (callbacks, res) => {
    callbacks.forEach((cb) => {
      try { cb(res); } catch (err) { console.error('getCached onData failed:', err); }
    });
  };

  if (cached) {
    // Instant paint from cache. Only hit the network when the copy went stale —
    // a fresh cache answers with ZERO requests (that's the "fast" part).
    const isStale = !cached.__t || Date.now() - cached.__t > maxAge;
    if (onData) onData({ data: cached.data, status: cached.status || 200 });

    if (isStale && !inflight.has(cacheKey)) {
      const pending = { callbacks: new Set(onData ? [onData] : []) };
      pending.promise = api.get(url, { headers: buildHeaders() })
        .then((res) => {
          responseCache.set(cacheKey, { data: res.data, status: res.status, __t: Date.now() });
          flush(pending.callbacks, res);
          return res;
        })
        .catch(() => null) // network failure: cached data (if any) already shown
        .finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, pending);
    }
    return Promise.resolve({ data: cached.data, status: cached.status || 200 });
  }

  // No cache: fetch now (deduped — concurrent callers share one request, and
  // ALL of their onData callbacks fire when it resolves)
  if (!inflight.has(cacheKey)) {
    const pending = { callbacks: new Set() };
    pending.promise = api.get(url, { headers: buildHeaders() })
      .then((res) => {
        responseCache.set(cacheKey, { data: res.data, status: res.status, __t: Date.now() });
        flush(pending.callbacks, res);
        return res;
      })
      .catch(() => null)
      .finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, pending);
  }
  const pending = inflight.get(cacheKey);
  if (pending) {
    if (onData) pending.callbacks.add(onData);
    return pending.promise || Promise.resolve(null);
  }
  return Promise.resolve(null);
};

export default api;
