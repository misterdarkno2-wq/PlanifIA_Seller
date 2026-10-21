const COMMANDS: &[&str] = &["sign_in_with_google"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
