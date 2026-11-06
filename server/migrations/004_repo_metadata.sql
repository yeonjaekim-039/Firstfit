-- Repo quality signals, fetched once per repo during ingest (and refreshed when stale).
-- Repos GitHub no longer resolves are stored with archived = true so their issues are hidden.
ALTER TABLE repos
  ADD COLUMN stars               INTEGER,
  ADD COLUMN pushed_at           TIMESTAMPTZ,
  ADD COLUMN archived            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN metadata_fetched_at TIMESTAMPTZ;

CREATE INDEX repos_metadata_fetched_idx ON repos (metadata_fetched_at NULLS FIRST);
CREATE INDEX repos_archived_idx ON repos (id) WHERE archived;
