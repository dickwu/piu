use std::collections::HashSet;

use serde_json::Value;

use super::glob_match::matches_path;
use super::types::{AuthConfig, KeyValuePair, RequestConfig};
use crate::db::EnvVariable;

/// Resolve targeted variables against the given API path and inject matching
/// values into the request config.
///
/// Variables are filtered by glob-matching `match_paths` against `api_path`,
/// then sorted by `priority` descending (ties broken by `updated_at` descending).
/// Only the first match for each `(target_location, key)` pair is applied,
/// ensuring higher-priority variables win conflicts.
pub fn resolve_and_inject(
    config: &mut RequestConfig,
    variables: &[EnvVariable],
    api_path: &str,
) {
    let mut candidates: Vec<&EnvVariable> = variables
        .iter()
        .filter(|v| v.enabled)
        .filter(|v| matches_path(&v.match_paths, api_path))
        .collect();

    // Higher priority first; ties broken by more-recently-updated first
    candidates.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });

    let mut seen: HashSet<(String, String)> = HashSet::new();

    for var in &candidates {
        let dedup_key = (var.target_location.clone(), var.key.clone());
        if seen.contains(&dedup_key) {
            continue;
        }
        seen.insert(dedup_key);
        inject_variable(config, &var.target_location, &var.key, &var.value);
    }
}

/// Inject a single variable value into the appropriate location within the
/// request config.
fn inject_variable(config: &mut RequestConfig, target_location: &str, key: &str, value: &str) {
    match target_location {
        "header" => inject_header(config, key, value),
        "url-param" => inject_url_param(config, key, value),
        "url-path" => inject_url_path(config, key, value),
        "body" => inject_body(config, key, value),
        "auth-bearer" => inject_auth_bearer(config, value),
        "auth-basic-user" => inject_auth_basic_user(config, value),
        "auth-basic-pass" => inject_auth_basic_pass(config, value),
        "auth-apikey-name" => inject_auth_apikey_name(config, value),
        "auth-apikey-value" => inject_auth_apikey_value(config, value),
        _ => {} // Unknown target_location — silently ignore
    }
}

/// Add or override a header (case-insensitive key match for override).
fn inject_header(config: &mut RequestConfig, key: &str, value: &str) {
    let lower_key = key.to_lowercase();
    for header in &mut config.headers {
        if header.key.to_lowercase() == lower_key {
            header.value = value.to_string();
            header.enabled = true;
            return;
        }
    }
    config.headers.push(KeyValuePair {
        key: key.to_string(),
        value: value.to_string(),
        enabled: true,
    });
}

/// Add or override a URL query parameter (exact key match).
fn inject_url_param(config: &mut RequestConfig, key: &str, value: &str) {
    for param in &mut config.params {
        if param.key == key {
            param.value = value.to_string();
            param.enabled = true;
            return;
        }
    }
    config.params.push(KeyValuePair {
        key: key.to_string(),
        value: value.to_string(),
        enabled: true,
    });
}

/// Replace `{{key}}` placeholders in the URL string.
fn inject_url_path(config: &mut RequestConfig, key: &str, value: &str) {
    let placeholder = format!("{{{{{}}}}}", key);
    config.url = config.url.replace(&placeholder, value);
}

/// Set a JSON field at a dot-separated path in the body content.
/// Only operates when `body_type` is `"json"` and `content` is non-empty.
fn inject_body(config: &mut RequestConfig, key: &str, value: &str) {
    if config.body.body_type != "json" || config.body.content.is_empty() {
        return;
    }

    let mut root: Value = match serde_json::from_str(&config.body.content) {
        Ok(v) => v,
        Err(_) => return,
    };

    set_json_path(&mut root, key, value);

    if let Ok(serialized) = serde_json::to_string(&root) {
        config.body.content = serialized;
    }
}

