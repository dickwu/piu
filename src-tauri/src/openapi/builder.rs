use crate::db;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// Returned by `build_openapi_spec` after successfully generating a spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenApiSpecResult {
    pub spec_json: String,
    pub generated_at: String,
    pub endpoint_count: usize,
    pub schema_count: usize,
}

// Standard headers that should be omitted from per-operation parameters because
// they are handled at the transport/auth level.
const STANDARD_HEADERS: &[&str] = &["content-type", "authorization", "accept"];

/// Build a complete OpenAPI 3.1 JSON spec from the project stored in the local
/// SQLite database, persist it via `db::upsert_spec`, and return the result.
pub async fn build_openapi_spec(project_id: &str) -> Result<OpenApiSpecResult, String> {
    // ── Load data from the database ─────────────────────────────────────────
    let project = db::get_project(project_id)
        .await
        .map_err(|e| format!("Failed to load project: {}", e))?
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;

    let collections = db::list_collections(Some(project_id))
        .await
        .map_err(|e| format!("Failed to load collections: {}", e))?;

    let models = db::list_models(project_id)
        .await
        .map_err(|e| format!("Failed to load models: {}", e))?;

    let active_env = db::get_active_environment(project_id)
        .await
        .map_err(|e| format!("Failed to load active environment: {}", e))?;

    // ── info ─────────────────────────────────────────────────────────────────
    let mut info = Map::new();
    info.insert("title".into(), Value::String(project.name.clone()));
    info.insert("version".into(), Value::String("1.0.0".into()));
    if let Some(ref desc) = project.description {
        if !desc.is_empty() {
            info.insert("description".into(), Value::String(desc.clone()));
        }
    }

    // ── servers ──────────────────────────────────────────────────────────────
    let servers: Value = if let Some(ref env) = active_env {
        if let Some(ref host) = env.host {
            if !host.is_empty() {
                json!([{"url": host, "description": env.name}])
            } else {
                json!([{"url": "/"}])
            }
        } else {
            json!([{"url": "/"}])
        }
    } else {
        json!([{"url": "/"}])
    };

    // ── tags (one per collection) ─────────────────────────────────────────────
    let tags: Value = {
        let tag_list: Vec<Value> = collections
            .iter()
            .map(|c| {
                let mut tag = Map::new();
                tag.insert("name".into(), Value::String(c.name.clone()));
                if let Some(ref desc) = c.description {
                    if !desc.is_empty() {
                        tag.insert("description".into(), Value::String(desc.clone()));
                    }
                }
                Value::Object(tag)
            })
            .collect();
        Value::Array(tag_list)
    };

    // ── components/schemas ───────────────────────────────────────────────────
    let mut schemas = Map::new();
    for model in &models {
        let schema = build_model_schema(model, &models);
        schemas.insert(model.name.clone(), schema);
    }
    let schema_count = schemas.len();

    // ── paths ────────────────────────────────────────────────────────────────
    let mut paths: Map<String, Value> = Map::new();
    let mut endpoint_count = 0usize;

    for collection in &collections {
        let requests = db::list_requests(&collection.id).await.map_err(|e| {
            format!(
                "Failed to load requests for collection '{}': {}",
                collection.id, e
            )
        })?;

        for request in &requests {
            // Parse the config JSON blob
            let config: Value = serde_json::from_str(&request.config).unwrap_or_else(|_| json!({}));

            let method = config
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("GET")
                .to_lowercase();

            let raw_path = config
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            // Build full path: collection prefix + request url
            let prefix = collection
                .path_prefix
                .as_deref()
                .unwrap_or("")
                .trim_end_matches('/');
            let suffix = raw_path.trim_start_matches('/');
            let combined = if prefix.is_empty() {
                format!("/{}", suffix)
            } else if suffix.is_empty() {
                prefix.to_string()
            } else {
                format!("{}/{}", prefix, suffix)
            };

            // Convert {{param}} → {param} for OpenAPI path templating
            let openapi_path = convert_path_params(&combined);

            // Extract path parameter names
            let path_param_names = extract_path_param_names(&combined);

            // Build parameters array
            let mut parameters: Vec<Value> = Vec::new();

            // Path parameters (always required)
            for param_name in &path_param_names {
                parameters.push(json!({
                    "name": param_name,
                    "in": "path",
                    "required": true,
                    "schema": { "type": "string" }
                }));
            }

            // Query parameters
            if let Some(params_arr) = config.get("params").and_then(Value::as_array) {
                for param in params_arr {
                    let enabled = param
                        .get("enabled")
                        .and_then(Value::as_bool)
                        .unwrap_or(true);
                    if !enabled {
                        continue;
                    }
                    let key = param
                        .get("key")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if key.is_empty() {
                        continue;
                    }
                    let value = param.get("value").and_then(Value::as_str).unwrap_or("");
                    let mut p = Map::new();
                    p.insert("name".into(), Value::String(key.to_string()));
                    p.insert("in".into(), Value::String("query".into()));
                    p.insert("required".into(), Value::Bool(false));
                    p.insert("schema".into(), json!({"type": "string"}));
                    if !value.is_empty() {
                        p.insert("example".into(), Value::String(value.to_string()));
                    }
                    parameters.push(Value::Object(p));
                }
            }

            // Header parameters (skip standard ones)
            if let Some(headers_arr) = config.get("headers").and_then(Value::as_array) {
                for header in headers_arr {
                    let enabled = header
                        .get("enabled")
                        .and_then(Value::as_bool)
                        .unwrap_or(true);
                    if !enabled {
                        continue;
                    }
                    let key = header
                        .get("key")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if key.is_empty() {
                        continue;
                    }
                    if STANDARD_HEADERS.contains(&key.to_lowercase().as_str()) {
                        continue;
                    }
                    let value = header.get("value").and_then(Value::as_str).unwrap_or("");
                    let mut h = Map::new();
                    h.insert("name".into(), Value::String(key.to_string()));
                    h.insert("in".into(), Value::String("header".into()));
                    h.insert("required".into(), Value::Bool(false));
                    h.insert("schema".into(), json!({"type": "string"}));
                    if !value.is_empty() {
                        h.insert("example".into(), Value::String(value.to_string()));
                    }
                    parameters.push(Value::Object(h));
                }
            }

            // Build security requirements from auth config
            let security_schemes = build_security_for_operation(&config);

            // Build request body
            let request_body = build_request_body(&config, &models);

            // Build responses
            let responses = build_responses(&config, &models);

            // Build the operation object
            let mut operation: Map<String, Value> = Map::new();
            operation.insert("tags".into(), json!([collection.name]));
            operation.insert(
                "operationId".into(),
                Value::String(sanitize_operation_id(&request.name)),
            );
            if let Some(desc) = config.get("description").and_then(Value::as_str) {
                if !desc.is_empty() {
                    operation.insert("description".into(), Value::String(desc.to_string()));
                }
            }
            operation.insert("summary".into(), Value::String(request.name.clone()));

            // Store the PIU request ID for the "Try It" feature — insert BEFORE
            // adding to paths map.
            operation.insert("x-piu-request-id".into(), Value::String(request.id.clone()));

            if !parameters.is_empty() {
                operation.insert("parameters".into(), Value::Array(parameters));
            }
            if let Some(body) = request_body {
                operation.insert("requestBody".into(), body);
            }
            operation.insert("responses".into(), responses);
            if !security_schemes.is_empty() {
                operation.insert("security".into(), Value::Array(security_schemes));
            }

            // Insert operation into paths map
            let path_entry = paths
                .entry(openapi_path.clone())
                .or_insert_with(|| Value::Object(Map::new()));

            if let Value::Object(ref mut methods_map) = path_entry {
                methods_map.insert(method.clone(), Value::Object(operation));
            }

            endpoint_count += 1;
        }
    }

    // ── Assemble spec ────────────────────────────────────────────────────────
    let mut spec = Map::new();
    spec.insert("openapi".into(), Value::String("3.1.0".into()));
    spec.insert("info".into(), Value::Object(info));
    spec.insert("servers".into(), servers);
    if !tags.as_array().map_or(true, |v| v.is_empty()) {
        spec.insert("tags".into(), tags);
    }
    spec.insert("paths".into(), Value::Object(paths));

    if !schemas.is_empty() {
        spec.insert(
            "components".into(),
            json!({"schemas": Value::Object(schemas)}),
        );
    }

    let generated_at = chrono::Utc::now().to_rfc3339();
    let spec_json = serde_json::to_string_pretty(&Value::Object(spec))
        .map_err(|e| format!("Failed to serialize spec: {}", e))?;

    // Persist to the database
    db::upsert_spec(project_id, &spec_json, &generated_at)
        .await
        .map_err(|e| format!("Failed to persist spec: {}", e))?;

    Ok(OpenApiSpecResult {
        spec_json,
        generated_at,
        endpoint_count,
        schema_count,
    })
}

