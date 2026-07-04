const loginHint = document.getElementById("settingsLoginHint");
const settingsForm = document.getElementById("settingsForm");
const settingsStatus = document.getElementById("settingsStatus");
const cd2AuthMode = document.getElementById("cd2AuthMode");
const cd2PasswordFields = document.getElementById("cd2PasswordFields");
const cd2TokenFields = document.getElementById("cd2TokenFields");
const testCd2Btn = document.getElementById("testCd2Btn");
const cd2TestStatus = document.getElementById("cd2TestStatus");
const pushFolderList = document.getElementById("pushFolderList");
const addPushFolderBtn = document.getElementById("addPushFolderBtn");
const folderModal = document.getElementById("folderModal");
const folderList = document.getElementById("folderList");
const folderCurrentPath = document.getElementById("folderCurrentPath");
const folderUpBtn = document.getElementById("folderUpBtn");
const folderModalStatus = document.getElementById("folderModalStatus");
const closeFolderModalBtn = document.getElementById("closeFolderModalBtn");

let currentBrowsePath = "/";
let lastParentPath = null;
let pushFolders = [];
let browseTargetRowId = null;

function setSettingsStatus(message, isError = false) {
  settingsStatus.textContent = message;
  settingsStatus.classList.remove("hidden");
  settingsStatus.classList.toggle("errors", isError);
}

function setCd2TestStatus(message, isError = false) {
  cd2TestStatus.textContent = message;
  cd2TestStatus.classList.toggle("errors", isError);
}

function setFolderModalStatus(message, isError = false) {
  folderModalStatus.textContent = message;
  folderModalStatus.classList.toggle("errors", isError);
}

function toggleCd2AuthFields() {
  const useToken = cd2AuthMode.value === "token";
  cd2PasswordFields.classList.toggle("hidden", useToken);
  cd2TokenFields.classList.toggle("hidden", !useToken);
}

function normalizeCd2Host(host) {
  let value = (host || "").trim();
  if (value.startsWith("https://")) value = value.slice(8);
  else if (value.startsWith("http://")) value = value.slice(7);
  return value.replace(/\/+$/, "");
}

