# 📱 Get a PERMANENT link for your store (Render + GitHub)

Follow these steps once and you'll have a link like
`https://tob-daniel-store.onrender.com` that works on your phone **forever**,
even after this chat is closed.

You need two FREE accounts: **GitHub** (stores the code) and **Render** (runs the site).
Do this on a computer — it's easier — but it works on a phone too.

---

## Part 1 — Put the code on GitHub (5 min)

1. **Download the project zip** (`tob-daniel-enterprise.zip`) from this chat and
   **unzip it**. You get a folder named `tobdaniel` containing:
   `server/`, `public/`, `package.json`, `render.yaml`, `Procfile`, `README.md`, etc.

2. Go to **github.com** → **Sign up** (free). Choose a username, email and password.
   Verify your email when prompted.

3. Click the **＋** button (top-right) → **New repository**.
   - Name it: `tob-daniel-store`
   - Keep it **Public**
   - Do NOT tick "Add a README"
   - Click **Create repository**

4. On the next page, click the link that says **"uploading an existing file"**.

5. Open the unzipped `tobdaniel` folder on your computer. Select **everything inside
   it** (press `Ctrl+A` / `Cmd+A`) and **drag the whole lot into the upload box**.

   > ⚠️ Important: `package.json` and `render.yaml` must sit at the TOP level —
   > not inside a sub-folder. If you drag the `tobdaniel` folder itself in, it will
   > create an extra folder and Render won't find the config. Drag the files INSIDE.

6. Scroll down and click **Commit changes**. ✅ Your code is now on GitHub.

---

## Part 2 — Deploy on Render (5 min)

1. Go to **render.com** → **Sign up** → choose **"Sign in with GitHub"** (easiest)
   and allow access.

2. Click **New +** → **Blueprint**.

3. Connect GitHub if asked → select the `tob-daniel-store` repository → **Connect**.

4. Render automatically reads the `render.yaml` (I already created it for you).
   It will show one **Web Service** — click **Apply** / **Create Resources**.

5. Render now installs dependencies and deploys. Wait **3–6 minutes** until the
   status shows **Live** (green dot).

6. Copy your public URL — it looks like `https://tob-daniel-store.onrender.com`.

> 🎁 Bonus: your code includes `AUTO_SEED=true`, so the store **seeds itself** with
> sample products on first boot — it's instantly browsable.

---

## Part 3 — Use it on your phone

| What | Link |
| --- | --- |
| **Storefront** | `https://tob-daniel-store.onrender.com` |
| **Admin login** | `https://tob-daniel-store.onrender.com/secure-admin-login` |

**Logins**
| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@tobdaniel.ng` | `Admin@2026!` |
| Customer | `demo@tobdaniel.ng` | `Demo@1234` |

**Make it feel like an app:**
- Android (Chrome): open the site → **⋮ menu → Add to Home screen**
- iPhone (Safari): open the site → **Share → Add to Home Screen**

---

## ⚠️ Good to know

- **First change:** log into the admin and change the password immediately.
- **Free Render spins down after ~15 min of inactivity.** The first visit after that
  wakes it up (takes ~30–60 seconds). Normal for free hosting.
- **Free Render disk is temporary** — the database resets if you redeploy. Fine for
  testing/demo. When you're ready for real orders, add Render's persistent disk
  (about $0.25/GB/month) — see `docs/DEPLOYMENT.md`.
- **Free plan gives you one web service.** Perfect for this store.

---

## Stuck anywhere?

Come back to this chat and tell me which step you're on (or paste a screenshot
description). I'll walk you through it.