// ── Helper: build a JSON Schema for one DataModel ───────────────────────────

fn build_model_schema(model: &db::DataModel, all_models: &[db::DataModel]) -> Value {
    let fields: Vec<Value> = serde_json::from_str(&model.fields).unwrap_or_default();

    let mut own_properties: Map<String, Value> = Map::new();
    let mut required_fields: Vec<Value> = Vec::new();

    for field in &fields {
        let name = field.get("name").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() {
            continue;
        }
        let field_type = field
            .get("field_type")
            .and_then(Value::as_str)
            .unwrap_or("string");
        let description = field
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("");
        let required = field
            .get("required")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let example = field.get("example").and_then(Value::as_str);
        let ref_model_id = field.get("ref_model_id").and_then(Value::as_str);

        let mut prop: Map<String, Value> = Map::new();

        if let Some(ref_id) = ref_model_id {
            // Resolve the referenced model name for $ref
            if let Some(ref_model) = all_models.iter().find(|m| m.id == ref_id) {
                prop.insert(
                    "$ref".into(),
                    Value::String(format!("#/components/schemas/{}", ref_model.name)),
                );
            } else {
                prop.insert("type".into(), Value::String("object".into()));
            }
        } else {
            let (oa_type, oa_format, is_array) = map_field_type(field_type);
            if is_array {
                prop.insert("type".into(), Value::String("array".into()));
                prop.insert("items".into(), json!({"type": oa_type}));
            } else {
                prop.insert("type".into(), Value::String(oa_type.into()));
                if let Some(fmt) = oa_format {
                    prop.insert("format".into(), Value::String(fmt.into()));
                }
            }
        }

        if !description.is_empty() {
            prop.insert("description".into(), Value::String(description.to_string()));
        }
        if let Some(ex) = example {
            if !ex.is_empty() {
                prop.insert("example".into(), Value::String(ex.to_string()));
            }
        }

        if required {
            required_fields.push(Value::String(name.to_string()));
        }

        own_properties.insert(name.to_string(), Value::Object(prop));
    }

    // Determine whether this schema uses allOf (inheritance / mixins)
    let has_parent = model.parent_model_id.is_some();
    let mixin_ids: Vec<String> = serde_json::from_str(&model.mixin_model_ids).unwrap_or_default();
    let has_mixins = !mixin_ids.is_empty();

    if has_parent || has_mixins {
        // Use allOf composition
        let mut all_of_list: Vec<Value> = Vec::new();

        // Parent first
        if let Some(ref parent_id) = model.parent_model_id {
            if let Some(parent) = all_models.iter().find(|m| m.m_id() == parent_id) {
                all_of_list.push(json!({"$ref": format!("#/components/schemas/{}", parent.name)}));
            }
        }

        // Mixins
        for mixin_id in &mixin_ids {
            if let Some(mixin) = all_models.iter().find(|m| m.m_id() == mixin_id.as_str()) {
                all_of_list.push(json!({"$ref": format!("#/components/schemas/{}", mixin.name)}));
            }
        }

        // Own properties as an inline schema
        if !own_properties.is_empty() {
            let mut own_schema: Map<String, Value> = Map::new();
            own_schema.insert("type".into(), Value::String("object".into()));
            own_schema.insert("properties".into(), Value::Object(own_properties));
            if !required_fields.is_empty() {
                own_schema.insert("required".into(), Value::Array(required_fields));
            }
            all_of_list.push(Value::Object(own_schema));
        }

        let mut schema: Map<String, Value> = Map::new();
        if let Some(ref desc) = model.description {
            if !desc.is_empty() {
                schema.insert("description".into(), Value::String(desc.clone()));
            }
        }
        schema.insert("allOf".into(), Value::Array(all_of_list));
        Value::Object(schema)
    } else {
        // Plain object schema
        let mut schema: Map<String, Value> = Map::new();
        schema.insert("type".into(), Value::String("object".into()));
        if let Some(ref desc) = model.description {
            if !desc.is_empty() {
                schema.insert("description".into(), Value::String(desc.clone()));
            }
        }
        if !own_properties.is_empty() {
            schema.insert("properties".into(), Value::Object(own_properties));
        }
        if !required_fields.is_empty() {
            schema.insert("required".into(), Value::Array(required_fields));
        }
        Value::Object(schema)
    }
}

