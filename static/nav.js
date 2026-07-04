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
