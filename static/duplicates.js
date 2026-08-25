const dupAddFolderBtn = document.getElementById("dupAddFolderBtn");
const dupClearFoldersBtn = document.getElementById("dupClearFoldersBtn");
const dupScanBtn = document.getElementById("dupScanBtn");
const dupSelectedFoldersEl = document.getElementById("dupSelectedFolders");
const dupStatusEl = document.getElementById("dupStatus");
const dupResultsEl = document.getElementById("dupResults");
const dupFolderModal = document.getElementById("dupFolderModal");
const dupFolderList = document.getElementById("dupFolderList");
const dupFolderCurrentPath = document.getElementById("dupFolderCurrentPath");
const dupFolderUpBtn = document.getElementById("dupFolderUpBtn");
const dupFolderAddCurrentBtn = document.getElementById("dupFolderAddCurrentBtn");
const dupFolderModalStatus = document.getElementById("dupFolderModalStatus");
const closeDupFolderModalBtn = document.getElementById("closeDupFolderModalBtn");

let dupSelectedFolders = [];
let dupBrowsePath = "";
let dupBrowseParent = null;
let dupScanData = null;

function setDupStatus(message, isError = false, loading = false) {
  if (!dupStatusEl) return;
  dupStatusEl.textContent = message || "";
  dupStatusEl.classList.toggle("hidden", !message);
  dupStatusEl.classList.toggle("errors", Boolean(isError));
  dupStatusEl.classList.toggle("loading", Boolean(loading));
}

function setDupFolderStatus(message, isError = false) {
  if (!dupFolderModalStatus) return;
  dupFolderModalStatus.textContent = message || "";
  dupFolderModalStatus.classList.toggle("errors", Boolean(isError));
}

function folderAlreadySelected(path) {
  return dupSelectedFolders.some((item) => item.path === path);
}

function renderDupSelectedFolders() {
  if (!dupSelectedFoldersEl) return;
  if (!dupSelectedFolders.length) {
    dupSelectedFoldersEl.innerHTML = '<span class="field-hint">尚未选择文件夹</span>';
    return;
  }
  dupSelectedFoldersEl.innerHTML = dupSelectedFolders
    .map(
      (folder) => `
      <div class="dup-chip" title="${escapeAttr(folder.path)}">
        <span>${escapeHtml(folder.name)}</span>
        <button type="button" data-remove-path="${escapeAttr(folder.path)}" aria-label="移除">×</button>
      </div>`
    )
    .join("");
}

function addDupFolder(path, name) {
  const folderPath = (path || "").trim();
  if (!folderPath) {
    setDupFolderStatus("当前位置不能添加，请进入具体目录", true);
    return;
  }
  if (folderAlreadySelected(folderPath)) {
    setDupFolderStatus("该文件夹已在列表中");
    return;
  }
  dupSelectedFolders.push({
    path: folderPath,
    name: name || folderPath.split("/").filter(Boolean).pop() || folderPath,
  });
  renderDupSelectedFolders();
  setDupFolderStatus(`已添加：${name || folderPath}`);
}

function renderDupFolderList(data) {
  dupBrowsePath = data.current_path || "";
  dupBrowseParent = data.parent_path ?? null;
  dupFolderCurrentPath.textContent = dupBrowsePath || "挂载根目录";
  dupFolderUpBtn.disabled = dupBrowseParent === null;
  dupFolderAddCurrentBtn.disabled = !data.selectable || !dupBrowsePath;

  const folders = data.folders || [];
  if (!folders.length) {
    dupFolderList.innerHTML = '<p class="folder-empty">当前目录没有子文件夹</p>';
    return;
  }

  dupFolderList.innerHTML = folders
    .map(
      (folder) => `
      <div class="folder-item">
        <div class="folder-item-main">
          <strong>📁 ${escapeHtml(folder.name)}</strong>
        </div>
        <div class="folder-item-path">${escapeHtml(folder.path)}</div>
        <div class="folder-item-actions">
          <button class="ghost-btn dup-open-btn" type="button" data-path="${escapeAttr(folder.path)}">进入</button>
          <button class="ghost-btn dup-pick-btn" type="button" data-path="${escapeAttr(folder.path)}" data-name="${escapeAttr(folder.name)}">加入筛选</button>
        </div>
      </div>`
    )
    .join("");
}

