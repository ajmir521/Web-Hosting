
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database("happylife.db");

app.set("trust proxy", 1);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Database tables
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  bio TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  body TEXT DEFAULT '',
  extra TEXT DEFAULT '',
  image TEXT DEFAULT '',
  video TEXT DEFAULT '',
  media_type TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, post_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  receiver_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sender_id, receiver_id)
);

CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Safe database migrations for existing databases
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(col => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing("users", "bio", "TEXT DEFAULT ''");
addColumnIfMissing("posts", "video", "TEXT DEFAULT ''");
addColumnIfMissing("posts", "media_type", "TEXT DEFAULT ''");

// Upload directory
const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName =
      Date.now() + "-" + Math.random().toString(36).slice(2) + ext;
    cb(null, safeName);
  }
});

const allowedTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/ogg"
];

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only JPG, PNG, WEBP, GIF, MP4, WEBM and OGG files are allowed."));
  }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/uploads", express.static(uploadDir));

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret-before-deployment",
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: "sessions.db",
    dir: __dirname
  }),
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

const getUser = id =>
  db.prepare("SELECT id, name, email, bio, created_at FROM users WHERE id = ?").get(id);

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in first." });
  }
  next();
}

function getPost(postId, userId) {
  return db.prepare(`
    SELECT
      p.*,
      u.name,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
      (SELECT COUNT(*) FROM shares WHERE post_id = p.id) AS share_count,
      EXISTS(
        SELECT 1 FROM likes
        WHERE post_id = p.id AND user_id = ?
      ) AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(userId, postId);
}

// Current user
app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({ user: getUser(req.session.userId) || null });
});

// Register
app.post("/api/register", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (name.length < 2 || name.length > 50) {
    return res.status(400).json({ error: "Name must be 2–50 characters." });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const passwordHash = bcrypt.hashSync(password, 12);
    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash)
      VALUES (?, ?, ?)
    `).run(name, email, passwordHash);

    req.session.userId = Number(result.lastInsertRowid);
    res.json({ user: getUser(req.session.userId) });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "This email is already registered." });
    }
    res.status(500).json({ error: "Registration failed." });
  }
});

// Login
app.post("/api/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  req.session.userId = user.id;
  res.json({ user: getUser(user.id) });
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// Home feed
app.get("/api/posts", requireAuth, (req, res) => {
  const posts = db.prepare(`
    SELECT
      p.*,
      u.name,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
      (SELECT COUNT(*) FROM shares WHERE post_id = p.id) AS share_count,
      EXISTS(
        SELECT 1 FROM likes
        WHERE post_id = p.id AND user_id = ?
      ) AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.id DESC
    LIMIT 100
  `).all(req.session.userId);

  res.json({ posts });
});

// Create text, photo or video post
app.post(
  "/api/posts",
  requireAuth,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 }
  ]),
  (req, res) => {
    const body = String(req.body.body || "").trim();
    const extra = String(req.body.extra || "").trim();
    const type = String(req.body.type || "text");

    const imageFile = req.files?.image?.[0];
    const videoFile = req.files?.video?.[0];

    if (imageFile && videoFile) {
      return res.status(400).json({ error: "Upload either a photo or a video, not both." });
    }

    const image = imageFile ? "/uploads/" + imageFile.filename : "";
    const video = videoFile ? "/uploads/" + videoFile.filename : "";
    const mediaType = image ? "image" : video ? "video" : "";

    if (!body && !image && !video) {
      return res.status(400).json({ error: "Write something or select a photo/video." });
    }

    if (!["text", "photo", "video", "feeling", "link", "poll"].includes(type)) {
      return res.status(400).json({ error: "Invalid post type." });
    }

    if (type === "link" && extra) {
      try {
        const url = new URL(extra);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        return res.status(400).json({ error: "Enter a valid link beginning with https:// or http://." });
      }
    }

    const result = db.prepare(`
      INSERT INTO posts (user_id, type, body, extra, image, video, media_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.session.userId, type, body, extra, image, video, mediaType);

    res.json({ post: getPost(Number(result.lastInsertRowid), req.session.userId) });
  }
);

// Like / unlike
app.post("/api/posts/:id/like", requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);

  if (!post) return res.status(404).json({ error: "Post not found." });

  const userId = req.session.userId;
  const existing = db.prepare(
    "SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?"
  ).get(userId, postId);

  if (existing) {
    db.prepare("DELETE FROM likes WHERE user_id = ? AND post_id = ?").run(userId, postId);
  } else {
    db.prepare("INSERT INTO likes (user_id, post_id) VALUES (?, ?)").run(userId, postId);
  }

  res.json({ post: getPost(postId, userId) });
});

// Get comments
app.get("/api/posts/:id/comments", requireAuth, (req, res) => {
  const comments = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.id AS user_id, u.name
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ?
    ORDER BY c.id ASC
  `).all(Number(req.params.id));

  res.json({ comments });
});

