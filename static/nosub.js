const nosubAddFolderBtn = document.getElementById("nosubAddFolderBtn");
const nosubClearFoldersBtn = document.getElementById("nosubClearFoldersBtn");
const nosubScanBtn = document.getElementById("nosubScanBtn");
const nosubCancelBtn = document.getElementById("nosubCancelBtn");
const nosubSelectedFoldersEl = document.getElementById("nosubSelectedFolders");
const nosubStatusEl = document.getElementById("nosubStatus");
const nosubResultsEl = document.getElementById("nosubResults");
const nosubProgressEl = document.getElementById("nosubProgress");
const nosubProgressFill = document.getElementById("nosubProgressFill");
const nosubProgressText = document.getElementById("nosubProgressText");
const nosubProgressPath = document.getElementById("nosubProgressPath");
const nosubFolderModal = document.getElementById("nosubFolderModal");
const nosubFolderList = document.getElementById("nosubFolderList");
const nosubFolderCurrentPath = document.getElementById("nosubFolderCurrentPath");
const nosubFolderUpBtn = document.getElementById("nosubFolderUpBtn");
const nosubFolderAddCurrentBtn = document.getElementById("nosubFolderAddCurrentBtn");
const nosubFolderModalStatus = document.getElementById("nosubFolderModalStatus");
const closeNosubFolderModalBtn = document.getElementById("closeNosubFolderModalBtn");
const nosubLookupModal = document.getElementById("nosubLookupModal");
const nosubLookupTitle = document.getElementById("nosubLookupTitle");
const nosubLookupHint = document.getElementById("nosubLookupHint");
const nosubLookupStatusEl = document.getElementById("nosubLookupStatus");
const nosubLookupResults = document.getElementById("nosubLookupResults");
const closeNosubLookupModalBtn = document.getElementById("closeNosubLookupModalBtn");
const nosubLookupIgnoreBtn = document.getElementById("nosubLookupIgnoreBtn");
const nosubPageSizeSelect = document.getElementById("nosubPageSizeSelect");
const nosubPagerEl = document.getElementById("nosubPager");
const nosubViewScanBtn = document.getElementById("nosubViewScanBtn");
const nosubViewIgnoredBtn = document.getElementById("nosubViewIgnoredBtn");
const nosubViewLogsBtn = document.getElementById("nosubViewLogsBtn");
const nosubScanView = document.getElementById("nosubScanView");
const nosubIgnoredView = document.getElementById("nosubIgnoredView");
const nosubLogsView = document.getElementById("nosubLogsView");
const nosubReplaceBtn = document.getElementById("nosubReplaceBtn");
const nosubLogsRefreshBtn = document.getElementById("nosubLogsRefreshBtn");
const nosubLogsStatusEl = document.getElementById("nosubLogsStatus");
const nosubLogsResultsEl = document.getElementById("nosubLogsResults");
const nosubReplaceReportModal = document.getElementById("nosubReplaceReportModal");
const nosubReplaceReportTitle = document.getElementById("nosubReplaceReportTitle");
const nosubReplaceReportSummary = document.getElementById("nosubReplaceReportSummary");
const nosubReplaceReportBody = document.getElementById("nosubReplaceReportBody");
const closeNosubReplaceReportBtn = document.getElementById("closeNosubReplaceReportBtn");
const nosubIgnoredRefreshBtn = document.getElementById("nosubIgnoredRefreshBtn");
const nosubIgnoredCheckBtn = document.getElementById("nosubIgnoredCheckBtn");
const nosubIgnoredStatusEl = document.getElementById("nosubIgnoredStatus");
const nosubIgnoredResultsEl = document.getElementById("nosubIgnoredResults");

const NOSUB_PAGE_SIZES = [10, 20, 50, 100];
let nosubSelectedFolders = [];
let nosubBrowsePath = "";
let nosubBrowseParent = null;
let nosubScanData = null;
let nosubAbort = null;
let pendingNosubItem = null;
let nosubLookupList = [];
let nosubPage = 1;
let nosubPageSize = 10;
let nosubPageCache = new Map();
let nosubHasMore = false;
let nosubView = "scan";
let nosubReplaceRunning = false;
let nosubIgnoredItems = [];

function currentNosubPageSize() {
  const value = Number(nosubPageSizeSelect?.value);
  return NOSUB_PAGE_SIZES.includes(value) ? value : 10;
}

function clearNosubPages() {
  nosubPageCache = new Map();
  nosubPage = 1;
  nosubHasMore = false;
  nosubScanData = null;
}

function renderNosubPager() {
  if (!nosubPagerEl) return;
  if (!nosubScanData) {
    nosubPagerEl.classList.add("hidden");
    nosubPagerEl.innerHTML = "";
    return;
  }
  nosubPagerEl.classList.remove("hidden");
  const prevDisabled = nosubPage <= 1 ? " disabled" : "";
  const nextDisabled = nosubHasMore ? "" : " disabled";
  nosubPagerEl.innerHTML = `
    <button class="ghost-btn" type="button" id="nosubPrevPageBtn"${prevDisabled}>上一页</button>
    <span class="list-page-info">第 ${nosubPage} 页 · 本页 ${nosubScanData.items?.length || 0} / ${nosubPageSize} 条</span>
    <button class="ghost-btn" type="button" id="nosubNextPageBtn"${nextDisabled}>下一页</button>
  `;
}

function setNosubStatus(message, isError = false, loading = false) {
  if (!nosubStatusEl) return;
  nosubStatusEl.textContent = message || "";
  nosubStatusEl.classList.toggle("hidden", !message);
  nosubStatusEl.classList.toggle("errors", Boolean(isError));
  nosubStatusEl.classList.toggle("loading", Boolean(loading));
}

function setNosubFolderStatus(message, isError = false) {
  if (!nosubFolderModalStatus) return;
  nosubFolderModalStatus.textContent = message || "";
  nosubFolderModalStatus.classList.toggle("errors", Boolean(isError));
}

function setNosubLookupStatus(message, isError = false, loading = false) {
  if (!nosubLookupStatusEl) return;
  nosubLookupStatusEl.textContent = message || "";
  nosubLookupStatusEl.classList.toggle("hidden", !message);
  nosubLookupStatusEl.classList.toggle("errors", Boolean(isError));
  nosubLookupStatusEl.classList.toggle("loading", Boolean(loading));
}

function nosubFolderAlreadySelected(path) {
  return nosubSelectedFolders.some((item) => item.path === path);
}

function renderNosubSelectedFolders() {
  if (!nosubSelectedFoldersEl) return;
  if (!nosubSelectedFolders.length) {
    nosubSelectedFoldersEl.innerHTML = '<span class="field-hint">尚未选择文件夹</span>';
    return;
  }
  nosubSelectedFoldersEl.innerHTML = nosubSelectedFolders
    .map(
      (folder) => `
      <div class="dup-chip" title="${escapeAttr(folder.path)}">
        <span>${escapeHtml(folder.name)}</span>
        <button type="button" data-remove-path="${escapeAttr(folder.path)}" aria-label="移除">×</button>
      </div>`
    )
    .join("");
}

