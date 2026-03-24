use super::types::{HttpResponse, RequestConfig, ResponseTiming};
use std::collections::HashMap;
use std::time::Instant;

/// Execute an HTTP request with the given config.
///
/// All variable resolution (targeted injection, `{{var}}` path replacement,
/// header/param injection, auth, body) is expected to have been performed
/// by `resolver::resolve_and_inject` *before* this function is called.
pub async fn execute(config: &RequestConfig) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // URL is already resolved by the resolver/orchestrator
    let mut url = config.url.clone();

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
                    urlencoding::encode(&p.key),
                    urlencoding::encode(&p.value)
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

    // Apply headers (already resolved by the resolver)
    for header in &config.headers {
        if header.enabled && !header.key.is_empty() {
            request = request.header(&header.key, &header.value);
        }
    }

    // Apply authentication (values already resolved by the resolver)
    match config.auth.auth_type.as_str() {
        "bearer" => {
            if let Some(ref token) = config.auth.token {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
        }
        "basic" => {
            if let (Some(ref username), Some(ref password)) =
                (&config.auth.username, &config.auth.password)
            {
                request = request.basic_auth(username, Some(password));
            }
        }
        "api_key" => {
            if let (Some(ref header_name), Some(ref header_value)) =
                (&config.auth.header_name, &config.auth.header_value)
            {
                request = request.header(header_name.as_str(), header_value.as_str());
            }
        }
        _ => {} // "none" or unknown
    }

    // Apply body for methods that support it (content already resolved by the resolver)
    if matches!(method.as_str(), "POST" | "PUT" | "PATCH") && !config.body.content.is_empty() {
        match config.body.body_type.as_str() {
            "json" => {
                request = request
                    .header("Content-Type", "application/json")
                    .body(config.body.content.clone());
            }
            "text" => {
                request = request
                    .header("Content-Type", "text/plain")
                    .body(config.body.content.clone());
            }
            _ => {
                request = request.body(config.body.content.clone());
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
