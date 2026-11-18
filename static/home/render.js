// 页面上通用的显示小工具：状态栏、封面图代理、图集、可翻译标题

function setStatus(message, loading = false) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden", "loading");
  statusEl.classList.toggle("loading", loading);
}

function encodeDataUrl(url) {
  return encodeURIComponent(url || "");
}

function readButtonDataUrl(button) {
  const raw = button.dataset.detailUrl || "";
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function proxyImageUrl(url, referer) {
  const params = new URLSearchParams({ url, referer: referer || "" });
  const token = getToken();
  if (token) params.set("access_token", token);
  return `/api/cover/proxy?${params}`;
}

function imageSource(url, referer) {
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return proxyImageUrl(url, referer);
}

function renderPrivacyImage(url, referer, alt = "图片", previewCount = 0, options = {}) {
  if (!url) return `<div class="cover-placeholder">无图片</div>`;
  const src = imageSource(url, referer);
  const compact = Boolean(options.compact);
  const zoomHint = compact
    ? "再次点击放大"
    : previewCount > 0
      ? `再次点击放大 (${previewCount + 1} 张)`
      : "再次点击放大";
  const extraClass = compact ? "list-privacy" : "cover-privacy";
  return `
    <div class="privacy-image ${extraClass}" data-state="hidden" data-src="${escapeHtml(src)}" data-full="${escapeHtml(src)}" data-gallery-index="0">
      <div class="privacy-placeholder">隐私模式<br>点击显示</div>
      <img class="privacy-img hidden" alt="${escapeHtml(alt)}" />
      <div class="privacy-hint hidden">
        <span class="privacy-hint-text">${escapeHtml(zoomHint)}</span>
        <button class="privacy-hide-btn" type="button">隐藏</button>
      </div>
    </div>`;
}

function buildMovieGallery(movie) {
  const gallery = [];
  const cover = movie.cover_path
    ? `/covers/${movie.cover_path.split(/[/\\]/).pop()}`
    : movie.cover_url;
  if (cover) {
    gallery.push({
      src: imageSource(cover, movie.source_url),
      alt: `${movie.code} 封面`,
      label: "封面",
    });
  }
  (movie.preview_images || []).forEach((url, index) => {
    gallery.push({
      src: imageSource(url, movie.source_url),
      alt: `${movie.code} 预览 ${index + 1}`,
      label: `预览 ${index + 1}`,
    });
  });
  return gallery;
}

function encodeGallery(gallery) {
  return encodeURIComponent(JSON.stringify(gallery));
}

function parseGallery(card) {
  if (!card?.dataset.gallery) return [];
  try {
    return JSON.parse(decodeURIComponent(card.dataset.gallery));
  } catch {
    return [];
  }
}

function renderTranslatable(label, value) {
  if (!value) return "";
  return `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>
        <span class="translatable" data-text="${escapeHtml(value)}">${escapeHtml(value)}</span>
        <button class="translate-btn" data-text="${escapeHtml(value)}" type="button">翻译</button>
        <div class="translation-result hidden"></div>
      </dd>
    </div>`;
}

function renderTitle(movie) {
  const title = movie.title || "未知标题";
  return `
    <div class="title-row">
      <h2>
        <span class="translatable" data-text="${escapeHtml(title)}">${escapeHtml(title)}</span>
      </h2>
      <button class="translate-btn" data-text="${escapeHtml(title)}" type="button">翻译标题</button>
      <div class="translation-result hidden"></div>
    </div>`;
}
