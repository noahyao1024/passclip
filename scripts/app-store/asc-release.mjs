// Releases a new App Store version of Passclip after 1.0, one step at a time:
//   node asc-release.mjs create 1.1                  create the version (or find it), release automatically after approval
//   node asc-release.mjs whatsnew 1.1 <file>          set "What's New" for every localization from a text file,
//                                                     or from <folder>/<locale>.txt, one per language
//   node asc-release.mjs metadata 1.1 <file>          set the name, subtitle, keywords and promotional text from metadata/<locale>.json;
//                                                     a new locale is added (give it a description too). Checks the file first
//   node asc-release.mjs check <file>                 check a metadata file's lengths and repeated words without sending it
//   node asc-release.mjs build 1.1 <build version>    attach a processed build
//   node asc-release.mjs review 1.1                   copy the App Review contact and notes from the live version
//   node asc-release.mjs submit 1.1                   submit the version for review
//   node asc-release.mjs cancel 1.1                   cancel this version's review submission
//   node asc-release.mjs screenshots 1.1 <folder> [locale]  replace the folder's iPhone/iPad screenshot sets (default en-US)
//   node asc-release.mjs status                       list versions and their states
// See README.md in this folder for the release workflow and screenshot requirements.
// Needs ASC_KEY_ID and ASC_ISSUER_ID. Never prints the key or token.
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { api } from "./asc-lib.mjs";
import { checkListing, readListing } from "./metadata.mjs";
import { readScreenshots, uploadScreenshot } from "./screenshots.mjs";

const APP = "6819692153";

