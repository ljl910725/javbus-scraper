const cleanupAddFolderBtn = document.getElementById("cleanupAddFolderBtn");
const cleanupClearFoldersBtn = document.getElementById("cleanupClearFoldersBtn");
const cleanupScanBtn = document.getElementById("cleanupScanBtn");
const cleanupRunBtn = document.getElementById("cleanupRunBtn");
const cleanupCancelBtn = document.getElementById("cleanupCancelBtn");
const cleanupSelectedFoldersEl = document.getElementById("cleanupSelectedFolders");
const cleanupExtraExtsInput = document.getElementById("cleanupExtraExts");
const cleanupStatusEl = document.getElementById("cleanupStatus");
const cleanupResultsEl = document.getElementById("cleanupResults");
const cleanupProgressEl = document.getElementById("cleanupProgress");
const cleanupProgressFill = document.getElementById("cleanupProgressFill");
const cleanupProgressText = document.getElementById("cleanupProgressText");
const cleanupProgressPath = document.getElementById("cleanupProgressPath");
const cleanupFolderModal = document.getElementById("cleanupFolderModal");
const cleanupFolderList = document.getElementById("cleanupFolderList");
const cleanupFolderCurrentPath = document.getElementById("cleanupFolderCurrentPath");
const cleanupFolderUpBtn = document.getElementById("cleanupFolderUpBtn");
const cleanupFolderAddCurrentBtn = document.getElementById("cleanupFolderAddCurrentBtn");
const cleanupFolderModalStatus = document.getElementById("cleanupFolderModalStatus");
const closeCleanupFolderModalBtn = document.getElementById("closeCleanupFolderModalBtn");

const CLEANUP_REASON_LABELS = {
  html: "HTML",
  txt: "TXT",
  small_video: "小视频",
  extra: "额外后缀",
};

let cleanupSelectedFolders = [];
let cleanupBrowsePath = "";
let cleanupBrowseParent = null;
let cleanupScanData = null;
let cleanupAbort = null;
let cleanupBusy = false;

function setCleanupStatus(message, isError = false, loading = false) {
  if (!cleanupStatusEl) return;
  cleanupStatusEl.textContent = message || "";
  cleanupStatusEl.classList.toggle("hidden", !message);
  cleanupStatusEl.classList.toggle("errors", Boolean(isError));
  cleanupStatusEl.classList.toggle("loading", Boolean(loading));
}

function setCleanupFolderStatus(message, isError = false) {
  if (!cleanupFolderModalStatus) return;
  cleanupFolderModalStatus.textContent = message || "";
  cleanupFolderModalStatus.classList.toggle("errors", Boolean(isError));
}

function cleanupFolderAlreadySelected(path) {
  return cleanupSelectedFolders.some((item) => item.path === path);
}

function renderCleanupSelectedFolders() {
  if (!cleanupSelectedFoldersEl) return;
  if (!cleanupSelectedFolders.length) {
    cleanupSelectedFoldersEl.innerHTML = '<span class="field-hint">尚未选择文件夹</span>';
    return;
  }
  cleanupSelectedFoldersEl.innerHTML = cleanupSelectedFolders
    .map(
      (folder) => `
      <div class="dup-chip" title="${escapeAttr(folder.path)}">
        <span>${escapeHtml(folder.name)}</span>
        <button type="button" data-remove-path="${escapeAttr(folder.path)}" aria-label="移除">×</button>
      </div>`
    )
    .join("");
}

function addCleanupFolder(path, name) {
  const folderPath = (path || "").trim();
  if (!folderPath) {
    setCleanupFolderStatus("当前位置不能添加，请进入具体目录", true);
    return;
  }
  if (cleanupFolderAlreadySelected(folderPath)) {
    setCleanupFolderStatus("该文件夹已在列表中");
    return;
  }
  cleanupSelectedFolders.push({
    path: folderPath,
    name: name || folderPath.split("/").filter(Boolean).pop() || folderPath,
  });
  renderCleanupSelectedFolders();
  cleanupScanData = null;
  setCleanupFolderStatus(`已添加：${name || folderPath}`);
}

function renderCleanupFolderList(data) {
  cleanupBrowsePath = data.current_path || "";
  cleanupBrowseParent = data.parent_path ?? null;
  cleanupFolderCurrentPath.textContent = cleanupBrowsePath || "挂载根目录";
  cleanupFolderUpBtn.disabled = cleanupBrowseParent === null;
  cleanupFolderAddCurrentBtn.disabled = !data.selectable || !cleanupBrowsePath;

  const folders = data.folders || [];
  if (!folders.length) {
    cleanupFolderList.innerHTML = '<p class="folder-empty">当前目录没有子文件夹</p>';
    return;
  }

  cleanupFolderList.innerHTML = folders
    .map(
      (folder) => `
      <div class="folder-item">
        <div class="folder-item-main">
          <strong>📁 ${escapeHtml(folder.name)}</strong>
        </div>
        <div class="folder-item-path">${escapeHtml(folder.path)}</div>
        <div class="folder-item-actions">
          <button class="ghost-btn cleanup-open-btn" type="button" data-path="${escapeAttr(folder.path)}">进入</button>
          <button class="ghost-btn cleanup-pick-btn" type="button" data-path="${escapeAttr(folder.path)}" data-name="${escapeAttr(folder.name)}">加入清理</button>
        </div>
      </div>`
    )
    .join("");
}

