# Wedding Invitation — Augiela & Gio Anthony

Elegant digital wedding invitation with a prenup gallery, attire guide, interactive RSVP, and an admin dashboard for content, photos, and guest tracking.

## Quick Start

```bash
npm install
npm run dev
```

- Invitation: [http://127.0.0.1:4317](http://127.0.0.1:4317)
- Gallery: [http://127.0.0.1:4317/gallery.html](http://127.0.0.1:4317/gallery.html)
- Attire: [http://127.0.0.1:4317/attire.html](http://127.0.0.1:4317/attire.html)
- Admin: [http://127.0.0.1:4317/admin/](http://127.0.0.1:4317/admin/)

### Admin login

Default password: `augiela-gio-2027`

Override with an environment variable:

```bash
ADMIN_PASSWORD='your-secure-password' npm run dev
```

## RSVP emails

Guest RSVPs are emailed to **gomez.wed2027@gmail.com** via [FormSubmit](https://formsubmit.co).

**First-time setup:** After the first RSVP is submitted, FormSubmit sends an activation link to that inbox. Open the email and click **Confirm** once. After that, every RSVP arrives automatically.

Override the destination email if needed:

```bash
RSVP_EMAIL='your@email.com' npm run dev
```

## Admin features

- **Edit details** — names, date, story timeline, venues, and copy
- **Gallery** — upload, caption, and delete prenup photos
- **RSVPs** — track attending/declined, filter, delete, export CSV

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | Invitation with countdown, story, gallery teaser, venues, RSVP |
| `gallery.html` | Full prenup photo gallery |
| `attire.html` | Detailed dress code and outfit looks |
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
