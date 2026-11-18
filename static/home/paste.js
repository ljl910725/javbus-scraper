// 推送页签：粘贴链接、逐条解析、全部整条推送

const p115MagnetInput = document.getElementById("p115MagnetInput");
const p115ParseBtn = document.getElementById("p115ParseBtn");
const p115PushAllBtn = document.getElementById("p115PushAllBtn");
const p115PasteStatus = document.getElementById("p115PasteStatus");
const p115PasteList = document.getElementById("p115PasteList");
const MAGNET_LINK_RE = /magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^\s"'<>]*/gi;
const ED2K_LINK_RE = /ed2k:\/\/\|file\|[^|\r\n]+\|\d+\|[0-9A-Fa-f]{32}\|[^\s"'<>]*/gi;
const OFFLINE_LINK_RE = new RegExp(`${MAGNET_LINK_RE.source}|${ED2K_LINK_RE.source}`, "gi");

function setP115PasteStatus(message, isError = false, loading = false) {
  if (!p115PasteStatus) return;
  p115PasteStatus.textContent = message || "";
  p115PasteStatus.classList.toggle("hidden", !message);
  p115PasteStatus.classList.toggle("errors", Boolean(isError));
  p115PasteStatus.classList.toggle("loading", Boolean(loading));
}

function p115TabUsesCd2() {
  return preferredPushBackend() === "cd2";
}

function p115TabReady() {
  return canPushTo(preferredPushBackend());
}

async function ensureLoggedInForParse() {
  if (isLoggedIn()) return true;
  setP115PasteStatus("解析链接需要先登录", true);
  openAuthModal();
  return false;
}

function p115TabUnreadyMessage() {
  if (pushBackend === "cd2") {
    return "CD2 未就绪，请先在配置页填写 API 令牌，并添加可用的推送目录";
  }
  if (pushBackend === "p115") {
    return "115 未就绪，请先在配置页填写 Cookie，并选择离线保存目录";
  }
  return "推送未就绪，请先在配置页填写 CD2 API 令牌或 115 Cookie";
}

function currentOfflineLabel() {
  return p115TabUsesCd2() ? "CD2" : "115";
}

function currentOfflineFolderHint() {
  if (p115TabUsesCd2()) {
    if (pushFolders.length === 1) return pushFolders[0].path || pushFolders[0].name || "";
    if (pushFolders.length > 1) return `${pushFolders.length} 个目录，推送时选择`;
    return "";
  }
  return p115FolderPath || "";
}

async function ensureP115TabReady() {
  if (!isLoggedIn()) {
    setP115PasteStatus("推送需要先登录", true);
    openAuthModal();
    return false;
  }
  await refreshPushReady();
  if (p115TabReady()) return true;
  setP115PasteStatus(p115TabUnreadyMessage(), true);
  return false;
}

function extractMagnetLinks(text) {
  const source = String(text || "");
  const seen = new Set();
  const links = [];
  const matcher = new RegExp(OFFLINE_LINK_RE.source, "gi");
  let match = matcher.exec(source);
  while (match) {
    const link = match[0].replace(/[.,;]+$/, "");
    const key = link.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      links.push(link);
    }
    match = matcher.exec(source);
  }
  if (!links.length) {
    const raw = source.trim().replace(/[.,;]+$/, "");
    if (/^magnet:\?xt=urn:btih:/i.test(raw) || /^ed2k:\/\/\|file\|/i.test(raw)) {
      links.push(raw);
    }
  }
  return links;
}

function renderP115PasteList(links, outcomes = null) {
  if (!p115PasteList) return;
  if (!links.length) {
    p115PasteList.innerHTML = "";
    return;
  }
  const hasOutcomes = Array.isArray(outcomes);
  const rows = hasOutcomes ? alignPushResults(links, outcomes) : links.map((link, index) => ({ link, index }));
  p115PasteList.innerHTML = rows
    .map((row) => {
      const badge = !hasOutcomes
        ? ""
        : row.success
          ? `<span class="p115-paste-badge is-ok">成功</span>`
          : `<span class="p115-paste-badge is-fail">失败</span>`;
      const reason =
        hasOutcomes && !row.success
          ? `<div class="p115-paste-reason">${escapeHtml(row.message || "未知错误")}</div>`
          : "";
      const stateClass = !hasOutcomes ? "" : row.success ? " is-ok" : " is-fail";
      return `
      <div class="dup-file${stateClass}">
        <div class="dup-file-name">
          <strong>第 ${row.index + 1} 条</strong>
          <div class="p115-paste-row-actions">
            ${badge}
            <button class="ghost-btn p115-parse-one-btn" type="button" data-link="${escapeAttr(row.link)}">解析这条</button>
          </div>
        </div>
        <div class="dup-file-path">${escapeHtml(row.link)}</div>
        ${reason}
      </div>`;
    })
    .join("");
}

function currentP115MagnetLinks() {
  return extractMagnetLinks(p115MagnetInput?.value || "");
}

