const TOKEN_KEY = "javbus_token";
const REFRESH_KEY = "javbus_refresh";
const USER_KEY = "javbus_user";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY) || "";
}

function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function setAuth(token, user, refreshToken) {
  localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  sessionExpired = false;
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

let sessionRefresh = null;
let sessionExpired = false;

async function refreshSession() {
  if (sessionRefresh) return sessionRefresh;
  const refreshToken = getRefreshToken();
  const accessToken = getToken() || "";
  if (!refreshToken && !accessToken) return false;
  sessionRefresh = (async () => {
    try {
      // 打开页面时用还没过期的令牌换一套新的，避免本地显示已登录、接口却按未登录
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: refreshToken,
          access_token: accessToken,
        }),
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      if (!data.access_token) return false;
      setAuth(data.access_token, data.user, data.refresh_token);
      if (typeof updateNavUI === "function") updateNavUI();
      return true;
    } catch {
      return false;
    } finally {
      sessionRefresh = null;
    }
  })();
  return sessionRefresh;
}

function expireSession() {
  const hadSession = Boolean(getToken() || getRefreshToken());
  clearAuth();
  if (typeof updateNavUI === "function") updateNavUI();
  if (!hadSession || sessionExpired) return;
  sessionExpired = true;
  if (typeof showToast === "function") {
    showToast("登录已过期，请重新登录", { type: "error", timeout: 6000 });
  }
  if (typeof openAuthModal === "function") openAuthModal("login");
}

async function ensureSession() {
  if (!getToken() && !getRefreshToken()) return false;
  const renewed = await refreshSession();
  if (!renewed) expireSession();
  return renewed;
}

async function authFetch(url, options = {}, retried = false) {
  const headers = authHeaders(
    options.headers || { "Content-Type": "application/json" }
  );
  const res = await fetch(url, { ...options, headers });
  if (res.status !== 401 || retried || String(url).includes("/api/auth/")) return res;
  const renewed = await refreshSession();
  if (renewed) return authFetch(url, options, true);
  expireSession();
  return res;
}

function isLoggedIn() {
  return Boolean(getToken());
}

function ensureToastRoot() {
  let root = document.getElementById("toastStack");
  if (!root) {
    root = document.createElement("div");
    root.id = "toastStack";
    root.className = "toast-stack";
    document.body.appendChild(root);
  }
  return root;
}

function apiErrorMessage(data, fallback = "请求失败") {
  const detail = data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => (typeof item === "string" ? item : item?.msg || item?.message || ""))
      .filter(Boolean);
    if (parts.length) return parts.join("；");
  }
  if (detail && typeof detail === "object") {
    if (typeof detail.msg === "string" && detail.msg.trim()) return detail.msg;
    if (typeof detail.message === "string" && detail.message.trim()) return detail.message;
  }
  if (typeof data?.message === "string" && data.message.trim()) return data.message;
  return fallback;
}

function pushFailureMessage(data, fallback = "推送失败") {
  const failed = (data?.results || [])
    .filter((row) => row && row.success === false)
    .map((row) => row.message)
    .filter(Boolean);
  if (failed.length) return failed.join("；");
  return apiErrorMessage(data, fallback);
}

let modalZIndex = 1200;
function bringModalToFront(el) {
  if (!el) return;
  modalZIndex += 10;
  el.style.zIndex = String(modalZIndex);
}

function showToast(message, { type = "error", timeout = 5200 } = {}) {
  const text = String(message || "").trim();
  if (!text) return;
  const root = ensureToastRoot();
  const toast = document.createElement("div");
  toast.className = `app-toast app-toast-${type}`;
  toast.innerHTML = `<div class="app-toast-text"></div><button class="app-toast-close" type="button" aria-label="关闭">×</button>`;
  toast.querySelector(".app-toast-text").textContent = text;
  const close = () => {
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 220);
  };
  toast.querySelector(".app-toast-close").addEventListener("click", close);
  root.appendChild(toast);
  if (timeout > 0) setTimeout(close, timeout);
}

function ensureConfirmModal() {
  let modal = document.getElementById("appConfirmModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "appConfirmModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-card app-confirm-card">
      <div class="modal-header">
        <h2 id="appConfirmTitle">请确认</h2>
      </div>
      <p id="appConfirmMessage" class="app-confirm-message"></p>
      <div class="app-confirm-actions">
        <button id="appConfirmCancelBtn" class="ghost-btn" type="button">取消</button>
        <button id="appConfirmOkBtn" type="button">确定</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

function showAppConfirm({
  title = "请确认",
  message = "",
  confirmText = "确定",
  cancelText = "取消",
  danger = false,
} = {}) {
  const modal = ensureConfirmModal();
  const titleEl = document.getElementById("appConfirmTitle");
  const messageEl = document.getElementById("appConfirmMessage");
  const okBtn = document.getElementById("appConfirmOkBtn");
  const cancelBtn = document.getElementById("appConfirmCancelBtn");
  titleEl.textContent = title;
  messageEl.textContent = message;
  okBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;
  okBtn.classList.toggle("danger-btn", Boolean(danger));
  bringModalToFront(modal);
  modal.classList.remove("hidden");
  return new Promise((resolve) => {
    const finish = (value) => {
      modal.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdrop = (event) => {
      if (event.target === modal) finish(false);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
  });
}