async function loadCleanupFolders(path = "") {
  setCleanupFolderStatus("正在加载目录...");
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await authFetch(`/api/subtitles/browse${query}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setCleanupFolderStatus(data.detail || "加载目录失败", true);
    cleanupFolderList.innerHTML = "";
    return;
  }
  renderCleanupFolderList(data);
  setCleanupFolderStatus("");
}

function openCleanupFolderModal() {
  if (!isLoggedIn()) {
    setCleanupStatus("清理垃圾文件需要先登录", true);
    openAuthModal("login");
    return;
  }
  cleanupFolderModal.classList.remove("hidden");
  loadCleanupFolders(cleanupBrowsePath);
}

function closeCleanupFolderModal() {
  cleanupFolderModal.classList.add("hidden");
  setCleanupFolderStatus("");
}

function cleanupRequestBody() {
  return {
    folders: cleanupSelectedFolders.map((item) => item.path),
    extra_exts: (cleanupExtraExtsInput?.value || "").trim(),
  };
}

function formatCleanupSize(size) {
  if (typeof formatDupSize === "function") return formatDupSize(size);
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function cleanupCountSummary(counts = {}) {
  return ["html", "txt", "small_video", "extra"]
    .map((key) => `${CLEANUP_REASON_LABELS[key]} ${counts[key] || 0}`)
    .join("、");
}

function renderCleanupResults(data, { ran = false } = {}) {
  cleanupScanData = ran ? null : data;
  if (!cleanupResultsEl) return;
  if (!data) {
    cleanupResultsEl.innerHTML = "";
    return;
  }

  const counts = data.counts || {};
  const stats = [
    ["待删文件", ran ? data.deleted_files ?? 0 : data.matched || 0],
    ["HTML", counts.html || 0],
    ["TXT", counts.txt || 0],
    ["小视频", counts.small_video || 0],
    ["额外后缀", counts.extra || 0],
    [ran ? "已删空目录" : "空子目录", ran ? data.deleted_dirs ?? 0 : data.empty_dir_count || 0],
    [ran ? "已释放" : "约占用", formatCleanupSize(data.bytes || 0)],
  ];

  const files = data.files || [];
  const emptyDirs = data.empty_dirs || [];
  const failed = data.failed || [];
  const extra = (data.extra_exts || []).join("、") || "无";
  const sampleNote = data.sample_truncated ? "（仅显示部分样例）" : "";

  cleanupResultsEl.innerHTML = `
    <div class="cleanup-stats">
      ${stats
        .map(
          ([label, value]) => `
        <div class="cleanup-stat">
          <strong>${escapeHtml(String(value))}</strong>
          <span>${escapeHtml(label)}</span>
        </div>`
        )
        .join("")}
    </div>
    <p class="field-hint">额外后缀：${escapeHtml(extra)}。选中的根目录即使空了也不会删除。${sampleNote}</p>
    ${
      failed.length
        ? `<section class="cleanup-failed"><h3>失败 ${data.failed_count || failed.length} 项</h3>${failed
            .map(
              (item) =>
                `<div class="dup-file"><div class="dup-file-name"><strong>${escapeHtml(item.path)}</strong></div><div class="dup-file-path">${escapeHtml(item.message || "删除失败")}</div></div>`
            )
            .join("")}</section>`
        : ""
    }
    ${
      files.length
        ? `<section class="cleanup-file-list"><h3>文件样例 ${files.length} 个</h3>${files
            .map((file) => {
              const sizeText = formatCleanupSize(file.size);
              const reason = CLEANUP_REASON_LABELS[file.reason] || file.reason || "";
              return `
                <div class="dup-file">
                  <div class="dup-file-name">
                    <strong>${escapeHtml(file.name)}</strong>
                    <small>${escapeHtml(reason)}</small>
                  </div>
                  <div class="dup-file-path">${escapeHtml(file.path)}${sizeText ? ` · ${sizeText}` : ""}</div>
                </div>`;
            })
            .join("")}</section>`
        : ran
          ? ""
          : '<p class="folder-empty">没有匹配到可清理的文件</p>'
    }
    ${
      emptyDirs.length
        ? `<section class="cleanup-file-list"><h3>将删除的空子文件夹 ${emptyDirs.length} 个</h3>${emptyDirs
            .map(
              (dir) => `
              <div class="dup-file">
                <div class="dup-file-name"><strong>📁 ${escapeHtml(dir.name || dir.path)}</strong></div>
                <div class="dup-file-path">${escapeHtml(dir.path)}</div>
              </div>`
            )
            .join("")}</section>`
        : ""
    }
  `;
}

function setCleanupRunning(running) {
  cleanupBusy = running;
  if (cleanupScanBtn) cleanupScanBtn.disabled = running;
  if (cleanupRunBtn) cleanupRunBtn.disabled = running;
  if (cleanupAddFolderBtn) cleanupAddFolderBtn.disabled = running;
  if (cleanupClearFoldersBtn) cleanupClearFoldersBtn.disabled = running;
  if (cleanupExtraExtsInput) cleanupExtraExtsInput.disabled = running;
  cleanupCancelBtn?.classList.toggle("hidden", !running);
}

function hideCleanupProgress() {
  cleanupProgressEl?.classList.add("hidden");
  cleanupProgressFill?.classList.remove("is-indeterminate");
  if (cleanupProgressFill) cleanupProgressFill.style.width = "0%";
}

function cleanupPhaseLabel(phase) {
  if (phase === "deleting") return "正在删除文件";
  if (phase === "pruning") return "正在清理空目录";
  if (phase === "summarizing") return "正在汇总";
  return "正在扫描";
}

function showCleanupProgress(event) {
  if (!cleanupProgressEl) return;
  cleanupProgressEl.classList.remove("hidden");
  const folderTotal = Number(event.folder_total) || 0;
  const folderIndex = Number(event.folder_index) || 0;
  const percent = Number(event.percent);
  if (Number.isFinite(percent) && percent > 0) {
    cleanupProgressFill?.classList.remove("is-indeterminate");
    if (cleanupProgressFill) cleanupProgressFill.style.width = `${Math.max(4, Math.min(100, percent))}%`;
  } else {
    cleanupProgressFill?.classList.add("is-indeterminate");
    if (cleanupProgressFill) cleanupProgressFill.style.width = "";
  }
  const folderLabel = folderTotal ? `文件夹 ${Math.min(folderIndex + 1, folderTotal)}/${folderTotal}` : "处理中";
  const matched = event.matched || 0;
  const extra =
    event.phase === "deleting" || event.phase === "pruning"
      ? ` · 已删文件 ${event.deleted_files || 0} · 空目录 ${event.deleted_dirs || 0}`
      : ` · 匹配 ${matched} 个`;
  if (cleanupProgressText) {
    cleanupProgressText.textContent = `${cleanupPhaseLabel(event.phase)} · ${folderLabel} · 已扫描 ${event.scanned || 0} 项 · 目录 ${event.dirs || 0} 个${extra}`;
  }
  if (cleanupProgressPath) {
    cleanupProgressPath.textContent = event.current_dir ? `当前：${event.current_dir}` : "";
  }
}

async function runCleanupStream(url, { confirmMessage, successPrefix }) {
  if (!isLoggedIn()) {
    setCleanupStatus("清理垃圾文件需要先登录", true);
    openAuthModal("login");
    return;
  }
  if (!cleanupSelectedFolders.length) {
    setCleanupStatus("请先选择至少一个文件夹", true);
    return;
  }
  if (confirmMessage) {
    const ok = window.confirm(confirmMessage);
    if (!ok) return;
  }

  cleanupAbort?.abort();
  cleanupAbort = new AbortController();
  setCleanupRunning(true);
  setCleanupStatus("正在连接任务...", false, true);
  showCleanupProgress({
    phase: "starting",
    scanned: 0,
    matched: 0,
    dirs: 0,
    folder_index: 0,
    folder_total: cleanupSelectedFolders.length,
    current_dir: cleanupSelectedFolders[0]?.path || "",
    percent: 0,
  });
  try {
    const res = await authFetch(url, {
      method: "POST",
      body: JSON.stringify(cleanupRequestBody()),
      signal: cleanupAbort.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCleanupStatus(data.detail || "操作失败", true);
      hideCleanupProgress();
      return;
    }

    let finalResult = null;
    let endedType = "";
    await readSseJson(res, (event) => {
      endedType = event.type;
      if (event.type === "progress") {
        showCleanupProgress(event);
        setCleanupStatus(`${cleanupPhaseLabel(event.phase)}，请稍候...`, false, true);
        return;
      }
      if (event.type === "done") {
        finalResult = event.result;
        return;
      }
      if (event.type === "error") {
        throw new Error(event.message || "操作失败");
      }
    });

    if (endedType === "cancelled") {
      setCleanupStatus("已取消");
      hideCleanupProgress();
      return;
    }
    if (!finalResult) {
      setCleanupStatus("任务中断，未返回结果", true);
      hideCleanupProgress();
      return;
    }
    const extra = finalResult.truncated ? "（扫描数量达到上限，结果可能不完整）" : "";
    hideCleanupProgress();
    const ran = url.includes("/run/");
    if (ran) {
      const failNote = finalResult.failed_count ? `，失败 ${finalResult.failed_count} 项` : "";
      setCleanupStatus(
        `${successPrefix}删除 ${finalResult.deleted_files || 0} 个文件、${finalResult.deleted_dirs || 0} 个空子文件夹，释放 ${formatCleanupSize(finalResult.bytes || 0)}（${cleanupCountSummary(finalResult.counts)}）${failNote}${extra}`
      );
      renderCleanupResults(finalResult, { ran: true });
    } else {
      setCleanupStatus(
        `${successPrefix}扫描 ${finalResult.scanned} 项，匹配 ${finalResult.matched || 0} 个文件、${finalResult.empty_dir_count || 0} 个空子文件夹，约 ${formatCleanupSize(finalResult.bytes || 0)}（${cleanupCountSummary(finalResult.counts)}）${extra}`
      );
      renderCleanupResults(finalResult);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      setCleanupStatus("已取消");
    } else {
      setCleanupStatus(err.message || "操作失败", true);
    }
    hideCleanupProgress();
  } finally {
    setCleanupRunning(false);
    cleanupAbort = null;
  }
}

function scanCleanup() {
  return runCleanupStream("/api/cleanup/scan/stream", {
    successPrefix: "",
  });
}

function runCleanup() {
  const data = cleanupScanData;
  const extraText = (cleanupExtraExtsInput?.value || "").trim();
  const lines = [
    "确定开始清理？删除后不可恢复。",
    "将删除 html / txt、小于 100MB 的视频，以及额外后缀文件（额外后缀不限大小）。",
    extraText ? `额外后缀：${extraText}` : "未填写额外后缀。",
    "变空的子文件夹会被删掉，选中的根目录即使空了也不会删除。",
  ];
  if (data) {
    lines.splice(
      1,
      0,
      `预览结果：${data.matched || 0} 个文件（约 ${formatCleanupSize(data.bytes || 0)}），${data.empty_dir_count || 0} 个空子文件夹（${cleanupCountSummary(data.counts)}）。`
    );
  }
  return runCleanupStream("/api/cleanup/run/stream", {
    confirmMessage: lines.join("\n"),
    successPrefix: "已",
  });
}

cleanupAddFolderBtn?.addEventListener("click", openCleanupFolderModal);
cleanupClearFoldersBtn?.addEventListener("click", () => {
  cleanupSelectedFolders = [];
  cleanupScanData = null;
  renderCleanupSelectedFolders();
  renderCleanupResults(null);
  setCleanupStatus("");
});
cleanupScanBtn?.addEventListener("click", scanCleanup);
cleanupRunBtn?.addEventListener("click", runCleanup);
cleanupCancelBtn?.addEventListener("click", () => {
  cleanupAbort?.abort();
});
cleanupExtraExtsInput?.addEventListener("input", () => {
  cleanupScanData = null;
});
closeCleanupFolderModalBtn?.addEventListener("click", closeCleanupFolderModal);
cleanupFolderUpBtn?.addEventListener("click", () => {
  if (cleanupBrowseParent === null) return;
  loadCleanupFolders(cleanupBrowseParent);
});
cleanupFolderAddCurrentBtn?.addEventListener("click", () => {
  const name = cleanupBrowsePath.split("/").filter(Boolean).pop() || cleanupBrowsePath;
  addCleanupFolder(cleanupBrowsePath, name);
});

cleanupFolderList?.addEventListener("click", (event) => {
  const openBtn = event.target.closest(".cleanup-open-btn");
  if (openBtn) {
    loadCleanupFolders(openBtn.dataset.path || "");
    return;
  }
  const pickBtn = event.target.closest(".cleanup-pick-btn");
  if (pickBtn) {
    addCleanupFolder(pickBtn.dataset.path || "", pickBtn.dataset.name || "");
  }
});

cleanupSelectedFoldersEl?.addEventListener("click", (event) => {
  const removeBtn = event.target.closest("[data-remove-path]");
  if (!removeBtn) return;
  const path = removeBtn.dataset.removePath;
  cleanupSelectedFolders = cleanupSelectedFolders.filter((item) => item.path !== path);
  cleanupScanData = null;
  renderCleanupSelectedFolders();
});

cleanupFolderModal?.addEventListener("click", (event) => {
  if (event.target === cleanupFolderModal) closeCleanupFolderModal();
});

renderCleanupSelectedFolders();
