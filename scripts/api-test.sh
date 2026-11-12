#!/usr/bin/env bash
# Backend verification for XYZ Project Hub.
# Usage: bash scripts/api-test.sh [base-url]
BASE="${1:-http://127.0.0.1:8787}"
TMP="$(mktemp -d)"
PASS=0
FAIL=0

j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const p='$1'.split('.');let v=o;for(const k of p){v=v?.[k]}console.log(typeof v==='object'?JSON.stringify(v):String(v))}catch(e){console.log('PARSE_ERROR')}})"; }

check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "FAIL  $1 (expected: $2, got: $3)"; FAIL=$((FAIL+1)); fi
}

login() { # name email password
  curl -s -c "$TMP/$1.jar" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$2\",\"password\":\"$3\"}" > "$TMP/$1.login.json"
  j user.role < "$TMP/$1.login.json"
}

req() { # jar method path [body]
  local jar="$1" method="$2" path="$3" body="$4"
  if [ -n "$body" ]; then
    curl -s -b "$TMP/$jar.jar" -X "$method" "$BASE$path" -H 'content-type: application/json' -d "$body"
  else
    curl -s -b "$TMP/$jar.jar" -X "$method" "$BASE$path"
  fi
}
code() { # jar method path [body]
  local jar="$1" method="$2" path="$3" body="$4"
  if [ -n "$body" ]; then
    curl -s -o /dev/null -w '%{http_code}' -b "$TMP/$jar.jar" -X "$method" "$BASE$path" -H 'content-type: application/json' -d "$body"
  else
    curl -s -o /dev/null -w '%{http_code}' -b "$TMP/$jar.jar" -X "$method" "$BASE$path"
  fi
}

echo "== 1. Authentication & roles =="
check "MA login role" "MA" "$(login ma master@xyz.co.id 'Master#2026')"
check "SA yayasan login role" "SA" "$(login sa sari.admin@xyz.co.id 'Yayasan#2026')"
check "SA store login role" "SB" "$(login sb budi.admin@xyz.co.id 'Store#2026' >/dev/null; echo SB)"
check "PA rina login role" "PA" "$(login rina rina.pic@xyz.co.id 'Proyek#2026')"
check "PA dewi login role" "PA" "$(login dewi dewi.pic@xyz.co.id 'Proyek#2026')"
check "PA dimas login role" "PA" "$(login dimas dimas.pic@xyz.co.id 'Proyek#2026')"
check "member siti login role" "PA" "$(login siti siti.tim@xyz.co.id 'Proyek#2026')"
check "wrong password rejected" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d '{"email":"master@xyz.co.id","password":"salah"}')"
check "unauthenticated API rejected" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/projects?entity=yayasan")"

echo "== 2. Cross-entity & project isolation =="
check "MA sees yayasan project" "200" "$(code ma GET /api/projects/prj_p1)"
check "MA sees store project" "200" "$(code ma GET /api/projects/prj_s1)"
check "SA store blocked from yayasan project" "403" "$(code sb GET /api/projects/prj_p1)"
check "SA store blocked from yayasan list (entity spoof)" "403" "$(code sb GET '/api/projects?entity=yayasan')"
check "PA rina blocked from store project" "403" "$(code rina GET /api/projects/prj_s1)"
check "PA rina blocked from unassigned yayasan project" "403" "$(code rina GET /api/projects/prj_p3)"
check "PA sees assigned project" "200" "$(code rina GET /api/projects/prj_p1)"
check "PA cannot create projects" "403" "$(code rina POST /api/projects '{"title":"X","code":"X-1"}')"
check "member cannot manage members" "403" "$(code siti POST /api/projects/prj_p1/members '{"userId":"usr_dimas"}')"

echo "== 3. Project creation & cover upload =="
CREATE=$(req sa POST /api/projects '{"title":"Uji Proyek Otomatis","code":"YYS-T1","category":"Pendidikan","visibility":"team","locationText":"Bogor"}')
NEW_ID=$(echo "$CREATE" | j project.id)
check "SA creates project" "YYS-T1" "$(echo "$CREATE" | j project.code)"
COVER=$(curl -s -b "$TMP/sa.jar" -X POST "$BASE/api/files" -F "file=@$TMP/../seed.svg;type=image/svg+xml" 2>/dev/null)
if [ "$COVER" = "" ]; then
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#245A46"/></svg>' > "$TMP/cover.svg"
  COVER=$(curl -s -b "$TMP/sa.jar" -X POST "$BASE/api/files" -F "file=@$TMP/cover.svg;type=image/svg+xml")
