import fs from 'node:fs';
import path from 'node:path';

/**
 * Simulator services a Harness test run never uses. Right after boot they
 * keep several cores busy (photo analysis alone takes about three cores for
 * over a minute) and, taken together, add enough memory pressure to starve a
 * 3-core, 7 GB CI runner.
 *
 * This is simslim's default profile (https://github.com/MobAI-App/simslim,
 * v0.9.0) with its `store` and `web` categories kept on, so push, StoreKit,
 * in-app purchases and universal links still work for the app under test.
 * simslim keeps gamed (XCUITest app launches stall without it) and assistantd
 * (Spotlight leaks memory without it) on, and never touches services that
 * wedge a simulator when disabled, such as routined, biomed, biomesyncd and
 * nanoprefsyncd.2.
 *
 * `launchctl disable` accepts labels a runtime does not have, and launchd_sim
 * ignores unknown labels in its overrides, so those do no harm.
 */
export const SIMULATOR_SLIM_LABELS = [
  // Widgets and wallpaper; chronod launches every widget extension, and navd
  // keeps the Maps widget from retrying in a tight loop.
  'com.apple.PosterBoard',
  'com.apple.chronod',
  'com.apple.liveactivitiesd',
  'com.apple.navd',
  // Siri, Apple Intelligence, speech and on-device models.
  'com.apple.assistant_cdmd',
  'com.apple.assistant_service',
  'com.apple.corespeechd',
  'com.apple.generativeexperiencesd',
  'com.apple.intelligencecontextd',
  'com.apple.intelligenceflowd',
  'com.apple.intelligenceplatformd',
  'com.apple.intelligencetasksd',
  'com.apple.knowledgeconstructiond',
  'com.apple.mlhostd',
  'com.apple.mlruntimed',
  'com.apple.modelcatalogd',
  'com.apple.modelmanagerd',
  'com.apple.naturallanguaged',
  'com.apple.parsec-fbf',
  'com.apple.parsecd',
  'com.apple.proactiveeventtrackerd',
  'com.apple.siri.acousticsignature',
  'com.apple.siri.context.service',
  'com.apple.siriactionsd',
  'com.apple.siriinferenced',
  'com.apple.siriknowledged',
  'com.apple.sirittsd',
  'com.apple.speechmodeltrainingd',
  'com.apple.suggestd',
  'com.apple.textunderstandingd',
  'com.apple.voicebankingd',
  'com.apple.voiced',
  // Spotlight and search.
  'com.apple.corespotlightservice',
  'com.apple.searchd',
  'com.apple.searchtoold',
  'com.apple.spotlightknowledged',
  'com.apple.spotlightknowledged.updater',
  // iCloud and Apple Account.
  'com.apple.SecureBackupDaemon',
  'com.apple.TrustedPeersHelper',
  'com.apple.akd',
  'com.apple.appleaccountd',
  'com.apple.appleaccounttransparencyd',
  'com.apple.appleidsetupd',
  'com.apple.bird',
  'com.apple.cdpd',
  'com.apple.ckdiscretionaryd',
  'com.apple.cloudd',
  'com.apple.cloudphotod',
  'com.apple.cloudsettingssyncagent',
  'com.apple.communicationtrustd',
  'com.apple.icloudmailagent',
  'com.apple.icloudsubscriptionoptimizerd',
  'com.apple.protectedcloudstorage.protectedcloudkeysyncing',
  'com.apple.sosd',
  'com.apple.syncdefaultsd',
  // Mail, Calendar and Contacts.
  'com.apple.calaccessd',
  'com.apple.contacts.postersyncd',
  'com.apple.contactsd',
  'com.apple.dataaccess.dataaccessd',
  'com.apple.email.maild',
  'com.apple.exchangesyncd',
  'com.apple.peopled',
  'com.apple.remindd',
  // Family and Screen Time.
  'com.apple.FamilyControlsAgent',
  'com.apple.ScreenTimeAgent',
  'com.apple.ScreenTimeSettingsAgent',
  'com.apple.UsageTrackingAgent',
  'com.apple.askpermissiond',
  'com.apple.asktod',
  'com.apple.familycircled',
  'com.apple.familynotification',
  // Health, Home and Fitness.
  'com.apple.activityawardsd',
  'com.apple.activitysharingd',
  'com.apple.finhealthd',
  'com.apple.fitcore',
  'com.apple.fitcore.session',
  'com.apple.fitnesscoachingd',
  'com.apple.fitnessintelligenced',
  'com.apple.healthappd',
  'com.apple.healthcontentd',
  'com.apple.healthd',
  'com.apple.healtheventsd',
  'com.apple.healthrecordsd',
  'com.apple.homed',
  'com.apple.homeeventsd',
  // Photos and media analysis.
  'com.apple.assetsd',
  'com.apple.assetsd.nebulad',
  'com.apple.mediaanalysisd',
  'com.apple.mediaanalysisd.service',
  'com.apple.medialibraryd',
  'com.apple.mediastream.mstreamd',
  'com.apple.photoanalysisd',
  'com.apple.photosface',
  // News, Weather, Maps and games.
  'com.apple.GameController.gamecontrollerd',
  'com.apple.MapKit.SnapshotService',
  'com.apple.Maps.geocorrectiond',
  'com.apple.Maps.mapspushd',
  'com.apple.Maps.mapssyncd',
  'com.apple.gamesaved',
  'com.apple.jetpackassetd',
  'com.apple.maps.destinationd',
  'com.apple.newsd',
  'com.apple.tipsd',
  'com.apple.weatherd',
  // Messaging and FaceTime.
  'com.apple.facetimemessagestored',
  'com.apple.identityservicesd',
  'com.apple.ids_simd',
  'com.apple.imautomatichistorydeletionagent',
  'com.apple.imcore.imtransferagent',
  'com.apple.imdpersistence.IMDPersistenceAgent',
  'com.apple.telephonyutilities.callservicesd',
  // Sharing and device connectivity.
  'com.apple.announced',
  'com.apple.avatarsd',
  'com.apple.carkitd',
  'com.apple.companiond',
  'com.apple.findmy.findmylocated',
  'com.apple.rapportd',
  'com.apple.sociallayerd',
  'com.apple.stickersd',
  'com.apple.tvremoted',
  'com.apple.wcd',
  // Ads, diagnostics and telemetry.
  'com.apple.ap.adprivacyd',
  'com.apple.ap.promotedcontentd',
  'com.apple.devicecheckd',
  'com.apple.diagnosticextensionsd',
  'com.apple.feedbackd',
  'com.apple.followupd',
  'com.apple.geoanalyticsd',
  'com.apple.purplebuddy.budd',
  'com.apple.rtcreportingd',
  'com.apple.securityuploadd',
  'com.apple.triald',
  // Other background services.
  'com.apple.StatusKitAgent',
  'com.apple.businessservicesd',
  'com.apple.coreidvd',
  'com.apple.countryd',
  'com.apple.deviceaccessd',
  'com.apple.ind',
  'com.apple.linkd',
  'com.apple.managedconfiguration.passcodenagd',
  'com.apple.merchantd',
  'com.apple.mobileassetd',
  'com.apple.replicatord',
  'com.apple.storagedatad',
] as const;

