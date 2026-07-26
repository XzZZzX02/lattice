use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub folder_id: Option<String>,
    pub title: String,
    pub description: String,
    pub system_prompt: String,
    pub default_model_profile_id: Option<String>,
    pub root_card_id: Option<String>,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub relation: String,
    pub branch_from_turn_id: Option<String>,
    pub title: String,
    pub summary: String,
    pub context_snapshot_hash: String,
    pub context_stale: bool,
    pub unread: bool,
    pub position_x: f64,
    pub position_y: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub id: String,
    pub card_id: String,
    pub user_content: String,
    pub assistant_content: String,
    pub model_profile_id: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub request_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspace {
    pub project: Project,
    pub cards: Vec<Card>,
    pub turns: Vec<Turn>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfile {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub keychain_ref: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveModelProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageInput {
    pub card_id: String,
    pub model_profile_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    Started {
        request_id: String,
        turn: Turn,
    },
    Delta {
        request_id: String,
        turn_id: String,
        delta: String,
    },
    Completed {
        request_id: String,
        turn: Turn,
    },
    Cancelled {
        request_id: String,
        turn: Turn,
    },
    Failed {
        request_id: String,
        turn: Turn,
        message: String,
    },
}
