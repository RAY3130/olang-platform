PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','content_manager','sales_manager','sales_staff')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS category_translations (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (category_id, locale)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  series TEXT,
  collection TEXT,
  image_path TEXT,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  source_checked_at TEXT,
  source_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_published ON products(published);

CREATE TABLE IF NOT EXISTS product_translations (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  name TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  translation_status TEXT NOT NULL DEFAULT 'draft' CHECK (translation_status IN ('draft','ai_draft','reviewed','approved')),
  PRIMARY KEY (product_id, locale)
);

CREATE TABLE IF NOT EXISTS product_attributes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attr_key TEXT NOT NULL,
  value TEXT,
  unit TEXT,
  status TEXT NOT NULL DEFAULT 'available_on_request'
    CHECK (status IN ('verified','company_provided','confirmed','reference','pending_verification','available_on_request','not_applicable','customizable')),
  source_note TEXT,
  data_source TEXT,
  last_verified_at TEXT,
  internal_note TEXT,
  visible_frontend INTEGER NOT NULL DEFAULT 1 CHECK (visible_frontend IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, attr_key)
);
CREATE INDEX IF NOT EXISTS idx_attr_status ON product_attributes(status);

CREATE TABLE IF NOT EXISTS finishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_de TEXT NOT NULL,
  name_it TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_finishes (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  finish_id INTEGER NOT NULL REFERENCES finishes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'company_provided'
    CHECK (status IN ('verified','company_provided','confirmed','reference','pending_verification','available_on_request','not_applicable','customizable')),
  note TEXT,
  PRIMARY KEY (product_id, finish_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN (
    'catalogue','spec_sheet','installation','care','test_report','certificate','packaging','oem'
  )),
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  version TEXT NOT NULL DEFAULT 'Not published',
  language TEXT NOT NULL DEFAULT 'en',
  markets TEXT NOT NULL DEFAULT '["global"]',
  visibility TEXT NOT NULL DEFAULT 'request' CHECK (visibility IN ('public','request','internal')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('available','request_only','pending','withdrawn')),
  file_path TEXT,
  original_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  effective_date TEXT,
  notes TEXT,
  supersedes_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status, visibility);
CREATE INDEX IF NOT EXISTS idx_documents_product ON documents(product_id);

CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  is_test INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL CHECK (type IN (
    'wholesale','oem','project','product_info','document_request','general','privacy'
  )),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','reviewing','need_more_info','quoted','negotiating','won','lost','archived'
  )),
  name TEXT NOT NULL,
  company TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  country TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'en',
  locale TEXT NOT NULL DEFAULT 'en',
  source_page TEXT,
  source_path TEXT,
  message TEXT NOT NULL,
  consent INTEGER NOT NULL CHECK (consent IN (0,1)),
  consent_at TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  device TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  retention_until TEXT
);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_type ON inquiries(type);
CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_email ON inquiries(email);
CREATE INDEX IF NOT EXISTS idx_inquiries_is_test ON inquiries(is_test);

CREATE TABLE IF NOT EXISTS market_profiles (
  market TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  unit_system TEXT NOT NULL,
  currency TEXT NOT NULL,
  compliance_en TEXT, compliance_de TEXT, compliance_it TEXT,
  trade_terms TEXT,
  document_language TEXT,
  response_time TEXT,
  sample_port TEXT,
  focus TEXT,
  badge TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_market_fit (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  fit_level TEXT NOT NULL CHECK (fit_level IN ('ready','quote','request')),
  tags_json TEXT,
  reason TEXT,
  priority INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, market)
);
CREATE TABLE IF NOT EXISTS localized_faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS official_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL UNIQUE,
  sku TEXT NOT NULL, source_url TEXT, path TEXT NOT NULL, width INTEGER, height INTEGER,
  sha256 TEXT, downloaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS official_colors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, official_label TEXT NOT NULL UNIQUE,
  display_label TEXT NOT NULL, kind TEXT NOT NULL, chip_path TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS product_colors (
  product_id INTEGER NOT NULL, color_id INTEGER NOT NULL, sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (product_id, color_id)
);

CREATE TABLE IF NOT EXISTS product_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('main','angle','scene','detail')),
  scene_type TEXT,
  market TEXT,
  file_path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt_en TEXT, alt_de TEXT, alt_it TEXT,
  caption_en TEXT, caption_de TEXT, caption_it TEXT,
  source_type TEXT NOT NULL,
  licence TEXT,
  tool TEXT, tool_version TEXT, prompt TEXT, seed TEXT,
  product_visible INTEGER DEFAULT 0,
  scale_note TEXT,
  review_status TEXT DEFAULT 'pending',
  reviewer TEXT, reviewed_at TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_product_media_product ON product_media(product_id, market, scene_type);

