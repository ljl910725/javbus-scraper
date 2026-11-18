// 标题翻译、隐私遮挡图片、大图查看

async function translateText(text, resultEl) {
  resultEl.classList.remove("hidden");
  resultEl.textContent = "翻译中...";
  try {
    const res = await authFetch("/api/translate", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "翻译失败");
    resultEl.textContent = data.translated;
  } catch (err) {
    resultEl.textContent = `翻译失败: ${err.message}`;
  }
}

function hidePrivacyImage(container) {
  const img = container.querySelector(".privacy-img");
  const placeholder = container.querySelector(".privacy-placeholder");
  const hint = container.querySelector(".privacy-hint");

  img.classList.add("hidden");
  img.removeAttribute("src");
  placeholder.classList.remove("hidden");
  hint.classList.add("hidden");
  container.dataset.state = "hidden";
  container.classList.remove("revealed");
}

function revealPrivacyImage(container) {
  const state = container.dataset.state;
  const img = container.querySelector(".privacy-img");
  const placeholder = container.querySelector(".privacy-placeholder");
  const hint = container.querySelector(".privacy-hint");

  if (state === "hidden") {
    img.src = container.dataset.src;
    img.classList.remove("hidden");
    placeholder.classList.add("hidden");
    hint.classList.remove("hidden");
    container.dataset.state = "revealed";
    container.classList.add("revealed");
    return;
  }

  if (state === "revealed") {
    const card = container.closest("[data-gallery]") || container.closest(".card");
    const gallery = parseGallery(card);
    const fallback = [{ src: container.dataset.full || container.dataset.src, alt: "预览图", label: "图片" }];
    const index = Number(container.dataset.galleryIndex || 0);
    openLightbox(gallery.length ? gallery : fallback, index);
  }
}

function renderLightboxThumbs() {
  if (!lightboxGallery.length) {
    lightboxThumbs.innerHTML = "";
    return;
  }

  lightboxThumbs.innerHTML = lightboxGallery
    .map(
      (item, index) => `
      <button
        class="lightbox-thumb${index === lightboxIndex ? " active" : ""}"
        type="button"
        data-index="${index}"
        aria-label="${escapeHtml(item.label || item.alt || `图片 ${index + 1}`)}"
      >
        <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || "")}" loading="lazy" />
        <span class="lightbox-thumb-label">${escapeHtml(item.label || String(index + 1))}</span>
      </button>`
    )
    .join("");
}

function updateLightbox() {
  if (!lightboxGallery.length) return;

  const item = lightboxGallery[lightboxIndex];
  lightboxImage.src = item.src;
  lightboxImage.alt = item.alt || "预览图";
  lightboxCounter.textContent = `${lightboxIndex + 1} / ${lightboxGallery.length}`;
  const canLoop = lightboxGallery.length > 1;
  lightboxPrev.disabled = !canLoop;
  lightboxNext.disabled = !canLoop;
  renderLightboxThumbs();

  const activeThumb = lightboxThumbs.querySelector(".lightbox-thumb.active");
  if (activeThumb) {
    activeThumb.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
}

function openLightbox(gallery, startIndex = 0) {
  lightboxGallery = gallery;
  lightboxIndex = Math.max(0, Math.min(startIndex, gallery.length - 1));
  updateLightbox();
  bringModalToFront(lightbox);
  lightbox.classList.remove("hidden");
  lightbox.setAttribute("aria-hidden", "false");
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightbox.setAttribute("aria-hidden", "true");
  lightboxGallery = [];
  lightboxIndex = 0;
  lightboxImage.removeAttribute("src");
  lightboxThumbs.innerHTML = "";
  lightboxCounter.textContent = "";
}

function showPrevLightboxImage() {
  if (lightboxGallery.length <= 1) return;
  lightboxIndex = (lightboxIndex - 1 + lightboxGallery.length) % lightboxGallery.length;
  updateLightbox();
}

function showNextLightboxImage() {
  if (lightboxGallery.length <= 1) return;
  lightboxIndex = (lightboxIndex + 1) % lightboxGallery.length;
  updateLightbox();
}
