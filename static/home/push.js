// 登录弹窗、加载配置和推送状态、推送 CD2 / 115 以及逐条失败提示

function openAuthModal() {
  authError.classList.add("hidden");
  authForm.reset();
  authModalTitle.textContent = "登录";
  authSubmitBtn.textContent = "登录";
  bringModalToFront(authModal);
  authModal.classList.remove("hidden");
}

function closeAuthModal() {
  authModal.classList.add("hidden");
}

async function loadConfig() {
  try {
    const [configRes, pushRes] = await Promise.all([
      authFetch("/api/config"),
      authFetch("/api/push/status"),
    ]);
    if (!configRes.ok || !pushRes.ok) {
      // 只有登录过期才提示重新登录，其它错误把状态码写出来，方便判断是哪边出错
      const failed = !configRes.ok ? configRes : pushRes;
      configInfoEl.classList.remove("hidden");
      configInfoEl.textContent =
        failed.status === 401 ? "登录已过期，请重新登录" : `配置加载失败（HTTP ${failed.status}）`;
      return;
    }
    const config = await configRes.json();
    const push = await pushRes.json();
    pushReady = push.ready;
    pushBackend = push.backend || config.push_backend || "";
    pushFolders = (push.push_folders || []).filter((folder) => folder.valid);
    p115Ready = Boolean(push.p115_ready);
    p115FolderCid = push.p115_folder_cid || "";
    p115FolderPath = push.p115_folder_path || "";
    pushLabel = pushBackend === "cd2" ? "推送CD2" : pushBackend === "p115" ? "推送115" : "推送";
    if (PAGE_SIZE_OPTIONS.includes(config.results_page_size)) {
      listPageSize = config.results_page_size;
    }
    if (isLoggedIn()) {
      const settingsRes = await authFetch("/api/settings");
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        subtitleSaveDir = settingsData.settings?.subtitle_save_dir || "";
      }
    }

    configInfoEl.classList.remove("hidden");
    let pushText = "推送: 未配置";
    if (pushBackend === "cd2") {
      const folderText = pushFolders.length
        ? `${pushFolders.length} 个目录`
        : push.connected
          ? "未配置目录"
          : "未连接";
      pushText = push.ready
        ? `CD2: 已连接 (${push.host} → ${folderText})`
        : push.connected
          ? `CD2: 已连接 (${folderText})`
          : "CD2: 已配置但未连接";
    } else if (pushBackend === "p115") {
      pushText = push.ready
        ? `115: 已登录 (${push.user_name || ""}${p115FolderPath ? ` → ${p115FolderPath}` : ""})`
        : "115: 已配置但未登录";
    }
    if (p115Ready && pushBackend !== "p115") {
      pushText += ` | 115: 可推送${p115FolderPath ? ` → ${p115FolderPath}` : ""}`;
    }
    const loginText = isLoggedIn() ? `用户: ${getUser()?.username}` : "未登录";
    configInfoEl.textContent = `${loginText} | 数据源: ${config.base_url} | 代理: ${config.proxy_enabled ? "已启用" : "未启用"} | ${pushText}`;
  } catch {
    configInfoEl.classList.add("hidden");
  }
}

async function refreshPushReady() {
  if (!isLoggedIn()) return;
  try {
    const pushRes = await authFetch("/api/push/status");
    if (!pushRes.ok) return;
    const push = await pushRes.json();
    pushReady = Boolean(push.ready);
    pushBackend = push.backend || pushBackend || "";
    pushFolders = (push.push_folders || []).filter((folder) => folder.valid);
    p115Ready = Boolean(push.p115_ready);
    p115FolderCid = push.p115_folder_cid || "";
    p115FolderPath = push.p115_folder_path || "";
  } catch {
    /* keep previous status */
  }
}

function shortOfflineLink(link) {
  const text = String(link || "").trim();
  const ed2k = text.match(/^ed2k:\/\/\|file\|([^|]+)\|/i);
  if (ed2k) {
    try {
      return decodeURIComponent(ed2k[1]);
    } catch {
      return ed2k[1];
    }
  }
  const hash = text.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
  if (hash) {
    const value = hash[1].toUpperCase();
    return value.length > 16 ? `${value.slice(0, 16)}...` : value;
  }
  return text.length > 72 ? `${text.slice(0, 72)}...` : text;
}

function pushItemLabel(row) {
  const n = Number.isInteger(row?.index) ? `第 ${row.index + 1} 条` : "链接";
  const name = String(row?.task_name || "").trim() || shortOfflineLink(row?.link);
  return name ? `${n}（${name}）` : n;
}