async function parsePastedP115Magnet(link) {
  if (!(await ensureLoggedInForParse())) return;
  const magnet = (link || "").trim();
  if (!magnet) {
    setP115PasteStatus("请先粘贴 magnet 或 ed2k 链接", true);
    return;
  }
  const target = magnetPushTarget();
  const label = magnetPushLabel(target);
  setP115PasteStatus("正在解析文件列表...", false, true);
  await openP115MagnetModal({ magnet, target });
  const parsed = pendingP115Magnet?.parsed;
  if (parsed?.parsed) {
    const count = parsed.files?.length || 0;
    const folder = magnetPushFolderText(target);
    setP115PasteStatus(
      target === "cd2"
        ? `已解析 ${count} 个文件，确认后整条推送到 ${label}`
        : `已解析 ${count} 个文件，勾选后推送到 ${label}${folder ? `（${folder}）` : ""}`
    );
    return;
  }
  if (p115MagnetModal?.classList.contains("hidden")) {
    setP115PasteStatus("解析窗口未打开，请再试一次", true);
    return;
  }
  setP115PasteStatus(
    parsed?.message || "未能列出文件，可在弹窗里确认后整条推送，或检查磁力是否有效",
    true
  );
}

async function pushPastedMagnetsWithCurrentBackend(links, button) {
  const label = currentOfflineLabel();
  const folder = currentOfflineFolderHint();
  const ok = await showAppConfirm({
    title: `推送到 ${label}`,
    message: `确定把 ${links.length} 条链接整条推送到 ${label}${folder ? `\n${folder}` : ""}？\n${p115TabUsesCd2() ? "CD2 会下整条任务，不能勾选单文件。" : "不会弹出选文件，整条任务都会下。"}`,
    confirmText: "推送",
  });
  if (!ok) return false;
  if (p115TabUsesCd2()) {
    setP115PasteStatus(`正在推送到 ${label}...`, false, true);
    const success = await pushToOffline({ magnets: links, button, source: "paste" });
    if (!success && !pushFolderModal?.classList.contains("hidden")) {
      setP115PasteStatus("请选择推送目录");
    }
    return success;
  }
  if (button) button.disabled = true;
  const results = [];
  try {
    for (let index = 0; index < links.length; index += 1) {
      setP115PasteStatus(`正在整条推送 ${index + 1}/${links.length}...`, false, true);
      try {
        const res = await authFetch("/api/p115/magnet/push", {
          method: "POST",
          body: JSON.stringify({ magnet: links[index], info_hash: "", wanted: [] }),
        });
        const data = await res.json().catch(() => ({}));
        const row = data.results?.[0];
        if (!res.ok) {
          results.push({
            link: links[index],
            success: false,
            message: apiErrorMessage(data, `第 ${index + 1} 条推送失败`),
            task_name: "",
          });
          continue;
        }
        const ok = row ? row.success !== false : data.success !== false;
        results.push({
          link: links[index],
          success: Boolean(ok),
          message:
            (row && row.message) ||
            data.message ||
            (ok ? "推送成功" : pushFailureMessage(data, `第 ${index + 1} 条推送失败`)),
          task_name: row?.task_name || "",
        });
      } catch (err) {
        results.push({
          link: links[index],
          success: false,
          message: err.message || `第 ${index + 1} 条推送失败`,
          task_name: "",
        });
      }
    }
    return presentPushOutcome(
      { backend: "p115", results, success: results.some((row) => row.success) },
      {
        magnets: links,
        folderHint: p115FolderPath ? ` → ${p115FolderPath}` : "",
        source: "paste",
      }
    );
  } finally {
    if (button) button.disabled = false;
  }
}

p115ParseBtn?.addEventListener("click", async () => {
  const links = currentP115MagnetLinks();
  renderP115PasteList(links);
  if (!links.length) {
    setP115PasteStatus("没有识别到 magnet 或 ed2k 链接", true);
    return;
  }
  if (links.length > 1) {
    setP115PasteStatus(`识别到 ${links.length} 条链接，将先解析第 1 条。也可点下面单独解析，或用「全部整条推送」。`);
  }
  p115ParseBtn.disabled = true;
  try {
    await parsePastedP115Magnet(links[0]);
  } finally {
    p115ParseBtn.disabled = false;
  }
});

p115PushAllBtn?.addEventListener("click", async () => {
  const links = currentP115MagnetLinks();
  renderP115PasteList(links);
  if (!links.length) {
    setP115PasteStatus("没有识别到 magnet 或 ed2k 链接", true);
    return;
  }
  if (!(await ensureP115TabReady())) return;
  await pushPastedMagnetsWithCurrentBackend(links, p115PushAllBtn);
});

p115PasteList?.addEventListener("click", async (event) => {
  const btn = event.target.closest(".p115-parse-one-btn");
  if (!btn) return;
  await parsePastedP115Magnet(btn.dataset.link || "");
});

p115MagnetInput?.addEventListener("input", () => {
  const links = currentP115MagnetLinks();
  renderP115PasteList(links);
  renderP115PasteErrors([]);
  if (links.length) {
    setP115PasteStatus(`已识别 ${links.length} 条链接`);
  }
});
