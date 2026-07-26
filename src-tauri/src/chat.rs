use std::collections::HashMap;

use futures_util::StreamExt;
use reqwest::{Client, Response};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    db::Database,
    models::{ModelProfile, SendMessageInput, StreamEvent, Turn},
    models_service,
};

#[derive(Default)]
pub struct RequestRegistry {
    requests: Mutex<HashMap<String, CancellationToken>>,
}

impl RequestRegistry {
    async fn insert(&self, request_id: String, token: CancellationToken) {
        self.requests.lock().await.insert(request_id, token);
    }

    pub async fn cancel(&self, request_id: &str) -> bool {
        if let Some(token) = self.requests.lock().await.get(request_id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    async fn remove(&self, request_id: &str) {
        self.requests.lock().await.remove(request_id);
    }
}

pub async fn run_chat(
    database: &Database,
    registry: &RequestRegistry,
    input: SendMessageInput,
    on_event: Channel<StreamEvent>,
) -> Result<Turn, String> {
    let content = input.content.trim();
    if content.is_empty() || content.chars().count() > 32_000 {
        return Err("Message must contain 1–32,000 characters".to_owned());
    }
    let profile = database
        .get_model_profile(&input.model_profile_id)
        .await
        .map_err(|_| "Model profile not found".to_owned())?;
    let request_id = Uuid::now_v7().to_string();
    let turn = database
        .create_streaming_turn(
            &input.card_id,
            content,
            &input.model_profile_id,
            &request_id,
        )
        .await
        .map_err(|_| "Unable to create the message".to_owned())?;
    if database
        .attach_quotes(&input.quote_ids, &turn.id)
        .await
        .is_err()
    {
        let _ = database
            .update_turn(
                &turn.id,
                "",
                "failed",
                Some("Unable to attach selected quotes"),
            )
            .await;
        return Err("Unable to attach selected quotes".to_owned());
    }
    send_event(
        &on_event,
        StreamEvent::Started {
            request_id: request_id.clone(),
            turn: turn.clone(),
        },
    );

    let token = CancellationToken::new();
    registry.insert(request_id.clone(), token.clone()).await;
    let result = stream_response(database, &profile, &turn, &request_id, &token, &on_event).await;
    registry.remove(&request_id).await;
    result
}

async fn stream_response(
    database: &Database,
    profile: &ModelProfile,
    turn: &Turn,
    request_id: &str,
    token: &CancellationToken,
    on_event: &Channel<StreamEvent>,
) -> Result<Turn, String> {
    let built_context = crate::context::build_context(database, &turn.card_id).await?;
    database
        .set_context_snapshot(&turn.card_id, &built_context.snapshot_hash)
        .await
        .map_err(|_| "Unable to save context snapshot".to_owned())?;
    let response = request_model(profile, &built_context.messages).await;
    let response = match response {
        Ok(value) => value,
        Err(message) => {
            return fail_turn(database, turn, request_id, on_event, &message).await;
        }
    };
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut answer = String::new();

    loop {
        tokio::select! {
            _ = token.cancelled() => {
                let cancelled = database.update_turn(&turn.id, &answer, "cancelled", None)
                    .await.map_err(|_| "Unable to persist cancellation".to_owned())?;
                send_event(on_event, StreamEvent::Cancelled {
                    request_id: request_id.to_owned(), turn: cancelled.clone()
                });
                return Ok(cancelled);
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                        for line in take_complete_lines(&mut buffer) {
                            if let Some(delta) = extract_delta(&profile.provider, &line) {
                                answer.push_str(&delta);
                                database.update_turn(&turn.id, &answer, "streaming", None)
                                    .await.map_err(|_| "Unable to save streamed content".to_owned())?;
                                send_event(on_event, StreamEvent::Delta {
                                    request_id: request_id.to_owned(),
                                    turn_id: turn.id.clone(),
                                    delta,
                                });
                            }
                        }
                    }
                    Some(Err(_)) => return fail_turn(database, turn, request_id, on_event, "Connection interrupted").await,
                    None => break,
                }
            }
        }
    }
    if !buffer.trim().is_empty() {
        if let Some(delta) = extract_delta(&profile.provider, buffer.trim()) {
            answer.push_str(&delta);
        }
    }
    let completed = database
        .update_turn(&turn.id, &answer, "completed", None)
        .await
        .map_err(|_| "Unable to save the completed response".to_owned())?;
    send_event(
        on_event,
        StreamEvent::Completed {
            request_id: request_id.to_owned(),
            turn: completed.clone(),
        },
    );
    Ok(completed)
}

