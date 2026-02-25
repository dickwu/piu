use super::types::{HttpResponse, RequestConfig, ResponseTiming};
use std::collections::HashMap;
use std::time::Instant;

/// Interpolate {{variable}} placeholders with environment values
fn interpolate(text: &str, variables: &HashMap<String, String>) -> String {
    let mut result = text.to_string();
    for (key, value) in variables {
        let placeholder = format!("{{{{{}}}}}", key);
        result = result.replace(&placeholder, value);
    }
    result
}

/// Execute an HTTP request with the given config and environment variables
pub async fn execute(
    config: &RequestConfig,
    env_variables: &HashMap<String, String>,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Interpolate URL
    let mut url = interpolate(&config.url, env_variables);

    // Append query parameters
    let enabled_params: Vec<_> = config
        .params
        .iter()
        .filter(|p| p.enabled && !p.key.is_empty())
        .collect();

    if !enabled_params.is_empty() {
        let separator = if url.contains('?') { "&" } else { "?" };
        let query_string: Vec<String> = enabled_params
            .iter()
            .map(|p| {
                format!(
                    "{}={}",
                    urlencoding::encode(&interpolate(&p.key, env_variables)),
                    urlencoding::encode(&interpolate(&p.value, env_variables))
                )
            })
            .collect();
        url = format!("{}{}{}", url, separator, query_string.join("&"));
    }

    // Build request with method
    let method = config.method.to_uppercase();
    let mut request = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        "HEAD" => client.head(&url),
        other => {
            return Err(format!("Unsupported HTTP method: {}", other));
        }
    };

    // Apply headers
    for header in &config.headers {
        if header.enabled && !header.key.is_empty() {
            let key = interpolate(&header.key, env_variables);
            let value = interpolate(&header.value, env_variables);
            request = request.header(&key, &value);
        }
    }

    // Apply authentication
    match config.auth.auth_type.as_str() {
        "bearer" => {
            if let Some(ref token) = config.auth.token {
                let token = interpolate(token, env_variables);
                request = request.header("Authorization", format!("Bearer {}", token));
            }
        }
        "basic" => {
            if let (Some(ref username), Some(ref password)) =
                (&config.auth.username, &config.auth.password)
            {
                let username = interpolate(username, env_variables);
                let password = interpolate(password, env_variables);
                request = request.basic_auth(&username, Some(&password));
            }
        }
        "api_key" => {
            if let (Some(ref header_name), Some(ref header_value)) =
                (&config.auth.header_name, &config.auth.header_value)
            {
                let name = interpolate(header_name, env_variables);
                let value = interpolate(header_value, env_variables);
                request = request.header(&name, &value);
            }
        }
        _ => {} // "none" or unknown
    }

    // Apply body for methods that support it
    if matches!(method.as_str(), "POST" | "PUT" | "PATCH") {
        let body_content = interpolate(&config.body.content, env_variables);
        if !body_content.is_empty() {
            match config.body.body_type.as_str() {
                "json" => {
                    request = request
                        .header("Content-Type", "application/json")
                        .body(body_content);
                }
                "text" => {
                    request = request
                        .header("Content-Type", "text/plain")
                        .body(body_content);
                }
                _ => {
                    request = request.body(body_content);
                }
            }
        }
    }

    // Execute with timing
    let start = Instant::now();
    let response = request
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    let total_ms = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("Unknown")
        .to_string();

    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }

    let body_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
    let size = body_bytes.len() as u64;
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    Ok(HttpResponse {
        status,
        status_text,
        headers,
        body,
        size,
        timing: ResponseTiming { total_ms },
    })
}
