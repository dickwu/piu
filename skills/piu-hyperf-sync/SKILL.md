---
name: piu-hyperf-sync
description: >
  Deep sync a Hyperf PHP backend to PIU — extracts routes via Hyperf CLI,
  parses controller validation rules and response shapes, builds Eloquent model
  schemas, maps middleware to auth types, and creates PIU entities with full API
  documentation. Supports token-efficient incremental daily re-sync via manifest
  tracking. Use when the user says "sync hyperf", "import hyperf", "hyperf api sync",
  or when piu-backend-sync detects framework: "hyperf".
---

# PIU Hyperf Sync

Deep-syncs a Hyperf PHP backend API to PIU. Uses `php bin/hyperf.php describe:routes` as the authoritative route source, Claude's PHP comprehension for semantic extraction, and a manifest-based incremental sync for daily re-runs.

## Prerequisites

- The Hyperf project must be bootable (`php bin/hyperf.php describe:routes` must work)
- PIU must be running with MCP enabled (the `piu.ts` CLI from `piu-backend-sync` must connect)
- Git must be available for commit tracking

## CLI Scripts

This skill uses scripts from two locations:

```bash
# Route parser (this skill)
bun skills/piu-hyperf-sync/scripts/parse-routes.ts < routes.txt

# PIU MCP client (from piu-backend-sync)
bun skills/piu-backend-sync/scripts/piu.ts <command> [args...]
```

The PIU CLI path is relative to the PIU repo root. Set `PIU_ROOT` if running from elsewhere:
```bash
PIU_ROOT=/Users/gwddeveloper/opensource/piu
PIU_CLI="bun $PIU_ROOT/skills/piu-backend-sync/scripts/piu.ts"
PARSE_ROUTES="bun $PIU_ROOT/skills/piu-hyperf-sync/scripts/parse-routes.ts"
```

---

## Phase 0: Pre-flight

Before starting, verify the environment and determine sync mode.

### Step 0.1 — Verify Hyperf CLI

```bash
cd $REPO && php bin/hyperf.php describe:routes 2>&1 | head -5
```

If this fails or shows an error, STOP. The Hyperf project is not bootable. Common fixes:
- Missing composer dependencies: `composer install`
- PHP extension missing: check `php -m` for `swoole`, `pdo`, `redis`
- Config error: check `config/autoload/server.php`

### Step 0.2 — Get HEAD commit

```bash
COMMIT=$(git -C $REPO rev-parse HEAD)
echo "HEAD commit: $COMMIT"
```

### Step 0.3 — Check for existing manifest

```bash
MANIFEST="$REPO/.piu-sync/manifest.json"
if [ -f "$MANIFEST" ]; then
  echo "Existing manifest found — incremental sync mode"
  echo "Last sync commit: $(cat $MANIFEST | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).commit)')"
  # Jump to Phase 6 (Incremental Sync) unless --force
else
  echo "No manifest — full sync mode"
  # Continue to Phase 1
fi
```

If the user passes `--force` or says "full sync", skip the manifest check and do a full sync regardless.

---

## Phase 1: Route Extraction

Use the Hyperf CLI for authoritative route data, then parse into structured JSON.

### Step 1.1 — Extract routes

```bash
cd $REPO && php bin/hyperf.php describe:routes 2>&1 > /tmp/piu-hyperf-routes-raw.txt
cat /tmp/piu-hyperf-routes-raw.txt | $PARSE_ROUTES > /tmp/piu-hyperf-routes.json
```

This produces a JSON array:
```json
[
  {
    "server": "http",
    "method": "POST",
    "uri": "/user/task/create",
    "action": "App\\Controller\\User\\UserTaskController::create",
    "middleware": ["AuthToken"]
  }
]
```

### Step 1.2 — Group into collections

Read `/tmp/piu-hyperf-routes.json` and group routes by first URI path segment:

| URI Prefix | Collection Name | path_prefix |
|-----------|----------------|-------------|
| `/user` | User | `/user` |
| `/admin` | Admin | `/admin` |
| `/public` | Public | `/public` |
| `/patient` | Patient | `/patient` |
| `/pre` | Pre | `/pre` |
| `/appointment` | Appointment | `/appointment` |
| `/reception` | Reception | `/reception` |
| `/lab` | Lab | `/lab` |
| `/auth` | Root | `` (empty) |
| `/tool` | Root | `` (empty) |
| `/` | Root | `` (empty) |

Top-level routes without a clear group go into "Root".

### Step 1.3 — Map middleware to auth type

For each route, determine the auth configuration from its middleware array:

