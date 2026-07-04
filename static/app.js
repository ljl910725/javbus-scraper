const codesInput = document.getElementById("codes");
const downloadCoverInput = document.getElementById("downloadCover");
const searchBtn = document.getElementById("searchBtn");
const statusEl = document.getElementById("status");
const configInfoEl = document.getElementById("configInfo");
const errorsEl = document.getElementById("errors");
const resultsEl = document.getElementById("results");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userBadge = document.getElementById("userBadge");
const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authModalTitle = document.getElementById("authModalTitle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authError = document.getElementById("authError");
const emailField = document.getElementById("emailField");
const authEmail = document.getElementById("authEmail");
const authUsername = document.getElementById("authUsername");
const authPassword = document.getElementById("authPassword");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxCounter = document.getElementById("lightboxCounter");
const lightboxThumbs = document.getElementById("lightboxThumbs");
const lightboxPrev = document.getElementById("lightboxPrev");
const lightboxNext = document.getElementById("lightboxNext");
const pushFolderModal = document.getElementById("pushFolderModal");
const pushFolderChoices = document.getElementById("pushFolderChoices");
const closePushFolderModalBtn = document.getElementById("closePushFolderModalBtn");
const pushHistorySection = document.getElementById("pushHistorySection");
const pushHistoryList = document.getElementById("pushHistoryList");
const refreshPushHistoryBtn = document.getElementById("refreshPushHistoryBtn");

let pushReady = false;
let pushBackend = "";
let pushLabel = "推送";
let pushFolders = [];
let authMode = "login";
let lightboxGallery = [];
let lightboxIndex = 0;
let pendingPushRequest = null;

const MAGNET_PREVIEW_COUNT = 3;

function parseCodes(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function setStatus(message, loading = false) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden", "loading");
  statusEl.classList.toggle("loading", loading);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function proxyImageUrl(url, referer) {
  const params = new URLSearchParams({ url, referer: referer || "" });
  const token = getToken();
  if (token) params.set("access_token", token);
  return `/api/cover/proxy?${params}`;
}

function imageSource(url, referer) {
  if (!url) return "";
  if (url.startsWith("/covers/")) return url;
  return proxyImageUrl(url, referer);
}

function renderPrivacyImage(url, referer, alt = "图片", previewCount = 0) {
  if (!url) return `<div class="cover-placeholder">无图片</div>`;
  const src = imageSource(url, referer);
  const zoomHint = previewCount > 0
    ? `再次点击放大 (${previewCount + 1} 张)`
    : "再次点击放大";
  return `
    <div class="privacy-image cover-privacy" data-state="hidden" data-src="${escapeHtml(src)}" data-full="${escapeHtml(src)}" data-gallery-index="0">
      <div class="privacy-placeholder">隐私模式<br>点击显示</div>
      <img class="privacy-img hidden" alt="${escapeHtml(alt)}" />
      <div class="privacy-hint hidden">
        <span class="privacy-hint-text">${escapeHtml(zoomHint)}</span>
        <button class="privacy-hide-btn" type="button">隐藏</button>
      </div>
    </div>`;
}

function buildMovieGallery(movie) {
  const gallery = [];
  const cover = movie.cover_path
    ? `/covers/${movie.cover_path.split(/[/\\]/).pop()}`
    : movie.cover_url;
  if (cover) {
    gallery.push({
      src: imageSource(cover, movie.source_url),
      alt: `${movie.code} 封面`,
      label: "封面",
    });
  }
  (movie.preview_images || []).forEach((url, index) => {
    gallery.push({
      src: imageSource(url, movie.source_url),
      alt: `${movie.code} 预览 ${index + 1}`,
      label: `预览 ${index + 1}`,
    });
  });
  return gallery;
}

function encodeGallery(gallery) {
  return encodeURIComponent(JSON.stringify(gallery));
}

function parseGallery(card) {
  if (!card?.dataset.gallery) return [];
  try {
    return JSON.parse(decodeURIComponent(card.dataset.gallery));
  } catch {
    return [];
  }
}

function renderTranslatable(label, value) {
  if (!value) return "";
  return `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>
        <span class="translatable" data-text="${escapeHtml(value)}">${escapeHtml(value)}</span>
        <button class="translate-btn" data-text="${escapeHtml(value)}" type="button">翻译</button>
        <div class="translation-result hidden"></div>
      </dd>
    </div>`;
}

function renderTitle(movie) {
  const title = movie.title || "未知标题";
  return `
    <div class="title-row">
      <h2>
        <span class="translatable" data-text="${escapeHtml(title)}">${escapeHtml(title)}</span>
      </h2>
      <button class="translate-btn" data-text="${escapeHtml(title)}" type="button">翻译标题</button>
      <div class="translation-result hidden"></div>
    </div>`;
}

function renderMovieCard(movie) {
  const gallery = buildMovieGallery(movie);
  const previewCount = (movie.preview_images || []).length;
  const genresHtml = (movie.genres || [])
    .map((g) => `<span class="tag">${escapeHtml(g)}</span>`)
    .join("");

  const magnets = movie.magnets || [];
  const magnetsHtml =
    magnets.length > 0
      ? magnets
          .map(
            (m, index) => `
        <div class="magnet-item${index >= MAGNET_PREVIEW_COUNT ? " magnet-item-extra hidden" : ""}">
          <span class="magnet-title" title="${escapeHtml(m.title)}">${escapeHtml(m.title)}</span>
          <span class="magnet-meta">${escapeHtml(m.size || "")} ${escapeHtml(m.date || "")}</span>
          <span class="magnet-badges">
            ${m.is_hd ? '<span class="badge badge-hd">HD</span>' : ""}
            ${m.has_subtitle ? '<span class="badge badge-sub">字幕</span>' : ""}
          </span>
          <button class="copy-btn" data-link="${escapeHtml(m.link)}" type="button">复制</button>
          ${pushReady ? `<button class="push-btn" data-link="${escapeHtml(m.link)}" type="button">${pushLabel}</button>` : ""}
        </div>`
          )
          .join("")
      : '<p class="no-magnets">暂无磁力链接</p>';

  const magnetToggleHtml =
    magnets.length > MAGNET_PREVIEW_COUNT
      ? `<button class="magnet-toggle-btn ghost-btn" type="button" data-expanded="false">展开其余 ${magnets.length - MAGNET_PREVIEW_COUNT} 条</button>`
      : "";

  return `
    <article class="card" data-gallery="${encodeGallery(gallery)}">
      <div class="card-header">
        <div class="cover">${renderPrivacyImage(movie.cover_path ? `/covers/${movie.cover_path.split(/[/\\]/).pop()}` : movie.cover_url, movie.source_url, movie.code, previewCount)}</div>
        <div class="card-info">
          <span class="code-badge">${escapeHtml(movie.code)}</span>
          ${renderTitle(movie)}
          <dl class="meta">
            ${renderTranslatable("演员", (movie.actresses || []).join("、"))}
            ${renderMeta("发行日期", movie.release_date)}
            ${renderMeta("时长", movie.runtime)}
            ${renderTranslatable("导演", movie.director)}
            ${renderTranslatable("制作商", movie.studio)}
            ${renderTranslatable("发行商", movie.label)}
          </dl>
          ${genresHtml ? `<div class="genres">${genresHtml}</div>` : ""}
        </div>
      </div>
      <div class="magnets">
        <div class="magnets-header">
          <h3>磁力链接 (${magnets.length})</h3>
          ${pushReady && magnets.length ? `<button class="push-best-btn" data-code="${escapeHtml(movie.code)}" type="button">推送最佳到${pushBackend === "cd2" ? "CD2" : "115"}</button>` : ""}
        </div>
        <div class="magnet-list">${magnetsHtml}</div>
        ${magnetToggleHtml ? `<div class="magnet-list-footer">${magnetToggleHtml}</div>` : ""}
      </div>
    </article>`;
}

function renderMeta(label, value) {
  if (!value) return "";
  return `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderErrors(errors) {
  if (!errors || errors.length === 0) {
    errorsEl.classList.add("hidden");
    errorsEl.innerHTML = "";
    return;
  }
  errorsEl.classList.remove("hidden");
  errorsEl.innerHTML = `
    <h3>部分番号查询失败</h3>
    <ul>${errors.map((e) => `<li><strong>${escapeHtml(e.code)}</strong>: ${escapeHtml(e.message)}</li>`).join("")}</ul>`;
}

function updateAuthUI() {
  const user = getUser();
  if (user) {
    userBadge.textContent = user.username;
    userBadge.classList.remove("hidden");
    loginBtn.classList.add("hidden");
    registerBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    loadPushHistory();
  } else {
    userBadge.classList.add("hidden");
    loginBtn.classList.remove("hidden");
    registerBtn.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
    pushHistorySection.classList.add("hidden");
    pushHistoryList.innerHTML = "";
  }
}

function formatHistoryTime(value) {
  if (!value) return "";
  return value.replace("T", " ").slice(0, 19);
}

function renderPushHistory(items) {
  if (!isLoggedIn()) {
    pushHistorySection.classList.add("hidden");
    return;
  }

  pushHistorySection.classList.remove("hidden");
  if (!items.length) {
    pushHistoryList.innerHTML = '<p class="push-history-empty">暂无推送记录</p>';
    return;
  }

  pushHistoryList.innerHTML = items
    .map((item) => {
      const statusClass = item.success ? "success" : "failed";
      const statusText = item.success ? "成功" : "失败";
      const folderText = item.folder_name
        ? `${escapeHtml(item.folder_name)} (${escapeHtml(item.folder_path)})`
        : item.folder_path
          ? escapeHtml(item.folder_path)
          : "-";
      const title = item.magnet_title || item.code || "磁力推送";
      const detail = item.success
        ? `<div class="push-history-message">${escapeHtml(item.message || "推送成功")}</div>`
        : `
          <div class="push-history-message error">${escapeHtml(item.message || "推送失败")}</div>
          <button class="ghost-btn push-history-detail-btn" type="button" data-history-id="${item.id}">查看原因</button>
          <pre class="push-history-detail hidden" id="push-history-detail-${item.id}">${escapeHtml(item.message || "未知错误")}</pre>`;
      return `
        <article class="push-history-item ${statusClass}">
          <div class="push-history-item-head">
            <div>
              <strong>${escapeHtml(title)}</strong>
              ${item.code ? `<span class="push-history-code">${escapeHtml(item.code)}</span>` : ""}
            </div>
            <span class="push-history-status ${statusClass}">${statusText}</span>
          </div>
          <div class="push-history-meta">
            <span>${formatHistoryTime(item.created_at)}</span>
            <span>${escapeHtml(item.backend || "-")}</span>
            <span>${folderText}</span>
          </div>
          ${detail}
        </article>`;
    })
    .join("");
}

async function loadPushHistory() {
  if (!isLoggedIn()) return;
  try {
    const res = await authFetch("/api/push/history?limit=50");
    if (!res.ok) {
      pushHistorySection.classList.remove("hidden");
      pushHistoryList.innerHTML = '<p class="push-history-empty">加载推送历史失败</p>';
      return;
    }
    const data = await res.json();
    renderPushHistory(data.items || []);
  } catch {
    pushHistorySection.classList.remove("hidden");
    pushHistoryList.innerHTML = '<p class="push-history-empty">加载推送历史失败</p>';
  }
}

function openAuthModal(mode) {
  authMode = mode;
  authError.classList.add("hidden");
  authForm.reset();
  authModalTitle.textContent = mode === "register" ? "注册" : "登录";
  authSubmitBtn.textContent = mode === "register" ? "注册" : "登录";
  emailField.classList.toggle("hidden", mode !== "register");
  authModal.classList.remove("hidden");
}

function closeAuthModal() {
  authModal.classList.add("hidden");
}

async function loadConfig() {
  try {
    const [configRes, pushRes] = await Promise.all([
      authFetch("/api/config"),
      authFetch("/api/push/status"),
    ]);
    const config = await configRes.json();
    const push = await pushRes.json();
    pushReady = push.ready;
    pushBackend = push.backend || config.push_backend || "";
    pushFolders = (push.push_folders || []).filter((folder) => folder.valid);
    pushLabel = pushBackend === "cd2" ? "推送CD2" : pushBackend === "p115" ? "推送115" : "推送";

    configInfoEl.classList.remove("hidden");
    let pushText = "推送: 未配置";
    if (pushBackend === "cd2") {
      const folderText = pushFolders.length
        ? `${pushFolders.length} 个目录`
        : push.connected
          ? "未配置目录"
          : "未连接";
      pushText = push.ready
        ? `CD2: 已连接 (${push.host} → ${folderText})`
        : push.connected
          ? `CD2: 已连接 (${folderText})`
          : "CD2: 已配置但未连接";
    } else if (pushBackend === "p115") {
      pushText = push.ready
        ? `115: 已登录 (${push.user_name || ""})`
        : "115: 已配置但未登录";
    }
    const loginText = isLoggedIn() ? `用户: ${getUser()?.username}` : "未登录";
    configInfoEl.textContent = `${loginText} | 数据源: ${config.base_url} | 代理: ${config.proxy_enabled ? "已启用" : "未启用"} | ${pushText}`;
  } catch {
    configInfoEl.classList.add("hidden");
  }
}

async function pushToOffline({ magnets = [], code = null, pushBest = false, button = null, pushFolderId = null }) {
  if (!pushReady) {
    setStatus("推送未就绪，请登录后在配置页设置 CD2 或 115");
    return;
  }

  if (pushBackend === "cd2") {
    if (!pushFolders.length) {
      setStatus("未配置可用推送目录，请先在设置页添加");
      return;
    }
    if (!pushFolderId) {
      if (pushFolders.length === 1) {
        pushFolderId = pushFolders[0].id;
      } else {
        openPushFolderModal({ magnets, code, pushBest, button });
        return;
      }
    }
  }

  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "推送中...";
  }
  try {
    const res = await authFetch("/api/push", {
      method: "POST",
      body: JSON.stringify({
        magnets,
        code,
        push_best: pushBest,
        push_folder_id: pushFolderId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    const folder = pushFolders.find((item) => item.id === pushFolderId);
    const folderHint = folder ? ` → ${folder.name}` : "";
    setStatus(`${data.backend === "cd2" ? "CD2" : "115"}${folderHint} ${data.message || "推送完成"}`);
    if (button) button.textContent = "已推送";
  } catch (err) {
    setStatus(`推送失败: ${err.message}`);
    if (button) button.textContent = originalText || pushLabel;
  } finally {
    if (button) button.disabled = false;
    if (isLoggedIn()) loadPushHistory();
  }
}

function openPushFolderModal(request) {
  pendingPushRequest = request;
  pushFolderChoices.innerHTML = pushFolders
    .map(
      (folder) => `
      <button class="push-folder-choice" type="button" data-folder-id="${escapeHtml(folder.id)}">
        <strong>${escapeHtml(folder.name)}</strong>
        <span>${escapeHtml(folder.path)}</span>
      </button>`
    )
    .join("");
  pushFolderModal.classList.remove("hidden");
}

function closePushFolderModal() {
  pushFolderModal.classList.add("hidden");
  pendingPushRequest = null;
}

async function translateText(text, resultEl) {
  resultEl.classList.remove("hidden");
  resultEl.textContent = "翻译中...";
  try {
    const res = await authFetch("/api/translate", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "翻译失败");
    resultEl.textContent = data.translated;
  } catch (err) {
    resultEl.textContent = `翻译失败: ${err.message}`;
  }
}

function hidePrivacyImage(container) {
  const img = container.querySelector(".privacy-img");
  const placeholder = container.querySelector(".privacy-placeholder");
  const hint = container.querySelector(".privacy-hint");

  img.classList.add("hidden");
  img.removeAttribute("src");
  placeholder.classList.remove("hidden");
  hint.classList.add("hidden");
  container.dataset.state = "hidden";
  container.classList.remove("revealed");
}

function revealPrivacyImage(container) {
  const state = container.dataset.state;
  const img = container.querySelector(".privacy-img");
  const placeholder = container.querySelector(".privacy-placeholder");
  const hint = container.querySelector(".privacy-hint");

  if (state === "hidden") {
    img.src = container.dataset.src;
    img.classList.remove("hidden");
    placeholder.classList.add("hidden");
    hint.classList.remove("hidden");
    container.dataset.state = "revealed";
    container.classList.add("revealed");
    return;
  }

  if (state === "revealed") {
    const card = container.closest(".card");
    const gallery = parseGallery(card);
    const fallback = [{ src: container.dataset.full || container.dataset.src, alt: "预览图", label: "图片" }];
    const index = Number(container.dataset.galleryIndex || 0);
    openLightbox(gallery.length ? gallery : fallback, index);
  }
}

function renderLightboxThumbs() {
  if (!lightboxGallery.length) {
    lightboxThumbs.innerHTML = "";
    return;
  }

  lightboxThumbs.innerHTML = lightboxGallery
    .map(
      (item, index) => `
      <button
        class="lightbox-thumb${index === lightboxIndex ? " active" : ""}"
        type="button"
        data-index="${index}"
        aria-label="${escapeHtml(item.label || item.alt || `图片 ${index + 1}`)}"
      >
        <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || "")}" loading="lazy" />
        <span class="lightbox-thumb-label">${escapeHtml(item.label || String(index + 1))}</span>
      </button>`
    )
    .join("");
}

function updateLightbox() {
  if (!lightboxGallery.length) return;

  const item = lightboxGallery[lightboxIndex];
  lightboxImage.src = item.src;
  lightboxImage.alt = item.alt || "预览图";
  lightboxCounter.textContent = `${lightboxIndex + 1} / ${lightboxGallery.length}`;
  const canLoop = lightboxGallery.length > 1;
  lightboxPrev.disabled = !canLoop;
  lightboxNext.disabled = !canLoop;
  renderLightboxThumbs();

  const activeThumb = lightboxThumbs.querySelector(".lightbox-thumb.active");
  if (activeThumb) {
    activeThumb.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
}

function openLightbox(gallery, startIndex = 0) {
  lightboxGallery = gallery;
  lightboxIndex = Math.max(0, Math.min(startIndex, gallery.length - 1));
  updateLightbox();
  lightbox.classList.remove("hidden");
  lightbox.setAttribute("aria-hidden", "false");
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightbox.setAttribute("aria-hidden", "true");
  lightboxGallery = [];
  lightboxIndex = 0;
  lightboxImage.removeAttribute("src");
  lightboxThumbs.innerHTML = "";
  lightboxCounter.textContent = "";
}

function showPrevLightboxImage() {
  if (lightboxGallery.length <= 1) return;
  lightboxIndex = (lightboxIndex - 1 + lightboxGallery.length) % lightboxGallery.length;
  updateLightbox();
}

function showNextLightboxImage() {
  if (lightboxGallery.length <= 1) return;
  lightboxIndex = (lightboxIndex + 1) % lightboxGallery.length;
  updateLightbox();
}

async function search() {
  const codes = parseCodes(codesInput.value);
  if (!codes.length) {
    setStatus("请输入至少一个番号");
    return;
  }

  searchBtn.disabled = true;
  resultsEl.innerHTML = "";
  renderErrors([]);
  setStatus(`正在查询 ${codes.length} 个番号...`, true);

  try {
    let data;
    if (codes.length === 1) {
      const params = new URLSearchParams({ download_cover: downloadCoverInput.checked });
      const res = await authFetch(`/api/movie/${encodeURIComponent(codes[0])}?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      data = { results: [await res.json()], errors: [] };
    } else {
      const res = await authFetch("/api/movies/batch", {
        method: "POST",
        body: JSON.stringify({ codes, download_cover: downloadCoverInput.checked }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      data = await res.json();
    }

    renderErrors(data.errors);
    resultsEl.innerHTML = (data.results || []).map(renderMovieCard).join("");
    const ok = (data.results || []).length;
    const fail = (data.errors || []).length;
    setStatus(ok ? `完成：成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ""}` : "全部查询失败");
  } catch (err) {
    setStatus(`查询失败: ${err.message}`);
  } finally {
    searchBtn.disabled = false;
  }
}

loginBtn.addEventListener("click", () => openAuthModal("login"));
registerBtn.addEventListener("click", () => openAuthModal("register"));
logoutBtn.addEventListener("click", () => {
  clearAuth();
  updateAuthUI();
  loadConfig();
});
refreshPushHistoryBtn.addEventListener("click", () => {
  loadPushHistory();
});
pushHistoryList.addEventListener("click", (event) => {
  const detailBtn = event.target.closest(".push-history-detail-btn");
  if (!detailBtn) return;
  const detailEl = document.getElementById(`push-history-detail-${detailBtn.dataset.historyId}`);
  if (!detailEl) return;
  const hidden = detailEl.classList.toggle("hidden");
  detailBtn.textContent = hidden ? "查看原因" : "收起原因";
});
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.classList.add("hidden");
  const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
  const payload =
    authMode === "register"
      ? {
          username: authUsername.value.trim(),
          email: authEmail.value.trim(),
          password: authPassword.value,
        }
      : {
          username: authUsername.value.trim(),
          password: authPassword.value,
        };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "认证失败");
    setAuth(data.access_token, data.user);
    closeAuthModal();
    updateAuthUI();
    loadConfig();
    setStatus(`${authMode === "register" ? "注册" : "登录"}成功`);
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove("hidden");
  }
});

