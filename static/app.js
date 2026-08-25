const codesInput = document.getElementById("codes");
const fuzzyQueryInput = document.getElementById("fuzzyQuery");
const exactModeBtn = document.getElementById("exactModeBtn");
const fuzzyModeBtn = document.getElementById("fuzzyModeBtn");
const exactSearchFields = document.getElementById("exactSearchFields");
const fuzzySearchFields = document.getElementById("fuzzySearchFields");
const downloadCoverOption = document.getElementById("downloadCoverOption");
const downloadCoverInput = document.getElementById("downloadCover");
const searchBtn = document.getElementById("searchBtn");
const statusEl = document.getElementById("status");
const configInfoEl = document.getElementById("configInfo");
const errorsEl = document.getElementById("errors");
const resultsEl = document.getElementById("results");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
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
const subtitleModal = document.getElementById("subtitleModal");
const subtitleModalTitle = document.getElementById("subtitleModalTitle");
const subtitleModalList = document.getElementById("subtitleModalList");
const closeSubtitleModalBtn = document.getElementById("closeSubtitleModalBtn");
const subtitleSaveModal = document.getElementById("subtitleSaveModal");
const subtitleSaveFilename = document.getElementById("subtitleSaveFilename");
const subtitleSaveTargetDir = document.getElementById("subtitleSaveTargetDir");
const subtitleSaveFolderList = document.getElementById("subtitleSaveFolderList");
const subtitleSaveSearchInput = document.getElementById("subtitleSaveSearchInput");
const subtitleSaveSearchBtn = document.getElementById("subtitleSaveSearchBtn");
const subtitleSaveSearchResults = document.getElementById("subtitleSaveSearchResults");
const subtitleSaveCurrentPath = document.getElementById("subtitleSaveCurrentPath");
const subtitleSaveUpBtn = document.getElementById("subtitleSaveUpBtn");
const subtitleSaveUseDirBtn = document.getElementById("subtitleSaveUseDirBtn");
const subtitleSaveConfirmBtn = document.getElementById("subtitleSaveConfirmBtn");
const subtitleSaveModalStatus = document.getElementById("subtitleSaveModalStatus");
const closeSubtitleSaveModalBtn = document.getElementById("closeSubtitleSaveModalBtn");

let pushReady = false;
let pushBackend = "";
let pushLabel = "推送";
let pushFolders = [];
let p115Ready = false;
let p115FolderPath = "";
let p115FolderCid = "";
let pendingP115Magnet = null;
let authMode = "login";
let lightboxGallery = [];
let lightboxIndex = 0;
let pendingPushRequest = null;
let searchMode = "exact";
let lastListResults = [];
let lastListQuery = "";
let lastListMode = "fuzzy";
let exactMovieCache = new Map();
let listFilter = "all";
let listSort = "date_desc";
let listPage = 1;
let listPageSize = 10;
let listBulkMode = false;
let subtitleSaveDir = "";
let subtitleSaveBrowsePath = "";
let subtitleSaveBrowseParent = null;
let subtitleSaveHighlightFile = "";
let pendingSubtitleSave = null;
let selectedCodes = new Set();
let lastErrors = [];

const SEARCH_STATE_KEY = "javbus_search_state";

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];

const LIST_FILTER_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "ultra", label: "有超清" },
  { value: "hd", label: "有高清" },
  { value: "subtitle", label: "有字幕" },
  { value: "hd_sub", label: "高清 + 字幕" },
  { value: "ultra_sub", label: "超清 + 字幕" },
  { value: "any_quality", label: "有画质（高清或超清）" },
  { value: "full_tags", label: "画质 + 字幕齐全" },
  { value: "no_tags", label: "无标签" },
  { value: "has_magnet", label: "有磁力（精确查询）" },
  { value: "no_magnet", label: "无磁力（精确查询）" },
];

const LIST_SORT_OPTIONS = [
  { value: "date_desc", label: "发行日期：新 → 旧" },
  { value: "date_asc", label: "发行日期：旧 → 新" },
  { value: "quality_desc", label: "画质优先（超清 > 高清 > 字幕）" },
  { value: "tags_desc", label: "标签数量：多 → 少" },
  { value: "code_asc", label: "番号：A → Z" },
  { value: "code_desc", label: "番号：Z → A" },
  { value: "title_asc", label: "标题：A → Z" },
];

function listTagCount(item) {
  return Number(item.has_ultra) + Number(item.has_hd) + Number(item.has_subtitle);
}

function listQualityScore(item) {
  return Number(item.has_ultra) * 100 + Number(item.has_hd) * 50 + Number(item.has_subtitle) * 10;
}

function listDateKey(item) {
  return item.release_date || "";
}

function matchesListFilter(item, filter) {
  switch (filter) {
    case "ultra":
      return item.has_ultra;
    case "hd":
      return item.has_hd;
    case "subtitle":
      return item.has_subtitle;
    case "hd_sub":
      return item.has_hd && item.has_subtitle;
    case "ultra_sub":
      return item.has_ultra && item.has_subtitle;
    case "any_quality":
      return item.has_hd || item.has_ultra;
    case "full_tags":
      return (item.has_hd || item.has_ultra) && item.has_subtitle;
    case "no_tags":
      return !item.has_hd && !item.has_ultra && !item.has_subtitle;
    case "has_magnet":
      return Boolean(item.best_magnet_link);
    case "no_magnet":
      return !item.best_magnet_link;
    default:
      return true;
  }
}

function sortListResults(items, sortKey) {
  const sorted = [...items];
  const cmpText = (a, b) => (a || "").localeCompare(b || "", "zh-CN", { sensitivity: "base" });
  const cmpDate = (a, b, asc) => {
    const av = listDateKey(a);
    const bv = listDateKey(b);
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return asc ? av.localeCompare(bv) : bv.localeCompare(av);
  };

  sorted.sort((a, b) => {
    switch (sortKey) {
      case "date_asc":
        return cmpDate(a, b, true) || cmpText(a.code, b.code);
      case "code_asc":
        return cmpText(a.code, b.code);
      case "code_desc":
        return cmpText(b.code, a.code);
      case "title_asc":
        return cmpText(a.title, b.title) || cmpText(a.code, b.code);
      case "quality_desc":
        return (
          listQualityScore(b) - listQualityScore(a)
          || cmpDate(a, b, false)
          || cmpText(a.code, b.code)
        );
      case "tags_desc":
        return (
          listTagCount(b) - listTagCount(a)
          || listQualityScore(b) - listQualityScore(a)
          || cmpDate(a, b, false)
        );
      case "date_desc":
      default:
        return cmpDate(a, b, false) || cmpText(a.code, b.code);
    }
  });
  return sorted;
}

function getProcessedListResults() {
  const filtered = lastListResults.filter((item) => matchesListFilter(item, listFilter));
  return sortListResults(filtered, listSort);
}

function getPaginatedListResults() {
  const processed = getProcessedListResults();
  const totalPages = Math.max(1, Math.ceil(processed.length / listPageSize));
  if (listPage > totalPages) listPage = totalPages;
  const start = (listPage - 1) * listPageSize;
  return {
    items: processed.slice(start, start + listPageSize),
    total: processed.length,
    page: listPage,
    totalPages,
  };
}

function movieToListItem(movie) {
  const best = movie.magnets?.[0];
  const magnets = movie.magnets || [];
  return {
    code: movie.code,
    title: movie.title,
    cover_url: movie.cover_path
      ? `/covers/${movie.cover_path.split(/[/\\]/).pop()}`
      : movie.cover_url,
    source_url: movie.source_url,
    release_date: movie.release_date,
    has_hd: Boolean(best?.is_hd) || magnets.some((m) => m.is_hd),
    has_ultra: magnets.some((m) => /超清|4k|uhd/i.test(m.title || "")),
    has_subtitle: Boolean(best?.has_subtitle) || magnets.some((m) => m.has_subtitle),
    best_magnet_link: best?.link || "",
    best_magnet_title: best?.title || "",
  };
}

function resetListViewState({ query, mode, results, movies = null }) {
  lastListQuery = query;
  lastListMode = mode;
  listFilter = "all";
  listSort = "date_desc";
  listPage = 1;
  listBulkMode = false;
  selectedCodes = new Set();
  exactMovieCache = new Map();

  if (mode === "exact" && movies) {
    movies.forEach((movie) => exactMovieCache.set(movie.code, movie));
    lastListResults = movies.map(movieToListItem);
    return;
  }

  lastListResults = results || [];
}

