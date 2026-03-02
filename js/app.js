const API = "https://devise-center.onrender.com";

let state = {
  token: localStorage.getItem("dc_token") || null,
  user: JSON.parse(localStorage.getItem("dc_user") || "null"),
  posts: [],
  currentPostId: null,
  profileUserId: null,
  sidebarCollapsed: false,
  selectedPostImage: null,
  selectedProfilePic: null,
};

// ─── HELPER: Escape HTML to prevent XSS ───
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── HELPER: API request with error handling ───
async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  // Don't set Content-Type for FormData (browser sets it with boundary)
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (res.status === 401) {
    // Token expired or invalid
    state.token = null;
    state.user = null;
    localStorage.removeItem("dc_token");
    localStorage.removeItem("dc_user");
    showToast("Sessão expirada. Faça login novamente.", "error");
    showView("auth");
    throw new Error("Não autorizado.");
  }
  return res;
}

// Parse error message from API response safely
async function parseErrorMessage(
  res,
  fallback = "Ocorreu um erro. Tente novamente.",
) {
  try {
    const text = await res.clone().text();
    if (!text) return fallback;
    try {
      const data = JSON.parse(text);
      return data.message || data.error || data.detail || fallback;
    } catch {
      // Response was plain text, not JSON
      return text.length < 200 ? text : fallback;
    }
  } catch {
    return fallback;
  }
}

// ─── INIT ───
window.addEventListener("DOMContentLoaded", async () => {
  if (state.token) {
    try {
      await fetchCurrentUser(); // valida token e carrega id real
      enterApp();
    } catch {
      handleLogout();
    }
  }
});

// ─── VIEWS ───
function showView(id) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document.getElementById("view-" + id).classList.add("active");
}

function showPage(name) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));

  if (name === "home") {
    document.getElementById("page-home").classList.add("active");
    document.querySelector(".nav-item").classList.add("active");
    document.getElementById("topbar-title").textContent = "Feed";
    loadFeed();
  } else if (name === "post") {
    document.getElementById("page-post").classList.add("active");
    document.getElementById("topbar-title").textContent = "Post";
  } else if (name === "profile-own") {
    if (!state.user) {
      showToast("Faça login para ver seu perfil", "info");
      switchToAuth();
      return;
    }

    document.getElementById("page-profile").classList.add("active");
    document.getElementById("sidebar-profile-link").classList.add("active");
    document.getElementById("topbar-title").textContent = "Meu Perfil";

    loadProfile(null, true);
  }
}

// ─── AUTH ───
function switchAuthTab(tab) {
  document
    .querySelectorAll(".auth-tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".auth-form")
    .forEach((f) => f.classList.remove("active"));
  document
    .querySelector(
      `.auth-tab:${tab === "login" ? "first-child" : "last-child"}`,
    )
    .classList.add("active");
  document.getElementById(tab + "-form").classList.add("active");
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById("login-btn");
  const errEl = document.getElementById("login-error");
  errEl.classList.remove("show");
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  if (!username || !password) {
    errEl.textContent = "Preencha usuário e senha.";
    errEl.classList.add("show");
    return;
  }
  btn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Entrando...';
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const msg = await parseErrorMessage(
        res,
        res.status === 401
          ? "Usuário ou senha incorretos."
          : res.status === 403
            ? "Acesso negado."
            : "Erro ao fazer login. Tente novamente.",
      );
      throw new Error(msg);
    }
    // API returns the JWT token as plain text, not JSON
    const contentType = res.headers.get("content-type") || "";
    let token;
    if (contentType.includes("application/json")) {
      const data = await res.json();
      token = data.token || data.accessToken || data;
    } else {
      token = await res.text();
    }
    state.token = token.trim();
    localStorage.setItem("dc_token", state.token);
    await fetchCurrentUser();
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add("show");
  } finally {
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Entrar';
    btn.disabled = false;
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById("register-btn");
  const errEl = document.getElementById("register-error");
  errEl.classList.remove("show");
  const username = document.getElementById("reg-username").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  if (!username || !email || !password) {
    errEl.textContent = "Preencha todos os campos.";
    errEl.classList.add("show");
    return;
  }
  if (password.length < 6) {
    errEl.textContent = "A senha deve ter no mínimo 6 caracteres.";
    errEl.classList.add("show");
    return;
  }
  btn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Criando conta...';
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password }),
    });
    if (!res.ok) {
      const msg = await parseErrorMessage(
        res,
        res.status === 409
          ? "Usuário ou e-mail já cadastrado."
          : res.status === 400
            ? "Dados inválidos. Verifique os campos."
            : "Erro ao criar conta. Tente novamente.",
      );
      throw new Error(msg);
    }
    showToast("Conta criada com sucesso! Faça login.", "success");
    switchAuthTab("login");
    document.getElementById("login-username").value = username;
    document.getElementById("reg-username").value = "";
    document.getElementById("reg-email").value = "";
    document.getElementById("reg-password").value = "";
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add("show");
  } finally {
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> Criar conta';
    btn.disabled = false;
  }
}