async function loadDupFolders(path = "") {
  setDupFolderStatus("正在加载目录...");
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await authFetch(`/api/subtitles/browse${query}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setDupFolderStatus(data.detail || "加载目录失败", true);
    dupFolderList.innerHTML = "";
    return;
  }
  renderDupFolderList(data);
  setDupFolderStatus("");
}

function openDupFolderModal() {
  if (!isLoggedIn()) {
    setDupStatus("筛选相同文件需要先登录", true);
    openAuthModal("login");
    return;
  }
  dupFolderModal.classList.remove("hidden");
  loadDupFolders(dupBrowsePath);
}

function closeDupFolderModal() {
  dupFolderModal.classList.add("hidden");
  setDupFolderStatus("");
}

function formatDupSize(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function renderDupResults(data) {
  dupScanData = data;
  const groups = data?.groups || [];
  if (!groups.length) {
    dupResultsEl.innerHTML = '<p class="folder-empty">没有找到番号相同的视频文件</p>';
    return;
  }

  dupResultsEl.innerHTML = groups
    .map(
      (group) => `
      <section class="dup-group" data-code="${escapeAttr(group.code)}">
        <div class="dup-group-header">
          <h3>${escapeHtml(group.code)}</h3>
          <small>${group.count} 个文件</small>
        </div>
        ${(group.files || [])
          .map((file) => {
            const sizeText = formatDupSize(file.size);
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

async function scanDuplicates() {
  if (!isLoggedIn()) {
    setDupStatus("筛选相同文件需要先登录", true);
    openAuthModal("login");
    return;
  }
  if (!dupSelectedFolders.length) {
    setDupStatus("请先选择至少一个文件夹", true);
    return;
  }

  dupScanBtn.disabled = true;
  setDupStatus("正在扫描视频文件...", false, true);
  dupResultsEl.innerHTML = "";
  try {
    const res = await authFetch("/api/duplicates/scan", {
      method: "POST",
      body: JSON.stringify({ folders: dupSelectedFolders.map((item) => item.path) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDupStatus(data.detail || "筛选失败", true);
      return;
    }
    const extra = data.truncated ? "（扫描数量达到上限，结果可能不完整）" : "";
    setDupStatus(
      `扫描 ${data.scanned} 项，视频 ${data.videos} 个，发现 ${data.duplicate_codes} 组相同番号、共 ${data.duplicate_files} 个文件${extra}`
    );
    renderDupResults(data);
  } catch (err) {
    setDupStatus(err.message || "筛选失败", true);
  } finally {
    dupScanBtn.disabled = false;
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
    openAuthModal("login");
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

dupAddFolderBtn?.addEventListener("click", openDupFolderModal);
dupClearFoldersBtn?.addEventListener("click", () => {
  dupSelectedFolders = [];
  renderDupSelectedFolders();
  setDupStatus("");
});
dupScanBtn?.addEventListener("click", scanDuplicates);
closeDupFolderModalBtn?.addEventListener("click", closeDupFolderModal);
dupFolderUpBtn?.addEventListener("click", () => {
  if (dupBrowseParent === null) return;
  loadDupFolders(dupBrowseParent);
});
dupFolderAddCurrentBtn?.addEventListener("click", () => {
  const name = dupBrowsePath.split("/").filter(Boolean).pop() || dupBrowsePath;
  addDupFolder(dupBrowsePath, name);
});

dupFolderList?.addEventListener("click", (event) => {
  const openBtn = event.target.closest(".dup-open-btn");
  if (openBtn) {
    loadDupFolders(openBtn.dataset.path || "");
    return;
  }
  const pickBtn = event.target.closest(".dup-pick-btn");
  if (pickBtn) {
    addDupFolder(pickBtn.dataset.path || "", pickBtn.dataset.name || "");
  }
});

dupSelectedFoldersEl?.addEventListener("click", (event) => {
  const removeBtn = event.target.closest("[data-remove-path]");
  if (!removeBtn) return;
  const path = removeBtn.dataset.removePath;
  dupSelectedFolders = dupSelectedFolders.filter((item) => item.path !== path);
  renderDupSelectedFolders();
});

dupResultsEl?.addEventListener("click", (event) => {
  const deleteBtn = event.target.closest(".dup-delete-btn");
  if (!deleteBtn) return;
  deleteDupFile(deleteBtn, deleteBtn.dataset.path || "", deleteBtn.dataset.name || "");
});

dupFolderModal?.addEventListener("click", (event) => {
  if (event.target === dupFolderModal) closeDupFolderModal();
});

renderDupSelectedFolders();
