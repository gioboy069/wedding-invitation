# Wedding Invitation — Augiela & Gio Anthony

Minimal coastal wedding invitation with a prenup gallery, attire guide, interactive RSVP, and an admin dashboard.

**Palette:** deep ocean `#0D2B45` · ocean teal `#1E5A6E` · seafoam `#6BA7A0` · sandy beige `#DCC8AA` · light sky `#B7D4E6`

## Quick Start

```bash
npm install
npm run dev
```

- Invitation: [http://127.0.0.1:4317](http://127.0.0.1:4317)
- Gallery: [http://127.0.0.1:4317/gallery.html](http://127.0.0.1:4317/gallery.html)
- Attire guide (expandable on home): [http://127.0.0.1:4317/#attire](http://127.0.0.1:4317/#attire)
- Admin: [http://127.0.0.1:4317/admin/](http://127.0.0.1:4317/admin/)

### Admin login

Default password: `augiela-gio-2027`

Override with an environment variable:

```bash
ADMIN_PASSWORD='your-secure-password' npm run dev
```

## Gallery photos (Google Drive)

On Render Free, uploaded files can disappear. Prefer Google Drive links in **Admin → Gallery**:

1. Upload photo to Google Drive
2. Share → **Anyone with the link**
3. Copy link
4. Paste into Admin → **Add Drive Photo**

Drive files stay permanent. If Render redeploys and clears `data/gallery.json`, just re-add the same Drive links (or commit an updated `data/gallery.json` to GitHub).

## Our Story photos (Google Drive)

Same Drive method works for **Admin → Details → timeline years**:

1. Upload each year’s photo to Google Drive and share **Anyone with the link**
2. Open Admin → **Details**
3. For each year (2018, 2020, …), paste the Drive link into **Photo (Google Drive link or image URL)**
4. Click **Save Details**

The server converts Drive share links to viewable image URLs automatically.

## Attire photos (Google Drive)

Same Drive method for **Admin → Details → Attire photos**:

1. Upload bride, groom, party, and guest inspiration photos to Google Drive
2. Share each as **Anyone with the link**
3. Paste each link into the matching attire photo field
4. Click **Save Details**

Drive links are proxied by the site so they display reliably (Google’s share URLs often fail as direct image sources).

## RSVP emails

Guest RSVPs trigger an email to **gomez.wed2027@gmail.com** whenever someone submits or updates their response.

### Gmail SMTP (recommended)

1. In your Google Account, enable **2-Step Verification**
2. Create an **App Password** (Google Account → Security → App passwords)
3. Set environment variables when running or deploying:

```bash
GMAIL_USER='gomez.wed2027@gmail.com' \
GMAIL_APP_PASSWORD='your-16-char-app-password' \
RSVP_EMAIL='gomez.wed2027@gmail.com' \
npm run dev
```

| Variable | Purpose |
|----------|---------|
| `GMAIL_USER` | Gmail account used to send (defaults to `RSVP_EMAIL`) |
| `GMAIL_APP_PASSWORD` | Google App Password (required for SMTP) |
| `RSVP_EMAIL` | Inbox that receives RSVP notifications |

If `GMAIL_APP_PASSWORD` is not set, the server falls back to [FormSubmit](https://formsubmit.co) (requires one-time activation in that inbox).

Override the destination email if needed:

```bash
RSVP_EMAIL='your@email.com' npm run dev
```

## Admin features

- **Edit details** — names, date, story timeline, venues, and copy
- **Guest list** — invited names with seat allocation (1–10); only listed names can RSVP; companion fields match each guest's allocation
- **Gallery** — upload, caption, and delete prenup photos
- **RSVPs** — track attending/declined, primary guest + companions, live auto-refresh, filter, delete, export CSV

## Print invitation

A 5 × 7 inch card suite (invitation + celebration details) is at [http://127.0.0.1:4317/print.html](http://127.0.0.1:4317/print.html).

- Download: `print/Gio-Anthony-Augiela-Shane-Invitation.pdf`
- Paper: 5 × 7 in cardstock, 110–130 lb cotton, felt, or eggshell, ivory or warm white
- Print at **100% / actual size** (do not fit to page)

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | Invitation with countdown, story, gallery teaser, venues, expandable attire guide, RSVP |
| `gallery.html` | Full prenup photo gallery |
| `print.html` | Print studio — 5×7 invitation + details cards, PDF download |
| `admin/` | Password-protected dashboard |

## Data

- `data/content.json` — editable invitation content
- `data/gallery.json` — gallery metadata
- `data/rsvps.json` — guest responses (created as guests RSVP)
- `uploads/` — photos uploaded from the admin dashboard

## Tech

- Express API + static pages
- Cormorant Garamond + Montserrat
- Local JSON storage (no database required)
