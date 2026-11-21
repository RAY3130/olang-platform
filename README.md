# OLANG International B2B Website

A working local prototype of OLANG's international bathroom-hardware site. It is a server-rendered Node/Express application with a SQLite catalogue, three localised editions, a 6-step customization workflow, persisted inquiry/records, a staff portal, a grounded multilingual assistant, and first-party consented analytics.

> **Current status: local prototype, not the company's production site.**
> URL: `http://127.0.0.1:4174` (when the server is running).
> Editions: `/en-gb/`, `/de-de/`, `/ja-jp/` (legacy `/en`, `/de`, `/ja`, `/uk` redirect to the published editions).
> The prototype is not connected to OLANG's production mail, CRM, ERP, payment or real customer-service desk. Every resulting screen says so.
> No formal project report or defence presentation is part of this round's deliverables.

## 1. What is implemented

### Three real editions, not three machine translations of one page

| Edition | Entry | Currency / units | What changes |
|---|---|---|---|
| United Kingdom | `/en-gb/` | GBP; metric mm | British English terminology (`toilet roll holder`, `towel rail`, trade enquiry), burgundy editorial palette, trade/project route |
| Germany | `/de-de/` | EUR; metric mm | German technical vocabulary, sans-serif data-led typography, image-left hero, a technical selection strip, finish/data/document framing |
| Japan | `/ja-jp/` | JPY; metric mm | Japanese commercial register, lighter spacing, gothic/Mincho-less typographic hierarchy, installation-image section, mobile-first spacing, catalogue/document route |

Product SKU, series and URL slugs are identical across editions, so switching language preserves the current product.

### Working commerce/procurement features

- **123 published SKUs / 11 categories / 7 numbered series + Construction Hardware.** All original categories and series are retained.
- Discovery routes: **by product type** (11 category pages at `/products/category/:slug`), **by series** (`/series`, 7 numbered series + Engineering Hardware, and 8 landing pages at `/series/:slug`), **by space/finish** on the product index, and a three-step **guided selector** at `/selector`, plus search by SKU/model, filters, sorting and comparison.
- **Three structural market editions (v3):** en-GB retail editorial split hero; de-DE full-bleed hero + parameter strip + series matrix; ja-JP dense image/copy hero + model-number table. Shared catalogue, not a shared layout.
- **Demo completeness:** 11 category-level demo specifications, three downloadable PDFs per SKU, and a 24-image reference library with `credits.json` for classroom presentation.
- Product detail records show:
  - confirmed model/category/series and an internal provenance record (not displayed as a customer link);
  - one official product photograph, with the PDP frame following the photograph's own ratio and `object-fit: contain`;
  - every officially published finish name and each available official finish photograph (no fake detail crops);
  - a 12-field procurement table with explicit truth states;
  - a same-series SKU matrix (model, type, dimensions, finish, MOQ), three downloadable documents per SKU, installation/care notes, reference detail images, related products, add-to-quote and product-specific inquiry.
- **10-item procurement list** persisted in browser storage and submitted with the inquiry.
- **6-step customization configurator** at `/customization`:
  1. buyer type: wholesale, hotel/engineering, OEM/ODM, architect/designer, other;
  2. multiple products with quantity and finish;
  3. material/finish/dimension/design/structure/branding requirements and file upload;
  4. buyer-type-specific buying-context fields;
  5. generated review summary;
  6. contact + quote/sample/sales request submission.
  - The server writes the request, selected SKUs, customisation payload, buyer context and private attachments to SQLite.
  - Staff can review at `/admin/customization` and export CSV at `/admin/customization/export.csv`.
  - A reference is issued only after persistence. The UI explicitly states that this is a local demo and is not delivered to a sales inbox/CRM.
- **Project references** with a list and detail page. Each detail distinguishes the published building photo and the missing bathroom/interior evidence; no AI bathroom composite is presented as the project. Product scope, quantities and installation remain request-only.
- **Resources / technical data** with document register, search/filter, real-file-only downloads, document request form, FAQ and a project product directory PDF. Placeholder PDFs were removed.
- **Grounded multilingual product assistant** (English/German/Japanese):
  - product lookup by SKU/name, published finish/material state, comparison, document routing, OEM/project/wholesale routing and human handoff;
  - returns clickable sources;
  - refuses unknown dimensions, MOQ, lead time, price and certification rather than inventing values;
  - no external LLM key is configured, so the default is a deterministic rule/retrieval layer. An optional OpenAI-compatible provider can be configured server-side.
- **Consent-gated first-party analytics** (no Google Analytics, no advertising pixels):
  - the requested page/product/customisation/chatbot events are implemented;
  - `/admin` has a staff dashboard;
  - the QA exports and analysis are in `../deliverables/06_Website_QA/`.

