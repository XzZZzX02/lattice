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
    pub selection_card_links: Vec<SelectionCardLink>,
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
    #[serde(default)]
    pub quote_ids: Vec<String>,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCardInput {
    pub project_id: String,
    pub source_card_id: String,
    pub relation: String,
    pub title: String,
    pub branch_from_turn_id: Option<String>,
    pub selected_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSelectionCardInput {
    pub project_id: String,
    pub source_card_id: String,
    pub source_turn_id: String,
    pub title: String,
    pub selected_text: String,
    pub start_offset: i64,
    pub end_offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectionCardLink {
    pub id: String,
    pub source_turn_id: String,
    pub target_card_id: String,
    pub selected_text: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionCardCreation {
    pub card: Card,
    pub link: SelectionCardLink,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub id: String,
    pub turn_id: String,
    pub target_turn_id: Option<String>,
    pub selected_text: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateQuoteInput {
    pub turn_id: String,
    pub selected_text: String,
    pub start_offset: i64,
    pub end_offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegeneratedTurn {
    pub card: Card,
    pub source_turn: Turn,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entity_type: String,
    pub entity_id: String,
    pub project_id: String,
    pub card_id: Option<String>,
    pub title: String,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub project_id: String,
    pub card_id: Option<String>,
    pub turn_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub mime_type: String,
    pub local_path: String,
    pub content_hash: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentImportResult {
    pub document: Document,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChunk {
    pub id: String,
    pub document_id: String,
    pub content: String,
    pub page_number: Option<i64>,
    pub heading_path: String,
    pub start_offset: i64,
    pub end_offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetrievedDocumentChunk {
    pub chunk_id: String,
    pub document_id: String,
    pub document_name: String,
    pub content: String,
    pub page_number: Option<i64>,
    pub heading_path: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCitation {
    pub id: String,
    pub turn_id: String,
    pub chunk_id: Option<String>,
    pub document_id: String,
    pub document_name: String,
    pub page_number: Option<i64>,
    pub heading_path: String,
    pub excerpt: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub created_at: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MindNode {
    pub id: String,
    pub project_id: String,
    pub label: String,
    pub description: String,
    pub source_card_id: Option<String>,
    pub source_turn_id: Option<String>,
    pub position_x: f64,
    pub position_y: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MindEdge {
    pub id: String,
    pub project_id: String,
    pub source_id: String,
    pub target_id: String,
    pub relation: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MindNodeSource {
    pub id: String,
    pub mind_node_id: String,
    pub card_id: Option<String>,
    pub turn_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MindscapeGraph {
    pub nodes: Vec<MindNode>,
    pub edges: Vec<MindEdge>,
    pub sources: Vec<MindNodeSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDeletionResult {
    pub workspace: ProjectWorkspace,
    pub mindscape: MindscapeGraph,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMindNodeInput {
    pub project_id: String,
    pub label: String,
    pub description: String,
    pub source_card_id: Option<String>,
    pub source_turn_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMindEdgeInput {
    pub project_id: String,
    pub source_id: String,
    pub target_id: String,
    pub relation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConceptSuggestion {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelationSuggestion {
    pub id: String,
    pub source_key: String,
    pub target_key: String,
    pub relation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeSuggestion {
    pub id: String,
    pub source_node_id: String,
    pub target_node_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MindSuggestionSet {
    pub project_id: String,
    pub source_card_id: String,
    pub concepts: Vec<ConceptSuggestion>,
    pub relations: Vec<RelationSuggestion>,
    pub merges: Vec<MergeSuggestion>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyMindSuggestionsInput {
    pub suggestions: MindSuggestionSet,
    pub accepted_ids: Vec<String>,
}
