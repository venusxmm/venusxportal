import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0011_creator_private_details.sql"),
  "utf8",
);

describe("creator privacy migration", () => {
  it("moves internal creator fields out of rows readable by creator accounts", () => {
    const tableLock = migration.indexOf("lock table public.creators in share row exclusive mode");
    expect(migration).toMatch(/create table if not exists public\.creator_private_details/i);
    expect(migration).toMatch(
      /alter table public\.creator_private_details enable row level security/i,
    );
    expect(migration).toMatch(
      /public\.has_role\(auth\.uid\(\), 'employee'\)\s+and public\.can_access_creator\(creator_id\)/i,
    );
    expect(migration).toMatch(
      /for insert to authenticated\s+with check \(\s*public\.is_active_member\(auth\.uid\(\)\)/i,
    );
    expect(migration).toMatch(
      /for update to authenticated\s+using \(\s*public\.is_active_member\(auth\.uid\(\)\)/i,
    );
    expect(migration).toMatch(
      /for delete to authenticated\s+using \(\s*public\.is_active_member\(auth\.uid\(\)\)/i,
    );
    expect(migration).toMatch(
      /internal_notes = coalesce\(excluded\.internal_notes, creator_private_details\.internal_notes\)/i,
    );
    expect(migration).toMatch(
      /internal_photo_path = coalesce\(excluded\.internal_photo_path, creator_private_details\.internal_photo_path\)/i,
    );

    const backfill = migration.indexOf("insert into public.creator_private_details");
    const dropNotes = migration.indexOf("drop column if exists internal_notes");
    const dropPhoto = migration.indexOf("drop column if exists internal_photo_path");
    expect(tableLock).toBeGreaterThanOrEqual(0);
    expect(tableLock).toBeLessThan(backfill);
    expect(tableLock).toBeLessThan(dropNotes);
    expect(tableLock).toBeLessThan(dropPhoto);
    expect(backfill).toBeGreaterThan(-1);
    expect(backfill).toBeLessThan(dropNotes);
    expect(backfill).toBeLessThan(dropPhoto);
  });

  it("limits task comment reads to active staff who can see the task", () => {
    const policy = migration.slice(migration.indexOf('create policy "comments read"'));

    expect(policy).toMatch(/create policy "comments read"/i);
    expect(policy).toMatch(/public\.is_active_member\(auth\.uid\(\)\)/i);
    expect(policy).toMatch(/public\.is_executive\(\)/i);
    expect(policy).toMatch(/public\.has_role\(auth\.uid\(\), 'employee'\)/i);
    expect(policy).toMatch(/public\.can_see_task\(task_id\)/i);
    expect(policy).not.toMatch(/public\.is_own_creator/i);
  });
});
