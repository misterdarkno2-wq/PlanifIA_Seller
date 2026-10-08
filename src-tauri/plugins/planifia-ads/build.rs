const COMMANDS: &[&str] = &[
  "init_ads",
  "get_ads_state",
  "show_banner",
  "hide_banner",
  "load_interstitial",
  "show_interstitial",
  "load_rewarded",
  "show_rewarded",
  "show_privacy_options",
  "register_listener",
  "remove_listener",
];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
