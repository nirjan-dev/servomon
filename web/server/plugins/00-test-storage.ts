import fsDriver from "unstorage/drivers/fs";

// S1 test hook: when SERVOMON_DATA_DIR is set, remount every fs-backed store
// under that directory so test runs (and only test runs) get isolated data.
// Nitro bakes storage bases as absolute build-time paths, so the test suite
// cannot isolate storage via cwd alone. Production never sets this variable.
const MOUNTS = ["metrics", "pushSubs", "serverState", "systemConfigs", "agents", "audit"] as const;

export default defineNitroPlugin(async () => {
  const root = process.env.SERVOMON_DATA_DIR;
  if (!root) return;
  const storage = useStorage();
  for (const mount of MOUNTS) {
    await storage.unmount(mount);
    storage.mount(mount, fsDriver({ base: `${root}/${mount}` }));
  }
});
