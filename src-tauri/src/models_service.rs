use keyring::Entry;
use url::Url;

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

#[cfg(test)]
mod tests {
    use crate::models::SaveModelProfileInput;

    use super::validate_model_input;

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
}
