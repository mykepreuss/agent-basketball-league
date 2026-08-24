import { createHash } from "node:crypto";

import postgres from "postgres";
import { z } from "zod";

const DigestSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const TableSnapshotSchema = z.strictObject({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  rowCount: z.number().int().nonnegative(),
  digest: DigestSchema,
});
const DatabaseSnapshotSchema = z.strictObject({
  postgresVersionNumber: z.number().int().positive(),
  tableCount: z.number().int().nonnegative(),
  tables: z.array(TableSnapshotSchema),
  catalogDigest: DigestSchema,
  databaseStateRoot: DigestSchema,
});

export type DatabaseSnapshot = z.infer<typeof DatabaseSnapshotSchema>;

export interface RecoveryAssessment {
  status: "PASS" | "FAIL";
  blockers: readonly string[];
  sourceEventCount: number;
  restoredEventCount: number;
  sourceOutboxCount: number;
  restoredOutboxCount: number;
  sourceStateRoot: string;
  restoredStateRoot: string;
  resultDigest: `0x${string}`;
}

function digest(parts: readonly string[]): `0x${string}` {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return `0x${hash.digest("hex")}`;
}

export function createDatabaseSnapshot(
  postgresVersionNumber: number,
  rowsByTable: Readonly<Record<string, readonly string[]>>,
  catalogRows: readonly string[] = [],
): DatabaseSnapshot {
  const tables = Object.entries(rowsByTable)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, rows]) => {
      const parsedName = TableSnapshotSchema.shape.name.parse(name);
      const orderedRows = [...rows].sort();
      return {
        name: parsedName,
        rowCount: orderedRows.length,
        digest: digest([parsedName, ...orderedRows]),
      };
    });
  const catalogDigest = digest([...catalogRows].sort());
  return DatabaseSnapshotSchema.parse({
    postgresVersionNumber,
    tableCount: tables.length,
    tables,
    catalogDigest,
    databaseStateRoot: digest([
      catalogDigest,
      ...tables.flatMap(({ name, rowCount, digest: tableDigest }) => [
        name,
        rowCount.toString(),
        tableDigest,
      ]),
    ]),
  });
}

function tableRowCount(snapshot: DatabaseSnapshot, name: string): number {
  return snapshot.tables.find((table) => table.name === name)?.rowCount ?? 0;
}

export function assessRecovery(
  sourceCandidate: unknown,
  restoredCandidate: unknown,
  expectedTableCount: number,
  expectedPostgresMajor: number,
): RecoveryAssessment {
  const source = DatabaseSnapshotSchema.parse(sourceCandidate);
  const restored = DatabaseSnapshotSchema.parse(restoredCandidate);
  const blockers: string[] = [];
  const sourceMajor = Math.floor(source.postgresVersionNumber / 10_000);
  const restoredMajor = Math.floor(restored.postgresVersionNumber / 10_000);

  if (sourceMajor !== expectedPostgresMajor)
    blockers.push("source PostgreSQL major version differs from policy");
  if (restoredMajor !== expectedPostgresMajor)
    blockers.push("restored PostgreSQL major version differs from policy");
  if (source.tableCount !== expectedTableCount)
    blockers.push("source public table count differs from migration contract");
  if (restored.tableCount !== expectedTableCount)
    blockers.push(
      "restored public table count differs from migration contract",
    );
  if (JSON.stringify(source.tables) !== JSON.stringify(restored.tables))
    blockers.push("restored table contents differ from source");
  if (source.catalogDigest !== restored.catalogDigest)
    blockers.push(
      "restored schema, index, constraint, or sequence catalog differs",
    );
  if (source.databaseStateRoot !== restored.databaseStateRoot)
    blockers.push(
      "clean-room restore did not reproduce the database state root",
    );

  const stableResult = {
    source,
    restored,
    expectedTableCount,
    expectedPostgresMajor,
    blockers,
  };
  return {
    status: blockers.length === 0 ? "PASS" : "FAIL",
    blockers,
    sourceEventCount: tableRowCount(source, "recognized_events"),
    restoredEventCount: tableRowCount(restored, "recognized_events"),
    sourceOutboxCount: tableRowCount(source, "canonical_outbox"),
    restoredOutboxCount: tableRowCount(restored, "canonical_outbox"),
    sourceStateRoot: source.databaseStateRoot,
    restoredStateRoot: restored.databaseStateRoot,
    resultDigest: digest([JSON.stringify(stableResult)]),
  };
}

