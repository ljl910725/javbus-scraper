const TOKEN_KEY = "javbus_token";
const USER_KEY = "javbus_user";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function authFetch(url, options = {}) {
  const headers = authHeaders(
    options.headers || { "Content-Type": "application/json" }
  );
  return fetch(url, { ...options, headers });
}

function isLoggedIn() {
  return Boolean(getToken());
}