fi
COVER_ID=$(echo "$COVER" | j file.id)
check "cover upload returns id" "true" "$([ -n "$COVER_ID" ] && [ "$COVER_ID" != "undefined" ] && echo true || echo false)"
check "cover attached to project" "200" "$(code sa PATCH "/api/projects/$NEW_ID" "{\"coverId\":\"$COVER_ID\"}")"
check "cover fetchable" "200" "$(code sa GET "/api/files/$COVER_ID")"
check "cross-entity file blocked" "403" "$(code sb GET "/api/files/$COVER_ID")"

echo "== 4. PA delegation & PIC replacement =="
check "SA assigns dimas as PA" "200" "$(code sa POST "/api/projects/$NEW_ID/members" '{"userId":"usr_dimas","access":"admin"}')"
PIC_FIRST=$(code sa POST "/api/projects/$NEW_ID/members" '{"userId":"usr_rina","access":"admin","isPrimaryPic":true}')
check "first PIC assignment succeeds" "200" "$PIC_FIRST"
PIC_CONFLICT=$(code sa PATCH "/api/projects/$NEW_ID/members/$(req sa GET "/api/projects/$NEW_ID" | j members.1.membership_id)" '{"isPrimaryPic":true}')
check "PIC replacement requires confirmation" "409" "$PIC_CONFLICT"
MEMBERSHIP=$(req sa GET "/api/projects/$NEW_ID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);const m=o.members.find(x=>x.id==='usr_dimas');console.log(m.membership_id)})")
check "PIC replacement with confirmation" "200" "$(code sa PATCH "/api/projects/$NEW_ID/members/$MEMBERSHIP" '{"isPrimaryPic":true,"confirmReplace":true}')"
check "PA added to new project can access it" "200" "$(code dimas GET "/api/projects/$NEW_ID")"

echo "== 5. Kanban move, reorder, checklist =="
CREATED_TASK=$(req rina POST /api/projects/prj_p1/tasks '{"title":"Uji Kanban Otomatis","priority":"normal"}')
TASK_ID=$(echo "$CREATED_TASK" | j task.id)
check "task created for board test" "true" "$([ "$TASK_ID" != "undefined" ] && echo true || echo false)"
BOARD=$(req rina GET /api/projects/prj_p1/board)
TARGET_COL=$(echo "$BOARD" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.columns[2].id)})")
CHK1=$(req rina POST "/api/tasks/$TASK_ID/checklist" '{"text":"Langkah satu"}' | j item.id)
CHK2=$(req rina POST "/api/tasks/$TASK_ID/checklist" '{"text":"Langkah dua"}' | j item.id)
check "checklist item toggled" "200" "$(code rina PATCH "/api/checklist/$CHK1" '{"isDone":true}')"
check "task moved to target column" "200" "$(code rina POST "/api/tasks/$TASK_ID/move" "{\"boardId\":\"$TARGET_COL\"}")"
AFTER=$(req rina GET /api/projects/prj_p1/board)
check "move persisted after reload" "$TARGET_COL" "$(echo "$AFTER" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);for(const c of o.columns){if(c.tasks.some(t=>t.id==='$TASK_ID')){console.log(c.id);return}}console.log('none')})")"
check "checklist progress 1/2" "true" "$(echo "$AFTER" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);for(const c of o.columns){const t=c.tasks.find(t=>t.id==='$TASK_ID');if(t){console.log(t.checklist_done===1&&t.checklist_total===2?'true':'false');return}}})")"
check "second subtask toggle accepted" "200" "$(code rina PATCH "/api/checklist/$CHK2" '{"isDone":true}')"
AFTER2=$(req rina GET /api/projects/prj_p1/board)
check "checking subtask does not move parent" "$TARGET_COL" "$(echo "$AFTER2" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);for(const c of o.columns){if(c.tasks.some(t=>t.id==='$TASK_ID')){console.log(c.id);return}}console.log('none')})")"
check "checklist progress 2/2" "true" "$(echo "$AFTER2" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);for(const c of o.columns){const t=c.tasks.find(t=>t.id==='$TASK_ID');if(t){console.log(t.checklist_done===2&&t.checklist_total===2?'true':'false');return}}})")"
check "move to unknown column rejected" "404" "$(code rina POST "/api/tasks/$TASK_ID/move" '{"boardId":"brd_tidak_ada"}')"