function getListItemByCode(code) {
  return lastListResults.find((item) => item.code === code);
}

function applyMagnetToListItem(code, magnet) {
  const item = getListItemByCode(code);
  if (!item || !magnet) return "";
  item.best_magnet_link = magnet.link;
  item.best_magnet_title = magnet.title;
  item.has_hd = Boolean(magnet.is_hd) || item.has_hd;
  item.has_subtitle = Boolean(magnet.has_subtitle) || item.has_subtitle;
  item.has_ultra = item.has_ultra || /超清|4k|uhd/i.test(magnet.title || "");
  return item.best_magnet_link;
}

async function ensureItemMagnet(itemOrCode) {
  const code = typeof itemOrCode === "string" ? itemOrCode : itemOrCode?.code;
  if (!code) return "";

  const item = typeof itemOrCode === "string" ? getListItemByCode(code) : itemOrCode;
  if (item?.best_magnet_link) return item.best_magnet_link;

  let movie = exactMovieCache.get(code);
  if (!movie) {
    movie = await loadMovieDetail(code);
    exactMovieCache.set(code, movie);
  }

  return applyMagnetToListItem(code, movie.magnets?.[0]);
}

function toggleListBulkMode(forceValue = null) {
  listBulkMode = forceValue === null ? !listBulkMode : Boolean(forceValue);
  if (!listBulkMode) selectedCodes.clear();
  renderListResultsView();
}

function getSelectedListItems() {
  return getProcessedListResults().filter((item) => selectedCodes.has(item.code));
}

function saveSearchState() {
  try {
    if (!lastListResults.length) {
      sessionStorage.removeItem(SEARCH_STATE_KEY);
      return;
    }
    sessionStorage.setItem(
      SEARCH_STATE_KEY,
      JSON.stringify({
        searchMode,
        codesText: codesInput?.value || "",
        fuzzyQuery: fuzzyQueryInput?.value || "",
        lastListResults,
        lastListQuery,
        lastListMode,
        listFilter,
        listSort,
        listPage,
        listPageSize,
        listBulkMode,
        selectedCodes: [...selectedCodes],
        lastErrors,
      })
    );
  } catch {
    // sessionStorage 不可用时忽略
  }
}

function restoreSearchState() {
  try {
    const raw = sessionStorage.getItem(SEARCH_STATE_KEY);
    if (!raw) return false;

    const state = JSON.parse(raw);
    if (!Array.isArray(state.lastListResults) || !state.lastListResults.length) return false;

    searchMode = state.searchMode === "fuzzy" ? "fuzzy" : "exact";
    lastListResults = state.lastListResults;
    lastListQuery = state.lastListQuery || "";
    lastListMode = state.lastListMode === "exact" ? "exact" : "fuzzy";
    listFilter = state.listFilter || "all";
    listSort = state.listSort || "date_desc";
    listPage = Number(state.listPage) || 1;
    listPageSize = PAGE_SIZE_OPTIONS.includes(Number(state.listPageSize))
      ? Number(state.listPageSize)
      : listPageSize;
    listBulkMode = Boolean(state.listBulkMode);
    selectedCodes = new Set(Array.isArray(state.selectedCodes) ? state.selectedCodes : []);
    exactMovieCache = new Map();
    lastErrors = Array.isArray(state.lastErrors) ? state.lastErrors : [];

    if (codesInput) codesInput.value = state.codesText || "";
    if (fuzzyQueryInput) fuzzyQueryInput.value = state.fuzzyQuery || "";

    setSearchMode(searchMode);
    renderErrors(lastErrors);
    renderListResultsView();
    return true;
  } catch {
    sessionStorage.removeItem(SEARCH_STATE_KEY);
    return false;
  }
}

function clearSearchState() {
  sessionStorage.removeItem(SEARCH_STATE_KEY);
}

async function saveListPageSize(size) {
  if (!isLoggedIn()) return;
  try {
    await authFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ results_page_size: size }),
    });
  } catch {
    // 保存失败不影响当前浏览
  }
}

const MAGNET_PREVIEW_COUNT = 3;

