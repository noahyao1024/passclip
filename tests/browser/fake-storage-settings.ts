// Shared by the fake bucket (fake-storage.ts) and the test server's settings (playwright.config.ts).
export const FAKE_STORAGE = {
  port: 3102,
  bucket: "passclip-test",
  region: "us-east-1",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  siteOrigin: "http://127.0.0.1:3100",
  publicUrl: "https://files.passclip.test/passclip-test",
};

/** The settings the site under test runs with, so it offers uploads to the fake bucket. */
export const FAKE_STORAGE_ENV = {
  STORAGE_ENDPOINT: `http://127.0.0.1:${FAKE_STORAGE.port}`,
  STORAGE_REGION: FAKE_STORAGE.region,
  STORAGE_BUCKET: FAKE_STORAGE.bucket,
  STORAGE_ACCESS_KEY_ID: FAKE_STORAGE.accessKeyId,
  STORAGE_SECRET_ACCESS_KEY: FAKE_STORAGE.secretAccessKey,
  STORAGE_PUBLIC_URL: FAKE_STORAGE.publicUrl,
};
