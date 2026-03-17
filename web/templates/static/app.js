(function () {
  function setActiveNav() {
    const path = window.location.pathname.replace(/\/+$/, "");

    let key = "";
    if (path === "" || path === "/") key = "dashboard";
    else if (path.startsWith("/dashboard")) key = "dashboard";
    else if (path.startsWith("/logs")) key = "logs";
    else if (path.startsWith("/status")) key = "status";

    document.querySelectorAll(".navbtn").forEach((a) => {
      a.classList.toggle("active", a.dataset.nav === key);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setActiveNav);
  } else {
    setActiveNav();
  }

  function createSidebarController(opts) {
    const { el, data, callbacks, initial, render } = opts;

    let currentServerId = initial?.serverId || null;
    let currentContainerName = initial?.containerName || null;

    function statusToClass(status) {
      if (render && typeof render.statusToClass === "function") {
        return render.statusToClass(status);
      }

      const s = (status || "").toLowerCase();
      if (s === "running" || s === "up") return "status-running";
      if (s === "restarting" || s === "paused" || s === "unhealthy") return "status-warning";
      return "status-error";
    }

    // ---------- render ----------
    function renderServers(serverIds) {
      if (!serverIds.length) {
        el.serverListEl.innerHTML = '<div class="empty-text">서버 없음</div>';
        return;
      }

      el.serverListEl.innerHTML = "";
      serverIds.forEach((sid) => {
        const btn = document.createElement("button");
        btn.className = "server-btn";
        btn.textContent = sid;

        if (sid === currentServerId) btn.classList.add("active");

        btn.addEventListener("click", () => selectServer(sid));
        el.serverListEl.appendChild(btn);
      });
    }

    function renderContainers(containers) {
      if (!containers.length) {
        el.containerListEl.innerHTML = '<div class="empty-text">컨테이너 없음</div>';
        return;
      }

      el.containerListEl.innerHTML = "";
      containers.forEach((c) => {
        const item = document.createElement("div");
        item.className = "container-item";

        const name = document.createElement("span");
        name.className = "container-item-name";
        name.textContent = c.container_name || "(no name)";
        item.appendChild(name);

        if (c.status != null) {
          const status = document.createElement("span");
          status.className = `status-pill ${statusToClass(c.status)}`;
          status.textContent = c.status;
          item.appendChild(status);
        }

        if (c.container_name === currentContainerName) {
          item.classList.add("active");
        }

        item.addEventListener("click", () =>
          selectContainer(c.container_name)
        );

        el.containerListEl.appendChild(item);
      });
    }

    // ---------- filter ----------
    function applyServerFilter() {
      const q = el.serverSearchInput.value.trim().toLowerCase();
      const all = data.getServers();
      const filtered = q
        ? all.filter((s) => s.toLowerCase().includes(q))
        : all;
      renderServers(filtered);
    }

    function applyContainerFilter() {
      if (!currentServerId) return;
      const q = el.containerSearchInput.value.trim().toLowerCase();
      const base = data.getContainersForServer(currentServerId);
      const filtered = q
        ? base.filter((c) =>
            (c.container_name || "").toLowerCase().includes(q)
          )
        : base;
      renderContainers(filtered);
    }

    // ---------- select ----------
    async function selectServer(serverId) {
      currentServerId = serverId;
      currentContainerName = null;

      el.serverListEl
        .querySelectorAll(".server-btn")
        .forEach((b) => b.classList.remove("active"));

      el.serverListEl
        .querySelectorAll(".server-btn")
        .forEach((b) => {
          if (b.textContent === serverId) b.classList.add("active");
        });

      // status UX
      el.containerSearchWrap.classList.remove("is-hidden");
      el.containerSearchInput.disabled = false;
      el.containerSearchInput.value = "";

      el.containerListEl.innerHTML =
        '<div class="empty-text">컨테이너 로딩 중...</div>';

      await callbacks.onServerSelected(serverId);
      applyContainerFilter();

      if (initial?.containerName) {
        selectContainer(initial.containerName);
      }
    }

    function selectContainer(containerName) {
      currentContainerName = containerName;

      el.containerListEl
        .querySelectorAll(".container-item")
        .forEach((x) => x.classList.remove("active"));

      el.containerListEl
        .querySelectorAll(".container-item")
        .forEach((x) => {
          const n = x.querySelector(".container-item-name")?.textContent;
          if (n === containerName) x.classList.add("active");
        });

      callbacks.onContainerSelected(currentServerId, containerName);
    }

    // ---------- boot ----------
    function boot() {
      applyServerFilter();

      el.containerSearchWrap.classList.add("is-hidden");
      el.containerSearchInput.disabled = true;
      el.containerListEl.innerHTML =
        '<div class="empty-text">서버를 선택하세요.</div>';

      el.serverSearchInput.addEventListener("input", applyServerFilter);
      el.containerSearchInput.addEventListener("input", applyContainerFilter);

      if (initial?.serverId) {
        selectServer(initial.serverId);
      }
    }

    return { boot };
  }

  window.AppSidebar = { createSidebarController };
})();
