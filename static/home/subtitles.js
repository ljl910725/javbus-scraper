// 外挂字幕：搜索、下载、保存到 NAS 目录

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
  bringModalToFront(subtitleModal);
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
    // 中文文件名放在 filename*=UTF-8''... 里，要先解码
    const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
    const filename = encodedMatch
      ? decodeURIComponent(encodedMatch[1])
      : match
        ? match[1]
        : `${button.dataset.code || "subtitle"}.srt`;
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
      const sizeText = formatBytes(file.size);
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
      const sizeText = formatBytes(file.size);
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
    openAuthModal();
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
  bringModalToFront(subtitleSaveModal);
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