### Company, content and support

- About, culture, development, honours, factory, quality, news and contact content from the public OLANG site, with source/verification labels.
- English/German/Japanese versions of all public pages; company-page Japanese is reviewed at the editorial level and still needs a native commercial review before launch.
- Floating product assistant on every page.
- Cookie preferences and privacy request route.
- Hreflang, canonical, language-specific `<html lang>`, sitemap, robots, meta title/description, product JSON-LD and image alt text.

## 2. Running locally

Requirements: Node.js **22.13+** (the project was verified on Node 24), npm, and Microsoft Edge for the browser QA scripts.

```powershell
cd olang-intl/platform
npm install
# copy .env.example to .env and adjust if necessary
npm run db:migrate
npm run db:seed
node server.js
```

Open `http://127.0.0.1:4174`.

The admin account is created on first run. The current local review credentials are in `storage/ADMIN-CREDENTIALS.txt` (not for deployment). Change the password after first sign-in.

### Seed/reset

```powershell
node scripts/migrate.js     # apply schema/data migrations
node scripts/seed.js        # idempotent catalogue, colours, editorial, Japanese, honest-data seed
node tests/qa/export-product-library.js
```

The database lives at `storage/olang.sqlite`. Uploads live under `storage/uploads/` and are **not** publicly addressable. Do not commit live uploads or credentials.

### Tests

```powershell
npm test                     # unit + integration tests (no browser)
npm run qa:site              # browser audit, links, screenshots, axe
npm run qa:images            # rendered image-containment / ratio guard
npm run qa:i18n              # three-language presentation-copy key check
node tests/qa/assistant-test.js
node tests/qa/old-new-tasks.js
node tests/qa/export-product-library.js
node tests/qa/analyse-analytics.js
```

The browser scripts use the system Edge at:
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.

Some tests deliberately require a running local server and will create synthetic QA data. They are marked as QA, not real customers.

## 3. Project structure

```text
platform/
  server.js                 Express app entry
  src/app.js                middleware, security headers, routes
  src/routes/public.js      public server-rendered routes
  src/routes/api.js         consent, analytics, assistant, inquiry and customization APIs
  src/routes/admin.js       staff portal
  src/services/             catalogue, media, documents, inquiries, customization, assistant, analytics
  src/db/                   schema, migrations, catalogue, official colour photos, editorial, honest-data repair
  src/i18n/                 English/German/Japanese dictionaries, glossary, market settings, nav, customizer and presentation copy
  src/views/                EJS public/admin views (series, selector, product matrix/docs)
  public/assets/            CSS, site JS, customizer JS, gallery JS
  public/images/            OLANG product images, responsive derivatives and sourced reference bathrooms
  public/downloads/         public catalogue PDF only (no placeholder specification downloads)
  tests/unit/               unit tests
  tests/integration/        API/server tests
  tests/qa/                 browser QA and evidence generators
  storage/                   local SQLite, uploads, admin bootstrap (not for production)
```

## 4. Product data truth policy

This was the single most important repair in this build.

The earlier prototype had illustrative dimensions, material grades, MOQ, lead times and prices. Those values were **not published by OLANG** and have been removed from the database and from every rendered product page. The migration report and current export are at:

- `../deliverables/03_Product_Library/README.md`
- `../deliverables/03_Product_Library/product_library.json`
- `../deliverables/03_Product_Library/product_library.csv`

Confirmed from OLANG public product pages:

- model, product type, series, one official image per SKU and printed finish names;
- some additional official finish photographs, kept per finish;
- public company statements (founding year, 5,000 m² site, 30+ countries etc.) are labelled **company-reported**.

Not published and therefore shown as `On request` / `Available on request` / `Being confirmed`:

- dimensions and drawings;
- exact material grade;
- installation method, fixing kit and included parts;
- net weight;
- packaging/inner box/master carton;
- MOQ and lead time;
- product-level test reports/certificates;
- price.

The v3 demo aligns the **OL-1205** display name to its official towel-bar photograph; the URL slug stays stable. **OL-5201B** keeps its official line drawing because no verified product photograph is available. No third-party platform parameter was copied into an OLANG record.

## 5. AIGC and image policy

The market atmosphere images were replaced with a **24-image reference library** from local suppliers (Croydex, KEUCO and TOTO), including heroes, room scenes, details and installation crops. Each image is recorded in `public/images/reference/credits.json`.

They are labelled as reference bathroom images, link to the brand source and are **not** OLANG projects or installations. They are used only for classroom market presentation; rights remain with the brands. The v3 library contains 24 images and `credits.json`: `public/images/reference/`. Report: `../deliverables/08_presentation_localization/V3_REPORT.md`.