async function fetchCurrentUser() {
  const res = await apiRequest("/users/me");
  if (!res.ok) throw new Error();
  const user = await res.json();
  console.log(user);

  if (!user || !user.userId) {
    throw new Error("Usuário inválido retornado pelo backend.");
  }

  state.user = user;
  localStorage.setItem("dc_user", JSON.stringify(user));
}

function enterAsGuest() {
  enterApp();
}

function enterApp() {
  showView("app");
  updateSidebarUser();
  if (state.user) {
    document.getElementById("logout-btn").style.display = "";
    document.getElementById("new-post-btn").style.opacity = "1";
    document.getElementById("new-post-btn").style.pointerEvents = "auto";
    document.getElementById("new-post-btn").title = "";
  } else {
    document.getElementById("logout-btn").style.display = "none";
    document.getElementById("new-post-btn").style.opacity = "0.5";
    document.getElementById("new-post-btn").style.pointerEvents = "auto"; // still clickable, will prompt login
    document.getElementById("new-post-btn").title = "Faça login para publicar";
  }
  showPage("home");
}

function handleLogout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("dc_token");
  localStorage.removeItem("dc_user");
  showView("auth");
  switchAuthTab("login");
}

function switchToAuth() {
  showView("auth");
}

function handleSidebarUserClick() {
  if (!state.user) {
    switchToAuth();
  } else {
    showPage("profile-own");
  }
}

function updateSidebarUser() {
  const u = state.user;
  const avatarEl = document.getElementById("sidebar-avatar");
  const nameEl = document.getElementById("sidebar-username");
  const emailEl = document.getElementById("sidebar-email-display");
  if (u) {
    nameEl.textContent = u.username;
    emailEl.textContent = u.email || "";
    if (u.pictureUrl) {
      avatarEl.innerHTML = `<img src="${esc(u.pictureUrl)}" alt="${esc(u.username)}">`;
    } else {
      avatarEl.textContent = u.username.charAt(0).toUpperCase();
    }
  } else {
    nameEl.textContent = "Visitante";
    emailEl.textContent = "Não autenticado";
    avatarEl.textContent = "?";
  }
}

// ─── SIDEBAR ───
function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  const sb = document.getElementById("sidebar");
  const mc = document.getElementById("main-content");
  sb.classList.toggle("collapsed", state.sidebarCollapsed);
  mc.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
}

