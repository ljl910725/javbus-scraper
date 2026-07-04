const historyLoginHint = document.getElementById("historyLoginHint");
const historySection = document.getElementById("historySection");
const pushHistoryList = document.getElementById("pushHistoryList");
const refreshPushHistoryBtn = document.getElementById("refreshPushHistoryBtn");

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatHistoryTime(value) {
  if (!value) return "";
  return value.replace("T", " ").slice(0, 19);
}

function buildDetailUrl(code) {
  const params = new URLSearchParams({ code, view: "detail" });
  return `/?${params.toString()}`;
}

function renderPushHistory(items) {
  if (!items.length) {
    pushHistoryList.innerHTML = '<p class="push-history-empty">暂无推送记录</p>';
    return;
  }

  pushHistoryList.innerHTML = items
    .map((item) => {
      const statusClass = item.success ? "success" : "failed";
      const statusText = item.success ? "成功" : "失败";
      const folderText = item.folder_name
        ? `${escapeHtml(item.folder_name)} (${escapeHtml(item.folder_path)})`
        : item.folder_path
          ? escapeHtml(item.folder_path)
          : "-";
      const title = item.magnet_title || item.code || "磁力推送";
      const codeHtml = item.code
        ? `<a class="push-history-code push-history-detail-link" href="${buildDetailUrl(item.code)}">${escapeHtml(item.code)}</a>`
        : "";
      const detailLinkHtml = item.code
        ? `<a class="ghost-btn push-history-detail-link" href="${buildDetailUrl(item.code)}">查看详情</a>`
        : "";
      const detail = item.success
        ? `<div class="push-history-message">${escapeHtml(item.message || "推送成功")}</div>`
        : `
          <div class="push-history-message error">${escapeHtml(item.message || "推送失败")}</div>
          <button class="ghost-btn push-history-detail-btn" type="button" data-history-id="${item.id}">查看原因</button>
          <pre class="push-history-detail hidden" id="push-history-detail-${item.id}">${escapeHtml(item.message || "未知错误")}</pre>`;
      return `
        <article class="push-history-item ${statusClass}">
          <div class="push-history-item-head">
            <div>
              ${item.code ? `<a class="push-history-title-link" href="${buildDetailUrl(item.code)}">${escapeHtml(title)}</a>` : `<strong>${escapeHtml(title)}</strong>`}
              ${codeHtml}
            </div>
            <span class="push-history-status ${statusClass}">${statusText}</span>
          </div>
          <div class="push-history-meta">
            <span>${formatHistoryTime(item.created_at)}</span>
            <span>${escapeHtml(item.backend || "-")}</span>
            <span>${folderText}</span>
          </div>
          <div class="push-history-actions">
            ${detailLinkHtml}
          </div>
          ${detail}
        </article>`;
    })
    .join("");
}

async function loadPushHistory() {
  if (!isLoggedIn()) {
    historyLoginHint.classList.remove("hidden");
    historySection.classList.add("hidden");
    return;
  }

  historyLoginHint.classList.add("hidden");
  historySection.classList.remove("hidden");
  pushHistoryList.innerHTML = '<p class="push-history-empty">加载中...</p>';

  try {
    const res = await authFetch("/api/push/history?limit=50");
    if (!res.ok) {
      pushHistoryList.innerHTML = '<p class="push-history-empty">加载推送历史失败</p>';
      return;
    }
    const data = await res.json();
    renderPushHistory(data.items || []);
  } catch {
    pushHistoryList.innerHTML = '<p class="push-history-empty">加载推送历史失败</p>';
  }
}

refreshPushHistoryBtn?.addEventListener("click", () => {
  loadPushHistory();
});

pushHistoryList?.addEventListener("click", (event) => {
  const detailBtn = event.target.closest(".push-history-detail-btn");
  if (!detailBtn) return;
  const detailEl = document.getElementById(`push-history-detail-${detailBtn.dataset.historyId}`);
  if (!detailEl) return;
  const hidden = detailEl.classList.toggle("hidden");
  detailBtn.textContent = hidden ? "查看原因" : "收起原因";
});

initNav({ onLogout: () => loadPushHistory() });
loadPushHistory();
