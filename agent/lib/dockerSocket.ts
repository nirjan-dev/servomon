// Resolve once at startup, then share the engine with metrics and commands.
export async function resolveDockerSocket(): Promise<string> {
  const explicit = Deno.env.get("DOCKER_SOCKET");
  if (explicit) return explicit;
  const host = Deno.env.get("DOCKER_HOST");
  if (host?.startsWith("unix://")) return host.slice(7);
  try {
    const output = await new Deno.Command("docker", {
      args: ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
      stdout: "piped",
      stderr: "null",
    }).output();
    const endpoint = new TextDecoder().decode(output.stdout).trim();
    // A context remains authoritative even while its engine is not running.
    if (output.success && endpoint.startsWith("unix://")) return endpoint.slice(7);
  } catch {
    // Docker CLI is optional for read-only metrics collection.
  }
  const home = Deno.env.get("HOME");
  if (home) {
    const desktop = `${home}/.docker/desktop/docker.sock`;
    try {
      await Deno.stat(desktop);
      return desktop;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return "/var/run/docker.sock";
}

export type DockerSocketAccess = "ok" | "missing" | "denied";

// systeminformation turns engine errors into an empty container list, so an
// unreadable socket looks exactly like a host without containers. Probe it.
export async function probeDockerSocket(path: string): Promise<DockerSocketAccess> {
  try {
    const conn = await Deno.connect({ transport: "unix", path });
    conn.close();
    return "ok";
  } catch (error) {
    if (error instanceof Deno.errors.PermissionDenied) return "denied";
    if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.ConnectionRefused) return "missing";
    throw error;
  }
}

export function dockerCommandEnvironment(): Record<string, string> {
  const socket = Deno.env.get("DOCKER_SOCKET");
  if (!socket) throw new Error("Docker socket has not been initialized");
  return { DOCKER_HOST: `unix://${socket}` };
}