document.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", closeAuthModal);
});

document.querySelectorAll("[data-close-lightbox]").forEach((el) => {
  el.addEventListener("click", closeLightbox);
});

lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});

document.querySelector(".lightbox-content")?.addEventListener("click", (event) => {
  event.stopPropagation();
});

lightboxPrev.addEventListener("click", (event) => {
  event.stopPropagation();
  showPrevLightboxImage();
});

lightboxNext.addEventListener("click", (event) => {
  event.stopPropagation();
  showNextLightboxImage();
});

lightboxThumbs.addEventListener("click", (event) => {
  const thumb = event.target.closest(".lightbox-thumb");
  if (!thumb) return;
  event.stopPropagation();
  lightboxIndex = Number(thumb.dataset.index);
  updateLightbox();
});

document.addEventListener("keydown", (event) => {
  if (lightbox.classList.contains("hidden")) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    showPrevLightboxImage();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    showNextLightboxImage();
  } else if (event.key === "Escape") {
    closeLightbox();
  }
});

resultsEl.addEventListener("click", async (event) => {
  const magnetToggleBtn = event.target.closest(".magnet-toggle-btn");
  if (magnetToggleBtn) {
    const magnetsSection = magnetToggleBtn.closest(".magnets");
    const expanded = magnetToggleBtn.dataset.expanded === "true";
    const extraItems = magnetsSection?.querySelectorAll(".magnet-item-extra") || [];
    extraItems.forEach((item) => item.classList.toggle("hidden", expanded));
    magnetToggleBtn.dataset.expanded = expanded ? "false" : "true";
    magnetToggleBtn.textContent = expanded
      ? `展开其余 ${extraItems.length} 条`
      : "收起";
    return;
  }

  const hideBtn = event.target.closest(".privacy-hide-btn");
  if (hideBtn) {
    event.stopPropagation();
    const privacyImage = hideBtn.closest(".privacy-image");
    if (privacyImage) hidePrivacyImage(privacyImage);
    return;
  }

  const privacyImage = event.target.closest(".privacy-image");
  if (privacyImage) {
    revealPrivacyImage(privacyImage);
    return;
  }

  const translateBtn = event.target.closest(".translate-btn");
  if (translateBtn) {
    const container = translateBtn.parentElement;
    let resultEl = container.querySelector(".translation-result");
    if (!resultEl && translateBtn.previousElementSibling?.classList.contains("translatable")) {
      resultEl = document.createElement("div");
      resultEl.className = "translation-result";
      translateBtn.insertAdjacentElement("afterend", resultEl);
    }
    await translateText(translateBtn.dataset.text, resultEl);
    return;
  }

  const copyBtn = event.target.closest(".copy-btn");
  if (copyBtn) {
    try {
      await navigator.clipboard.writeText(copyBtn.dataset.link);
      const original = copyBtn.textContent;
      copyBtn.textContent = "已复制";
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    } catch {
      copyBtn.textContent = "失败";
    }
    return;
  }

  const pushBtn = event.target.closest(".push-btn");
  if (pushBtn) {
    await pushToOffline({ magnets: [pushBtn.dataset.link], button: pushBtn });
    return;
  }

  const pushBestBtn = event.target.closest(".push-best-btn");
  if (pushBestBtn) {
    await pushToOffline({ code: pushBestBtn.dataset.code, pushBest: true, button: pushBestBtn });
  }
});

searchBtn.addEventListener("click", search);
codesInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.ctrlKey) search();
});

closePushFolderModalBtn.addEventListener("click", closePushFolderModal);
pushFolderModal.addEventListener("click", (event) => {
  if (event.target === pushFolderModal) closePushFolderModal();
});
pushFolderChoices.addEventListener("click", async (event) => {
  const choice = event.target.closest(".push-folder-choice");
  if (!choice || !pendingPushRequest) return;
  const request = pendingPushRequest;
  closePushFolderModal();
  await pushToOffline({ ...request, pushFolderId: choice.dataset.folderId });
});

updateAuthUI();
loadConfig();