// Trait extension so we can call `.m_id()` on DataModel for ID lookup in a
// closure without having to use `.id` (avoids the "field is private" confusion
// and lets us write cleaner `.find` closures).
trait ModelId {
    fn m_id(&self) -> &str;
}

impl ModelId for db::DataModel {
    fn m_id(&self) -> &str {
        &self.id
    }
}

// ── Helper: map PIU field type → (OpenAPI type, optional format, is_array) ──

fn map_field_type(field_type: &str) -> (&'static str, Option<&'static str>, bool) {
    match field_type {
        "string" | "text" => ("string", None, false),
        "integer" | "int" | "int32" => ("integer", Some("int32"), false),
        "int64" | "long" => ("integer", Some("int64"), false),
        "float" | "number" => ("number", Some("float"), false),
        "double" => ("number", Some("double"), false),
        "boolean" | "bool" => ("boolean", None, false),
        "date" => ("string", Some("date"), false),
        "datetime" | "date-time" => ("string", Some("date-time"), false),
        "uuid" => ("string", Some("uuid"), false),
        "email" => ("string", Some("email"), false),
        "uri" | "url" => ("string", Some("uri"), false),
        "byte" | "binary" => ("string", Some("binary"), false),
        "array" => ("string", None, true),
        "object" => ("object", None, false),
        _ => ("string", None, false),
    }
}

