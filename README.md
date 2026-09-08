# escapefromwp.com

Cinematic WordPress-migration lead-gen site. Astro (static) + Cloudflare Pages Function for the contact endpoint.

## Stack
- **Astro** static build (`dist/`)
- **Cloudflare Pages** hosting (production: escapefromwp.com)
- **Pages Function** `functions/api/contact.js` → POST `/api/contact`
- **D1** database `escapefromwp-db`, table `ec_contact_submissions`
- Leads push to the shared **Command Center** (cc.crweb.design) via HMAC webhook

## Deploy
```
nvm use 22
export CLOUDFLARE_API_TOKEN=...
npm run build
npx wrangler pages deploy dist --project-name escapefromwp
```
D1 binding `DB` and secret `PUSH_NOTIFY_SECRET` are configured on the Pages project.

## Env / bindings (Pages project settings)
- `DB` → D1 database `escapefromwp-db`
- `PUSH_NOTIFY_SECRET` → shared Command Center push secret
- `CC_NOTIFY_URL` (optional) → defaults to https://cc.crweb.design/api/push/notify

GitHub Pages staging is visual-only (static; the contact Function does not run there).
