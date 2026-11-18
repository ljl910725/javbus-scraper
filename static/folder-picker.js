// 「筛选相同文件」「排查无字幕」「清理垃圾」三个页签共用的选择文件夹功能。
// 页面里的元素 id 按同一个前缀命名，例如 dupFolderModal、dupFolderList、closeDupFolderModalBtn。
function createFolderPicker({ prefix, pickText, loginMessage, setPageStatus, onChange = null }) {
  const capitalized = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  const byId = (suffix) => document.getElementById(`${prefix}${suffix}`);
  const addBtn = byId("AddFolderBtn");
  const selectedEl = byId("SelectedFolders");
  const modal = byId("FolderModal");
  const listEl = byId("FolderList");
  const currentPathEl = byId("FolderCurrentPath");
  const upBtn = byId("FolderUpBtn");
  const addCurrentBtn = byId("FolderAddCurrentBtn");
  const statusEl = byId("FolderModalStatus");
  const closeBtn = document.getElementById(`close${capitalized}FolderModalBtn`);

  let selected = [];
  let browsePath = "";
  let browseParent = null;

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("errors", Boolean(isError));
  }

  function renderSelected() {
    if (!selectedEl) return;
    if (!selected.length) {
      selectedEl.innerHTML = '<span class="field-hint">尚未选择文件夹</span>';
      return;
    }
    selectedEl.innerHTML = selected
      .map(
        (folder) => `
      <div class="dup-chip" title="${escapeAttr(folder.path)}">
        <span>${escapeHtml(folder.name)}</span>
        <button type="button" data-remove-path="${escapeAttr(folder.path)}" aria-label="移除">×</button>
      </div>`
      )
      .join("");
  }

  function add(path, name) {
    const folderPath = (path || "").trim();
    if (!folderPath) {
      setStatus("当前位置不能添加，请进入具体目录", true);
      return;
    }
    if (selected.some((item) => item.path === folderPath)) {
      setStatus("该文件夹已在列表中");
      return;
    }
    selected.push({
      path: folderPath,
      name: name || folderPath.split("/").filter(Boolean).pop() || folderPath,
    });
    renderSelected();
    // 选中的文件夹变了，页面自己决定要不要作废旧的扫描结果
    onChange?.();
    setStatus(`已添加：${name || folderPath}`);
  }

  function remove(path) {
    selected = selected.filter((item) => item.path !== path);
    renderSelected();
    onChange?.();
  }

  function renderFolderList(data) {
    browsePath = data.current_path || "";
    browseParent = data.parent_path ?? null;
    currentPathEl.textContent = browsePath || "挂载根目录";
    upBtn.disabled = browseParent === null;
    addCurrentBtn.disabled = !data.selectable || !browsePath;

    const folders = data.folders || [];
    if (!folders.length) {
      listEl.innerHTML = '<p class="folder-empty">当前目录没有子文件夹</p>';
      return;
    }
    listEl.innerHTML = folders
      .map(
        (folder) => `
      <div class="folder-item">
        <div class="folder-item-main">
          <strong>📁 ${escapeHtml(folder.name)}</strong>
        </div>
        <div class="folder-item-path">${escapeHtml(folder.path)}</div>
        <div class="folder-item-actions">
          <button class="ghost-btn folder-open-btn" type="button" data-path="${escapeAttr(folder.path)}">进入</button>
          <button class="ghost-btn folder-pick-btn" type="button" data-path="${escapeAttr(folder.path)}" data-name="${escapeAttr(folder.name)}">${escapeHtml(pickText)}</button>
        </div>
      </div>`
      )
      .join("");
  }

  async function loadFolders(path = "") {
    setStatus("正在加载目录...");
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const res = await authFetch(`/api/subtitles/browse${query}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.detail || "加载目录失败", true);
      listEl.innerHTML = "";
      return;
    }
    renderFolderList(data);
    setStatus("");
  }

  function open() {
    if (!isLoggedIn()) {
      setPageStatus(loginMessage, true);
      openAuthModal();
      return;
    }
    bringModalToFront(modal);
    modal.classList.remove("hidden");
    // 再次打开时回到上次浏览的目录
    loadFolders(browsePath);
  }

  function close() {
    modal.classList.add("hidden");
    setStatus("");
  }

  addBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  modal?.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  upBtn?.addEventListener("click", () => {
    if (browseParent === null) return;
    loadFolders(browseParent);
  });
  addCurrentBtn?.addEventListener("click", () => {
    const name = browsePath.split("/").filter(Boolean).pop() || browsePath;
    add(browsePath, name);
  });
  listEl?.addEventListener("click", (event) => {
    const openBtn = event.target.closest(".folder-open-btn");
    if (openBtn) {
      loadFolders(openBtn.dataset.path || "");
      return;
    }
    const pickBtn = event.target.closest(".folder-pick-btn");
    if (pickBtn) {
      add(pickBtn.dataset.path || "", pickBtn.dataset.name || "");
    }
  });
  selectedEl?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest("[data-remove-path]");
    if (!removeBtn) return;
    remove(removeBtn.dataset.removePath);
  });

  renderSelected();

  return {
    get folders() {
      return selected;
    },
    clear() {
      selected = [];
      renderSelected();
    },
  };
}
