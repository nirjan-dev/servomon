import { ConfirmDialog } from "#components";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel: string;
};

// Destructive-action confirmation as a promise: true only on explicit confirm.
export function useConfirmDialog() {
  const overlay = useOverlay();
  return async (options: ConfirmOptions): Promise<boolean> => {
    const modal = overlay.create(ConfirmDialog, { destroyOnClose: true, props: options });
    return (await modal.open().result) === true;
  };
}