// ── Helper: convert {{param}} placeholders to {param} ───────────────────────

pub fn convert_path_params(path: &str) -> String {
    let mut result = String::with_capacity(path.len());
    let mut chars = path.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '{' {
            // Check for double-brace opening: {{
            if chars.peek() == Some(&'{') {
                chars.next(); // consume second '{'
                result.push('{'); // output single '{'
                                  // Collect until '}}'
                let mut inner = String::new();
                loop {
                    match chars.next() {
                        Some('}') => {
                            if chars.peek() == Some(&'}') {
                                chars.next(); // consume second '}'
                                break;
                            } else {
                                inner.push('}');
                            }
                        }
                        Some(c) => inner.push(c),
                        None => break,
                    }
                }
                result.push_str(&inner);
                result.push('}');
            } else {
                // Single brace — pass through as-is (already OpenAPI style)
                result.push(ch);
            }
        } else {
            result.push(ch);
        }
    }

    result
}

// ── Helper: extract param names from {{name}} patterns ───────────────────────

pub fn extract_path_param_names(path: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut remaining = path;

    while let Some(start) = remaining.find("{{") {
        remaining = &remaining[start + 2..];
        if let Some(end) = remaining.find("}}") {
            let name = remaining[..end].trim().to_string();
            if !name.is_empty() && !names.contains(&name) {
                names.push(name);
            }
            remaining = &remaining[end + 2..];
        } else {
            break;
        }
    }

    names
}

// ── Helper: produce an operationId that is a valid identifier ────────────────

fn sanitize_operation_id(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    // Collapse runs of underscores
    let mut result = String::with_capacity(cleaned.len());
    let mut prev_underscore = false;
    for ch in cleaned.chars() {
        if ch == '_' {
            if !prev_underscore {
                result.push(ch);
            }
            prev_underscore = true;
        } else {
            result.push(ch);
            prev_underscore = false;
        }
    }
    result.trim_matches('_').to_string()
}

// ── Helper: build security requirement entry for an operation ────────────────