function parseCodes(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function setSearchMode(mode) {
  searchMode = mode;
  exactModeBtn.classList.toggle("active", mode === "exact");
  fuzzyModeBtn.classList.toggle("active", mode === "fuzzy");
  exactSearchFields.classList.toggle("hidden", mode !== "exact");
  fuzzySearchFields.classList.toggle("hidden", mode !== "fuzzy");
  downloadCoverOption.classList.toggle("hidden", mode !== "exact");
  searchBtn.textContent = mode === "exact" ? "开始查询" : "开始搜索";
}

function renderListBadges(item) {
  const badges = [];
  if (item.has_ultra) badges.push('<span class="badge badge-uhd">超清</span>');
  if (item.has_hd) badges.push('<span class="badge badge-hd">高清</span>');
  if (item.has_subtitle) badges.push('<span class="badge badge-sub">字幕</span>');
  if (!badges.length) return "";
  return badges.join("");
}

function renderListItem(item) {
  const coverUrl = item.cover_url || "";
  const coverHtml = coverUrl
    ? renderPrivacyImage(coverUrl, item.source_url, item.code, 0, { compact: true })
    : '<div class="fuzzy-cover-placeholder">无封面</div>';
  const title = item.title || "未知标题";
  const badges = renderListBadges(item);
  const dateText = item.release_date
    ? `<span class="fuzzy-date">${escapeHtml(item.release_date)}</span>`
    : "";
  const selected = selectedCodes.has(item.code);
  const coverSrc = coverUrl ? imageSource(coverUrl, item.source_url) : "";
  const gallery = coverSrc ? [{ src: coverSrc, alt: item.code, label: "封面" }] : [];
  const actionsHtml = `
    <div class="list-item-actions">
      <button class="copy-best-btn ghost-btn" data-code="${escapeHtml(item.code)}" data-link="${escapeHtml(item.best_magnet_link || "")}" type="button">复制</button>
      <button class="push-best-btn ghost-btn" data-code="${escapeHtml(item.code)}" data-link="${escapeHtml(item.best_magnet_link || "")}" type="button"${
        pushReady ? "" : " disabled"
      }>${pushLabel}</button>
      ${
        p115Ready && pushBackend !== "p115"
          ? `<button class="push-115-btn ghost-btn" data-code="${escapeHtml(item.code)}" data-link="${escapeHtml(item.best_magnet_link || "")}" type="button">推送115</button>`
          : ""
      }
      <button class="subtitle-open-btn ghost-btn" data-code="${escapeHtml(item.code)}" type="button">字幕</button>
    </div>`;
  return `
    <article class="fuzzy-item list-item${selected ? " list-item-selected" : ""}" data-code="${escapeHtml(item.code)}" data-gallery="${encodeGallery(gallery)}" tabindex="0">
      <div class="fuzzy-cover">${coverHtml}</div>
      <div class="fuzzy-info">
        <div class="fuzzy-code-row">
          <span class="fuzzy-code copy-code" data-code="${escapeHtml(item.code)}" title="点击复制番号">${escapeHtml(item.code)}</span>
          ${badges ? `<div class="fuzzy-badges">${badges}</div>` : ""}
        </div>
        <div class="fuzzy-title">${escapeHtml(title)}</div>
        ${dateText}
        ${actionsHtml}
      </div>
    </article>`;
}

function renderListBulkBar(pageItems) {
  if (!listBulkMode) return "";
  const pageCodes = pageItems.map((item) => item.code);
  const pageSelected = pageCodes.filter((code) => selectedCodes.has(code)).length;
  const allSelected = pageCodes.length > 0 && pageSelected === pageCodes.length;
  const selectedCount = selectedCodes.size;
  return `
    <div class="list-bulk-bar">
      <label class="list-bulk-select-all">
        <input type="checkbox" id="listSelectPageCb"${allSelected ? " checked" : ""} />
        <span>全选本页</span>
      </label>
      <button class="ghost-btn" type="button" id="listClearSelectBtn"${selectedCount ? "" : " disabled"}>取消选择</button>
      <span class="list-selected-count">已选 ${selectedCount} 项</span>
      <button class="ghost-btn" type="button" id="listBulkCopyBtn"${selectedCount ? "" : " disabled"}>复制所选</button>
      <button class="ghost-btn" type="button" id="listBulkPushBtn"${selectedCount && pushReady ? "" : " disabled"}>推送所选</button>
    </div>`;
}

function renderListPagination(page, totalPages, pageItemCount, filteredTotal) {
  const pageSizeOptions = PAGE_SIZE_OPTIONS.map(
    (size) => `<option value="${size}"${size === listPageSize ? " selected" : ""}>${size}</option>`
  ).join("");
  const prevDisabled = page <= 1 ? " disabled" : "";
  const nextDisabled = page >= totalPages ? " disabled" : "";
  return `
    <div class="list-pagination">
      <button class="ghost-btn" type="button" id="listPrevPageBtn"${prevDisabled}>上一页</button>
      <span class="list-page-info">第 ${page} / ${totalPages} 页（本页 ${pageItemCount} 条，筛选后 ${filteredTotal} 条）</span>
      <button class="ghost-btn" type="button" id="listNextPageBtn"${nextDisabled}>下一页</button>
      <label class="fuzzy-control list-page-size">
        <span>每页</span>
        <select id="listPageSizeSelect">${pageSizeOptions}</select>
        <span>条</span>
      </label>
    </div>`;
}

function renderListToolbar(pageData) {
  const filterOptions = LIST_FILTER_OPTIONS.map(
    (opt) => `<option value="${opt.value}"${opt.value === listFilter ? " selected" : ""}>${opt.label}</option>`
  ).join("");
  const sortOptions = LIST_SORT_OPTIONS.map(
    (opt) => `<option value="${opt.value}"${opt.value === listSort ? " selected" : ""}>${opt.label}</option>`
  ).join("");
  const hint = listBulkMode
    ? "多选模式：点击条目选中/取消；复制/推送会先获取最佳磁力"
    : "默认点击条目查看详情；开启多选后可批量操作，单条也可直接复制/推送";
  return `
    <div class="fuzzy-toolbar">
      <div class="fuzzy-toolbar-row">
        <label class="fuzzy-control">
          <span>筛选</span>
          <select id="listFilterSelect">${filterOptions}</select>
        </label>
        <label class="fuzzy-control">
          <span>排序</span>
          <select id="listSortSelect">${sortOptions}</select>
        </label>
        <button class="ghost-btn list-bulk-mode-btn${listBulkMode ? " active" : ""}" type="button" id="listBulkModeBtn">${
          listBulkMode ? "退出多选" : "多选"
        }</button>
        <span class="fuzzy-count">共 ${lastListResults.length} 条</span>
      </div>
      ${renderListBulkBar(pageData.items)}
      ${renderListPagination(pageData.page, pageData.totalPages, pageData.items.length, pageData.total)}
      <p class="field-hint">${hint}</p>
    </div>`;
}

function renderListResultsView() {
  const pageData = getPaginatedListResults();
  resultsEl.innerHTML = `
    ${renderListToolbar(pageData)}
    <div class="fuzzy-results${listBulkMode ? " bulk-mode" : ""}${
      pageData.items.length ? "" : " fuzzy-results-empty-state"
    }">${pageData.items.length ? pageData.items.map(renderListItem).join("") : '<p class="fuzzy-empty">没有符合筛选条件的结果</p>'}</div>`;
  const statusText = pageData.total
    ? `${lastListMode === "exact" ? "精确查询" : `「${lastListQuery}」`} 第 ${pageData.page}/${pageData.totalPages} 页，显示 ${pageData.items.length} / ${pageData.total} 条`
    : `${lastListMode === "exact" ? "精确查询" : `「${lastListQuery}」`} 筛选后无结果`;
  setStatus(statusText);
  saveSearchState();
}

async function loadMovieDetail(code) {
  setStatus(`正在加载 ${code} 详情...`, true);
  const params = new URLSearchParams({ download_cover: downloadCoverInput.checked });
  const res = await authFetch(`/api/movie/${encodeURIComponent(code)}?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function renderDetailWithBack(movie) {
  return `
    <div class="detail-back-bar">
      <button class="ghost-btn detail-back-btn" type="button" id="backToListBtn">← 返回列表</button>
    </div>
    ${renderMovieCard(movie)}`;
}

async function openListDetail(code) {
  try {
    searchBtn.disabled = true;
    let movie = exactMovieCache.get(code);
    if (!movie) {
      movie = await loadMovieDetail(code);
      exactMovieCache.set(code, movie);
    }
    resultsEl.innerHTML = renderDetailWithBack(movie);
    setStatus(`已加载 ${movie.code} 详情`);
    loadSubtitlesForCode(movie.code);
  } catch (err) {
    setStatus(`加载详情失败: ${err.message}`);
  } finally {
    searchBtn.disabled = false;
  }
}

function showListResultsAgain() {
  if (!lastListResults.length) {
    resultsEl.innerHTML = "";
    setStatus("");
    return;
  }
  renderListResultsView();
}

function handleDetailDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get("code") || "").trim();
  if (!code || params.get("view") !== "detail") return false;

  if (codesInput && !codesInput.value.trim()) {
    codesInput.value = code;
  }
  history.replaceState(null, "", "/");
  openListDetail(code);
  return true;
}

async function copyMagnetLink(link, button = null) {
  if (!link) {
    setStatus("没有可复制的磁力链接");
    return;
  }
  try {
    await copyTextToClipboard(link);
    if (button) {
      const original = button.dataset.copyLabel || button.textContent;
      button.dataset.copyLabel = original;
      button.textContent = "已复制";
      setTimeout(() => { button.textContent = original; }, 1500);
    } else {
      setStatus("已复制磁力链接");
    }
  } catch {
    if (button) {
      const original = button.dataset.copyLabel || button.textContent;
      button.textContent = "失败";
      setTimeout(() => { button.textContent = original; }, 1500);
    }
    setStatus("复制失败，请手动复制");
  }
}

async function copyItemBestLink(code, link, button = null) {
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "获取中...";
    }
    const resolved = link || await ensureItemMagnet(code);
    await copyMagnetLink(resolved, button);
    if (resolved) renderListResultsView();
  } finally {
    if (button && button.textContent === "获取中...") {
      button.disabled = false;
      button.textContent = "复制";
    }
  }
}

async function pushItemBestLink(code, link, button = null) {
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "获取中...";
    }
    const resolved = link || await ensureItemMagnet(code);
    if (!resolved) {
      setStatus(`${code} 没有可用磁力链接`);
      if (button) button.textContent = pushLabel;
      return;
    }
    await pushToOffline({ magnets: [resolved], code, button });
    renderListResultsView();
  } catch (err) {
    setStatus(`推送失败: ${err.message}`);
    if (button) button.textContent = pushLabel;
  }
}

async function copySelectedLinks() {
  const items = getSelectedListItems();
  if (!items.length) {
    setStatus("请先选择条目");
    return;
  }
  setStatus(`正在获取 ${items.length} 条最佳磁力...`, true);
  const links = [];
  for (const item of items) {
    const link = await ensureItemMagnet(item);
    if (link) links.push(link);
  }
  if (!links.length) {
    setStatus("所选条目没有可复制的磁力链接");
    return;
  }
  await copyMagnetLink(links.join("\n"));
  setStatus(`已复制 ${links.length} 条磁力链接`);
  renderListResultsView();
}

async function pushSelectedLinks(button = null) {
  const items = getSelectedListItems();
  if (!items.length) {
    setStatus("请先选择条目");
    return;
  }
  setStatus(`正在获取 ${items.length} 条最佳磁力...`, true);
  const links = [];
  for (const item of items) {
    const link = await ensureItemMagnet(item);
    if (link) links.push(link);
  }
  if (!links.length) {
    setStatus("所选条目没有可推送的磁力链接");
    return;
  }
  await pushToOffline({ magnets: links, button });
  renderListResultsView();
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

function escapeAttr(text) {
  return escapeHtml(text).replaceAll("'", "&#39;");
}

function encodeDataUrl(url) {
  return encodeURIComponent(url || "");
}

function readButtonDataUrl(button) {
  const raw = button.dataset.detailUrl || "";
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function proxyImageUrl(url, referer) {
  const params = new URLSearchParams({ url, referer: referer || "" });
  const token = getToken();
  if (token) params.set("access_token", token);
  return `/api/cover/proxy?${params}`;
}

function imageSource(url, referer) {
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return proxyImageUrl(url, referer);
}

function renderPrivacyImage(url, referer, alt = "图片", previewCount = 0, options = {}) {
  if (!url) return `<div class="cover-placeholder">无图片</div>`;
  const src = imageSource(url, referer);
  const compact = Boolean(options.compact);
  const zoomHint = compact
    ? "再次点击放大"
    : previewCount > 0
      ? `再次点击放大 (${previewCount + 1} 张)`
      : "再次点击放大";
  const extraClass = compact ? "list-privacy" : "cover-privacy";
  return `
    <div class="privacy-image ${extraClass}" data-state="hidden" data-src="${escapeHtml(src)}" data-full="${escapeHtml(src)}" data-gallery-index="0">
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

function formatSubtitleProvider(provider) {
  const labels = {
    avsubtitles: "AVSubtitles",
    subtitlecat: "SubtitleCat",
  };
  return labels[provider] || provider || "未知来源";
}

function renderSubtitleItems(code, items) {
  if (!items.length) {
    return '<p class="subtitle-empty">未找到外挂字幕，可稍后再试或换其他番号</p>';
  }
  return items
    .map(
      (item) => `
      <div class="subtitle-item">
        <div class="subtitle-item-main">
          <span class="subtitle-lang">${escapeHtml(item.language || item.language_code || "未知")}</span>
          <span class="subtitle-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title || code)}</span>
          <span class="subtitle-meta">${escapeHtml(formatSubtitleProvider(item.provider))}${item.uploader ? ` · ${escapeHtml(item.uploader)}` : ""}${item.downloads ? ` · ${item.downloads} 次下载` : ""}</span>
        </div>
        <div class="subtitle-item-actions">
          <button
            class="ghost-btn subtitle-download-btn"
            type="button"
            data-code="${escapeHtml(code)}"
            data-provider="${escapeHtml(item.provider)}"
            data-sub-id="${escapeHtml(item.sub_id)}"
            data-rev-id="${escapeHtml(item.rev_id || "")}"
            data-detail-url="${escapeAttr(encodeDataUrl(item.detail_url))}"
            data-language-code="${escapeHtml(item.language_code || "")}"
          >下载</button>
          <button
            class="ghost-btn subtitle-save-btn"
            type="button"
            data-code="${escapeHtml(code)}"
            data-provider="${escapeHtml(item.provider)}"
            data-sub-id="${escapeHtml(item.sub_id)}"
            data-rev-id="${escapeHtml(item.rev_id || "")}"
            data-detail-url="${escapeAttr(encodeDataUrl(item.detail_url))}"
            data-language-code="${escapeHtml(item.language_code || "")}"
            data-title="${escapeHtml(item.title || code)}"
          >保存到目录</button>
        </div>
      </div>`
    )
    .join("");
}

async function fetchSubtitles(code) {
  const res = await authFetch(`/api/subtitles/search?code=${encodeURIComponent(code)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

async function loadSubtitlesForCode(code, container = null) {
  const listEl = container || document.getElementById(`subtitle-list-${code}`);
  if (!listEl) return;
  listEl.innerHTML = '<p class="subtitle-status">正在搜索字幕...</p>';
  try {
    const data = await fetchSubtitles(code);
    listEl.innerHTML = renderSubtitleItems(data.code || code, data.results || []);
  } catch (err) {
    listEl.innerHTML = `<p class="subtitle-empty">字幕搜索失败: ${escapeHtml(err.message)}</p>`;
  }
}

function renderSubtitleSection(movie) {
  return `
    <div class="subtitles" data-subtitle-code="${escapeHtml(movie.code)}">
      <div class="subtitles-header">
        <h3>外挂字幕</h3>
        <button class="ghost-btn subtitle-refresh-btn" data-code="${escapeHtml(movie.code)}" type="button">刷新</button>
      </div>
      <div class="subtitle-list" id="subtitle-list-${escapeHtml(movie.code)}">
        <p class="subtitle-status">正在搜索字幕...</p>
      </div>
      <p class="field-hint">数据来源 AVSubtitles + SubtitleCat；「下载」保存到浏览器，「保存到目录」写入 NAS 挂载文件夹（需登录）</p>
    </div>`;
}

function openSubtitleModal(code) {
  subtitleModalTitle.textContent = `${code} 外挂字幕`;
  subtitleModalList.innerHTML = '<p class="subtitle-status">正在搜索字幕...</p>';
  subtitleModal.classList.remove("hidden");
  loadSubtitlesForCode(code, subtitleModalList);
}

function closeSubtitleModal() {
  subtitleModal.classList.add("hidden");
  subtitleModalList.innerHTML = "";
}

async function downloadSubtitleFile(button) {
  const params = new URLSearchParams({
    provider: button.dataset.provider,
    sub_id: button.dataset.subId,
    rev_id: button.dataset.revId || "",
    detail_url: readButtonDataUrl(button),
    code: button.dataset.code || "",
    language_code: button.dataset.languageCode || "",
  });
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "下载中...";
  try {
    const res = await authFetch(`/api/subtitles/download?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
    const filename = match ? match[1] : `${button.dataset.code || "subtitle"}.srt`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    button.textContent = "已下载";
    setStatus(`已下载字幕 ${filename}`);
  } catch (err) {
    setStatus(`字幕下载失败: ${err.message}`);
    button.textContent = original;
  } finally {
    button.disabled = false;
  }
}

function readSubtitleButtonPayload(button) {
  return {
    provider: button.dataset.provider,
    sub_id: button.dataset.subId,
    rev_id: button.dataset.revId || "",
    detail_url: readButtonDataUrl(button),
    code: button.dataset.code || "",
    language_code: button.dataset.languageCode || "",
  };
}

async function handleSubtitleItemClick(event) {
  const subtitleDownloadBtn = event.target.closest(".subtitle-download-btn");
  if (subtitleDownloadBtn) {
    event.stopPropagation();
    await downloadSubtitleFile(subtitleDownloadBtn);
    return true;
  }

  const subtitleSaveBtn = event.target.closest(".subtitle-save-btn");
  if (subtitleSaveBtn) {
    event.stopPropagation();
    openSubtitleSaveModal(subtitleSaveBtn);
    return true;
  }

  const subtitleRefreshBtn = event.target.closest(".subtitle-refresh-btn");
  if (subtitleRefreshBtn) {
    event.stopPropagation();
    await loadSubtitlesForCode(subtitleRefreshBtn.dataset.code);
    return true;
  }

  return false;
}

async function handleSubtitleSaveFolderClick(event) {
  const subtitleSaveOpenBtn = event.target.closest(".subtitle-save-open-btn");
  if (subtitleSaveOpenBtn) {
    event.stopPropagation();
    await loadSubtitleSaveFolders(subtitleSaveOpenBtn.dataset.path);
    return true;
  }

  const subtitleSavePickBtn = event.target.closest(".subtitle-save-pick-btn");
  if (subtitleSavePickBtn) {
    event.stopPropagation();
    subtitleSaveTargetDir.value = subtitleSavePickBtn.dataset.path;
    setSubtitleSaveModalStatus(`已选择目录: ${subtitleSavePickBtn.dataset.path}`);
    return true;
  }

  const subtitleSaveFileBtn = event.target.closest(".subtitle-save-file-btn");
  if (subtitleSaveFileBtn) {
    event.stopPropagation();
    const parentDir = subtitleSaveFileBtn.dataset.parentDir || "";
    const fileName = subtitleSaveFileBtn.dataset.name || "";
    const srtName = subtitleFilenameFromVideo(fileName);
    if (parentDir) subtitleSaveTargetDir.value = parentDir;
    subtitleSaveFilename.value = srtName;
    setSubtitleSaveModalStatus(`已匹配视频 ${fileName} → ${srtName}`);
    return true;
  }

  const subtitleSaveLocateBtn = event.target.closest(".subtitle-save-locate-btn");
  if (subtitleSaveLocateBtn) {
    event.stopPropagation();
    await locateSubtitleFile(
      subtitleSaveLocateBtn.dataset.parentDir || "",
      subtitleSaveLocateBtn.dataset.name || ""
    );
    return true;
  }

  return false;
}

function defaultSubtitleFilename(code, languageCode) {
  const safeCode = (code || "subtitle").trim().toUpperCase();
  const lang = (languageCode || "sub").trim().toLowerCase();
  return `${safeCode}.${lang}.srt`;
}

function subtitleFilenameFromVideo(filename) {
  const name = (filename || "").trim();
  if (!name) return "subtitle.srt";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.srt`;
}

function formatFileSize(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function setSubtitleSaveModalStatus(message, isError = false) {
  subtitleSaveModalStatus.textContent = message || "";
  subtitleSaveModalStatus.classList.toggle("errors", Boolean(isError));
}

function renderSubtitleSaveFolders(data) {
  subtitleSaveBrowsePath = data.current_path || "";
  subtitleSaveBrowseParent = data.parent_path ?? null;
  subtitleSaveCurrentPath.textContent = subtitleSaveBrowsePath || "挂载根目录";
  subtitleSaveUpBtn.disabled = subtitleSaveBrowseParent === null;

  const folders = data.folders || [];
  const files = data.files || [];
  if (!folders.length && !files.length) {
    subtitleSaveFolderList.innerHTML = '<p class="folder-empty">当前目录为空</p>';
    return;
  }

  const folderHtml = folders
    .map(
      (folder) => `
      <div class="folder-item">
        <div class="folder-item-main">
          <strong>📁 ${escapeHtml(folder.name)}</strong>
        </div>
        <div class="folder-item-path">${escapeHtml(folder.path)}</div>
        <div class="folder-item-actions">
          <button class="ghost-btn subtitle-save-open-btn" type="button" data-path="${escapeAttr(folder.path)}">进入</button>
          <button class="ghost-btn subtitle-save-pick-btn" type="button" data-path="${escapeAttr(folder.path)}">选为保存目录</button>
        </div>
      </div>`
    )
    .join("");

  const fileHtml = files
    .map((file) => {
      const sizeText = formatFileSize(file.size);
      const tag = file.is_video ? '<span class="folder-tag video">视频</span>' : '<span class="folder-tag">文件</span>';
      const srtName = subtitleFilenameFromVideo(file.name);
      return `
      <div class="folder-item file-item">
        <div class="folder-item-main">
          <strong>${escapeHtml(file.name)}</strong>
          ${tag}
          ${sizeText ? `<span class="file-size">${sizeText}</span>` : ""}
        </div>
        <div class="folder-item-path">${escapeHtml(file.parent_dir || subtitleSaveBrowsePath)}</div>
        <div class="folder-item-actions">
          <button
            class="ghost-btn subtitle-save-file-btn"
            type="button"
            data-name="${escapeAttr(file.name)}"
            data-parent-dir="${escapeAttr(file.parent_dir || subtitleSaveBrowsePath)}"
          >匹配为 ${escapeHtml(srtName)}</button>
        </div>
      </div>`;
    })
    .join("");

  subtitleSaveFolderList.innerHTML = `${folderHtml}${fileHtml}`;
  if (subtitleSaveHighlightFile) {
    highlightSubtitleSaveFile(subtitleSaveHighlightFile);
  }
}

function hideSubtitleSaveSearchResults() {
  subtitleSaveSearchResults.classList.add("hidden");
  subtitleSaveSearchResults.innerHTML = "";
}

function highlightSubtitleSaveFile(fileName) {
  if (!fileName) return;
  let matched = false;
  subtitleSaveFolderList.querySelectorAll(".file-item").forEach((item) => {
    item.classList.remove("highlighted");
    const nameEl = item.querySelector("strong");
    if (nameEl?.textContent === fileName) {
      item.classList.add("highlighted");
      item.scrollIntoView({ block: "nearest", behavior: "smooth" });
      matched = true;
    }
  });
  if (matched) {
    setSubtitleSaveModalStatus(`已定位到文件: ${fileName}`);
  }
}

function renderSubtitleSaveSearchResults(data) {
  const results = data.results || [];
  if (!results.length) {
    subtitleSaveSearchResults.innerHTML = '<p class="folder-empty">未找到匹配文件</p>';
    subtitleSaveSearchResults.classList.remove("hidden");
    return;
  }

  const truncatedHint = data.truncated
    ? `<p class="field-hint">结果较多，仅显示前 ${results.length} 条（已扫描约 ${data.scanned || 0} 项）</p>`
    : "";

  subtitleSaveSearchResults.innerHTML = `${truncatedHint}${results
    .map((file) => {
      const sizeText = formatFileSize(file.size);
      const tag = file.is_video ? '<span class="folder-tag video">视频</span>' : '<span class="folder-tag">文件</span>';
      const srtName = subtitleFilenameFromVideo(file.name);
      return `
      <div class="folder-item file-item search-result-item">
        <div class="folder-item-main">
          <strong>${escapeHtml(file.name)}</strong>
          ${tag}
          ${sizeText ? `<span class="file-size">${sizeText}</span>` : ""}
        </div>
        <div class="folder-item-path">${escapeHtml(file.parent_dir || "")}</div>
        <div class="folder-item-actions">
          <button
            class="ghost-btn subtitle-save-locate-btn"
            type="button"
            data-name="${escapeAttr(file.name)}"
            data-parent-dir="${escapeAttr(file.parent_dir || "")}"
          >定位目录</button>
          <button
            class="ghost-btn subtitle-save-file-btn"
            type="button"
            data-name="${escapeAttr(file.name)}"
            data-parent-dir="${escapeAttr(file.parent_dir || "")}"
          >匹配为 ${escapeHtml(srtName)}</button>
        </div>
      </div>`;
    })
    .join("")}`;
  subtitleSaveSearchResults.classList.remove("hidden");
}

async function searchSubtitleFiles() {
  const query = subtitleSaveSearchInput.value.trim();
  if (query.length < 2) {
    setSubtitleSaveModalStatus("请输入至少 2 个字符", true);
    return;
  }
  setSubtitleSaveModalStatus("正在搜索文件...");
  const res = await authFetch(`/api/subtitles/search-files?q=${encodeURIComponent(query)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setSubtitleSaveModalStatus(data.detail || "搜索失败", true);
    return;
  }
  renderSubtitleSaveSearchResults(data);
  setSubtitleSaveModalStatus(`找到 ${data.results?.length || 0} 个匹配文件`);
}

async function locateSubtitleFile(parentDir, fileName) {
  if (!parentDir) {
    setSubtitleSaveModalStatus("无法定位：缺少目录信息", true);
    return;
  }
  hideSubtitleSaveSearchResults();
  subtitleSaveSearchInput.value = "";
  subtitleSaveHighlightFile = fileName;
  subtitleSaveTargetDir.value = parentDir;
  await loadSubtitleSaveFolders(parentDir);
}

async function loadSubtitleSaveFolders(path = "") {
  hideSubtitleSaveSearchResults();
  setSubtitleSaveModalStatus("正在加载目录...");
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await authFetch(`/api/subtitles/browse${query}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setSubtitleSaveModalStatus(data.detail || "加载目录失败", true);
    subtitleSaveFolderList.innerHTML = "";
    return;
  }
  renderSubtitleSaveFolders(data);
  if (data.selectable && data.current_path && !subtitleSaveTargetDir.value) {
    subtitleSaveTargetDir.value = data.current_path;
  }
  setSubtitleSaveModalStatus("");
}

function openSubtitleSaveModal(button) {
  if (!isLoggedIn()) {
    setStatus("保存字幕到目录需要先登录");
    openAuthModal("login");
    return;
  }

  pendingSubtitleSave = readSubtitleButtonPayload(button);
  subtitleSaveFilename.value = defaultSubtitleFilename(
    pendingSubtitleSave.code,
    pendingSubtitleSave.language_code
  );
  subtitleSaveTargetDir.value = subtitleSaveDir || "";
  subtitleSaveSearchInput.value = "";
  subtitleSaveHighlightFile = "";
  hideSubtitleSaveSearchResults();
  subtitleSaveModal.classList.remove("hidden");
  subtitleSaveConfirmBtn.textContent = "保存到目录";
  loadSubtitleSaveFolders(subtitleSaveDir || subtitleSaveBrowsePath || "");
}

function closeSubtitleSaveModal() {
  subtitleSaveModal.classList.add("hidden");
  pendingSubtitleSave = null;
  subtitleSaveHighlightFile = "";
  hideSubtitleSaveSearchResults();
  setSubtitleSaveModalStatus("");
}

async function confirmSubtitleSave() {
  if (!pendingSubtitleSave) return;
  const targetDir = subtitleSaveTargetDir.value.trim();
  const filename = subtitleSaveFilename.value.trim();
  if (!targetDir) {
    setSubtitleSaveModalStatus("请先选择保存目录", true);
    return;
  }
  if (!filename) {
    setSubtitleSaveModalStatus("请填写文件名", true);
    return;
  }

  subtitleSaveConfirmBtn.disabled = true;
  setSubtitleSaveModalStatus("正在保存...");
  try {
    const res = await authFetch("/api/subtitles/save", {
      method: "POST",
      body: JSON.stringify({
        ...pendingSubtitleSave,
        target_dir: targetDir,
        filename,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || `HTTP ${res.status}`);
    }
    subtitleSaveDir = targetDir;
    setSubtitleSaveModalStatus(`已保存到 ${data.path}`);
    setStatus(`字幕已保存: ${data.path}`);
    subtitleSaveConfirmBtn.textContent = "已保存";
  } catch (err) {
    setSubtitleSaveModalStatus(err.message, true);
    setStatus(`字幕保存失败: ${err.message}`);
  } finally {
    subtitleSaveConfirmBtn.disabled = false;
  }
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
          ${p115Ready && pushBackend !== "p115" ? `<button class="push-115-btn ghost-btn" data-link="${escapeHtml(m.link)}" type="button">推送115</button>` : ""}
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
          <span class="code-badge copy-code" data-code="${escapeHtml(movie.code)}" title="点击复制番号">${escapeHtml(movie.code)}</span>
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
          ${p115Ready && magnets.length && pushBackend !== "p115" ? `<button class="push-115-best-btn ghost-btn" data-code="${escapeHtml(movie.code)}" type="button">推送最佳到115</button>` : ""}
        </div>
        <div class="magnet-list">${magnetsHtml}</div>
        ${magnetToggleHtml ? `<div class="magnet-list-footer">${magnetToggleHtml}</div>` : ""}
      </div>
      ${renderSubtitleSection(movie)}
    </article>`;
}

function renderMeta(label, value) {
  if (!value) return "";
  return `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderErrors(errors) {
  lastErrors = errors || [];
  if (!lastErrors.length) {
    errorsEl.classList.add("hidden");
    errorsEl.innerHTML = "";
    return;
  }
  errorsEl.classList.remove("hidden");
  errorsEl.innerHTML = `
    <h3>部分番号查询失败</h3>
    <ul>${lastErrors.map((e) => `<li><strong>${escapeHtml(e.code)}</strong>: ${escapeHtml(e.message)}</li>`).join("")}</ul>`;
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
    p115Ready = Boolean(push.p115_ready);
    p115FolderCid = push.p115_folder_cid || "";
    p115FolderPath = push.p115_folder_path || "";
    pushLabel = pushBackend === "cd2" ? "推送CD2" : pushBackend === "p115" ? "推送115" : "推送";
    if (PAGE_SIZE_OPTIONS.includes(config.results_page_size)) {
      listPageSize = config.results_page_size;
    }
    if (isLoggedIn()) {
      const settingsRes = await authFetch("/api/settings");
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        subtitleSaveDir = settingsData.settings?.subtitle_save_dir || "";
      }
    }

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
        ? `115: 已登录 (${push.user_name || ""}${p115FolderPath ? ` → ${p115FolderPath}` : ""})`
        : "115: 已配置但未登录";
    }
    if (p115Ready && pushBackend !== "p115") {
      pushText += ` | 115: 可推送${p115FolderPath ? ` → ${p115FolderPath}` : ""}`;
    }
    const loginText = isLoggedIn() ? `用户: ${getUser()?.username}` : "未登录";
    configInfoEl.textContent = `${loginText} | 数据源: ${config.base_url} | 代理: ${config.proxy_enabled ? "已启用" : "未启用"} | ${pushText}`;
  } catch {
    configInfoEl.classList.add("hidden");
  }
}

async function pushToOffline({
  magnets = [],
  code = null,
  pushBest = false,
  button = null,
  pushFolderId = null,
  onSuccess = null,
}) {
  if (!pushReady) {
    setStatus("推送未就绪，请登录后在配置页设置 CD2 或 115");
    return false;
  }

  if (pushBackend === "cd2") {
    if (!pushFolders.length) {
      setStatus("未配置可用推送目录，请先在设置页添加");
      return false;
    }
    if (!pushFolderId) {
      if (pushFolders.length === 1) {
        pushFolderId = pushFolders[0].id;
      } else {
        openPushFolderModal({ magnets, code, pushBest, button, onSuccess });
        return false;
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
    if (typeof onSuccess === "function") {
      await onSuccess(data);
    }
    return true;
  } catch (err) {
    setStatus(`推送失败: ${err.message}`);
    if (button) button.textContent = originalText || pushLabel;
    return false;
  } finally {
    if (button) button.disabled = false;
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

const p115MagnetModal = document.getElementById("p115MagnetModal");
const p115MagnetHint = document.getElementById("p115MagnetHint");
const p115MagnetFiles = document.getElementById("p115MagnetFiles");
const p115MagnetStatus = document.getElementById("p115MagnetStatus");
const p115MagnetConfirmBtn = document.getElementById("p115MagnetConfirmBtn");
const closeP115MagnetModalBtn = document.getElementById("closeP115MagnetModalBtn");

function setP115MagnetStatus(message, isError = false) {
  if (!p115MagnetStatus) return;
  p115MagnetStatus.textContent = message || "";
  p115MagnetStatus.classList.toggle("errors", Boolean(isError));
}

function formatP115Size(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function renderP115MagnetFiles(data) {
  const files = data?.files || [];
  if (!files.length) {
    p115MagnetFiles.innerHTML = `<p class="folder-empty">${data?.parsed ? "种子里没有文件" : "无法列出文件，将整条磁力推送到 115"}</p>`;
    return;
  }
  p115MagnetFiles.innerHTML = files
    .map(
      (file) => `
      <label class="p115-file-row">
        <input type="checkbox" data-index="${file.index}" ${file.wanted ? "checked" : ""} />
        <span class="p115-file-path" title="${escapeAttr(file.path)}">${escapeHtml(file.path)}</span>
        <span class="p115-file-size">${escapeHtml(formatP115Size(file.size))}</span>
      </label>`
    )
    .join("");
}

function selectedP115Indexes() {
  return Array.from(p115MagnetFiles.querySelectorAll("input[type=checkbox]:checked")).map((input) => Number(input.dataset.index));
}

function closeP115MagnetModal() {
  p115MagnetModal?.classList.add("hidden");
  pendingP115Magnet = null;
  setP115MagnetStatus("");
}

async function openP115MagnetModal({ magnet = "", code = "", button = null } = {}) {
  if (!p115Ready) {
    setStatus("115 未就绪，请先在配置页填写 Cookie 并保存目录");
    return;
  }
  if (!magnet && code) {
    magnet = await ensureItemMagnet(code);
  }
  if (!magnet) {
    setStatus("没有可推送的磁力链接");
    return;
  }
  pendingP115Magnet = { magnet, code, button, parsed: null };
  p115MagnetModal.classList.remove("hidden");
  const folderText = p115FolderPath ? `保存到 ${p115FolderPath}` : "未配置保存目录，将放到 115 默认离线目录";
  p115MagnetHint.textContent = folderText;
  p115MagnetFiles.innerHTML = '<p class="folder-empty">正在解析磁力文件列表...</p>';
  p115MagnetConfirmBtn.disabled = true;
  setP115MagnetStatus("正在解析磁力，请稍候...");
  try {
    const res = await authFetch("/api/p115/magnet/parse", {
      method: "POST",
      body: JSON.stringify({ magnet }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "解析失败");
    pendingP115Magnet.parsed = data;
    renderP115MagnetFiles(data);
    const extra = data.parsed
      ? `已解析 ${data.files?.length || 0} 个文件，默认勾选较大视频。可改选后再推送。`
      : data.message || "未能解析文件列表，确认后将整条磁力推送。";
    p115MagnetHint.textContent = `${folderText}。${extra}`;
    setP115MagnetStatus(data.parsed ? "" : extra, !data.parsed);
    p115MagnetConfirmBtn.disabled = false;
  } catch (err) {
    pendingP115Magnet.parsed = { magnet, parsed: false, files: [], info_hash: "" };
    renderP115MagnetFiles(pendingP115Magnet.parsed);
    setP115MagnetStatus(err.message || "解析失败，仍可整条推送", true);
    p115MagnetConfirmBtn.disabled = false;
  }
}

async function confirmP115MagnetPush() {
  if (!pendingP115Magnet?.magnet) return;
  const parsed = pendingP115Magnet.parsed || {};
  const wanted = selectedP115Indexes();
  if (parsed.parsed && parsed.files?.length && !wanted.length) {
    setP115MagnetStatus("请至少选择一个文件", true);
    return;
  }
  p115MagnetConfirmBtn.disabled = true;
  setP115MagnetStatus("正在推送到 115...");
  const button = pendingP115Magnet.button;
  const original = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "推送中...";
  }
  try {
    const res = await authFetch("/api/p115/magnet/push", {
      method: "POST",
      body: JSON.stringify({
        magnet: pendingP115Magnet.magnet,
        info_hash: parsed.info_hash || "",
        wanted,
        code: pendingP115Magnet.code || "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "推送失败");
    const folderHint = p115FolderPath ? ` → ${p115FolderPath}` : "";
    setStatus(`115${folderHint} ${data.message || "推送完成"}`);
    setP115MagnetStatus(data.message || "推送完成");
    if (button) button.textContent = "已推送";
    closeP115MagnetModal();
  } catch (err) {
    setP115MagnetStatus(err.message || "推送失败", true);
    setStatus(`115 推送失败: ${err.message}`);
    if (button) button.textContent = original || "推送115";
  } finally {
    p115MagnetConfirmBtn.disabled = false;
    if (button) button.disabled = false;
  }
}

closeP115MagnetModalBtn?.addEventListener("click", closeP115MagnetModal);
p115MagnetModal?.addEventListener("click", (event) => {
  if (event.target === p115MagnetModal) closeP115MagnetModal();
});
p115MagnetConfirmBtn?.addEventListener("click", confirmP115MagnetPush);
document.getElementById("p115SelectAllBtn")?.addEventListener("click", () => {
  p115MagnetFiles.querySelectorAll("input[type=checkbox]").forEach((input) => {
    input.checked = true;
  });
});
document.getElementById("p115SelectNoneBtn")?.addEventListener("click", () => {
  p115MagnetFiles.querySelectorAll("input[type=checkbox]").forEach((input) => {
    input.checked = false;
  });
});
document.getElementById("p115SelectVideosBtn")?.addEventListener("click", () => {
  const videoExts = [".mp4", ".mkv", ".avi", ".wmv", ".mov", ".flv", ".webm", ".m4v", ".ts", ".iso"];
  p115MagnetFiles.querySelectorAll(".p115-file-row").forEach((row) => {
    const path = (row.querySelector(".p115-file-path")?.textContent || "").toLowerCase();
    const input = row.querySelector("input[type=checkbox]");
    if (input) input.checked = videoExts.some((ext) => path.endsWith(ext));
  });
});

const p115MagnetInput = document.getElementById("p115MagnetInput");
const p115ParseBtn = document.getElementById("p115ParseBtn");
const p115PushAllBtn = document.getElementById("p115PushAllBtn");
const p115PasteStatus = document.getElementById("p115PasteStatus");
const p115PasteList = document.getElementById("p115PasteList");
const MAGNET_LINK_RE = /magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^\s"'<>]*/gi;

function setP115PasteStatus(message, isError = false, loading = false) {
  if (!p115PasteStatus) return;
  p115PasteStatus.textContent = message || "";
  p115PasteStatus.classList.toggle("hidden", !message);
  p115PasteStatus.classList.toggle("errors", Boolean(isError));
  p115PasteStatus.classList.toggle("loading", Boolean(loading));
}

function extractMagnetLinks(text) {
  const matches = String(text || "").match(MAGNET_LINK_RE) || [];
  const seen = new Set();
  const links = [];
  for (const raw of matches) {
    const link = raw.replace(/[.,;]+$/, "");
    const key = link.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }
  return links;
}

function renderP115PasteList(links) {
  if (!p115PasteList) return;
  if (!links.length) {
    p115PasteList.innerHTML = "";
    return;
  }
  p115PasteList.innerHTML = links
    .map(
      (link, index) => `
      <div class="dup-file">
        <div class="dup-file-name">
          <strong>第 ${index + 1} 条</strong>
          <button class="ghost-btn p115-parse-one-btn" type="button" data-link="${escapeAttr(link)}">解析这条</button>
        </div>
        <div class="dup-file-path">${escapeHtml(link)}</div>
      </div>`
    )
    .join("");
}

function currentP115MagnetLinks() {
  return extractMagnetLinks(p115MagnetInput?.value || "");
}

async function parsePastedP115Magnet(link) {
  if (!isLoggedIn()) {
    setP115PasteStatus("推送到 115 需要先登录", true);
    openAuthModal("login");
    return;
  }
  if (!p115Ready) {
    setP115PasteStatus("115 未就绪，请先在配置页填写 Cookie，并选择离线保存目录", true);
    return;
  }
  const magnet = (link || "").trim();
  if (!magnet) {
    setP115PasteStatus("请先粘贴磁力链接", true);
    return;
  }
  setP115PasteStatus("正在打开解析窗口...", false, true);
  await openP115MagnetModal({ magnet });
  setP115PasteStatus(p115FolderPath ? `将推送到 ${p115FolderPath}` : "解析窗口已打开，确认后会推送到 115");
}

p115ParseBtn?.addEventListener("click", async () => {
  const links = currentP115MagnetLinks();
  renderP115PasteList(links);
  if (!links.length) {
    setP115PasteStatus("没有识别到 magnet 链接，请确认以 magnet:?xt=urn:btih: 开头", true);
    return;
  }
  if (links.length > 1) {
    setP115PasteStatus(`识别到 ${links.length} 条磁力，将先解析第 1 条。也可点下面的「解析这条」。`);
  }
  await parsePastedP115Magnet(links[0]);
});

p115PushAllBtn?.addEventListener("click", async () => {
  const links = currentP115MagnetLinks();
  renderP115PasteList(links);
  if (!links.length) {
    setP115PasteStatus("没有识别到 magnet 链接", true);
    return;
  }
  if (!isLoggedIn()) {
    openAuthModal("login");
    return;
  }
  if (!p115Ready) {
    setP115PasteStatus("115 未就绪，请先在配置页填写 Cookie 并选择保存目录", true);
    return;
  }
  const ok = window.confirm(`确定把 ${links.length} 条磁力整条推送到 115${p115FolderPath ? `\n${p115FolderPath}` : ""}？\n不会弹出选文件，整条任务都会下。`);
  if (!ok) return;
  p115ParseBtn.disabled = true;
  p115PushAllBtn.disabled = true;
  let success = 0;
  try {
    for (let index = 0; index < links.length; index += 1) {
      setP115PasteStatus(`正在整条推送 ${index + 1}/${links.length}...`, false, true);
      const res = await authFetch("/api/p115/magnet/push", {
        method: "POST",
        body: JSON.stringify({ magnet: links[index], info_hash: "", wanted: [] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `第 ${index + 1} 条推送失败`);
      if (data.success) success += 1;
    }
    setP115PasteStatus(`已整条推送 ${success}/${links.length} 条到 115${p115FolderPath ? ` → ${p115FolderPath}` : ""}`);
  } catch (err) {
    setP115PasteStatus(err.message || "整条推送失败", true);
  } finally {
    p115ParseBtn.disabled = false;
    p115PushAllBtn.disabled = false;
  }
});

p115PasteList?.addEventListener("click", async (event) => {
  const btn = event.target.closest(".p115-parse-one-btn");
  if (!btn) return;
  await parsePastedP115Magnet(btn.dataset.link || "");
});

p115MagnetInput?.addEventListener("input", () => {
  const links = currentP115MagnetLinks();
  renderP115PasteList(links);
  if (links.length) {
    setP115PasteStatus(`已识别 ${links.length} 条磁力链接`);
  }
});

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
    const card = container.closest("[data-gallery]") || container.closest(".card");
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
  if (searchMode === "fuzzy") {
    await searchFuzzy();
    return;
  }

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
    const movies = data.results || [];
    if (!movies.length) {
      clearSearchState();
      setStatus("全部查询失败");
      return;
    }
    resetListViewState({
      query: `${movies.length} 个番号`,
      mode: "exact",
      movies,
    });
    renderListResultsView();
    const ok = movies.length;
    const fail = (data.errors || []).length;
    setStatus(`完成：成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ""}`);
  } catch (err) {
    setStatus(`查询失败: ${err.message}`);
  } finally {
    searchBtn.disabled = false;
  }
}

async function searchFuzzy() {
  const query = fuzzyQueryInput.value.trim().replace(/\s+/g, " ");
  if (!query) {
    setStatus("请输入搜索关键词");
    return;
  }

  searchBtn.disabled = true;
  resultsEl.innerHTML = "";
  renderErrors([]);
  setStatus(`正在搜索「${query}」...`, true);

  try {
    const params = new URLSearchParams({ q: query });
    const res = await authFetch(`/api/search/fuzzy?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const results = data.results || [];
    if (!results.length) {
      clearSearchState();
      setStatus(`未找到与「${query}」相关的影片`);
      return;
    }
    resetListViewState({
      query: data.query || query,
      mode: "fuzzy",
      results,
    });
    renderListResultsView();
  } catch (err) {
    setStatus(`搜索失败: ${err.message}`);
  } finally {
    searchBtn.disabled = false;
  }
}

loginBtn.addEventListener("click", () => openAuthModal("login"));
registerBtn.addEventListener("click", () => openAuthModal("register"));
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
    updateNavUI();
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

resultsEl.addEventListener("change", (event) => {
  if (event.target.id === "listFilterSelect") {
    listFilter = event.target.value;
    listPage = 1;
    renderListResultsView();
    return;
  }
  if (event.target.id === "listSortSelect") {
    listSort = event.target.value;
    listPage = 1;
    renderListResultsView();
    return;
  }
  if (event.target.id === "listPageSizeSelect") {
    const size = Number(event.target.value);
    if (!PAGE_SIZE_OPTIONS.includes(size)) return;
    listPageSize = size;
    listPage = 1;
    saveListPageSize(size);
    renderListResultsView();
    return;
  }
  if (event.target.id === "listSelectPageCb") {
    const pageData = getPaginatedListResults();
    if (event.target.checked) {
      pageData.items.forEach((item) => selectedCodes.add(item.code));
    } else {
      pageData.items.forEach((item) => selectedCodes.delete(item.code));
    }
    renderListResultsView();
  }
});

resultsEl.addEventListener("click", async (event) => {
  if (event.target.id === "backToListBtn" || event.target.closest("#backToListBtn")) {
    showListResultsAgain();
    return;
  }

  if (event.target.id === "listBulkModeBtn") {
    toggleListBulkMode();
    return;
  }

  if (event.target.id === "listPrevPageBtn") {
    if (listPage > 1) {
      listPage -= 1;
      renderListResultsView();
    }
    return;
  }
  if (event.target.id === "listNextPageBtn") {
    const { totalPages } = getPaginatedListResults();
    if (listPage < totalPages) {
      listPage += 1;
      renderListResultsView();
    }
    return;
  }
  if (event.target.id === "listClearSelectBtn") {
    selectedCodes.clear();
    renderListResultsView();
    return;
  }
  if (event.target.id === "listBulkCopyBtn") {
    await copySelectedLinks();
    return;
  }
  if (event.target.id === "listBulkPushBtn") {
    await pushSelectedLinks(event.target);
    return;
  }

  const copyBestBtn = event.target.closest(".copy-best-btn");
  if (copyBestBtn) {
    event.stopPropagation();
    await copyItemBestLink(copyBestBtn.dataset.code, copyBestBtn.dataset.link, copyBestBtn);
    return;
  }

  const subtitleOpenBtn = event.target.closest(".subtitle-open-btn");
  if (subtitleOpenBtn) {
    event.stopPropagation();
    openSubtitleModal(subtitleOpenBtn.dataset.code);
    return;
  }

  if (await handleSubtitleItemClick(event)) {
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
    event.stopPropagation();
    revealPrivacyImage(privacyImage);
    return;
  }

  const listItem = event.target.closest(".fuzzy-item");
  if (listItem?.dataset.code && !event.target.closest(".list-item-actions") && !event.target.closest(".fuzzy-cover")) {
    if (listBulkMode) {
      const code = listItem.dataset.code;
      if (selectedCodes.has(code)) selectedCodes.delete(code);
      else selectedCodes.add(code);
      renderListResultsView();
      return;
    }
    await openListDetail(listItem.dataset.code);
    return;
  }

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
    await copyMagnetLink(copyBtn.dataset.link, copyBtn);
    return;
  }

  const push115Btn = event.target.closest(".push-115-btn");
  if (push115Btn) {
    event.stopPropagation();
    await openP115MagnetModal({
      magnet: push115Btn.dataset.link || "",
      code: push115Btn.dataset.code || "",
      button: push115Btn,
    });
    return;
  }

  const push115BestBtn = event.target.closest(".push-115-best-btn");
  if (push115BestBtn?.dataset.code) {
    event.stopPropagation();
    await openP115MagnetModal({
      code: push115BestBtn.dataset.code,
      button: push115BestBtn,
    });
    return;
  }

  const pushBtn = event.target.closest(".push-btn");
  if (pushBtn) {
    if (pushBackend === "p115") {
      await openP115MagnetModal({ magnet: pushBtn.dataset.link || "", button: pushBtn });
      return;
    }
    await pushToOffline({ magnets: [pushBtn.dataset.link], button: pushBtn });
    return;
  }

  const pushBestBtn = event.target.closest(".push-best-btn");
  if (pushBestBtn) {
    event.stopPropagation();
    if (pushBackend === "p115") {
      await openP115MagnetModal({
        magnet: pushBestBtn.dataset.link || "",
        code: pushBestBtn.dataset.code || "",
        button: pushBestBtn,
      });
      return;
    }
    if (pushBestBtn.closest(".list-item-actions")) {
      await pushItemBestLink(
        pushBestBtn.dataset.code,
        pushBestBtn.dataset.link,
        pushBestBtn
      );
      return;
    }
    if (pushBestBtn.dataset.code) {
      await pushToOffline({ code: pushBestBtn.dataset.code, pushBest: true, button: pushBestBtn });
    }
  }
});

searchBtn.addEventListener("click", search);
exactModeBtn.addEventListener("click", () => setSearchMode("exact"));
fuzzyModeBtn.addEventListener("click", () => setSearchMode("fuzzy"));
codesInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.ctrlKey) search();
});
fuzzyQueryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") search();
});