The earlier AI-generated market composites and product-scene composites are retired and are **not used on the public site**. Their prompts, sources, dates and `retired_not_used` status remain documented in `../deliverables/07_AIGC/` for audit. Product pages now use only official product photography; project pages do not show an AI bathroom as project evidence.

The old 3D product viewer and approximate 3D macro renders were removed because there were no verified engineering dimensions. No AI was used to redraw a product or to invent an installation.

## 6. Assistant and service boundaries

The assistant is available through `/api/assistant` and the floating panel. It:

- runs local retrieval against the product/FAQ/company database;
- returns source links and never claims an unverified MOQ, lead time, price, dimension or certification;
- supports SKU lookup, product comparison, finish/material states, documents, OEM/ODM, projects and human handoff;
- supports English, German and Japanese answer language;
- is **not** connected to a live LLM, human agent, CRM or handoff queue unless environment variables are configured.

The original OLANG site's smart-service widget is third-party hosted (300.cn smart service + NetEase NIM SDK); it is **not reused or cloned**. The new implementation is a separate grounded prototype. See `research/original_audit_2026-11-15/ORIGINAL_SITE_AUDIT.md`.

## 7. Analytics and privacy

- Consent is opt-in; no event is stored before consent.
- `/api/events` enforces a strict event-name and property allowlist, drops PII fields and uses anonymous visitor/session IDs.
- Event dictionary: `../deliverables/06_Website_QA/event-dictionary.md`.
- QA synthetic data: `../deliverables/06_Website_QA/analytics-export.csv`, `analytics-summary.json`, `analytics-analysis.md`.
- The analysis explicitly states that the data is scripted QA, not real visitors or market evidence.
- No analytics provider key, advertising pixel, CRM or email provider is configured.

## 8. Not connected / limitations

- **Public production deployment:** not performed. The application is a local Node/SQLite prototype. The prior Cloudflare Pages prototype cannot run this backend.
- **Email/CRM/ERP:** outbox locally only; no SMTP/CRM delivery.
- **Real customer service:** no live human staffing or third-party chat service.
- **Company legal operator / registration / DPAs:** not confirmed.
- **Product technical values:** still missing for most SKUs; the product-page fields state this honestly.
- **Native language review:** Japanese/English/German copy is AI-assisted and should be reviewed by native commercial speakers; Japanese company copy is partly machine-translated with manual headline edits.
- **Photo rights:** all OLANG product imagery is used from public pages for this academic prototype and remains subject to OLANG authorization. The reference library is third-party brand photography used only for the classroom demonstration; they must not be used for a public or commercial deployment.
- **AIGC assets:** prior generated backgrounds/composites are retired from the site; model/platform terms still apply to those archived assets.
- **Accessibility:** Lighthouse desktop/mobile scores and axe results are in `../deliverables/06_Website_QA/`; remaining findings must be fixed before public use.
- **Performance:** measured locally with Lighthouse; see QA files. Real CDN/network performance is not measured.

## 9. Deployment outline

This is a Node server with a local SQLite database and private filesystem uploads. A production deployment needs:

1. a Node-capable host with a persistent disk/volume for SQLite and uploads (or a managed database migration);
2. HTTPS and a trusted reverse proxy;
3. `SITE_MODE=production`, `SITE_URL=https://...`, secure cookies, real SMTP and CRM configuration;
4. an email/CRM adapter with a signed webhook;
5. a real legal operator, privacy policy, retention schedule and DPAs;
6. a WAF/CDN configuration that does not block legitimate B2B traffic;
7. native language and product-data review before launch.

Environment variables are documented in `.env.example`.

A Dockerfile/compose file is included for a single-node evaluation deployment. The database volume starts empty, so initialise it before exposing the service:

```powershell
docker compose build
docker compose run --rm olang node scripts/migrate.js
docker compose run --rm olang node scripts/seed.js
docker compose up -d
```

This still does not provide SMTP, CRM, object storage, backups or a production reverse proxy by itself.

## 10. Evidence and research

- Original-site audit: `research/original_audit_2026-11-15/ORIGINAL_SITE_AUDIT.md`
- Competitor evidence: `research/competitor_2026-11-15/COMPETITOR_EVIDENCE.md`
- Retail display scan: `research/competitor_2026-11-15/RETAIL_SCAN.md` and `retail_scan.csv`
- Product library: `../deliverables/03_Product_Library/`
- AIGC library: `../deliverables/07_AIGC/`
- QA/test/screenshots: `../deliverables/06_Website_QA/`
- Prior project documents/reports remain in `documentation/`, `report/` and `presentation/`. They are from earlier coursework phases and are not this round's website deliverables.
