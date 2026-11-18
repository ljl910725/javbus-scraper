// 按钮事件绑定、页签切换和首页启动，必须最后加载

loginBtn.addEventListener("click", () => openAuthModal());
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.classList.add("hidden");
  const rememberDays = Number(authRememberDays?.value);
  if (!REMEMBER_DAY_CHOICES.includes(rememberDays)) {
    authError.textContent = "请选择自动登录时长";
    authError.classList.remove("hidden");
    return;
  }
  const payload = {
    username: authUsername.value.trim(),
    password: authPassword.value,
    remember_days: rememberDays,
  };

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "登录失败");
    setAuth(data.access_token, data.user);
    closeAuthModal();
    updateNavUI();
    loadConfig();
    if (typeof loadCleanupRules === "function") loadCleanupRules();
    setStatus("登录成功");
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove("hidden");
  }
});

document.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", closeAuthModal);
});

document.querySelectorAll("[data-close-lightbox]").forEach((el) => {
  el.addEventListener("click", closeLightbox);
});

lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});

document.querySelector(".lightbox-content")?.addEventListener("click", (event) => {
  event.stopPropagation();
});

lightboxPrev.addEventListener("click", (event) => {
  event.stopPropagation();
  showPrevLightboxImage();
});

lightboxNext.addEventListener("click", (event) => {
  event.stopPropagation();
  showNextLightboxImage();
});

lightboxThumbs.addEventListener("click", (event) => {
  const thumb = event.target.closest(".lightbox-thumb");
  if (!thumb) return;
  event.stopPropagation();
  lightboxIndex = Number(thumb.dataset.index);
  updateLightbox();
});

document.addEventListener("keydown", (event) => {
  if (lightbox.classList.contains("hidden")) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    showPrevLightboxImage();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    showNextLightboxImage();
  } else if (event.key === "Escape") {
    closeLightbox();
  }
});

resultsEl.addEventListener("change", (event) => {
  if (event.target.id === "listFilterSelect") {
    listFilter = event.target.value;
    listPage = 1;
    renderListResultsView();
    return;
  }
  if (event.target.id === "listSortSelect") {
    listSort = event.target.value;
    listPage = 1;
    renderListResultsView();
    return;
  }
  if (event.target.id === "listPageSizeSelect") {
    const size = Number(event.target.value);
    if (!PAGE_SIZE_OPTIONS.includes(size)) return;
    listPageSize = size;
    listPage = 1;
    saveListPageSize(size);
    renderListResultsView();
    return;
  }
  if (event.target.id === "listSelectPageCb") {
    const pageData = getPaginatedListResults();
    if (event.target.checked) {
      pageData.items.forEach((item) => selectedCodes.add(item.code));
    } else {
      pageData.items.forEach((item) => selectedCodes.delete(item.code));
    }
    renderListResultsView();
  }
});

resultsEl.addEventListener("click", async (event) => {
  if (event.target.id === "backToListBtn" || event.target.closest("#backToListBtn")) {
    showListResultsAgain();
    return;
  }

  if (event.target.id === "listBulkModeBtn") {
    toggleListBulkMode();
    return;
  }

  if (event.target.id === "listPrevPageBtn") {
    if (listPage > 1) {
      listPage -= 1;
      renderListResultsView();
    }
    return;
  }
  if (event.target.id === "listNextPageBtn") {
    const { totalPages } = getPaginatedListResults();
    if (listPage < totalPages) {
      listPage += 1;
      renderListResultsView();
    }
    return;
  }
  if (event.target.id === "listClearSelectBtn") {
    selectedCodes.clear();
    renderListResultsView();
    return;
  }
  if (event.target.id === "listBulkCopyBtn") {
    await copySelectedLinks();
    return;
  }
  if (event.target.id === "listBulkPushBtn") {
    await pushSelectedLinks(event.target);
    return;
  }

  const copyBestBtn = event.target.closest(".copy-best-btn");
  if (copyBestBtn) {
    event.stopPropagation();
    await copyItemBestLink(copyBestBtn.dataset.code, copyBestBtn.dataset.link, copyBestBtn);
    return;
  }

  const subtitleOpenBtn = event.target.closest(".subtitle-open-btn");
  if (subtitleOpenBtn) {
    event.stopPropagation();
    openSubtitleModal(subtitleOpenBtn.dataset.code);
    return;
  }

  if (await handleSubtitleItemClick(event)) {
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
    event.stopPropagation();
    revealPrivacyImage(privacyImage);
    return;
  }

  const listItem = event.target.closest(".fuzzy-item");
  if (listItem?.dataset.code && !event.target.closest(".list-item-actions") && !event.target.closest(".fuzzy-cover")) {
    if (listBulkMode) {
      const code = listItem.dataset.code;
      if (selectedCodes.has(code)) selectedCodes.delete(code);
      else selectedCodes.add(code);
      renderListResultsView();
      return;
    }
    await openListDetail(listItem.dataset.code);
    return;
  }

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

  const copyBtn = event.target.closest(".copy-btn");
  if (copyBtn) {
    await copyMagnetLink(copyBtn.dataset.link, copyBtn);
    return;
  }

  const push115Btn = event.target.closest(".push-115-btn");
  if (push115Btn) {
    event.stopPropagation();
    await openP115MagnetModal({
      magnet: push115Btn.dataset.link || "",
      code: push115Btn.dataset.code || "",
      button: push115Btn,
      target: "p115",
    });
    return;
  }

  const push115BestBtn = event.target.closest(".push-115-best-btn");
  if (push115BestBtn?.dataset.code) {
    event.stopPropagation();
    await openP115MagnetModal({
      code: push115BestBtn.dataset.code,
      button: push115BestBtn,
      target: "p115",
    });
    return;
  }

  const pushBtn = event.target.closest(".push-btn");
  if (pushBtn) {
    if (pushBackend === "p115") {
      await openP115MagnetModal({ magnet: pushBtn.dataset.link || "", button: pushBtn, target: "p115" });
      return;
    }
    await pushToOffline({ magnets: [pushBtn.dataset.link], button: pushBtn });
    return;
  }

  const pushBestBtn = event.target.closest(".push-best-btn");
  if (pushBestBtn) {
    event.stopPropagation();
    if (pushBackend === "p115") {
      await openP115MagnetModal({
        magnet: pushBestBtn.dataset.link || "",
        code: pushBestBtn.dataset.code || "",
        button: pushBestBtn,
        target: "p115",
      });
      return;
    }
    if (pushBestBtn.closest(".list-item-actions")) {
      await pushItemBestLink(
        pushBestBtn.dataset.code,
        pushBestBtn.dataset.link,
        pushBestBtn
      );
      return;
    }
    if (pushBestBtn.dataset.code) {
      await pushToOffline({ code: pushBestBtn.dataset.code, pushBest: true, button: pushBestBtn });
    }
  }
});

