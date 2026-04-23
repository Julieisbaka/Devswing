import { LiveShare, SharedService, SharedServiceProxy } from "vsls";

export default function initializeBaseService(
  api: LiveShare,
  peer: number,
  service: SharedService | SharedServiceProxy,
  broadcastNotifications: boolean = false
) {
  // Intentionally a no-op for now. This placeholder keeps a consistent API
  // surface for host/guest Live Share modules while feature work is pending.
  void api;
  void peer;
  void service;
  void broadcastNotifications;
}