// ─── FEED ───
async function loadFeed() {
  const container = document.getElementById("feed-container");
  container.innerHTML = `
    <div class="loading-skeleton">
      <div class="skel-header"><div class="skel skel-circle"></div><div class="skel-lines"><div class="skel" style="height:14px;width:60%"></div><div class="skel" style="height:11px;width:40%"></div></div></div>
      <div class="skel" style="height:18px;width:80%"></div>
      <div class="skel" style="height:12px;width:100%"></div>
      <div class="skel" style="height:12px;width:90%"></div>
    </div>
    <div class="loading-skeleton">
      <div class="skel-header"><div class="skel skel-circle"></div><div class="skel-lines"><div class="skel" style="height:14px;width:50%"></div><div class="skel" style="height:11px;width:35%"></div></div></div>
      <div class="skel" style="height:18px;width:70%"></div>
      <div class="skel" style="height:12px;width:100%"></div>
      <div class="skel" style="height:12px;width:75%"></div>
    </div>`;
  try {
    const res = await fetch(`${API}/posts`);
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    const data = await res.json();
    // Handle both array response and paginated response
    state.posts = Array.isArray(data) ? data : data.content || data.data || [];
    renderFeed(state.posts);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-feed">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>Não foi possível carregar o feed.<br><small style="font-size:.75rem;opacity:.7">${err.message}</small></p>
        <button class="btn-ghost" style="margin-top:16px;padding:9px 20px;font-size:.83rem" onclick="loadFeed()">Tentar novamente</button>
      </div>`;
  }
}

function renderFeed(posts) {
  const container = document.getElementById("feed-container");
  if (!posts.length) {
    container.innerHTML = `<div class="empty-feed"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>Nenhum post ainda. Seja o primeiro!</p></div>`;
    return;
  }
  container.innerHTML = posts.map((p) => renderPostCard(p)).join("");
}

function renderPostCard(p) {
  const isOwn =
    state.user &&
    (state.user.userId === p.userId || state.user.username === p.author);
  const initials = p.author ? p.author.charAt(0).toUpperCase() : "?";
  const avatarHtml = p.profileImgUrl
    ? `<img src="${esc(p.profileImgUrl)}" alt="${esc(p.authorId)}">`
    : initials;
  const timeStr = p.createdAt
    ? new Date(p.createdAt).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";
  const optionsMenu = isOwn
    ? `
    <div style="position:relative">
      <button class="post-options" onclick="toggleDropdown(event, 'dd-${p.postId}')">⋯</button>
      <div class="dropdown-menu" id="dd-${p.postId}">
        <div class="dropdown-item" onclick="openEditModal('${p.postId}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar
        </div>
        <div class="dropdown-item danger" onclick="deletePost('${p.postId})'">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Excluir
        </div>
      </div>
    </div>`
    : "";
  const imageHtml = p.imageUrl
    ? `<img src="${esc(p.imageUrl)}" alt="" class="post-image" onerror="this.style.display='none'">`
    : "";
  const contentPreview =
    esc((p.content || "").slice(0, 300)) +
    ((p.content || "").length > 300 ? "..." : "");
  return `
    <div class="post-card" id="pcard-'${p.postId}'">
      <div class="post-header">
        <div class="post-avatar" onclick="viewUserProfile(event, '${esc(p.author)}')" style="cursor:pointer" title="Ver perfil de ${esc(p.author)}">${avatarHtml}</div>
        <div class="post-meta">
          <div class="post-author" onclick="viewUserProfile(event, '${esc(p.author)}')" style="cursor:pointer">${esc(p.author) || "Usuário"}</div>
          <div class="post-time">${timeStr}</div>
        </div>
        ${optionsMenu}
      </div>
      ${p.title ? `<div class="post-title" onclick="openPost('${p.postId}')">${esc(p.title)}</div>` : ""}
      ${imageHtml}
      <div class="post-body" onclick="openPost('${p.postId}')">${contentPreview}</div>
      <div class="post-footer">
        <button class="post-action" onclick="openPost('${p.postId}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Comentários
        </button>
        <button class="post-action" onclick="openPost('${p.postId}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Ver post
        </button>
      </div>
    </div>`;
}

function filterFeed(q) {
  const lower = q.toLowerCase();
  const filtered = state.posts.filter(
    (p) =>
      (p.title || "").toLowerCase().includes(lower) ||
      (p.content || "").toLowerCase().includes(lower) ||
      (p.author || "").toLowerCase().includes(lower),
  );
  renderFeed(filtered);
}

function toggleDropdown(e, id) {
  e.stopPropagation();
  document.querySelectorAll(".dropdown-menu.open").forEach((m) => {
    if (m.id !== id) m.classList.remove("open");
  });
  document.getElementById(id).classList.toggle("open");
}
document.addEventListener("click", () =>
  document
    .querySelectorAll(".dropdown-menu.open")
    .forEach((m) => m.classList.remove("open")),
);

// ─── POST DETAIL ───
async function openPost(id) {
  state.currentPostId = id;
  showPage("post");
  const container = document.getElementById("post-detail-container");
  const commentsContainer = document.getElementById("comments-container");
  container.innerHTML = `<div class="loading-skeleton"><div class="skel" style="height:28px;width:70%;margin-bottom:16px"></div><div class="skel" style="height:13px;width:100%"></div><div class="skel" style="height:13px;width:90%"></div><div class="skel" style="height:13px;width:80%"></div></div>`;
  commentsContainer.innerHTML = "";
  try {
    const postRes = await fetch(`${API}/posts/${id}`);
    if (!postRes.ok)
      throw new Error(`Não foi possível carregar o post (${postRes.status}).`);
    const post = await postRes.json();

    const commentsRes = await fetch(`${API}/comments?post=${id}`);
    const commentsRaw = commentsRes.ok ? await commentsRes.json() : [];
    const comments = Array.isArray(commentsRaw)
      ? commentsRaw
      : commentsRaw.content || [];

    const isOwn =
      state.user &&
      (state.user.userId === post.userId ||
        state.user.username === post.author);
    const imgHtml = post.imageUrl
      ? `<img src="${esc(post.imageUrl)}" alt="" class="post-image" onerror="this.style.display='none'">`
      : "";
    const avatarInit = (post.author || "?").charAt(0).toUpperCase();
    container.innerHTML = `
      <div class="post-detail-card">
        <div class="post-header" style="margin-bottom:20px">
          <div class="post-avatar" onclick="viewUserProfile(event,'${esc(post.author)}')" style="cursor:pointer">${post.profileImgUrl ? `<img src="${esc(post.profileImgUrl)}">` : avatarInit}</div>
          <div class="post-meta">
            <div class="post-author" onclick="viewUserProfile(event,'${esc(post.author)}')" style="cursor:pointer">${esc(post.author) || "Usuário"}</div>
            <div class="post-time">${post.createdAt ? new Date(post.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : ""}</div>
          </div>
          ${
            isOwn
              ? `<div style="display:flex;gap:8px">
            <button class="btn-ghost" style="padding:8px 14px;font-size:.8rem" onclick="openEditModal('${post.postId}')">Editar</button>
            <button class="btn-danger" onclick="deletePost(${post.id})">Excluir</button>
          </div>`
              : ""
          }
        </div>
        ${post.title ? `<div class="post-detail-title">${esc(post.title)}</div>` : ""}
        ${imgHtml}
        <div class="post-detail-body">${esc(post.content || "")}</div>
      </div>`;

    const authPrompt = !state.user
      ? `<div style="background:var(--navy-ghost);border-radius:var(--radius-md);padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:12px"><span style="font-size:.85rem;color:var(--text-secondary)">Faça login para comentar</span><button class="btn-primary" style="padding:8px 16px;font-size:.8rem;white-space:nowrap" onclick="switchToAuth()">Entrar</button></div>`
      : "";
    const commentFormHtml = state.user
      ? `
      <div class="comment-form">
        <textarea class="comment-input" id="main-comment-input" placeholder="Escreva um comentário..."></textarea>
        <div class="comment-form-footer">
          <button class="btn-primary" style="padding:9px 18px;font-size:.83rem" id="submit-comment-btn" onclick="submitComment()">Comentar</button>
        </div>
      </div>`
      : authPrompt;

    commentsContainer.innerHTML = `
      <h3>${comments.length} Comentário${comments.length !== 1 ? "s" : ""}</h3>
      ${commentFormHtml}
      <div id="comments-list"></div>`;
    renderComments(comments);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-feed">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>${err.message}</p>
        <button class="btn-ghost" style="margin-top:16px;padding:9px 20px;font-size:.83rem" onclick="openPost(${id})">Tentar novamente</button>
      </div>`;
  }
}

async function renderComments(comments) {
  const list = document.getElementById("comments-list");
  if (!list) return;
  if (!comments.length) {
    list.innerHTML = `<div class="empty-feed" style="padding:32px"><p>Sem comentários ainda.</p></div>`;
    return;
  }
  // Fetch replies for each comment concurrently
  const withReplies = await Promise.all(
    comments.map(async (c) => {
      try {
        const r = await fetch(`${API}/comments/${c.id}/replies`);
        if (!r.ok) return { ...c, replies: [] };
        const raw = await r.json();
        return { ...c, replies: Array.isArray(raw) ? raw : raw.content || [] };
      } catch {
        return { ...c, replies: [] };
      }
    }),
  );
  list.innerHTML = withReplies.map((c) => renderCommentCard(c)).join("");
}

function renderCommentCard(c) {
  const isOwn =
    state.user &&
    (state.user.userId === c.userId || state.user.username === c.author);
  const initials = (c.author || "?").charAt(0).toUpperCase();
  const avatarHtml = c.authorPicture
    ? `<img src="${esc(c.authorPicture)}">`
    : initials;
  const repliesHtml = (c.replies || [])
    .map((r) => {
      const ri = (r.author || "?").charAt(0).toUpperCase();
      const ra = r.authorPicture ? `<img src="${esc(r.authorPicture)}">` : ri;
      const isOwnR =
        state.user &&
        (state.user.username === r.author || state.user.userId === r.userId);
      return `<div class="reply-card">
      <div class="comment-header">
        <div class="comment-avatar">${ra}</div>
        <div><div class="comment-author">${esc(r.author) || "Usuário"}</div><div class="comment-time">${r.createdAt ? new Date(r.createdAt).toLocaleDateString("pt-BR") : ""}</div></div>
        ${isOwnR ? `<button class="btn-danger" style="margin-left:auto;padding:5px 10px;font-size:.72rem" onclick="deleteComment(${r.id})">Excluir</button>` : ""}
      </div>
      <div class="comment-body">${esc(r.content)}</div>
    </div>`;
    })
    .join("");
  const replyBtn = state.user
    ? `<button class="comment-reply-btn" onclick="toggleReplyForm(${c.id})">↩ Responder</button>`
    : "";
  const replyForm = state.user
    ? `
    <div class="reply-form" id="reply-form-${c.id}" style="display:none">
      <textarea class="reply-input" id="reply-input-${c.id}" placeholder="Escreva uma resposta..."></textarea>
      <div class="reply-form-footer">
        <button class="btn-ghost" style="padding:7px 14px;font-size:.8rem" onclick="toggleReplyForm(${c.id})">Cancelar</button>
        <button class="btn-primary" style="padding:7px 14px;font-size:.8rem" onclick="submitReply(${c.id})">Responder</button>
      </div>
    </div>`
    : "";
  // Fix: check length, not truthiness of string (empty string is still truthy!)
  const repliesContainer =
    repliesHtml.length > 0
      ? `<div class="replies-container">${repliesHtml}</div>`
      : "";
  return `
    <div class="comment-card" id="comment-${c.id}">
      <div class="comment-header">
        <div class="comment-avatar">${avatarHtml}</div>
        <div style="flex:1"><div class="comment-author">${esc(c.author) || "Usuário"}</div><div class="comment-time">${c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR") : ""}</div></div>
        ${isOwn ? `<button class="btn-danger" style="padding:5px 10px;font-size:.72rem" onclick="deleteComment(${c.id})">Excluir</button>` : ""}
      </div>
      <div class="comment-body">${esc(c.content)}</div>
      ${replyBtn}
      ${replyForm}
      ${repliesContainer}
    </div>`;
}

function toggleReplyForm(id) {
  const f = document.getElementById(`reply-form-${id}`);
  f.style.display = f.style.display === "none" ? "block" : "none";
}

async function submitComment() {
  if (!state.user) return;
  const btn = document.getElementById("submit-comment-btn");
  const input = document.getElementById("main-comment-input");
  const content = input.value.trim();
  if (!content) {
    showToast("Escreva algo antes de comentar.", "info");
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Publicando...";
  }
  try {
    const res = await apiRequest("/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, postId: state.currentPostId }),
    });
    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Erro ao publicar comentário.");
      throw new Error(msg);
    }
    input.value = "";
    showToast("Comentário publicado!", "success");
    const commentsRes = await fetch(
      `${API}/comments?post=${state.currentPostId}`,
    );
    const raw = commentsRes.ok ? await commentsRes.json() : [];
    renderComments(Array.isArray(raw) ? raw : raw.content || []);
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Comentar";
    }
  }
}

