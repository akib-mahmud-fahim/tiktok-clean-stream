# StreamClean - TikTok Video Stream Generator & Logo-Free Player

Deploy a clean, logo-free TikTok video stream player on GitHub & Cloudflare for 100% FREE.

## Project Structure

- `app.py`: Python Flask Backend (For local hosting or server deployment).
- `static/index.html`: Dashboard UI in English.
- `static/player.html`: Clean logo-free HTML5 Video Player.
- `static/style.css`: Modern Dark Glassmorphic Design System.
- `worker.js`: Cloudflare Worker Script (For 100% Serverless Cloudflare deployment).

---

## Deploying on GitHub & Cloudflare (Step-by-Step Guide)

### Step 1: Push Code to GitHub
1. Create a new repository on GitHub (e.g., `tiktok-clean-stream`).
2. Run in terminal:
```bash
git init
git add .
git commit -m "Initial commit - TikTok StreamClean"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/tiktok-clean-stream.git
git push -u origin main
```

---

### Step 2: Deploy Frontend on Cloudflare Pages (Free)
1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Go to **Workers & Pages** -> **Create Application** -> **Pages**.
3. Select **Connect to Git** and pick your GitHub repository (`tiktok-clean-stream`).
4. Set Build Output Directory to: `static` (or `./static`).
5. Click **Save and Deploy**. Your frontend website is now LIVE on Cloudflare!

---

### Step 3: Deploy Backend on Cloudflare Worker (Free)
1. Go to **Workers & Pages** -> **Create Application** -> **Create Worker**.
2. Name your Worker (e.g. `tiktok-stream-api`).
3. Click **Deploy**.
4. Click **Edit Code** and paste the contents of `worker.js`.
5. Click **Save and Deploy**.

Now your TikTok Video Streamer & Logo-Free Player is running globally on Cloudflare Edge for 100% FREE!
