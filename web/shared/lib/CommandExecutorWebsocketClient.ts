import { commandResultSchema } from "~/shared/schemas.zod";
import { WebsocketClient, type WebsocketClientConfig } from "./WebsocketClient";
import type { Command, CommandResult } from "../../../shared/types";

export class CommandExecutorWebsocketClient extends WebsocketClient {
  constructor(config: WebsocketClientConfig) {
    super(config);
  }

  public executeCommand(command: Command) {
    console.log("executing command...", command);
    this.send(JSON.stringify(command));
  }

  protected override handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      return;
    }

    try {
      const dataJSON = JSON.parse(data);

      const parsedJSON = commandResultSchema.safeParse(dataJSON);

      if (parsedJSON.error) {
        console.log(
          "skipping message because it's not a valid command output",
          dataJSON
        );
        return;
      }

      this.sendOutputNotification(parsedJSON.data);
    } catch (error) {
      console.log("error parsing command result");
    }
  }

  private sendOutputNotification(result: CommandResult) {
    let message;

    switch (result.type) {
      case "docker":
        message = `Docker command for ${result.data.containerName} container`;
        break;
      case "process":
        message = `Process command for ${result.data.affectedProcessName}`;
        break;
      default:
        break;
    }

    useToast().add({
      title: `Command execution ${
        result.data.success ? "succeeded" : "failed"
      }`,
      color: result.data.success ? "green" : "red",
      description: message,
    });
  }
}