async function submitReply(commentId) {
  if (!state.user) return;
  const input = document.getElementById(`reply-input-${commentId}`);
  const content = input.value.trim();
  if (!content) {
    showToast("Escreva algo antes de responder.", "info");
    return;
  }
  try {
    const res = await apiRequest("/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        postId: state.currentPostId,
        parentCommentId: commentId,
      }),
    });
    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Erro ao publicar resposta.");
      throw new Error(msg);
    }
    input.value = "";
    toggleReplyForm(commentId);
    showToast("Resposta publicada!", "success");
    const commentsRes2 = await fetch(
      `${API}/comments?post=${state.currentPostId}`,
    );
    const raw2 = commentsRes2.ok ? await commentsRes2.json() : [];
    renderComments(Array.isArray(raw2) ? raw2 : raw2.content || []);
  } catch (err) {
    showToast(err.message || "Erro ao publicar resposta.", "error");
  }
}

async function deleteComment(id) {
  if (!state.user) return;
  if (!confirm("Excluir este comentário?")) return;
  try {
    const res = await apiRequest(`/comments/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Erro ao excluir comentário.");
      throw new Error(msg);
    }
    showToast("Comentário excluído.", "success");
    const commentsRes = await fetch(
      `${API}/comments?post=${state.currentPostId}`,
    );
    const raw = commentsRes.ok ? await commentsRes.json() : [];
    renderComments(Array.isArray(raw) ? raw : raw.content || []);
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ─── NEW POST ───
function openNewPostModal() {
  if (!state.user) {
    showToast("Faça login para publicar.", "info");
    switchToAuth();
    return;
  }
  document.getElementById("new-post-overlay").classList.add("open");
}
function closeNewPostModal(e) {
  if (e.target === document.getElementById("new-post-overlay"))
    closeNewPostModalDirect();
}
function closeNewPostModalDirect() {
  document.getElementById("new-post-overlay").classList.remove("open");
  document.getElementById("new-post-title").value = "";
  document.getElementById("new-post-content").value = "";
  document.getElementById("post-error").classList.remove("show");
  state.selectedPostImage = null;
  document.getElementById("upload-label").textContent =
    "Clique para selecionar uma imagem";
  document.getElementById("post-image-input").value = "";
}
function handleFileSelect(input) {
  if (input.files[0]) {
    state.selectedPostImage = input.files[0];
    document.getElementById("upload-label").textContent =
      "✓ " + input.files[0].name;
  }
}
async function submitNewPost() {
  const content = document.getElementById("new-post-content").value.trim();
  const errEl = document.getElementById("post-error");
  errEl.classList.remove("show");
  if (!content) {
    errEl.textContent = "O conteúdo é obrigatório.";
    errEl.classList.add("show");
    return;
  }
  const submitBtn = document.querySelector("#new-post-overlay .btn-primary");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Publicando...";
  }
  try {
    const fd = new FormData();

    const payload = {
      content: content,
    };

    fd.append(
      "data",
      new Blob([JSON.stringify(payload)], { type: "application/json" }),
    );

    if (state.selectedPostImage) {
      fd.append("file", state.selectedPostImage);
    }

    const res = await apiRequest("/posts", {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const msg = await parseErrorMessage(
        res,
        "Erro ao publicar post. Tente novamente.",
      );
      throw new Error(msg);
    }
    closeNewPostModalDirect();
    showToast("Post publicado com sucesso!", "success");
    showPage("home");
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add("show");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Publicar';
    }
  }
}

// ─── EDIT POST ──
async function openEditModal(id) {
  // Try to find in state first, fallback to API
  let post = state.posts.find((p) => p.id === id);
  if (!post) {
    try {
      const res = await fetch(`${API}/posts/${id}`);
      if (res.ok) post = await res.json();
    } catch {}
  }
  if (!post) {
    showToast("Post não encontrado.", "error");
    return;
  }
  document.getElementById("edit-post-id").value = id;
  document.getElementById("edit-post-content").value = post.content || "";
  document.getElementById("edit-post-error").classList.remove("show");
  document.getElementById("edit-post-overlay").classList.add("open");
}
function closeEditModal(e) {
  if (e.target === document.getElementById("edit-post-overlay"))
    closeEditModalDirect();
}
function closeEditModalDirect() {
  document.getElementById("edit-post-overlay").classList.remove("open");
}
async function submitEditPost() {
  const id = document.getElementById("edit-post-id").value;
  const content = document.getElementById("edit-post-content").value.trim();
  const errEl = document.getElementById("edit-post-error");

  errEl.classList.remove("show");

  if (!content) {
    errEl.textContent = "O conteúdo é obrigatório.";
    errEl.classList.add("show");
    return;
  }

  const saveBtn = document.querySelector("#edit-post-overlay .btn-primary");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Salvando...";
  }

  try {
    const fd = new FormData();

    // JSON como application/json
    fd.append(
      "data",
      new Blob([JSON.stringify({ content: content })], {
        type: "application/json",
      }),
    );

    // imagem opcional (mesmo padrão do create)
    if (state.selectedPostImage) {
      fd.append("file", state.selectedPostImage);
    }

    const res = await apiRequest(`/posts/${id}`, {
      method: "PUT",
      body: fd,
    });

    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Erro ao editar post.");
      throw new Error(msg);
    }

    closeEditModalDirect();
    showToast("Post atualizado!", "success");

    if (document.getElementById("page-post").classList.contains("active")) {
      openPost(id);
    } else {
      loadFeed();
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add("show");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Salvar";
    }
  }
}

async function deletePost(id) {
  if (!confirm("Excluir este post permanentemente?")) return;
  try {
    const res = await apiRequest(`/posts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Erro ao excluir post.");
      throw new Error(msg);
    }
    showToast("Post excluído com sucesso.", "success");
    showPage("home");
  } catch (err) {
    showToast(err.message, "error");
  }
}

