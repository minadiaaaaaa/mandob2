---
title: Mandoob Staging
emoji: 🚚
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Mandoob staging

Upload this file and `Dockerfile` (both from `deploy/huggingface/` in the Mandoob repository) to a new **Docker**
Space. The code is cloned from the private GitHub repository at build time.

Space › Settings › Variables and secrets:

| Secret | Needed | Value |
|---|---|---|
| `GITHUB_TOKEN` | yes | A GitHub fine-grained token with read-only "Contents" access to the Mandoob repository |
| `OWNER_EMAIL` | yes | The platform owner's login |
| `OWNER_PASSWORD` | yes | The platform owner's password (at least 8 characters) |
| `APP_KEY` | yes | 32 random bytes in base64; set once and never change it |
| `DATABASE_URL` | no | An outside MySQL, e.g. Aiven's Service URI. Without it a database runs inside the Space and is emptied at every restart |
| `DB_SSL_CA` | with Aiven | The database's CA certificate text |

Open the app at its own address (`https://<user>-<space>.hf.space`), not inside the Hugging Face page: the app
refuses to be shown in another site's frame.

Free Spaces sleep after 48 hours without visits, and files uploaded to the app are lost when the Space restarts.
