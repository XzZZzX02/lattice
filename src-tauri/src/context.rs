use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{db::Database, models::Card};

const DEFAULT_CONTEXT_TOKENS: usize = 8_192;
const OUTPUT_RESERVE_PERCENT: usize = 30;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct BuiltContext {
    pub messages: Vec<ChatMessage>,
    pub snapshot_hash: String,
}

pub async fn build_context(database: &Database, card_id: &str) -> Result<BuiltContext, String> {
    let chain = database
        .ancestor_chain(card_id)
        .await
        .map_err(|_| "Unable to load card ancestry".to_owned())?;
    let current = chain.last().ok_or_else(|| "Card not found".to_owned())?;
    let mut messages = vec![ChatMessage {
        role: "system".to_owned(),
        content: system_context(&chain, current),
    }];
    match current.relation.as_str() {
        "root" => append_card_turns(database, current, None, &mut messages).await?,
        "child" => {
            if let Some(parent) = parent(&chain) {
                append_parent_summary(parent, &mut messages);
            }
            if !current.summary.trim().is_empty() {
                messages.push(ChatMessage {
                    role: "system".to_owned(),
                    content: current.summary.clone(),
                });
            }
            append_card_turns(database, current, None, &mut messages).await?;
        }
        "divergent" => {
            if let Some(parent) = parent(&chain) {
                messages.push(ChatMessage {
                    role: "system".to_owned(),
                    content: format!(
                        "Explore a new direction related to “{}”. Do not assume content from sibling cards.",
                        parent.title
                    ),
                });
            }
            append_card_turns(database, current, None, &mut messages).await?;
        }
        "branch" => {
            if let Some(parent) = parent(&chain) {
                append_card_turns(
                    database,
                    parent,
                    current.branch_from_turn_id.as_deref(),
                    &mut messages,
                )
                .await?;
            }
            append_card_turns(database, current, None, &mut messages).await?;
        }
        _ => return Err("Unsupported card relation".to_owned()),
    }
    enforce_budget(&mut messages);
    let snapshot_hash = hash_messages(&messages);
    Ok(BuiltContext {
        messages,
        snapshot_hash,
    })
}

fn system_context(chain: &[Card], current: &Card) -> String {
    let path = chain
        .iter()
        .map(|card| card.title.as_str())
        .collect::<Vec<_>>()
        .join(" › ");
    format!(
        "You are helping with a local research project. Current card: “{}”. Exploration path: {}.",
        current.title, path
    )
}

fn parent(chain: &[Card]) -> Option<&Card> {
    chain
        .len()
        .checked_sub(2)
        .and_then(|index| chain.get(index))
}

fn append_parent_summary(card: &Card, messages: &mut Vec<ChatMessage>) {
    let context = if card.summary.trim().is_empty() {
        format!("Parent topic: {}", card.title)
    } else {
        format!("Parent summary: {}", card.summary)
    };
    messages.push(ChatMessage {
        role: "system".to_owned(),
        content: context,
    });
}

async fn append_card_turns(
    database: &Database,
    card: &Card,
    stop_before_turn_id: Option<&str>,
    messages: &mut Vec<ChatMessage>,
) -> Result<(), String> {
    let turns = database
        .turns_for_card(&card.id)
        .await
        .map_err(|_| "Unable to load card conversation".to_owned())?;
    for turn in turns {
        if stop_before_turn_id == Some(turn.id.as_str()) {
            break;
        }
        for quote in database
            .quotes_for_target(&turn.id)
            .await
            .map_err(|_| "Unable to load quoted context".to_owned())?
        {
            messages.push(ChatMessage {
                role: "system".to_owned(),
                content: format!("Quoted source: “{}”", quote.selected_text),
            });
        }
        messages.push(ChatMessage {
            role: "user".to_owned(),
            content: turn.user_content,
        });
        if !turn.assistant_content.is_empty() {
            messages.push(ChatMessage {
                role: "assistant".to_owned(),
                content: turn.assistant_content,
            });
        }
    }
    Ok(())
}

fn enforce_budget(messages: &mut Vec<ChatMessage>) {
    let limit = DEFAULT_CONTEXT_TOKENS * (100 - OUTPUT_RESERVE_PERCENT) / 100;
    while estimated_tokens(messages) > limit && messages.len() > 3 {
        messages.remove(1);
    }
    if estimated_tokens(messages) > limit {
        if let Some(system) = messages.first_mut() {
            system
                .content
                .truncate(limit.saturating_mul(4).min(system.content.len()));
        }
    }
}

fn estimated_tokens(messages: &[ChatMessage]) -> usize {
    messages
        .iter()
        .map(|message| message.content.chars().count().div_ceil(4) + 4)
        .sum()
}

fn hash_messages(messages: &[ChatMessage]) -> String {
    let payload = serde_json::to_vec(messages).unwrap_or_default();
    format!("{:x}", Sha256::digest(payload))
}

#[cfg(test)]
mod tests {
    use crate::{db::Database, models::CreateCardInput};

    use super::build_context;

    async fn complete_turn(database: &Database, card_id: &str, user: &str, assistant: &str) {
        let turn = database
            .create_streaming_turn(card_id, user, "model", &uuid::Uuid::now_v7().to_string())
            .await
            .expect("turn");
        database
            .update_turn(&turn.id, assistant, "completed", None)
            .await
            .expect("complete");
    }

    #[tokio::test]
    async fn divergent_context_excludes_sibling_answers() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Root").await.expect("project");
        let root = &workspace.cards[0];
        let sibling = database
            .create_card(&CreateCardInput {
                project_id: workspace.project.id.clone(),
                source_card_id: root.id.clone(),
                relation: "child".to_owned(),
                title: "Sibling".to_owned(),
                branch_from_turn_id: None,
                selected_text: None,
            })
            .await
            .expect("sibling");
        complete_turn(&database, &sibling.id, "secret sibling", "must not leak").await;
        let divergent = database
            .create_card(&CreateCardInput {
                project_id: workspace.project.id,
                source_card_id: root.id.clone(),
                relation: "divergent".to_owned(),
                title: "Direction".to_owned(),
                branch_from_turn_id: None,
                selected_text: None,
            })
            .await
            .expect("divergent");
        complete_turn(&database, &divergent.id, "new question", "").await;

        let context = build_context(&database, &divergent.id)
            .await
            .expect("context");
        let serialized = serde_json::to_string(&context.messages).expect("serialize");
        assert!(serialized.contains("new question"));
        assert!(!serialized.contains("must not leak"));
    }

    #[tokio::test]
    async fn branch_context_stops_before_branch_point() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Root").await.expect("project");
        let root = &workspace.cards[0];
        complete_turn(&database, &root.id, "kept", "kept answer").await;
        let branch_point = database
            .create_streaming_turn(&root.id, "old branch", "model", "request")
            .await
            .expect("turn");
        database
            .update_turn(&branch_point.id, "old answer", "completed", None)
            .await
            .expect("complete");
        let branch = database
            .create_card(&CreateCardInput {
                project_id: workspace.project.id,
                source_card_id: root.id.clone(),
                relation: "branch".to_owned(),
                title: "Alternative".to_owned(),
                branch_from_turn_id: Some(branch_point.id),
                selected_text: None,
            })
            .await
            .expect("branch");
        complete_turn(&database, &branch.id, "new branch", "").await;

        let context = build_context(&database, &branch.id).await.expect("context");
        let serialized = serde_json::to_string(&context.messages).expect("serialize");
        assert!(serialized.contains("kept answer"));
        assert!(serialized.contains("new branch"));
        assert!(!serialized.contains("old answer"));
    }
}