// Collection responses can span pages, including old versions and submission items.
async function list(path) {
  const data = [];
  while (path) {
    const page = await api("GET", path);
    data.push(...page.data);
    const next = page.links?.next && new URL(page.links.next, "https://api.appstoreconnect.apple.com");
    if (next && (next.origin !== "https://api.appstoreconnect.apple.com" || !next.pathname.startsWith("/v1/"))) throw new Error("unexpected API pagination URL");
    path = next ? next.pathname + next.search : null;
  }
  return data;
}
async function versions() {
  return list(`/v1/apps/${APP}/appStoreVersions?filter[platform]=IOS&fields[appStoreVersions]=versionString,appStoreState,releaseType&limit=200`);
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
  const perLocale = statSync(file).isDirectory();
  const v = await version(name);
  const locs = await api("GET", `/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
  for (const loc of locs.data) {
    await api("PATCH", `/v1/appStoreVersionLocalizations/${loc.id}`, { data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: { whatsNew: readFileSync(perLocale ? `${file}/${loc.attributes.locale}.txt` : file, "utf8").trim() } } });
    const sets = await api("GET", `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`);
    console.log("what's new set for", loc.attributes.locale, "| screenshot sets:", sets.data.map((s) => s.attributes.screenshotDisplayType).join(", ") || "none");
  }
}

// App infos and versions that App Store Connect still lets you change.
const editable = ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"];
const pick = (object, keys) => Object.fromEntries(keys.filter((k) => object[k] !== undefined).map((k) => [k, object[k]]));

function check(file) {
  const { locale, listing } = readListing(file);
  const problems = checkListing(listing);
  if (problems.length) throw new Error(`${locale}:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  return { locale, listing };
}

// Changes one localization, or adds it. Links it doesn't have yet come from the primary language: adding a language's
// name also adds an empty version localization for it. Prints each field before and after.
async function upsert(type, existing, locale, attributes, primary, links, parent) {
  const current = existing.find((l) => l.attributes.locale === locale);
  const copied = pick(existing.find((l) => l.attributes.locale === primary)?.attributes ?? {}, links.filter((k) => !current?.attributes[k]));
  const all = { ...copied, ...attributes };
  for (const [k, v] of Object.entries(all)) console.log(`${locale} ${k}: ${JSON.stringify(current?.attributes[k] ?? null)} -> ${JSON.stringify(v)}`);
  if (current) return api("PATCH", `/v1/${type}/${current.id}`, { data: { type, id: current.id, attributes: all } });
  return api("POST", `/v1/${type}`, { data: { type, attributes: { locale, ...all }, relationships: parent } });
}

async function metadata(name, file) {
  const { locale, listing } = check(file);
  const v = await version(name);
  if (!editable.includes(v.attributes.appStoreState)) throw new Error(`version ${name} is ${v.attributes.appStoreState} and can't be changed`);
  // Name and subtitle belong to the app info that goes out with this version, not the live one.
  const infos = (await api("GET", `/v1/apps/${APP}/appInfos`)).data;
  const info = infos.find((i) => editable.includes(i.attributes.state ?? i.attributes.appStoreState));
  if (!info) throw new Error("no app info is open for changes; run create first");
  const { primaryLocale } = (await api("GET", `/v1/apps/${APP}?fields[apps]=primaryLocale`)).data.attributes;
  const infoLocs = (await api("GET", `/v1/appInfos/${info.id}/appInfoLocalizations`)).data;
  await upsert("appInfoLocalizations", infoLocs, locale, pick(listing, ["name", "subtitle"]), primaryLocale, ["privacyPolicyUrl"], { appInfo: { data: { type: "appInfos", id: info.id } } });
  const versionLocs = (await api("GET", `/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`)).data;
  await upsert("appStoreVersionLocalizations", versionLocs, locale, pick(listing, ["keywords", "promotionalText", "description"]), primaryLocale, ["supportUrl", "marketingUrl"], { appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } });
  console.log("metadata set for", locale, "on", name);
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
  if (!editable.includes(v.attributes.appStoreState)) throw new Error(`version ${name} is ${v.attributes.appStoreState} and can't be submitted`);
  const drafts = await submissions(["READY_FOR_REVIEW"]);
  const matches = drafts.filter((s) => s.items.some((item) => item.relationships?.appStoreVersion?.data?.id === v.id));
  const candidates = matches.length ? matches : drafts.filter((s) => s.items.length === 0);
  if (candidates.length > 1) throw new Error(`multiple draft submissions could target ${name}; resolve them in App Store Connect`);
  let submission = candidates[0];
  if (submission && submission.items.length > 1) throw new Error(`draft ${submission.id} includes other items; resolve it in App Store Connect before submitting ${name}`);
  if (!submission) {
    if (drafts.length) throw new Error(`the draft submission belongs to other items; resolve it in App Store Connect before submitting ${name}`);
    submission = (await api("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: APP } } } } })).data;
  }
  if (!submission.items?.length) await api("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } } } });
  await api("PATCH", `/v1/reviewSubmissions/${submission.id}`, { data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } } });
  console.log("submitted", name, "for review");
}

async function submissions(states) {
  const found = await list(`/v1/apps/${APP}/reviewSubmissions?filter[platform]=IOS&limit=200`);
  const result = [];
  for (const s of found.filter((s) => states.includes(s.attributes.state))) {
    result.push({ ...s, items: await list(`/v1/reviewSubmissions/${s.id}/items?include=appStoreVersion&limit=200`) });
  }
  return result;
}

async function cancel(name) {
  const v = await version(name);
  const pending = await submissions(["WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES"]);
  const matches = pending.filter((s) => s.items.some((item) => item.relationships?.appStoreVersion?.data?.id === v.id));
  if (matches.length !== 1) throw new Error(`expected one active review submission for ${name}; found ${matches.length}`);
  const s = matches[0];
  if (s.items.length !== 1) throw new Error(`submission ${s.id} includes other items; cancel it in App Store Connect after reviewing them`);
  await api("PATCH", `/v1/reviewSubmissions/${s.id}`, { data: { type: "reviewSubmissions", id: s.id, attributes: { canceled: true } } });
  console.log("cancellation requested for", name, "| run status to check its state");
}

async function screenshots(name, folder, locale = "en-US") {
  // Read and validate every file, including other device sets, before deleting anything.
  const groups = readScreenshots(folder);
  const v = await version(name);
  if (!editable.includes(v.attributes.appStoreState)) throw new Error(`version ${name} is ${v.attributes.appStoreState} and can't change screenshots`);
  const locs = await list(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=200`);
  const loc = locs.find((l) => l.attributes.locale === locale);
  if (!loc) throw new Error(`${locale} localization not found on version ${name}; add its metadata first`);
  const sets = await list(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=200`);
  // Finish remote reads for all affected sets before starting replacement.
  for (const group of groups) {
    group.set = sets.find((s) => s.attributes.screenshotDisplayType === group.displayType);
    group.existing = group.set ? await list(`/v1/appScreenshotSets/${group.set.id}/appScreenshots?limit=200`) : [];
  }
  for (const group of groups) {
    const set = group.set ?? (await api("POST", "/v1/appScreenshotSets", { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: group.displayType }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } } })).data;
    for (const shot of group.existing) await api("DELETE", `/v1/appScreenshots/${shot.id}`);
    for (const file of group.files) await uploadScreenshot(set.id, file);
    console.log("screenshots complete:", name, locale, group.displayType, group.files.length);
  }
}

async function status() {
  for (const v of await versions()) console.log(v.attributes.versionString, v.attributes.appStoreState, v.attributes.releaseType);
}

export async function run(args) {
  const [command, versionString, arg, locale] = args;
  const commands = { create: () => create(versionString), whatsnew: () => whatsNew(versionString, arg), metadata: () => metadata(versionString, arg), check: async () => console.log(check(versionString).locale, "is ready"), build: () => build(versionString, arg), review: () => review(versionString), submit: () => submit(versionString), cancel: () => cancel(versionString), screenshots: () => screenshots(versionString, arg, locale), status };
  const counts = { create: [1], whatsnew: [2], metadata: [2], check: [1], build: [2], review: [1], submit: [1], cancel: [1], screenshots: [2, 3], status: [0] };
  if (!Object.hasOwn(commands, command) || !counts[command].includes(args.length - 1) || args.slice(1).some((a) => !a.trim())) throw new Error("usage: create <v> | whatsnew <v> <file> | metadata <v> <file> | check <file> | build <v> <build> | review <v> | submit <v> | cancel <v> | screenshots <v> <folder> [locale] | status");
  await commands[command]();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
