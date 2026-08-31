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

The login page does not show the password. Sign in with the password you chose, or tap **Forgot password?** to email a reset link to `gomez.wed2027@gmail.com`. The link expires in one hour.

The first-time password (until you reset it) is `augiela-gio-2027`. After the first launch, change it with Forgot password rather than the environment variable.

To set a different first-time password, set `ADMIN_PASSWORD` **before** the first launch (before `data/admin.json` exists):

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

Guest RSVPs are emailed to **gomez.wed2027@gmail.com** via [FormSubmit](https://formsubmit.co).

**First-time setup:** After the first RSVP is submitted, FormSubmit sends an activation link to that inbox. Open the email and click **Confirm** once. After that, every RSVP arrives automatically.

Override the destination email if needed:

```bash
RSVP_EMAIL='your@email.com' npm run dev
```

## Admin features

- **Edit details** — names, date, story timeline, venues, and copy
- **Guest list** — invited names with category, table number, and seat allocation (1–10); RSVP guests search by a few letters, choose their full name, and see their table and category
- **RSVP monitor** — live count of guest-list names that have replied versus those still waiting
- **Gallery** — upload, caption, and delete prenup photos
- **RSVPs** — track attending/declined, party size, companions, filter, delete, export CSV

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | Invitation with countdown, story, gallery teaser, venues, expandable attire guide, RSVP |
| `gallery.html` | Full prenup photo gallery |
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
