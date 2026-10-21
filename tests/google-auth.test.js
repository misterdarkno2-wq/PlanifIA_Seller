// «Continuar con Google»: nonce, estados del plugin nativo y errores al volver de Google.
// La interfaz real se prueba en tests/google-login-ui.mjs y la base de datos en
// tests/google-database.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import {
  GOOGLE_MESSAGES,
  authCommand,
  authReturnError,
  authReturnMessage,
  createNonce,
  googleSignInMode,
  signInWithGoogleNative,
  signInWithGoogleWeb,
  usesGoogle,
} from "../src/google-auth.js";

const CLIENT = "123456789012-abcdefghijklmnop0123456789.apps.googleusercontent.com";
const session = { access_token: "fixture", user: { id: "u1" } };

function fakeAuth(result = { data: { session, user: session.user }, error: null }) {
  const calls = [];
  return {
    calls,
    signInWithIdToken: async (args) => {
      calls.push(args);
      return typeof result === "function" ? result(args) : result;
    },
  };
}

test("El nonce va con hash SHA-256 en hexadecimal a Google y sin hash a Supabase", async () => {
  const { raw, hashed } = await createNonce(webcrypto);
  assert.match(raw, /^[0-9a-f]{64}$/, "32 bytes aleatorios");
  assert.equal(hashed, createHash("sha256").update(raw).digest("hex"));
  assert.notEqual((await createNonce(webcrypto)).raw, raw, "Cada inicio usa un nonce nuevo");

  const native = [];
  const auth = fakeAuth();
  const result = await signInWithGoogleNative({
    auth,
    clientId: CLIENT,
    nonce: async () => ({ raw, hashed }),
    online: () => true,
    native: async (command, args) => {
      native.push([command, args]);
      return { available: true, status: "ok", idToken: "id-token-fixture" };
    },
  });
  assert.equal(result, session);
  assert.deepEqual(native, [["sign_in_with_google", { serverClientId: CLIENT, nonce: hashed }]]);
  assert.deepEqual(auth.calls, [{ provider: "google", token: "id-token-fixture", nonce: raw }]);
});

test("Cada estado del teléfono se explica en español y nunca llega a Supabase", async () => {
  const cases = {
    no_account: GOOGLE_MESSAGES.no_account,
    no_play_services: GOOGLE_MESSAGES.no_play_services,
    offline: GOOGLE_MESSAGES.offline,
    interrupted: GOOGLE_MESSAGES.interrupted,
    config: GOOGLE_MESSAGES.config,
    error: GOOGLE_MESSAGES.error,
    desconocido: GOOGLE_MESSAGES.error,
  };
  for (const [status, message] of Object.entries(cases)) {
    const auth = fakeAuth();
    await assert.rejects(
      signInWithGoogleNative({ auth, clientId: CLIENT, online: () => true, native: async () => ({ available: true, status }) }),
      { message },
      status,
    );
    assert.equal(auth.calls.length, 0, status);
  }
  // Cancelar no es un error: la persona sigue en el formulario.
  const auth = fakeAuth();
  assert.equal(
    await signInWithGoogleNative({ auth, clientId: CLIENT, online: () => true, native: async () => ({ available: true, status: "cancelled" }) }),
    null,
  );
  assert.equal(auth.calls.length, 0);
  // Respuestas anómalas del plugin o un fallo de Tauri tampoco cierran la app.
  for (const native of [async () => ({ available: true, status: "ok" }), async () => null, async () => { throw new Error("tauri"); }])
    await assert.rejects(signInWithGoogleNative({ auth, clientId: CLIENT, online: () => true, native }), Error);
  await assert.rejects(
    signInWithGoogleNative({ auth, clientId: CLIENT, online: () => true, native: async () => ({ available: false }) }),
    { message: GOOGLE_MESSAGES.unavailable },
  );
});