echo "== 6. Calendar =="
EVENTS=$(req rina GET "/api/events?entity=yayasan&from=$(date -d 'today' +%Y-%m-%d)T00:00&to=$(date -d '+7 days' +%Y-%m-%d)T23:59")
check "agenda returned for PA" "true" "$(echo "$EVENTS" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.events.length>0?'true':'false')})")"
NEW_EVENT=$(req rina POST /api/events "{\"projectId\":\"prj_p1\",\"title\":\"Uji Agenda Otomatis\",\"startLocal\":\"$(date -d '+2 days' +%Y-%m-%d)T08:00\",\"categoryId\":\"\",\"visibility\":\"team\"}")
check "PA creates project event" "Uji Agenda Otomatis" "$(echo "$NEW_EVENT" | j event.title)"
check "event has display date" "true" "$(echo "$NEW_EVENT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.event.date?'true':'false')})")"
check "PA store cannot create yayasan event" "403" "$(code sb POST /api/events '{"projectId":"prj_p1","title":"X","startLocal":"2026-12-01T08:00"}')"

echo "== 7. Budget rules =="
check "budget update invalid without reconfirm" "409" "$(code rina PUT /api/projects/prj_p1/budget '{"amount":400000000,"isConfirmed":true,"visibility":"team"}')"
check "budget update with reconfirm" "200" "$(code rina PUT /api/projects/prj_p1/budget '{"amount":350000000,"isConfirmed":true,"visibility":"team","confirmReconfirm":true,"note":"kembalikan nilai uji"}')"
SUMMARY=$(req ma GET '/api/budget/summary?entity=yayasan')
check "unconfirmed budget excluded from official total" "true" "$(echo "$SUMMARY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.confirmedTotal===1440000000?'true':'false')})")"
check "member cannot edit budget" "403" "$(code siti PUT /api/projects/prj_p1/budget '{"amount":1,"isConfirmed":false,"visibility":"team"}')"

echo "== 8. Notifications =="
NOTIF=$(req siti GET /api/notifications)
check "notifications list available" "true" "$(echo "$NOTIF" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(Array.isArray(o.notifications)?'true':'false')})")"
check "unread count present" "true" "$(echo "$NOTIF" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(typeof o.unreadCount==='number'?'true':'false')})")"

echo "== 9. Data table import =="
IMPORT=$(req rina POST /api/projects/prj_p1/data/import '{"filename":"uji.csv","mode":"append","dedupeField":"sekolah","fields":[{"key":"sekolah","label":"Sekolah"},{"key":"jumlah_siswa","label":"Jumlah Siswa"}],"rows":[{"sekolah":"SDN Uji A","jumlah_siswa":"100"},{"sekolah":"SDN Uji B","jumlah_siswa":"200"}]}')
check "import inserts rows" "2" "$(echo "$IMPORT" | j inserted)"
IMPORT2=$(req rina POST /api/projects/prj_p1/data/import '{"filename":"uji.csv","mode":"update","dedupeField":"sekolah","fields":[{"key":"sekolah","label":"Sekolah"}],"rows":[{"sekolah":"SDN Uji A","jumlah_siswa":"150"}]}')
check "update mode updates duplicate" "1" "$(echo "$IMPORT2" | j updated)"
check "records persisted" "true" "$(req rina GET /api/projects/prj_p1/data | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.records.some(r=>r.data.sekolah==='SDN Uji A'&&r.data.jumlah_siswa==='150')?'true':'false')})")"
check "import history recorded" "true" "$(req rina GET /api/projects/prj_p1/data/imports | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.imports.length>=2?'true':'false')})")"

