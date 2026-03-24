use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Debug, Clone, Serialize)]
pub struct PendingPick {
    pub hook_id: String,
    pub items: Vec<Value>,
    pub field_path: String,
    pub target_variable_ids: Vec<String>,
    #[serde(skip)]
    pub created_at: Instant,
}

static PENDING_PICKS: std::sync::OnceLock<Mutex<HashMap<String, PendingPick>>> =
    std::sync::OnceLock::new();

fn get_picks() -> &'static Mutex<HashMap<String, PendingPick>> {
    PENDING_PICKS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Insert a pending pick into the global map.
pub fn store_pick(pick_id: String, pick: PendingPick) {
    let mut map = get_picks().lock().expect("picker lock poisoned");
    map.insert(pick_id, pick);
}

/// Remove a pick by ID and return it along with the selected item.
/// Returns `None` if the pick_id is missing or the index is out of bounds.
pub fn resolve_pick(pick_id: &str, selected_index: usize) -> Option<(PendingPick, Value)> {
    let mut map = get_picks().lock().expect("picker lock poisoned");
    let pick = map.remove(pick_id)?;
    let item = pick.items.get(selected_index)?.clone();
    Some((pick, item))
}

/// Cancel a pending pick, returning whether it existed.
pub fn cancel_pick(pick_id: &str) -> bool {
    let mut map = get_picks().lock().expect("picker lock poisoned");
    map.remove(pick_id).is_some()
}

/// Remove all picks older than 60 seconds, returning their IDs.
pub fn cleanup_stale_picks() -> Vec<String> {
    let mut map = get_picks().lock().expect("picker lock poisoned");
    let cutoff = Instant::now() - std::time::Duration::from_secs(60);
    let stale_ids: Vec<String> = map
        .iter()
        .filter(|(_, pick)| pick.created_at < cutoff)
        .map(|(id, _)| id.clone())
        .collect();
    for id in &stale_ids {
        map.remove(id);
    }
    stale_ids
}
