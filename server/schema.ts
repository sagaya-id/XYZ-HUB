// Schema for XYZ Project Hub (Cloudflare D1 / SQLite).
// Executed idempotently at worker bootstrap so the deployed database can be
// initialised from controlled server-side code.
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    tagline TEXT,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('MA','SA','PA')),
    entity_id TEXT,
    job_title TEXT,
    phone TEXT,
    avatar_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    user_agent TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    location_text TEXT,
    cover_id TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Berjalan',
    start_date TEXT,
    end_date TEXT,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team','entity')),
    archived_at TEXT,
    deleted_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    access TEXT NOT NULL DEFAULT 'member' CHECK (access IN ('admin','member')),
    is_primary_pic INTEGER NOT NULL DEFAULT 0,
    added_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (project_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS project_kpis (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    label TEXT NOT NULL,
    unit TEXT,
    target_value REAL NOT NULL DEFAULT 0,
    current_value REAL NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    is_done INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    board_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    due_date TEXT,
    assignee_id TEXT,
    position REAL NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS task_checklist (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    text TEXT NOT NULL,
    is_done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS task_attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS event_categories (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    project_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    start_local TEXT NOT NULL,
    end_local TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    category_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'entity' CHECK (visibility IN ('team','entity')),
    location TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    cancelled_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    project_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'point' CHECK (type IN ('point','line','polygon')),
    geojson TEXT NOT NULL,
    lon REAL,
    lat REAL,
    visibility TEXT NOT NULL DEFAULT 'entity' CHECK (visibility IN ('team','entity')),
    google_maps_url TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS location_photos (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    caption TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS logbooks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    location_id TEXT,
    visit_date TEXT NOT NULL,
    visit_time TEXT,
    staff_id TEXT,
    activity_type TEXT,
    observations TEXT,
    indicators TEXT,
    follow_up TEXT,
    gps_lat REAL,
    gps_lng REAL,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team','entity')),
    created_by TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS logbook_photos (
    id TEXT PRIMARY KEY,
    logbook_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS budgets (
    project_id TEXT PRIMARY KEY,
    amount REAL NOT NULL DEFAULT 0,
    is_confirmed INTEGER NOT NULL DEFAULT 0,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team','entity')),
    updated_by TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS budget_history (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    amount REAL NOT NULL,
    is_confirmed INTEGER NOT NULL,
    visibility TEXT NOT NULL,
    note TEXT,
    changed_by TEXT,
    changed_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team','entity')),
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS data_fields (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    position INTEGER NOT NULL DEFAULT 0,
    sensitive INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS data_records (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    data TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team','entity')),
    row_source TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS data_imports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT,
    filename TEXT,
    source TEXT NOT NULL DEFAULT 'file',
    mode TEXT NOT NULL,
    inserted INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sheet_links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    worksheet TEXT,
    mapping TEXT,
    last_sync_at TEXT,
    status TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    entity_id TEXT,
    project_id TEXT,
    dedupe_key TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, dedupe_key)
  )`,
  `CREATE TABLE IF NOT EXISTS notification_prefs (
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, type)
  )`,
  `CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    object_key TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    entity_id TEXT,
    project_id TEXT,
    uploaded_by TEXT,
    visibility TEXT NOT NULL DEFAULT 'entity',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    project_id TEXT,
    title TEXT NOT NULL,
    body TEXT,
    remind_at TEXT NOT NULL,
    done_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reminder_settings (
    user_id TEXT PRIMARY KEY,
    lead_days INTEGER NOT NULL DEFAULT 3,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS holidays (
    date TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'verified'
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    actor_name TEXT,
    entity_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    summary TEXT,
    meta TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projects_entity ON projects(entity_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_members_project ON project_members(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(board_id, position)`,
  `CREATE INDEX IF NOT EXISTS idx_events_start ON events(entity_id, start_local)`,
  `CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_locations_project ON locations(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_logbooks_project ON logbooks(project_id, visit_date)`,
  `CREATE INDEX IF NOT EXISTS idx_records_project ON data_records(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id, remind_at)`,
]

// Raw SQL file used for the optional local `wrangler d1 execute` path.
export const SCHEMA_SQL = SCHEMA.join(';\n') + ';'
