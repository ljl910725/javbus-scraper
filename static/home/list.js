// 搜索结果列表：筛选、排序、分页、多选、记住上次的搜索结果

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
      return item.has_hd && !item.has_ultra;
    case "subtitle":
      return item.has_subtitle;
    case "hd_sub":
      return item.has_hd && !item.has_ultra && item.has_subtitle;
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

function magnetHasSubtitle(magnet) {
  return (
    Boolean(magnet?.has_subtitle) ||
    /字幕|中字|中文|chs|cht|chinese|自提征用|(?:^|[-_\s])c(?:$|[-_\s])/i.test(magnet?.title || "")
  );
}

function parseSizeToBytes(size) {
  const match = String(size || "").match(/(\d+(?:\.\d+)?)\s*([KMGT]B)/i);
  if (!match) return 0;
  const units = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return Number(match[1]) * (units[match[2].toUpperCase()] || 0);
}

function magnetIsUhd(magnet) {
  return (
    Boolean(magnet?.is_uhd) ||
    /超清|4k|uhd|2160p/i.test(magnet?.title || "") ||
    parseSizeToBytes(magnet?.size) >= 10 * 1024 ** 3
  );
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
    has_hd: magnets.some((m) => m.is_hd || magnetIsUhd(m)),
    has_ultra: magnets.some((m) => magnetIsUhd(m)),
    has_subtitle: magnets.some((m) => magnetHasSubtitle(m)),
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
  item.has_hd = Boolean(magnet.is_hd) || magnetIsUhd(magnet) || item.has_hd;
  item.has_subtitle = magnetHasSubtitle(magnet) || item.has_subtitle;
  item.has_ultra = item.has_ultra || magnetIsUhd(magnet);
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
  if (item.has_ultra) badges.push('<span class="badge badge-uhd">UHD</span>');
  else if (item.has_hd) badges.push('<span class="badge badge-hd">HD</span>');
  if (item.has_subtitle) badges.push('<span class="badge badge-sub">字幕</span>');
  if (!badges.length) return "";
  return badges.join("");
}

function renderListItem(item, extraActions = "") {
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
      ${extraActions}
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
    throw new Error(apiErrorMessage(err, `HTTP ${res.status}`));
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
