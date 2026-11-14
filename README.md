# shauryaa.ai

Shaurya Sharma’s portfolio, built as a lightweight static site.

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

## Performance

- Portfolio screenshots use resized WebP assets.
- Work previews and carousel images decode asynchronously and are lazy-loaded.
- `vercel.json` caches static images and the neon animation bundle for repeat visits.

## Deploy

Import this repository into Vercel. The project is a static site with `index.html` at the repository root, so no build command is required.
