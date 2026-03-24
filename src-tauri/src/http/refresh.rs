use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};

/// Type alias for the in-flight refresh map to reduce type complexity.
type InflightMap = Mutex<HashMap<(String, String), Arc<Notify>>>;

/// Global registry of in-flight variable refreshes.
///
/// Keyed by `(environment_id, variable_id)`. When a variable is expired and
/// multiple concurrent requests need it refreshed, the first caller "owns"
/// the refresh (gets `None` back from `try_start_refresh`) while subsequent
/// callers receive the `Arc<Notify>` to await.
static INFLIGHT: std::sync::OnceLock<InflightMap> = std::sync::OnceLock::new();

fn get_inflight() -> &'static InflightMap {
    INFLIGHT.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Attempt to start a refresh for the given variable.
///
/// Returns `None` if this caller now owns the refresh (no other refresh is
/// in progress). The caller must execute the source request and then call
/// `complete_refresh` when done.
///
/// Returns `Some(notify)` if another caller is already refreshing this
/// variable. The caller should `notify.notified().await` and then re-read
/// the variable from the database.
///
/// # Usage
///
/// ```rust,ignore
/// match refresh::try_start_refresh(&env_id, &var.id).await {
///     Some(notify) => {
///         // Another request is already refreshing -- wait
///         notify.notified().await;
///         // Re-read the variable from DB (it's now refreshed)
///     }
///     None => {
///         // We own the refresh -- execute the source request
///         // ... do the refresh work ...
///         refresh::complete_refresh(&env_id, &var.id).await;
///     }
/// }
/// ```
pub async fn try_start_refresh(env_id: &str, var_id: &str) -> Option<Arc<Notify>> {
    let mut map = get_inflight().lock().await;
    let key = (env_id.to_string(), var_id.to_string());

    if let Some(existing) = map.get(&key) {
        return Some(Arc::clone(existing));
    }

    map.insert(key, Arc::new(Notify::new()));
    None
}

/// Mark a variable refresh as complete, waking all waiters.
///
/// Removes the entry from the in-flight map and calls `notify_waiters()`
/// so that any callers blocked in `try_start_refresh` wake up and re-read
/// the now-refreshed variable from the database.
pub async fn complete_refresh(env_id: &str, var_id: &str) {
    let mut map = get_inflight().lock().await;
    let key = (env_id.to_string(), var_id.to_string());

    if let Some(notify) = map.remove(&key) {
        notify.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    #[tokio::test]
    async fn test_first_caller_gets_none() {
        let result = try_start_refresh("env-1", "var-1").await;
        assert!(result.is_none(), "First caller should own the refresh");

        // Clean up
        complete_refresh("env-1", "var-1").await;
    }

    #[tokio::test]
    async fn test_second_caller_gets_notify() {
        // First caller takes ownership
        let first = try_start_refresh("env-2", "var-2").await;
        assert!(first.is_none());

        // Second caller should get a Notify to wait on
        let second = try_start_refresh("env-2", "var-2").await;
        assert!(second.is_some(), "Second caller should receive a Notify");

        // Clean up
        complete_refresh("env-2", "var-2").await;
    }

    #[tokio::test]
    async fn test_complete_refresh_clears_entry() {
        let first = try_start_refresh("env-3", "var-3").await;
        assert!(first.is_none());

        complete_refresh("env-3", "var-3").await;

        // After completion, a new caller should own the refresh again
        let again = try_start_refresh("env-3", "var-3").await;
        assert!(again.is_none(), "After complete, next caller should own it");

        complete_refresh("env-3", "var-3").await;
    }

    #[tokio::test]
    async fn test_different_keys_are_independent() {
        let a = try_start_refresh("env-4", "var-a").await;
        assert!(a.is_none());

        let b = try_start_refresh("env-4", "var-b").await;
        assert!(b.is_none(), "Different variable should be independent");

        complete_refresh("env-4", "var-a").await;
        complete_refresh("env-4", "var-b").await;
    }

    #[tokio::test]
    async fn test_waiters_wake_on_complete() {
        let counter = Arc::new(AtomicU32::new(0));

        // First caller takes ownership
        let first = try_start_refresh("env-5", "var-5").await;
        assert!(first.is_none());

        // Spawn a waiter
        let notify = try_start_refresh("env-5", "var-5").await.unwrap();
        let counter_clone = Arc::clone(&counter);
        let handle = tokio::spawn(async move {
            notify.notified().await;
            counter_clone.fetch_add(1, Ordering::SeqCst);
        });

        // Complete the refresh -- waiter should wake
        complete_refresh("env-5", "var-5").await;
        handle.await.unwrap();

        assert_eq!(counter.load(Ordering::SeqCst), 1, "Waiter should have woken");
    }

    #[tokio::test]
    async fn test_complete_on_missing_key_is_noop() {
        // Should not panic
        complete_refresh("env-nonexistent", "var-nonexistent").await;
    }
}
