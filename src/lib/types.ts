export type Role = 'MA' | 'SA' | 'PA'

export type User = {
  id: string
  email: string
  name: string
  role: Role
  entity_id: string | null
  job_title: string | null
  phone: string | null
  avatar_id: string | null
  avatar_url?: string | null
  is_active: number
  created_at: string
  last_login_at?: string | null
  project_count?: number
  projects?: { project_id: string; title: string; access: string; is_primary_pic: number }[]
}

export type Entity = {
  id: string
  key: 'yayasan' | 'store'
  name: string
  tagline: string | null
  description: string | null
  sort_order: number
}

export type BrandingGlobal = {
  siteName: string
  eyebrow: string
  landingHeadline: string
  landingSubtitle: string
  footerText: string
  primaryColor: string
  logoFileId: string | null
  loginHeroFileId: string | null
  loginHeroUrl: string
  mapTileUrl: string
  mapAttribution: string
}

export type BrandingEntity = {
  key: string
  name: string
  headline: string
  slogan: string
  description: string
  cardPhotoFileId: string | null
  cardPhotoUrl: string
  bannerFileId: string | null
  logoFileId: string | null
  primaryColor: string
  footerText: string
}

export type Boot = {
  entities: Entity[]
  global: BrandingGlobal
  cards: Record<string, BrandingEntity>
  appEnv: string
}

export type ProjectSummary = {
  id: string
  entity_id: string
  code: string
  title: string
  category: string
  description: string | null
  location_text: string | null
  cover_id: string | null
  cover_url: string | null
  progress: number
  task_progress: number | null
  status: string
  start_date: string | null
  end_date: string | null
  visibility: 'team' | 'entity'
  archived_at: string | null
  member_count: number
  pic_name: string | null
  pic_avatar_url: string | null
  task_total: number
  task_done: number
  location_count: number
  logbook_count: number
  budget_amount: number | null
  budget_confirmed: number
  budget_visibility: 'team' | 'entity'
  is_member: boolean
  created_at: string
}

export type Member = {
  membership_id: string
  id: string
  name: string
  email: string
  role: Role
  access: 'admin' | 'member'
  is_primary_pic: number
  job_title: string | null
  avatar_url: string | null
  joined_at: string
}

export type Kpi = {
  id: string
  project_id: string
  label: string
  unit: string | null
  target_value: number
  current_value: number
  position: number
}

export type ProjectDetail = {
  project: ProjectSummary & {
    can_manage: boolean
    can_contribute: boolean
    can_see_budget: boolean
    is_primary_pic: boolean
    is_member: boolean
  }
  members: Member[]
  kpis: Kpi[]
  budget: Budget | null
  counts: { tasks: number; locations: number; logbooks: number; notes: number; records: number }
  entity: Entity
}

export type Budget = {
  project_id: string
  amount: number
  is_confirmed: number
  visibility: 'team' | 'entity'
  updated_by: string | null
  updated_at: string
}

export type Task = {
  id: string
  project_id: string
  board_id: string
  title: string
  description: string | null
  priority: 'tinggi' | 'normal' | 'rendah'
  due_date: string | null
  assignee_id: string | null
  assignee_name: string | null
  assignee_avatar_url: string | null
  position: number
  checklist_total: number
  checklist_done: number
  comment_count: number
  attachment_count: number
  completed_at: string | null
  created_at: string
}

export type Column = {
  id: string
  project_id: string
  name: string
  position: number
  is_done: boolean
  tasks: Task[]
}

export type EventItem = {
  id: string
  entity_id: string
  project_id: string | null
  project_title: string | null
  project_code: string | null
  title: string
  description: string | null
  start_local: string
  end_local: string | null
  all_day: boolean
  category_id: string | null
  category_name: string | null
  category_color: string | null
  visibility: 'team' | 'entity'
  location: string | null
  created_by: string | null
  creator_name: string | null
  time_label: string
  date: string
}

export type EventCategory = { id: string; entity_id: string; name: string; color: string }

export type GeoLocation = {
  id: string
  entity_id: string
  project_id: string | null
  project_title?: string
  project_code?: string
  name: string
  description: string | null
  type: 'point' | 'line' | 'polygon'
  geojson: { type: string; coordinates: any }
  lon: number | null
  lat: number | null
  visibility: 'team' | 'entity'
  photos?: { id: string; file_id: string; url: string; caption: string | null }[]
  logbook_count?: number
  last_visit?: string | null
  created_at: string
}

export type Logbook = {
  id: string
  project_id: string
  location_id: string | null
  location_name: string | null
  visit_date: string
  visit_time: string | null
  staff_id: string | null
  staff_name: string | null
  staff_avatar_url: string | null
  activity_type: string | null
  observations: string
  indicators: Record<string, string>
  follow_up: string | null
  gps_lat: number | null
  gps_lng: number | null
  visibility: 'team' | 'entity'
  photos: { id: string; file_id: string; url: string }[]
  created_at: string
  created_by: string | null
}

export type Note = {
  id: string
  project_id: string
  title: string
  body: string
  visibility: 'team' | 'entity'
  author_name: string
  author_avatar_url: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export type DataField = { id: string; project_id: string; key: string; label: string; type: string; position: number; sensitive: number }
export type DataRecord = {
  id: string
  project_id: string
  data: Record<string, any>
  visibility: 'team' | 'entity'
  created_at: string
  updated_at: string
  created_by_name?: string | null
  row_source?: string | null
}
export type DataImport = {
  id: string
  project_id: string
  filename: string | null
  source: string
  mode: string
  inserted: number
  updated: number
  skipped: number
  created_at: string
  user_name?: string | null
}

export type SheetLink = {
  id: string
  project_id: string
  url: string
  worksheet: string | null
  last_sync_at: string | null
  status: string | null
}

export type Notification = {
  id: string
  user_id: string
  type: string
  title: string
  body: string | null
  link: string | null
  entity_id: string | null
  project_id: string | null
  read_at: string | null
  created_at: string
  unread: boolean
}