test("Sin ID de cliente válido o sin red no se abre la ventana de Google", async () => {
  let opened = 0;
  const native = async () => {
    opened++;
    return { available: true, status: "ok", idToken: "x" };
  };
  for (const clientId of ["", "GOCSPX-secreto", "123-abc.apps.googleusercontent.com.evil.test", undefined])
    await assert.rejects(signInWithGoogleNative({ auth: fakeAuth(), clientId, online: () => true, native }), { message: GOOGLE_MESSAGES.config });
  await assert.rejects(signInWithGoogleNative({ auth: fakeAuth(), clientId: CLIENT, online: () => false, native }), { message: GOOGLE_MESSAGES.offline });
  assert.equal(opened, 0);
});

test("Los errores de Supabase se traducen sin mostrar detalles técnicos", async () => {
  const native = async () => ({ available: true, status: "ok", idToken: "x" });
  const cases = [
    [{ code: "unexpected_failure", message: "Database error saving new user", status: 500 }, GOOGLE_MESSAGES.account],
    [{ code: "provider_disabled", message: "Provider (issuer \"https://accounts.google.com\") is not enabled", status: 400 }, GOOGLE_MESSAGES.disabled],
    [{ message: "Failed to fetch", status: 0 }, GOOGLE_MESSAGES.offline],
    [{ code: "bad_jwt", message: "Unacceptable audience in id_token", status: 400 }, GOOGLE_MESSAGES.error],
  ];
  for (const [error, message] of cases)
    await assert.rejects(
      signInWithGoogleNative({ auth: fakeAuth({ data: { session: null }, error }), clientId: CLIENT, online: () => true, native }),
      { message },
      error.message,
    );
});

test("En la web se usa OAuth de Supabase con la dirección de retorno de la app", async () => {
  const calls = [];
  await signInWithGoogleWeb({
    auth: { signInWithOAuth: async (args) => (calls.push(args), { data: {}, error: null }) },
    redirectTo: "https://planifia.cl/",
  });
  assert.deepEqual(calls, [{ provider: "google", options: { redirectTo: "https://planifia.cl/" } }]);
  await assert.rejects(
    signInWithGoogleWeb({ auth: { signInWithOAuth: async () => ({ error: { message: "Unsupported provider: provider is not enabled" } }) }, redirectTo: "x" }),
    { message: GOOGLE_MESSAGES.disabled },
  );
});

test("Fuera de Android el comando nativo responde no disponible y la web usa OAuth", async () => {
  assert.deepEqual(await authCommand("sign_in_with_google"), { available: false });
  assert.equal(googleSignInMode(CLIENT), "web");
  assert.equal(googleSignInMode(""), "web", "La web no necesita el ID de cliente");
});

test("Los errores que Supabase deja en el enlace se leen y se explican", () => {
  assert.equal(authReturnError(""), null);
  assert.equal(authReturnError("#today"), null);
  assert.equal(authReturnError("#access_token=abc&refresh_token=def"), null);
  const expired = authReturnError("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.deepEqual(expired, { code: "otp_expired", description: "Email link is invalid or has expired" });
  assert.match(authReturnMessage(expired), /venció/);
  assert.equal(
    authReturnMessage(authReturnError("#error=server_error&error_description=Database+error+saving+new+user")),
    GOOGLE_MESSAGES.account,
  );
  assert.match(authReturnMessage(authReturnError("#error=access_denied&error_description=Cancelled")), /No se completó/);
  assert.match(authReturnMessage({}), /No pudimos completar/);
});

test("Se reconoce una cuenta con identidad de Google (nueva o vinculada a una de correo)", () => {
  assert.equal(usesGoogle({ app_metadata: { provider: "google", providers: ["google"] } }), true);
  assert.equal(usesGoogle({ app_metadata: { provider: "email", providers: ["email", "google"] } }), true);
  assert.equal(usesGoogle({ identities: [{ provider: "email" }, { provider: "google" }] }), true);
  assert.equal(usesGoogle({ app_metadata: { provider: "email", providers: ["email"] }, identities: [{ provider: "email" }] }), false);
  assert.equal(usesGoogle(null), false);
});