/**
 * launchd_sim runs on the host and keeps a simulator's `launchctl
 * disable`/`enable` overrides in this file, keyed only by UDID. It reads the
 * file when it starts and rewrites it on every change. From iOS 18.5 it
 * honours the file at boot, so a simulator seeded while it is shut down boots
 * with these services never started. The location is undocumented, so the
 * booted simulator is always checked afterwards.
 */
export const DEFAULT_LAUNCHD_OVERRIDES_ROOT = '/private/var/tmp';

export const getLaunchdOverridesPath = (
  udid: string,
  root: string = DEFAULT_LAUNCHD_OVERRIDES_ROOT
): string =>
  path.join(root, `com.apple.CoreSimulator.SimDevice.${udid}`, 'disabled.plist');

export type SimulatorSlimSeedResult =
  | { seeded: true; path: string; added: number }
  | { seeded: false; path: string; reason: string };

const ENTRY_PATTERN = /<key>([^<]*)<\/key>\s*<(true|false)\s*\/>/g;

const unescapeXml = (text: string): string =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

const escapeXml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/** Reads the flat label => true/false dict launchd_sim writes. */
export const parseLaunchdOverrides = (xml: string): Map<string, boolean> => {
  const entries = new Map<string, boolean>();
  for (const match of xml.matchAll(ENTRY_PATTERN)) {
    entries.set(unescapeXml(match[1]), match[2] === 'true');
  }
  return entries;
};

/** Renders the overrides in the shape launchd_sim writes, sorted by label. */
export const serializeLaunchdOverrides = (
  entries: Map<string, boolean>
): string => {
  const body = [...entries.keys()]
    .sort()
    .map(
      (label) =>
        `\t<key>${escapeXml(label)}</key>\n\t<${entries.get(label) ? 'true' : 'false'}/>\n`
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    `<plist version="1.0">\n<dict>\n${body}</dict>\n</plist>\n`
  );
};

/**
 * Marks {@link SIMULATOR_SLIM_LABELS} disabled in a shut-down simulator's
 * launchd overrides, so its next boot starts none of them. Every other entry,
 * including the explicit enables the runtime writes for itself, is kept. Has
 * no effect on a booted simulator until it boots again. Never throws.
 */
export const seedSimulatorSlim = (
  udid: string,
  { root = DEFAULT_LAUNCHD_OVERRIDES_ROOT }: { root?: string } = {}
): SimulatorSlimSeedResult => {
  const overridesPath = getLaunchdOverridesPath(udid, root);
  try {
    let entries = new Map<string, boolean>();
    if (fs.existsSync(overridesPath)) {
      const content = fs.readFileSync(overridesPath, 'utf8');
      if (!content.trimStart().startsWith('<?xml')) {
        return {
          seeded: false,
          path: overridesPath,
          reason: 'the existing overrides are not an XML property list',
        };
      }
      entries = parseLaunchdOverrides(content);
    }

    let added = 0;
    for (const label of SIMULATOR_SLIM_LABELS) {
      if (entries.get(label) !== true) {
        entries.set(label, true);
        added++;
      }
    }

    const directory = path.dirname(overridesPath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    // Written whole and renamed into place, so launchd_sim never reads half
    // of it.
    const temporaryPath = `${overridesPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, serializeLaunchdOverrides(entries), {
      mode: 0o644,
    });
    fs.renameSync(temporaryPath, overridesPath);

    return { seeded: true, path: overridesPath, added };
  } catch (error) {
    return {
      seeded: false,
      path: overridesPath,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};
