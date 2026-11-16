
const $ = (selector) => document.querySelector(selector);

let currentUser = null;
let allPosts = [];
let viewingProfileId = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.hidden = true, 3000);
}

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function formBody(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function showAuth() {
  $("#auth").hidden = false;
  $("#app").hidden = true;
  document.querySelector(".fb-navbar").style.display = "none";
}

function showApp(user) {
  currentUser = user;
  $("#auth").hidden = true;
  $("#app").hidden = false;
  document.querySelector(".fb-navbar").style.display = "flex";

  $("#topUser").textContent = user.name;
  $("#topAvatar").textContent = user.name.charAt(0).toUpperCase();

  openPage("home");
  loadPosts();
}

function setAuthTab(tab) {
  const login = tab === "login";
  $("#loginForm").hidden = !login;
  $("#registerForm").hidden = login;
  $("#loginTab").classList.toggle("active", login);
  $("#registerTab").classList.toggle("active", !login);
  $("#authMessage").textContent = "";
}

$("#loginTab").addEventListener("click", () => setAuthTab("login"));
$("#registerTab").addEventListener("click", () => setAuthTab("register"));

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const result = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formBody(event.target))
    });

    showApp(result.user);
    toast("Welcome back!");
  } catch (error) {
    $("#authMessage").textContent = error.message;
  }
});

$("#registerForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const result = await api("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formBody(event.target))
    });

    showApp(result.user);
    toast("Account created successfully!");
  } catch (error) {
    $("#authMessage").textContent = error.message;
  }
});

$("#logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
    currentUser = null;
    showAuth();
    toast("Logged out.");
  } catch (error) {
    toast(error.message);
  }
});

// Navigation
function openPage(page) {
  const pages = {
    home: "homePage",
    friends: "friendsPage",
    requests: "requestsPage",
    profile: "profilePage",
    watch: "watchPage",
    search: "searchPage"
  };

  Object.values(pages).forEach(id => {
    $("#" + id).hidden = true;
  });

  const target = pages[page] || pages.home;
  $("#" + target).hidden = false;

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  if (page === "friends") loadFriends();
  if (page === "requests") loadRequests();
  if (page === "profile") loadProfile(currentUser.id);
  if (page === "watch") loadVideos();
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;

    if (page === "profile") {
      openPage("profile");
    } else {
      openPage(page);
    }
  });
});

// File names
function updateFileName() {
  const image = $("#postImage").files[0];
  const video = $("#postVideo").files[0];

  $("#fileName").textContent = [
    image ? image.name : "",
    video ? video.name : ""
  ].filter(Boolean).join(" | ");
}

$("#postImage").addEventListener("change", () => {
  if ($("#postImage").files.length) $("#postVideo").value = "";
  updateFileName();
});

$("#postVideo").addEventListener("change", () => {
  if ($("#postVideo").files.length) $("#postImage").value = "";
  updateFileName();
});

// Post type
$("#postType").addEventListener("change", () => {
  const type = $("#postType").value;
  $("#extra").placeholder = type === "link"
    ? "Enter a link beginning with https://"
    : type === "poll"
      ? "Enter poll options"
      : type === "feeling"
        ? "How are you feeling?"
        : "Optional details";
});