function alignPushResults(links, results) {
  const rows = Array.isArray(results) ? results : [];
  const sourceLinks = Array.isArray(links) && links.length ? links : rows.map((row) => row.link || "");
  if (rows.length === sourceLinks.length) {
    return sourceLinks.map((link, index) => ({
      link,
      index,
      success: Boolean(rows[index]?.success),
      message: rows[index]?.message || (rows[index]?.success ? "推送成功" : "推送失败"),
      task_name: rows[index]?.task_name || "",
    }));
  }
  const used = new Set();
  return sourceLinks.map((link, index) => {
    const key = String(link || "").toLowerCase();
    const found = rows.findIndex(
      (row, i) => !used.has(i) && String(row.link || "").toLowerCase() === key
    );
    if (found >= 0) {
      used.add(found);
      const row = rows[found];
      return {
        link,
        index,
        success: Boolean(row.success),
        message: row.message || (row.success ? "推送成功" : "推送失败"),
        task_name: row.task_name || "",
      };
    }
    return {
      link,
      index,
      success: false,
      message: "没有返回这条的推送结果",
      task_name: "",
    };
  });
}

function renderFailureListHtml(failed) {
  return failed
    .map(
      (row) =>
        `<li><strong>${escapeHtml(pushItemLabel(row))}</strong>：${escapeHtml(row.message || "未知错误")}</li>`
    )
    .join("");
}

function clearPushErrorPanel() {
  if (errorsEl?.dataset.kind === "push") {
    errorsEl.classList.add("hidden");
    errorsEl.innerHTML = "";
    delete errorsEl.dataset.kind;
  }
}

function renderPushErrorPanel(failed) {
  if (!errorsEl) return;
  if (!failed.length) {
    clearPushErrorPanel();
    return;
  }
  errorsEl.dataset.kind = "push";
  errorsEl.classList.remove("hidden");
  errorsEl.innerHTML = `
    <h3>${failed.length === 1 ? "推送失败" : `以下 ${failed.length} 条推送失败`}</h3>
    <ul>${renderFailureListHtml(failed)}</ul>`;
}