CREATE TABLE IF NOT EXISTS image_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  product_id INTEGER,
  category_key TEXT,
  source_type TEXT NOT NULL,
  licence TEXT NOT NULL,
  source_url TEXT,
  attribution TEXT,
  prompt TEXT,
  seed TEXT,
  model TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  shows_product INTEGER NOT NULL DEFAULT 0,
  used_on TEXT,
  status TEXT NOT NULL DEFAULT 'reference_assumption',
  natural_width INTEGER,
  natural_height INTEGER,
  aspect_ratio REAL,
  checked_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_image_assets_kind ON image_assets(kind);

CREATE TABLE IF NOT EXISTS inquiry_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inquiry_items_inquiry ON inquiry_items(inquiry_id);

CREATE TABLE IF NOT EXISTS inquiry_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE (inquiry_id, field_key)
);

CREATE TABLE IF NOT EXISTS inquiry_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_inquiry ON inquiry_attachments(inquiry_id);

CREATE TABLE IF NOT EXISTS inquiry_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inquiry_notes_inquiry ON inquiry_notes(inquiry_id);

CREATE TABLE IF NOT EXISTS inquiry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  page_type TEXT,
  market TEXT,
  locale TEXT,
  product_sku TEXT,
  referrer TEXT,
  device TEXT,
  country TEXT,
  consent INTEGER NOT NULL DEFAULT 0 CHECK (consent IN (0,1)),
  props_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_market ON analytics_events(market);
CREATE INDEX IF NOT EXISTS idx_events_product ON analytics_events(product_sku);

CREATE TABLE IF NOT EXISTS consent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL UNIQUE,
  analytics INTEGER NOT NULL CHECK (analytics IN (0,1)),
  necessary INTEGER NOT NULL DEFAULT 1 CHECK (necessary IN (0,1)),
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_key TEXT NOT NULL,
  locale TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT '*',
  block_key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (page_key, locale, market, block_key)
);
CREATE INDEX IF NOT EXISTS idx_content_lookup ON content_blocks(page_key, locale, market);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS faq_translations (
  faq_id INTEGER NOT NULL REFERENCES faqs(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ai_draft' CHECK (status IN ('draft','ai_draft','reviewed','approved')),
  PRIMARY KEY (faq_id, locale)
);

CREATE TABLE IF NOT EXISTS case_studies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  summary_de TEXT NOT NULL DEFAULT '',
  summary_it TEXT NOT NULL DEFAULT '',
  market TEXT,
  location TEXT,
  project_type TEXT,
  products TEXT,
  year TEXT,
  image_path TEXT,
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('verified','company_published','pending')),
  authorization_reference TEXT,
  authorization_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (authorization_confirmed IN (0,1)),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_settings (
  market TEXT PRIMARY KEY,
  unit_system TEXT NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric','imperial')),
  currency TEXT NOT NULL DEFAULT 'EUR',
  accent TEXT NOT NULL DEFAULT '#8B6A37',
  accent_soft TEXT NOT NULL DEFAULT '#F0E8DA',
  compliance_en TEXT NOT NULL DEFAULT '',
  compliance_de TEXT NOT NULL DEFAULT '',
  compliance_it TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_featured_products (
  market TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (market, product_id)
);
CREATE INDEX IF NOT EXISTS idx_market_featured ON market_featured_products(market, sort_order);

CREATE TABLE IF NOT EXISTS news_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('company','industry')),
  published_at TEXT NOT NULL,
  image_path TEXT,
  source_url TEXT,
  source_checked_at TEXT,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles(published, published_at DESC);

CREATE TABLE IF NOT EXISTS news_translations (
  article_id INTEGER NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (article_id, locale)
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER REFERENCES inquiries(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('notification','acknowledgement','test')),
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','failed','not_configured')),
  provider TEXT,
  provider_id TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_outbox_inquiry ON email_outbox(inquiry_id);

CREATE TABLE IF NOT EXISTS assistant_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_redacted TEXT NOT NULL,
  market TEXT,
  locale TEXT,
  matched_type TEXT,
  matched_ref TEXT,
  answer_mode TEXT NOT NULL DEFAULT 'rules',
  needs_human INTEGER NOT NULL DEFAULT 0 CHECK (needs_human IN (0,1)),
  answered INTEGER NOT NULL DEFAULT 0 CHECK (answered IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistant_created ON assistant_queries(created_at);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('access','deletion','correction','objection')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','verifying','completed','rejected')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);


CREATE TABLE IF NOT EXISTS product_color_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  official_label TEXT NOT NULL,
  display_label TEXT NOT NULL,
  local_path TEXT NOT NULL,
  source_image_url TEXT NOT NULL DEFAULT '',
  source_page TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_gallery_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  source_url TEXT NOT NULL,
  local_path TEXT NOT NULL,
  color_label TEXT,
  image_type TEXT DEFAULT 'official',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_finish_photo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  finish_code TEXT NOT NULL,
  official_label TEXT NOT NULL,
  file_path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  md5 TEXT,
  is_shared INTEGER DEFAULT 0,
  source_url TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(product_id, finish_code)
);
