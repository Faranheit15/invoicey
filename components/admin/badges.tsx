import { Badge } from "@/components/ui/badge";
import type { UserRole, UserStatus } from "@/lib/admin-types";

export function RoleBadge({ role }: { role: UserRole }) {
  return role === "admin" ? (
    <Badge variant="info">Admin</Badge>
  ) : (
    <Badge variant="neutral">User</Badge>
  );
}

export function StatusBadge({ status }: { status: UserStatus }) {
  return status === "suspended" ? (
    <Badge variant="danger">Suspended</Badge>
  ) : (
    <Badge variant="success">Active</Badge>
  );
}
