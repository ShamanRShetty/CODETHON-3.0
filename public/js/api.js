/**
 * MoVo API Client
 * Standardized fetch wrapper with automatic JSON handling and 401 redirection.
 * Communicates directly with live Express API endpoints (Mock mode disabled).
 */

const USE_MOCK = false;

async function request(url, options = {}) {
  const defaultHeaders = {};
  if (options.body && !(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
    options.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const config = {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  const response = await fetch(url, config);

  if (response.status === 401) {
    const isPublicPage =
      window.location.pathname === '/' ||
      window.location.pathname.endsWith('index.html') ||
      window.location.pathname.startsWith('/s/') ||
      window.location.pathname.endsWith('s.html');

    if (!isPublicPage && !url.includes('/api/auth/login') && !url.includes('/api/auth/register')) {
      window.location.href = '/index.html';
      return;
    }
  }

  if (response.status === 204) {
    return null;
  }

  let data;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorMsg =
      (data && typeof data === 'object' && data.error) ||
      (typeof data === 'string' && data) ||
      `Request failed with status ${response.status}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

const api = {
  get: (url, options) => request(url, { ...options, method: 'GET' }),
  post: (url, body, options) => request(url, { ...options, method: 'POST', body }),
  delete: (url, options) => request(url, { ...options, method: 'DELETE' }),
  upload: (url, formData, options) =>
    request(url, { ...options, method: 'POST', body: formData }),
  USE_MOCK: false,
};

if (typeof window !== 'undefined') {
  window.api = api;
}

if (typeof module !== 'undefined') {
  module.exports = api;
}
