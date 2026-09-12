# Deployment Guide

The app is a single Node.js process with an embedded SQLite database and static frontend
files — it deploys anywhere Node runs: a VPS, Render, Railway, Fly.io, a Docker host, or
a container platform.

## ⚡ Fastest path: Render one-click blueprint

1. Create a free account at **render.com** (or connect with GitHub).
2. Push this project to a GitHub repository (see below).
3. In Render: **New → Blueprint** → select the repo.
4. Render reads the included **`render.yaml`** and creates the web service with the
   right build/start commands and environment variables automatically.
5. On first boot the store **seeds itself** with sample products (`AUTO_SEED=true`),
   so it's instantly browsable. You'll get a public URL like
   `https://tob-daniel-store.onrender.com` — open it on any phone or computer.

> ⚠️ Render's free tier uses an **ephemeral disk**: the SQLite database and uploaded
> images reset whenever the service redeploys. For a real store, attach a Render
> persistent disk (mount at `/opt/render/project/src/data`) or move to the Docker/VPS
> options below.

## 1. Prepare

```bash
git clone <your-repo>
cd tobdaniel
npm install --omit=dev
cp .env.example .env        # then edit values (see docs/ENVIRONMENT.md)
npm run seed                # create DB + sample data (skip if you set AUTO_SEED=true)
```

To put it on GitHub first:

```bash
git init
git add .
git commit -m "Tob Daniel Business Enterprise"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## 2. Run

```bash
# Direct
NODE_ENV=production npm start

# Or with a process manager (recommended)
pm2 start server/index.js --name tobdaniel --env production
```

Always set `NODE_ENV=production` so 2FA codes are not echoed to the client and static
assets are cached.

## 3. Reverse proxy (Nginx example)

```nginx
server {
  listen 80;
  server_name shop.tobdaniel.ng;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Required for real-time updates (SSE)
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600;
  }
}
```

Enable HTTPS with Certbot: `certbot --nginx -d shop.tobdaniel.ng`.

## 4. Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
VOLUME /app/data
EXPOSE 3000
CMD ["sh", "-c", "node server/seed.js || true; node server/index.js"]
```

```bash
docker build -t tobdaniel .
docker run -d -p 3000:3000 -v tobdaniel_data:/app/data --env-file .env tobdaniel
```

> Mount `/app/data` so the SQLite DB, uploaded media (under `public/uploads/`) and the
> generated secret persist across container restarts.

## 5. Production checklist

- [ ] Set a strong `APP_SECRET` and unique `ADMIN_ROUTE`.
- [ ] Change the seeded admin password (Admin → Settings → Change password).
- [ ] Add SMTP credentials so order/notification emails actually send.
- [ ] Add a payment provider key if you want card payments.
- [ ] Back up `data/store.db` regularly (SQLite is a single file — `sqlite3 data/store.db ".backup backup.db"` in cron works well).
- [ ] Consider enabling admin 2FA (Admin → Settings → Security).
- [ ] Point a monitoring tool at `/api/health`.

## 6. Scaling notes

- SQLite comfortably handles the traffic of a small-to-mid e-commerce store.
- To scale horizontally later, the data layer is isolated behind `server/db.js` and
  `server/routes/*`; you can swap SQLite for Postgres and move real-time fan-out from
  the in-process SSE hub (`server/events.js`) to Redis pub/sub without touching the
  frontend.
- Put static assets behind a CDN and move uploads to object storage (S3/Cloudflare R2)
  when volume grows.
