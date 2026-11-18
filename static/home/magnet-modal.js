// 解析链接弹窗：列出磁力或 ed2k 里的文件并勾选推送

const p115MagnetModal = document.getElementById("p115MagnetModal");
const p115MagnetModalTitle = document.getElementById("p115MagnetModalTitle");
const p115MagnetHint = document.getElementById("p115MagnetHint");
const p115MagnetStats = document.getElementById("p115MagnetStats");
const p115MagnetFiles = document.getElementById("p115MagnetFiles");
const p115MagnetStatus = document.getElementById("p115MagnetStatus");
const p115MagnetConfirmBtn = document.getElementById("p115MagnetConfirmBtn");
const closeP115MagnetModalBtn = document.getElementById("closeP115MagnetModalBtn");
const p115MagnetToolbar = document.querySelector("#p115MagnetModal .p115-magnet-toolbar");
// 跟后端 app/subtitles/storage.py 的 VIDEO_EXTENSIONS 保持一致
const P115_VIDEO_EXTS = [
  ".mp4", ".mkv", ".avi", ".wmv", ".mov", ".flv", ".webm", ".m4v", ".ts",
  ".mpg", ".mpeg", ".iso", ".rmvb", ".rm", ".vob", ".m2ts", ".asf",
];

function setP115MagnetStatus(message, isError = false) {
  if (!p115MagnetStatus) return;
  p115MagnetStatus.textContent = message || "";
  p115MagnetStatus.classList.toggle("errors", Boolean(isError));
}

function splitMagnetPath(path) {
  const raw = String(path || "").replace(/\\/g, "/");
  const idx = raw.lastIndexOf("/");
  if (idx < 0) return { dir: "", base: raw || "未命名文件" };
  return {
    dir: raw.slice(0, idx),
    base: raw.slice(idx + 1) || raw,
  };
}

function clearP115MagnetStats() {
  if (!p115MagnetStats) return;
  p115MagnetStats.hidden = true;
  p115MagnetStats.innerHTML = "";
}

function updateP115MagnetStats(data, { previewOnly = false } = {}) {
  if (!p115MagnetStats) return;
  const files = data?.files || [];
  if (!files.length) {
    clearP115MagnetStats();
    return;
  }
  const totalBytes = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  const parts = [
    `<span>${files.length} 个文件</span>`,
    `<span>共 ${escapeHtml(formatBytes(totalBytes) || "0 B")}</span>`,
  ];
  if (!previewOnly) {
    const wanted = new Set(selectedP115Indexes());
    let selectedCount = 0;
    let selectedBytes = 0;
    files.forEach((file) => {
      if (!wanted.has(Number(file.index))) return;
      selectedCount += 1;
      selectedBytes += Number(file.size) || 0;
    });
    parts.push(`<span>已选 ${selectedCount} · ${escapeHtml(formatBytes(selectedBytes) || "0 B")}</span>`);
  }
  p115MagnetStats.innerHTML = parts.join("");
  p115MagnetStats.hidden = false;
}

function refreshP115MagnetStats() {
  const previewOnly = p115MagnetFiles?.classList.contains("is-preview");
  updateP115MagnetStats(pendingP115Magnet?.parsed, { previewOnly });
}

function renderP115MagnetFiles(data, { previewOnly = false } = {}) {
  const files = data?.files || [];
  p115MagnetFiles.classList.toggle("is-preview", previewOnly);
  if (!files.length) {
    p115MagnetFiles.innerHTML = `<p class="folder-empty">${
      data?.parsed ? "种子里没有文件" : "无法列出文件，确认后将整条链接推送"
    }</p>`;
    updateP115MagnetStats(data, { previewOnly });
    return;
  }
  const head = previewOnly
    ? `<div class="p115-file-head" aria-hidden="true"><span>文件</span><span>大小</span></div>`
    : `<div class="p115-file-head" aria-hidden="true"><span></span><span>文件</span><span>大小</span></div>`;
  p115MagnetFiles.innerHTML =
    head +
    files
      .map((file) => {
        const { dir, base } = splitMagnetPath(file.path);
        const dirHtml = dir
          ? `<span class="p115-file-dir" title="${escapeAttr(dir)}">${escapeHtml(dir)}</span>`
          : "";
        const checkbox = previewOnly
          ? ""
          : `<input type="checkbox" data-index="${file.index}" data-path="${escapeAttr(
              file.path || ""
            )}" ${file.wanted ? "checked" : ""} />`;
        return `
      <label class="p115-file-row${previewOnly ? " preview-only" : ""}">
        ${checkbox}
        <span class="p115-file-name" title="${escapeAttr(file.path || "")}">
          ${dirHtml}
          <span class="p115-file-base">${escapeHtml(base)}</span>
        </span>
        <span class="p115-file-size">${escapeHtml(formatBytes(file.size) || "0 B")}</span>
      </label>`;
      })
      .join("");
  updateP115MagnetStats(data, { previewOnly });
}

