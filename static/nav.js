function updateNavUI() {
  const user = getUser();
  const userMenu = document.getElementById("userMenu");
  const userMenuName = document.getElementById("userMenuName");
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");

  if (!userMenu || !loginBtn) return;

  if (user) {
    userMenu.classList.remove("hidden");
    if (userMenuName) userMenuName.textContent = user.username;
    loginBtn.classList.add("hidden");
    registerBtn?.classList.add("hidden");
  } else {
    userMenu.classList.remove("is-open");
    userMenu.classList.add("hidden");
    loginBtn.classList.remove("hidden");
    registerBtn?.classList.remove("hidden");
  }
}

function initUserMenuHover() {
  const menu = document.getElementById("userMenu");
  if (!menu || menu.dataset.hoverBound === "1") return;
  menu.dataset.hoverBound = "1";

  let closeTimer = null;

  const openMenu = () => {
    clearTimeout(closeTimer);
    menu.classList.add("is-open");
  };

  const scheduleClose = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      menu.classList.remove("is-open");
    }, 220);
  };

  menu.addEventListener("mouseenter", openMenu);
  menu.addEventListener("mouseleave", scheduleClose);
  menu.addEventListener("focusin", openMenu);
  menu.addEventListener("focusout", (event) => {
    if (!menu.contains(event.relatedTarget)) scheduleClose();
  });

  menu.querySelector(".user-menu-trigger")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (menu.classList.contains("is-open")) scheduleClose();
    else openMenu();
  });
}

function initNav(options = {}) {
  updateNavUI();
  initUserMenuHover();

  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  const hasAuthModal = Boolean(document.getElementById("authForm"));

  if (!hasAuthModal && loginBtn?.tagName === "BUTTON") {
    loginBtn.addEventListener("click", () => {
      window.location.href = "/";
    });
  }
  if (!hasAuthModal && registerBtn?.tagName === "BUTTON") {
    registerBtn.addEventListener("click", () => {
      window.location.href = "/";
    });
  }

  document.getElementById("userMenuLogoutBtn")?.addEventListener("click", () => {
    clearAuth();
    updateNavUI();
    options.onLogout?.();
  });
}

async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (!value) throw new Error("没有可复制的内容");

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // HTTP / 权限被拒时走降级
    }
  }

  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0;margin:0;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    ta.remove();
  }
  if (ok) return true;

  window.prompt("复制失败，请手动复制：", value);
  throw new Error("复制失败，请手动复制");
}

async function copyCodeToClipboard(code, el) {
  const value = (code || "").trim();
  if (!value) return false;
  try {
    await copyTextToClipboard(value);
    if (el) {
      el.classList.remove("is-copy-failed");
      el.classList.add("is-copied");
      window.clearTimeout(Number(el.dataset.copyTimer || 0));
      el.dataset.copyTimer = String(
        window.setTimeout(() => el.classList.remove("is-copied"), 1200)
      );
    }
    return true;
  } catch {
    if (el) {
      el.classList.remove("is-copied");
      el.classList.add("is-copy-failed");
      window.clearTimeout(Number(el.dataset.copyTimer || 0));
      el.dataset.copyTimer = String(
        window.setTimeout(() => el.classList.remove("is-copy-failed"), 1800)
      );
    }
    return false;
  }
}

document.addEventListener(
  "click",
  async (event) => {
    const el = event.target.closest(".copy-code");
    if (!el) return;
    const code = (el.dataset.code || "").trim();
    if (!code) return;
    event.preventDefault();
    event.stopPropagation();
    await copyCodeToClipboard(code, el);
  },
  true
);
