import type { Role } from "./model";

export interface TrustedIdentity {
  id: string;
  name: string;
  email: string;
  department: string;
  active: boolean;
  roles: Role[];
  requesterRole: "student" | "faculty" | null;
}
