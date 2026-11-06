import type pg from 'pg';
import type { GitHubProfile } from '../auth/githubOAuth.js';
import type { ScorableIssue, UserProfile } from '../domain/scoring.js';
import type { Difficulty } from '../domain/types.js';

export interface IssueRecord extends ScorableIssue {
  number: number;
  url: string;
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
  repoUrl: string;
}

export interface IssueFilters {
  languages?: string[];
  labels?: string[];
  difficulties?: Difficulty[];
}

export interface CandidateResult {
  rows: IssueRecord[];
  /** Total rows matching the filters, before the candidate limit. */
  total: number;
}

export interface IssueStore {
  findCandidates(filters: IssueFilters, limit: number): Promise<CandidateResult>;
}

export interface UserRecord {
  id: number;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  skills: string[];
  preferredLanguages: string[];
  difficulty: Difficulty;
}

export interface ProfileUpdate {
  skills: string[];
  preferredLanguages: string[];
  difficulty: Difficulty;
}

export interface UserStore {
  getProfile(id: number): Promise<UserProfile | null>;
  getUser(id: number): Promise<UserRecord | null>;
  /** Creates or updates the user for a GitHub account; returns the local user id. */
  upsertGithubUser(profile: GitHubProfile): Promise<number>;
  updateProfile(id: number, update: ProfileUpdate): Promise<UserRecord | null>;
}

export interface SavedIssueRecord extends IssueRecord {
  savedAt: Date;
}

export interface SavedStore {
  /** Saved issues that are still open, newest save first, plus how many saved issues have since closed. */
  list(userId: number): Promise<{ rows: SavedIssueRecord[]; hiddenClosed: number }>;
  ids(userId: number): Promise<number[]>;
  /** Returns false when the issue doesn't exist or isn't open. */
  save(userId: number, issueId: number): Promise<boolean>;
  remove(userId: number, issueId: number): Promise<void>;
}

const ISSUE_COLUMNS = `
  i.id, i.number, i.title, i.url, i.labels, i.language, i.difficulty, i.assignee,
  i.comment_count, i.github_created_at, i.github_updated_at,
  r.full_name AS repo_full_name, r.html_url AS repo_url`;

interface IssueRow {
  id: string; // BIGINT comes back as string
  number: number;
  title: string;
  url: string;
  labels: string[];
  language: string | null;
  difficulty: Difficulty;
  assignee: string | null;
  comment_count: number;
  github_created_at: Date;
  github_updated_at: Date;
  repo_full_name: string;
  repo_url: string;
}

function toIssueRecord(r: IssueRow): IssueRecord {
  return {
    id: Number(r.id),
    number: r.number,
    title: r.title,
    url: r.url,
    labels: r.labels,
    language: r.language,
    difficulty: r.difficulty,
    assignee: r.assignee,
    commentCount: r.comment_count,
    createdAt: r.github_created_at,
    updatedAt: r.github_updated_at,
    repoFullName: r.repo_full_name,
    repoUrl: r.repo_url,
  };
}

export function createIssueStore(pool: pg.Pool): IssueStore {
  return {
    async findCandidates(filters, limit) {
      const where = ["i.state = 'open'", 'i.assignee IS NULL'];
      const params: unknown[] = [];
      const add = (clause: (p: string) => string, value: unknown) => {
        params.push(value);
        where.push(clause('$' + params.length));
      };

      if (filters.languages?.length) add((p) => `lower(i.language) = ANY(${p})`, filters.languages.map((l) => l.toLowerCase()));
      if (filters.labels?.length) add((p) => `i.labels && ${p}::text[]`, filters.labels.map((l) => l.toLowerCase()));
      if (filters.difficulties?.length) add((p) => `i.difficulty = ANY(${p}::difficulty_level[])`, filters.difficulties);
      params.push(limit);

      const { rows } = await pool.query<IssueRow & { total: string }>(
        `SELECT ${ISSUE_COLUMNS}, count(*) OVER () AS total
           FROM issues i
           JOIN repos r ON r.id = i.repo_id
          WHERE ${where.join(' AND ')}
          ORDER BY i.github_updated_at DESC
          LIMIT $${params.length}`,
        params,
      );

      return { total: rows.length ? Number(rows[0]!.total) : 0, rows: rows.map(toIssueRecord) };
    },
  };
}