function renderP115PasteErrors(failed) {
  const el = document.getElementById("p115PasteErrors");
  if (!el) return;
  if (!failed.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = `
    <h3>${failed.length === 1 ? "推送失败" : `以下 ${failed.length} 条推送失败`}</h3>
    <ul>${renderFailureListHtml(failed)}</ul>`;
}

function presentPushOutcome(data, { magnets = [], folderHint = "", source = "" } = {}) {
  const results = alignPushResults(magnets, data?.results || []);
  const failed = results.filter((row) => !row.success);
  const okCount = results.length - failed.length;
  const backendLabel =
    data?.backend === "cd2" ? "CD2" : data?.backend === "p115" ? "115" : currentOfflineLabel();
  const hint = folderHint || "";

  if (!results.length) {
    const fallback = data?.success === false
      ? pushFailureMessage(data)
      : data?.message || "推送完成";
    if (data?.success === false) {
      setStatus(`${backendLabel}${hint} ${fallback}`);
      showToast(`推送失败：${fallback}`, { type: "error", timeout: 7200 });
      if (source === "paste") setP115PasteStatus(fallback, true);
      return false;
    }
    setStatus(`${backendLabel}${hint} ${fallback}`);
    if (source === "paste") setP115PasteStatus(`${backendLabel}${hint} ${fallback}`);
    return true;
  }

  if (!failed.length) {
    const summary = `${backendLabel}${hint} 已推送 ${okCount} 条`;
    setStatus(summary);
    if (source === "paste") {
      renderP115PasteList(magnets, results);
      renderP115PasteErrors([]);
      setP115PasteStatus(summary);
    } else if (magnets.length > 1) {
      clearPushErrorPanel();
    }
    return true;
  }

  const summary = okCount
    ? `${backendLabel}${hint} 成功 ${okCount} 条，失败 ${failed.length} 条`
    : `${backendLabel}${hint} ${failed.length} 条全部失败`;
  setStatus(summary);
  showToast(summary, { type: "error", timeout: 8000 });
  if (source === "paste") {
    renderP115PasteList(magnets, results);
    renderP115PasteErrors(failed);
    setP115PasteStatus(summary, true);
  } else {
    renderPushErrorPanel(failed);
  }
  if (typeof setNosubLookupStatus === "function" && nosubLookupModal && !nosubLookupModal.classList.contains("hidden")) {
    setNosubLookupStatus(
      `${summary}：${failed.map((row) => `${pushItemLabel(row)} ${row.message || "失败"}`).join("；")}`,
      true
    );
  }
  return false;
}

async function lookupLocalVideos({ codes = [], links = [] } = {}) {
  const res = await authFetch("/api/library/lookup", {
    method: "POST",
    body: JSON.stringify({ codes, links }),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.groups || [];
}

function libraryExistMessage(groups) {
  return groups
    .map((group) => {
      const files = (group.files || [])
        .map((file) => `${file.name}（${formatBytes(file.size) || "0 B"}）\n${file.path}`)
        .join("\n");
      return `${group.code}\n${files}`;
    })
    .join("\n\n");
}

async function decideLibraryPush({ codes = [], links = [] } = {}) {
  const groups = await lookupLocalVideos({ codes, links });
  if (!groups.length) return { action: "keep", groups: [] };
  const action = await showPushExistChoice(libraryExistMessage(groups));
  return { action, groups };
}

async function deletePushedLibraryFiles(groups, { magnets = [], results = [], code = "" } = {}) {
  const failedLinks = new Set(
    (results || [])
      .filter((row) => row && row.success === false)
      .map((row) => String(row.link || "").toLowerCase())
  );
  const anyFailed = (results || []).some((row) => row && row.success === false);
  const files = [];
  groups.forEach((group) => {
    const links = group.links || [];
    if (links.some((link) => failedLinks.has(String(link).toLowerCase()))) return;
    // 按番号推送时，这次只要有一条失败就不删这个番号的原视频
    if (!links.length && code && anyFailed) return;
    files.push(...(group.files || []));
  });
  for (const file of files) {
    await authFetch("/api/duplicates/delete", {
      method: "POST",
      body: JSON.stringify({ path: file.path }),
    });
  }
}

async function pushToOffline({
  magnets = [],
  code = null,
  pushBest = false,
  button = null,
  pushFolderId = null,
  onSuccess = null,
  source = "",
  libraryDecision = null,
}) {
  if (!pushReady) {
    setStatus("推送未就绪，请登录后在配置页设置 CD2 或 115");
    return false;
  }

  if (pushBackend === "cd2") {
    if (!pushFolders.length) {
      setStatus("未配置可用推送目录，请先在设置页添加");
      return false;
    }
    if (!pushFolderId) {
      if (pushFolders.length === 1) {
        pushFolderId = pushFolders[0].id;
      } else {
        openPushFolderModal({ magnets, code, pushBest, button, onSuccess, source });
        return false;
      }
    }
  }

  if (!libraryDecision) {
    libraryDecision = await decideLibraryPush({
      codes: code ? [code] : [],
      links: magnets,
    });
    if (libraryDecision.action === "cancel") {
      return false;
    }
  }

  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "推送中...";
  }
  try {
    const res = await authFetch("/api/push", {
      method: "POST",
      body: JSON.stringify({
        magnets,
        code,
        push_best: pushBest,
        push_folder_id: pushFolderId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiErrorMessage(data, `HTTP ${res.status}`));
    const folder = pushFolders.find((item) => item.id === pushFolderId);
    const folderHint = folder ? ` → ${folder.name}` : "";
    const allOk = presentPushOutcome(data, { magnets, folderHint, source });
    if (libraryDecision.action === "delete") {
      await deletePushedLibraryFiles(libraryDecision.groups, {
        magnets,
        results: data.results || [],
        code: code || "",
      });
    }
    if (allOk) {
      if (button) button.textContent = "已推送";
      if (typeof onSuccess === "function") {
        await onSuccess(data);
      }
    } else if (button) {
      button.textContent = originalText || pushLabel;
    }
    return allOk;
  } catch (err) {
    const message = err.message || "推送失败";
    setStatus(`推送失败: ${message}`);
    showToast(`推送失败：${message}`, { type: "error", timeout: 7200 });
    if (source === "paste" && magnets.length) {
      const failed = magnets.map((link, index) => ({
        link,
        index,
        success: false,
        message,
      }));
      renderP115PasteList(magnets, failed);
      renderP115PasteErrors(failed);
      setP115PasteStatus(message, true);
    } else if (magnets.length > 1) {
      renderPushErrorPanel(
        magnets.map((link, index) => ({
          link,
          index,
          success: false,
          message,
        }))
      );
    }
    if (typeof setNosubLookupStatus === "function" && nosubLookupModal && !nosubLookupModal.classList.contains("hidden")) {
      setNosubLookupStatus(`推送失败：${message}`, true);
    }
    if (button) button.textContent = originalText || pushLabel;
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

function openPushFolderModal(request) {
  pendingPushRequest = request;
  pushFolderChoices.innerHTML = pushFolders
    .map(
      (folder) => `
      <button class="push-folder-choice" type="button" data-folder-id="${escapeHtml(folder.id)}">
        <strong>${escapeHtml(folder.name)}</strong>
        <span>${escapeHtml(folder.path)}</span>
      </button>`
    )
    .join("");
  bringModalToFront(pushFolderModal);
  pushFolderModal.classList.remove("hidden");
}

function closePushFolderModal() {
  pushFolderModal.classList.add("hidden");
  pendingPushRequest = null;
}
