import type { PushSubscription } from "web-push";

type Subs = PushSubscription[];

export class PushSubscribersService {
  #storageKey = "pushSubs";
  #keyName = "allSubs";

  #storageClient = useStorage(this.#storageKey);

  public async isSubscribed(endpoint: string): Promise<boolean> {
    const subs = await this.getAllSubscriptions();

    const subToFind = subs.find((s) => s.endpoint === endpoint);

    if (subToFind) {
      return true;
    }

    return false;
  }

  public async addSubscription(newSub: PushSubscription) {
    try {
      const subs = await this.getAllSubscriptions();
      if (subs.some((sub) => sub.endpoint === newSub.endpoint)) return true;
      subs?.push(newSub);
      await this.#storageClient.setItem(this.#keyName, subs);
      return true;
    } catch (error) {
      console.log("error adding new sub", error);
      return false;
    }
  }

  public async removeSubscription(endpoint: string) {
    const subs = await this.getAllSubscriptions();
    await this.#storageClient.setItem(this.#keyName, subs.filter((sub) => sub.endpoint !== endpoint));
  }

  public async getAllSubscriptions() {
    const subs = await this.#storageClient.getItem<Subs>(this.#keyName);

    return subs ?? [];
  }
}