async fn request_model(
    profile: &ModelProfile,
    messages: &[crate::context::ChatMessage],
) -> Result<Response, String> {
    let endpoint = if profile.provider == "ollama" {
        format!("{}/api/chat", profile.base_url)
    } else {
        format!("{}/chat/completions", profile.base_url)
    };
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|_| "Unable to initialize model client".to_owned())?;
    let mut request = client.post(endpoint).json(&json!({
        "model": profile.model,
        "messages": messages,
        "stream": true
    }));
    if let Some(reference) = &profile.keychain_ref {
        request = request.bearer_auth(models_service::load_secret(reference)?);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Unable to connect to the model provider".to_owned())?;
    if !response.status().is_success() {
        return Err(format!(
            "Model provider returned HTTP {}",
            response.status()
        ));
    }
    Ok(response)
}

async fn fail_turn(
    database: &Database,
    turn: &Turn,
    request_id: &str,
    on_event: &Channel<StreamEvent>,
    message: &str,
) -> Result<Turn, String> {
    let failed = database
        .update_turn(&turn.id, &turn.assistant_content, "failed", Some(message))
        .await
        .map_err(|_| "Unable to persist model failure".to_owned())?;
    send_event(
        on_event,
        StreamEvent::Failed {
            request_id: request_id.to_owned(),
            turn: failed,
            message: message.to_owned(),
        },
    );
    Err(message.to_owned())
}

fn send_event(channel: &Channel<StreamEvent>, event: StreamEvent) {
    let _ = channel.send(event);
}

fn take_complete_lines(buffer: &mut String) -> Vec<String> {
    let Some(last_newline) = buffer.rfind('\n') else {
        return Vec::new();
    };
    let complete: String = buffer.drain(..=last_newline).collect();
    complete.lines().map(str::to_owned).collect()
}

pub fn extract_delta(provider: &str, line: &str) -> Option<String> {
    let value = if provider == "ollama" {
        serde_json::from_str::<Value>(line.trim()).ok()?
    } else {
        let data = line.trim().strip_prefix("data:")?.trim();
        if data == "[DONE]" {
            return None;
        }
        serde_json::from_str::<Value>(data).ok()?
    };
    if provider == "ollama" {
        value
            .pointer("/message/content")?
            .as_str()
            .map(str::to_owned)
    } else {
        value
            .pointer("/choices/0/delta/content")?
            .as_str()
            .map(str::to_owned)
    }
}

#[cfg(test)]
mod tests {
    use super::{extract_delta, take_complete_lines, RequestRegistry};

    #[test]
    fn parses_ollama_and_openai_stream_lines() {
        assert_eq!(
            extract_delta("ollama", r#"{"message":{"content":"hello"}}"#).as_deref(),
            Some("hello")
        );
        assert_eq!(
            extract_delta(
                "openai_compatible",
                r#"data: {"choices":[{"delta":{"content":"world"}}]}"#
            )
            .as_deref(),
            Some("world")
        );
        assert!(extract_delta("openai_compatible", "data: [DONE]").is_none());
    }

    #[test]
    fn preserves_partial_stream_lines() {
        let mut buffer = "first\nsec".to_owned();
        assert_eq!(take_complete_lines(&mut buffer), vec!["first"]);
        assert_eq!(buffer, "sec");
    }

    #[tokio::test]
    async fn cancellation_registry_tracks_requests() {
        let registry = RequestRegistry::default();
        registry
            .insert(
                "request".to_owned(),
                tokio_util::sync::CancellationToken::new(),
            )
            .await;
        assert!(registry.cancel("request").await);
        registry.remove("request").await;
        assert!(!registry.cancel("request").await);
    }
}
