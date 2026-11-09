-- Hardening for company blogs.

-- 1. Post links come from untrusted feeds and end up in <a href>. canonicalUrl() only ever
--    produces https URLs; enforce that in the database too, so nothing else can be stored.
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_url_https CHECK (url ~ '^https://');

-- 2. The Tech Blogs page looks up open issues for the repos posts mention with
--    lower(r.full_name) = ANY(...). Without this index that walks every open issue (~300k).
CREATE INDEX repos_full_name_lower_idx ON repos (lower(full_name));
-- An expression index has no statistics until the table is analyzed; without them the planner
-- keeps walking issues in update order (measured: 263 ms before, 1 ms after on ~123k repos).
ANALYZE repos;

-- 3. Record the feeds that failed verification as inactive, so they're documented in the
--    table, never fetched, and can be re-enabled with an UPDATE if they start working.
INSERT INTO blog_sources (company, feed_url, active, last_error) VALUES
  ('Airbnb', 'https://medium.com/airbnb-engineering/feed', false,
   'Disabled 2026-11-08: returns an HTML page (HTTP 200, text/html), not a feed'),
  ('Uber', 'https://www.uber.com/blog/engineering/rss/', false,
   'Disabled 2026-11-08: HTTP 404, then 406 on recheck')
ON CONFLICT (feed_url) DO UPDATE SET active = false, last_error = EXCLUDED.last_error;