function createFolderRow(folder = {}) {
  const id = folder.id || `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: folder.name || "",
    path: folder.path || "",
  };
}

function renderPushFolderList() {
  if (!pushFolders.length) {
    pushFolderList.innerHTML = '<p class="folder-empty">暂无推送目录，点击「添加目录」开始配置</p>';
    return;
  }

  pushFolderList.innerHTML = pushFolders
    .map(
      (folder) => `
      <div class="push-folder-item" data-row-id="${escapeAttr(folder.id)}">
        <label>
          名称
          <input class="push-folder-name" data-row-id="${escapeAttr(folder.id)}" value="${escapeAttr(folder.name)}" placeholder="例如：电影" />
        </label>
        <label>
          路径
          <div class="folder-picker-input">
            <input class="push-folder-path" data-row-id="${escapeAttr(folder.id)}" value="${escapeAttr(folder.path)}" placeholder="/115open/电影" />
            <button class="ghost-btn browse-folder-btn" data-row-id="${escapeAttr(folder.id)}" type="button">浏览</button>
          </div>
        </label>
        <button class="ghost-btn remove-folder-btn" data-row-id="${escapeAttr(folder.id)}" type="button">删除</button>
      </div>`
    )
    .join("");
}

function collectPushFolders() {
  const items = pushFolderList.querySelectorAll(".push-folder-item");
  if (items.length) {
    return Array.from(items).map((item, index) => ({
      id: item.dataset.rowId || `folder-${index + 1}`,
      name: item.querySelector(".push-folder-name")?.value.trim() || "",
      path: item.querySelector(".push-folder-path")?.value.trim() || "",
    }));
  }

  return pushFolders.map((folder) => ({
    id: folder.id,
    name: folder.name || "",
    path: folder.path || "",
  }));
}

function buildSettingsPayload() {
  pushFolders = collectPushFolders();
  const payload = {
    push_backend: document.getElementById("pushBackend").value,
    proxy_enabled: document.getElementById("proxyEnabled").checked,
    http_proxy: document.getElementById("httpProxy").value.trim(),
    https_proxy: document.getElementById("httpsProxy").value.trim(),
    cd2_host: normalizeCd2Host(document.getElementById("cd2Host").value),
    cd2_auth_mode: cd2AuthMode.value,
    cd2_username: document.getElementById("cd2Username").value,
    cd2_push_folders: pushFolders,
    translate_engine: document.getElementById("translateEngine").value,
    translate_target_lang: document.getElementById("translateTargetLang").value,
    ai_translate_base_url: document.getElementById("aiBaseUrl").value,
    ai_translate_model: document.getElementById("aiModel").value,
    results_page_size: Number(document.getElementById("resultsPageSize").value) || 10,
  };

  const password = document.getElementById("cd2Password").value;
  const token = document.getElementById("cd2Token").value;
  const apiKey = document.getElementById("aiApiKey").value;
  const cookie = document.getElementById("p115Cookie").value;

  if (password) payload.cd2_password = password;
  if (token) payload.cd2_token = token;
  if (apiKey) payload.ai_translate_api_key = apiKey;
  if (cookie) payload.p115_cookie = cookie;

  return payload;
}

function fillForm(settings) {
  document.getElementById("proxyEnabled").checked = Boolean(settings.proxy_enabled);
  document.getElementById("httpProxy").value = settings.http_proxy || "";
  document.getElementById("httpsProxy").value = settings.https_proxy || "";
  document.getElementById("pushBackend").value = settings.push_backend || "cd2";
  document.getElementById("cd2Host").value = settings.cd2_host || "";
  cd2AuthMode.value = settings.cd2_auth_mode || "password";
  document.getElementById("cd2Username").value = settings.cd2_username || "";
  document.getElementById("cd2Password").value = settings.cd2_password === "***" ? "" : settings.cd2_password || "";
  document.getElementById("cd2Token").value = settings.cd2_token === "***" ? "" : settings.cd2_token || "";
  pushFolders = (settings.cd2_push_folders || []).map((folder) => createFolderRow(folder));
  if (!pushFolders.length && settings.cd2_offline_folder) {
    pushFolders = [createFolderRow({ id: "default", name: "默认", path: settings.cd2_offline_folder })];
  }
  renderPushFolderList();
  document.getElementById("p115Cookie").value = settings.p115_cookie === "***" ? "" : settings.p115_cookie || "";
  document.getElementById("translateEngine").value = settings.translate_engine || "free";
  document.getElementById("translateTargetLang").value = settings.translate_target_lang || "zh-CN";
  document.getElementById("aiBaseUrl").value = settings.ai_translate_base_url || "";
  document.getElementById("aiApiKey").value = settings.ai_translate_api_key === "***" ? "" : settings.ai_translate_api_key || "";
  document.getElementById("aiModel").value = settings.ai_translate_model || "gpt-4o-mini";
  const pageSize = Number(settings.results_page_size) || 10;
  document.getElementById("resultsPageSize").value = String(pageSize);
  toggleCd2AuthFields();
}

async function loadSettings() {
  if (!isLoggedIn()) {
    loginHint.classList.remove("hidden");
    settingsForm.classList.add("hidden");
    return;
  }

  loginHint.classList.add("hidden");
  settingsForm.classList.remove("hidden");

  const res = await authFetch("/api/settings");
  if (!res.ok) {
    setSettingsStatus("加载配置失败，请重新登录", true);
    return;
  }
  const data = await res.json();
  fillForm(data.settings || {});
}

async function testCd2Connection() {
  setCd2TestStatus("正在测试连接...");
  const res = await authFetch("/api/cd2/test", {
    method: "POST",
    body: JSON.stringify(buildSettingsPayload()),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setCd2TestStatus(data.detail || "连接失败", true);
    return;
  }
  if (!data.connected) {
    setCd2TestStatus(data.message || "连接失败", true);
    return;
  }
  const folders = data.push_folders || [];
  const validCount = folders.filter((item) => item.valid).length;
  const folderHint = folders.length
    ? `，${validCount}/${folders.length} 个目录可用`
    : "，请添加推送目录";
  const versionHint = data.version ? ` (v${data.version})` : "";
  setCd2TestStatus(`连接成功${versionHint}${folderHint}`, validCount === 0 && folders.length > 0);
}

function renderFolderList(data) {
  currentBrowsePath = data.current_path || "/";
  lastParentPath = data.parent_path ?? null;
  folderCurrentPath.textContent = currentBrowsePath;
  folderUpBtn.disabled = !lastParentPath;

  if (!data.folders?.length) {
    folderList.innerHTML = '<p class="folder-empty">当前目录没有子文件夹</p>';
    return;
  }

  folderList.innerHTML = data.folders
    .map((folder) => {
      const offlineTag = folder.can_offline
        ? '<span class="folder-tag offline">可离线</span>'
        : '<span class="folder-tag">普通</span>';
      return `
        <div class="folder-item" data-path="${escapeAttr(folder.path)}" data-offline="${folder.can_offline ? "1" : "0"}">
          <div class="folder-item-main">
            <strong>${escapeHtml(folder.name)}</strong>
            ${offlineTag}
          </div>
          <div class="folder-item-path">${escapeHtml(folder.path)}</div>
          <div class="folder-item-actions">
            <button class="ghost-btn folder-open-btn" type="button" data-path="${escapeAttr(folder.path)}">进入</button>
            ${folder.can_offline ? `<button class="ghost-btn folder-select-btn" type="button" data-path="${escapeAttr(folder.path)}" data-name="${escapeAttr(folder.name)}">选为推送目录</button>` : ""}
          </div>
        </div>`;
    })
    .join("");
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(text) {
  return escapeHtml(text).replaceAll("'", "&#39;");
}

async function loadFolderList(path = "/") {
  setFolderModalStatus("正在加载目录...");
  const res = await authFetch("/api/cd2/folders", {
    method: "POST",
    body: JSON.stringify({ ...buildSettingsPayload(), path }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setFolderModalStatus(data.detail || "加载目录失败", true);
    folderList.innerHTML = "";
    return;
  }
  renderFolderList(data);
  setFolderModalStatus("");
}

function openFolderModal(rowId) {
  browseTargetRowId = rowId;
  folderModal.classList.remove("hidden");
  const pathInput = pushFolderList.querySelector(`.push-folder-path[data-row-id="${rowId}"]`);
  currentBrowsePath = pathInput?.value.trim() || "/";
  loadFolderList(currentBrowsePath);
}

function closeFolderModal() {
  folderModal.classList.add("hidden");
  browseTargetRowId = null;
  setFolderModalStatus("");
}

cd2AuthMode.addEventListener("change", toggleCd2AuthFields);

testCd2Btn.addEventListener("click", () => {
  testCd2Connection();
});

addPushFolderBtn.addEventListener("click", () => {
  pushFolders = [...collectPushFolders(), createFolderRow({ name: `目录${pushFolders.length + 1}` })];
  renderPushFolderList();
});

pushFolderList.addEventListener("click", (event) => {
  const browseBtn = event.target.closest(".browse-folder-btn");
  if (browseBtn) {
    openFolderModal(browseBtn.dataset.rowId);
    return;
  }

  const removeBtn = event.target.closest(".remove-folder-btn");
  if (removeBtn) {
    pushFolders = collectPushFolders().filter((folder) => folder.id !== removeBtn.dataset.rowId);
    renderPushFolderList();
  }
});

closeFolderModalBtn.addEventListener("click", closeFolderModal);

folderModal.addEventListener("click", (event) => {
  if (event.target === folderModal) {
    closeFolderModal();
  }
});

folderUpBtn.addEventListener("click", () => {
  if (lastParentPath) {
    loadFolderList(lastParentPath);
  }
});

folderList.addEventListener("click", (event) => {
  const openBtn = event.target.closest(".folder-open-btn");
  if (openBtn) {
    loadFolderList(openBtn.dataset.path);
    return;
  }

  const selectBtn = event.target.closest(".folder-select-btn");
  if (selectBtn && browseTargetRowId) {
    const pathInput = pushFolderList.querySelector(`.push-folder-path[data-row-id="${browseTargetRowId}"]`);
    const nameInput = pushFolderList.querySelector(`.push-folder-name[data-row-id="${browseTargetRowId}"]`);
    if (pathInput) pathInput.value = selectBtn.dataset.path;
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = selectBtn.dataset.name || selectBtn.dataset.path.split("/").pop() || "";
    }
    pushFolders = collectPushFolders();
    renderPushFolderList();
    setSettingsStatus(`已选择推送目录: ${selectBtn.dataset.path}`);
    closeFolderModal();
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  pushFolders = collectPushFolders();

  const incomplete = pushFolders.filter((folder) => (folder.name || folder.path) && !folder.path);
  if (incomplete.length) {
    setSettingsStatus("请为每个目录填写路径，或点击「浏览」选择", true);
    renderPushFolderList();
    return;
  }

  const payload = buildSettingsPayload();
  payload.cd2_push_folders = pushFolders.filter((folder) => folder.path);

  if (!payload.cd2_push_folders.length && pushFolders.length) {
    setSettingsStatus("至少需要一个有效路径的推送目录", true);
    return;
  }

  const res = await authFetch("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setSettingsStatus(data.detail || "保存失败", true);
    return;
  }
  fillForm(data.settings || {});
  setSettingsStatus(`配置已保存${payload.cd2_push_folders.length ? `，${payload.cd2_push_folders.length} 个推送目录` : ""}`);
});

loadSettings();
initNav({ onLogout: () => loadSettings() });
