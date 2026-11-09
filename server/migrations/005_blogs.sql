-- Company engineering blogs: feed sources and the post metadata we index from them.
-- Only metadata is stored (title, link, date, a short plain-text excerpt, tags, repos);
-- full articles are never stored or republished.

CREATE TABLE blog_sources (
  id              SERIAL PRIMARY KEY,
  company         TEXT NOT NULL,
  feed_url        TEXT NOT NULL UNIQUE,
  active          BOOLEAN NOT NULL DEFAULT true,
  last_fetched_at TIMESTAMPTZ,              -- last successful fetch + parse
  last_error      TEXT,                     -- last failure message, NULL after a success
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE blog_posts (
  id           BIGSERIAL PRIMARY KEY,
  source_id    INTEGER NOT NULL REFERENCES blog_sources (id) ON DELETE CASCADE,
  url          TEXT NOT NULL UNIQUE,        -- canonical URL: the dedupe key
  title        TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  excerpt      TEXT NOT NULL DEFAULT '',    -- plain text, ~300 chars max
  tags         TEXT[] NOT NULL DEFAULT '{}',
  repos        TEXT[] NOT NULL DEFAULT '{}',-- lowercased "owner/repo" mentioned in the post
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX blog_posts_published_idx ON blog_posts (published_at DESC NULLS LAST);
CREATE INDEX blog_posts_repos_idx ON blog_posts USING GIN (repos);
CREATE INDEX blog_posts_source_idx ON blog_posts (source_id);

-- Seed feeds verified to return a parseable feed on 2026-11-08. Not seeded:
--   https://medium.com/airbnb-engineering/feed   (returns an HTML page, not a feed)
--   https://www.uber.com/blog/engineering/rss/   (404)
INSERT INTO blog_sources (company, feed_url) VALUES
  ('Netflix',    'https://netflixtechblog.com/feed'),
  ('Cloudflare', 'https://blog.cloudflare.com/rss/'),
  ('GitHub',     'https://github.blog/engineering/feed/'),
  ('Stripe',     'https://stripe.com/blog/feed.rss')
ON CONFLICT (feed_url) DO NOTHING;
