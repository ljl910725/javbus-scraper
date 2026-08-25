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

let nosubSelectedFolders = [];
let nosubBrowsePath = "";
let nosubBrowseParent = null;
let nosubScanData = null;
let nosubAbort = null;
let pendingNosubItem = null;

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

function renderNosubThumbs(item) {
  const images = item.images || [];
  if (!images.length) {
    return '<div class="nosub-thumb-empty">目录下没有图片</div>';
  }
  const first = images[0];
  const rest = images.slice(1, 3);
  return `
    <div class="nosub-thumbs">
      <img class="nosub-thumb" src="${escapeAttr(nosubImageUrl(first))}" alt="${escapeAttr(item.code || item.name)}" data-gallery-index="0" />
      ${
        rest.length
          ? `<div class="nosub-thumbs-more">${rest
              .map(
                (path, index) =>
                  `<img class="nosub-thumb" src="${escapeAttr(nosubImageUrl(path))}" alt="${escapeAttr(item.code || item.name)}" data-gallery-index="${index + 1}" />`
              )
              .join("")}</div>`
          : ""
      }
    </div>`;
}

function renderNosubItem(item) {
  const codeLabel = item.code || "未识别番号";
  const partLabel = item.part ? ` · ${item.part}` : "";
  const metaParts = [item.date, item.studio, (item.actors || []).join("、")].filter(Boolean);
  const sizeText = typeof formatDupSize === "function" ? formatDupSize(item.size) : "";
  return `
    <article class="nosub-item" data-path="${escapeAttr(item.path)}" data-gallery="${encodeGallery(nosubGallery(item))}">
      ${renderNosubThumbs(item)}
      <div class="nosub-body">
        <h3 class="nosub-code">${escapeHtml(codeLabel)}${escapeHtml(partLabel)}</h3>
        ${item.title ? `<p class="nosub-title">${escapeHtml(item.title)}</p>` : ""}
        ${metaParts.length ? `<p class="nosub-meta">${escapeHtml(metaParts.join(" · "))}</p>` : ""}
        ${item.plot ? `<p class="nosub-plot">${escapeHtml(item.plot)}</p>` : ""}
        <p class="nosub-path"><strong>${escapeHtml(item.name)}</strong></p>
        <p class="nosub-path">${escapeHtml(item.path)}${sizeText ? ` · ${sizeText}` : ""}</p>
        <div class="nosub-actions">
          <button class="nosub-lookup-btn" type="button" data-path="${escapeAttr(item.path)}">查找</button>
        </div>
      </div>
    </article>`;
}

function renderNosubResults(data) {
  nosubScanData = data;
  const items = data?.items || [];
  if (!items.length) {
    nosubResultsEl.innerHTML = '<p class="folder-empty">没有找到无字幕视频</p>';
    return;
  }
  nosubResultsEl.innerHTML = items.map(renderNosubItem).join("");
}

function setNosubScanRunning(running) {
  if (nosubScanBtn) nosubScanBtn.disabled = running;
  if (nosubAddFolderBtn) nosubAddFolderBtn.disabled = running;
  if (nosubClearFoldersBtn) nosubClearFoldersBtn.disabled = running;
  nosubCancelBtn?.classList.toggle("hidden", !running);
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
  if (nosubProgressText) {
    nosubProgressText.textContent =
      `${phaseLabel} · ${folderLabel} · 已扫描 ${event.scanned || 0} 项 · 视频 ${event.videos || 0} 个 · 目录 ${event.dirs || 0} 个 · 无字幕 ${event.found || 0} 个`;
  }
  if (nosubProgressPath) {
    nosubProgressPath.textContent = event.current_dir ? `当前：${event.current_dir}` : "";
  }
}