function addNosubFolder(path, name) {
  const folderPath = (path || "").trim();
  if (!folderPath) {
    setNosubFolderStatus("当前位置不能添加，请进入具体目录", true);
    return;
  }
  if (nosubFolderAlreadySelected(folderPath)) {
    setNosubFolderStatus("该文件夹已在列表中");
    return;
  }
  nosubSelectedFolders.push({
    path: folderPath,
    name: name || folderPath.split("/").filter(Boolean).pop() || folderPath,
  });
  renderNosubSelectedFolders();
  setNosubFolderStatus(`已添加：${name || folderPath}`);
}

function renderNosubFolderList(data) {
  nosubBrowsePath = data.current_path || "";
  nosubBrowseParent = data.parent_path ?? null;
  nosubFolderCurrentPath.textContent = nosubBrowsePath || "挂载根目录";
  nosubFolderUpBtn.disabled = nosubBrowseParent === null;
  nosubFolderAddCurrentBtn.disabled = !data.selectable || !nosubBrowsePath;

  const folders = data.folders || [];
  if (!folders.length) {
    nosubFolderList.innerHTML = '<p class="folder-empty">当前目录没有子文件夹</p>';
    return;
  }

  nosubFolderList.innerHTML = folders
    .map(
      (folder) => `
      <div class="folder-item">
        <div class="folder-item-main">
          <strong>📁 ${escapeHtml(folder.name)}</strong>
        </div>
        <div class="folder-item-path">${escapeHtml(folder.path)}</div>
        <div class="folder-item-actions">
          <button class="ghost-btn nosub-open-btn" type="button" data-path="${escapeAttr(folder.path)}">进入</button>
          <button class="ghost-btn nosub-pick-btn" type="button" data-path="${escapeAttr(folder.path)}" data-name="${escapeAttr(folder.name)}">加入排查</button>
        </div>
      </div>`
    )
    .join("");
}