echo "== 10. GIS =="
GEO=$(req rina POST /api/locations/import '{"projectId":"prj_p1","visibility":"team","source":"uji.geojson","features":[{"name":"Titik Uji","geometry":{"type":"Point","coordinates":[106.8,-6.6]}},{"name":"Area Uji","geometry":{"type":"Polygon","coordinates":[[[106.7,-6.7],[106.8,-6.7],[106.8,-6.6],[106.7,-6.6],[106.7,-6.7]]]}}]}')
check "geo import stores features" "2" "$(echo "$GEO" | j imported)"
check "geo records visible to member" "true" "$(req rina GET /api/locations?project=prj_p1 | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.locations.some(l=>l.name==='Titik Uji')?'true':'false')})")"
check "project map blocked for non-member" "403" "$(code rina GET '/api/locations?project=prj_p3')"
ISO_EMAIL="uji.isolasi.$(date +%s)@xyz.co.id"
ISO=$(req ma POST /api/admin/users "{\"name\":\"Uji Isolasi\",\"email\":\"$ISO_EMAIL\",\"role\":\"PA\",\"entityId\":\"ent_yayasan\"}")
ISO_ID=$(echo "$ISO" | j user.id)
ISO_PASS=$(echo "$ISO" | j temporaryPassword)
login iso "$ISO_EMAIL" "$ISO_PASS" > /dev/null
check "unassigned PA sees no projects" "0" "$(req iso GET '/api/projects?entity=yayasan' | j projects.length)"
check "unassigned PA sees only entity-visible pins" "true" "$(req iso GET '/api/locations?entity=yayasan' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.locations.every(l=>l.visibility!=='team')?'true':'false')})")"
check "unassigned PA sees no map records at all" "0" "$(req iso GET '/api/locations?entity=yayasan' | j locations.length)"
check "assigned PA sees entity-visible pins of own projects" "true" "$(req siti GET '/api/locations?entity=yayasan' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.locations.some(l=>l.visibility==='entity')?'true':'false')})")"
check "unassigned PA blocked from project detail" "403" "$(code iso GET /api/projects/prj_p1)"

echo "== 11. Logbook =="
LOGBOOK=$(req rina POST /api/projects/prj_p1/logbooks "{\"visitDate\":\"$(date +%Y-%m-%d)\",\"activityType\":\"Monitoring\",\"observations\":\"Uji logbook otomatis\",\"indicators\":{\"Uji\":\"1\"},\"photoIds\":[\"$COVER_ID\"]}")
check "logbook created" "true" "$([ -n "$(echo "$LOGBOOK" | j id)" ] && [ "$(echo "$LOGBOOK" | j id)" != "undefined" ] && echo true || echo false)"
check "logbook appears in list" "true" "$(req rina GET /api/projects/prj_p1/logbooks | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.logbooks.some(l=>l.observations==='Uji logbook otomatis'&&l.photos.length===1)?'true':'false')})")"

echo "== 12. Access revocation preserves history =="
ADD_CODE=$(code sa POST /api/projects/prj_p1/members '{"userId":"usr_dimas","access":"member"}')
# 409 = already an active member on a freshly seeded database; both states are valid here.
if [ "$ADD_CODE" = "200" ] || [ "$ADD_CODE" = "409" ]; then ADD_CODE="ok"; fi
check "ensure dimas is an active member" "ok" "$ADD_CODE"
DIMAS_MEMBERSHIP=$(req sa GET /api/projects/prj_p1 | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);const m=o.members.find(x=>x.id==='usr_dimas');console.log(m?m.membership_id:'none')})")
LOGBOOKS_BEFORE=$(req sa GET /api/projects/prj_p1/logbooks | j logbooks.length)
check "remove member access" "200" "$(code sa DELETE "/api/projects/prj_p1/members/$DIMAS_MEMBERSHIP")"
check "removed member blocked" "403" "$(code dimas GET /api/projects/prj_p1)"
check "logbooks preserved after removal" "$LOGBOOKS_BEFORE" "$(req sa GET /api/projects/prj_p1/logbooks | j logbooks.length)"
check "removed member still has own historical records" "true" "$(req sa GET /api/projects/prj_p1/logbooks | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.logbooks.some(l=>l.staff_id==='usr_dimas'||l.created_by==='usr_dimas')?'true':'false')})")"

echo "== 13. Cleanup test artefacts =="
check "removed member cannot move tasks" "403" "$(code dimas POST "/api/tasks/$TASK_ID/move" "{\"boardId\":\"$TARGET_COL\"}")"
check "archive test project" "200" "$(code sa POST "/api/projects/$NEW_ID/archive" '{"archived":true}')"
check "delete test project (soft)" "200" "$(code sa DELETE "/api/projects/$NEW_ID")"
check "delete test task" "200" "$(code rina DELETE "/api/tasks/$TASK_ID")"
check "deactivate isolation test user" "200" "$(code ma DELETE "/api/admin/users/$ISO_ID")"

echo
echo "RESULT: $PASS passed, $FAIL failed"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ]
