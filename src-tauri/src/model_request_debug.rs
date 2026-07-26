#[cfg(any(debug_assertions, test))]
use serde::Serialize;
use serde_json::Value;
#[cfg(any(debug_assertions, test))]
use url::Url;

#[cfg(any(debug_assertions, test))]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelRequestDebugRecord<'a> {
    request_id: &'a str,
    operation: &'a str,
    provider: &'a str,
    endpoint: String,
    body: &'a Value,
}

#[cfg(any(debug_assertions, test))]
pub(crate) fn sanitize_endpoint(endpoint: &str) -> String {
    let Ok(mut parsed) = Url::parse(endpoint) else {
        return "<invalid endpoint>".to_owned();
    };
    if !parsed.username().is_empty() {
        let _ = parsed.set_username("redacted");
    }
    if parsed.password().is_some() {
        let _ = parsed.set_password(Some("redacted"));
    }
    if parsed.query().is_some() {
        let keys = parsed
            .query_pairs()
            .map(|(key, _)| key.into_owned())
            .collect::<Vec<_>>();
        parsed
            .query_pairs_mut()
            .clear()
            .extend_pairs(keys.iter().map(|key| (key.as_str(), "redacted")));
    }
    if parsed.fragment().is_some() {
        parsed.set_fragment(Some("redacted"));
    }
    parsed.to_string()
}

#[cfg(any(debug_assertions, test))]
pub(crate) fn prepare_record<'a>(
    request_id: &'a str,
    operation: &'a str,
    provider: &'a str,
    endpoint: &str,
    body: &'a Value,
) -> ModelRequestDebugRecord<'a> {
    ModelRequestDebugRecord {
        request_id,
        operation,
        provider,
        endpoint: sanitize_endpoint(endpoint),
        body,
    }
}

#[cfg(debug_assertions)]
pub(crate) fn trace(
    request_id: &str,
    operation: &str,
    provider: &str,
    endpoint: &str,
    body: &Value,
) {
    let record = prepare_record(request_id, operation, provider, endpoint, body);
    match serde_json::to_string(&record) {
        Ok(serialized) => eprintln!("[lattice:model-request] {serialized}"),
        Err(_) => eprintln!("[lattice:model-request] unable to serialize request metadata"),
    }
}

#[cfg(not(debug_assertions))]
pub(crate) fn trace(
    _request_id: &str,
    _operation: &str,
    _provider: &str,
    _endpoint: &str,
    _body: &Value,
) {
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{prepare_record, sanitize_endpoint};

    #[test]
    fn keeps_the_exact_request_body_and_redacts_endpoint_credentials() {
        let body = json!({
            "model": "qwen",
            "messages": [{"role": "user", "content": "hello"}],
            "stream": true
        });
        let record = prepare_record(
            "request-1",
            "chat",
            "openai_compatible",
            "https://alice:secret@example.test/v1/chat/completions",
            &body,
        );

        assert!(std::ptr::eq(record.body, &body));
        assert_eq!(record.body, &body);
        assert_eq!(record.request_id, "request-1");
        assert_eq!(record.operation, "chat");
        assert_eq!(record.provider, "openai_compatible");
        assert_eq!(
            record.endpoint,
            "https://redacted:redacted@example.test/v1/chat/completions"
        );
        let serialized = serde_json::to_string(&record).expect("serialize record");
        assert!(!serialized.contains("alice"));
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("Authorization"));
        assert!(!serialized.contains("keychain"));
    }

    #[test]
    fn refuses_to_echo_an_unparseable_endpoint() {
        assert_eq!(
            sanitize_endpoint("not a url alice:secret"),
            "<invalid endpoint>"
        );
        assert_eq!(
            sanitize_endpoint("https://example.test/v1?api_key=secret#private"),
            "https://example.test/v1?api_key=redacted#redacted"
        );
    }
}