function handleEditPostImage(event) {
  const file = event.target.files[0] || null;
  state.selectedPostImage = file;
}

// ─── PROFILE ───
async function loadProfile(userId, isOwn) {
  console.log("LOAD PROFILE USER ID:", userId);
  const container = document.getElementById("profile-content");
  container.innerHTML = `
    <div class="loading-skeleton" style="margin-bottom:20px">
      <div class="skel-header"><div class="skel skel-circle" style="width:88px;height:88px"></div>
      <div class="skel-lines"><div class="skel" style="height:22px;width:40%"></div><div class="skel" style="height:14px;width:25%"></div><div class="skel" style="height:14px;width:20%"></div></div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
      ${[1, 2, 3, 4, 5, 6].map(() => `<div class="skel" style="aspect-ratio:1;border-radius:14px"></div>`).join("")}
    </div>`;
  try {
    let user;

    if (isOwn) {
      const meRes = await apiRequest("/users/me");
      if (!meRes.ok) throw new Error("Erro ao carregar perfil.");
      user = await meRes.json();
    } else {
      const userRes = await fetch(`${API}/users/${userId}`);
      if (!userRes.ok)
        throw new Error(
          `Não foi possível carregar o perfil (${userRes.status}).`,
        );
      user = await userRes.json();
    }

    // Fetch all posts and filter by author
    const allPostsRes = await fetch(`${API}/posts`);
    const allPostsRaw = allPostsRes.ok ? await allPostsRes.json() : [];
    const allPosts = Array.isArray(allPostsRaw)
      ? allPostsRaw
      : allPostsRaw.content || [];
    const userPosts = allPosts.filter(
      (p) => p.author === user.username || p.userId === userId,
    );

    const initials = (user.username || "?").charAt(0).toUpperCase();
    const avatarHtml = user.pictureUrl
      ? `<img src="${user.pictureUrl}" alt="${user.username}">`
      : initials;
    const avatarEditBtn = isOwn
      ? `<div class="profile-avatar-edit" onclick="openEditProfileModal()" title="Alterar foto">✎</div>`
      : "";
    const editBtns = isOwn
      ? `
      <div class="profile-actions">
        <button class="btn-primary" style="padding:9px 20px;font-size:.83rem" onclick="openEditProfileModal()">Editar perfil</button>
        <button class="btn-ghost" style="padding:9px 20px;font-size:.83rem" onclick="handleLogout()">Sair</button>
      </div>`
      : "";

    container.innerHTML = `
      <div class="profile-header-card">
        <div class="profile-avatar-wrap">
          <div class="profile-avatar">${avatarHtml}</div>
          ${avatarEditBtn}
        </div>
        <div class="profile-info">
          <div class="profile-name">${user.username}</div>
          <div class="profile-handle">${user.email || ""}</div>
          <div class="profile-stats">
            <div class="profile-stat">
              <div class="profile-stat-num">${userPosts.length}</div>
              <div class="profile-stat-label">Posts</div>
            </div>
          </div>
          ${editBtns}
        </div>
      </div>
      <div class="profile-section-title">Posts <span>${userPosts.length}</span></div>
      <div class="profile-grid" id="profile-posts-grid"></div>`;

    const grid = document.getElementById("profile-posts-grid");
    if (!userPosts.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--text-muted);font-size:.88rem">Nenhum post publicado ainda.</div>`;
    } else {
      grid.innerHTML = userPosts
        .map((p) => {
          if (p.imageUrl) {
            return `<div class="profile-grid-item" onclick="openPostFromProfile(${p.id})" title="${p.title || ""}">
            <img src="${p.imageUrl}" alt="" onerror="this.style.display='none'">
            <div class="profile-grid-item-content"><div class="profile-grid-item-title">${p.title || ""}</div></div>
          </div>`;
          }
          return `<div class="profile-grid-item" onclick="openPostFromProfile(${p.id})" style="background:var(--navy-ghost)" title="${p.title || ""}">
          <div class="profile-grid-item-text"><p>${p.title || p.content || ""}</p></div>
        </div>`;
        })
        .join("");
    }
  } catch (err) {
    container.innerHTML = `
      <div class="empty-feed">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>${err.message}</p>
        <button class="btn-ghost" style="margin-top:16px;padding:9px 20px;font-size:.83rem" onclick="loadProfile(${userId},${isOwn})">Tentar novamente</button>
      </div>`;
  }
}