// Create post
$("#postForm").addEventListener("submit", async event => {
  event.preventDefault();

  const image = $("#postImage").files[0];
  const video = $("#postVideo").files[0];

  if (image && image.size > 5 * 1024 * 1024) {
    return toast("Photo must be 5 MB or smaller.");
  }

  if (video && video.size > 50 * 1024 * 1024) {
    return toast("Video must be 50 MB or smaller.");
  }

  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const data = new FormData(event.target);

    await api("/api/posts", {
      method: "POST",
      body: data
    });

    event.target.reset();
    $("#fileName").textContent = "";
    $("#postMessage").textContent = "";
    await loadPosts();
    toast("Post published!");
  } catch (error) {
    $("#postMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

// Render post
function renderPost(post) {
  const media = post.image
    ? `<img class="post-image" src="${esc(post.image)}" alt="Post photo" loading="lazy">`
    : post.video
      ? `<video class="post-video" controls preload="metadata"><source src="${esc(post.video)}"></video>`
      : "";

  const extra = post.extra
    ? post.type === "link"
      ? `<p><a href="${esc(post.extra)}" target="_blank" rel="noopener noreferrer">Open link</a></p>`
      : `<p class="post-extra">${esc(post.extra)}</p>`
    : "";

  return `
    <article class="card post-card" data-post-id="${post.id}">
      <div class="post-header">
        <div class="avatar-md">${esc(post.name.charAt(0).toUpperCase())}</div>
        <div>
          <button class="profile-link" data-user-id="${post.user_id}">${esc(post.name)}</button>
          <small>${esc(post.created_at || "")}</small>
        </div>
      </div>

      ${post.body ? `<p class="post-body">${esc(post.body)}</p>` : ""}
      ${extra}
      ${media}

      <div class="post-stats">
        <span>${post.like_count || 0} Likes</span>
        <span>${post.comment_count || 0} Comments</span>
        <span>${post.share_count || 0} Shares</span>
      </div>

      <div class="post-actions">
        <button data-action="like" class="${post.liked ? "liked" : ""}">
          ${post.liked ? "Liked" : "Like"}
        </button>
        <button data-action="comment">Comment</button>
        <button data-action="share">Share</button>
      </div>

      <div class="comment-area" hidden>
        <div class="comment-list"></div>
        <form class="comment-form">
          <input name="body" placeholder="Write a comment..." maxlength="1000" required>
          <button type="submit">Send</button>
        </form>
      </div>
    </article>
  `;
}

async function loadPosts() {
  try {
    const result = await api("/api/posts");
    allPosts = result.posts || [];
    $("#posts").innerHTML = allPosts.length
      ? allPosts.map(renderPost).join("")
      : `<div class="card empty-state">No posts yet. Be the first to share something!</div>`;
  } catch (error) {
    toast(error.message);
  }
}

// Post buttons
document.addEventListener("click", async event => {
  const profileButton = event.target.closest("[data-user-id]");

  if (profileButton) {
    loadProfile(Number(profileButton.dataset.userId));
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const card = actionButton.closest("[data-post-id]");
  if (!card) return;

  const postId = card.dataset.postId;
  const action = actionButton.dataset.action;

  try {
    if (action === "like") {
      await api(`/api/posts/${postId}/like`, { method: "POST" });
      await loadPosts();
      if (viewingProfileId) await loadProfile(viewingProfileId);
    }

    if (action === "comment") {
      const area = card.querySelector(".comment-area");
      area.hidden = !area.hidden;

      if (!area.hidden) {
        const result = await api(`/api/posts/${postId}/comments`);
        card.querySelector(".comment-list").innerHTML =
          result.comments.map(comment => `
            <div class="comment-item">
              <strong>${esc(comment.name)}</strong>
              <span>${esc(comment.body)}</span>
            </div>
          `).join("");
      }
    }

    if (action === "share") {
      await api(`/api/posts/${postId}/share`, { method: "POST" });
      toast("Post shared!");
      await loadPosts();
    }
  } catch (error) {
    toast(error.message);
  }
});

// Submit comment
document.addEventListener("submit", async event => {
  if (!event.target.matches(".comment-form")) return;

  event.preventDefault();

  const card = event.target.closest("[data-post-id]");
  const postId = card.dataset.postId;
  const body = event.target.elements.body.value.trim();

  if (!body) return;

  try {
    await api(`/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body })
    });

    event.target.reset();

    const result = await api(`/api/posts/${postId}/comments`);
    card.querySelector(".comment-list").innerHTML =
      result.comments.map(comment => `
        <div class="comment-item">
          <strong>${esc(comment.name)}</strong>
          <span>${esc(comment.body)}</span>
        </div>
      `).join("");

    await loadPosts();
    toast("Comment added.");
  } catch (error) {
    toast(error.message);
  }
});

// Friends
async function loadFriends() {
  try {
    const result = await api("/api/friends");

    $("#friendsList").innerHTML = result.friends.length
      ? result.friends.map(friend => `
        <div class="person-row">
          <div class="avatar-md">${esc(friend.name[0])}</div>
          <strong>${esc(friend.name)}</strong>
          <button data-open-profile="${friend.id}">Profile</button>
          <button data-unfriend="${friend.id}" class="secondary-btn">Unfriend</button>
        </div>
      `).join("")
      : `<p>You have no friends yet. Search for people to connect.</p>`;
  } catch (error) {
    toast(error.message);
  }
}

// Friend requests
async function loadRequests() {
  try {
    const result = await api("/api/friends/requests");

    $("#incomingRequests").innerHTML = result.incoming.length
      ? result.incoming.map(user => `
        <div class="person-row">
          <strong>${esc(user.name)}</strong>
          <button data-accept="${user.id}" class="primary-btn">Accept</button>
          <button data-reject="${user.id}" class="secondary-btn">Reject</button>
        </div>
      `).join("")
      : "<p>No incoming requests.</p>";

    $("#outgoingRequests").innerHTML = result.outgoing.length
      ? result.outgoing.map(user => `
        <div class="person-row">
          <strong>${esc(user.name)}</strong>
          <button data-reject="${user.id}" class="secondary-btn">Cancel</button>
        </div>
      `).join("")
      : "<p>No sent requests.</p>";
  } catch (error) {
    toast(error.message);
  }
}

document.addEventListener("click", async event => {
  const accept = event.target.closest("[data-accept]");
  const reject = event.target.closest("[data-reject]");
  const unfriend = event.target.closest("[data-unfriend]");
  const openProfile = event.target.closest("[data-open-profile]");

  try {
    if (accept) {
      await api(`/api/friends/accept/${accept.dataset.accept}`, { method: "POST" });
      toast("Friend request accepted.");
      loadRequests();
      loadFriends();
    }

    if (reject) {
      await api(`/api/friends/request/${reject.dataset.reject}`, { method: "DELETE" });
      toast("Request removed.");
      loadRequests();
    }

    if (unfriend) {
      await api(`/api/friends/${unfriend.dataset.unfriend}`, { method: "DELETE" });
      toast("Friend removed.");
      loadFriends();
    }

    if (openProfile) {
      loadProfile(Number(openProfile.dataset.openProfile));
    }
  } catch (error) {
    toast(error.message);
  }
});

// Profile
async function loadProfile(userId) {
  try {
    viewingProfileId = userId;
    const result = await api(`/api/users/${userId}`);
    const user = result.user;
    const ownProfile = user.id === currentUser.id;

    $("#profileName").textContent = user.name;
    $("#profileEmail").textContent = ownProfile ? user.email : "";
    $("#profileBio").textContent = user.bio || "No bio yet.";
    $("#profileAvatar").textContent = user.name[0].toUpperCase();

    $("#editProfileBox").hidden = !ownProfile;
    $("#editName").value = user.name;
    $("#editBio").value = user.bio || "";

    const friendship = result.friendship;
    let actionHTML = "";

    if (!ownProfile) {
      if (!friendship) {
        actionHTML = `<button class="primary-btn" data-add-friend="${user.id}">Add Friend</button>`;
      } else if (friendship.status === "accepted") {
        actionHTML = `<span class="friend-status">Friends</span>`;
      } else if (friendship.sender_id === currentUser.id) {
        actionHTML = `<span class="friend-status">Request Sent</span>`;
      } else {
        actionHTML = `<span class="friend-status">Request Received</span>`;
      }
    }

    $("#profileActions").innerHTML = actionHTML;

    $("#profilePosts").innerHTML = result.posts.length
      ? result.posts.map(renderPost).join("")
      : `<div class="card">No posts yet.</div>`;

    openPage("profile");
  } catch (error) {
    toast(error.message);
  }
}

// Add friend
document.addEventListener("click", async event => {
  const button = event.target.closest("[data-add-friend]");
  if (!button) return;

  try {
    await api(`/api/friends/request/${button.dataset.addFriend}`, { method: "POST" });
    toast("Friend request sent.");
    loadProfile(Number(button.dataset.addFriend));
  } catch (error) {
    toast(error.message);
  }
});

// Update profile
$("#profileForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const result = await api("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formBody(event.target))
    });

    currentUser = result.user;
    $("#topUser").textContent = currentUser.name;
    $("#topAvatar").textContent = currentUser.name[0].toUpperCase();
    toast("Profile updated.");
    loadProfile(currentUser.id);
  } catch (error) {
    $("#profileMessage").textContent = error.message;
  }
});

// Videos page
async function loadVideos() {
  try {
    const result = await api("/api/posts");
    const videos = result.posts.filter(post => post.video);

    $("#videoPosts").innerHTML = videos.length
      ? videos.map(renderPost).join("")
      : `<div class="card">No videos shared yet.</div>`;
  } catch (error) {
    toast(error.message);
  }
}

// Search people
let searchTimer;

$("#searchInput").addEventListener("input", event => {
  clearTimeout(searchTimer);

  const query = event.target.value.trim();

  if (!query) return;

  searchTimer = setTimeout(async () => {
    try {
      const result = await api(`/api/users/search?q=${encodeURIComponent(query)}`);

      $("#searchResults").innerHTML = result.users.length
        ? result.users.map(user => `
          <div class="person-row">
            <strong>${esc(user.name)}</strong>
            <button data-open-profile="${user.id}">View Profile</button>
          </div>
        `).join("")
        : "<p>No people found.</p>";

      openPage("search");
    } catch (error) {
      toast(error.message);
    }
  }, 400);
});

// Start application
async function startApp() {
  try {
    const result = await api("/api/me");

    if (result.user) {
      showApp(result.user);
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
}

startApp();
