const dupAddFolderBtn = document.getElementById("dupAddFolderBtn");
const dupClearFoldersBtn = document.getElementById("dupClearFoldersBtn");
const dupScanBtn = document.getElementById("dupScanBtn");
const dupCancelBtn = document.getElementById("dupCancelBtn");
const dupStatusEl = document.getElementById("dupStatus");
const dupResultsEl = document.getElementById("dupResults");
const dupProgressEl = document.getElementById("dupProgress");
const dupProgressFill = document.getElementById("dupProgressFill");
const dupProgressText = document.getElementById("dupProgressText");
const dupProgressPath = document.getElementById("dupProgressPath");
const dupPageSizeSelect = document.getElementById("dupPageSizeSelect");
const dupPagerEl = document.getElementById("dupPager");

const DUP_PAGE_SIZES = [10, 20, 50, 100];
let dupScanData = null;
let dupAbort = null;
let dupPage = 1;
let dupPageSize = 10;

// 选择文件夹的弹窗和已选列表由 folder-picker.js 统一处理
const dupFolderPicker = createFolderPicker({
  prefix: "dup",
  pickText: "加入筛选",
  loginMessage: "筛选相同文件需要先登录",
  setPageStatus: (message, isError) => setDupStatus(message, isError),
});

function currentDupPageSize() {
  const value = Number(dupPageSizeSelect?.value);
  return DUP_PAGE_SIZES.includes(value) ? value : 10;
}

function renderDupPager(totalGroups) {
  if (!dupPagerEl) return;
  if (!totalGroups) {
    dupPagerEl.classList.add("hidden");
    dupPagerEl.innerHTML = "";
    return;
  }
  const totalPages = Math.max(1, Math.ceil(totalGroups / dupPageSize));
  if (dupPage > totalPages) dupPage = totalPages;
  dupPagerEl.classList.remove("hidden");
  const prevDisabled = dupPage <= 1 ? " disabled" : "";
  const nextDisabled = dupPage >= totalPages ? " disabled" : "";
  dupPagerEl.innerHTML = `
    <button class="ghost-btn" type="button" id="dupPrevPageBtn"${prevDisabled}>上一页</button>
    <span class="list-page-info">第 ${dupPage} / ${totalPages} 页 · 共 ${totalGroups} 组</span>
    <button class="ghost-btn" type="button" id="dupNextPageBtn"${nextDisabled}>下一页</button>
  `;
}

function setDupStatus(message, isError = false, loading = false) {
  if (!dupStatusEl) return;
  dupStatusEl.textContent = message || "";
  dupStatusEl.classList.toggle("hidden", !message);
  dupStatusEl.classList.toggle("errors", Boolean(isError));
  dupStatusEl.classList.toggle("loading", Boolean(loading));
}

function renderDupResults(data) {
  dupScanData = data;
  const groups = data?.groups || [];
  if (!groups.length) {
    dupResultsEl.innerHTML = '<p class="folder-empty">没有找到番号相同的视频文件</p>';
    renderDupPager(0);
    return;
  }

  dupPageSize = currentDupPageSize();
  const totalPages = Math.max(1, Math.ceil(groups.length / dupPageSize));
  if (dupPage > totalPages) dupPage = totalPages;
  const start = (dupPage - 1) * dupPageSize;
  const pageGroups = groups.slice(start, start + dupPageSize);
  renderDupPager(groups.length);

  dupResultsEl.innerHTML = pageGroups
    .map(
      (group) => `
      <section class="dup-group" data-code="${escapeAttr(group.code)}" data-part="${escapeAttr(group.part || "")}">
        <div class="dup-group-header">
          <h3 class="copy-code" data-code="${escapeAttr(group.code)}" title="点击复制番号">${escapeHtml(group.code)}${group.part ? ` · ${escapeHtml(group.part)}` : ""}</h3>
          <small>${group.count} 个文件</small>
        </div>
        ${(group.files || [])
          .map((file) => {
            const sizeText = formatBytes(file.size);
            return `
            <div class="dup-file" data-path="${escapeAttr(file.path)}">
              <div class="dup-file-name">
                <strong>${escapeHtml(file.name)}</strong>
                <button class="danger-btn dup-delete-btn" type="button" data-path="${escapeAttr(file.path)}" data-name="${escapeAttr(file.name)}">删除</button>
              </div>
              <div class="dup-file-path">${escapeHtml(file.path)}${sizeText ? ` · ${sizeText}` : ""}</div>
            </div>`;
          })
          .join("")}
      </section>`
    )
    .join("");
}

