# HappyLife Social

A responsive social-network starter with account registration/login and text, photo, feeling/activity, link, and question posts. It also includes likes and comments.

## Requirements
- Node.js 18 or newer
- npm

## Run on your computer
1. Extract this ZIP.
2. Open a terminal in the `happylife-social` folder.
3. Run `npm install`
4. Copy `.env.example` to `.env` and change `SESSION_SECRET` to a long random value.
5. Run `npm start`
6. Open `http://localhost:3000`

The SQLite database and session database are created automatically. Uploaded images are saved in `uploads/`.

## Important before public launch
This is a learning/starter project, not a fully audited production service. Before allowing public users:
- Use HTTPS and set a strong, private `SESSION_SECRET`.
- Add email verification, password reset, rate limiting, CSRF protection, moderation/reporting, and account deletion.
- Add stricter upload scanning and storage limits; consider object storage for production.
- Configure secure cookies and a persistent database/session store for your hosting provider.
- Add privacy policy, terms, and community rules.

Never commit `.env`, database files, access tokens, or real user data to GitHub.
