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
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 type TEXT NOT NULL,
 body TEXT DEFAULT '',
 extra TEXT DEFAULT '',
 image TEXT DEFAULT '',
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
`);

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
 destination: (_, __, cb) => cb(null, uploadDir),
 filename: (_, file, cb) => cb(null, Date.now() + "-" + Math.random().toString(36).slice(2) + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
 storage,
 limits: { fileSize: 5 * 1024 * 1024 },
 fileFilter: (_, file, cb) => cb(null, ["image/jpeg","image/png","image/webp","image/gif"].includes(file.mimetype))
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/uploads", express.static(uploadDir));
app.use(session({
 secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
 resave: false,
 saveUninitialized: false,
 store: new SQLiteStore({ db: "sessions.db", dir: __dirname }),
 cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

const getUser = id => db.prepare("SELECT id,name,email FROM users WHERE id=?").get(id);
function requireAuth(req,res,next){ if(!req.session.userId) return res.status(401).json({error:"Please log in first."}); next(); }

app.get("/api/me", (req,res) => res.json({ user: req.session.userId ? getUser(req.session.userId) : null }));

app.post("/api/register", async (req,res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if(name.length < 2 || name.length > 50) return res.status(400).json({error:"Name must be 2–50 characters."});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Enter a valid email address."});
  if(password.length < 8) return res.status(400).json({error:"Password must be at least 8 characters."});
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name,email,hash);
    req.session.userId = result.lastInsertRowid;
    res.json({user:getUser(req.session.userId)});
  } catch(e) { res.status(409).json({error:"This email may already be registered."}); }
});

app.post("/api/login", async (req,res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if(!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:"Email or password is incorrect."});
  req.session.userId = user.id;
  res.json({user:getUser(user.id)});
});
app.post("/api/logout", requireAuth, (req,res) => req.session.destroy(() => res.json({ok:true})));

app.get("/api/posts", (req,res) => {
  const rows = db.prepare(`
    SELECT p.id,p.type,p.body,p.extra,p.image,p.created_at,u.id user_id,u.name,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) likes,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) comments,
    EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) liked
    FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 100
  `).all(req.session.userId || 0);
  res.json({posts:rows});
});
app.post("/api/posts", requireAuth, upload.single("image"), (req,res) => {
  const type = String(req.body.type || "text");
  const allowed = ["text","photo","feeling","link","poll"];
  const body = String(req.body.body || "").trim().slice(0,2000);
  const extra = String(req.body.extra || "").trim().slice(0,500);
  if(!allowed.includes(type)) return res.status(400).json({error:"Unsupported post type."});
  if(!body && !req.file) return res.status(400).json({error:"Write something or attach an image."});
  if(type==="link" && extra && !/^https?:\/\//i.test(extra)) return res.status(400).json({error:"Link must start with http:// or https://"});
  const result = db.prepare("INSERT INTO posts(user_id,type,body,extra,image) VALUES(?,?,?,?,?)")
    .run(req.session.userId,type,body,extra,req.file ? "/uploads/"+req.file.filename : "");
  res.json({ok:true,id:result.lastInsertRowid});
});
app.post("/api/posts/:id/like", requireAuth, (req,res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT 1 FROM likes WHERE user_id=? AND post_id=?").get(req.session.userId,id);
  if(existing) db.prepare("DELETE FROM likes WHERE user_id=? AND post_id=?").run(req.session.userId,id);
  else db.prepare("INSERT OR IGNORE INTO likes(user_id,post_id) VALUES(?,?)").run(req.session.userId,id);
  res.json({liked:!existing});
});
app.get("/api/posts/:id/comments", (req,res) => {
  const comments = db.prepare("SELECT c.id,c.body,c.created_at,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.id").all(Number(req.params.id));
  res.json({comments});
});
app.post("/api/posts/:id/comments", requireAuth, (req,res) => {
  const body = String(req.body.body || "").trim().slice(0,500);
  if(!body) return res.status(400).json({error:"Write a comment first."});
  db.prepare("INSERT INTO comments(user_id,post_id,body) VALUES(?,?,?)").run(req.session.userId,Number(req.params.id),body);
  res.json({ok:true});
});

app.listen(PORT, () => console.log(`HappyLife is running at http://localhost:${PORT}`));
