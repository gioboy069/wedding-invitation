# Wedding Invitation — Augiela & Gio Anthony

Coastal-chic wedding invitation with a prenup gallery, attire guide, interactive RSVP, and an admin dashboard. The guest page is a quiet cream field with a cinematic envelope opening and slow, editorial motion.

**Palette:** ocean deep `#0D2B45` · teal `#1E5A6E` · seafoam `#6BA7A0` · sky `#B7D4E6` · sand `#DCC8AA`

**Type:** Cormorant Garamond for names and headings, Source Sans 3 for body and forms.

**Background:** a continuous stitched torn-paper scroll (`img/bg/torn-stitched-scroll.webp`) behind translucent content panels, with the coastal palette above.

## Quick Start

```bash
npm install
npm run dev
```

- Invitation: [http://127.0.0.1:4317](http://127.0.0.1:4317)
- Gallery (prenup line and guest album on one page): [http://127.0.0.1:4317/#gallery](http://127.0.0.1:4317/#gallery)
- Attire guide (expandable on home): [http://127.0.0.1:4317/#attire](http://127.0.0.1:4317/#attire)
- Admin: [http://127.0.0.1:4317/admin/](http://127.0.0.1:4317/admin/)

### Admin login

The login page does not show the password. Sign in with the password you chose, or tap **Forgot password?** to email a reset link to `gomez.wed2027@gmail.com`. The link expires in one hour.

The first-time password (until you reset it) is `gomeZ120822@`. After the first launch, change it with Forgot password rather than the environment variable.

To set a different first-time password, set `ADMIN_PASSWORD` **before** the first launch (before `data/admin.json` exists):

```bash
ADMIN_PASSWORD='your-secure-password' npm run dev
```

## Gallery photos & short videos (Google Drive)

The prenup gallery lives on the home page as a sideways-scrolling strip of photos and short videos. Manage it in **Admin → Gallery** (upload, caption, type, update, delete).

On Render Free, uploaded files can disappear. Prefer Google Drive links:

1. Upload a photo or short video to Google Drive
2. Share → **Anyone with the link**
3. Copy link
4. Paste into Admin → Gallery, choose **Photo** or **Short video**, and save

Drive files stay permanent. If Render redeploys and clears `data/gallery.json`, just re-add the same Drive links (or commit an updated `data/gallery.json` to GitHub).

## Guest album

Guests post their own photos and videos from the celebration on the home **Gallery** page, under **Guest album**. The old `/#album` address still opens that part of the same page. They can select one file or many at once. Each post goes into Main album, Photographer, Ceremony, or Reception, and is uploaded to the connected Google Drive account. The album shows a collage, with **View more** once there are more than nine moments. Anyone can leave a heart or a haha, and download one file, a selection, or the whole album.

In **Admin → Guest album**, connect Google Drive, open the album folder, or download a ZIP of the photos, films, captions, and reactions. Connecting, reconnecting, or pressing Refresh reads the files already in those Drive folders and shows them in the album.

### Connect Google Drive

1. In Google Cloud, create a project and enable the **Google Drive API**.
2. Configure the OAuth consent screen as **External** and **Testing**, and add the Gmail address that owns the Drive.
3. Create an OAuth client of type **Web application**.
4. Add this redirect URI (use the real site address): `https://YOUR-SITE/api/admin/drive/callback`
5. Save the client id and client secret as the app secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. Open **Admin → Guest album** and choose **Connect Google Drive**. Pick the Google account, and if Google warns that the app is unverified, continue to allow access.

New guest photos and films then land in a Drive folder named **Augiela & Gio — Guest album**, with a folder for each album. Until Drive is connected, guests see a message and the photo is not stored on the server.

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
- **Guest list** — invited names with category, table number, and seat allocation (1–10); download or upload an Excel file to update the list; RSVP guests search by a few letters, choose their full name, and see their category (table numbers stay in admin only)
- **RSVP monitor** — live count of guest-list names that have replied versus those still waiting
- **Gallery** — upload, caption, update, and delete prenup photos and short videos shown in the home-page scroll gallery
- **RSVPs** — track attending/declined, party size, companions, filter, delete, export CSV

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | Invitation with countdown, story, scrollable photo/video gallery, venues, expandable attire guide, RSVP |
| `admin/` | Password-protected dashboard |

## Data

- `data/content.json` — editable invitation content
- `data/gallery.json` — gallery metadata
- `data/rsvps.json` — guest responses (created as guests RSVP)
- `uploads/` — photos uploaded from the admin dashboard

## Tech

- Express API + static pages
- Cormorant Garamond and Source Sans 3
- Local JSON storage (no database required)
