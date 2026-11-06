CREATE TYPE difficulty_level AS ENUM ('easy', 'medium', 'hard');

CREATE TABLE repos (
  id            SERIAL PRIMARY KEY,
  full_name     TEXT NOT NULL UNIQUE,          -- "owner/name"
  owner         TEXT NOT NULL,
  name          TEXT NOT NULL,
  html_url      TEXT NOT NULL,
  language      TEXT,                          -- language the repo was discovered under
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE issues (
  id                 BIGINT PRIMARY KEY,       -- GitHub's issue id
  repo_id            INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  number             INTEGER NOT NULL,
  title              TEXT NOT NULL,
  url                TEXT NOT NULL,
  body_length        INTEGER NOT NULL DEFAULT 0,
  labels             TEXT[] NOT NULL DEFAULT '{}', -- lowercased label names
  language           TEXT,
  comment_count      INTEGER NOT NULL DEFAULT 0,
  state              TEXT NOT NULL DEFAULT 'open',
  assignee           TEXT,                     -- GitHub login, NULL if unassigned
  difficulty         difficulty_level NOT NULL,
  github_created_at  TIMESTAMPTZ NOT NULL,
  github_updated_at  TIMESTAMPTZ NOT NULL,
  ingested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo_id, number)
);

CREATE INDEX issues_language_idx ON issues (language);
CREATE INDEX issues_difficulty_idx ON issues (difficulty);
CREATE INDEX issues_labels_idx ON issues USING GIN (labels);
CREATE INDEX issues_updated_idx ON issues (github_updated_at DESC);
CREATE INDEX issues_open_unassigned_idx ON issues (github_updated_at DESC)
  WHERE state = 'open' AND assignee IS NULL;

CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  github_login         TEXT UNIQUE,
  display_name         TEXT,
  skills               TEXT[] NOT NULL DEFAULT '{}',
  preferred_languages  TEXT[] NOT NULL DEFAULT '{}',
  difficulty_level     difficulty_level NOT NULL DEFAULT 'easy',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE saved_issues (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issue_id  BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  note      TEXT,
  saved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, issue_id)
);

CREATE INDEX saved_issues_issue_idx ON saved_issues (issue_id);