function selectedP115Indexes() {
  return Array.from(p115MagnetFiles.querySelectorAll("input[type=checkbox]:checked")).map((input) => Number(input.dataset.index));
}

function closeP115MagnetModal() {
  p115MagnetModal?.classList.add("hidden");
  pendingP115Magnet = null;
  clearP115MagnetStats();
  setP115MagnetStatus("");
}

function preferredPushBackend() {
  if (pushBackend === "cd2" || pushBackend === "p115") return pushBackend;
  if (p115Ready) return "p115";
  return "cd2";
}

function magnetPushTarget(explicit) {
  if (explicit === "cd2" || explicit === "p115") return explicit;
  return preferredPushBackend();
}

function canPushTo(target) {
  if (target === "p115") return Boolean(p115Ready);
  if (target === "cd2") return pushBackend === "cd2" && Boolean(pushReady);
  return false;
}

function magnetPushLabel(target) {
  return target === "cd2" ? "CD2" : "115";
}

function magnetPushFolderText(target) {
  if (target === "cd2") {
    const folder = currentOfflineFolderHint();
    return folder ? `保存到 ${folder}` : "未配置 CD2 推送目录";
  }
  return p115FolderPath ? `保存到 ${p115FolderPath}` : "未配置保存目录，将放到 115 默认离线目录";
}

