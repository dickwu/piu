use globset::{Glob, GlobSetBuilder};

/// Returns true if `api_path` matches any pattern in `match_paths_json`.
///
/// `match_paths_json` is a JSON array of glob strings, e.g. `["user*", "admin*"]`.
/// Matching is case-insensitive and `*` crosses `/` boundaries (full-path wildcard).
/// Leading `/` is stripped from both patterns and the path before matching.
pub fn matches_path(match_paths_json: &str, api_path: &str) -> bool {
    let patterns: Vec<String> = match serde_json::from_str(match_paths_json) {
        Ok(p) => p,
        Err(_) => return false,
    };

    if patterns.is_empty() {
        return false;
    }

    let normalized_path = api_path.strip_prefix('/').unwrap_or(api_path);

    let mut builder = GlobSetBuilder::new();
    for pattern in &patterns {
        let stripped = pattern.strip_prefix('/').unwrap_or(pattern);
        let converted = convert_single_star_to_double(stripped);
        let glob = match Glob::new(&converted) {
            Ok(g) => g,
            Err(_) => continue,
        };
        builder.add(glob);
    }

    let glob_set = match builder.build() {
        Ok(gs) => gs,
        Err(_) => return false,
    };

    glob_set.is_match(normalized_path.to_lowercase().as_str())
}

/// Counts how many paths in `all_paths` match the given patterns.
pub fn count_matches(match_paths_json: &str, all_paths: &[String]) -> usize {
    all_paths
        .iter()
        .filter(|path| matches_path(match_paths_json, path))
        .count()
}

/// Converts standalone `*` segments into `**` so that globset crosses `/` boundaries.
///
/// globset treats `*` as a single-segment wildcard by default (does not match `/`).
/// We want `*` to behave as a full-path wildcard, so we replace `*` with `**`
/// unless it is already part of a `**` sequence.
fn convert_single_star_to_double(pattern: &str) -> String {
    let lowered = pattern.to_lowercase();
    let mut result = String::with_capacity(lowered.len() + 4);
    let chars: Vec<char> = lowered.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if chars[i] == '*' {
            // Check if this is already a `**`
            if i + 1 < len && chars[i + 1] == '*' {
                result.push_str("**");
                i += 2;
            } else {
                // Check the character before to avoid turning `**` parsed weirdly
                let prev_is_star = i > 0 && chars[i - 1] == '*';
                if prev_is_star {
                    result.push('*');
                } else {
                    result.push_str("**");
                }
                i += 1;
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wildcard_matches_all() {
        let patterns = r#"["*"]"#;
        assert!(matches_path(patterns, "users/profile"));
        assert!(matches_path(patterns, "auth/login"));
    }

    #[test]
    fn test_prefix_glob() {
        let patterns = r#"["user*"]"#;
        assert!(matches_path(patterns, "users/profile"));
        assert!(matches_path(patterns, "users/42/posts"));
        assert!(!matches_path(patterns, "auth/login"));
    }

    #[test]
    fn test_suffix_glob() {
        let patterns = r#"["*/list"]"#;
        assert!(matches_path(patterns, "users/list"));
        assert!(matches_path(patterns, "admin/list"));
        assert!(!matches_path(patterns, "users/profile"));
    }

    #[test]
    fn test_multiple_patterns() {
        let patterns = r#"["user*", "admin*"]"#;
        assert!(matches_path(patterns, "users/profile"));
        assert!(matches_path(patterns, "admin/settings"));
        assert!(!matches_path(patterns, "auth/login"));
    }

    #[test]
    fn test_case_insensitive() {
        let patterns = r#"["User*"]"#;
        assert!(matches_path(patterns, "users/profile"));
        assert!(matches_path(patterns, "USERS/PROFILE"));
    }

    #[test]
    fn test_strips_leading_slash() {
        let patterns = r#"["/users/*"]"#;
        assert!(matches_path(patterns, "/users/profile"));
        assert!(matches_path(patterns, "users/profile"));

        let patterns_no_slash = r#"["users/*"]"#;
        assert!(matches_path(patterns_no_slash, "/users/profile"));
    }

    #[test]
    fn test_exact_match() {
        let patterns = r#"["auth/login"]"#;
        assert!(matches_path(patterns, "auth/login"));
        assert!(!matches_path(patterns, "auth/logout"));
        assert!(!matches_path(patterns, "users/profile"));
    }

    #[test]
    fn test_count_matches() {
        let patterns = r#"["user*"]"#;
        let paths = vec![
            "users/profile".to_string(),
            "users/42/posts".to_string(),
            "auth/login".to_string(),
            "admin/settings".to_string(),
        ];
        assert_eq!(count_matches(patterns, &paths), 2);
    }

    #[test]
    fn test_empty_patterns() {
        let patterns = r#"[]"#;
        assert!(!matches_path(patterns, "users/profile"));
    }

    #[test]
    fn test_invalid_json() {
        assert!(!matches_path("not json", "users/profile"));
    }
}