interface UserRow {
  id: number;
  github_login: string | null;
  display_name: string | null;
  avatar_url: string | null;
  skills: string[];
  preferred_languages: string[];
  difficulty_level: Difficulty;
}

const USER_COLUMNS = 'id, github_login, display_name, avatar_url, skills, preferred_languages, difficulty_level';

function toUserRecord(r: UserRow): UserRecord {
  return {
    id: r.id,
    login: r.github_login,
    name: r.display_name,
    avatarUrl: r.avatar_url,
    skills: r.skills,
    preferredLanguages: r.preferred_languages,
    difficulty: r.difficulty_level,
  };
}

export function createUserStore(pool: pg.Pool): UserStore {
  const getUser = async (id: number) => {
    const { rows } = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows[0] ? toUserRecord(rows[0]) : null;
  };

  return {
    getUser,

    async getProfile(id) {
      const user = await getUser(id);
      if (!user) return null;
      return { skills: user.skills, preferredLanguages: user.preferredLanguages, difficulty: user.difficulty };
    },

    async upsertGithubUser(p) {
      // Keyed on github_id so a renamed GitHub login still maps to the same local user.
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO users (github_id, github_login, display_name, avatar_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (github_id) DO UPDATE
           SET github_login = EXCLUDED.github_login,
               display_name = EXCLUDED.display_name,
               avatar_url = EXCLUDED.avatar_url,
               updated_at = now()
         RETURNING id`,
        [p.id, p.login, p.name, p.avatarUrl],
      );
      return rows[0]!.id;
    },

    async updateProfile(id, u) {
      const { rows } = await pool.query<UserRow>(
        `UPDATE users SET skills = $2, preferred_languages = $3, difficulty_level = $4, updated_at = now()
          WHERE id = $1 RETURNING ${USER_COLUMNS}`,
        [id, u.skills, u.preferredLanguages, u.difficulty],
      );
      return rows[0] ? toUserRecord(rows[0]) : null;
    },
  };
}

export function createSavedStore(pool: pg.Pool): SavedStore {
  return {
    async list(userId) {
      const { rows } = await pool.query<IssueRow & { saved_at: Date }>(
        `SELECT ${ISSUE_COLUMNS}, s.saved_at
           FROM saved_issues s
           JOIN issues i ON i.id = s.issue_id
           JOIN repos r ON r.id = i.repo_id
          WHERE s.user_id = $1 AND i.state = 'open'
          ORDER BY s.saved_at DESC`,
        [userId],
      );
      const { rows: hidden } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM saved_issues s JOIN issues i ON i.id = s.issue_id
          WHERE s.user_id = $1 AND i.state <> 'open'`,
        [userId],
      );
      return {
        rows: rows.map((r) => ({ ...toIssueRecord(r), savedAt: r.saved_at })),
        hiddenClosed: Number(hidden[0]!.count),
      };
    },

    async ids(userId) {
      const { rows } = await pool.query<{ issue_id: string }>(
        `SELECT s.issue_id FROM saved_issues s JOIN issues i ON i.id = s.issue_id
          WHERE s.user_id = $1 AND i.state = 'open'`,
        [userId],
      );
      return rows.map((r) => Number(r.issue_id));
    },

    async save(userId, issueId) {
      const { rowCount } = await pool.query(
        `INSERT INTO saved_issues (user_id, issue_id)
         SELECT $1, id FROM issues WHERE id = $2 AND state = 'open'
         ON CONFLICT DO NOTHING`,
        [userId, issueId],
      );
      if (rowCount) return true;
      // Already saved counts as success (idempotent PUT).
      const { rowCount: exists } = await pool.query(
        'SELECT 1 FROM saved_issues WHERE user_id = $1 AND issue_id = $2',
        [userId, issueId],
      );
      return Boolean(exists);
    },

    async remove(userId, issueId) {
      await pool.query('DELETE FROM saved_issues WHERE user_id = $1 AND issue_id = $2', [userId, issueId]);
    },
  };
}