// Add comment
app.post("/api/posts/:id/comments", requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  const body = String(req.body.body || "").trim();

  if (!body || body.length > 1000) {
    return res.status(400).json({ error: "Comment must be 1–1000 characters." });
  }

  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) return res.status(404).json({ error: "Post not found." });

  const result = db.prepare(`
    INSERT INTO comments (user_id, post_id, body)
    VALUES (?, ?, ?)
  `).run(req.session.userId, postId, body);

  res.json({
    comment: db.prepare(`
      SELECT c.id, c.body, c.created_at, u.id AS user_id, u.name
      FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.id = ?
    `).get(Number(result.lastInsertRowid))
  });
});

// Share a post
app.post("/api/posts/:id/share", requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);

  if (!post) return res.status(404).json({ error: "Post not found." });

  db.prepare("INSERT INTO shares (user_id, post_id) VALUES (?, ?)")
    .run(req.session.userId, postId);

  res.json({ post: getPost(postId, req.session.userId) });
});

// User search
app.get("/api/users/search", requireAuth, (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 50);
  if (!q) return res.json({ users: [] });

  const users = db.prepare(`
    SELECT id, name, bio
    FROM users
    WHERE id != ? AND name LIKE ?
    ORDER BY name
    LIMIT 30
  `).all(req.session.userId, `%${q}%`);

  res.json({ users });
});

// View profile
app.get("/api/users/:id", requireAuth, (req, res) => {
  const userId = Number(req.params.id);
  const user = getUser(userId);

  if (!user) return res.status(404).json({ error: "User not found." });

  const friendship = db.prepare(`
    SELECT * FROM friend_requests
    WHERE (sender_id = ? AND receiver_id = ?)
       OR (sender_id = ? AND receiver_id = ?)
    LIMIT 1
  `).get(req.session.userId, userId, userId, req.session.userId);

  const posts = db.prepare(`
    SELECT
      p.*,
      u.name,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
      (SELECT COUNT(*) FROM shares WHERE post_id = p.id) AS share_count,
      EXISTS(
        SELECT 1 FROM likes
        WHERE post_id = p.id AND user_id = ?
      ) AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ?
    ORDER BY p.id DESC
    LIMIT 100
  `).all(req.session.userId, userId);

  res.json({
    user,
    friendship: friendship || null,
    posts
  });
});

// Update own profile
app.patch("/api/profile", requireAuth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const bio = String(req.body.bio || "").trim();

  if (name.length < 2 || name.length > 50) {
    return res.status(400).json({ error: "Name must be 2–50 characters." });
  }

  if (bio.length > 300) {
    return res.status(400).json({ error: "Bio must be 300 characters or fewer." });
  }

  db.prepare("UPDATE users SET name = ?, bio = ? WHERE id = ?")
    .run(name, bio, req.session.userId);

  res.json({ user: getUser(req.session.userId) });
});