function assertDirectTlsConnection(connectionUrl: string): URL {
  const parsed = z.url().parse(connectionUrl);
  const url = new URL(parsed);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Recovery database URL must use PostgreSQL");
  if (url.hostname.includes("-pooler"))
    throw new Error("Recovery verification requires a direct connection");
  if (
    !["require", "verify-ca", "verify-full"].includes(
      url.searchParams.get("sslmode") ?? "",
    )
  )
    throw new Error("Recovery database URL must require TLS");
  return url;
}

export async function collectDatabaseSnapshot(
  connectionUrl: string,
): Promise<DatabaseSnapshot> {
  assertDirectTlsConnection(connectionUrl);
  const sql = postgres(connectionUrl, {
    max: 1,
    prepare: false,
    ssl: "require",
  });
  try {
    const versionRows = await sql`
      select current_setting('server_version_num')::integer as server_version_number
    `;
    const postgresVersionNumber = z.coerce
      .number()
      .int()
      .positive()
      .parse(versionRows[0]?.server_version_number);
    const tableRows = await sql`
      select tablename
      from pg_catalog.pg_tables
      where schemaname = 'public'
      order by tablename
    `;
    const tableNames = tableRows.map((row) =>
      TableSnapshotSchema.shape.name.parse(row.tablename),
    );
    const [columnRows, constraintRows, indexRows, sequenceRows] =
      await Promise.all([
        sql`
          select jsonb_build_object(
            'kind', 'column',
            'table', table_name,
            'column', column_name,
            'ordinal', ordinal_position,
            'dataType', data_type,
            'nullable', is_nullable,
            'default', column_default
          )::text as row_json
          from information_schema.columns
          where table_schema = 'public'
          order by table_name, ordinal_position
        `,
        sql`
          select jsonb_build_object(
            'kind', 'constraint',
            'table', table_name,
            'name', constraint_name,
            'type', constraint_type
          )::text as row_json
          from information_schema.table_constraints
          where table_schema = 'public'
          order by table_name, constraint_name
        `,
        sql`
          select jsonb_build_object(
            'kind', 'index',
            'table', tablename,
            'name', indexname,
            'definition', indexdef
          )::text as row_json
          from pg_catalog.pg_indexes
          where schemaname = 'public'
          order by tablename, indexname
        `,
        sql`
          select jsonb_build_object(
            'kind', 'sequence',
            'name', sequencename,
            'start', start_value,
            'minimum', min_value,
            'maximum', max_value,
            'increment', increment_by,
            'cycle', cycle,
            'cache', cache_size,
            'last', last_value
          )::text as row_json
          from pg_catalog.pg_sequences
          where schemaname = 'public'
          order by sequencename
        `,
      ]);
    const catalogRows = [
      ...columnRows,
      ...constraintRows,
      ...indexRows,
      ...sequenceRows,
    ].map((row) => z.string().parse(row.row_json));
    const rowsByTable: Record<string, string[]> = {};
    for (const tableName of tableNames) {
      const rows = await sql.unsafe(
        `select row_to_json(t)::text as row_json from "public"."${tableName}" as t order by row_to_json(t)::text`,
      );
      rowsByTable[tableName] = rows.map((row) =>
        z.string().parse(row.row_json),
      );
    }
    return createDatabaseSnapshot(
      postgresVersionNumber,
      rowsByTable,
      catalogRows,
    );
  } finally {
    await sql.end();
  }
}

export function assertDistinctRecoveryTargets(
  sourceUrl: string,
  restoredUrl: string,
): void {
  const source = assertDirectTlsConnection(sourceUrl);
  const restored = assertDirectTlsConnection(restoredUrl);
  if (
    source.hostname === restored.hostname &&
    source.pathname === restored.pathname
  )
    throw new Error("Source and restored databases must be distinct targets");
}
