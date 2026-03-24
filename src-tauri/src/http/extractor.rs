use std::collections::HashMap;

use serde_json::Value;
use serde_json_path::JsonPath;

/// Result of extracting a value from a response body or headers.
#[derive(Debug, Clone, PartialEq)]
pub enum ExtractionResult {
    /// A single scalar value was extracted (stringified).
    Scalar(String),
    /// Multiple values matched — caller should present a picker or use all.
    Array(Vec<Value>),
    /// The selector path did not match anything in the response.
    NotFound,
    /// The response body is not valid JSON.
    InvalidJson,
    /// The selector matched a non-scalar value (object or nested structure).
    NonScalar,
}

/// Convert a user-friendly dot-path selector into RFC 9535 JSONPath syntax.
///
/// Users write selectors like `data.token` or `data.[*].id`. This function
/// normalises them into valid JSONPath strings that `serde_json_path` can parse:
///
/// - Prepends `$.` when the selector does not already start with `$`
/// - Converts `.[*]` shorthand into `[*]` (removes the leading dot before brackets)
fn normalise_selector(selector: &str) -> String {
    let with_root = if selector.starts_with('$') {
        selector.to_string()
    } else {
        format!("$.{selector}")
    };

    // Replace `.[*]` → `[*]` and `.[0]` → `[0]` etc. — a dot before `[` is
    // invalid in RFC 9535 JSONPath and must be removed.
    with_root.replace(".[", "[")
}

/// Stringify a `serde_json::Value` for use as an extracted scalar.
///
/// Strings are returned without surrounding quotes; numbers and booleans are
/// converted via their Display impl; null becomes the literal string `"null"`.
fn stringify_value(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        // Objects and arrays are serialised as compact JSON.
        other => other.to_string(),
    }
}

/// Extract a value from a JSON response body using a JSONPath-like selector.
///
/// The `selector` follows a simplified dot-path convention used by PIU's UI:
///
/// | User writes         | JSONPath equivalent     |
/// |---------------------|-------------------------|
/// | `data.token`        | `$.data.token`          |
/// | `data.user.id`      | `$.data.user.id`        |
/// | `data[*].id`        | `$.data[*].id`          |
/// | `$.already.valid`   | `$.already.valid`       |
///
/// Returns an [`ExtractionResult`] describing what was found.
pub fn extract_from_body(body: &str, selector: &str) -> ExtractionResult {
    let parsed: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return ExtractionResult::InvalidJson,
    };

    let jsonpath_str = normalise_selector(selector);

    let path = match JsonPath::parse(&jsonpath_str) {
        Ok(p) => p,
        Err(_) => return ExtractionResult::NotFound,
    };

    let node_list = path.query(&parsed);

    if node_list.is_empty() {
        return ExtractionResult::NotFound;
    }

    let nodes = node_list.all();

    if nodes.len() == 1 {
        let node = nodes[0];
        match node {
            Value::Object(_) | Value::Array(_) => ExtractionResult::NonScalar,
            _ => ExtractionResult::Scalar(stringify_value(node)),
        }
    } else {
        ExtractionResult::Array(nodes.into_iter().cloned().collect())
    }
}

/// Extract a value from response headers by name (case-insensitive).
pub fn extract_from_header(
    headers: &HashMap<String, String>,
    header_name: &str,
) -> ExtractionResult {
    let lower = header_name.to_lowercase();

    for (key, value) in headers {
        if key.to_lowercase() == lower {
            return ExtractionResult::Scalar(value.clone());
        }
    }

    ExtractionResult::NotFound
}