searchBtn.addEventListener("click", search);
exactModeBtn.addEventListener("click", () => setSearchMode("exact"));
fuzzyModeBtn.addEventListener("click", () => setSearchMode("fuzzy"));
codesInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.ctrlKey) search();
});
fuzzyQueryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") search();
});

const HOME_TAB_KEY = "javbus_home_tab";

function homeTabNames() {
  return Array.from(document.querySelectorAll(".app-tab[data-tab]"), (btn) => btn.dataset.tab);
}

function setHomeTab(tab, { persist = true } = {}) {
  const tabs = homeTabNames();
  const next = tabs.includes(tab) ? tab : tabs[0] || "search";
  document.querySelectorAll(".app-tab").forEach((btn) => {
    const active = btn.dataset.tab === next;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.tabPanel !== next);
  });
  if (persist) {
    try {
      sessionStorage.setItem(HOME_TAB_KEY, next);
    } catch {
      // ignore
    }
    const url = new URL(window.location.href);
    if (next === "search") url.hash = "";
    else url.hash = next;
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
}

document.querySelector(".app-tabs")?.addEventListener("click", (event) => {
  const btn = event.target.closest(".app-tab");
  if (!btn?.dataset.tab) return;
  event.preventDefault();
  setHomeTab(btn.dataset.tab);
});

const bootParams = new URLSearchParams(window.location.search);
const bootDetailCode = (bootParams.get("code") || "").trim();
const bootHashTab = (window.location.hash || "").replace(/^#/, "");
const storedTab = (() => {
  try {
    return sessionStorage.getItem(HOME_TAB_KEY);
  } catch {
    return "";
  }
})();
const bootTabs = homeTabNames();
const bootTab = bootTabs.includes(bootHashTab)
  ? bootHashTab
  : bootTabs.includes(storedTab)
    ? storedTab
    : "search";
if (bootDetailCode && bootParams.get("view") === "detail") {
  setHomeTab("search", { persist: false });
  setSearchMode("exact");
  handleDetailDeepLink();
} else if (!restoreSearchState()) {
  setSearchMode("exact");
  setHomeTab(bootTab, { persist: true });
} else {
  setHomeTab(bootTab, { persist: true });
}

closePushFolderModalBtn.addEventListener("click", closePushFolderModal);
closeSubtitleModalBtn.addEventListener("click", closeSubtitleModal);
subtitleModal.addEventListener("click", (event) => {
  if (event.target === subtitleModal) closeSubtitleModal();
});
subtitleModalList.addEventListener("click", async (event) => {
  await handleSubtitleItemClick(event);
});
closeSubtitleSaveModalBtn.addEventListener("click", closeSubtitleSaveModal);
subtitleSaveModal.addEventListener("click", async (event) => {
  if (event.target === subtitleSaveModal) {
    closeSubtitleSaveModal();
    return;
  }
  await handleSubtitleSaveFolderClick(event);
});
subtitleSaveUpBtn.addEventListener("click", () => {
  if (subtitleSaveBrowseParent !== null) {
    loadSubtitleSaveFolders(subtitleSaveBrowseParent);
  }
});
subtitleSaveUseDirBtn.addEventListener("click", () => {
  if (!subtitleSaveBrowsePath) {
    setSubtitleSaveModalStatus("请先进入具体目录", true);
    return;
  }
  subtitleSaveTargetDir.value = subtitleSaveBrowsePath;
  setSubtitleSaveModalStatus(`已选择目录: ${subtitleSaveBrowsePath}`);
});
subtitleSaveSearchBtn.addEventListener("click", searchSubtitleFiles);
subtitleSaveSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchSubtitleFiles();
  }
});
subtitleSaveConfirmBtn.addEventListener("click", confirmSubtitleSave);
pushFolderModal.addEventListener("click", (event) => {
  if (event.target === pushFolderModal) closePushFolderModal();
});
pushFolderChoices.addEventListener("click", async (event) => {
  const choice = event.target.closest(".push-folder-choice");
  if (!choice || !pendingPushRequest) return;
  const request = pendingPushRequest;
  closePushFolderModal();
  await pushToOffline({ ...request, pushFolderId: choice.dataset.folderId });
});

async function bootApp() {
  // 先续登录，再拉配置，避免过期令牌被当成未配置
  await ensureSession();
  initNav({ onLogout: () => { clearSearchState(); loadConfig(); } });
  loadConfig();
}

bootApp();
