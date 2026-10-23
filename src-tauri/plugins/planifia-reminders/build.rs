const COMMANDS: &[&str] = &["get_status", "request_permission", "schedule", "cancel_all", "open_settings"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
