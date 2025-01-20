import {
  DockerCommand,
  DockerCommandResult,
  ProcessCommand,
  ProcessCommandResult,
} from "./../../shared/types.ts";
import type { WebsocketClientConfig } from "../../shared/lib/WebsocketClient.ts";
import { WebsocketClient } from "../../shared/lib/WebsocketClient.ts";
import { commandSchema } from "../schemas/schemas.zod.ts";
import { CommandResult } from "../../shared/types.ts";

export class CommandResponderWebsocketClient extends WebsocketClient {
  constructor(config: WebsocketClientConfig) {
    super(config);
  }

  protected override async handleMessage(data: unknown): Promise<void> {
    if (typeof data !== "string") {
      return;
    }

    try {
      const dataJSON = JSON.parse(data);
      const parsedCommand = commandSchema.safeParse(dataJSON);

      if (parsedCommand.error) {
        return;
      }

      let result: CommandResult | null = null;
      switch (parsedCommand.data.type) {
        case "process":
          result = {
            type: "process",
            data: await this.handleProcessCommands(parsedCommand.data),
          };
          break;
        case "docker":
          result = {
            type: "docker",
            data: await this.handleDockerCommands(parsedCommand.data),
          };
          break;
        default:
          break;
      }
      if (result) {
        this.sendCommandResult(result);
      }
    } catch (error) {
      console.log("error parsing command", error);
    }
  }
  private async handleDockerCommands(
    command: DockerCommand
  ): Promise<DockerCommandResult> {
    console.log("handling docker command", command);

    let process;

    switch (command.action) {
      case "unpause":
        process = new Deno.Command("docker", {
          args: ["container", "unpause", command.containerName],
        });
        break;
      case "pause":
        process = new Deno.Command("docker", {
          args: ["container", "pause", command.containerName],
        });
        break;
      case "stop":
        process = new Deno.Command("docker", {
          args: ["container", "stop", command.containerName],
        });
        break;
      default:
        break;
    }

    if (process) {
      const output = await process.output();

      return {
        success: output.code === 0,
        timestamp: new Date().getMilliseconds(),
        containerName: command.containerName,
        error: new TextDecoder().decode(output.stderr),
      };
    }

    return {
      success: false,
      timestamp: new Date().getMilliseconds(),
      containerName: command.containerName,
      error: "error executing docker command",
    };
  }

  private sendCommandResult(result: CommandResult) {
    this.send(JSON.stringify(result));
  }

  private async handleProcessCommands(
    command: ProcessCommand
  ): Promise<ProcessCommandResult> {
    console.log("handling process command", command);

    let process;
    switch (command.action) {
      case "kill":
        process = new Deno.Command("kill", {
          args: [command.pid],
        });
        break;
      default:
        break;
    }

    if (process) {
      const output = await process.output();

      return {
        success: output.code === 0,
        affectedPid: command.pid,
        affectedProcessName: command.processName,
        timestamp: new Date().getMilliseconds(),
        error: new TextDecoder().decode(output.stderr),
      };
    }

    return {
      success: false,
      affectedPid: command.pid,
      affectedProcessName: command.processName,
      timestamp: new Date().getMilliseconds(),
      error: "Error executing process command",
    };
  }
}
