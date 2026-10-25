// Releases a new App Store version of Passclip after 1.0, one step at a time:
//   node asc-release.mjs create 1.1                  create the version (or find it), release automatically after approval
//   node asc-release.mjs whatsnew 1.1 <file>          set "What's New" for every localization from a text file
//   node asc-release.mjs build 1.1 <build version>    attach a processed build
//   node asc-release.mjs review 1.1                   copy the App Review contact and notes from the live version
//   node asc-release.mjs submit 1.1                   submit the version for review
//   node asc-release.mjs status                       list versions and their states
// Needs ASC_KEY_ID and ASC_ISSUER_ID. Never prints the key or token.
import { readFileSync } from "node:fs";
import { api } from "./asc-lib.mjs";

const APP = "6819692153";
const [command, versionString, arg] = process.argv.slice(2);

async function versions() {
  return (await api("GET", `/v1/apps/${APP}/appStoreVersions?fields[appStoreVersions]=versionString,appStoreState,releaseType&limit=20`)).data;
}
async function version(name) {
  const found = (await versions()).find((v) => v.attributes.versionString === name);
  if (!found) throw new Error(`version ${name} not found; run create first`);
  return found;
}

async function create(name) {
  const existing = (await versions()).find((v) => v.attributes.versionString === name);
  if (existing) { console.log("version", name, "already exists:", existing.attributes.appStoreState); return; }
  await api("POST", "/v1/appStoreVersions", { data: { type: "appStoreVersions", attributes: { platform: "IOS", versionString: name, releaseType: "AFTER_APPROVAL" }, relationships: { app: { data: { type: "apps", id: APP } } } } });
  console.log("created version", name);
}

async function whatsNew(name, file) {
  const text = readFileSync(file, "utf8").trim();
  const v = await version(name);
  const locs = await api("GET", `/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
  for (const loc of locs.data) {
    await api("PATCH", `/v1/appStoreVersionLocalizations/${loc.id}`, { data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: { whatsNew: text } } });
    const sets = await api("GET", `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`);
    console.log("what's new set for", loc.attributes.locale, "| screenshot sets:", sets.data.map((s) => s.attributes.screenshotDisplayType).join(", ") || "none");
  }
}

async function build(name, buildVersion) {
  const v = await version(name);
  const builds = await api("GET", `/v1/builds?filter[app]=${APP}&filter[version]=${buildVersion}&fields[builds]=version,processingState`);
  const found = builds.data[0];
  if (!found) throw new Error(`build ${buildVersion} not found yet`);
  if (found.attributes.processingState !== "VALID") throw new Error(`build ${buildVersion} is ${found.attributes.processingState}`);
  await api("PATCH", `/v1/appStoreVersions/${v.id}/relationships/build`, { data: { type: "builds", id: found.id } });
  console.log("attached build", buildVersion, "to", name);
}

async function review(name) {
  const v = await version(name);
  const live = (await versions()).find((x) => x.attributes.appStoreState === "READY_FOR_SALE");
  const source = live && (await api("GET", `/v1/appStoreVersions/${live.id}/appStoreReviewDetail`).catch(() => null));
  if (!source?.data) throw new Error("no review details on the live version to copy");
  const keep = ["contactFirstName", "contactLastName", "contactPhone", "contactEmail", "demoAccountRequired", "notes"];
  const attributes = Object.fromEntries(keep.map((k) => [k, source.data.attributes[k]]));
  const existing = await api("GET", `/v1/appStoreVersions/${v.id}/appStoreReviewDetail`).catch(() => null);
  if (existing?.data?.id) await api("PATCH", `/v1/appStoreReviewDetails/${existing.data.id}`, { data: { type: "appStoreReviewDetails", id: existing.data.id, attributes } });
  else await api("POST", "/v1/appStoreReviewDetails", { data: { type: "appStoreReviewDetails", attributes, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } } } });
  console.log("review details copied to", name);
}

async function submit(name) {
  const v = await version(name);
  const submission = await api("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: APP } } } } });
  await api("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: submission.data.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } } } });
  await api("PATCH", `/v1/reviewSubmissions/${submission.data.id}`, { data: { type: "reviewSubmissions", id: submission.data.id, attributes: { submitted: true } } });
  console.log("submitted", name, "for review");
}

async function status() {
  for (const v of await versions()) console.log(v.attributes.versionString, v.attributes.appStoreState, v.attributes.releaseType);
}

const commands = { create: () => create(versionString), whatsnew: () => whatsNew(versionString, arg), build: () => build(versionString, arg), review: () => review(versionString), submit: () => submit(versionString), status };
if (!commands[command]) { console.log("usage: create <v> | whatsnew <v> <file> | build <v> <build> | review <v> | submit <v> | status"); process.exit(1); }
await commands[command]().catch((error) => { console.error(error.message); process.exit(1); });
