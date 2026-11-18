// 影片详情卡片、磁力列表和查询失败提示

function magnetSiteLabel(site) {
  const raw = (site || "").trim();
  if (!raw) return "";
  const labels = { javbus: "JavBus", sehuatang: "色花堂" };
  return raw
    .split("/")
    .map((part) => labels[part.trim().toLowerCase()] || part.trim())
    .filter(Boolean)
    .join(" / ");
}

function renderMagnetBadges(magnet) {
  const badges = [];
  const site = magnetSiteLabel(magnet.site);
  if (site) badges.push(`<span class="badge badge-site">${escapeHtml(site)}</span>`);
  if (magnetIsUhd(magnet)) badges.push('<span class="badge badge-uhd">UHD</span>');
  else if (magnet.is_hd) badges.push('<span class="badge badge-hd">HD</span>');
  if (magnetHasSubtitle(magnet)) badges.push('<span class="badge badge-sub">字幕</span>');
  return badges.join("");
}

function renderMovieCard(movie) {
  const gallery = buildMovieGallery(movie);
  const previewCount = (movie.preview_images || []).length;
  const genresHtml = (movie.genres || [])
    .map((g) => `<span class="tag">${escapeHtml(g)}</span>`)
    .join("");

  const magnets = movie.magnets || [];
  const magnetsHtml =
    magnets.length > 0
      ? magnets
          .map(
            (m, index) => `
        <div class="magnet-item${index >= MAGNET_PREVIEW_COUNT ? " magnet-item-extra hidden" : ""}">
          <span class="magnet-title" title="${escapeHtml(m.title)}">${escapeHtml(m.title)}</span>
          <span class="magnet-meta">${escapeHtml(m.size || "")}${m.date ? ` ${escapeHtml(m.date)}` : ""}</span>
          <span class="magnet-badges">
            ${renderMagnetBadges(m)}
          </span>
          <button class="copy-btn" data-link="${escapeHtml(m.link)}" type="button">复制</button>
          ${pushReady ? `<button class="push-btn" data-link="${escapeHtml(m.link)}" type="button">${pushLabel}</button>` : ""}
          ${p115Ready && pushBackend !== "p115" ? `<button class="push-115-btn ghost-btn" data-link="${escapeHtml(m.link)}" type="button">推送115</button>` : ""}
        </div>`
          )
          .join("")
      : '<p class="no-magnets">暂无磁力链接</p>';

  const magnetToggleHtml =
    magnets.length > MAGNET_PREVIEW_COUNT
      ? `<button class="magnet-toggle-btn ghost-btn" type="button" data-expanded="false">展开其余 ${magnets.length - MAGNET_PREVIEW_COUNT} 条</button>`
      : "";

  return `
    <article class="card" data-gallery="${encodeGallery(gallery)}">
      <div class="card-header">
        <div class="cover">${renderPrivacyImage(movie.cover_path ? `/covers/${movie.cover_path.split(/[/\\]/).pop()}` : movie.cover_url, movie.source_url, movie.code, previewCount)}</div>
        <div class="card-info">
          <span class="code-badge copy-code" data-code="${escapeHtml(movie.code)}" title="点击复制番号">${escapeHtml(movie.code)}</span>
          ${renderTitle(movie)}
          <dl class="meta">
            ${renderTranslatable("演员", (movie.actresses || []).join("、"))}
            ${renderMeta("发行日期", movie.release_date)}
            ${renderMeta("时长", movie.runtime)}
            ${renderTranslatable("导演", movie.director)}
            ${renderTranslatable("制作商", movie.studio)}
            ${renderTranslatable("发行商", movie.label)}
          </dl>
          ${genresHtml ? `<div class="genres">${genresHtml}</div>` : ""}
        </div>
      </div>
      <div class="magnets">
        <div class="magnets-header">
          <h3>磁力链接 (${magnets.length})</h3>
          ${pushReady && magnets.length ? `<button class="push-best-btn" data-code="${escapeHtml(movie.code)}" type="button">推送最佳到${pushBackend === "cd2" ? "CD2" : "115"}</button>` : ""}
          ${p115Ready && magnets.length && pushBackend !== "p115" ? `<button class="push-115-best-btn ghost-btn" data-code="${escapeHtml(movie.code)}" type="button">推送最佳到115</button>` : ""}
        </div>
        <div class="magnet-list">${magnetsHtml}</div>
        ${magnetToggleHtml ? `<div class="magnet-list-footer">${magnetToggleHtml}</div>` : ""}
      </div>
      ${renderSubtitleSection(movie)}
    </article>`;
}

function renderMeta(label, value) {
  if (!value) return "";
  return `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function splitSourceErrors(message) {
  return String(message || "")
    .split("；")
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderErrors(errors) {
  lastErrors = errors || [];
  if (!errorsEl) return;
  if (!lastErrors.length) {
    errorsEl.classList.add("hidden");
    errorsEl.innerHTML = "";
    delete errorsEl.dataset.kind;
    return;
  }
  errorsEl.dataset.kind = "query";
  errorsEl.classList.remove("hidden");
  const title = lastErrors.length === 1 ? "番号查询失败" : "部分番号查询失败";
  errorsEl.innerHTML = `
    <h3>${title}</h3>
    <ul>${lastErrors
      .map((e) => {
        const sources = splitSourceErrors(e.message);
        const detail =
          sources.length > 1
            ? `<ul class="error-sources">${sources.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
            : `: ${escapeHtml(e.message || "")}`;
        return `<li><strong>${escapeHtml(e.code)}</strong>${detail}</li>`;
      })
      .join("")}</ul>`;
}

function formatQueryErrors(errors) {
  return (errors || [])
    .map((e) => {
      const code = String(e?.code || "").trim();
      const message = String(e?.message || "").trim();
      if (code && message) return `${code}: ${message}`;
      return code || message;
    })
    .filter(Boolean)
    .join("；");
}