async function loadNosubFolders(path = "") {
  setNosubFolderStatus("正在加载目录...");
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await authFetch(`/api/subtitles/browse${query}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setNosubFolderStatus(data.detail || "加载目录失败", true);
    nosubFolderList.innerHTML = "";
    return;
  }
  renderNosubFolderList(data);
  setNosubFolderStatus("");
}

function openNosubFolderModal() {
  if (!isLoggedIn()) {
    setNosubStatus("排查无字幕文件需要先登录", true);
    openAuthModal("login");
    return;
  }
  nosubFolderModal.classList.remove("hidden");
  loadNosubFolders(nosubBrowsePath);
}

function closeNosubFolderModal() {
  nosubFolderModal.classList.add("hidden");
  setNosubFolderStatus("");
}

function nosubImageUrl(path) {
  const params = new URLSearchParams({ path });
  const token = getToken();
  if (token) params.set("access_token", token);
  return `/api/missing-subs/image?${params.toString()}`;
}

function nosubGallery(item) {
  return (item.images || []).map((path, index) => ({
    src: nosubImageUrl(path),
    alt: `${item.code || item.name} 图片 ${index + 1}`,
    label: index === 0 ? "封面" : `图片 ${index + 1}`,
  }));
}

function renderNosubItem(item) {
  const images = item.images || [];
  const coverHtml = images.length
    ? renderPrivacyImage(nosubImageUrl(images[0]), "", item.code || item.name, images.length - 1, { compact: true })
    : '<div class="fuzzy-cover-placeholder">无封面</div>';
  const codeLabel = item.code || "未识别番号";
  const partLabel = item.part ? ` · ${item.part}` : "";
  const title = item.title || item.name || "未知标题";
  const sizeText = formatNosubBytes(item.size);
  const dateText = item.date
    ? `<span class="fuzzy-date">${escapeHtml(item.date)}</span>`
    : "";
  const studioText = item.studio
    ? `<span class="fuzzy-date">${escapeHtml(item.studio)}</span>`
    : "";
  const sizeHtml = sizeText
    ? `<span class="fuzzy-date nosub-filesize">${escapeHtml(sizeText)}</span>`
    : "";
  return `
    <article class="fuzzy-item list-item nosub-card" data-path="${escapeAttr(item.path)}" data-gallery="${encodeGallery(nosubGallery(item))}">
      <div class="fuzzy-cover">${coverHtml}</div>
      <div class="fuzzy-info">
        <div class="fuzzy-code-row">
          ${
            item.code
              ? `<span class="fuzzy-code copy-code" data-code="${escapeAttr(item.code)}" title="点击复制番号">${escapeHtml(codeLabel)}${escapeHtml(partLabel)}</span>`
              : `<span class="fuzzy-code">${escapeHtml(codeLabel)}${escapeHtml(partLabel)}</span>`
          }
        </div>
        <div class="fuzzy-title">${escapeHtml(title)}</div>
        ${dateText}
        ${studioText}
        ${sizeHtml}
        <div class="nosub-filename" title="${escapeAttr(item.path)}">${escapeHtml(item.name)}</div>
        <div class="list-item-actions">
          <button class="nosub-lookup-btn ghost-btn" type="button" data-path="${escapeAttr(item.path)}">查找</button>
          <button class="nosub-ignore-btn ghost-btn" type="button" data-path="${escapeAttr(item.path)}">忽略</button>
          <button class="danger-btn nosub-delete-btn" type="button" data-path="${escapeAttr(item.path)}" data-name="${escapeAttr(item.name)}">删除</button>
        </div>
      </div>
    </article>`;
}

function renderNosubResults(data) {
  nosubScanData = data;
  const items = data?.items || [];
  if (!items.length) {
    nosubResultsEl.classList.remove("fuzzy-results");
    nosubResultsEl.innerHTML = '<p class="folder-empty">没有找到无字幕视频</p>';
    renderNosubPager();
    return;
  }
  nosubResultsEl.classList.add("fuzzy-results");
  nosubResultsEl.innerHTML = items.map(renderNosubItem).join("");
  renderNosubPager();
}

function setNosubScanRunning(running) {
  if (nosubScanBtn) nosubScanBtn.disabled = running;
  if (nosubAddFolderBtn) nosubAddFolderBtn.disabled = running;
  if (nosubClearFoldersBtn) nosubClearFoldersBtn.disabled = running;
  if (nosubPageSizeSelect) nosubPageSizeSelect.disabled = running;
  nosubCancelBtn?.classList.toggle("hidden", !running);
  nosubPagerEl?.querySelectorAll("button").forEach((btn) => {
    btn.disabled = running;
  });
}

function hideNosubProgress() {
  nosubProgressEl?.classList.add("hidden");
  nosubProgressFill?.classList.remove("is-indeterminate");
  if (nosubProgressFill) nosubProgressFill.style.width = "0%";
}

function showNosubProgress(event) {
  if (!nosubProgressEl) return;
  nosubProgressEl.classList.remove("hidden");
  const folderTotal = Number(event.folder_total) || 0;
  const folderIndex = Number(event.folder_index) || 0;
  const percent = Number(event.percent);
  if (Number.isFinite(percent) && folderTotal > 1) {
    nosubProgressFill?.classList.remove("is-indeterminate");
    if (nosubProgressFill) nosubProgressFill.style.width = `${Math.max(4, Math.min(100, percent))}%`;
  } else {
    nosubProgressFill?.classList.add("is-indeterminate");
    if (nosubProgressFill) nosubProgressFill.style.width = "";
  }
  const folderLabel = folderTotal ? `文件夹 ${Math.min(folderIndex + 1, folderTotal)}/${folderTotal}` : "扫描中";
  const phaseLabel = event.phase === "summarizing" ? "正在汇总结果" : "正在扫描";
  const pageFound = event.page_found ?? event.found ?? 0;
  if (nosubProgressText) {
    nosubProgressText.textContent =
      `${phaseLabel} · 第 ${nosubPage} 页 · ${folderLabel} · 已扫描 ${event.scanned || 0} 项 · 视频 ${event.videos || 0} 个 · 本页无字幕 ${pageFound}/${nosubPageSize}`;
  }
  if (nosubProgressPath) {
    nosubProgressPath.textContent = event.current_dir ? `当前：${event.current_dir}` : "";
  }
}

async function scanMissingSubs(page = 1, { reset = false } = {}) {
  if (nosubReplaceRunning) {
    setNosubStatus("正在一键替换，请先取消或等它完成", true);
    return;
  }
  if (!isLoggedIn()) {
    setNosubStatus("排查无字幕文件需要先登录", true);
    openAuthModal("login");
    return;
  }
  if (!nosubSelectedFolders.length) {
    setNosubStatus("请先选择至少一个文件夹", true);
    return;
  }

  if (reset) {
    clearNosubPages();
    nosubResultsEl.innerHTML = "";
    renderNosubPager();
  }

  nosubPageSize = currentNosubPageSize();
  const targetPage = Math.max(1, Number(page) || 1);
  if (!reset && nosubPageCache.has(targetPage)) {
    const cached = nosubPageCache.get(targetPage);
    nosubPage = targetPage;
    nosubHasMore = Boolean(cached.has_more);
    renderNosubResults(cached);
    setNosubStatus(
      `第 ${nosubPage} 页 · 本页 ${cached.items?.length || 0} 条无字幕文件${cached.has_more ? "，后面可能还有" : ""}`
    );
    return;
  }

  nosubAbort?.abort();
  nosubAbort = new AbortController();
  setNosubScanRunning(true);
  nosubPage = targetPage;
  const offset = (targetPage - 1) * nosubPageSize;
  setNosubStatus(`正在扫描第 ${targetPage} 页...`, false, true);
  showNosubProgress({
    phase: "starting",
    scanned: 0,
    videos: 0,
    dirs: 0,
    folder_index: 0,
    folder_total: nosubSelectedFolders.length,
    current_dir: nosubSelectedFolders[0]?.path || "",
    found: offset,
    page_found: 0,
    percent: 0,
  });
  try {
    const res = await authFetch("/api/missing-subs/scan/stream", {
      method: "POST",
      body: JSON.stringify({
        folders: nosubSelectedFolders.map((item) => item.path),
        limit: nosubPageSize,
        offset,
      }),
      signal: nosubAbort.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setNosubStatus(data.detail || "排查失败", true);
      hideNosubProgress();
      return;
    }

    let finalResult = null;
    let endedType = "";
    await readSseJson(res, (event) => {
      endedType = event.type;
      if (event.type === "progress") {
        showNosubProgress(event);
        setNosubStatus("扫描进行中，请稍候...", false, true);
        return;
      }
      if (event.type === "done") {
        finalResult = event.result;
        return;
      }
      if (event.type === "error") {
        throw new Error(event.message || "排查失败");
      }
    });

    if (endedType === "cancelled") {
      setNosubStatus("已取消扫描");
      hideNosubProgress();
      return;
    }
    if (!finalResult) {
      setNosubStatus("扫描中断，未返回结果", true);
      hideNosubProgress();
      return;
    }
    if ((!finalResult.items || !finalResult.items.length) && targetPage > 1) {
      nosubHasMore = false;
      hideNosubProgress();
      setNosubStatus("没有更多无字幕文件了");
      renderNosubPager();
      return;
    }
    nosubHasMore = Boolean(finalResult.has_more) && (finalResult.items || []).length >= nosubPageSize;
    nosubPageCache.set(targetPage, { ...finalResult, has_more: nosubHasMore });
    const extra = finalResult.truncated ? "（扫描数量达到上限，结果可能不完整）" : "";
    hideNosubProgress();
    setNosubStatus(
      `第 ${targetPage} 页 · 扫描 ${finalResult.scanned} 项，视频 ${finalResult.videos} 个，本页 ${finalResult.found} 个无字幕文件${nosubHasMore ? "，可继续下一页" : ""}${extra}`
    );
    renderNosubResults(finalResult);
  } catch (err) {
    if (err.name === "AbortError") {
      setNosubStatus("已取消扫描");
    } else {
      setNosubStatus(err.message || "排查失败", true);
    }
    hideNosubProgress();
  } finally {
    setNosubScanRunning(false);
    nosubAbort = null;
  }
}

function findNosubItem(path) {
  if (nosubScanData?.items) {
    const current = nosubScanData.items.find((item) => item.path === path);
    if (current) return current;
  }
  for (const page of nosubPageCache.values()) {
    const found = (page.items || []).find((item) => item.path === path);
    if (found) return found;
  }
  return null;
}

function removeNosubItemFromView(path) {
  if (!nosubScanData) return;
  nosubScanData.items = (nosubScanData.items || []).filter((item) => item.path !== path);
  nosubScanData.found = nosubScanData.items.length;
  const cached = nosubPageCache.get(nosubPage);
  if (cached) {
    cached.items = nosubScanData.items;
    cached.found = nosubScanData.found;
    nosubPageCache.set(nosubPage, cached);
  }
  if (!nosubScanData.items.length) {
    nosubResultsEl.classList.remove("fuzzy-results");
    nosubResultsEl.innerHTML = '<p class="folder-empty">这一页已经没有无字幕文件</p>';
    renderNosubPager();
    setNosubStatus("已处理完毕，可翻到下一页继续排查");
    return;
  }
  renderNosubResults(nosubScanData);
  setNosubStatus(`本页剩余 ${nosubScanData.found} 个无字幕文件`);
}

async function deleteNosubFile(button, path, name) {
  if (!isLoggedIn()) {
    openAuthModal("login");
    return;
  }
  const ok = await showAppConfirm({
    title: "删除原文件",
    message: `确定删除这个视频文件？\n${name}\n${path}`,
    confirmText: "删除",
    danger: true,
  });
  if (!ok) return;

  if (button) button.disabled = true;
  try {
    const res = await authFetch("/api/missing-subs/delete", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNosubStatus(data.detail || "删除失败", true);
      if (button) button.disabled = false;
      return;
    }
    removeNosubItemFromView(path);
    setNosubStatus(`已删除 ${name}`);
  } catch (err) {
    setNosubStatus(err.message || "删除失败", true);
    if (button) button.disabled = false;
  }
}

async function ignoreNosubFile(button, item) {
  if (!isLoggedIn()) {
    openAuthModal("login");
    return;
  }
  if (!item?.path) return;
  const ok = await showAppConfirm({
    title: "忽略这个文件",
    message: `忽略后下次排查不再显示这个文件。\n可在忽略列表里手动检查带字幕版本，找到后会推送到 115 并删除原文件。\n\n${item.name}\n${item.path}`,
    confirmText: "忽略",
  });
  if (!ok) return;

  if (button) button.disabled = true;
  try {
    const res = await authFetch("/api/missing-subs/ignore", {
      method: "POST",
      body: JSON.stringify({
        path: item.path,
        name: item.name || "",
        code: item.code || "",
        part: item.part || "",
        title: item.title || "",
        size: item.size || "",
        parent_dir: item.parent_dir || "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNosubStatus(data.detail || "忽略失败", true);
      if (button) button.disabled = false;
      return;
    }
    removeNosubItemFromView(item.path);
    setNosubStatus(`已忽略 ${item.name || item.code || "该文件"}`);
    closeNosubLookupModal();
  } catch (err) {
    setNosubStatus(err.message || "忽略失败", true);
    if (button) button.disabled = false;
  }
}

function setNosubIgnoredStatus(message, isError = false, loading = false) {
  if (!nosubIgnoredStatusEl) return;
  nosubIgnoredStatusEl.textContent = message || "";
  nosubIgnoredStatusEl.classList.toggle("hidden", !message);
  nosubIgnoredStatusEl.classList.toggle("errors", Boolean(isError));
  nosubIgnoredStatusEl.classList.toggle("loading", Boolean(loading));
}

function formatNosubBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2).replace(/\.?0+$/, "")}GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1).replace(/\.0$/, "")}MB`;
  return `${Math.round(size / 1024)}KB`;
}

function setNosubView(view) {
  nosubView = view === "ignored" || view === "logs" ? view : "scan";
  nosubScanView?.classList.toggle("hidden", nosubView !== "scan");
  nosubIgnoredView?.classList.toggle("hidden", nosubView !== "ignored");
  nosubLogsView?.classList.toggle("hidden", nosubView !== "logs");
  nosubViewScanBtn?.classList.toggle("active", nosubView === "scan");
  nosubViewIgnoredBtn?.classList.toggle("active", nosubView === "ignored");
  nosubViewLogsBtn?.classList.toggle("active", nosubView === "logs");
  if (nosubView === "ignored") loadNosubIgnoredList();
  if (nosubView === "logs") loadNosubReplaceLogs();
}

function renderNosubIgnoredItem(item) {
  const replaced = item.status === "replaced";
  const codeLabel = item.code || "未识别番号";
  const partLabel = item.part ? ` · ${item.part}` : "";
  const title = item.title || item.name || "未知标题";
  const sizeText = formatNosubBytes(item.size);
  const statusLabel = replaced ? "已替换" : "等待字幕";
  const checked = item.last_checked_at ? `上次检查 ${item.last_checked_at}` : "尚未检查";
  const replacedAt = item.replaced_at ? `替换于 ${item.replaced_at}` : "";
  return `
    <article class="fuzzy-item list-item nosub-card nosub-ignored-card${replaced ? " is-replaced" : ""}" data-id="${item.id}">
      <div class="fuzzy-info">
        <div class="fuzzy-code-row">
          ${
            item.code
              ? `<span class="fuzzy-code copy-code" data-code="${escapeAttr(item.code)}" title="点击复制番号">${escapeHtml(codeLabel)}${escapeHtml(partLabel)}</span>`
              : `<span class="fuzzy-code">${escapeHtml(codeLabel)}${escapeHtml(partLabel)}</span>`
          }
          <span class="badge ${replaced ? "badge-sub" : "badge-site"}">${statusLabel}</span>
        </div>
        <div class="fuzzy-title">${escapeHtml(title)}</div>
        <div class="nosub-filename" title="${escapeAttr(item.path)}">${escapeHtml(item.name || item.path)}</div>
        <div class="nosub-ignored-meta">
          ${sizeText ? `<span>${escapeHtml(sizeText)}</span>` : ""}
          <span>${escapeHtml(checked)}</span>
          ${replacedAt ? `<span>${escapeHtml(replacedAt)}</span>` : ""}
        </div>
        ${item.magnet_title ? `<div class="nosub-ignored-magnet" title="${escapeAttr(item.magnet_title)}">字幕磁力：${escapeHtml(item.magnet_title)}</div>` : ""}
        ${item.message ? `<div class="nosub-ignored-message">${escapeHtml(item.message)}</div>` : ""}
        <div class="list-item-actions">
          ${
            replaced
              ? ""
              : `<button class="nosub-ignored-check-btn ghost-btn" type="button" data-id="${item.id}">立即检查</button>`
          }
          <button class="ghost-btn nosub-unignore-btn" type="button" data-id="${item.id}">${replaced ? "从列表移除" : "取消忽略"}</button>
        </div>
      </div>
    </article>`;
}

function renderNosubIgnoredList(items) {
  nosubIgnoredItems = items || [];
  if (!nosubIgnoredResultsEl) return;
  if (!nosubIgnoredItems.length) {
    nosubIgnoredResultsEl.classList.remove("nosub-ignored-list");
    nosubIgnoredResultsEl.innerHTML = '<p class="folder-empty">还没有忽略的文件</p>';
    return;
  }
  nosubIgnoredResultsEl.classList.add("nosub-ignored-list");
  nosubIgnoredResultsEl.innerHTML = nosubIgnoredItems.map(renderNosubIgnoredItem).join("");
}

async function loadNosubIgnoredList() {
  if (!isLoggedIn()) {
    setNosubIgnoredStatus("查看忽略列表需要先登录", true);
    openAuthModal("login");
    return;
  }
  setNosubIgnoredStatus("正在加载忽略列表...", false, true);
  try {
    const res = await authFetch("/api/missing-subs/ignored");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "加载失败");
    const items = data.items || [];
    const waiting = items.filter((item) => item.status !== "replaced").length;
    const replaced = items.length - waiting;
    renderNosubIgnoredList(items);
    setNosubIgnoredStatus(
      items.length
        ? `共 ${items.length} 条，等待 ${waiting} 条，已替换 ${replaced} 条`
        : "还没有忽略的文件"
    );
  } catch (err) {
    setNosubIgnoredStatus(err.message || "加载失败", true);
  }
}