const HOME_TAB_KEY = "javbus_home_tab";
const HOME_TABS = ["search", "nosub", "dup", "cleanup", "p115"];

function setHomeTab(tab, { persist = true } = {}) {
  const next = HOME_TABS.includes(tab) ? tab : "search";
  document.querySelectorAll(".app-tab").forEach((btn) => {
    const active = btn.dataset.tab === next;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.tabPanel !== next);
  });
  if (persist) {
    try {
      sessionStorage.setItem(HOME_TAB_KEY, next);
    } catch {
      // ignore
    }
    const url = new URL(window.location.href);
    if (next === "search") url.hash = "";
    else url.hash = next;
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
}

document.querySelector(".app-tabs")?.addEventListener("click", (event) => {
  const btn = event.target.closest(".app-tab");
  if (!btn?.dataset.tab) return;
  setHomeTab(btn.dataset.tab);
});

const bootParams = new URLSearchParams(window.location.search);
const bootDetailCode = (bootParams.get("code") || "").trim();
const bootHashTab = (window.location.hash || "").replace(/^#/, "");
const storedTab = (() => {
  try {
    return sessionStorage.getItem(HOME_TAB_KEY);
  } catch {
    return "";
  }
})();
if (bootDetailCode && bootParams.get("view") === "detail") {
  setHomeTab("search", { persist: false });
  setSearchMode("exact");
  handleDetailDeepLink();
} else if (!restoreSearchState()) {
  setSearchMode("exact");
  setHomeTab(HOME_TABS.includes(bootHashTab) ? bootHashTab : storedTab || "search", { persist: true });
} else {
  setHomeTab(HOME_TABS.includes(bootHashTab) ? bootHashTab : storedTab || "search", { persist: true });
}

closePushFolderModalBtn.addEventListener("click", closePushFolderModal);
closeSubtitleModalBtn.addEventListener("click", closeSubtitleModal);
subtitleModal.addEventListener("click", (event) => {
  if (event.target === subtitleModal) closeSubtitleModal();
});
subtitleModalList.addEventListener("click", async (event) => {
  await handleSubtitleItemClick(event);
});
closeSubtitleSaveModalBtn.addEventListener("click", closeSubtitleSaveModal);
subtitleSaveModal.addEventListener("click", async (event) => {
  if (event.target === subtitleSaveModal) {
    closeSubtitleSaveModal();
    return;
  }
  await handleSubtitleSaveFolderClick(event);
});
subtitleSaveUpBtn.addEventListener("click", () => {
  if (subtitleSaveBrowseParent !== null) {
    loadSubtitleSaveFolders(subtitleSaveBrowseParent);
  }
});
subtitleSaveUseDirBtn.addEventListener("click", () => {
  if (!subtitleSaveBrowsePath) {
    setSubtitleSaveModalStatus("请先进入具体目录", true);
    return;
  }
  subtitleSaveTargetDir.value = subtitleSaveBrowsePath;
  setSubtitleSaveModalStatus(`已选择目录: ${subtitleSaveBrowsePath}`);
});
subtitleSaveSearchBtn.addEventListener("click", searchSubtitleFiles);
subtitleSaveSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchSubtitleFiles();
  }
});
subtitleSaveConfirmBtn.addEventListener("click", confirmSubtitleSave);
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

initNav({ onLogout: () => { clearSearchState(); loadConfig(); } });
loadConfig();
