# Database Schema

> last updated: 03/Nov/2026

## Table `profiles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `username` | `text` |  |
| `tiles` | `int4` |  |
| `xp` | `int4` |  |
| `correct` | `int4` |  |
| `judged` | `int4` |  |
| `can_lead` | `bool` |  |
| `created_at` | `timestamptz` |  |

## Table `saves`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `user_id` | `uuid` | Primary |
| `data` | `jsonb` |  |
| `updated_at` | `timestamptz` |  |

## Table `squads`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `leader_id` | `uuid` |  |
| `join_code` | `text` |  Unique |
| `created_at` | `timestamptz` |  |

## Table `squad_members`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `squad_id` | `uuid` |  |
| `user_id` | `uuid` | Primary |
| `role` | `text` |  |
| `joined_at` | `timestamptz` |  |

## Table `nasa_reports`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `squad_id` | `uuid` |  |
| `filed_by` | `uuid` |  |
| `ref` | `text` |  |
| `summary` | `text` |  |
| `job_count` | `int4` |  |
| `filed_at` | `timestamptz` |  |

## Table `jobs`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `squad_id` | `uuid` |  |
| `assigned_to` | `uuid` |  |
| `assigned_by` | `uuid` |  |
| `ra` | `float8` |  |
| `dec` | `float8` |  |
| `fov` | `float8` |  |
| `bands` | `_text` |  |
| `frames` | `jsonb` |  |
| `instructions` | `text` |  |
| `status` | `text` |  |
| `finding` | `text` |  Nullable |
| `notes` | `text` |  Nullable |
| `leader_note` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `submitted_at` | `timestamptz` |  Nullable |
| `verified_at` | `timestamptz` |  Nullable |
| `reported_at` | `timestamptz` |  Nullable |
| `report_id` | `uuid` |  Nullable |

## RLS Policies

### `profiles`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `profiles readable by players` | SELECT | authenticated | PERMISSIVE | `true` | — |

### `saves`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `own save` | SELECT | authenticated | PERMISSIVE | `(user_id = auth.uid())` | — |

### `squads`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `my squad` | SELECT | authenticated | PERMISSIVE | `is_squad_member(id)` | — |

### `squad_members`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `my squad roster` | SELECT | authenticated | PERMISSIVE | `is_squad_member(squad_id)` | — |

### `jobs`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `my jobs or squad jobs` | SELECT | authenticated | PERMISSIVE | `((assigned_to = auth.uid()) OR is_squad_leader(squad_id))` | — |

### `nasa_reports`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `my squad reports` | SELECT | authenticated | PERMISSIVE | `is_squad_member(squad_id)` | — |

