use std::collections::{HashMap, HashSet};

use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    db::Database,
    models::{
        ApplyMindSuggestionsInput, ConceptSuggestion, CreateMindEdgeInput, CreateMindNodeInput,
        MergeSuggestion, MindSuggestionSet, MindscapeGraph, ModelProfile, RelationSuggestion,
    },
    models_service,
};

pub async fn apply(
    database: &Database,
    input: ApplyMindSuggestionsInput,
) -> Result<MindscapeGraph, String> {
    if input.accepted_ids.len() > 50 {
        return Err("Too many Mindscape suggestions selected".to_owned());
    }
    let accepted = input.accepted_ids.into_iter().collect::<HashSet<_>>();
    if accepted.is_empty() {
        return database
            .get_mindscape(&input.suggestions.project_id)
            .await
            .map_err(|_| "Unable to load Mindscape".to_owned());
    }
    let mut node_map = HashMap::new();
    for concept in input.suggestions.concepts {
        if !accepted.contains(&concept.id) {
            continue;
        }
        if concept.label.trim().is_empty()
            || concept.label.chars().count() > 160
            || concept.description.chars().count() > 4_000
        {
            return Err("Accepted concept is invalid".to_owned());
        }
        let node = database
            .create_mind_node(&CreateMindNodeInput {
                project_id: input.suggestions.project_id.clone(),
                label: concept.label,
                description: concept.description,
                source_card_id: Some(input.suggestions.source_card_id.clone()),
                source_turn_id: None,
            })
            .await
            .map_err(|_| "Unable to apply concept suggestion".to_owned())?;
        node_map.insert(concept.id, node.id);
    }
    let existing = database
        .get_mindscape(&input.suggestions.project_id)
        .await
        .map_err(|_| "Unable to refresh Mindscape".to_owned())?;
    let existing_ids = existing
        .nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    for relation in input.suggestions.relations {
        if !accepted.contains(&relation.id) {
            continue;
        }
        let source_id = node_map
            .get(&relation.source_key)
            .cloned()
            .unwrap_or(relation.source_key);
        let target_id = node_map
            .get(&relation.target_key)
            .cloned()
            .unwrap_or(relation.target_key);
        if !existing_ids.contains(&source_id) || !existing_ids.contains(&target_id) {
            continue;
        }
        database
            .create_mind_edge(&CreateMindEdgeInput {
                project_id: input.suggestions.project_id.clone(),
                source_id,
                target_id,
                relation: relation.relation,
            })
            .await
            .map_err(|_| "Unable to apply relation suggestion".to_owned())?;
    }
    for merge in input.suggestions.merges {
        if accepted.contains(&merge.id) {
            database
                .merge_mind_nodes(
                    &input.suggestions.project_id,
                    &merge.source_node_id,
                    &merge.target_node_id,
                )
                .await
                .map_err(|_| "Unable to apply merge suggestion".to_owned())?;
        }
    }
    database
        .get_mindscape(&input.suggestions.project_id)
        .await
        .map_err(|_| "Unable to load updated Mindscape".to_owned())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSuggestions {
    #[serde(default)]
    concepts: Vec<RawConcept>,
    #[serde(default)]
    relations: Vec<RawRelation>,
    #[serde(default)]
    merges: Vec<RawMerge>,
}

#[derive(Debug, Deserialize)]
struct RawConcept {
    key: String,
    label: String,
    #[serde(default)]
    description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRelation {
    source_key: String,
    target_key: String,
    relation: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawMerge {
    source_node_id: String,
    target_node_id: String,
    #[serde(default)]
    reason: String,
}

pub async fn suggest(
    database: &Database,
    project_id: &str,
    source_card_id: &str,
    model_profile_id: &str,
) -> Result<MindSuggestionSet, String> {
    let card = database
        .get_card(source_card_id)
        .await
        .map_err(|_| "Source Card not found".to_owned())?;
    if card.project_id != project_id {
        return Err("Source Card belongs to another project".to_owned());
    }
    let turns = database
        .turns_for_card(source_card_id)
        .await
        .map_err(|_| "Unable to load source conversation".to_owned())?;
    let graph = database
        .get_mindscape(project_id)
        .await
        .map_err(|_| "Unable to load existing Mindscape".to_owned())?;
    let source = turns
        .iter()
        .rev()
        .take(6)
        .rev()
        .map(|turn| {
            format!(
                "Question: {}\nAnswer: {}",
                turn.user_content, turn.assistant_content
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let existing = graph
        .nodes
        .iter()
        .map(|node| json!({"id": node.id, "label": node.label}))
        .collect::<Vec<_>>();
    let prompt = format!(
        "Analyze this Card and propose a small concept graph. Return JSON only with this shape: \
         {{\"concepts\":[{{\"key\":\"c1\",\"label\":\"...\",\"description\":\"...\"}}],\
         \"relations\":[{{\"sourceKey\":\"c1\",\"targetKey\":\"c2\",\"relation\":\"...\"}}],\
         \"merges\":[{{\"sourceNodeId\":\"existing-id\",\"targetNodeId\":\"existing-id\",\"reason\":\"...\"}}]}}. \
         Use 1-6 concepts. Relations may reference concept keys or existing node IDs. \
         Suggest merges only for clear duplicates. Existing nodes: {}.\n\nCard: {}\n{}",
        serde_json::to_string(&existing).unwrap_or_else(|_| "[]".to_owned()),
        card.title,
        source.chars().take(24_000).collect::<String>()
    );
    let profile = database
        .get_model_profile(model_profile_id)
        .await
        .map_err(|_| "Model profile not found".to_owned())?;
    let content = request_json(&profile, &prompt).await?;
    normalize(project_id, source_card_id, parse_raw(&content)?, &graph)
}

async fn request_json(profile: &ModelProfile, prompt: &str) -> Result<String, String> {
    let endpoint = if profile.provider == "ollama" {
        format!("{}/api/chat", profile.base_url)
    } else {
        format!("{}/chat/completions", profile.base_url)
    };
    let body = if profile.provider == "ollama" {
        json!({
            "model": profile.model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": false,
            "format": "json"
        })
    } else {
        json!({
            "model": profile.model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": false
        })
    };
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| "Unable to initialize suggestion client".to_owned())?;
    let mut request = client.post(endpoint).json(&body);
    if let Some(reference) = &profile.keychain_ref {
        request = request.bearer_auth(models_service::load_secret(reference)?);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Unable to connect to the suggestion model".to_owned())?;
    if !response.status().is_success() {
        return Err(format!(
            "Suggestion model returned HTTP {}",
            response.status()
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| "Suggestion model returned invalid JSON".to_owned())?;
    value
        .pointer("/message/content")
        .or_else(|| value.pointer("/choices/0/message/content"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "Suggestion model response has no content".to_owned())
}

fn parse_raw(content: &str) -> Result<RawSuggestions, String> {
    let trimmed = content.trim();
    let json = if trimmed.starts_with("```") {
        trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        trimmed
    };
    serde_json::from_str(json)
        .map_err(|_| "Suggestion model output has an invalid shape".to_owned())
}

fn normalize(
    project_id: &str,
    source_card_id: &str,
    raw: RawSuggestions,
    graph: &crate::models::MindscapeGraph,
) -> Result<MindSuggestionSet, String> {
    let mut known_keys = graph
        .nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    let mut key_map = HashMap::new();
    let concepts = raw
        .concepts
        .into_iter()
        .take(6)
        .filter_map(|concept| {
            let label = concept.label.trim();
            if label.is_empty()
                || label.chars().count() > 160
                || known_keys.contains(&concept.key)
                || key_map.contains_key(&concept.key)
            {
                return None;
            }
            let id = Uuid::now_v7().to_string();
            known_keys.insert(id.clone());
            key_map.insert(concept.key, id.clone());
            Some(ConceptSuggestion {
                id,
                label: label.to_owned(),
                description: concept.description.chars().take(4_000).collect(),
            })
        })
        .collect::<Vec<_>>();
    let relations = raw
        .relations
        .into_iter()
        .take(12)
        .filter_map(|relation| {
            let source_key = key_map
                .get(&relation.source_key)
                .cloned()
                .unwrap_or(relation.source_key);
            let target_key = key_map
                .get(&relation.target_key)
                .cloned()
                .unwrap_or(relation.target_key);
            let label = relation.relation.trim();
            if source_key == target_key
                || !known_keys.contains(&source_key)
                || !known_keys.contains(&target_key)
                || label.is_empty()
                || label.chars().count() > 120
            {
                return None;
            }
            Some(RelationSuggestion {
                id: Uuid::now_v7().to_string(),
                source_key,
                target_key,
                relation: label.to_owned(),
            })
        })
        .collect();
    let node_ids = graph
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let merges = raw
        .merges
        .into_iter()
        .take(6)
        .filter(|merge| {
            merge.source_node_id != merge.target_node_id
                && node_ids.contains(merge.source_node_id.as_str())
                && node_ids.contains(merge.target_node_id.as_str())
        })
        .map(|merge| MergeSuggestion {
            id: Uuid::now_v7().to_string(),
            source_node_id: merge.source_node_id,
            target_node_id: merge.target_node_id,
            reason: merge.reason.chars().take(1_000).collect(),
        })
        .collect();
    Ok(MindSuggestionSet {
        project_id: project_id.to_owned(),
        source_card_id: source_card_id.to_owned(),
        concepts,
        relations,
        merges,
    })
}

#[cfg(test)]
mod tests {
    use super::{apply, normalize, parse_raw};
    use crate::{
        db::Database,
        models::{ApplyMindSuggestionsInput, MindSuggestionSet, MindscapeGraph},
    };

    #[test]
    fn parses_fenced_json_and_rejects_untraceable_relations() {
        let raw = parse_raw(
            "```json\n{\"concepts\":[{\"key\":\"c1\",\"label\":\"A\"}],\
             \"relations\":[{\"sourceKey\":\"c1\",\"targetKey\":\"missing\",\"relation\":\"uses\"}]}\n```",
        )
        .expect("parse");
        let set = normalize(
            "p1",
            "c1",
            raw,
            &MindscapeGraph {
                nodes: vec![],
                edges: vec![],
                sources: vec![],
            },
        )
        .expect("normalize");
        assert_eq!(set.concepts.len(), 1);
        assert!(set.relations.is_empty());
    }

    #[tokio::test]
    async fn rejecting_all_suggestions_does_not_change_the_graph() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database
            .create_project("Suggestions")
            .await
            .expect("project");
        let graph = apply(
            &database,
            ApplyMindSuggestionsInput {
                suggestions: MindSuggestionSet {
                    project_id: workspace.project.id,
                    source_card_id: workspace.cards[0].id.clone(),
                    concepts: vec![],
                    relations: vec![],
                    merges: vec![],
                },
                accepted_ids: vec![],
            },
        )
        .await
        .expect("reject");
        assert!(graph.nodes.is_empty());
    }
}