async function openP115MagnetModal({ magnet = "", code = "", button = null, target = "" } = {}) {
  const pushTarget = magnetPushTarget(target);
  const label = magnetPushLabel(pushTarget);
  if (!magnet && code) {
    magnet = await ensureItemMagnet(code);
  }
  if (!magnet) {
    setStatus("没有可推送的磁力链接");
    return;
  }
  pendingP115Magnet = { magnet, code, button, parsed: null, target: pushTarget };
  if (p115MagnetModalTitle) p115MagnetModalTitle.textContent = `解析链接并推送到 ${label}`;
  if (p115MagnetConfirmBtn) p115MagnetConfirmBtn.textContent = `推送到 ${label}`;
  p115MagnetToolbar?.classList.toggle("hidden", pushTarget === "cd2");
  bringModalToFront(p115MagnetModal);
  p115MagnetModal.classList.remove("hidden");
  const folderText = magnetPushFolderText(pushTarget);
  p115MagnetHint.textContent = folderText;
  clearP115MagnetStats();
  p115MagnetFiles.innerHTML = '<p class="folder-empty">正在解析文件列表...</p>';
  p115MagnetFiles.classList.remove("is-preview");
  p115MagnetConfirmBtn.disabled = true;
  setP115MagnetStatus("正在解析链接，请稍候...");
  try {
    const res = await authFetch("/api/p115/magnet/parse", {
      method: "POST",
      body: JSON.stringify({ magnet }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiErrorMessage(data, "解析失败"));
    pendingP115Magnet.parsed = data;
    const previewOnly = pushTarget === "cd2" || data.selectable === false;
    renderP115MagnetFiles(data, { previewOnly });
    p115MagnetToolbar?.classList.toggle("hidden", previewOnly);
    p115MagnetHint.textContent = folderText;
    if (!data.parsed) {
      setP115MagnetStatus(data.message || "未能解析文件列表，确认后将整条链接推送。", true);
    } else if (pushTarget === "cd2") {
      setP115MagnetStatus("CD2 只能整条推送，文件列表供确认。");
    } else if (data.selectable === false) {
      setP115MagnetStatus(data.message || "当前无法勾选文件，确认后将整条推送。");
    } else {
      setP115MagnetStatus(data.message || "默认勾选较大视频，可改选后再推送。");
    }
    p115MagnetConfirmBtn.disabled = false;
  } catch (err) {
    pendingP115Magnet.parsed = { magnet, parsed: false, files: [], info_hash: "" };
    renderP115MagnetFiles(pendingP115Magnet.parsed, { previewOnly: pushTarget === "cd2" });
    setP115MagnetStatus(err.message || "解析失败，仍可整条推送", true);
    p115MagnetConfirmBtn.disabled = false;
  }
}

async function confirmP115MagnetPush() {
  if (!pendingP115Magnet?.magnet) return;
  const parsed = pendingP115Magnet.parsed || {};
  const pushTarget = pendingP115Magnet.target || magnetPushTarget();
  const label = magnetPushLabel(pushTarget);
  const wanted = parsed.selectable === false ? [] : selectedP115Indexes();
  if (pushTarget === "p115" && parsed.parsed && parsed.selectable !== false && parsed.files?.length && !wanted.length) {
    setP115MagnetStatus("请至少选择一个文件", true);
    return;
  }
  await refreshPushReady();
  if (!canPushTo(pushTarget)) {
    const message = p115TabUnreadyMessage();
    setP115MagnetStatus(message, true);
    setP115PasteStatus(message, true);
    return;
  }
  p115MagnetConfirmBtn.disabled = true;
  setP115MagnetStatus(`正在推送到 ${label}...`);
  const button = pendingP115Magnet.button;
  const original = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "推送中...";
  }
  try {
    if (pushTarget === "cd2") {
      const magnet = pendingP115Magnet.magnet;
      const code = pendingP115Magnet.code || "";
      const success = await pushToOffline({ magnets: [magnet], code, button });
      if (success) {
        setP115MagnetStatus("推送完成");
        closeP115MagnetModal();
        setP115PasteStatus(`已推送到 CD2${currentOfflineFolderHint() ? ` → ${currentOfflineFolderHint()}` : ""}`);
        return;
      }
      if (!pushFolderModal?.classList.contains("hidden")) {
        closeP115MagnetModal();
        setP115PasteStatus("请选择推送目录");
        return;
      }
      throw new Error("推送未完成，请检查 CD2 令牌和推送目录");
    }
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
    if (!res.ok) throw new Error(apiErrorMessage(data, "推送失败"));
    if (data.success === false) throw new Error(pushFailureMessage(data, data.message || "推送失败"));
    const folderHint = p115FolderPath ? ` → ${p115FolderPath}` : "";
    setStatus(`115${folderHint} ${data.message || "推送完成"}`);
    setP115MagnetStatus(data.message || "推送完成");
    if (button) button.textContent = "已推送";
    closeP115MagnetModal();
  } catch (err) {
    const message = err.message || "推送失败";
    setP115MagnetStatus(message, true);
    setStatus(`${label} 推送失败: ${message}`);
    showToast(`${label} 推送失败：${message}`, { type: "error", timeout: 7200 });
    if (button) button.textContent = original || `推送${label}`;
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
p115MagnetFiles?.addEventListener("change", refreshP115MagnetStats);
document.getElementById("p115SelectAllBtn")?.addEventListener("click", () => {
  p115MagnetFiles.querySelectorAll("input[type=checkbox]").forEach((input) => {
    input.checked = true;
  });
  refreshP115MagnetStats();
});
document.getElementById("p115SelectNoneBtn")?.addEventListener("click", () => {
  p115MagnetFiles.querySelectorAll("input[type=checkbox]").forEach((input) => {
    input.checked = false;
  });
  refreshP115MagnetStats();
});
document.getElementById("p115SelectVideosBtn")?.addEventListener("click", () => {
  p115MagnetFiles.querySelectorAll(".p115-file-row").forEach((row) => {
    const input = row.querySelector("input[type=checkbox]");
    if (!input) return;
    const path = (input.dataset.path || "").toLowerCase();
    input.checked = P115_VIDEO_EXTS.some((ext) => path.endsWith(ext));
  });
  refreshP115MagnetStats();
});