function setDupScanRunning(running) {
  if (dupScanBtn) dupScanBtn.disabled = running;
  if (dupAddFolderBtn) dupAddFolderBtn.disabled = running;
  if (dupClearFoldersBtn) dupClearFoldersBtn.disabled = running;
  if (dupPageSizeSelect) dupPageSizeSelect.disabled = running;
  dupCancelBtn?.classList.toggle("hidden", !running);
}

function hideDupProgress() {
  dupProgressEl?.classList.add("hidden");
  dupProgressFill?.classList.remove("is-indeterminate");
  if (dupProgressFill) dupProgressFill.style.width = "0%";
}

function showDupProgress(event) {
  if (!dupProgressEl) return;
  dupProgressEl.classList.remove("hidden");
  const folderTotal = Number(event.folder_total) || 0;
  const folderIndex = Number(event.folder_index) || 0;
  const percent = Number(event.percent);
  if (Number.isFinite(percent) && folderTotal > 1) {
    dupProgressFill?.classList.remove("is-indeterminate");
    if (dupProgressFill) dupProgressFill.style.width = `${Math.max(4, Math.min(100, percent))}%`;
  } else {
    dupProgressFill?.classList.add("is-indeterminate");
    if (dupProgressFill) dupProgressFill.style.width = "";
  }
  const folderLabel = folderTotal ? `文件夹 ${Math.min(folderIndex + 1, folderTotal)}/${folderTotal}` : "扫描中";
  const phaseLabel = event.phase === "summarizing" ? "正在汇总重复项" : "正在扫描";
  if (dupProgressText) {
    dupProgressText.textContent =
      `${phaseLabel} · ${folderLabel} · 已扫描 ${event.scanned || 0} 项 · 视频 ${event.videos || 0} 个 · 目录 ${event.dirs || 0} 个 · 已发现 ${event.duplicate_codes || 0} 组相同番号`;
  }
  if (dupProgressPath) {
    dupProgressPath.textContent = event.current_dir ? `当前：${event.current_dir}` : "";
  }
}

