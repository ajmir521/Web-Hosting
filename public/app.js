const $ = s => document.querySelector(s);
let currentUser = null;
let allPosts = [];
const auth = $("#auth"), app = $("#app");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => t.style.display = "none", 2400);
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function formBody(form) {
  return new URLSearchParams(new FormData(form));
}

function showApp(user) {
  currentUser = user;
  auth.hidden = true;
  app.hidden = false;
  $("#navUserPill").hidden = false;
  $("#logout").hidden = false;
  $("#welcomeName").textContent = user.name;
  $("#topUser").textContent = user.name;
  const initial = user.name.charAt(0).toUpperCase();
  $("#topAvatar").textContent = initial;
  $("#sidebarAvatar").textContent = initial;
  $("#postAvatar").textContent = initial;
  loadPosts();
}

function showAuth() {
  currentUser = null;
  auth.hidden = false;
  app.hidden = true;
  $("#navUserPill").hidden = true;
  $("#logout").hidden = true;
  $("#topUser").textContent = "";
}

document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === btn));
  $("#loginForm").hidden = btn.dataset.tab !== "login";
  $("#registerForm").hidden = btn.dataset.tab !== "register";
  $("#authMessage").textContent = "";
}));

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const d = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody(e.target)
    });
    showApp(d.user);
  } catch (err) {
    $("#authMessage").textContent = err.message;
  }
});

$("#registerForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const d = await api("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody(e.target)
    });
    showApp(d.user);
  } catch (err) {
    $("#authMessage").textContent = err.message;
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showAuth();
});

$("#postImage").addEventListener("change", e => {
  $("#fileName").textContent = e.target.files ? e.target.files.name : "";
});

$("#postForm").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("#postMessage");
  msg.textContent = "";
  try {
    const data = new FormData(e.target);
    await api("/api/posts", { method: "POST", body: data });
    e.target.reset();
    $("#fileName").textContent = "";
    msg.textContent = "";
    await loadPosts();
    toast("Your post has been published.");
  } catch (err) {
    msg.textContent = err.message;
  }
});

$("#postType").addEventListener("change", e => {
  $("#extra").placeholder = ({
    feeling: "How are you feeling or what are you doing?",
    link: "Paste a full link (https://...)",
    poll: "Add answer choices, separated by commas"
  })[e.target.value] || "Optional extra information";
});

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "'"
  }[c]));
}

function renderPosts(posts) {
  const host = $("#posts");
  if (!posts.length) {
    host.innerHTML = '<div class="post"><p class="muted">No posts found. Share something first!</p></div>';
    return;
  }
  host.innerHTML = posts.map(p => `<article class="post" data-id="${p.id}">
    <div class="post-head">
      <div class="mini-avatar">${esc(p.name.charAt(0).toUpperCase())}</div>
      <div>
        <strong>${esc(p.name)}</strong>
        <small>${esc(p.type)} post · ${new Date(p.created_at + "Z").toLocaleString()}</small>
      </div>
    </div>
    ${p.body ? `<div class="post-body">${esc(p.body)}</div>` : ""}
    ${p.extra ? `<div class="post-extra">${p.type === "link" ? `<a href="${esc(p.extra)}" target="_blank" rel="noopener noreferrer">${esc(p.extra)}</a>` : esc(p.extra)}</div>` : ""}
    ${p.image ? `<img src="${esc(p.image)}" alt="Post image">` : ""}
    <div class="post-actions">
      <button class="${p.liked ? "liked" : ""}" data-action="like">${p.liked ? "👍" : "👍"} ${p.likes} Like</button>
      <button data-action="comments">💬 ${p.comments} Comment</button>
    </div>
    <div class="comments" hidden>
      <div class="comment-list"></div>
      <form class="comment-form">
        <input name="body" placeholder="Write a comment..." maxlength="500" required>
        <button>Send</button>
      </form>
    </div>
  </article>`).join("");
}

async function loadPosts() {
  const { posts } = await api("/api/posts");
  allPosts = posts;
  renderPosts(allPosts);
}

$("#searchInput").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  const filtered = allPosts.filter(p =>
    (p.body && p.body.toLowerCase().includes(q)) ||
    (p.name && p.name.toLowerCase().includes(q))
  );
  renderPosts(filtered);
});

$("#posts").addEventListener("click", async e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const post = btn.closest(".post"), id = post.dataset.id;
  if (btn.dataset.action === "like") {
    try {
      await api(`/api/posts/${id}/like`, { method: "POST" });
      await loadPosts();
    } catch (err) {
      toast(err.message);
    }
  }
  if (btn.dataset.action === "comments") {
    const box = post.querySelector(".comments");
    box.hidden = !box.hidden;
    if (!box.hidden) {
      const d = await api(`/api/posts/${id}/comments`);
      box.querySelector(".comment-list").innerHTML = d.comments.map(c => `<div class="comment"><strong>${esc(c.name)}:</strong> ${esc(c.body)}</div>`).join("") || '<p class="muted">No comments yet.</p>';
    }
  }
});

$("#posts").addEventListener("submit", async e => {
  if (!e.target.matches(".comment-form")) return;
  e.preventDefault();
  const post = e.target.closest(".post");
  try {
    await api(`/api/posts/${post.dataset.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody(e.target)
    });
    const d = await api(`/api/posts/${post.dataset.id}/comments`);
    post.querySelector(".comment-list").innerHTML = d.comments.map(c => `<div class="comment"><strong>${esc(c.name)}:</strong> ${esc(c.body)}</div>`).join("");
    e.target.reset();
  } catch (err) {
    toast(err.message);
  }
});

(async () => {
  try {
    const d = await api("/api/me");
    if (d.user) showApp(d.user);
    else showAuth();
  } catch (_) {
    showAuth();
  }
})();