/// Replace `{{value}}` placeholders in a template string with the given value.
pub fn apply_template(template: &str, value: &str) -> String {
    template.replace("{{value}}", value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_simple_field() {
        let body = r#"{"data":{"token":"abc"}}"#;
        let result = extract_from_body(body, "data.token");
        assert_eq!(result, ExtractionResult::Scalar("abc".to_string()));
    }

    #[test]
    fn test_extract_nested() {
        let body = r#"{"data":{"user":{"accessToken":"xyz"}}}"#;
        let result = extract_from_body(body, "data.user.accessToken");
        assert_eq!(result, ExtractionResult::Scalar("xyz".to_string()));
    }

    #[test]
    fn test_extract_number() {
        let body = r#"{"count":42}"#;
        let result = extract_from_body(body, "count");
        assert_eq!(result, ExtractionResult::Scalar("42".to_string()));
    }

    #[test]
    fn test_extract_boolean() {
        let body = r#"{"active":true}"#;
        let result = extract_from_body(body, "active");
        assert_eq!(result, ExtractionResult::Scalar("true".to_string()));
    }

    #[test]
    fn test_extract_array() {
        let body = r#"{"data":[{"id":1},{"id":2}]}"#;
        let result = extract_from_body(body, "data[*].id");
        assert_eq!(
            result,
            ExtractionResult::Array(vec![serde_json::json!(1), serde_json::json!(2),])
        );
    }

    #[test]
    fn test_extract_not_found() {
        let body = r#"{"data":{"token":"abc"}}"#;
        let result = extract_from_body(body, "data.missing");
        assert_eq!(result, ExtractionResult::NotFound);
    }

    #[test]
    fn test_extract_invalid_json() {
        let body = "not json at all";
        let result = extract_from_body(body, "data.token");
        assert_eq!(result, ExtractionResult::InvalidJson);
    }

    #[test]
    fn test_extract_non_scalar_object() {
        let body = r#"{"data":{"user":{"name":"alice","age":30}}}"#;
        let result = extract_from_body(body, "data.user");
        assert_eq!(result, ExtractionResult::NonScalar);
    }

    #[test]
    fn test_extract_with_dollar_prefix() {
        let body = r#"{"data":{"token":"abc"}}"#;
        let result = extract_from_body(body, "$.data.token");
        assert_eq!(result, ExtractionResult::Scalar("abc".to_string()));
    }

    #[test]
    fn test_extract_from_header() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "Bearer xyz".to_string());
        headers.insert("Content-Type".to_string(), "application/json".to_string());

        // Case-insensitive match
        let result = extract_from_header(&headers, "authorization");
        assert_eq!(result, ExtractionResult::Scalar("Bearer xyz".to_string()));

        let result = extract_from_header(&headers, "CONTENT-TYPE");
        assert_eq!(
            result,
            ExtractionResult::Scalar("application/json".to_string())
        );
    }

    #[test]
    fn test_extract_from_header_not_found() {
        let headers = HashMap::new();
        let result = extract_from_header(&headers, "X-Missing");
        assert_eq!(result, ExtractionResult::NotFound);
    }

    #[test]
    fn test_apply_template() {
        let result = apply_template("Bearer {{value}}", "abc");
        assert_eq!(result, "Bearer abc");
    }

    #[test]
    fn test_apply_template_multiple_placeholders() {
        let result = apply_template("{{value}}/{{value}}", "tok");
        assert_eq!(result, "tok/tok");
    }

    #[test]
    fn test_apply_template_no_placeholder() {
        let result = apply_template("static-value", "ignored");
        assert_eq!(result, "static-value");
    }

    #[test]
    fn test_normalise_selector_dot_bracket() {
        // `data.[*].id` should become `$.data[*].id`
        let normalised = normalise_selector("data.[*].id");
        assert_eq!(normalised, "$.data[*].id");
    }

    #[test]
    fn test_extract_null_value() {
        let body = r#"{"data":null}"#;
        let result = extract_from_body(body, "data");
        assert_eq!(result, ExtractionResult::Scalar("null".to_string()));
    }

    #[test]
    fn test_extract_root_level() {
        let body = r#"{"token":"abc123"}"#;
        let result = extract_from_body(body, "token");
        assert_eq!(result, ExtractionResult::Scalar("abc123".to_string()));
    }
}