async function unignoreNosubItem(button, itemId) {
  if (button) button.disabled = true;
  try {
    const res = await authFetch(`/api/missing-subs/ignored/${itemId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "操作失败");
    nosubIgnoredItems = nosubIgnoredItems.filter((item) => String(item.id) !== String(itemId));
    renderNosubIgnoredList(nosubIgnoredItems);
    setNosubIgnoredStatus(`本页剩余 ${nosubIgnoredItems.length} 条忽略记录`);
  } catch (err) {
    setNosubIgnoredStatus(err.message || "操作失败", true);
    if (button) button.disabled = false;
  }
}

async function checkNosubIgnored(button, itemId = null) {
  if (!isLoggedIn()) {
    openAuthModal("login");
    return;
  }
  if (button) button.disabled = true;
  setNosubIgnoredStatus(itemId ? "正在检查这一条..." : "正在检查所有等待中的条目...", false, true);
  try {
    const res = await authFetch("/api/missing-subs/ignored/check", {
      method: "POST",
      body: JSON.stringify(itemId ? { id: Number(itemId) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "检查失败");
    await loadNosubIgnoredList();
    setNosubIgnoredStatus(data.message || "检查完成");
  } catch (err) {
    setNosubIgnoredStatus(err.message || "检查失败", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function deleteNosubOriginal(item) {
  if (!item?.path) return;
  try {
    const res = await authFetch("/api/missing-subs/delete", {
      method: "POST",
      body: JSON.stringify({ path: item.path }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "删除原文件失败");
    removeNosubItemFromView(item.path);
    setNosubLookupStatus("推送成功，已删除原来的无字幕文件");
    setNosubStatus(`已推送到 CD2，并删除 ${item.name}`);
    closeNosubLookupModal();
  } catch (err) {
    setNosubLookupStatus(`推送成功，但删除原文件失败: ${err.message}`, true);
    setNosubStatus(`推送成功，但删除原文件失败: ${err.message}`, true);
  }
}

function closeNosubLookupModal() {
  nosubLookupModal?.classList.add("hidden");
  nosubLookupIgnoreBtn?.classList.add("hidden");
  pendingNosubItem = null;
  nosubLookupList = [];
  if (nosubLookupResults) nosubLookupResults.innerHTML = "";
  setNosubLookupStatus("");
}

function nosubQueryCodes(code) {
  const value = (code || "").trim().toUpperCase().replace(/_/g, "-");
  if (!value) return [];
  const codes = [value];
  const stripped = value.match(/^1([A-Z]{2,10}-\d{2,7})$/);
  if (stripped) codes.unshift(stripped[1]);
  return [...new Set(codes)];
}

async function fuzzySearchCode(code) {
  const params = new URLSearchParams({ q: code });
  const res = await authFetch(`/api/search/fuzzy?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data.results || [];
}

function nosubLookupIgnoreButton() {
  return '<button class="nosub-lookup-ignore-btn ghost-btn" type="button">忽略</button>';
}

function nosubCodesMatch(a, b) {
  const left = String(a || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const right = String(b || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return Boolean(left && left === right);
}

function patchNosubLookupQuality(results, movie, query) {
  if (!movie) return results;
  return results.map((item) =>
    nosubCodesMatch(item.code, query) || nosubCodesMatch(item.code, movie.code)
      ? applyMovieQualityToListItem({ ...item }, movie)
      : item
  );
}

function applyMovieQualityToListItem(item, movie) {
  if (!item || !movie) return item;
  const flags = movieToListItem(movie);
  item.has_ultra = Boolean(item.has_ultra || flags.has_ultra);
  item.has_hd = Boolean(item.has_hd || flags.has_hd || item.has_ultra);
  item.has_subtitle = Boolean(item.has_subtitle || flags.has_subtitle);
  if (flags.best_magnet_link && !item.best_magnet_link) {
    item.best_magnet_link = flags.best_magnet_link;
    item.best_magnet_title = flags.best_magnet_title;
  }
  return item;
}

function renderNosubLookupList(results) {
  nosubLookupList = results;
  nosubLookupResults.innerHTML = `<div class="fuzzy-results">${results
    .map((item) => renderListItem(item, nosubLookupIgnoreButton()))
    .join("")}</div>`;
  setNosubLookupStatus(
    `找到 ${results.length} 条，点击条目查看详情。可直接复制或推送，推送成功后会删除原文件。也可以忽略当前无字幕文件。`
  );
}

async function showNosubLookupDetail(code) {
  setNosubLookupStatus(`正在加载 ${code} 详情...`, false, true);
  let movie = exactMovieCache.get(code);
  if (!movie) {
    movie = await loadMovieDetail(code);
    exactMovieCache.set(code, movie);
  }
  const back = nosubLookupList.length
    ? '<div class="detail-back-bar"><button class="ghost-btn nosub-back-list-btn" type="button">← 返回列表</button></div>'
    : "";
  nosubLookupResults.innerHTML = `${back}${renderMovieCard(movie)}`;
  setNosubLookupStatus(`已加载 ${movie.code}，可复制磁力或推送到 CD2。推送成功后会删除原文件。`);
  loadSubtitlesForCode(movie.code);
}

async function lookupNosubItem(item) {
  const code = (item.code || "").trim();
  if (!code) {
    setNosubStatus(`无法从 ${item.name} 识别番号`, true);
    return;
  }
  pendingNosubItem = item;
  nosubLookupList = [];
  nosubLookupTitle.textContent = `查找 ${code}`;
  nosubLookupHint.textContent = `原文件：${item.name}`;
  nosubLookupResults.innerHTML = "";
  nosubLookupModal.classList.remove("hidden");
  nosubLookupIgnoreBtn?.classList.remove("hidden");

  const queries = nosubQueryCodes(code);
  let lastError = "";
  const movieByQuery = Object.fromEntries(
    queries.map((query) => [query, loadMovieDetail(query).catch(() => null)])
  );
  for (const query of queries) {
    setNosubLookupStatus(`正在搜索 ${query}...`, false, true);
    try {
      const results = await fuzzySearchCode(query);
      if (results.length) {
        nosubLookupTitle.textContent = `查找 ${query}`;
        renderNosubLookupList(results);
        Promise.resolve(movieByQuery[query]).then((movie) => {
          if (!movie || nosubLookupTitle.textContent !== `查找 ${query}`) return;
          exactMovieCache.set(movie.code, movie);
          renderNosubLookupList(patchNosubLookupQuality(results, movie, query));
        });
        return;
      }
    } catch (err) {
      lastError = err.message || "搜索失败";
    }
  }

  for (const query of queries) {
    setNosubLookupStatus(`正在查询 ${query} 详情...`, false, true);
    try {
      await showNosubLookupDetail(query);
      return;
    } catch (err) {
      lastError = err.message || "查询失败";
    }
  }
  setNosubLookupStatus(lastError || `未找到 ${code}`, true);
}

function setNosubLogsStatus(message, isError = false, loading = false) {
  if (!nosubLogsStatusEl) return;
  nosubLogsStatusEl.textContent = message || "";
  nosubLogsStatusEl.classList.toggle("hidden", !message);
  nosubLogsStatusEl.classList.toggle("error", Boolean(isError));
  nosubLogsStatusEl.classList.toggle("loading", Boolean(loading));
}

function nosubReplaceStatusLabel(status) {
  return {
    replaced: "替换成功",
    not_found: "未找到字幕",
    push_failed: "推送失败",
    error: "处理失败",
    running: "进行中",
    done: "已完成",
    cancelled: "已取消",
  }[status] || status || "未知";
}

function renderNosubReplaceSection(title, items, emptyText) {
  const rows = (items || [])
    .map((item) => {
      const label = item.code || item.name || item.path || "未命名";
      const extra = item.message ? ` — ${item.message}` : "";
      const name = item.name && item.name !== label ? `（${item.name}）` : "";
      return `<li><strong>${escapeHtml(label)}</strong>${escapeHtml(name)}${escapeHtml(extra)}</li>`;
    })
    .join("");
  return `
    <section class="nosub-report-section">
      <h3>${escapeHtml(title)}（${items.length}）</h3>
      ${
        items.length
          ? `<ul class="nosub-report-list">${rows}</ul>`
          : `<p class="nosub-report-empty">${escapeHtml(emptyText)}</p>`
      }
    </section>`;
}

function openNosubReplaceReport(job) {
  if (!job || !nosubReplaceReportModal) return;
  const replaced = (job.items || []).filter((item) => item.status === "replaced");
  const notFound = (job.items || []).filter((item) => item.status === "not_found");
  const pushFailed = (job.items || []).filter((item) => item.status === "push_failed");
  const errors = (job.items || []).filter((item) => item.status === "error");
  if (nosubReplaceReportTitle) {
    nosubReplaceReportTitle.textContent = `一键替换记录 #${job.id}`;
  }
  if (nosubReplaceReportSummary) {
    nosubReplaceReportSummary.textContent = `${nosubReplaceStatusLabel(job.status)} · 扫描 ${job.scanned || 0} 项，视频 ${job.videos || 0} 个，待处理 ${job.total || 0} 个。成功 ${job.replaced_count || replaced.length}，未找到 ${job.not_found_count || notFound.length}，推送失败 ${job.push_failed_count || pushFailed.length}，其他失败 ${job.error_count || errors.length}。`;
  }
  if (nosubReplaceReportBody) {
    nosubReplaceReportBody.innerHTML = [
      renderNosubReplaceSection("替换成功", replaced, "没有替换成功的文件"),
      renderNosubReplaceSection("没有找到字幕", notFound, "没有未找到字幕的文件"),
      renderNosubReplaceSection("推送115失败", pushFailed, "没有推送失败的文件"),
      renderNosubReplaceSection("其他失败", errors, "没有其他失败"),
    ].join("");
  }
  nosubReplaceReportModal.classList.remove("hidden");
}

function closeNosubReplaceReport() {
  nosubReplaceReportModal?.classList.add("hidden");
}

function renderNosubReplaceLogs(jobs) {
  if (!nosubLogsResultsEl) return;
  if (!jobs.length) {
    nosubLogsResultsEl.innerHTML = '<p class="folder-empty">还没有一键替换记录</p>';
    return;
  }
  nosubLogsResultsEl.innerHTML = jobs
    .map((job) => `
      <article class="fuzzy-item list-item nosub-card nosub-log-card" data-job-id="${job.id}">
        <div class="fuzzy-info">
          <div class="fuzzy-code-row">
            <span class="fuzzy-code">记录 #${job.id}</span>
            <span class="badge ${job.status === "done" ? "badge-sub" : "badge-site"}">${escapeHtml(nosubReplaceStatusLabel(job.status))}</span>
          </div>
          <div class="fuzzy-title">${escapeHtml(job.message || "一键替换")}</div>
          <div class="nosub-log-counts">
            <span>开始 ${escapeHtml(job.started_at || "-")}</span>
            <span>成功 ${job.replaced_count || 0}</span>
            <span>未找到 ${job.not_found_count || 0}</span>
            <span>推送失败 ${job.push_failed_count || 0}</span>
            <span>其他失败 ${job.error_count || 0}</span>
          </div>
        </div>
      </article>`)
    .join("");
}

async function loadNosubReplaceLogs() {
  if (!isLoggedIn()) {
    setNosubLogsStatus("查看执行记录需要先登录", true);
    openAuthModal("login");
    return;
  }
  setNosubLogsStatus("正在加载执行记录...", false, true);
  try {
    const res = await authFetch("/api/missing-subs/replace/jobs");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "加载失败");
    const jobs = data.items || [];
    renderNosubReplaceLogs(jobs);
    setNosubLogsStatus(jobs.length ? `共 ${jobs.length} 条执行记录，点击查看详情` : "还没有一键替换记录");
  } catch (err) {
    setNosubLogsStatus(err.message || "加载失败", true);
  }
}

async function openNosubReplaceJob(jobId) {
  setNosubLogsStatus(`正在加载记录 #${jobId}...`, false, true);
  try {
    const res = await authFetch(`/api/missing-subs/replace/jobs/${jobId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "加载失败");
    openNosubReplaceReport(data);
    setNosubLogsStatus("");
  } catch (err) {
    setNosubLogsStatus(err.message || "加载失败", true);
    showToast(err.message || "加载执行记录失败", { type: "error" });
  }
}

function setNosubReplaceBusy(busy) {
  nosubReplaceRunning = busy;
  if (nosubReplaceBtn) nosubReplaceBtn.disabled = busy;
  if (nosubScanBtn) nosubScanBtn.disabled = busy;
  if (nosubCancelBtn) {
    nosubCancelBtn.classList.toggle("hidden", !busy);
    nosubCancelBtn.textContent = busy ? "取消替换" : "取消扫描";
  }
}

async function runNosubReplace() {
  if (!isLoggedIn()) {
    openAuthModal("login");
    return;
  }
  if (!nosubSelectedFolders.length) {
    setNosubStatus("请先选择文件夹", true);
    return;
  }
  if (typeof p115Ready !== "undefined" && !p115Ready) {
    showToast("还没有配置 115 Cookie，无法一键替换", { type: "error" });
    return;
  }
  const folderNames = nosubSelectedFolders.map((item) => item.name || item.path).join("、");
  const ok = await showAppConfirm({
    title: "一键替换无字幕文件",
    message: `将扫描这些目录里所有没有字幕的视频：\n${folderNames}\n\n如果接口里有带字幕磁力，会推送到 115 并删除现在的文件；没找到就跳过。推送失败会弹出提示，全部结果会写入执行记录。`,
    confirmText: "开始替换",
    danger: true,
  });
  if (!ok) return;

  nosubAbort?.abort();
  nosubAbort = new AbortController();
  setNosubReplaceBusy(true);
  setNosubView("scan");
  showNosubProgress({
    phase: "starting",
    scanned: 0,
    videos: 0,
    dirs: 0,
    folder_index: 0,
    folder_total: nosubSelectedFolders.length,
    current_dir: nosubSelectedFolders[0]?.path || "",
    found: 0,
    page_found: 0,
    percent: 0,
  });
  setNosubStatus("正在扫描无字幕文件...", false, true);

  let finalJob = null;
  try {
    const res = await authFetch("/api/missing-subs/replace/stream", {
      method: "POST",
      body: JSON.stringify({
        folders: nosubSelectedFolders.map((item) => item.path),
      }),
      signal: nosubAbort.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || "一键替换失败");
    }
    await readSseJson(res, (event) => {
      if (event.type === "progress") {
        showNosubProgress(event);
        setNosubStatus("正在扫描无字幕文件...", false, true);
        return;
      }
      if (event.type === "scan_done") {
        showNosubProgress({
          ...event,
          phase: "replacing",
          found: event.total,
          page_found: event.total,
          percent: event.total ? 5 : 100,
          current_dir: "",
        });
        setNosubStatus(`扫描完成，开始处理 ${event.total} 个文件`, false, true);
        return;
      }
      if (event.type === "item_start") {
        const percent = event.total ? Math.min(99, Math.round((event.index / event.total) * 100)) : 50;
        showNosubProgress({
          phase: "replacing",
          scanned: event.index,
          videos: event.total,
          found: event.index,
          page_found: event.total,
          percent,
          current_dir: event.path || event.name || "",
        });
        setNosubStatus(`正在处理 ${event.index}/${event.total} ${event.code || event.name || ""}`, false, true);
        return;
      }
      if (event.type === "item" && event.status === "replaced") {
        removeNosubItemFromView(event.path);
      }
      if (event.type === "toast") {
        showToast(event.message, { type: event.kind || "error" });
        return;
      }
      if (event.type === "done") {
        finalJob = event.job;
        return;
      }
      if (event.type === "cancelled") {
        throw new DOMException("已取消一键替换", "AbortError");
      }
      if (event.type === "error") {
        throw new Error(event.message || "一键替换失败");
      }
    });
  } catch (err) {
    if (err.name === "AbortError") {
      setNosubStatus("已取消一键替换");
    } else {
      setNosubStatus(err.message || "一键替换失败", true);
      showToast(err.message || "一键替换失败", { type: "error" });
    }
    hideNosubProgress();
    setNosubReplaceBusy(false);
    if (nosubCancelBtn) nosubCancelBtn.textContent = "取消扫描";
    return;
  }

  hideNosubProgress();
  setNosubReplaceBusy(false);
  if (nosubCancelBtn) nosubCancelBtn.textContent = "取消扫描";
  if (!finalJob) {
    setNosubStatus("一键替换结束，但没有返回记录", true);
    return;
  }
  setNosubStatus(
    `一键替换完成：成功 ${finalJob.replaced_count || 0}，未找到 ${finalJob.not_found_count || 0}，推送失败 ${finalJob.push_failed_count || 0}，其他失败 ${finalJob.error_count || 0}`
  );
  openNosubReplaceReport(finalJob);
}

function afterNosubPushSuccess() {
  return async () => {
    if (pendingNosubItem) {
      await deleteNosubOriginal(pendingNosubItem);
    }
  };
}

nosubAddFolderBtn?.addEventListener("click", openNosubFolderModal);
nosubClearFoldersBtn?.addEventListener("click", () => {
  nosubSelectedFolders = [];
  clearNosubPages();
  renderNosubSelectedFolders();
  nosubResultsEl.innerHTML = "";
  renderNosubPager();
  setNosubStatus("");
});
nosubScanBtn?.addEventListener("click", () => scanMissingSubs(1, { reset: true }));
nosubReplaceBtn?.addEventListener("click", () => runNosubReplace());
nosubPageSizeSelect?.addEventListener("change", () => {
  nosubPageSize = currentNosubPageSize();
  if (!nosubSelectedFolders.length) return;
  if (nosubScanData || nosubPageCache.size) {
    scanMissingSubs(1, { reset: true });
  }
});
nosubPagerEl?.addEventListener("click", (event) => {
  if (event.target.id === "nosubPrevPageBtn" && nosubPage > 1) {
    scanMissingSubs(nosubPage - 1);
    return;
  }
  if (event.target.id === "nosubNextPageBtn" && nosubHasMore) {
    scanMissingSubs(nosubPage + 1);
  }
});
nosubCancelBtn?.addEventListener("click", () => {
  nosubAbort?.abort();
});
closeNosubFolderModalBtn?.addEventListener("click", closeNosubFolderModal);
closeNosubLookupModalBtn?.addEventListener("click", closeNosubLookupModal);
nosubLookupIgnoreBtn?.addEventListener("click", (event) => {
  if (pendingNosubItem) ignoreNosubFile(event.currentTarget, pendingNosubItem);
});
nosubFolderUpBtn?.addEventListener("click", () => {
  if (nosubBrowseParent === null) return;
  loadNosubFolders(nosubBrowseParent);
});
nosubFolderAddCurrentBtn?.addEventListener("click", () => {
  const name = nosubBrowsePath.split("/").filter(Boolean).pop() || nosubBrowsePath;
  addNosubFolder(nosubBrowsePath, name);
});

nosubFolderList?.addEventListener("click", (event) => {
  const openBtn = event.target.closest(".nosub-open-btn");
  if (openBtn) {
    loadNosubFolders(openBtn.dataset.path || "");
    return;
  }
  const pickBtn = event.target.closest(".nosub-pick-btn");
  if (pickBtn) {
    addNosubFolder(pickBtn.dataset.path || "", pickBtn.dataset.name || "");
  }
});

nosubSelectedFoldersEl?.addEventListener("click", (event) => {
  const removeBtn = event.target.closest("[data-remove-path]");
  if (!removeBtn) return;
  const path = removeBtn.dataset.removePath;
  nosubSelectedFolders = nosubSelectedFolders.filter((item) => item.path !== path);
  renderNosubSelectedFolders();
});

nosubResultsEl?.addEventListener("click", (event) => {
  const lookupBtn = event.target.closest(".nosub-lookup-btn");
  if (lookupBtn) {
    const item = findNosubItem(lookupBtn.dataset.path || "");
    if (item) lookupNosubItem(item);
    return;
  }
  const ignoreBtn = event.target.closest(".nosub-ignore-btn");
  if (ignoreBtn) {
    event.stopPropagation();
    const item = findNosubItem(ignoreBtn.dataset.path || "");
    if (item) ignoreNosubFile(ignoreBtn, item);
    return;
  }
  const deleteBtn = event.target.closest(".nosub-delete-btn");
  if (deleteBtn) {
    event.stopPropagation();
    deleteNosubFile(deleteBtn, deleteBtn.dataset.path || "", deleteBtn.dataset.name || "");
    return;
  }
  const card = event.target.closest(".nosub-card");
  if (card && event.target.closest(".privacy-hide-btn")) {
    event.stopPropagation();
    const privacyImage = event.target.closest(".privacy-image");
    if (privacyImage) hidePrivacyImage(privacyImage);
    return;
  }
  if (card && event.target.closest(".privacy-image")) {
    event.stopPropagation();
    revealPrivacyImage(event.target.closest(".privacy-image"));
    return;
  }
});

nosubLookupResults?.addEventListener("click", async (event) => {
  const ignoreBtn = event.target.closest(".nosub-lookup-ignore-btn");
  if (ignoreBtn) {
    event.stopPropagation();
    if (pendingNosubItem) ignoreNosubFile(ignoreBtn, pendingNosubItem);
    return;
  }
  if (event.target.closest(".nosub-back-list-btn")) {
    renderNosubLookupList(nosubLookupList);
    return;
  }

  const copyBestBtn = event.target.closest(".copy-best-btn");
  if (copyBestBtn) {
    event.stopPropagation();
    const code = copyBestBtn.dataset.code;
    const original = copyBestBtn.textContent;
    try {
      copyBestBtn.disabled = true;
      copyBestBtn.textContent = "获取中...";
      const link = copyBestBtn.dataset.link || "";
      let resolved = link;
      if (!resolved) {
        const movie = exactMovieCache.get(code) || (await loadMovieDetail(code));
        exactMovieCache.set(code, movie);
        resolved = movie.magnets?.[0]?.link || "";
      }
      if (!resolved) throw new Error("没有可复制的磁力链接");
      await copyMagnetLink(resolved, copyBestBtn);
    } catch (err) {
      setNosubLookupStatus(err.message || "复制失败", true);
      copyBestBtn.textContent = original;
    } finally {
      copyBestBtn.disabled = false;
    }
    return;
  }

  const subtitleOpenBtn = event.target.closest(".subtitle-open-btn");
  if (subtitleOpenBtn) {
    event.stopPropagation();
    openSubtitleModal(subtitleOpenBtn.dataset.code);
    return;
  }

  const listPush115 = event.target.closest(".list-item-actions .push-115-btn");
  if (listPush115) {
    event.stopPropagation();
    await openP115MagnetModal({
      magnet: listPush115.dataset.link || "",
      code: listPush115.dataset.code || "",
      button: listPush115,
    });
    return;
  }

  const listPushBest = event.target.closest(".list-item-actions .push-best-btn");
  if (listPushBest?.dataset.code) {
    event.stopPropagation();
    if (pushBackend === "p115") {
      await openP115MagnetModal({
        magnet: listPushBest.dataset.link || "",
        code: listPushBest.dataset.code,
        button: listPushBest,
      });
      return;
    }
    const existing = listPushBest.dataset.link;
    await pushToOffline({
      magnets: existing ? [existing] : [],
      code: listPushBest.dataset.code,
      pushBest: !existing,
      button: listPushBest,
      onSuccess: afterNosubPushSuccess(),
    });
    return;
  }

  const listItem = event.target.closest(".fuzzy-item");
  if (listItem?.dataset.code && !event.target.closest(".list-item-actions") && !event.target.closest(".card") && !event.target.closest(".fuzzy-cover")) {
    await showNosubLookupDetail(listItem.dataset.code);
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

  if (await handleSubtitleItemClick(event)) {
    return;
  }

  const copyBtn = event.target.closest(".copy-btn");
  if (copyBtn) {
    await copyMagnetLink(copyBtn.dataset.link, copyBtn);
    return;
  }

  const push115Btn = event.target.closest(".push-115-btn, .push-115-best-btn");
  if (push115Btn) {
    event.stopPropagation();
    await openP115MagnetModal({
      magnet: push115Btn.dataset.link || "",
      code: push115Btn.dataset.code || "",
      button: push115Btn,
    });
    return;
  }

  const pushBtn = event.target.closest(".push-btn");
  if (pushBtn) {
    if (pushBackend === "p115") {
      await openP115MagnetModal({ magnet: pushBtn.dataset.link || "", button: pushBtn });
      return;
    }
    await pushToOffline({
      magnets: [pushBtn.dataset.link],
      button: pushBtn,
      onSuccess: afterNosubPushSuccess(),
    });
    return;
  }

  const pushBestBtn = event.target.closest(".push-best-btn");
  if (pushBestBtn?.dataset.code) {
    if (pushBackend === "p115") {
      await openP115MagnetModal({
        magnet: pushBestBtn.dataset.link || "",
        code: pushBestBtn.dataset.code,
        button: pushBestBtn,
      });
      return;
    }
    await pushToOffline({
      code: pushBestBtn.dataset.code,
      pushBest: true,
      button: pushBestBtn,
      onSuccess: afterNosubPushSuccess(),
    });
  }
});

nosubFolderModal?.addEventListener("click", (event) => {
  if (event.target === nosubFolderModal) closeNosubFolderModal();
});
nosubLookupModal?.addEventListener("click", (event) => {
  if (event.target === nosubLookupModal) closeNosubLookupModal();
});

nosubViewScanBtn?.addEventListener("click", () => setNosubView("scan"));
nosubViewIgnoredBtn?.addEventListener("click", () => setNosubView("ignored"));
nosubViewLogsBtn?.addEventListener("click", () => setNosubView("logs"));
nosubLogsRefreshBtn?.addEventListener("click", () => loadNosubReplaceLogs());
closeNosubReplaceReportBtn?.addEventListener("click", closeNosubReplaceReport);
nosubLogsResultsEl?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-job-id]");
  if (!card) return;
  openNosubReplaceJob(card.dataset.jobId);
});
nosubIgnoredRefreshBtn?.addEventListener("click", () => loadNosubIgnoredList());
nosubIgnoredCheckBtn?.addEventListener("click", (event) => {
  checkNosubIgnored(event.currentTarget);
});
nosubIgnoredResultsEl?.addEventListener("click", (event) => {
  const checkBtn = event.target.closest(".nosub-ignored-check-btn");
  if (checkBtn) {
    event.stopPropagation();
    checkNosubIgnored(checkBtn, checkBtn.dataset.id);
    return;
  }
  const unignoreBtn = event.target.closest(".nosub-unignore-btn");
  if (unignoreBtn) {
    event.stopPropagation();
    unignoreNosubItem(unignoreBtn, unignoreBtn.dataset.id);
  }
});

renderNosubSelectedFolders();
