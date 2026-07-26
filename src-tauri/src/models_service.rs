use keyring::Entry;
use url::Url;

use crate::models::ModelProfile;
use crate::models::SaveModelProfileInput;

const KEYCHAIN_SERVICE: &str = "app.lattice.local.models";

pub fn validate_model_input(input: &SaveModelProfileInput) -> Result<(), String> {
    if input.name.trim().is_empty() || input.name.chars().count() > 120 {
        return Err("Model name must contain 1–120 characters".to_owned());
    }
    if input.model.trim().is_empty() || input.model.chars().count() > 200 {
        return Err("Model identifier must contain 1–200 characters".to_owned());
    }
    if !matches!(input.provider.as_str(), "ollama" | "openai_compatible") {
        return Err("Unsupported model provider".to_owned());
    }
    let url = Url::parse(&input.base_url).map_err(|_| "Base URL is invalid".to_owned())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Base URL must use HTTP or HTTPS".to_owned());
    }
    Ok(())
}

pub fn save_secret(reference: &str, secret: &str) -> Result<(), String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, reference)
        .map_err(|_| "Keychain is unavailable".to_owned())?;
    entry
        .set_password(secret)
        .map_err(|_| "Unable to save API key in Keychain".to_owned())
}

pub fn load_secret(reference: &str) -> Result<String, String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, reference)
        .map_err(|_| "Keychain is unavailable".to_owned())?;
    entry
        .get_password()
        .map_err(|_| "API key is missing from Keychain".to_owned())
}

pub async fn list_remote_models(profile: &ModelProfile) -> Result<Vec<String>, String> {
    let endpoint = if profile.provider == "ollama" {
        format!("{}/api/tags", profile.base_url)
    } else {
        format!("{}/models", profile.base_url)
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| "Unable to initialize model client".to_owned())?;
    let mut request = client.get(endpoint);
    if let Some(reference) = &profile.keychain_ref {
        request = request.bearer_auth(load_secret(reference)?);
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
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Model provider returned invalid JSON".to_owned())?;
    let models = parse_model_list(&profile.provider, &payload);
    if models.is_empty() {
        return Err("No models were returned by the provider".to_owned());
    }
    Ok(models)
}

fn parse_model_list(provider: &str, payload: &serde_json::Value) -> Vec<String> {
    let pointer = if provider == "ollama" {
        "/models"
    } else {
        "/data"
    };
    payload
        .pointer(pointer)
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            if provider == "ollama" {
                item.get("name")?.as_str()
            } else {
                item.get("id")?.as_str()
            }
        })
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::models::SaveModelProfileInput;

    use super::{parse_model_list, validate_model_input};

    fn input(base_url: &str) -> SaveModelProfileInput {
        SaveModelProfileInput {
            id: None,
            name: "Local".to_owned(),
            provider: "ollama".to_owned(),
            base_url: base_url.to_owned(),
            model: "qwen".to_owned(),
            api_key: None,
        }
    }

    #[test]
    fn validates_provider_and_http_base_url() {
        assert!(validate_model_input(&input("http://localhost:11434")).is_ok());
        assert!(validate_model_input(&input("file:///tmp/model")).is_err());
        assert!(validate_model_input(&input("not a url")).is_err());

        let mut unsupported = input("https://example.test");
        unsupported.provider = "unknown".to_owned();
        assert!(validate_model_input(&unsupported).is_err());
    }

    #[test]
    fn parses_provider_model_catalogues() {
        let ollama = serde_json::json!({"models": [{"name": "qwen3"}, {"name": "gemma"}]});
        let openai = serde_json::json!({"data": [{"id": "model-a"}]});
        assert_eq!(parse_model_list("ollama", &ollama), vec!["qwen3", "gemma"]);
        assert_eq!(
            parse_model_list("openai_compatible", &openai),
            vec!["model-a"]
        );
    }
}