/// Navigate a dot-separated path in a JSON value, creating intermediate
/// objects as needed, and set the leaf to the given string value.
fn set_json_path(root: &mut Value, path: &str, value: &str) {
    let segments: Vec<&str> = path.split('.').collect();
    let mut current = root;

    for segment in &segments[..segments.len().saturating_sub(1)] {
        if !current.is_object() {
            return;
        }
        let obj = current.as_object_mut().unwrap();
        current = obj
            .entry(segment.to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
    }

    if let Some(leaf_key) = segments.last() {
        if let Some(obj) = current.as_object_mut() {
            obj.insert(leaf_key.to_string(), Value::String(value.to_string()));
        }
    }
}

fn inject_auth_bearer(config: &mut RequestConfig, value: &str) {
    config.auth = AuthConfig {
        auth_type: "bearer".to_string(),
        token: Some(value.to_string()),
        ..config.auth.clone()
    };
}

fn inject_auth_basic_user(config: &mut RequestConfig, value: &str) {
    config.auth = AuthConfig {
        auth_type: "basic".to_string(),
        username: Some(value.to_string()),
        ..config.auth.clone()
    };
}

fn inject_auth_basic_pass(config: &mut RequestConfig, value: &str) {
    config.auth = AuthConfig {
        auth_type: "basic".to_string(),
        password: Some(value.to_string()),
        ..config.auth.clone()
    };
}

fn inject_auth_apikey_name(config: &mut RequestConfig, value: &str) {
    config.auth = AuthConfig {
        auth_type: "api_key".to_string(),
        header_name: Some(value.to_string()),
        ..config.auth.clone()
    };
}

fn inject_auth_apikey_value(config: &mut RequestConfig, value: &str) {
    config.auth = AuthConfig {
        auth_type: "api_key".to_string(),
        header_value: Some(value.to_string()),
        ..config.auth.clone()
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::EnvVariable;
    use crate::http::types::{AuthConfig, RequestBody, RequestConfig};

    fn make_config() -> RequestConfig {
        RequestConfig {
            method: "GET".to_string(),
            url: "/users/{{userId}}".to_string(),
            headers: vec![],
            params: vec![],
            body: RequestBody {
                body_type: "json".to_string(),
                content: String::new(),
            },
            auth: AuthConfig {
                auth_type: "none".to_string(),
                token: None,
                username: None,
                password: None,
                header_name: None,
                header_value: None,
            },
            description: None,
        }
    }

    fn make_variable(overrides: VariableOverrides) -> EnvVariable {
        EnvVariable {
            id: overrides.id.unwrap_or("var-1").to_string(),
            environment_id: "env-1".to_string(),
            key: overrides.key.unwrap_or("testKey").to_string(),
            value: overrides.value.unwrap_or("testValue").to_string(),
            enabled: overrides.enabled.unwrap_or(true),
            match_paths: overrides
                .match_paths
                .unwrap_or(r#"["*"]"#)
                .to_string(),
            target_location: overrides
                .target_location
                .unwrap_or("url-path")
                .to_string(),
            expires_at: None,
            priority: overrides.priority.unwrap_or(0),
            created_at: 1000,
            updated_at: overrides.updated_at.unwrap_or(1000),
        }
    }

    #[derive(Default)]
    struct VariableOverrides<'a> {
        id: Option<&'a str>,
        key: Option<&'a str>,
        value: Option<&'a str>,
        enabled: Option<bool>,
        match_paths: Option<&'a str>,
        target_location: Option<&'a str>,
        priority: Option<i64>,
        updated_at: Option<i64>,
    }

    #[test]
    fn test_inject_header() {
        let mut config = make_config();
        let vars = vec![make_variable(VariableOverrides {
            key: Some("Authorization"),
            value: Some("Bearer tok123"),
            target_location: Some("header"),
            ..Default::default()
        })];

        resolve_and_inject(&mut config, &vars, "users/profile");

        assert_eq!(config.headers.len(), 1);
        assert_eq!(config.headers[0].key, "Authorization");
        assert_eq!(config.headers[0].value, "Bearer tok123");
        assert!(config.headers[0].enabled);
    }

    #[test]
    fn test_inject_header_case_insensitive_override() {
        let mut config = make_config();
        config.headers.push(KeyValuePair {
            key: "content-type".to_string(),
            value: "text/plain".to_string(),
            enabled: true,
        });
        let vars = vec![make_variable(VariableOverrides {
            key: Some("Content-Type"),
            value: Some("application/json"),
            target_location: Some("header"),
            ..Default::default()
        })];

        resolve_and_inject(&mut config, &vars, "users/profile");

        assert_eq!(config.headers.len(), 1);
        assert_eq!(config.headers[0].key, "content-type"); // original key preserved
        assert_eq!(config.headers[0].value, "application/json");
    }

    #[test]
    fn test_inject_url_path() {
        let mut config = make_config();
        let vars = vec![make_variable(VariableOverrides {
            key: Some("userId"),
            value: Some("42"),
            target_location: Some("url-path"),
            ..Default::default()
        })];

        resolve_and_inject(&mut config, &vars, "users/42");

        assert_eq!(config.url, "/users/42");
    }

    #[test]
    fn test_inject_url_param() {
        let mut config = make_config();
        let vars = vec![make_variable(VariableOverrides {
            key: Some("page"),
            value: Some("3"),
            target_location: Some("url-param"),
            ..Default::default()
        })];

        resolve_and_inject(&mut config, &vars, "users/list");

        assert_eq!(config.params.len(), 1);
        assert_eq!(config.params[0].key, "page");
        assert_eq!(config.params[0].value, "3");
    }

    #[test]
    fn test_inject_url_param_override() {
        let mut config = make_config();
        config.params.push(KeyValuePair {
            key: "page".to_string(),
            value: "1".to_string(),
            enabled: true,
        });
        let vars = vec![make_variable(VariableOverrides {
            key: Some("page"),
            value: Some("5"),
            target_location: Some("url-param"),
            ..Default::default()
        })];

        resolve_and_inject(&mut config, &vars, "users/list");

        assert_eq!(config.params.len(), 1);
        assert_eq!(config.params[0].value, "5");
    }

    #[test]
    fn test_priority_wins() {
        let mut config = make_config();
        let vars = vec![
            make_variable(VariableOverrides {
                id: Some("low"),
                key: Some("Authorization"),
                value: Some("Bearer low-priority"),
                target_location: Some("header"),
                priority: Some(1),
                ..Default::default()
            }),
            make_variable(VariableOverrides {
                id: Some("high"),
                key: Some("Authorization"),
                value: Some("Bearer high-priority"),
                target_location: Some("header"),
                priority: Some(10),
                ..Default::default()
            }),
        ];

        resolve_and_inject(&mut config, &vars, "users/profile");

        assert_eq!(config.headers.len(), 1);
        assert_eq!(config.headers[0].value, "Bearer high-priority");
    }

    #[test]
    fn test_priority_tiebreak_by_updated_at() {
        let mut config = make_config();
        let vars = vec![
            make_variable(VariableOverrides {
                id: Some("older"),
                key: Some("X-Token"),
                value: Some("old-token"),
                target_location: Some("header"),
                priority: Some(5),
                updated_at: Some(1000),
                ..Default::default()
            }),
            make_variable(VariableOverrides {
                id: Some("newer"),
                key: Some("X-Token"),
                value: Some("new-token"),
                target_location: Some("header"),
                priority: Some(5),
                updated_at: Some(2000),
                ..Default::default()
            }),
        ];

        resolve_and_inject(&mut config, &vars, "users/profile");

        assert_eq!(config.headers.len(), 1);
        assert_eq!(config.headers[0].value, "new-token");
    }

    #[test]
    fn test_no_match_skips() {
        let mut config = make_config();
        let vars = vec![make_variable(VariableOverrides {
            key: Some("adminToken"),
            value: Some("secret"),
            target_location: Some("header"),
            match_paths: Some(r#"["admin*"]"#),
            ..Default::default()
        })];

        resolve_and_inject(&mut config, &vars, "users/profile");

        assert!(config.headers.is_empty());
    }

    #[test]
    fn test_disabled_skips() {
        let mut config = make_config();
        let vars = vec![make_variable(VariableOverrides {
            key: Some("Authorization"),
            value: Some("Bearer tok"),
            target_location: Some("header"),
            enabled: Some(false),
            ..Default::default()
        })];

        resolve_and_inject(&mut config, &vars, "users/profile");

        assert!(config.headers.is_empty());
    }

    #[test]
    fn test_inject_auth_bearer() {
        let mut config = make_config();
        let vars = vec![make_variable(VariableOverrides {
            key: Some("token"),
            value: Some("my-jwt-token"),
            target_location: Some("auth-bearer"),
            ..Default::default()
        })];

        resolve_and_inject(&mut config, &vars, "users/profile");

        assert_eq!(config.auth.auth_type, "bearer");
        assert_eq!(config.auth.token.as_deref(), Some("my-jwt-token"));
    }

    #[test]
    fn test_inject_auth_basic() {
        let mut config = make_config();
        let vars = vec![
            make_variable(VariableOverrides {
                id: Some("user"),
                key: Some("user"),
                value: Some("admin"),
                target_location: Some("auth-basic-user"),
                ..Default::default()
            }),
            make_variable(VariableOverrides {
                id: Some("pass"),
                key: Some("pass"),
                value: Some("s3cret"),
                target_location: Some("auth-basic-pass"),
                ..Default::default()
            }),
        ];

        resolve_and_inject(&mut config, &vars, "admin/settings");

        assert_eq!(config.auth.auth_type, "basic");
        assert_eq!(config.auth.username.as_deref(), Some("admin"));
        assert_eq!(config.auth.password.as_deref(), Some("s3cret"));
    }

    #[test]
    fn test_inject_auth_apikey() {
        let mut config = make_config();
        let vars = vec![
            make_variable(VariableOverrides {
                id: Some("name"),
                key: Some("name"),
                value: Some("X-Api-Key"),
                target_location: Some("auth-apikey-name"),
                ..Default::default()
            }),
            make_variable(VariableOverrides {
                id: Some("val"),
                key: Some("val"),
                value: Some("key-123"),
                target_location: Some("auth-apikey-value"),
                ..Default::default()
            }),
        ];

        resolve_and_inject(&mut config, &vars, "users/profile");

        assert_eq!(config.auth.auth_type, "api_key");
        assert_eq!(config.auth.header_name.as_deref(), Some("X-Api-Key"));
        assert_eq!(config.auth.header_value.as_deref(), Some("key-123"));
    }

    #[test]
    fn test_inject_body_json() {
        let mut config = make_config();
        config.body = RequestBody {
            body_type: "json".to_string(),
            content: r#"{"name":"test"}"#.to_string(),
        };
        let vars = vec![make_variable(VariableOverrides {
            key: Some("data.userId"),
            value: Some("42"),
            target_location: Some("body"),
            ..Default::default()
        })];

        resolve_and_inject(&mut config, &vars, "users/create");

        let parsed: Value = serde_json::from_str(&config.body.content).unwrap();
        assert_eq!(parsed["data"]["userId"], "42");
        assert_eq!(parsed["name"], "test"); // original field preserved
    }

    #[test]
    fn test_inject_body_skips_non_json() {
        let mut config = make_config();
        config.body = RequestBody {
            body_type: "text".to_string(),
            content: "hello world".to_string(),
        };
        let vars = vec![make_variable(VariableOverrides {
            key: Some("field"),
            value: Some("val"),
            target_location: Some("body"),
            ..Default::default()
        })];

        resolve_and_inject(&mut config, &vars, "users/create");

        assert_eq!(config.body.content, "hello world"); // unchanged
    }

    #[test]
    fn test_inject_body_skips_empty_content() {
        let mut config = make_config();
        config.body = RequestBody {
            body_type: "json".to_string(),
            content: String::new(),
        };
        let vars = vec![make_variable(VariableOverrides {
            key: Some("field"),
            value: Some("val"),
            target_location: Some("body"),
            ..Default::default()
        })];

        resolve_and_inject(&mut config, &vars, "users/create");

        assert!(config.body.content.is_empty()); // unchanged
    }

    #[test]
    fn test_set_json_path_nested() {
        let mut root: Value = serde_json::from_str(r#"{"a":1}"#).unwrap();
        set_json_path(&mut root, "b.c.d", "deep");
        assert_eq!(root["b"]["c"]["d"], "deep");
        assert_eq!(root["a"], 1);
    }

    #[test]
    fn test_set_json_path_overwrites_existing() {
        let mut root: Value = serde_json::from_str(r#"{"x":"old"}"#).unwrap();
        set_json_path(&mut root, "x", "new");
        assert_eq!(root["x"], "new");
    }

    #[test]
    fn test_multiple_variables_different_targets() {
        let mut config = make_config();
        config.body = RequestBody {
            body_type: "json".to_string(),
            content: r#"{"status":"pending"}"#.to_string(),
        };
        let vars = vec![
            make_variable(VariableOverrides {
                id: Some("v1"),
                key: Some("userId"),
                value: Some("99"),
                target_location: Some("url-path"),
                ..Default::default()
            }),
            make_variable(VariableOverrides {
                id: Some("v2"),
                key: Some("X-Request-Id"),
                value: Some("req-abc"),
                target_location: Some("header"),
                ..Default::default()
            }),
            make_variable(VariableOverrides {
                id: Some("v3"),
                key: Some("limit"),
                value: Some("20"),
                target_location: Some("url-param"),
                ..Default::default()
            }),
            make_variable(VariableOverrides {
                id: Some("v4"),
                key: Some("meta.source"),
                value: Some("api"),
                target_location: Some("body"),
                ..Default::default()
            }),
        ];

        resolve_and_inject(&mut config, &vars, "users/99");

        assert_eq!(config.url, "/users/99");
        assert_eq!(config.headers[0].key, "X-Request-Id");
        assert_eq!(config.headers[0].value, "req-abc");
        assert_eq!(config.params[0].key, "limit");
        assert_eq!(config.params[0].value, "20");
        let parsed: Value = serde_json::from_str(&config.body.content).unwrap();
        assert_eq!(parsed["meta"]["source"], "api");
        assert_eq!(parsed["status"], "pending");
    }
}
