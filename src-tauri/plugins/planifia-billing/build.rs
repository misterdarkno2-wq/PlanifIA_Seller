const COMMANDS: &[&str] = &[
  "get_products",
  "purchase",
  "restore_purchases",
  "finish_purchase",
  "manage_subscriptions",
  "open_external",
  "register_listener",
  "remove_listener",
];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