function openPostFromProfile(id) {
  state.currentPostId = id;
  showPage("post"); // must come before openPost so the DOM containers exist
  openPost(id);
}

async function viewUserProfile(e, username) {
  e.stopPropagation();
  try {
    const res = await fetch(`${API}/users`);
    if (!res.ok) throw new Error();
    const raw = await res.json();
    const users = Array.isArray(raw) ? raw : raw.content || [];
    const found = users.find((u) => u.username === username);
    if (!found) {
      showToast("Usuário não encontrado.", "error");
      return;
    }
    const isOwn = state.user && state.user.username === username;
    state.profileUserId = found.id;
    if (isOwn) showPage("profile-own");
    else showPage("profile-other");
  } catch {
    showToast("Erro ao carregar perfil.", "error");
  }
}

// ─── EDIT PROFILE ───
function openEditProfileModal() {
  if (!state.user) return;
  document.getElementById("edit-username").value = state.user.username || "";
  document.getElementById("edit-email").value = state.user.email || "";
  document.getElementById("edit-password").value = "";
  document.getElementById("edit-profile-error").classList.remove("show");
  state.selectedProfilePic = null;
  document.getElementById("profile-upload-label").textContent =
    "Clique para selecionar uma foto";
  document.getElementById("profile-pic-input").value = "";
  document.getElementById("edit-profile-overlay").classList.add("open");
}
function closeEditProfileModal(e) {
  if (e.target === document.getElementById("edit-profile-overlay"))
    closeEditProfileModalDirect();
}
function closeEditProfileModalDirect() {
  document.getElementById("edit-profile-overlay").classList.remove("open");
}
function handleProfilePicSelect(input) {
  if (input.files[0]) {
    state.selectedProfilePic = input.files[0];
    document.getElementById("profile-upload-label").textContent =
      "✓ " + input.files[0].name;
  }
}
async function submitEditProfile() {
  const username = document.getElementById("edit-username").value.trim();
  const email = document.getElementById("edit-email").value.trim();
  const password = document.getElementById("edit-password").value;
  const errEl = document.getElementById("edit-profile-error");

  errEl.classList.remove("show");

  if (!username || !email) {
    errEl.textContent = "Usuário e email são obrigatórios.";
    errEl.classList.add("show");
    return;
  }

  const saveBtn = document.querySelector("#edit-profile-modal .btn-primary");

  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Salvando...";
    }

    await fetchCurrentUser();

    const userId = state.user?.userId;
    if (!userId) {
      throw new Error("Usuário inválido.");
    }

    const body = { username, email };
    if (password) body.password = password;

    const res = await apiRequest(`/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const msg = await parseErrorMessage(res, "Erro ao atualizar perfil.");
      throw new Error(msg);
    }

    if (state.selectedProfilePic) {
      const fd = new FormData();
      fd.append("file", state.selectedProfilePic);

      const picRes = await apiRequest(`/users/${userId}/pictures`, {
        method: "PUT",
        body: fd,
      });

      if (!picRes.ok) {
        showToast("Perfil salvo, mas houve erro ao enviar a foto.", "info");
      }
    }

    await fetchCurrentUser();

    updateSidebarUser();
    closeEditProfileModalDirect();
    showToast("Perfil atualizado com sucesso!", "success");

    loadProfile(userId, true);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add("show");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Salvar";
    }
  }
}
// ─── TOAST ───
function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  const icons = {
    success: "✓",
    error: "✕",
    info: "ℹ",
  };
  t.innerHTML = `<span style="font-weight:700;color:${type === "success" ? "#16a34a" : type === "error" ? "#dc2626" : "var(--navy)"}">${icons[type]}</span> ${msg}`;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateX(20px)";
    t.style.transition = "all 0.3s";
    setTimeout(() => t.remove(), 300);
  }, 3000);
}