fn build_security_for_operation(config: &Value) -> Vec<Value> {
    let auth = match config.get("auth") {
        Some(a) => a,
        None => return Vec::new(),
    };
    let auth_type = auth.get("type").and_then(Value::as_str).unwrap_or("none");

    match auth_type {
        "bearer" => vec![json!({"bearerAuth": []})],
        "basic" => vec![json!({"basicAuth": []})],
        "api_key" | "apiKey" => vec![json!({"apiKeyAuth": []})],
        _ => Vec::new(),
    }
}

// ── Helper: build requestBody from config ────────────────────────────────────

fn build_request_body(config: &Value, models: &[db::DataModel]) -> Option<Value> {
    let method = config
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET")
        .to_uppercase();

    // GET, HEAD, DELETE, OPTIONS typically have no body
    if matches!(method.as_str(), "GET" | "HEAD" | "OPTIONS") {
        return None;
    }

    let body = config.get("body")?;
    let body_type = body.get("type").and_then(Value::as_str).unwrap_or("none");
    let content_str = body.get("content").and_then(Value::as_str).unwrap_or("");

    // Check if there is a requestModelId linking to a schema
    let request_model_id = config.get("requestModelId").and_then(Value::as_str);

    let schema: Value = if let Some(model_id) = request_model_id {
        if let Some(model) = models.iter().find(|m| m.id == model_id) {
            json!({"$ref": format!("#/components/schemas/{}", model.name)})
        } else {
            json!({"type": "object"})
        }
    } else {
        match body_type {
            "json" => {
                // Try to infer schema from content
                if content_str.is_empty() {
                    json!({"type": "object"})
                } else if let Ok(parsed) = serde_json::from_str::<Value>(content_str) {
                    infer_schema_from_value(&parsed)
                } else {
                    json!({"type": "object"})
                }
            }
            "form" | "form-data" => json!({"type": "object"}),
            "text" | "plain" => json!({"type": "string"}),
            "xml" => json!({"type": "string", "format": "xml"}),
            "binary" => json!({"type": "string", "format": "binary"}),
            _ => return None,
        }
    };

    let media_type = match body_type {
        "json" => "application/json",
        "form" => "application/x-www-form-urlencoded",
        "form-data" => "multipart/form-data",
        "text" | "plain" => "text/plain",
        "xml" => "application/xml",
        "binary" => "application/octet-stream",
        _ => "application/json",
    };

    Some(json!({
        "required": true,
        "content": {
            media_type: {
                "schema": schema
            }
        }
    }))
}

// ── Helper: infer a simple JSON Schema from an example value ─────────────────

fn infer_schema_from_value(value: &Value) -> Value {
    match value {
        Value::Object(obj) => {
            let mut properties: Map<String, Value> = Map::new();
            for (k, v) in obj {
                properties.insert(k.clone(), infer_schema_from_value(v));
            }
            json!({"type": "object", "properties": properties})
        }
        Value::Array(arr) => {
            let items = arr
                .first()
                .map(infer_schema_from_value)
                .unwrap_or(json!({}));
            json!({"type": "array", "items": items})
        }
        Value::String(_) => json!({"type": "string"}),
        Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                json!({"type": "integer"})
            } else {
                json!({"type": "number"})
            }
        }
        Value::Bool(_) => json!({"type": "boolean"}),
        Value::Null => json!({"nullable": true}),
    }
}

// ── Helper: build responses object ───────────────────────────────────────────

fn build_responses(config: &Value, models: &[db::DataModel]) -> Value {
    let response_model_id = config.get("responseModelId").and_then(Value::as_str);

    let success_schema: Value = if let Some(model_id) = response_model_id {
        if let Some(model) = models.iter().find(|m| m.id == model_id) {
            json!({"$ref": format!("#/components/schemas/{}", model.name)})
        } else {
            json!({"type": "object"})
        }
    } else {
        json!({"type": "object"})
    };

    json!({
        "200": {
            "description": "Successful response",
            "content": {
                "application/json": {
                    "schema": success_schema
                }
            }
        },
        "400": {
            "description": "Bad request"
        },
        "401": {
            "description": "Unauthorized"
        },
        "500": {
            "description": "Internal server error"
        }
    })
}