async function scanDuplicates() {
  if (!isLoggedIn()) {
    setDupStatus("筛选相同文件需要先登录", true);
    openAuthModal();
    return;
  }
  if (!dupFolderPicker.folders.length) {
    setDupStatus("请先选择至少一个文件夹", true);
    return;
  }

  dupAbort?.abort();
  dupAbort = new AbortController();
  setDupScanRunning(true);
  setDupStatus("正在连接扫描任务...", false, true);
  showDupProgress({
    phase: "starting",
    scanned: 0,
    videos: 0,
    dirs: 0,
    folder_index: 0,
    folder_total: dupFolderPicker.folders.length,
    current_dir: dupFolderPicker.folders[0]?.path || "",
    duplicate_codes: 0,
    percent: 0,
  });
  dupPage = 1;
  dupResultsEl.innerHTML = "";
  renderDupPager(0);
  try {
    const res = await authFetch("/api/duplicates/scan/stream", {
      method: "POST",
      body: JSON.stringify({ folders: dupFolderPicker.folders.map((item) => item.path) }),
      signal: dupAbort.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDupStatus(data.detail || "筛选失败", true);
      hideDupProgress();
      return;
    }

    let finalResult = null;
    let endedType = "";
    await readSseJson(res, (event) => {
      endedType = event.type;
      if (event.type === "progress") {
        showDupProgress(event);
        setDupStatus("扫描进行中，请稍候...", false, true);
        return;
      }
      if (event.type === "done") {
        finalResult = event.result;
        return;
      }
      if (event.type === "error") {
        throw new Error(event.message || "筛选失败");
      }
    });

    if (endedType === "cancelled") {
      setDupStatus("已取消扫描");
      hideDupProgress();
      return;
    }
    if (!finalResult) {
      setDupStatus("扫描中断，未返回结果", true);
      hideDupProgress();
      return;
    }
    const extra = finalResult.truncated ? "（扫描数量达到上限，结果可能不完整）" : "";
    hideDupProgress();
    setDupStatus(
      `扫描 ${finalResult.scanned} 项，视频 ${finalResult.videos} 个，发现 ${finalResult.duplicate_codes} 组相同番号、共 ${finalResult.duplicate_files} 个文件${extra}`
    );
    renderDupResults(finalResult);
  } catch (err) {
    if (err.name === "AbortError") {
      setDupStatus("已取消扫描");
    } else {
      setDupStatus(err.message || "筛选失败", true);
    }
    hideDupProgress();
  } finally {
    setDupScanRunning(false);
    dupAbort = null;
  }
}

function removeDupFileFromView(path) {
  if (!dupScanData) return;
  dupScanData.groups = (dupScanData.groups || [])
    .map((group) => {
      const files = (group.files || []).filter((file) => file.path !== path);
      return { ...group, files, count: files.length };
    })
    .filter((group) => group.count >= 2);
  dupScanData.duplicate_codes = dupScanData.groups.length;
  dupScanData.duplicate_files = dupScanData.groups.reduce((sum, group) => sum + group.count, 0);
  if (!dupScanData.groups.length) {
    dupResultsEl.innerHTML = '<p class="folder-empty">剩余文件已不足一组相同番号</p>';
    setDupStatus("已删除，当前没有剩余的相同番号文件");
    return;
  }
  renderDupResults(dupScanData);
  setDupStatus(
    `已删除。剩余 ${dupScanData.duplicate_codes} 组相同番号、共 ${dupScanData.duplicate_files} 个文件`
  );
}

async function deleteDupFile(button, path, name) {
  if (!isLoggedIn()) {
    openAuthModal();
    return;
  }
  const ok = window.confirm(`确定删除这个视频文件？\n${name}\n${path}`);
  if (!ok) return;

  if (button) button.disabled = true;
  try {
    const res = await authFetch("/api/duplicates/delete", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDupStatus(data.detail || "删除失败", true);
      if (button) button.disabled = false;
      return;
    }
    removeDupFileFromView(path);
  } catch (err) {
    setDupStatus(err.message || "删除失败", true);
    if (button) button.disabled = false;
  }
}

dupClearFoldersBtn?.addEventListener("click", () => {
  dupFolderPicker.clear();
  setDupStatus("");
});
dupScanBtn?.addEventListener("click", scanDuplicates);
dupCancelBtn?.addEventListener("click", () => {
  dupAbort?.abort();
});
dupPageSizeSelect?.addEventListener("change", () => {
  dupPageSize = currentDupPageSize();
  dupPage = 1;
  if (dupScanData) renderDupResults(dupScanData);
});
dupPagerEl?.addEventListener("click", (event) => {
  const groups = dupScanData?.groups || [];
  const totalPages = Math.max(1, Math.ceil(groups.length / currentDupPageSize()));
  if (event.target.id === "dupPrevPageBtn" && dupPage > 1) {
    dupPage -= 1;
    renderDupResults(dupScanData);
    return;
  }
  if (event.target.id === "dupNextPageBtn" && dupPage < totalPages) {
    dupPage += 1;
    renderDupResults(dupScanData);
  }
});

dupResultsEl?.addEventListener("click", (event) => {
  const deleteBtn = event.target.closest(".dup-delete-btn");
  if (!deleteBtn) return;
  deleteDupFile(deleteBtn, deleteBtn.dataset.path || "", deleteBtn.dataset.name || "");
});

