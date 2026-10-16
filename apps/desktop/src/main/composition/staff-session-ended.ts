export type StaffSessionEndedActions = Readonly<{
  stopHeartbeat(): void;
  closeInternalPage(): void;
  notifyRenderer(): void;
}>;

export function createStaffSessionEndedHandler(actions: StaffSessionEndedActions): () => void {
  return () => {
    try {
      actions.stopHeartbeat();
      actions.closeInternalPage();
    } finally {
      actions.notifyRenderer();
    }
  };
}
