import { assertEquals } from "@std/assert";
import { resolveDockerSocket } from "./dockerSocket.ts";

Deno.test("Docker socket selection honors overrides, context and local fallbacks", async () => {
  const keys = ["DOCKER_SOCKET", "DOCKER_HOST", "HOME", "PATH"];
  const previous = keys.map((key) => Deno.env.get(key));
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/docker`, `#!/bin/sh
if [ "$1" = context ]; then
  printf 'unix:///not-yet-started/docker.sock\\n'
fi
`, { mode: 0o755 });
    Deno.env.set("PATH", dir);
    Deno.env.set("HOME", dir);
    Deno.env.set("DOCKER_SOCKET", "/explicit.sock");
    Deno.env.set("DOCKER_HOST", "unix:///host.sock");
    assertEquals(await resolveDockerSocket(), "/explicit.sock");
    Deno.env.delete("DOCKER_SOCKET");
    assertEquals(await resolveDockerSocket(), "/host.sock");
    Deno.env.delete("DOCKER_HOST");
    assertEquals(await resolveDockerSocket(), "/not-yet-started/docker.sock");
    await Deno.remove(`${dir}/docker`);
    Deno.env.delete("DOCKER_SOCKET");
    assertEquals(await resolveDockerSocket(), "/var/run/docker.sock");
    await Deno.mkdir(`${dir}/.docker/desktop`, { recursive: true });
    await Deno.writeTextFile(`${dir}/.docker/desktop/docker.sock`, "");
    assertEquals(await resolveDockerSocket(), `${dir}/.docker/desktop/docker.sock`);
  } finally {
    keys.forEach((key, index) => {
      const value = previous[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    await Deno.remove(dir, { recursive: true });
  }
});
