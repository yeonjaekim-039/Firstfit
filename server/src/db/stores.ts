import type pg from 'pg';
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

export interface UserStore {
  getProfile(id: number): Promise<UserProfile | null>;
}

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
  total: string;
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

      const { rows } = await pool.query<IssueRow>(
        `SELECT i.id, i.number, i.title, i.url, i.labels, i.language, i.difficulty, i.assignee,
                i.comment_count, i.github_created_at, i.github_updated_at,
                r.full_name AS repo_full_name, r.html_url AS repo_url,
                count(*) OVER () AS total
           FROM issues i
           JOIN repos r ON r.id = i.repo_id
          WHERE ${where.join(' AND ')}
          ORDER BY i.github_updated_at DESC
          LIMIT $${params.length}`,
        params,
      );

      return {
        total: rows.length ? Number(rows[0]!.total) : 0,
        rows: rows.map((r) => ({
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
        })),
      };
    },
  };
}

export function createUserStore(pool: pg.Pool): UserStore {
  return {
    async getProfile(id) {
      const { rows } = await pool.query<{
        skills: string[];
        preferred_languages: string[];
        difficulty_level: Difficulty;
      }>('SELECT skills, preferred_languages, difficulty_level FROM users WHERE id = $1', [id]);
      const row = rows[0];
      if (!row) return null;
      return { skills: row.skills, preferredLanguages: row.preferred_languages, difficulty: row.difficulty_level };
    },
  };
}
