import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = { ...process.env };
if (process.platform === "win32") {
  const jdks = join(homedir(), ".jdks");
  const jdk = existsSync(jdks) && readdirSync(jdks).find((name) => /^(jbr|temurin|openjdk)-?(17|21)\./.test(name));
  env.JAVA_HOME ||= jdk ? join(jdks, jdk) : "C:/Program Files/Android/Android Studio/jbr";
  env.ANDROID_HOME ||= join(env.LOCALAPPDATA, "Android", "Sdk");
  env.ANDROID_SDK_ROOT ||= env.ANDROID_HOME;
  const ndks = join(env.ANDROID_HOME, "ndk");
  if (!env.NDK_HOME && existsSync(ndks)) {
    const version = readdirSync(ndks).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    if (version) env.NDK_HOME = join(ndks, version);
  }
  const originalPath = env.Path || env.PATH || "";
  delete env.Path;
  env.PATH = [join(homedir(), ".cargo", "bin"), join(env.JAVA_HOME, "bin"), join(env.ANDROID_HOME, "platform-tools"), originalPath].join(";");
}
if (process.argv[2] === "android") {
  for (const variable of ["JAVA_HOME", "ANDROID_HOME", "NDK_HOME"])
    if (!env[variable] || !existsSync(env[variable])) throw new Error(`Configura ${variable}: consulta docs/android.md.`);
}
const cli = join(root, "node_modules/@tauri-apps/cli/tauri.js");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit", windowsHide: true });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