| Middleware | PIU Auth Config | Env Variable |
|-----------|----------------|-------------|
| `AuthToken` | `{"type":"bearer","token":"{{staff_token}}"}` | `staff_token` |
| `AuthAdmin` | `{"type":"bearer","token":"{{admin_token}}"}` | `admin_token` |
| `AuthReception` | `{"type":"bearer","token":"{{reception_token}}"}` | `reception_token` |
| `AuthPatient` | `{"type":"bearer","token":"{{patient_token}}"}` | `patient_token` |
| `PreAuth` | `{"type":"bearer","token":"{{pre_token}}"}` | `pre_token` |
| `PreAuthWithStatus` | `{"type":"bearer","token":"{{pre_token}}"}` | `pre_token` |
| `CheckInAuth` | `{"type":"bearer","token":"{{checkin_token}}"}` | `checkin_token` |
| _(empty array)_ | `{"type":"none"}` | — |

If a route has multiple auth middleware (shouldn't happen but possible), use the first non-CORS one.

### Step 1.4 — Save route snapshot

```bash
cp /tmp/piu-hyperf-routes-raw.txt $REPO/.piu-sync/routes-snapshot.txt
```

This is used later for text-based diffing during incremental sync.

---

## Phase 2: Controller Analysis

For each unique controller file referenced by routes, read the PHP source and extract validation rules, undocumented inputs, response shapes, and side effects.

### Step 2.1 — Identify controller files

From the route JSON, extract unique controller file paths:

```
action: "App\\Controller\\User\\UserTaskController::create"
  -> file: app/Controller/User/UserTaskController.php
  -> method: create
```

The mapping is: replace `App\\` with `app/`, replace `\\` with `/`, append `.php`, strip `::method`.

Group routes by controller file to minimize file reads.

### Step 2.2 — Read and analyze each controller

For each controller file, read the full file and analyze every method that is mapped to a route.

#### 2.2a — Extract validation rules

Look for `$this->validation([...])` calls within each method. The rules array uses Laravel validation syntax:

```php
$this->validation([
    'title'       => 'required|string|max:200',
    'assignee_id' => 'nullable|integer',
    'priority'    => 'nullable|integer|in:1,2,3,4',
    'due_date'    => 'nullable|date_format:Y-m-d H:i:s',
    'label_ids'   => 'nullable|array',
    'label_ids.*' => 'integer',
]);
```

Parse each rule string into a PIU model field:

| Laravel Rule | PIU field_type | required | description notes |
|---|---|---|---|
| `required` | — | `true` | — |
| `nullable` | — | `false` | — |
| `string` | `string` | — | — |
| `integer` | `integer` | — | — |
| `numeric` | `number` | — | — |
| `boolean` | `boolean` | — | — |
| `array` | `array` | — | Check `field.*` rule for element type |
| `date` | `date` | — | — |
| `date_format:F` | `datetime` | — | Add "format: F" to description |
| `email` | `string` | — | Add "email format" to description |
| `url` | `string` | — | Add "URL format" to description |
| `in:a,b,c` | (base type) | — | Add "enum: a,b,c" to description |
| `max:N` | — | — | Add "max: N" to description |
| `min:N` | — | — | Add "min: N" to description |
| `file` / `image` | `file` | — | Body type becomes `multipart` |
| `json` | `object` | — | — |

If no `required` or `nullable` is specified, default to `required: false`.

Build a request model named `{ControllerShortName}{Method}Request` (e.g., `UserTaskCreateRequest`).

#### 2.2b — Extract undocumented inputs

Search the method body for `$this->request->input('field')` or `$this->request->input('field', default)` calls where `'field'` does NOT appear in the validation rules array.

Add these as fields in the request model with `documented: false` in the description. Example:
```
{name: "keyword", field_type: "string", required: false, description: "Undocumented — found via $this->request->input()"}
```

Also check for:
- `$this->request->all()` — means the endpoint accepts arbitrary fields
- `(int) $this->request->input('field')` — the cast reveals the type

#### 2.2c — Extract response shape

Trace what `successResponse()` or `$this->response->json()` receives. Common patterns in this codebase:

1. **Direct model**: `successResponse($model->toArray())`
   -> Response model = the Eloquent model's serialized form (see Phase 3)

2. **Eager-loaded model**: `$model->load(['creator:id,first_name,last_name'])->toArray()`
   -> Response includes nested relation subsets

3. **Query select**: `User::query()->select(['id', 'name', 'email'])->get()`
   -> Response model = subset of fields

4. **Manual array**: `successResponse(['token' => $token, 'expires_in' => 3600])`
   -> Inline response model with explicit fields

5. **Collection map**: `$items->map(fn($i) => ['id' => $i->id, 'name' => $i->name])`
   -> Response model = array of mapped objects

6. **Paginated**: Methods using `->paginate()` or manual `page`/`per_page` logic
   -> Response wraps data in pagination metadata

For all patterns, the outer wrapper is always:
```json
{"code": 1, "message": "OK", "data": <inner_shape>}
```

Build a response model named `{ControllerShortName}{Method}Response`.

#### 2.2d — Extract side effects

Search each method body for:

| Pattern | Side Effect |
|---------|-------------|
| `Helper::redisNotice()` or `->publish(` on Redis notice pool | Triggers notification via Redis pub/sub |
| `Helper::redisChat()` or `->publish(` on Redis chat pool | Triggers chat event via Redis pub/sub |
| `$this->push(` or `dispatch(` or `AsyncQueue` | Queues async job |
| `EventDispatcherInterface` or `$this->eventDispatcher->dispatch(` | Fires domain event |
| `AuditLogger::` or `AuditLog::create(` | Creates audit log entry |
| `EmailSender::` | Sends email notification |

Record these as a list of strings for inclusion in the endpoint documentation.

#### 2.2e — Record method line ranges

For each method analyzed, record the start and end line numbers for future method-level hashing:

```json
{
  "create": {"line_start": 45, "line_end": 120},
  "list": {"line_start": 122, "line_end": 180}
}
```

Use the `public function methodName(` signature as the start marker and the next `public function` or end of class as the end marker.

---

## Phase 3: Model Extraction

For each Eloquent model referenced by controllers, read the PHP source and extract schema information.

### Step 3.1 — Identify model files

From Phase 2's controller analysis, collect all model class references. Common patterns:

```php
use App\Model\User;           -> app/Model/User.php
use App\Model\Task;           -> app/Model/Task.php
$query = Task::query();       -> app/Model/Task.php
new User()                    -> app/Model/User.php
```

Also check `use` statements at the top of each controller file.

### Step 3.2 — Read and extract model schema

For each model file, extract:

**Table name:**
```php
protected ?string $table = 'tasks';
```
If not specified, Hyperf/Laravel defaults to the snake_case plural of the class name.

**Fillable fields:**
```php
protected array $fillable = ['title', 'description', 'assignee_id', 'priority', ...];
```
These are the writable fields — used for request models.

**Casts:**
```php
protected array $casts = [
    'id' => 'integer',
    'status' => 'integer',
    'created_at' => 'datetime',
];
```
Map to PIU field types:
- `integer` / `int` -> `integer`
- `float` / `double` / `decimal` -> `number`
- `boolean` / `bool` -> `boolean`
- `datetime` / `date` -> `datetime` / `date`
- `array` / `json` -> `object`
- `string` -> `string`

**Hidden fields:**
```php
protected array $hidden = ['password', 'pin_pass'];
```
These are EXCLUDED from `toArray()` output — do NOT include in response models.

**Appended attributes:**
```php
protected array $appends = ['name'];
```
These are VIRTUAL computed fields added to `toArray()` output. Find the accessor method:
```php
public function getNameAttribute(): ?string { ... }
// or PHP 8.1+ attribute syntax:
#[Attribute] public function name(): Attribute { ... }
```
Include in response models with the computed type.

**Relations:**
```php
public function creator(): BelongsTo { return $this->belongsTo(User::class, 'creator_id'); }
public function assignees(): HasMany { return $this->hasMany(TaskAssignee::class); }
public function labels(): BelongsToMany { return $this->belongsToMany(TaskLabel::class, 'task_label_relations'); }
```

Map relation types:
| PHP Relation | PIU Representation |
|---|---|
| `BelongsTo` | Single nested object (e.g., `creator: {id, name}`) |
| `HasMany` | Array of nested objects (e.g., `comments: [{id, text}]`) |
| `BelongsToMany` | Array of nested objects (e.g., `labels: [{id, name}]`) |
| `HasOne` | Single nested object |

**toArray() overrides:**
If the model overrides `toArray()`, the response shape may differ from the raw fields. Read the override to understand transformations:
```php
public function toArray(): array {
    $data = parent::toArray();
    if ($this->relationLoaded('sublocation') && $this->sublocation) {
        $data['sublocation'] = ['id' => $this->sublocation->id, 'name' => $this->sublocation->value];
    }
    return $data;
}
```

### Step 3.3 — Build PIU data models

Create PIU models in this order:

**1. Base models (shared across project):**

```json
{
  "name": "ApiResponse",
  "description": "Standard Hyperf API response envelope",
  "fields": [
    {"name": "code", "field_type": "integer", "required": true, "example": "1", "description": "1=success, 201+=error codes"},
    {"name": "message", "field_type": "string", "required": true, "example": "OK"},
    {"name": "data", "field_type": "object", "required": false, "description": "Response payload — shape varies per endpoint"}
  ]
}
```

Create `PaginationParams` if any controller uses pagination:
```json
{
  "name": "PaginationParams",
  "description": "Common pagination parameters",
  "fields": [
    {"name": "page", "field_type": "integer", "required": false, "example": "1"},
    {"name": "per_page", "field_type": "integer", "required": false, "example": "20"}
  ]
}
```

**2. Entity models (one per Eloquent model):**

Named `{ModelName}Model` (e.g., `TaskModel`, `UserModel`). Fields from:
- `$fillable` + `$appends`, minus `$hidden`
- Types from `$casts`
- Relations as nested sub-fields with descriptions

**3. Request models (one per endpoint with validation rules):**

Named `{Controller}{Method}Request` (e.g., `UserTaskCreateRequest`). Fields from:
- Validation rules (Phase 2.2a)
- Undocumented inputs (Phase 2.2b)

**4. Response models (one per distinct response shape):**

Named `{Controller}{Method}Response` (e.g., `UserTaskCreateResponse`). Fields from:
- Model toArray() output shape
- Eager loading subsets
- Manual array constructions

### Step 3.4 — Establish model relationships

For response models that include nested relations, set the `description` field to reference the related entity model:
```json
{"name": "creator", "field_type": "object", "description": "Subset of UserModel: {id, first_name, last_name, nickname, avatar}"}
```

Where the same response shape appears across multiple endpoints, reuse the same response model rather than creating duplicates.

---

## Phase 4: PIU Entity Creation

Create all PIU entities using the MCP CLI. Execute commands from the PIU repo root.

### Step 4.1 — Create project

```bash
$PIU_CLI create-project '{"name":"REPO_NAME API","description":"Hyperf API — auto-synced from REPO_PATH","source_repo_url":"REPO_PATH","source_commit_id":"COMMIT","backend_type":"hyperf"}'
```

Save the returned `project_id` — all subsequent entities reference it.

### Step 4.2 — Create environment

```bash
$PIU_CLI create-env '{"project_id":"PROJECT_ID","name":"Development","host":"http://localhost:9501"}'
```

Save the returned `environment_id`, then set variables:

```bash
$PIU_CLI set-vars '{"environment_id":"ENV_ID","variables":[
  {"key":"staff_token","value":"","enabled":true,"match_paths":"[\"*\"]","target_location":"auth-bearer"},
  {"key":"admin_token","value":"","enabled":true,"match_paths":"[\"/admin/*\"]","target_location":"auth-bearer"},
  {"key":"patient_token","value":"","enabled":true,"match_paths":"[\"/patient/*\"]","target_location":"auth-bearer"},
  {"key":"pre_token","value":"","enabled":true,"match_paths":"[\"/pre/*\"]","target_location":"auth-bearer"},
  {"key":"reception_token","value":"","enabled":true,"match_paths":"[\"/reception/*\"]","target_location":"auth-bearer"},
  {"key":"checkin_token","value":"","enabled":true,"match_paths":"[\"/appointment/*\"]","target_location":"auth-bearer"}
]}'
```

Activate the environment:
```bash
$PIU_CLI activate-env '{"environment_id":"ENV_ID","project_id":"PROJECT_ID"}'
```

### Step 4.3 — Create auth token hooks

After creating variables, set up hooks so that executing login requests automatically captures tokens into the corresponding variables. The `set-vars` response includes variable records with stable IDs — use these IDs for hook targets.

For each auth middleware type that has a login endpoint, create a hook:

```bash
# Example: staff login hook — captures body.data.token into staff_token variable
$PIU_CLI tool create_hook '{"environment_id":"ENV_ID","source_request_id":"STAFF_LOGIN_REQ_ID","response_location":"body","selector":"data.token","target_variable_ids":["STAFF_TOKEN_VAR_ID"],"expires_in":86400000,"value_template":"{{value}}"}'

# Example: admin login hook
$PIU_CLI tool create_hook '{"environment_id":"ENV_ID","source_request_id":"ADMIN_LOGIN_REQ_ID","response_location":"body","selector":"data.token","target_variable_ids":["ADMIN_TOKEN_VAR_ID"],"expires_in":86400000,"value_template":"{{value}}"}'
```

**How to find the login request IDs:** After creating requests in Step 4.4, search for login endpoints:
```bash
$PIU_CLI search PROJECT_ID "login"
```

**How to find variable IDs:** The `set-vars` response now returns full variable records including IDs. Cache these during Step 4.2.

**expires_in** is in milliseconds (86400000 = 24 hours).

Hook workflow: when a login request is executed (either via PIU UI or MCP `execute_request`), the hook automatically extracts `data.token` from the response body and writes it to the target variable. Subsequent requests using `{{staff_token}}` etc. get the captured value automatically.

### Step 4.4 — Batch-create collections

Write one JSON array with all collections and pipe to the batch command:

```bash
cat <<'EOF' | $PIU_CLI batch-collections
[
  {"project_id":"PROJECT_ID","name":"User","path_prefix":"/user","description":"Staff user endpoints — AuthToken middleware","source_commit_id":"COMMIT"},
  {"project_id":"PROJECT_ID","name":"Admin","path_prefix":"/admin","description":"Admin management endpoints — AuthAdmin middleware","source_commit_id":"COMMIT"},
  {"project_id":"PROJECT_ID","name":"Public","path_prefix":"/public","description":"Public endpoints — no authentication","source_commit_id":"COMMIT"},
  {"project_id":"PROJECT_ID","name":"Patient","path_prefix":"/patient","description":"Patient-facing endpoints — mixed auth (AuthPatient, AuthToken, CheckInAuth)","source_commit_id":"COMMIT"},
  {"project_id":"PROJECT_ID","name":"Pre","path_prefix":"/pre","description":"Pre-employment user endpoints — PreAuth/PreAuthWithStatus middleware","source_commit_id":"COMMIT"},
  {"project_id":"PROJECT_ID","name":"Appointment","path_prefix":"/appointment","description":"Appointment workflow endpoints — AuthToken middleware","source_commit_id":"COMMIT"},
  {"project_id":"PROJECT_ID","name":"Reception","path_prefix":"/reception","description":"Reception desk endpoints — AuthReception middleware","source_commit_id":"COMMIT"},
  {"project_id":"PROJECT_ID","name":"Lab","path_prefix":"/lab","description":"Lab order management — AuthToken middleware","source_commit_id":"COMMIT"},
  {"project_id":"PROJECT_ID","name":"Root","path_prefix":"","description":"Top-level routes — auth, health, tools","source_commit_id":"COMMIT"}
]
EOF
```

Save the returned collection IDs — map each `path_prefix` to its `collection_id`.

### Step 4.5 — Batch-create requests

For each collection, write a JSON file with all its routes and pipe to batch-requests.

For large collections (100+ routes like User/Admin), split into chunks of ~50 to avoid MCP timeout:

```bash
# Write routes to temp file
cat > /tmp/piu-routes-user.json <<'EOF'
[
  {
    "collection_id": "COLLECTION_ID",
    "name": "Create Task",
    "method": "POST",
    "url": "/task/create",
    "description": "",
    "auth": {"type": "bearer", "token": "{{staff_token}}"},
    "source_commit_id": "COMMIT"
  },
  ...
]
EOF
cat /tmp/piu-routes-user.json | $PIU_CLI batch-requests
```

**Request naming convention:** Derive from the URI path:
- `/task/create` -> "Create Task"
- `/task/list` -> "List Tasks"
- `/chat/group/create` -> "Create Chat Group"
- `/info` -> "Get User Info"

Strip the collection prefix from the URL. Example: route URI `/user/task/create` in collection with `path_prefix: /user` -> request URL: `/task/create`.

**Auth config per request:** Use the middleware mapping from Phase 1. For collections with mixed middleware (like Patient), set auth per-request based on each route's specific middleware.

### Step 4.6 — Batch-create models

```bash
cat <<'EOF' | $PIU_CLI batch-models
{
  "project_id": "PROJECT_ID",
  "models": [
    {"name": "ApiResponse", "description": "Standard response envelope", "fields": [...]},
    {"name": "TaskModel", "description": "Task entity", "fields": [...]},
    ...
  ]
}
EOF
```

Create in order: base models -> entity models -> request models -> response models.

Save all returned model IDs — map each model name to its `model_id`.

### Step 4.7 — Batch-link models to requests

```bash
cat <<'EOF' | $PIU_CLI batch-links
[
  {"request_id": "REQ_ID", "model_type": "request", "model_id": "REQUEST_MODEL_ID"},
  {"request_id": "REQ_ID", "model_type": "response", "model_id": "RESPONSE_MODEL_ID"}
]
EOF
```

Each request gets up to two links: one request model and one response model.

### Step 4.8 — Create "System Events" collection

```bash
$PIU_CLI create-collection '{"project_id":"PROJECT_ID","name":"System Events","path_prefix":"","description":"Non-executable reference — documents Redis pub/sub events, async queue jobs, and webhook callbacks triggered by API endpoints"}'
```

For each distinct side effect discovered in Phase 2, create a reference request:

```bash
cat <<'EOF' | $PIU_CLI batch-requests
[
  {
    "collection_id": "EVENTS_COLLECTION_ID",
    "name": "TaskNotice — Task Created",
    "method": "POST",
    "url": "/event/task-created",
    "description": "## Redis Pub/Sub Event\n\n**Channel:** notice (Redis db=9)\n**Trigger:** POST /user/task/create, POST /user/task/update-status\n**Payload:** Task ID, assignee notification\n\nThis is a reference entry — not an executable HTTP endpoint.",
    "source_commit_id": "COMMIT"
  }
]
EOF
```

---

## Phase 5: Documentation Generation

For each request created in Phase 4, generate a comprehensive markdown description and update the request via MCP.

### Step 5.1 — Generate per-endpoint documentation

For each request, compose a markdown description following this template:

```markdown
## METHOD /full/path

One-sentence summary of what this endpoint does.

### Auth
Bearer token (staff) — `AuthToken` middleware
OR: No authentication required (public endpoint)

### Request Body

| Field | Type | Required | Constraints | Example |
|-------|------|----------|-------------|---------|
| field_name | string | Yes | max:200 | `"example value"` |
| other_field | integer | No | enum: 1,2,3,4 | `2` |

### Example Request
```json
{
  "field_name": "example value",
  "other_field": 2
}
```

### Response
```json
{
  "code": 1,
  "message": "OK",
  "data": { ... }
}
```

### Side Effects
- Triggers TaskNotice via Redis pub/sub
(Omit this section if no side effects)

### Related
- `POST /path/to/related` — Description
(Omit this section if no obvious related endpoints)
```

**Example generation rules:**
- `string` -> Use a realistic example based on the field name (`"title"` -> `"Review PR #42"`)
- `integer` -> Use a plausible ID or count (`"assignee_id"` -> `15`)
- `datetime` with format -> Use a near-future date in the specified format
- `email` -> Use `"user@example.com"`
- `array<integer>` -> Use `[1, 3]`
- `boolean` -> Use `true`
- For `in:a,b,c` enums -> Use the first enum value

**Response examples:** Build from the response model fields. For nested relations, include the subset fields from the eager loading pattern. For paginated responses, include the pagination wrapper.

### Step 5.2 — Batch-update request descriptions

Write updates to a temp file and pipe:

```bash
cat <<'EOF' | $PIU_CLI batch-update-bodies
[
  {
    "request_id": "REQ_ID",
    "name": "Create Task",
    "config": {
      "method": "POST",
      "url": "/task/create",
      "headers": [{"key": "Content-Type", "value": "application/json", "enabled": true}],
      "body": {"type": "json", "content": "{\"title\": \"Review PR #42\", \"assignee_id\": 15, \"priority\": 2}"},
      "auth": {"type": "bearer", "token": "{{staff_token}}"},
      "description": "## POST /user/task/create\n\nCreate a new task...\n\n### Request Body\n..."
    }
  }
]
EOF
```

For large projects, process in batches of ~20 requests to avoid MCP timeout.

### Step 5.3 — Verify documentation coverage

After all updates, check that every request has a non-empty description:

```bash
$PIU_CLI tree PROJECT_ID
```

Manually spot-check a few endpoints to verify description quality.

---

## Phase 6: Incremental Sync

Token-efficient re-sync for daily runs. Designed to cost ~200 tokens on quiet days and ~3K-5K tokens when 1-2 controllers change.

### Step 6.0 — Quick exit check (bash only)

```bash
MANIFEST="$REPO/.piu-sync/manifest.json"
LAST_COMMIT=$(cat $MANIFEST | bun -e "console.log(JSON.parse(await Bun.stdin.text()).commit)")
CURRENT_COMMIT=$(git -C $REPO rev-parse HEAD)

# Same commit? Nothing to do.
if [ "$LAST_COMMIT" = "$CURRENT_COMMIT" ]; then
  echo "No changes since last sync (commit: ${LAST_COMMIT:0:12})"
  exit 0
fi

# Check if any API-relevant files changed
CHANGED=$(git -C $REPO diff --name-only $LAST_COMMIT..$CURRENT_COMMIT -- 'app/Controller/' 'config/routers/' 'app/Model/' 'app/Middleware/')
if [ -z "$CHANGED" ]; then
  echo "No API-relevant file changes since last sync"
  # Update commit in manifest without re-scanning
  cat $MANIFEST | bun -e "const m=JSON.parse(await Bun.stdin.text());m.commit='$CURRENT_COMMIT';m.synced_at=new Date().toISOString();console.log(JSON.stringify(m,null,2))" > $MANIFEST
  exit 0
fi

echo "Changed API files:"
echo "$CHANGED"
```

If the script exits at this step, total cost is ~200 tokens.

### Step 6.1 — Route structure diff (bash only)

```bash
cd $REPO && php bin/hyperf.php describe:routes 2>&1 > /tmp/piu-hyperf-routes-current.txt

# Diff against stored snapshot
diff $REPO/.piu-sync/routes-snapshot.txt /tmp/piu-hyperf-routes-current.txt > /tmp/piu-routes-diff.txt 2>&1 || true

if [ -s /tmp/piu-routes-diff.txt ]; then
  echo "Route structure changes detected:"
  cat /tmp/piu-routes-diff.txt | head -30
else
  echo "No route structure changes (same routes, same middleware)"
fi
```

Parse the diff to identify:
- Lines starting with `>` -> new routes added
- Lines starting with `<` -> routes removed
- Changed middleware assignments

Use the route parser to get structured JSON for new routes:
```bash
cat /tmp/piu-hyperf-routes-current.txt | $PARSE_ROUTES > /tmp/piu-hyperf-routes-current.json
```

### Step 6.2 — File hash triage (bash only)

```bash
# For each changed file, compute current hash and compare to manifest
for FILE in $CHANGED; do
  CURRENT_HASH=$(shasum -a 256 $REPO/$FILE | cut -d' ' -f1)
  STORED_HASH=$(cat $MANIFEST | bun -e "const m=JSON.parse(await Bun.stdin.text());const f=m.file_hashes?.['$FILE'];console.log(f?.file_hash??f?.schema_hash??'none')")
  if [ "$CURRENT_HASH" = "$STORED_HASH" ]; then
    echo "SKIP (hash match): $FILE"
  else
    echo "CHANGED: $FILE"
  fi
done
```

Only files with changed hashes proceed to Step 6.3.

### Step 6.3 — Method-level extraction (Claude reads only changed methods)

For each truly-changed controller file:

1. Load stored method line ranges from manifest
2. For each method in the changed controller, re-compute the method hash:
   ```bash
   sed -n '45,120p' $REPO/app/Controller/User/UserTaskController.php | shasum -a 256
   ```
3. If a method's hash changed -> read ONLY that method's line range using `Read(file, offset=line_start, limit=line_count)`
4. Re-extract validation rules and response shape following Phase 2 instructions
5. If a method is new (not in manifest) -> read it and extract from scratch

For changed model files:
1. Re-compute the schema hash (hash of `$fillable` + `$casts` + relations sections)
2. If schema hash unchanged -> skip (only non-schema code changed)
3. If schema hash changed -> re-read model and update PIU data model

### Step 6.4 — PIU update (minimal MCP calls)

**New routes** (found in Step 6.1):
```bash
# Create new requests in the appropriate collection
cat /tmp/new-routes.json | $PIU_CLI batch-requests
```
Then generate documentation for new requests (Phase 5 for new endpoints only).

**Changed controller methods** (found in Step 6.3):
```bash
# Update existing request config and description
$PIU_CLI update-request '{"request_id":"REQ_ID","config":"..."}'
```
Update the request body model if validation rules changed. Update the response model if the response shape changed.

**Removed routes** (found in Step 6.1):
Do NOT auto-delete. Print a warning:
```
WARNING: The following routes were removed from the backend but still exist in PIU:
  - POST /user/old-endpoint (request_id: REQ_ID)
Run: $PIU_CLI delete-request REQ_ID
to remove them manually.
```

**Changed middleware** (found in Step 6.1):
```bash
# Update auth config on affected requests
$PIU_CLI update-request '{"request_id":"REQ_ID","config":"{\"auth\":{\"type\":\"bearer\",\"token\":\"{{new_token}}\"}}"}'
```

**Changed models** (found in Step 6.3):
```bash
$PIU_CLI update-model '{"model_id":"MODEL_ID","fields":"[...]"}'
```

### Step 6.5 — Update manifest

After all updates, rewrite the manifest with:
- New commit SHA
- Updated `synced_at` timestamp
- Updated route snapshot file
- Updated file hashes and method hashes for all processed files
- Updated entity maps for any new/removed entities

```bash
# Save new route snapshot
cp /tmp/piu-hyperf-routes-current.txt $REPO/.piu-sync/routes-snapshot.txt
```

Write the manifest JSON using the accumulated data from Steps 6.1-6.4.

### Token cost reference

| Scenario | What happens | Token cost |
|----------|-------------|-----------|
| No API file changes | Step 6.0 exits immediately | ~200 |
| Files changed, hashes match | Step 6.2 filters everything | ~500 |
| 1-2 controllers changed | Step 6.3 reads changed methods only | ~3K-5K |
| New routes added | Step 6.1 detects + Step 6.4 creates | ~5K-10K |
| Major refactor | Many files changed -> approaches full sync | ~20K-50K |

---

## Phase 7: Verification & Report

### Step 7.1 — Verify PIU entities

```bash
$PIU_CLI overview PROJECT_ID
$PIU_CLI tree PROJECT_ID
```

Spot-check:
- Collection count matches number of route groups
- Request count matches total routes from Phase 1
- Models are linked to requests

### Step 7.2 — Compute file hashes

For every controller and model file processed, compute SHA-256 hashes:

```bash
shasum -a 256 $REPO/app/Controller/User/UserTaskController.php
```

For controller files, also compute per-method hashes by extracting each method's line range and hashing it.

### Step 7.3 — Write manifest

Create the `.piu-sync/` directory if it doesn't exist:
```bash
mkdir -p $REPO/.piu-sync
```

Write `manifest.json`:

```json
{
  "version": 1,
  "project_id": "PIU_PROJECT_ID",
  "repo_path": "/absolute/path/to/repo",
  "framework": "hyperf",
  "synced_at": "2026-03-26T10:00:00.000Z",
  "commit": "abc123def456789...",
  "route_count": 625,
  "collection_map": {
    "/user": "COLLECTION_ID_1",
    "/admin": "COLLECTION_ID_2",
    "/public": "COLLECTION_ID_3",
    "/patient": "COLLECTION_ID_4",
    "/pre": "COLLECTION_ID_5",
    "/appointment": "COLLECTION_ID_6",
    "/reception": "COLLECTION_ID_7",
    "/lab": "COLLECTION_ID_8",
    "": "COLLECTION_ID_9"
  },
  "request_map": {
    "POST:/user/task/create": "REQUEST_ID_1",
    "POST:/user/task/list": "REQUEST_ID_2"
  },
  "model_map": {
    "ApiResponse": "MODEL_ID_1",
    "TaskModel": "MODEL_ID_2",
    "UserTaskCreateRequest": "MODEL_ID_3",
    "UserTaskCreateResponse": "MODEL_ID_4"
  },
  "file_hashes": {
    "app/Controller/User/UserTaskController.php": {
      "file_hash": "sha256:abc...",
      "methods": {
        "create": {
          "line_start": 45,
          "line_end": 120,
          "method_hash": "sha256:def...",
          "request_id": "REQUEST_ID_1",
          "request_model_id": "MODEL_ID_3",
          "response_model_id": "MODEL_ID_4"
        },
        "list": {
          "line_start": 122,
          "line_end": 180,
          "method_hash": "sha256:ghi...",
          "request_id": "REQUEST_ID_2",
          "request_model_id": null,
          "response_model_id": "MODEL_ID_5"
        }
      }
    },
    "app/Model/Task.php": {
      "file_hash": "sha256:jkl...",
      "schema_hash": "sha256:mno...",
      "model_id": "MODEL_ID_2"
    }
  },
  "events_collection_id": "EVENTS_COLLECTION_ID"
}
```

**Manifest field reference:**

| Field | Purpose |
|-------|---------|
| `version` | Manifest schema version (currently 1) |
| `project_id` | PIU project ID for all entities |
| `repo_path` | Absolute path to the Hyperf repo |
| `framework` | Always "hyperf" |
| `synced_at` | ISO timestamp of last sync |
| `commit` | Git commit SHA at time of sync |
| `route_count` | Total routes processed |
| `collection_map` | URI prefix -> PIU collection ID |
| `request_map` | "METHOD:/uri" -> PIU request ID |
| `model_map` | Model name -> PIU model ID |
| `file_hashes` | Per-file and per-method hashes for incremental sync |
| `events_collection_id` | PIU collection ID for System Events |

### Step 7.4 — Print summary

```
## Hyperf Sync Complete

**Repository:** REPO_PATH
**Commit:** COMMIT_SHORT
**Framework:** Hyperf (Swoole)
**Project ID:** PROJECT_ID

### Created:
- 1 project, 1 environment (Development)
- N collections, M requests
- X data models (base + entity + request/response)
- 1 "System Events" collection (Y event references)

### Methods: POST: N | GET: N

### Incremental sync ready
Manifest written to .piu-sync/manifest.json
Next re-sync will only process changed files.
```

For incremental syncs, adjust the summary:

```
## Hyperf Incremental Sync Complete

**Repository:** REPO_PATH
**Commit:** OLD_COMMIT -> NEW_COMMIT
**Changed files:** N

### Updated:
- N requests updated (validation/response changes)
- N new requests created
- N models updated
- N routes flagged as removed (not auto-deleted)

### Incremental sync took ~Xs
```

---

## Edge Cases

### Split middleware groups
Example: `/pre` has 3 `addGroup` blocks with different middleware (`PreAuth` vs `PreAuthWithStatus`). Keep one "Pre" collection. Each request gets individual auth config based on its specific middleware from `describe:routes`.

### Closure routes
Routes with `action: "Closure"` (e.g., `/favicon.ico`) are included in route extraction but skipped in controller analysis. Set description to: "Closure handler — no controller source available."

### Shared controller methods
When the same controller::method is referenced by routes in multiple groups (e.g., same endpoint in both `/user` and `/admin`), analyze the method once and create separate PIU requests in each collection sharing the same request/response models.

### toArray() overrides
If a model overrides `toArray()`, the response model must reflect the overridden shape, not the raw `$fillable` fields. Read the `toArray()` method to understand transformations.

### GET|POST dual-method routes
`describe:routes` may show `GET|POST` for a single route. The parser splits these into separate entries. Create a PIU request for each method. Typically only the POST is meaningful — add a note to the GET request description: "Also accepts GET — same handler as POST."

### File upload endpoints
Detected via `file`/`image` validation rules or `$request->file()` calls. Set the request body type to `multipart` instead of `json`. Document the expected file field name.

### No validation rules
Some controller methods have no `$this->validation()` call. These still accept input via `$this->request->input()`. The request model is built entirely from undocumented inputs (Phase 2.2b). Flag these in the description: "No formal validation — inputs extracted from request->input() usage."

---

## Quick Reference

| Phase | What | How | Token Cost |
|-------|------|-----|-----------|
| 0 | Pre-flight | Bash: verify CLI + check manifest | ~100 |
| 1 | Route extraction | Bash: `describe:routes` + parser script | ~300 |
| 2 | Controller analysis | Claude: read PHP, extract rules/shapes | ~20K-30K |
| 3 | Model extraction | Claude: read PHP, extract schema | ~5K-10K |
| 4 | PIU creation | Bash: MCP CLI batch commands | ~2K |
| 5 | Documentation | Claude: generate markdown per endpoint | ~10K-15K |
| 6 | Incremental sync | Bash (mostly) + Claude (changed only) | ~200-10K |
| 7 | Verification | Bash: overview + manifest write | ~500 |

**Full sync total:** ~40K-60K tokens
**Typical daily re-sync:** ~200-5K tokens