// Send friend request
app.post("/api/friends/request/:id", requireAuth, (req, res) => {
  const receiverId = Number(req.params.id);
  const senderId = req.session.userId;

  if (!Number.isInteger(receiverId) || receiverId === senderId) {
    return res.status(400).json({ error: "Invalid friend request." });
  }

  if (!getUser(receiverId)) {
    return res.status(404).json({ error: "User not found." });
  }

  const existing = db.prepare(`
    SELECT * FROM friend_requests
    WHERE (sender_id = ? AND receiver_id = ?)
       OR (sender_id = ? AND receiver_id = ?)
  `).get(senderId, receiverId, receiverId, senderId);

  if (existing) {
    return res.status(409).json({ error: "A friend request or friendship already exists." });
  }

  db.prepare(`
    INSERT INTO friend_requests (sender_id, receiver_id)
    VALUES (?, ?)
  `).run(senderId, receiverId);

  res.json({ success: true });
});

// Incoming and outgoing requests
app.get("/api/friends/requests", requireAuth, (req, res) => {
  const userId = req.session.userId;

  const incoming = db.prepare(`
    SELECT fr.id, fr.created_at, u.id AS user_id, u.name
    FROM friend_requests fr
    JOIN users u ON u.id = fr.sender_id
    WHERE fr.receiver_id = ? AND fr.status = 'pending'
    ORDER BY fr.id DESC
  `).all(userId);

  const outgoing = db.prepare(`
    SELECT fr.id, fr.created_at, u.id AS user_id, u.name
    FROM friend_requests fr
    JOIN users u ON u.id = fr.receiver_id
    WHERE fr.sender_id = ? AND fr.status = 'pending'
    ORDER BY fr.id DESC
  `).all(userId);

  res.json({ incoming, outgoing });
});

// Accept a request
app.post("/api/friends/accept/:id", requireAuth, (req, res) => {
  const requestId = Number(req.params.id);

  const result = db.prepare(`
    UPDATE friend_requests
    SET status = 'accepted'
    WHERE id = ? AND receiver_id = ? AND status = 'pending'
  `).run(requestId, req.session.userId);

  if (!result.changes) {
    return res.status(404).json({ error: "Friend request not found." });
  }

  res.json({ success: true });
});

// Reject or cancel a request
app.delete("/api/friends/request/:id", requireAuth, (req, res) => {
  const requestId = Number(req.params.id);

  const result = db.prepare(`
    DELETE FROM friend_requests
    WHERE id = ?
      AND (sender_id = ? OR receiver_id = ?)
      AND status = 'pending'
  `).run(requestId, req.session.userId, req.session.userId);

  if (!result.changes) {
    return res.status(404).json({ error: "Pending request not found." });
  }

  res.json({ success: true });
});

// Friends list
app.get("/api/friends", requireAuth, (req, res) => {
  const userId = req.session.userId;

  const friends = db.prepare(`
    SELECT u.id, u.name, u.bio
    FROM friend_requests fr
    JOIN users u
      ON u.id = CASE
        WHEN fr.sender_id = ? THEN fr.receiver_id
        ELSE fr.sender_id
      END
    WHERE (fr.sender_id = ? OR fr.receiver_id = ?)
      AND fr.status = 'accepted'
    ORDER BY u.name
  `).all(userId, userId, userId);

  res.json({ friends });
});

// Unfriend
app.delete("/api/friends/:id", requireAuth, (req, res) => {
  const friendId = Number(req.params.id);

  const result = db.prepare(`
    DELETE FROM friend_requests
    WHERE status = 'accepted'
      AND (
        (sender_id = ? AND receiver_id = ?)
        OR (sender_id = ? AND receiver_id = ?)
      )
  `).run(req.session.userId, friendId, friendId, req.session.userId);

  if (!result.changes) {
    return res.status(404).json({ error: "Friendship not found." });
  }

  res.json({ success: true });
});

// Handle upload and server errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE"
      ? "File is too large. Maximum size is 50 MB."
      : "File upload failed.";
    return res.status(400).json({ error: message });
  }

  if (err) {
    return res.status(400).json({ error: err.message || "Something went wrong." });
  }

  next();
});

app.listen(PORT, () => {
  console.log(`HappyLife is running on port ${PORT}`);
});