async function scanMissingSubs() {
  if (!isLoggedIn()) {
    setNosubStatus("排查无字幕文件需要先登录", true);
    openAuthModal("login");
    return;
  }
  if (!nosubSelectedFolders.length) {
    setNosubStatus("请先选择至少一个文件夹", true);
    return;
  }

  nosubAbort?.abort();
  nosubAbort = new AbortController();
  setNosubScanRunning(true);
  setNosubStatus("正在连接排查任务...", false, true);
  showNosubProgress({
    phase: "starting",
    scanned: 0,
    videos: 0,
    dirs: 0,
    folder_index: 0,
    folder_total: nosubSelectedFolders.length,
    current_dir: nosubSelectedFolders[0]?.path || "",
    found: 0,
    percent: 0,
  });
  nosubResultsEl.innerHTML = "";
  try {
    const res = await authFetch("/api/missing-subs/scan/stream", {
      method: "POST",
      body: JSON.stringify({ folders: nosubSelectedFolders.map((item) => item.path) }),
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
    const extra = finalResult.truncated ? "（扫描数量达到上限，结果可能不完整）" : "";
    hideNosubProgress();
    setNosubStatus(
      `扫描 ${finalResult.scanned} 项，视频 ${finalResult.videos} 个，发现 ${finalResult.found} 个无字幕文件${extra}`
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
  return (nosubScanData?.items || []).find((item) => item.path === path) || null;
}

function removeNosubItemFromView(path) {
  if (!nosubScanData) return;
  nosubScanData.items = (nosubScanData.items || []).filter((item) => item.path !== path);
  nosubScanData.found = nosubScanData.items.length;
  if (!nosubScanData.items.length) {
    nosubResultsEl.innerHTML = '<p class="folder-empty">列表中已经没有无字幕文件</p>';
    setNosubStatus("已处理完毕，当前没有剩余的无字幕文件");
    return;
  }
  renderNosubResults(nosubScanData);
  setNosubStatus(`剩余 ${nosubScanData.found} 个无字幕文件`);
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
  pendingNosubItem = null;
  if (nosubLookupResults) nosubLookupResults.innerHTML = "";
  setNosubLookupStatus("");
}

async function lookupNosubItem(item) {
  const code = (item.code || "").trim();
  if (!code) {
    setNosubStatus(`无法从 ${item.name} 识别番号`, true);
    return;
  }
  pendingNosubItem = item;
  nosubLookupTitle.textContent = `查找 ${code}`;
  nosubLookupHint.textContent = `原文件：${item.name}`;
  nosubLookupResults.innerHTML = "";
  setNosubLookupStatus(`正在查询 ${code}...`, false, true);
  nosubLookupModal.classList.remove("hidden");
  try {
    const movie = await loadMovieDetail(code);
    nosubLookupResults.innerHTML = renderMovieCard(movie);
    setNosubLookupStatus(`已加载 ${movie.code}，可复制磁力或推送到 CD2。推送成功后会删除原文件。`);
    loadSubtitlesForCode(movie.code);
  } catch (err) {
    setNosubLookupStatus(err.message || "查询失败", true);
  }
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
  renderNosubSelectedFolders();
  setNosubStatus("");
});
nosubScanBtn?.addEventListener("click", scanMissingSubs);
nosubCancelBtn?.addEventListener("click", () => {
  nosubAbort?.abort();
});
closeNosubFolderModalBtn?.addEventListener("click", closeNosubFolderModal);
closeNosubLookupModalBtn?.addEventListener("click", closeNosubLookupModal);
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
  const thumb = event.target.closest(".nosub-thumb");
  if (thumb) {
    const card = thumb.closest(".nosub-item");
    const gallery = parseGallery(card);
    const index = Number(thumb.dataset.galleryIndex || 0);
    if (gallery.length) openLightbox(gallery, index);
  }
});

nosubLookupResults?.addEventListener("click", async (event) => {
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
    try {
      await navigator.clipboard.writeText(copyBtn.dataset.link);
      const original = copyBtn.textContent;
      copyBtn.textContent = "已复制";
      setTimeout(() => {
        copyBtn.textContent = original;
      }, 1500);
    } catch {
      copyBtn.textContent = "失败";
    }
    return;
  }

  const pushBtn = event.target.closest(".push-btn");
  if (pushBtn) {
    await pushToOffline({
      magnets: [pushBtn.dataset.link],
      button: pushBtn,
      onSuccess: afterNosubPushSuccess(),
    });
    return;
  }

  const pushBestBtn = event.target.closest(".push-best-btn");
  if (pushBestBtn?.dataset.code) {
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

renderNosubSelectedFolders();
