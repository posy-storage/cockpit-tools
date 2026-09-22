// Pure policy, shared by launch, restore and the injection loop.
pub fn enabled(preference: Option<bool>, api_service: bool, desktop: bool) -> bool {
    desktop && preference.unwrap_or(api_service)
}

#[cfg(test)]
mod tests {
    use super::enabled;

    #[test]
    fn launch_defaults_and_explicit_choices() {
        for api_service in [false, true] {
            assert_eq!(enabled(None, api_service, true), api_service);
            assert!(enabled(Some(true), api_service, true));
            assert!(!enabled(Some(false), api_service, true));
            for preference in [None, Some(false), Some(true)] {
                assert!(!enabled(preference, api_service, false));
            }
        }
    }
}
